import React from 'react';
import { STARTER_MINUTES_THRESHOLD, PROJECTED_STARTER_MINUTES, CURRENT_ROSTER_SEASON } from '@/lib/divisions';

/*
 * Moved unchanged from the Graduating Database page (Phase 4), which the
 * Programme Database replaces; the roster section renders minutes with it.
 */
/**
 * Playing time in three states, because they mean different things and the view
 * used to show all of them as a grey "0 min".
 *
 *   played      a real figure from this season      emerald when it clears 600
 *   projected   LAST season's figure, carried       amber, italic, "~" prefixed
 *   unknown     neither                             dimmed dash
 *
 * The projection is never dressed up as current data. It gets its own colour,
 * a tilde, and a tooltip naming the season it came from, because the operator
 * emailing a coach needs to know which numbers are evidence and which are an
 * inference — a coach's roster has visibly changed since last season.
 */
export default function MinutesCell({ minutes, projected, projectedSeason, priorProgramme, school, possible }) {
  if (minutes != null) {
    const starter = minutes >= STARTER_MINUTES_THRESHOLD;
    return (
      <span
        className={starter ? 'text-emerald-400 font-medium w-24 text-right' : 'text-muted-foreground w-24 text-right'}
        title={`${minutes} minutes played in the ${CURRENT_ROSTER_SEASON} season.`}
      >
        {minutes} min
      </span>
    );
  }
  if (projected != null) {
    const starter = projected >= PROJECTED_STARTER_MINUTES;
    return (
      <span
        className={starter ? 'text-amber-400/90 font-medium italic w-24 text-right' : 'text-muted-foreground/70 italic w-24 text-right'}
        title={`Not ${CURRENT_ROSTER_SEASON} data. This is ${projected} minutes from the ${projectedSeason} season, `
          + `carried forward because ${CURRENT_ROSTER_SEASON} has not been played yet. `
          + `${starter ? `Projected starter (${PROJECTED_STARTER_MINUTES}+ last season predicts a 600+ season with about 80% precision).` : 'Not projected as a starter.'}`}
      >
        ~{projected} min
      </span>
    );
  }
  // A dash has three quite different causes, and which one it is matters to
  // whoever is about to write to the coach. Saying "transferred in from
  // Florida Atlantic" beats an unexplained blank, and beats inventing a figure:
  // minutes earned at another programme predict a starting place here only
  // 54.9% of the time, against 77.4% for a player who stayed, so they are
  // recorded as provenance and never carried forward.
  //
  // Phase 8B.1A: priorProgramme is a VERIFIED origin only — the destination
  // roster named the previous school, or name + hometown + class progression
  // agreed with nothing against. A same-name player elsewhere last season is a
  // POSSIBLE transfer: shown, labelled unverified, never called a transfer.
  const transferred = priorProgramme && priorProgramme !== school;
  const title = transferred
    ? `Verified transfer from ${priorProgramme}. Their ${priorProgramme} minutes are not carried forward — `
      + 'a figure earned at another programme is a much weaker guide to starting here (about 55% reliable, '
      + 'against 77% for a player who stayed), so starter status is unknown.'
    : priorProgramme
      ? `On this roster last season too, but that page published no minutes, so starter status is unknown.`
      : possible
        ? `Possible transfer, NOT verified: a player with this name was at ${possible.from_programme} last season, `
          + 'but the evidence does not establish that it is the same person, so it is not counted as a transfer. '
          + 'Starter status is unknown.'
        : `Not on any ${Number(CURRENT_ROSTER_SEASON) - 1} roster — new to college soccer, or their previous programme `
          + 'was not captured. Starter status is unknown.';
  return (
    <span className="text-muted-foreground/50 italic w-24 text-right" title={title}>
      {transferred ? 'transfer' : possible ? 'possible?' : '— min'}
    </span>
  );
}
