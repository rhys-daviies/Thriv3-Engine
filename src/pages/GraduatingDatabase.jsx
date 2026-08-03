import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Download, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { SPORTS } from '@/lib/sports';
import { normalizeDivision, STARTER_MINUTES_THRESHOLD, POSITION_PILL_VARIANT } from '@/lib/divisions';
import { entities, functions } from '@/api/client';

const DIVISION_TABS = ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA'];
const DIVISION_TAB_LABEL = { 'NCAA D1': 'D1', 'NCAA D2': 'D2', 'NCAA D3': 'D3', NAIA: 'NAIA' };
const CONFIDENCE_VARIANT = { high: 'green', medium: 'amber', low: 'muted' };

function positionCounts(record) {
  const counts = { GOALKEEPER: 0, DEFENSE: 0, MIDFIELD: 0, FORWARD: 0 };
  for (const pd of record.position_data || []) {
    if (counts[pd.position] !== undefined) counts[pd.position] = (pd.graduating_senior_names || []).length;
  }
  return counts;
}

function SchoolRow({ college, record, rank }) {
  const [expanded, setExpanded] = useState(false);
  const isStale = record && (record.total_graduating_seniors || 0) > 0 && (record.players || []).length === 0;
  const counts = record ? positionCounts(record) : { GOALKEEPER: 0, DEFENSE: 0, MIDFIELD: 0, FORWARD: 0 };
  const sortedPlayers = record ? [...(record.players || [])].sort((a, b) => (b.minutes_played || 0) - (a.minutes_played || 0)) : [];

  return (
    <div className="border-b border-border last:border-0">
      <button className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30" onClick={() => setExpanded((e) => !e)}>
        <span className="text-xs text-muted-foreground w-8">{rank}</span>
        <span className="flex-1 font-medium truncate">{college.name}</span>
        <Badge>{college.division}</Badge>
        {record && <Badge variant={CONFIDENCE_VARIANT[record.data_confidence] || 'muted'}>{record.data_confidence || 'unknown'}</Badge>}
        {isStale && <Badge variant="red">stale</Badge>}
        <span className="text-xs text-muted-foreground w-24 text-right">{record?.total_graduating_seniors ?? 0} graduating</span>
        <div className="hidden md:flex items-center gap-1">
          {Object.entries(counts).map(([pos, count]) => (
            count > 0 && <Badge key={pos} variant={POSITION_PILL_VARIANT[pos]}>{pos.slice(0, 3)} {count}</Badge>
          ))}
        </div>
        <span className="text-xs text-muted-foreground w-16 text-right">{college.soccer_score != null ? college.soccer_score.toFixed(1) : '—'}</span>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {expanded && (
        <div className="px-4 pb-3 pl-11 space-y-1">
          {sortedPlayers.length === 0 && <p className="text-xs text-muted-foreground italic">No individual roster data yet.</p>}
          {sortedPlayers.map((p) => (
            <div key={p.name} className="flex items-center gap-2 text-xs">
              <Badge variant={POSITION_PILL_VARIANT[p.position] || 'muted'}>{(p.position || 'UNK').slice(0, 3)}</Badge>
              <span className="flex-1">{p.name}</span>
              <span className={(p.minutes_played || 0) >= STARTER_MINUTES_THRESHOLD ? 'text-emerald-600 font-medium' : 'text-muted-foreground'}>
                {p.minutes_played ?? 0} min
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function GraduatingDatabase() {
  const [sport, setSport] = useState('mens-soccer');
  const [colleges, setColleges] = useState([]);
  const [records, setRecords] = useState([]);
  const [division, setDivision] = useState('NCAA D1');
  const [researching, setResearching] = useState(false);
  const [log, setLog] = useState([]);

  async function load() {
    const [c, r] = await Promise.all([
      entities.College.filter({ sport }),
      entities.GraduatingSenior.filter({ sport }),
    ]);
    const sortedColleges = [...c].filter((x) => x.soccer_score != null).sort((a, b) => b.soccer_score - a.soccer_score);
    setColleges(sortedColleges);
    setRecords([...r].sort((a, b) => new Date(b.updated_date) - new Date(a.updated_date)));
  }

  useEffect(() => { load(); }, [sport]);

  const recordMap = useMemo(() => {
    const m = {};
    for (const r of records) m[r.college_name] = r;
    return m;
  }, [records]);

  const perDivision = useMemo(() => {
    const groups = { 'NCAA D1': [], 'NCAA D2': [], 'NCAA D3': [], NAIA: [] };
    for (const c of colleges) {
      const div = normalizeDivision(c.division);
      if (groups[div]) groups[div].push(c);
    }
    return groups;
  }, [colleges]);

  const visible = perDivision[division] || [];

  async function runBatchResearch() {
    const missing = visible.filter((c) => {
      const r = recordMap[c.name];
      return !r || ((r.total_graduating_seniors || 0) > 0 && (r.players || []).length === 0);
    });
    setResearching(true);
    setLog([]);
    for (const c of missing) {
      try {
        const res = await functions.buildGraduatingDatabase({
          college_name: c.name,
          division: c.division,
          website_domain: c.website_domain,
        });
        setLog((prev) => [...prev, { school: c.name, status: res.status }]);
      } catch {
        setLog((prev) => [...prev, { school: c.name, status: 'error' }]);
      }
    }
    setResearching(false);
    load();
  }

  async function handleExport() {
    const blob = await functions.exportGraduatingDatabase({});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'graduating_database_2025.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-heading text-2xl font-bold">Graduating Database</h1>
          <p className="text-sm text-muted-foreground">Roster intelligence — graduating seniors by school and position.</p>
        </div>
        {sport === 'mens-soccer' && (
          <Button variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1.5" /> Export CSV
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SPORTS.map((s) => (
          <Button key={s.id} size="sm" variant={sport === s.id ? 'default' : 'outline'} onClick={() => setSport(s.id)}>
            {s.label}
          </Button>
        ))}
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1.5">
          {DIVISION_TABS.map((d) => (
            <Button key={d} size="sm" variant={division === d ? 'default' : 'outline'} onClick={() => setDivision(d)}>
              {DIVISION_TAB_LABEL[d]} ({perDivision[d]?.length || 0})
            </Button>
          ))}
        </div>
        <Button size="sm" onClick={runBatchResearch} disabled={researching}>
          <PlayCircle className="h-4 w-4 mr-1.5" /> {researching ? 'Researching…' : 'Run Batch Research'}
        </Button>
      </div>

      {log.length > 0 && (
        <Card className="p-3 max-h-40 overflow-y-auto text-xs space-y-1 font-mono">
          {log.map((l, i) => (
            <div key={i}>
              <span className={l.status === 'error' ? 'text-destructive' : l.status === 'cached' ? 'text-muted-foreground' : 'text-emerald-600'}>
                [{l.status}]
              </span>{' '}
              {l.school}
            </div>
          ))}
        </Card>
      )}

      <div className="rounded-xl border border-border">
        {visible.map((c, idx) => (
          <SchoolRow key={c.id} college={c} record={recordMap[c.name]} rank={idx + 1} />
        ))}
        {visible.length === 0 && <p className="p-6 text-sm text-muted-foreground text-center">No schools in this division yet.</p>}
      </div>
    </div>
  );
}
