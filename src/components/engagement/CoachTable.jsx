import React from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Gold is reserved for Priority and Responded, and for the return-visit
// indicator. Everything else stays charcoal.
const TIER_STYLE = {
  responded: 'border-primary text-primary bg-primary/10',
  priority: 'border-primary text-primary bg-primary/10',
  hot: 'border-border text-foreground',
  warm: 'border-border text-muted-foreground',
  cold: 'border-border text-muted-foreground',
};

function relativeDate(iso) {
  if (!iso) return '—';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function CoachTable({ coaches, onSelect, onToggleResponded, busyId }) {
  if (!coaches || coaches.length === 0) {
    return (
      <Card className="p-5">
        <h3 className="font-heading text-sm font-semibold mb-1">Coaches</h3>
        <p className="py-8 text-center text-sm text-muted-foreground">
          No outreach has been created for this athlete yet.
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <h3 className="font-heading text-sm font-semibold mb-4">Coaches</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="pb-2 pr-3 font-medium">Coach</th>
              <th className="pb-2 pr-3 font-medium">School</th>
              <th className="pb-2 pr-3 font-medium">Div</th>
              <th className="pb-2 pr-3 font-medium text-right">Score</th>
              <th className="pb-2 pr-3 font-medium">Tier</th>
              <th className="pb-2 pr-3 font-medium text-right">Views</th>
              <th className="pb-2 pr-3 font-medium text-right">Best cov.</th>
              <th className="pb-2 pr-3 font-medium text-right">Rewinds</th>
              <th className="pb-2 pr-3 font-medium">Last seen</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {coaches.map((c) => {
              const returned = c.qualified_visits >= 2;
              return (
                <tr
                  key={c.outreach_id}
                  onClick={() => onSelect(c)}
                  className="border-t border-border/60 cursor-pointer hover:bg-muted/30"
                >
                  <td className="py-2.5 pr-3 font-medium whitespace-nowrap">{c.coach_name || '—'}</td>
                  <td className="py-2.5 pr-3 text-muted-foreground whitespace-nowrap">{c.school || '—'}</td>
                  <td className="py-2.5 pr-3 text-muted-foreground whitespace-nowrap text-xs">
                    {(c.division || '').replace('NCAA Division ', 'D') || '—'}
                  </td>
                  <td className="py-2.5 pr-3 text-right font-heading font-semibold tabular-nums">{c.engagement_score}</td>
                  <td className="py-2.5 pr-3">
                    <span className={cn('inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider', TIER_STYLE[c.tier])}>
                      {c.tier}
                    </span>
                  </td>
                  <td className={cn('py-2.5 pr-3 text-right tabular-nums', returned && 'text-primary font-semibold')}>
                    {c.qualified_visits}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">{c.best_coverage_pct}%</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">{c.total_rewinds}</td>
                  <td className="py-2.5 pr-3 text-muted-foreground whitespace-nowrap text-xs">{relativeDate(c.last_qualified_at)}</td>
                  <td className="py-2.5 text-right whitespace-nowrap">
                    <Button
                      size="sm"
                      variant={c.responded_at ? 'default' : 'outline'}
                      disabled={busyId === c.outreach_id}
                      onClick={(e) => { e.stopPropagation(); onToggleResponded(c); }}
                    >
                      {c.responded_at ? 'Responded' : 'Mark responded'}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Views counts qualified visits only — sessions where a human demonstrably watched or interacted.
      </p>
    </Card>
  );
}
