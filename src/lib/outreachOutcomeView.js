/**
 * =============================================================================
 * PRESENTING WHAT HAPPENED — A9.6 §U.
 *
 * A pure view model, in the idiom `matchmakingV2View.js` set: it takes server
 * shapes and returns strings and flags, touches no network and holds no state,
 * so every sentence an operator reads is testable without a browser.
 * =============================================================================
 *
 * -- THE RULE THIS FILE EXISTS TO HOLD --------------------------------------
 *
 * ABSENCE IS NEVER RENDERED AS A NEGATIVE. §Z states it for the data; this
 * states it for the words. A programme nobody has replied to shows "No reply
 * yet" and never "Not interested"; a programme with no recruiting-need
 * statement shows "Nothing stated" and never "Not recruiting". The two are
 * different claims and only one of them is evidenced.
 *
 * It is the same discipline `FORBIDDEN_MAJOR_PHRASES` enforces one file over:
 * a missing fact must not acquire a confident sentence on its way to a screen.
 */

export const NO_OBSERVATION = Object.freeze({
  programmeInterest: 'No reply yet',
  recruitingNeed: 'Nothing stated',
  athleteOutcome: 'Not recorded',
});

/**
 * Phrases that must never appear for an axis with no observation. Asserted
 * directly by the tests, so the ban is mechanical rather than remembered.
 */
export const FORBIDDEN_ABSENCE_PHRASES = Object.freeze([
  'not interested',
  'no interest',
  'declined',
  'rejected',
  'not recruiting',
  'position filled',
  'roster complete',
  'unsuccessful',
]);

const LABELS = Object.freeze({
  POSITIVE_REPLY: 'Replied positively',
  NEUTRAL_REPLY: 'Replied',
  NEGATIVE_REPLY: 'Replied negatively',
  REQUESTED_FILM: 'Asked for film',
  REQUESTED_TRANSCRIPT: 'Asked for a transcript',
  REQUESTED_CALL: 'Asked for a call',
  INTERESTED: 'Said they are interested',
  ROSTER_PLACE_OFFERED: 'Offered a roster place',
  FINANCIAL_OFFER: 'Made a financial offer',
  DECLINED_ATHLETE: 'Declined the athlete',

  POSITION_FILLED: 'Position filled',
  POSITION_NEEDED: 'Looking for this position',
  CLASS_FILLED: 'Class filled',
  RECRUITING_FUTURE_CLASS: 'Recruiting a later class',
  ROSTER_COMPLETE: 'Roster complete',
  NOT_RECRUITING_POSITION: 'Not recruiting this position',
  OTHER_RECRUITING_INFORMATION: 'Other recruiting information',

  ATHLETE_INTERESTED: 'Athlete is interested',
  ATHLETE_NOT_INTERESTED: 'Athlete is not interested',
  ATHLETE_WITHDREW: 'Athlete withdrew',
  COMMITTED: 'Committed',
});

export const kindLabel = (kind) => LABELS[kind] ?? kind;

const POSITION_LABELS = Object.freeze({
  GOALKEEPER: 'goalkeeper', DEFENSE: 'defender', MIDFIELD: 'midfielder', FORWARD: 'forward',
});

/**
 * The attributes, as a sentence fragment. Only what is PRESENT: an absent
 * recruiting class says nothing rather than "this year".
 */
export function attributeSummary(attributes) {
  if (!attributes) return '';
  const parts = [];
  if (attributes.position) parts.push(POSITION_LABELS[attributes.position] ?? attributes.position);
  if (attributes.recruitingClassYear) parts.push(`class of ${attributes.recruitingClassYear}`);
  if (attributes.urgency) parts.push(attributes.urgency.toLowerCase().replace(/_/g, ' '));
  return parts.join(' · ');
}

/**
 * How much weight a reader should put on one observation.
 *
 * AN UNREVIEWED MACHINE GUESS IS MARKED AS ONE. §I's review state exists so a
 * screen can tell a consultant's judgement from a classifier's, and a surface
 * that rendered them identically would waste the distinction the schema paid
 * for.
 */
export function confidenceNote(observation) {
  if (!observation) return null;
  if (observation.classifier_method === 'MANUAL') return null;
  if (observation.review_state === 'CONFIRMED') return 'Machine-classified, confirmed';
  if (observation.review_state === 'REJECTED') return 'Rejected on review';
  return 'Machine-classified, not yet reviewed';
}

/** One observation, ready to render. */
export function observationView(o) {
  if (!o) return null;
  return {
    id: o.id,
    label: kindLabel(o.kind),
    detail: attributeSummary(o.attributes),
    category: o.category,
    observedAt: o.observed_at,
    note: o.note ?? null,
    confidenceNote: confidenceNote(o),
    needsReview: o.classifier_method !== 'MANUAL' && o.review_state === 'UNREVIEWED',
    isCorrection: Boolean(o.correction),
    correction: o.correction ?? null,
  };
}

/**
 * The three axes, each with an honest empty state.
 *
 * `null` from the projection means NOBODY HAS OBSERVED ANYTHING, and that is
 * what the copy says. It is not converted into a negative here or anywhere.
 */
export function outcomeStateView(state) {
  const axis = (value, emptyLabel) => (value
    ? { ...observationView(value), observed: true }
    : { label: emptyLabel, observed: false, detail: '', confidenceNote: null, needsReview: false });

  return {
    programmeInterest: axis(state?.programmeInterest, NO_OBSERVATION.programmeInterest),
    recruitingNeed: axis(state?.recruitingNeed, NO_OBSERVATION.recruitingNeed),
    athleteOutcome: axis(state?.athleteOutcome, NO_OBSERVATION.athleteOutcome),
    observationCount: state?.observationCount ?? 0,
    /**
     * Shown when the ledger holds more than the projection counts, so a reader
     * can see that something was superseded, retracted or rejected rather than
     * silently losing it.
     */
    supersededCount: Math.max(0, (state?.observationCount ?? 0) - (state?.effectiveCount ?? 0)),
  };
}

/**
 * What a selection froze, for the header of the outcome panel.
 *
 * THE DENOMINATOR TRAVELS WITH THE RANK, exactly as it does in
 * `MatchmakingProgrammeStanding`: "#4 of 828" is a statement, "#4" on its own
 * invites the reader to supply a population that may not be the right one.
 *
 * A selection with no rank says so in words. It is not a zero and it is not
 * last - A9.5 established that an unranked programme carries NULL rather than
 * a fabricated number, and this is where that decision becomes visible.
 */
export function selectionView(selection, { universeSize = null } = {}) {
  if (!selection) return null;
  const ranked = Number.isInteger(selection.rank);
  return {
    id: selection.id,
    collegeName: selection.collegeName ?? selection.college_name,
    sport: selection.sport,
    status: selection.status,
    ranked,
    rankLabel: ranked
      ? (universeSize ? `#${selection.rank} of ${universeSize}` : `#${selection.rank}`)
      : 'Not ranked — see the matchmaking result for why',
    band: selection.band ?? null,
    source: selection.source,
    selectedAt: selection.selectedAt ?? selection.selected_at,
    runWasStale: Boolean(selection.runWasStale ?? selection.run_was_stale),
  };
}
