/**
 * The words a person reads for the things the model stores as keys.
 *
 * Kept in a plain .js module rather than inside a component so it is covered
 * by the test config, which includes `src/**\/*.test.js` and not `.jsx`.
 */
import { MINUTE_BANDS } from '@shared/freshmanMinutes.js';

/**
 * Colour tracks CONFIDENCE, not whether the programme is a good one.
 * A programme that swings year to year is not worse than a steady one; it is
 * less predictable, and that is the thing the badge has to communicate.
 */
export const VERDICT = {
  steady: { label: 'Consistent', variant: 'green' },
  'structural-through-changes': { label: 'Consistent through changes', variant: 'green' },
  'continuity-through-change': { label: 'Consistent through a change', variant: 'green' },
  'policy-shift-same-coach': { label: 'Changed approach', variant: 'amber' },
  'erratic-same-coach': { label: 'Swings year to year', variant: 'amber' },
  'regime-change': { label: 'New regime', variant: 'amber' },
  'new-coach-no-record': { label: 'New coach, no record', variant: 'muted' },
  'change-too-recent': { label: 'Change too recent', variant: 'muted' },
  'vacancy-in-window': { label: 'A season with no coach', variant: 'muted' },
  'coach-unknown': { label: 'Coach unknown', variant: 'muted' },
  'coach-unknown-recent': { label: 'Recent seasons unattributed', variant: 'muted' },
  'too-few-seasons': { label: 'Too little data', variant: 'muted' },
};

export function verdictLabel(key) {
  return VERDICT[key] ?? { label: 'Not enough on file', variant: 'muted' };
}

const BAND = Object.fromEntries(MINUTE_BANDS.map((b) => [b.key, b.label.toLowerCase()]));
export function bandLabel(key) {
  return BAND[key] ?? '';
}

/**
 * The top of a ladder, as a phrase.
 *
 * A rank the seasons disagree about is shown as a range: quoting its median
 * alone can assert the opposite of the truth — one programme's international
 * freshmen ran 42, 1001 and 14 minutes, and the median is 42.
 */
export function ladderTopText(top) {
  if (!top || top.median == null) return { value: '—', note: 'not enough on file' };
  if (top.agreement === 'wide') {
    return { value: `${top.low}–${top.high} min`, note: 'the seasons disagree' };
  }
  return { value: `${top.median.toLocaleString('en-US')} min`, note: bandLabel(top.band) };
}

/** Never render a null dial as 0 — that reads as a measurement of nothing. */
export function dialText(dials) {
  if (!dials || !dials.n) return null;
  return {
    returning: dials.returning, freshman: dials.freshman, newcomer: dials.newcomer,
    n: dials.n,
  };
}

export function cohortText(cohort) {
  if (!cohort) return null;
  const parts = [];
  if (cohort.position) {
    parts.push({
      GOALKEEPER: 'goalkeepers', DEFENSE: 'defenders',
      MIDFIELD: 'midfielders', FORWARD: 'forwards',
    }[cohort.position] ?? cohort.position.toLowerCase());
  }
  if (cohort.origin === 'international') parts.push('international students');
  if (cohort.origin === 'domestic') parts.push('US recruits');
  return parts.length ? parts.join(', ') : null;
}
