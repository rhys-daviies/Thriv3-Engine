import React from 'react';
import { Badge } from '@/components/ui/badge';
import { bandPresentation, statusPresentation, programmeView } from '@/lib/matchmakingV2View';

/**
 * WHERE ONE PROGRAMME SITS IN THIS ATHLETE'S UNIVERSE — A9.5 §H.
 *
 * ===========================================================================
 * "#431 OF 824" IS A DIFFERENT STATEMENT FROM "NOT IN THE TOP 100".
 *
 * The second reads as a rejection; the first is what the engine actually
 * established. A rank is a POSITION IN A POPULATION, and a consultant on the
 * phone to a family who asked about a specific school needs the denominator
 * to say anything honest about it. So the denominator is always printed.
 *
 * Neither non-ranked state is ever translated into low fit. They are
 * statements about what Thriv3 holds, and they are rendered with the same
 * words the Matchmaking list uses, from the same vocabulary.
 * ===========================================================================
 */
export default function MatchmakingProgrammeStanding({ standing, name }) {
  if (!standing) return null;

  /** The registry has this school; this athlete's evaluated pool does not. */
  if (!standing.programme) {
    return (
      <div className="rounded-lg border border-border p-3 space-y-1" data-testid="standing-outside-pool">
        <p className="text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">
          This programme is in the registry but is not part of this athlete&rsquo;s evaluated
          universe for this sport, so this ranking says nothing about it either way.
        </p>
      </div>
    );
  }

  const p = programmeView(standing.programme);
  const band = bandPresentation(p.band);
  const state = statusPresentation(p.status);

  return (
    <div className="rounded-lg border border-border p-3 space-y-2" data-testid="standing">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-medium">{p.name}</p>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            {p.division && <Badge variant="muted">{p.division}</Badge>}
            {band && (
              <Badge variant={band.tone} data-testid="standing-band">
                {band.label} <span className="opacity-70 ml-1">{band.range}</span>
              </Badge>
            )}
            {state && (
              <Badge variant={state.tone} data-testid={`standing-state-${p.status}`}>
                {state.label}
              </Badge>
            )}
          </div>
        </div>
        {p.ranked && (
          <div className="shrink-0 text-right">
            {/*
              THE DENOMINATOR, ALWAYS. `rankedCount` is the run's own count of
              ranked programmes, written in the same transaction as the rows.
            */}
            <p className="font-heading text-lg font-bold tabular-nums leading-tight" data-testid="standing-rank">
              #{p.rank} <span className="text-sm font-normal text-muted-foreground">of {standing.rankedCount}</span>
            </p>
            <p className="text-[11px] text-muted-foreground">Pursuit {p.pursuit} · {p.pursuitGradeText}</p>
          </div>
        )}
      </div>

      {state && (
        <div className="space-y-1">
          <p className="text-xs">{state.summary}</p>
          <p className="text-xs text-muted-foreground">{state.note}</p>
        </div>
      )}

      {/*
        The three layers, in the same words the result card uses. A refusal
        prints the ENGINE'S sentence — never a paraphrase written here, which
        is where the A8.2 major inference would re-enter.
      */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {p.layers.map((layer) => (
          <div key={layer.key} className="text-xs">
            <span className="text-muted-foreground">{layer.label}: </span>
            {layer.scoreable
              ? <span className="tabular-nums font-medium">{layer.score}</span>
              : <span className="font-medium text-amber-400">Not established</span>}
            {!layer.scoreable && layer.phrase && (
              <p className="text-muted-foreground mt-0.5 first-letter:uppercase">{layer.phrase}.</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
