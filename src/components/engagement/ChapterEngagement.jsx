import React from 'react';
import { Card } from '@/components/ui/card';

function timecode(seconds) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

/** Which labelled clips coaches jump to, ranked — what they evaluate for. */
export default function ChapterEngagement({ chapters }) {
  if (!chapters || chapters.length === 0) {
    return (
      <Card className="p-5">
        <h3 className="font-heading text-sm font-semibold mb-1">Chapter engagement</h3>
        <p className="py-8 text-center text-sm text-muted-foreground">
          No coach has jumped to a clip yet.
        </p>
      </Card>
    );
  }

  const most = Math.max(...chapters.map((c) => c.jumps));

  return (
    <Card className="p-5">
      <h3 className="font-heading text-sm font-semibold mb-1">Chapter engagement</h3>
      <p className="text-xs text-muted-foreground mb-4">Clips coaches choose to watch, most first.</p>
      <div className="space-y-2">
        {chapters.map((c) => (
          <div key={c.label} className="flex items-center gap-3">
            {c.t != null && (
              <span className="w-10 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                {timecode(c.t)}
              </span>
            )}
            <span className="flex-1 min-w-0 truncate text-sm">{c.label}</span>
            <div className="w-24 shrink-0 h-1.5 rounded bg-muted/40 overflow-hidden">
              <div className="h-full bg-muted-foreground/50 rounded" style={{ width: `${(c.jumps / most) * 100}%` }} />
            </div>
            <span className="w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
              {c.jumps} · {c.coaches} {c.coaches === 1 ? 'coach' : 'coaches'}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}
