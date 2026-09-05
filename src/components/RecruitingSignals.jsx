import React from 'react';
import { recruitingSignalCopyFor } from '@/lib/recruitingSignalsCopy';

/**
 * What we have observed about this programme's recruiting, on the match card.
 *
 * A THIRD CONCERN ON THE CARD, kept apart from the other two on purpose:
 *
 *   Why this score     six weighted criteria, computed in the browser.
 *   Recruiting signals licensed evidence, computed on the server.
 *   Full evidence      the Decision Evidence page, one click away.
 *
 * These rows are NOT the score's justification and must never read as it. The
 * score is six criteria over roster, academics, cost, distance and programme
 * quality; every kind that shares an input or a name with one of those is
 * denied this surface, which is why six of twenty-six kinds reach it. What
 * survives is a demonstrated recruiting pathway — something the score does not
 * look at and cannot see.
 *
 * IT RENDERS NOTHING FAR MORE OFTEN THAN IT RENDERS SOMETHING. Across a sweep
 * of all 1,169 men's programmes for one athlete, 969 — 82.9% — carried no
 * licensed signal at all, and a match card is a scanning surface: twenty "no
 * recruiting signals on file" lines down a page would be twenty rows of noise
 * saying nothing. So zero facts is silence, not an empty state. The observed
 * maximum anywhere is two.
 *
 * IT IS NOT THE DECISION EVIDENCE RENDERER. That one carries six sections,
 * provenance drawers, windows and cohort qualifications, and it is right for a
 * page whose job is to explain. This has one job: say a true thing in a line,
 * or say nothing.
 */

function MissingCopy({ kind }) {
  return (
    <span className="text-amber-600 dark:text-amber-500">
      No signal wording for <code className="font-mono text-[11px]">{kind}</code> yet.
    </span>
  );
}

/**
 * One signal, one evidence object, one row.
 *
 * The row never reaches outside `item`. Copy is looked up by this item's kind
 * and rendered from this item's facts, so every word and every digit in it is
 * attributable to one object — which is what stops a coach's recruiting
 * history and a roster observation from becoming one sentence about a coach
 * who needs a defender.
 */
function SignalRow({ item }) {
  const copy = recruitingSignalCopyFor(item);
  return (
    <li className="text-xs leading-relaxed">
      {copy ? (
        <>
          <span>{copy.line}</span>
          {copy.note && <span className="text-muted-foreground"> {copy.note}</span>}
        </>
      ) : (
        <MissingCopy kind={item.kind} />
      )}
    </li>
  );
}

/**
 * @param {object|null} signals  this programme's signals, from
 *   `recruitingSignalsForCollege`. Three states, and the component treats them
 *   as three:
 *     null                 nothing to render — no answer yet, or an
 *                          unresolved name. Silence.
 *     { unavailable: true} we asked and could not read it. One muted line,
 *                          because a failure that renders as silence would be
 *                          indistinguishable from a programme with no signals.
 *     { facts: [...] }     an answer. Rendered if non-empty, silent if not.
 */
export default function RecruitingSignals({ signals }) {
  if (!signals) return null;

  if (signals.unavailable) {
    return (
      <p className="text-xs text-muted-foreground">Recruiting signals unavailable.</p>
    );
  }

  const facts = signals.facts ?? [];
  if (!facts.length) return null;

  return (
    <section aria-label="Recruiting signals">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        Recruiting signals
      </p>
      {/*
        SERVER ORDER, UNTOUCHED. `matchingSummaryFor` puts leads first and
        breaks ties on registry declaration order, and it is the only thing
        that has seen the licences. Sorting here — by anything, but especially
        by anything that looked stronger — would be a second selection policy
        with no tests behind it.
      */}
      <ul className="space-y-1.5">
        {facts.map((item) => <SignalRow key={item.kind} item={item} />)}
      </ul>
      {/*
        Said once, under the rows, because the rows sit under a score. Without
        it, a reader who has just read six weighted criteria reads these as a
        seventh.
      */}
      <p className="text-[11px] text-muted-foreground mt-2 italic">
        Observed history. Not an input to the score above.
      </p>
    </section>
  );
}
