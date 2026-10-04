import React from 'react';
import GraduatingPlayers from './GraduatingPlayers';

/**
 * THE QUICK PROGRAMME SNAPSHOT — A11.2 §1C, §3.
 *
 * ===========================================================================
 * THE FACTS A CONSULTANT CHECKS BEFORE READING A WORD OF PROSE.
 *
 * Immediately under the three scores and ABOVE "Why this school ranks here",
 * because the order answers a different question from the one the explanation
 * answers. The scores say how this programme rates; the explanation says why;
 * this says what it IS. Someone scanning a hundred cards reads this row and
 * stops or moves on, and on the first real production card it sat below the
 * prose where that was not possible.
 *
 * Three things, named by §3: Program Strength, Academic Rating, and projected
 * departures by position. Conference and net price follow on one muted line —
 * they shipped in A11, they are factual, and deleting information to tidy a
 * layout is not a presentation refinement.
 *
 * -- NOTHING HERE IS COMPUTED -----------------------------------------------
 *
 * Every value arrives decided from the one bounded context read. This chooses
 * layout. In particular the percentile is the server's, measured within the
 * programme's own division; a frontend that derived a percentile from display
 * rank would be inventing one, which A11.1 §1 forbids by name.
 * ===========================================================================
 */

export const NOT_ESTABLISHED = 'Not established';

/**
 * `truncate` is OPT-IN, and Program Strength never takes it.
 *
 * It did at first, and at 375px the cell read "Top 70% in NCAA…". The
 * division is not decoration on that sentence — it is what the percentile is
 * relative to, and A11.1 §1 exists because a strength figure without its
 * division is the national /10 problem in a new costume. A conference name
 * may be clipped; this may not.
 */
function Fact({ label, children, testid, clip = false }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-sm font-medium${clip ? ' truncate' : ''}`} data-testid={testid}>
        {children}
      </p>
    </div>
  );
}

export default function ProgrammeSnapshot({ context, entryYear }) {
  if (!context) return null;

  const { programStrength: strength } = context;

  return (
    <div
      className="rounded-lg border border-border p-3 space-y-2.5"
      data-testid="programme-snapshot"
    >
      {/*
        A11.2 §3. Two across at 375px, four from `sm` up — §9. `truncate` on
        the value keeps a long conference name from widening the card and
        introducing a horizontal scroll.
      */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2" data-testid="programme-context">
        {/*
          PROGRAMME STRENGTH, RELATIVE TO ITS OWN DIVISION — A11.1 §1.

          NOT `soccer_score / 10`. That is a national ladder on which the
          strongest D3 programme in the country scores below the weakest D1
          one, so "4.1/10" on an excellent D3 programme mostly says "is D3".
          The division is named in the sentence, so a reader can check what
          the number is relative to.
        */}
        <Fact label="Program Strength" testid="program-strength">
          {strength ? (
            <>
              Top {strength.topPercent}%
              <span className="text-muted-foreground font-normal">
                {' '}in {strength.division}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{NOT_ESTABLISHED}</span>
          )}
        </Fact>

        {/*
          ACADEMIC RATING STAYS OVER TEN — A11.1 §4. It comes from College
          Scorecard and is not division-dominated the way the soccer ladder
          is, so a /10 here means what a reader assumes it means. An em dash
          where it was never established: an unrated institution and one rated
          zero are different claims and only one of them is ours.
        */}
        <Fact label="Academic Rating" testid="academic-rating">
          {context.academicRating != null ? `${context.academicRating.toFixed(1)}/10` : '—'}
        </Fact>

        <Fact label="Conference" clip>{context.conference || '—'}</Fact>

        <Fact label="Net price">
          <span className="tabular-nums">
            {Number.isFinite(context.netPrice) ? `$${context.netPrice.toLocaleString()}` : '—'}
          </span>
        </Fact>
      </div>

      {/*
        WHO IS LEAVING, BY POSITION — §1C, §3, §4. Inside the snapshot rather
        than in a panel of its own, and above the explanation either way.
        Unknown is never a zero; that component owns the distinction.
      */}
      <GraduatingPlayers context={context} entryYear={entryYear} />
    </div>
  );
}
