import React, { useState } from 'react';
import { Button } from '@/components/ui/button';

/**
 * WHO IS LEAVING, BY POSITION — A11 §6.
 *
 * ===========================================================================
 * A ZERO AND A SILENCE ARE DIFFERENT FACTS, AND THIS IS THE SURFACE WHERE
 * CONFUSING THEM DOES THE MOST DAMAGE.
 *
 * "No goalkeepers are leaving" is a reason to look elsewhere. "We cannot read
 * this roster" is a reason to go and look. Rendering both as `0` tells a
 * family the first when the truth is the second, and they would act on it.
 *
 * So every position carries a STATE from the server and this component
 * renders the state, never the bare number:
 *
 *   MEASURED               the count is real, including when it is zero
 *   NO_ROSTER              we hold no roster for this programme
 *   NO_ELIGIBILITY_RULE    no eligibility rule on file for the association,
 *                          so "when does eligibility end" has no answer
 *   INSUFFICIENT_EVIDENCE  rows exist but too few could be read
 *
 * The last three print "Not established", never 0.
 *
 * -- WHAT "GRADUATING" MEANS HERE -------------------------------------------
 *
 * Places that ELIGIBILITY vacates for the athlete's entry year — not players
 * labelled "senior". A Division I senior listed in 2026 has a year of the
 * five-year window left and is not an opening for 2027; a Division III senior
 * is. This is the same evidence Athlete Opportunity scores, read through the
 * same function, so the list and the score cannot disagree.
 *
 * -- WHY TWO NUMBERS --------------------------------------------------------
 *
 * `openings` is every place vacated; `vacatedStarters` is those that were
 * STARTING places, and only that one is scored. A squad player leaving does
 * not open a place anyone held, so showing only the larger number would
 * overstate what is available.
 * ===========================================================================
 */

const POSITION_LABEL = Object.freeze({
  GOALKEEPER: 'Goalkeepers',
  DEFENSE: 'Defenders',
  MIDFIELD: 'Midfielders',
  FORWARD: 'Forwards',
});

const ORDER = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];

export const NOT_ESTABLISHED = 'Not established';

/** Why we cannot say, in words about Thriv3 rather than about the programme. */
export const STATE_NOTE = Object.freeze({
  NO_ROSTER: 'Thriv3 holds no roster for this programme, so departures cannot be counted.',
  NO_ELIGIBILITY_RULE: 'Thriv3 holds no eligibility rule for this association, so when a player’s eligibility ends cannot be established.',
  INSUFFICIENT_EVIDENCE: 'Too few rows at this position could be read to count departures honestly.',
});

function Count({ cell }) {
  if (!cell || cell.state !== 'MEASURED') {
    return <span className="text-muted-foreground">{NOT_ESTABLISHED}</span>;
  }
  return (
    <span className="tabular-nums">
      {cell.openings}
      {cell.openings > 0 && (
        <span className="text-muted-foreground">
          {' '}({cell.vacatedStarters} starting)
        </span>
      )}
    </span>
  );
}

export default function GraduatingPlayers({ context, entryYear }) {
  const [open, setOpen] = useState(false);

  if (!context?.departures) return null;
  const d = context.departures;

  /** Anything we could not establish anywhere is said once, not four times. */
  const unknownStates = [...new Set(
    ORDER.map((p) => d[p]?.state).filter((s) => s && s !== 'MEASURED'),
  )];

  const anyNames = context.departingPlayers
    && ORDER.some((p) => (context.departingPlayers[p] ?? []).length > 0);

  return (
    <div className="rounded-lg border border-border p-3 space-y-2" data-testid="graduating-players">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className="text-xs font-medium">
          Places opening for {entryYear ?? 'the entry year'}
        </p>
        <p className="text-[11px] text-muted-foreground">by eligibility, not class label</p>
      </div>

      {/*
        A two-column grid at 375px and four across from `sm` up, so the counts
        collapse gracefully rather than overflowing — §12.
      */}
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {ORDER.map((pos) => (
          <div key={pos} data-testid={`graduating-${pos}`}>
            <dt className="text-[11px] text-muted-foreground">{POSITION_LABEL[pos]}</dt>
            <dd className="text-sm font-medium"><Count cell={d[pos]} /></dd>
          </div>
        ))}
      </dl>

      {unknownStates.map((state) => (
        <p key={state} className="text-[11px] text-muted-foreground" data-testid={`graduating-state-${state}`}>
          {STATE_NOTE[state]}
        </p>
      ))}

      {anyNames && (
        <>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            data-testid="view-graduating-players"
          >
            {open ? 'Hide graduating players' : 'View graduating players'}
          </Button>

          {/*
            NAMES LIVE ONE DISCLOSURE DOWN — §6. They are public roster
            information and they are the evidence behind the counts, but a
            collapsed card showing fourteen names is a card nobody reads.
          */}
          {open && (
            <div className="space-y-2 pt-1" data-testid="graduating-names">
              {ORDER.map((pos) => {
                const players = context.departingPlayers?.[pos] ?? [];
                if (!players.length) return null;
                return (
                  <div key={pos}>
                    <p className="text-[11px] text-muted-foreground">{POSITION_LABEL[pos]}</p>
                    <ul className="text-xs">
                      {players.map((p) => (
                        <li key={`${pos}-${p.name}`} className="flex items-center gap-1.5">
                          <span>{p.name ?? 'Name not recorded'}</span>
                          {p.classYear && <span className="text-muted-foreground">{p.classYear}</span>}
                          {/*
                            Which of these counted toward the scored term. A
                            reader comparing the list to the number needs to
                            see it; `starterKnown` is false when we could not
                            tell, and then nothing is claimed either way.
                          */}
                          {p.starterKnown && p.starter && (
                            <span className="text-muted-foreground">· started</span>
                          )}
                          {!p.starterKnown && (
                            <span className="text-muted-foreground">· starting role not established</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
