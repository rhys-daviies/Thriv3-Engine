import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Download, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { SPORTS } from '@/lib/sports';
import { normalizeDivision, STARTER_MINUTES_THRESHOLD, PROJECTED_STARTER_MINUTES, POSITION_PILL_VARIANT, CURRENT_ROSTER_SEASON, ROSTER_SEASON_IN_PROGRESS } from '@/lib/divisions';
import { entities, functions } from '@/api/client';

const DIVISION_ORDER = ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA', 'NJCAA', 'Other'];
const DIVISION_TAB_LABEL = { 'NCAA D1': 'D1', 'NCAA D2': 'D2', 'NCAA D3': 'D3', NAIA: 'NAIA', NJCAA: 'NJCAA', Other: 'Other' };
const CONFIDENCE_VARIANT = { high: 'green', medium: 'amber', low: 'muted' };
const POSITION_ORDER = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];

function majorityConfidence(rows) {
  const counts = {};
  for (const r of rows) counts[r.data_confidence] = (counts[r.data_confidence] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** New model: one row per rostered player, tagged with their own estimated_graduation_year. */
function RosterSchoolRow({ collegeName, players, rank }) {
  const [expanded, setExpanded] = useState(false);
  const counts = { GOALKEEPER: 0, DEFENSE: 0, MIDFIELD: 0, FORWARD: 0 };
  for (const p of players) if (counts[p.position] !== undefined) counts[p.position]++;
  // Sort on whichever figure exists, so a projection still orders the list.
  // Sorting on minutes_played alone left every 2026 row tied at zero.
  const sortedPlayers = [...players].sort(
    (a, b) => (b.minutes_played ?? b.projected_minutes ?? -1) - (a.minutes_played ?? a.projected_minutes ?? -1)
  );
  const confidence = majorityConfidence(players);

  return (
    <div className="border-b border-border last:border-0">
      <button className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30" onClick={() => setExpanded((e) => !e)}>
        <span className="text-xs text-muted-foreground w-8">{rank}</span>
        <span className="flex-1 font-medium truncate">{collegeName}</span>
        {confidence && <Badge variant={CONFIDENCE_VARIANT[confidence] || 'muted'}>{confidence}</Badge>}
        <span className="text-xs text-muted-foreground w-24 text-right">{players.length} graduating</span>
        <div className="hidden md:flex items-center gap-1">
          {POSITION_ORDER.map((pos) => counts[pos] > 0 && (
            <Badge key={pos} variant={POSITION_PILL_VARIANT[pos]}>{pos.slice(0, 3)} {counts[pos]}</Badge>
          ))}
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>
      {expanded && (
        <div className="px-4 pb-3 pl-11 space-y-1">
          {sortedPlayers.map((p) => (
            <div key={p.id} className="flex items-center gap-2 text-xs">
              <Badge variant={POSITION_PILL_VARIANT[p.position] || 'muted'}>{(p.position || 'UNK').slice(0, 3)}</Badge>
              <span className="flex-1">{p.player_name}</span>
              {p.class_year_label && <span className="text-muted-foreground">{p.class_year_label}</span>}
              <MinutesCell minutes={p.minutes_played} projected={p.projected_minutes} projectedSeason={p.projected_minutes_season}
                            priorProgramme={p.prior_programme} school={p.college_name} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Legacy model (field hockey / ice hockey / volleyball — no roster_players data yet): unchanged. */
function legacyPositionCounts(record) {
  const counts = { GOALKEEPER: 0, DEFENSE: 0, MIDFIELD: 0, FORWARD: 0 };
  for (const pd of record.position_data || []) {
    if (counts[pd.position] !== undefined) counts[pd.position] = (pd.graduating_senior_names || []).length;
  }
  return counts;
}

function LegacySchoolRow({ college, record, rank }) {
  const [expanded, setExpanded] = useState(false);
  const isStale = record && (record.total_graduating_seniors || 0) > 0 && (record.players || []).length === 0;
  const counts = record ? legacyPositionCounts(record) : { GOALKEEPER: 0, DEFENSE: 0, MIDFIELD: 0, FORWARD: 0 };
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
              <MinutesCell minutes={p.minutes_played} projected={p.projected_minutes} projectedSeason={p.projected_minutes_season}
                            priorProgramme={p.prior_programme} school={p.college_name} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Playing time in three states, because they mean different things and the view
 * used to show all of them as a grey "0 min".
 *
 *   played      a real figure from this season      emerald when it clears 600
 *   projected   LAST season's figure, carried       amber, italic, "~" prefixed
 *   unknown     neither                             dimmed dash
 *
 * The projection is never dressed up as current data. It gets its own colour,
 * a tilde, and a tooltip naming the season it came from, because the operator
 * emailing a coach needs to know which numbers are evidence and which are an
 * inference — a coach's roster has visibly changed since last season.
 */
function MinutesCell({ minutes, projected, projectedSeason, priorProgramme, school }) {
  if (minutes != null) {
    const starter = minutes >= STARTER_MINUTES_THRESHOLD;
    return (
      <span
        className={starter ? 'text-emerald-400 font-medium w-24 text-right' : 'text-muted-foreground w-24 text-right'}
        title={`${minutes} minutes played in the ${CURRENT_ROSTER_SEASON} season.`}
      >
        {minutes} min
      </span>
    );
  }
  if (projected != null) {
    const starter = projected >= PROJECTED_STARTER_MINUTES;
    return (
      <span
        className={starter ? 'text-amber-400/90 font-medium italic w-24 text-right' : 'text-muted-foreground/70 italic w-24 text-right'}
        title={`Not ${CURRENT_ROSTER_SEASON} data. This is ${projected} minutes from the ${projectedSeason} season, `
          + `carried forward because ${CURRENT_ROSTER_SEASON} has not been played yet. `
          + `${starter ? `Projected starter (${PROJECTED_STARTER_MINUTES}+ last season predicts a 600+ season with about 80% precision).` : 'Not projected as a starter.'}`}
      >
        ~{projected} min
      </span>
    );
  }
  // A dash has three quite different causes, and which one it is matters to
  // whoever is about to write to the coach. Saying "transferred in from
  // Florida Atlantic" beats an unexplained blank, and beats inventing a figure:
  // minutes earned at another programme predict a starting place here only
  // 54.9% of the time, against 77.4% for a player who stayed, so they are
  // recorded as provenance and never carried forward.
  const transferred = priorProgramme && priorProgramme !== school;
  const title = transferred
    ? `Transferred in from ${priorProgramme}. Their ${priorProgramme} minutes are not carried forward — `
      + 'a figure earned at another programme is a much weaker guide to starting here (about 55% reliable, '
      + 'against 77% for a player who stayed), so starter status is unknown.'
    : priorProgramme
      ? `On this roster last season too, but that page published no minutes, so starter status is unknown.`
      : `Not on any ${Number(CURRENT_ROSTER_SEASON) - 1} roster — new to college soccer, or their previous programme `
        + 'was not captured. Starter status is unknown.';
  return (
    <span className="text-muted-foreground/50 italic w-24 text-right" title={title}>
      {transferred ? 'transfer' : '— min'}
    </span>
  );
}

export default function GraduatingDatabase() {
  const [sport, setSport] = useState('mens-soccer');
  const [colleges, setColleges] = useState([]);
  const [records, setRecords] = useState([]);
  const [rosterRows, setRosterRows] = useState([]);
  const [division, setDivision] = useState(null);
  const [year, setYear] = useState(null);
  const [researching, setResearching] = useState(false);
  const [log, setLog] = useState([]);

  async function load() {
    const [c, r, rp] = await Promise.all([
      entities.College.filter({ sport }),
      entities.GraduatingSenior.filter({ sport }),
      entities.RosterPlayer.filter({ sport, season: CURRENT_ROSTER_SEASON }),
    ]);
    const sortedColleges = [...c].filter((x) => x.soccer_score != null).sort((a, b) => b.soccer_score - a.soccer_score);
    setColleges(sortedColleges);
    setRecords([...r].sort((a, b) => new Date(b.updated_date) - new Date(a.updated_date)));
    setRosterRows(rp);
  }

  useEffect(() => { load(); setDivision(null); setYear(null); }, [sport]);

  // ---- New model (Sport -> Estimated Graduation Year -> Division -> School -> Players) ----
  const hasRosterData = rosterRows.length > 0;

  // Derived from the data, not from ROSTER_SEASON_IN_PROGRESS. That constant is
  // a hardcoded true and someone would have to remember to flip it the day real
  // minutes land — at which point the banner would keep announcing "no minutes
  // played yet" over a screen full of them. The rows themselves know.
  const awaitingMinutes = hasRosterData && !rosterRows.some((r) => r.minutes_played != null);

  const availableYears = useMemo(() => {
    const years = new Set(rosterRows.map((r) => r.estimated_graduation_year).filter(Boolean));
    return [...years].sort((a, b) => a - b);
  }, [rosterRows]);

  // Default to the cohort leaving after the pinned season, not the earliest
  // year on record. availableYears[0] put the operator on a near-empty bucket
  // of stragglers -- the whole point of the view is who to email about the
  // players about to leave.
  const defaultYear = Number(CURRENT_ROSTER_SEASON) + 1;
  const activeYear = year ?? (availableYears.includes(defaultYear) ? defaultYear : availableYears[0]) ?? null;

  const rowsForYear = useMemo(
    () => rosterRows.filter((r) => r.estimated_graduation_year === activeYear),
    [rosterRows, activeYear]
  );

  const availableDivisions = useMemo(() => {
    const divs = new Set(rowsForYear.map((r) => r.division).filter(Boolean));
    return DIVISION_ORDER.filter((d) => divs.has(d));
  }, [rowsForYear]);

  const activeDivision = division ?? availableDivisions[0] ?? null;

  const schoolCountByDivision = useMemo(() => {
    const counts = {};
    for (const d of availableDivisions) {
      counts[d] = new Set(rowsForYear.filter((r) => r.division === d).map((r) => r.college_name)).size;
    }
    return counts;
  }, [rowsForYear, availableDivisions]);

  const schoolsForDivision = useMemo(() => {
    const bySchool = new Map();
    for (const r of rowsForYear) {
      if (r.division !== activeDivision) continue;
      if (!bySchool.has(r.college_name)) bySchool.set(r.college_name, []);
      bySchool.get(r.college_name).push(r);
    }
    return [...bySchool.entries()]
      .map(([collegeName, players]) => ({ collegeName, players }))
      .sort((a, b) => b.players.length - a.players.length || a.collegeName.localeCompare(b.collegeName));
  }, [rowsForYear, activeDivision]);

  // ---- Legacy model (sports with no roster_players data yet) ----
  const recordMap = useMemo(() => {
    const m = {};
    for (const r of records) m[r.college_name] = r;
    return m;
  }, [records]);

  const legacyPerDivision = useMemo(() => {
    const groups = { 'NCAA D1': [], 'NCAA D2': [], 'NCAA D3': [], NAIA: [] };
    for (const c of colleges) {
      const div = normalizeDivision(c.division);
      if (groups[div]) groups[div].push(c);
    }
    return groups;
  }, [colleges]);

  const legacyVisible = legacyPerDivision[activeDivision] || legacyPerDivision['NCAA D1'] || [];

  async function runBatchResearch() {
    const missing = legacyVisible.filter((c) => {
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
          <p className="text-sm text-muted-foreground">Roster intelligence — every rostered player, by graduation year and position.</p>
          {awaitingMinutes && (
            // Stated up front rather than left to a tooltip: an operator about
            // to email a coach should not have to hover to find out that the
            // playing time on screen is last season's.
            <p className="text-xs text-amber-400/90 mt-1.5">
              {CURRENT_ROSTER_SEASON} season in progress — no minutes played yet.
              Figures marked <span className="italic">~like this</span> are carried forward from the previous
              season as a projection, not {CURRENT_ROSTER_SEASON} data.
              <span className="italic"> transfer</span> and <span className="italic">— min</span> mean starter status
              is unknown; hover either for the reason.
            </p>
          )}
        </div>
        {!hasRosterData && sport === 'mens-soccer' && (
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

      {hasRosterData ? (
        <>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estimated Graduation Year</p>
            <div className="flex flex-wrap gap-1.5">
              {availableYears.map((y) => (
                <Button key={y} size="sm" variant={activeYear === y ? 'default' : 'outline'} onClick={() => { setYear(y); setDivision(null); }}>
                  {y}
                </Button>
              ))}
            </div>
          </div>

          <div className="flex gap-1.5">
            {availableDivisions.map((d) => (
              <Button key={d} size="sm" variant={activeDivision === d ? 'default' : 'outline'} onClick={() => setDivision(d)}>
                {DIVISION_TAB_LABEL[d]} ({schoolCountByDivision[d] || 0})
              </Button>
            ))}
          </div>

          <div className="rounded-xl border border-border">
            {schoolsForDivision.map((s, idx) => (
              <RosterSchoolRow key={s.collegeName} collegeName={s.collegeName} players={s.players} rank={idx + 1} />
            ))}
            {schoolsForDivision.length === 0 && <p className="p-6 text-sm text-muted-foreground text-center">No schools in this division yet.</p>}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex gap-1.5">
              {['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA'].map((d) => (
                <Button key={d} size="sm" variant={activeDivision === d ? 'default' : 'outline'} onClick={() => setDivision(d)}>
                  {DIVISION_TAB_LABEL[d]} ({legacyPerDivision[d]?.length || 0})
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
                  <span className={l.status === 'error' ? 'text-destructive' : l.status === 'cached' ? 'text-muted-foreground' : 'text-emerald-400'}>
                    [{l.status}]
                  </span>{' '}
                  {l.school}
                </div>
              ))}
            </Card>
          )}

          <div className="rounded-xl border border-border">
            {legacyVisible.map((c, idx) => (
              <LegacySchoolRow key={c.id} college={c} record={recordMap[c.name]} rank={idx + 1} />
            ))}
            {legacyVisible.length === 0 && <p className="p-6 text-sm text-muted-foreground text-center">No schools in this division yet.</p>}
          </div>
        </>
      )}
    </div>
  );
}
