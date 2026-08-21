import React from 'react';
import { Card } from '@/components/ui/card';
import { formatTimecode } from '@shared/timecode';

/** Which labelled clips coaches jump to, ranked — what they evaluate for. */
export default function ChapterEngagement({ chapters, athleteHasChapters = true }) {
  if (!chapters || chapters.length === 0) {
    return (
      <Card className="p-5">
        <h3 className="font-heading text-sm font-semibold mb-1">Chapter engagement</h3>
        <p className="py-8 text-center text-sm text-muted-foreground">
          {/* "Nobody jumped to a clip" and "there are no clips" are different
              things, and reading the second as the first looks like a fault. */}
          {athleteHasChapters
            ? 'No coach has jumped to a clip yet.'
            : 'This reel has no labelled chapters, so there is nothing for a coach to jump to. Add them on the Profile tab if the film is long enough to need navigating.'}
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
                {formatTimecode(c.t)}
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
