import React from 'react';
import { Card } from '@/components/ui/card';
import { formatTimecode } from '@shared/timecode';

const W = 720;
const H = 180;

/**
 * Share of coaches still watching at each point of the reel, with the chapter
 * markers overlaid so a drop-off maps to a specific clip.
 */
export default function RetentionCurve({ retention }) {
  const { points = [], chapters = [], durationSeconds = 0, viewers = 0 } = retention || {};

  if (viewers === 0 || points.length === 0) {
    return (
      <Card className="p-5">
        <h3 className="font-heading text-sm font-semibold mb-1">Film retention</h3>
        <p className="text-xs text-muted-foreground mb-6">
          Where coaches stop watching, across everyone who has opened this reel.
        </p>
        <p className="py-10 text-center text-sm text-muted-foreground">
          No film has been watched yet. The curve appears once a coach plays the reel.
        </p>
      </Card>
    );
  }

  const x = (t) => (durationSeconds ? (t / durationSeconds) * W : 0);
  const y = (pct) => H - (pct / 100) * H;

  // A single viewer is a step function, not a trend. Say so rather than
  // drawing a smooth line through one person's behaviour.
  const single = viewers === 1;

  const area = [
    `M 0 ${H}`,
    ...points.map((p) => `L ${x(p.t).toFixed(1)} ${y(p.pct).toFixed(1)}`),
    `L ${W} ${H}`,
    'Z',
  ].join(' ');

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.t).toFixed(1)} ${y(p.pct).toFixed(1)}`).join(' ');

  // Every chapter gets a marker line, but only label the ones with room —
  // clips bunched at the end of a reel would otherwise print on top of each
  // other and read as one garbled number.
  // Wide enough that a right-edge label, which is drawn leftward from its
  // marker, still cannot reach its neighbour.
  const LABEL_WIDTH = 48;
  let lastLabelX = -Infinity;
  const labelled = new Set();
  for (const [i, c] of [...chapters.entries()].sort((a, b) => a[1].t - b[1].t)) {
    if (x(c.t) - lastLabelX < LABEL_WIDTH) continue;
    lastLabelX = x(c.t);
    labelled.add(i);
  }

  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h3 className="font-heading text-sm font-semibold">Film retention</h3>
        <span className="text-xs text-muted-foreground">
          {viewers} {viewers === 1 ? 'coach' : 'coaches'} · {formatTimecode(durationSeconds)} reel
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        {single
          ? 'One coach so far — this is their watch pattern, not yet a trend.'
          : 'Share of coaches still watching at each point of the reel.'}
      </p>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H + 26}`} className="w-full min-w-[420px]" role="img" aria-label="Film retention curve">
          {[0, 25, 50, 75, 100].map((pct) => (
            <line key={pct} x1="0" x2={W} y1={y(pct)} y2={y(pct)} stroke="hsl(var(--border))" strokeWidth="1" />
          ))}

          {chapters.map((c, i) => (
            <g key={i}>
              <line
                x1={x(c.t)} x2={x(c.t)} y1="0" y2={H}
                stroke="hsl(var(--muted-foreground))" strokeWidth="1" strokeDasharray="3 3" opacity="0.45"
              />
              {/* Flip the label inside the chart once the marker nears the
                  right edge, or it gets clipped by the viewBox. */}
              {labelled.has(i) && (
                <text
                  x={x(c.t) > W - 34 ? x(c.t) - 3 : x(c.t) + 3}
                  textAnchor={x(c.t) > W - 34 ? 'end' : 'start'}
                  y="11" fill="hsl(var(--muted-foreground))" fontSize="9" fontFamily="monospace"
                >
                  {formatTimecode(c.t)}
                </text>
              )}
            </g>
          ))}

          <path d={area} fill="hsl(var(--primary))" opacity="0.12" />
          <path d={line} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinejoin="round" />
          {single && points.map((p, i) => (
            <circle key={i} cx={x(p.t)} cy={y(p.pct)} r="1.6" fill="hsl(var(--primary))" />
          ))}

          <text x="2" y={y(100) + 10} fill="hsl(var(--muted-foreground))" fontSize="9" fontFamily="monospace">100%</text>
          <text x="2" y={H - 3} fill="hsl(var(--muted-foreground))" fontSize="9" fontFamily="monospace">0%</text>
          <text x="0" y={H + 18} fill="hsl(var(--muted-foreground))" fontSize="9" fontFamily="monospace">0:00</text>
          <text x={W - 34} y={H + 18} fill="hsl(var(--muted-foreground))" fontSize="9" fontFamily="monospace">
            {formatTimecode(durationSeconds)}
          </text>
        </svg>
      </div>

      {chapters.length > 0 && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Dashed lines mark labelled clips. A cliff just after one means that clip is losing them.
        </p>
      )}
    </Card>
  );
}
