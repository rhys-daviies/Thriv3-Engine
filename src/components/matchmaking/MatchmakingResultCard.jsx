import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Disclosure } from '@/components/ui/Disclosure';
import ProgrammeStatusChips from './ProgrammeStatusChips';
import ProgrammeSnapshot from './ProgrammeSnapshot';
import MatchmakingExplanation from './MatchmakingExplanation';
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
/** The programme's Decision Evidence, opened directly from a V2 card. */
export function decisionEvidenceHref(playerId, programme) {
  const q = new URLSearchParams({ college: programme.name, source: 'v2' });
  if (programme.division) q.set('division', programme.division);
  return `/player/${playerId}/decision?${q.toString()}`;
}

export default function MatchmakingResultCard({
  programme,
  /** Ratings, cost and roster departures, from the page's one bounded read. */
  context = null,
  /** The athlete's relationships and contact history, for the status chips. */
  relationships = null,
  contactByProgramme = null,
  contactKnown = false,
  sport = null,
  entryYear = null,
  /** Asked for only when the card is opened. See `onExpand`. */
  explanation = null,
  explanationState = null,
  onExpand = null,
}) {
  const [open, setOpen] = useState(false);
  const { id: playerId } = useParams();
  const band = bandPresentation(programme.band);
  const state = statusPresentation(programme.status);

  const toggle = (next) => {
    setOpen(next);
    /**
     * LAZY, AND A READ. The explanation is ~3 KB per programme and is only
     * ever read for the card somebody opens, so it is fetched here rather
     * than with the list. Expanding must never WRITE anything — no
     * relationship row, no selection, no observation; see the
     * no-side-effect tests.
     */
    if (next && onExpand) onExpand(programme);
  };

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
          {/*
            WHAT HAS ALREADY HAPPENED WITH THIS SCHOOL — §4, §10.

            The same derivation Specific Schools uses, from the same two
            canonical stores, so a programme that says "Sent" there says
            "Sent" here. Renders nothing at all when there is nothing true
            to say, which is most of a hundred-row list — §12.
          */}
          <ProgrammeStatusChips
            collegeName={programme.name}
            sport={sport}
            relationships={relationships}
            contactByProgramme={contactByProgramme}
            contactKnown={contactKnown}
          />
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
      <Disclosure header={header} open={open} onOpenChange={toggle}>
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

        {/*
          SECOND: THE QUICK PROGRAMME SNAPSHOT — A11.2 §1C, §3.

          Below the three layer readings and ABOVE the explanation, which is
          the order §3 asks for and the order the first real production card
          did not have. Programme strength, academic rating, who is leaving by
          position, then conference and net price. Facts about the institution;
          the layers above are what the ranking is made of, and the prose below
          is why.
        */}
        <ProgrammeSnapshot context={context} entryYear={entryYear} />

        {/* THIRD: the engine's own explanation of this ranking — §7, §8. */}
        {open && explanationState !== 'loading' && (
          <MatchmakingExplanation explanation={explanation} programme={programme} />
        )}
        {open && explanationState === 'loading' && (
          <p className="text-xs text-muted-foreground" data-testid="explanation-loading">
            Loading the explanation for this ranking…
          </p>
        )}

        {/*
          Phase 3: Decision Evidence is off the primary tabs, so each card opens
          it for its own programme. `source=v2` asks that page to show this
          programme even when the previous engine's list never held it; the
          name is the engine's own, encoded whole (Davis & Elkins, Mount St.
          Mary's). Only under a player route - a card rendered anywhere else
          has no athlete to open evidence for.
        */}
        {open && playerId && (
          <Link
            to={decisionEvidenceHref(playerId, programme)}
            className="inline-block text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground"
            data-testid="view-full-evidence"
          >
            View full evidence
          </Link>
        )}
      </Disclosure>
    </Card>
  );
}
