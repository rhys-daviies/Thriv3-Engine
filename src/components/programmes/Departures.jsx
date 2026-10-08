import React from 'react';
import { NOT_ESTABLISHED, STATE_NOTE } from '@/components/matchmaking/GraduatingPlayers';

/**
 * PROJECTED OPENINGS BY POSITION — Phase 4.
 *
 * The same states and words as the match card's "Projected departures"
 * (GraduatingPlayers): a count is printed only when the engine MEASURED it,
 * and every other state reads "Not established", never 0. The numbers are the
 * engine's `positionEvidence`, served by /api/programmes.
 */
export const POSITION_ORDER = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];
export const POSITION_SHORT = { GOALKEEPER: 'GK', DEFENSE: 'DEF', MIDFIELD: 'MID', FORWARD: 'FWD' };
export const POSITION_LABEL = { GOALKEEPER: 'Goalkeepers', DEFENSE: 'Defenders', MIDFIELD: 'Midfielders', FORWARD: 'Forwards' };
export { NOT_ESTABLISHED, STATE_NOTE };

export function OpeningCount({ cell, detail = false }) {
  if (!cell || cell.state !== 'MEASURED') {
    return <span className="text-muted-foreground font-normal" title={cell ? STATE_NOTE[cell.state] : undefined}>{NOT_ESTABLISHED}</span>;
  }
  return (
    <span className="tabular-nums">
      {cell.openings}
      {detail && cell.openings > 0 && (
        <span className="text-muted-foreground font-normal"> ({cell.vacatedStarters} starting)</span>
      )}
    </span>
  );
}

/** One line of GK · DEF · MID · FWD, plus the reason for any count we could not establish. */
export default function Departures({ departures, detail = false, notes = true }) {
  if (!departures) return null;
  const unknown = [...new Set(POSITION_ORDER.map((p) => departures[p]?.state).filter((s) => s && s !== 'MEASURED'))];
  return (
    <div className="space-y-1" data-testid="programme-departures">
      <dl className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm font-medium">
        {POSITION_ORDER.map((pos) => (
          <div key={pos} className="flex items-baseline gap-1" data-testid={`opening-${pos}`}>
            <dt className="text-[11px] text-muted-foreground">{POSITION_SHORT[pos]}</dt>
            <dd><OpeningCount cell={departures[pos]} detail={detail} /></dd>
          </div>
        ))}
      </dl>
      {notes && unknown.map((s) => (
        <p key={s} className="text-[11px] text-muted-foreground" data-testid={`opening-state-${s}`}>{STATE_NOTE[s]}</p>
      ))}
    </div>
  );
}

/** What "projected opening" means, said once wherever counts are shown. */
export function classCaveat({ classYear, rosterSeason }) {
  const base = `Projected openings for the ${classYear} class: players on the ${rosterSeason} roster whose eligibility, `
    + `under the rules on file, ends before ${classYear}. These are projections, not confirmed departures - `
    + 'transfers, early exits and players choosing to stay or leave are not modelled.';
  return classYear > rosterSeason + 1
    ? `${base} Players who join after the ${rosterSeason} roster are not on file either.`
    : base;
}

export const WINDOW_EXHAUSTED_NOTE = 'Every player on the current roster runs out of eligibility by this class, so these counts are set by the eligibility window, not by this programme.';
