import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Disclosure } from '@/components/ui/Disclosure';
import { cn } from '@/lib/utils';
import {
  bandPresentation, statusPresentation, PRECISION_NOTE,
} from '@/lib/matchmakingV2View';

/**
 * A score, as a labelled meter — the idiom `ScoreBreakdown` already uses on
 * the V1 card, so a V2 row does not read as a different product.
 *
 * The number is `aria-hidden`-free and printed as text beside the bar: §S
 * forbids carrying a value in a bar's width alone, and a screen reader gets
 * the same sentence a sighted reader does.
 */
function LayerMeter({ layer }) {
  if (!layer.scoreable) {
    return (
      <div className="text-xs">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-muted-foreground">{layer.label}</span>
          <span className="font-medium text-amber-400">Not established</span>
        </div>
        {/*
          THE ENGINE'S OWN SENTENCE, verbatim — never a frontend paraphrase.
          `refusalPhrase` is where A8.2's positive-only major wording lives; a
          summary written here is exactly where "does not offer" would return.
        */}
        {/*
          Sentence-cased in CSS, not in JavaScript.

          The engine's phrases are CLAUSES, written to sit after "because":
          some begin "Thriv3 holds no..." and some begin "this programme
          carries...". Rendered as standalone sentences the lowercase ones read
          as typos. Capitalising the STRING would break the identity the
          wording tests rely on — they assert the rendered text IS
          `REFUSAL_PHRASE[code]`, which is what stops a paraphrase creeping in.
          `first-letter:uppercase` changes the glyph and not the text node, so
          both hold.
        */}
        {layer.phrase && (
          <p className="text-muted-foreground mt-0.5 first-letter:uppercase">{layer.phrase}.</p>
        )}
      </div>
    );
  }
  return (
    <div className="text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground">{layer.label}</span>
        <span className="tabular-nums font-medium">{layer.score}</span>
      </div>
      <span className="mt-1 block h-1.5 rounded-full bg-muted overflow-hidden">
        <span
          className={cn('block h-full rounded-full', layer.grade === 'MEASURED' ? 'bg-primary' : 'bg-primary/60')}
          style={{ width: `${layer.score}%` }}
        />
      </span>
      <p className="text-muted-foreground mt-0.5">
        {layer.gradeText}
        {/*
          Coverage only where it is short of full — see `layerView`. A layer
          scored over two thirds of its question is a materially weaker claim
          than one scored over all of it, and that difference is the thing
          worth a consultant's attention.
        */}
        {layer.coverage !== null && ` · ${Math.round(layer.coverage * 100)}% of this layer's evidence available`}
      </p>
    </div>
  );
}

/**
 * ONE PROGRAMME IN A RUN.
 *
 * ===========================================================================
 * THREE STATES, AND ONLY ONE OF THEM IS A RANK — §H, §J, §K.
 *
 *   RANKED                    a rank, a band, a Pursuit score, three layers
 *   SUPPORTED_LIMITED_DATA    no rank; what Thriv3 is missing, in its words
 *   UNSUPPORTED_ASSOCIATION   no rank; that Thriv3 holds no rules here
 *
 * The two non-ranked states are given DIFFERENT words, a different chip and a
 * different border, because they are different facts and an operator who reads
 * them as one will read both as "worse than ranked". Neither is.
 *
 * Nothing in this component computes. Rank, band, score and reason all arrive
 * decided; it chooses layout.
 * ===========================================================================
 */
export default function MatchmakingResultCard({ programme }) {
  const band = bandPresentation(programme.band);
  const state = statusPresentation(programme.status);

  const header = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {/*
            EXACT RANK, KEPT USEFUL AND KEPT SECOND — §F / §N. The band chip
            beside it carries the heavier weight, because the band is the claim
            Thriv3 can defend and the integer is a position in a list.
          */}
          {programme.ranked && (
            <span className="shrink-0 tabular-nums text-sm font-semibold text-muted-foreground">
              #{programme.rank}
            </span>
          )}
          <p className="font-heading font-semibold truncate">{programme.name}</p>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          {programme.division && <Badge variant="muted">{programme.division}</Badge>}
          {/*
            THE BAND CARRIES ITS OWN WORDS AND ITS OWN RANGE — §S. The colour
            is a second signal, never the only one; "Priority outreach 1–25"
            reads identically in monochrome, in a screen reader, and printed.
          */}
          {band && (
            <Badge variant={band.tone} data-testid="band-chip">
              {band.label} <span className="opacity-70 ml-1">{band.range}</span>
            </Badge>
          )}
          {state && (
            <Badge variant={state.tone} data-testid={`state-chip-${programme.status}`}>
              {state.label}
            </Badge>
          )}
        </div>
      </div>
      {programme.ranked && (
        <div className="shrink-0 text-right">
          <p className="text-xs text-muted-foreground">Pursuit</p>
          <p className="font-heading text-xl font-bold tabular-nums leading-tight">{programme.pursuit}</p>
          <p className="text-[11px] text-muted-foreground">{programme.pursuitGradeText}</p>
        </div>
      )}
    </div>
  );

  return (
    <Card
      className={cn(
        'p-4',
        /* A left rule distinguishes the two non-ranked states from each other
           AND from a ranked row, without either of them borrowing the colour
           of a band. */
        programme.status === 'SUPPORTED_LIMITED_DATA' && 'border-l-[3px] border-l-amber-500/60',
        programme.status === 'UNSUPPORTED_ASSOCIATION' && 'border-l-[3px] border-l-muted-foreground/40',
      )}
      data-testid={`programme-${programme.status}`}
    >
      <Disclosure header={header}>
        {/*
          WHY THRIV3 RANKED IT HERE — §I.

          Three layer readings and the engine's refusal sentences. No weights,
          no basis objects, no coverage arithmetic, no calibration: a
          consultant needs to say something true to a family, not to reproduce
          the computation.
        */}
        {state && (
          <div className="rounded-lg border border-border p-3 space-y-1">
            <p className="text-xs">{state.summary}</p>
            <p className="text-xs text-muted-foreground">{state.note}</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {programme.layers.map((layer) => <LayerMeter key={layer.key} layer={layer} />)}
        </div>

        {programme.ranked && (
          <p className="text-[11px] text-muted-foreground italic">{PRECISION_NOTE}</p>
        )}
      </Disclosure>
    </Card>
  );
}
