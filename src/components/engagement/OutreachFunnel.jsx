import React from 'react';
import { Card } from '@/components/ui/card';

const STAGES = [
  { key: 'sent', label: 'Sent' },
  { key: 'qualified', label: 'Qualified view' },
  { key: 'watchedHalf', label: 'Watched >50%' },
  { key: 'returned', label: 'Returned', gold: true },
];

/**
 * Sent -> Qualified view -> Watched >50% -> Returned. Widths are relative to
 * the number sent, so the drop-off is the shape of the thing.
 */
export default function OutreachFunnel({ funnel }) {
  const sent = funnel.sent || 0;

  return (
    <Card className="p-5">
      <h3 className="font-heading text-sm font-semibold mb-4">Outreach funnel</h3>
      <div className="space-y-2.5">
        {STAGES.map(({ key, label, gold }) => {
          const value = funnel[key] || 0;
          const pct = sent > 0 ? (value / sent) * 100 : 0;
          return (
            <div key={key} className="flex items-center gap-3">
              <span className="w-32 shrink-0 text-xs text-muted-foreground">{label}</span>
              <div className="flex-1 h-7 rounded bg-muted/40 overflow-hidden">
                <div
                  className={`h-full rounded transition-all ${gold ? 'bg-primary' : 'bg-muted-foreground/30'}`}
                  style={{ width: `${Math.max(pct, value > 0 ? 3 : 0)}%` }}
                />
              </div>
              <span className={`w-10 shrink-0 text-right font-heading text-sm font-semibold tabular-nums ${gold && value > 0 ? 'text-primary' : ''}`}>
                {value}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
