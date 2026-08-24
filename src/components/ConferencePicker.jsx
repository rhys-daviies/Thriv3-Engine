import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

/**
 * Conferences grouped under the division they belong to, one collapsible
 * section each.
 *
 * A flat list of every conference across every selected division runs to well
 * over a hundred checkboxes with nothing to say which division any of them is
 * in — the one piece of context that decides whether an athlete cares. Grouped
 * and collapsed, the page shows five rows until somebody asks for more.
 *
 * Selection is still a flat list of conference names, because that is what
 * `preferred_conferences` has always been and what matching filters on. Five
 * names appear in two divisions each (WHAC, Mid-South, Golden State, CCAC and
 * AMC all span NCAA D2 and NAIA), so ticking one of those ticks it everywhere
 * it appears. That is the data model rather than a bug, and the affected rows
 * say so instead of looking broken.
 */
export default function ConferencePicker({ divisions, colleges, value, onChange, loading }) {
  const groups = useMemo(() => {
    const byDivision = new Map();
    for (const c of colleges) {
      if (!c.conference || !divisions.includes(c.division)) continue;
      if (!byDivision.has(c.division)) byDivision.set(c.division, new Set());
      byDivision.get(c.division).add(c.conference);
    }
    // Follow the order the athlete picked their divisions in, not insertion
    // order, so the sections do not reshuffle as colleges load.
    return divisions
      .filter((d) => byDivision.has(d))
      .map((division) => ({
        division,
        conferences: Array.from(byDivision.get(division)).sort((a, b) => a.localeCompare(b)),
      }));
  }, [colleges, divisions]);

  /** Conference name -> every division it appears in, for the shared-name note. */
  const sharedWith = useMemo(() => {
    const map = new Map();
    for (const { division, conferences } of groups) {
      for (const conf of conferences) {
        if (!map.has(conf)) map.set(conf, []);
        map.get(conf).push(division);
      }
    }
    return map;
  }, [groups]);

  // One division selected means the athlete is already narrow, so open it.
  // Several means a long page, so start collapsed and let them choose.
  const [open, setOpen] = useState(() => (groups.length === 1 ? { [groups[0].division]: true } : {}));

  const selected = useMemo(() => new Set(value || []), [value]);
  // Deduplicated: five names appear under two divisions, so a flat concat
  // would total 90 where there are only 85 distinct conferences to pick, and
  // the summary would never reach "all selected".
  const all = useMemo(() => Array.from(new Set(groups.flatMap((g) => g.conferences))), [groups]);
  const allSelected = all.length > 0 && all.every((c) => selected.has(c));

  function setMany(names, on) {
    const next = new Set(selected);
    for (const n of names) { if (on) next.add(n); else next.delete(n); }
    onChange(Array.from(next));
  }

  if (loading) return <p className="text-xs text-muted-foreground italic">Loading conferences…</p>;
  if (!groups.length) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {selected.size === 0
            ? 'None selected — every conference in your divisions is considered.'
            : `${selected.size} of ${all.length} selected.`}
        </p>
        <button
          type="button"
          onClick={() => setMany(all, !allSelected)}
          className="text-xs font-medium text-primary hover:underline shrink-0"
        >
          {allSelected ? 'Clear all' : 'Select all'}
        </button>
      </div>

      <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
        {groups.map(({ division, conferences }) => {
          const chosen = conferences.filter((c) => selected.has(c));
          const isOpen = !!open[division];
          const allInDivision = chosen.length === conferences.length;
          return (
            <div key={division}>
              <div className="flex items-center gap-2 px-3 py-2.5 bg-card">
                <button
                  type="button"
                  onClick={() => setOpen((o) => ({ ...o, [division]: !o[division] }))}
                  aria-expanded={isOpen}
                  className="flex flex-1 items-center gap-2 text-left min-w-0"
                >
                  {isOpen
                    ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                  <span className="text-sm font-medium">{division}</span>
                  <span className="text-xs text-muted-foreground truncate">
                    {chosen.length === 0
                      ? `${conferences.length} conferences`
                      : `${chosen.length} of ${conferences.length} selected`}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setMany(conferences, !allInDivision)}
                  className="shrink-0 text-xs font-medium text-primary hover:underline"
                >
                  {allInDivision ? 'Clear' : 'Select all'}
                </button>
              </div>

              {isOpen && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 bg-muted/30 px-3 py-3">
                  {conferences.map((conf) => {
                    const shared = (sharedWith.get(conf) || []).length > 1;
                    return (
                      <label key={conf} className="flex items-start gap-2 text-sm cursor-pointer">
                        <Checkbox
                          className="mt-0.5"
                          checked={selected.has(conf)}
                          onCheckedChange={() => setMany([conf], !selected.has(conf))}
                        />
                        <span className={cn('min-w-0', shared && 'flex items-center gap-1')}>
                          {conf}
                          {shared && (
                            <span
                              title={`Also a conference in ${sharedWith.get(conf).filter((d) => d !== division).join(', ')} — selecting it here selects it there too.`}
                              className="text-muted-foreground"
                            >
                              <Info className="h-3 w-3" />
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
