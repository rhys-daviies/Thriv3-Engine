import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SPORTS } from '@/lib/sports';
import { entities } from '@/api/client';
import { cn } from '@/lib/utils';

const DIVISION_FILTERS = ['All', 'NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA', 'NJCAA'];

export default function Colleges() {
  const [sport, setSport] = useState('mens-soccer');
  const [colleges, setColleges] = useState([]);
  const [search, setSearch] = useState('');
  const [division, setDivision] = useState('All');
  const [sortCol, setSortCol] = useState(null); // 'academic_rating' | 'soccer_score'
  const [sortDir, setSortDir] = useState(null); // 'asc' | 'desc' | null

  useEffect(() => {
    entities.College.filter({ sport }).then(setColleges);
  }, [sport]);

  function toggleSort(col) {
    if (sortCol !== col) {
      setSortCol(col);
      setSortDir('desc');
    } else if (sortDir === 'desc') {
      setSortDir('asc');
    } else if (sortDir === 'asc') {
      setSortCol(null);
      setSortDir(null);
    } else {
      setSortDir('desc');
    }
  }

  const rows = useMemo(() => {
    let list = colleges;
    if (division !== 'All') list = list.filter((c) => c.division === division);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q));
    }
    if (sortCol && sortDir) {
      list = [...list].sort((a, b) => {
        const av = a[sortCol] ?? -Infinity;
        const bv = b[sortCol] ?? -Infinity;
        return sortDir === 'asc' ? av - bv : bv - av;
      });
    } else {
      list = [...list].sort((a, b) => (b.soccer_score ?? -1) - (a.soccer_score ?? -1));
    }
    return list;
  }, [colleges, division, search, sortCol, sortDir]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-bold">College Database</h1>
        <p className="text-sm text-muted-foreground">{rows.length} programs</p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SPORTS.map((s) => (
          <Button key={s.id} size="sm" variant={sport === s.id ? 'default' : 'outline'} onClick={() => setSport(s.id)}>
            {s.label}
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input placeholder="Search school name" className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="flex gap-1.5">
          {DIVISION_FILTERS.map((d) => (
            <Button key={d} size="sm" variant={division === d ? 'default' : 'outline'} onClick={() => setDivision(d)}>
              {d}
            </Button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium text-muted-foreground w-12">#</th>
              <th className="px-4 py-2 font-medium text-muted-foreground">School</th>
              <th className="px-4 py-2 font-medium text-muted-foreground">Division</th>
              <th className="px-4 py-2 font-medium text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort('academic_rating')}>
                <span className="inline-flex items-center gap-1">Academic Score <ArrowUpDown className="h-3 w-3" /></span>
              </th>
              <th className="px-4 py-2 font-medium text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort('soccer_score')}>
                <span className="inline-flex items-center gap-1">Soccer Score <ArrowUpDown className="h-3 w-3" /></span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, idx) => (
              <tr key={c.id} className={cn(idx % 2 === 1 && 'bg-muted/20')}>
                <td className="px-4 py-2 text-muted-foreground">{idx + 1}</td>
                <td className="px-4 py-2 font-medium">{c.name}</td>
                <td className="px-4 py-2"><Badge>{c.division}</Badge></td>
                <td className="px-4 py-2">{c.academic_rating != null ? `${c.academic_rating}/10` : '—'}</td>
                <td className="px-4 py-2">{c.soccer_score != null ? c.soccer_score.toFixed(2) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
