import { positionNoun, positionPlural } from '@shared/positions.js';

/**
 * Operator-facing presentation for the roster evidence, one entry per kind.
 *
 * SEPARATE FROM `operatorEvidenceCopy`, and not by accident. That module
 * phrases a reason as a sentence and is pinned by a test to cover exactly the
 * fifteen kinds the top-reasons policy can select — POSITION_GROUP_SIZE and
 * SQUAD_GRADUATION are CONTEXT and deliberately absent from it. This section
 * inspects rather than concludes, so it needs both of those and it needs
 * structure rather than prose: names, a year timeline, a basis to qualify.
 * One module serving both shapes would weaken the invariant on the other.
 *
 * THE SAME LINE APPLIES. Every entry may label, interpolate, format and
 * pluralise what it was given. None may add two numbers, subtract one from
 * another, compute a share, or state a relationship between two kinds that the
 * API has not stated. The three populations at Jacksonville — 3 graduating, 2
 * projected starters, 5 on the eligibility cliff across two years — are
 * separately true and are not addends.
 *
 * FAILS VISIBLY. A kind with no entry returns null and the component says so,
 * naming the kind, rather than assembling something generic from whatever keys
 * happen to be on `facts`.
 *
 * Each entry returns:
 *   headline   the measurement, in one short line
 *   detail     an optional qualifying sentence
 *   names      an optional list of players, rendered as secondary text
 *   timeline   an optional [{ label, value }] for a multi-year breakdown
 *   scope      'position' or 'programme' — read from whether the facts name a
 *              position, never assumed. Only SQUAD_GRADUATION is programme-wide.
 */

const n = (v) => (Number.isFinite(v) ? String(v) : null);

/** A share the server already computed. Never derived here. */
const pct = (v) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : null);

/** Thousands separators, because these are read at a glance. */
const num = (v) => (Number.isFinite(v) ? v.toLocaleString('en-GB') : null);

const noun = (position, count) => (count === 1 ? positionNoun(position) : positionPlural(position));

/**
 * How a starter count was arrived at.
 *
 * `projected` is the only value the generators produce today — 247 of 247 real
 * instances — and it is spelled out rather than shown as a badge, because an
 * operator who reads "2 starters" as an observed fact has been misled by the
 * interface. An unrecognised basis returns null from the entry below, so a new
 * one shows as missing copy instead of being silently presented as certain.
 */
const BASIS = Object.freeze({
  projected: 'projected from current minutes',
});

const ROSTER_COPY = Object.freeze({
  POSITION_GRADUATION: (f) => (n(f.count) && f.position && f.beforeClassYear ? {
    headline: `${f.count} ${noun(f.position, f.count)} in the graduating class`,
    detail: `Due to graduate before the ${f.beforeClassYear} intake.`,
    names: f.names ?? null,
    scope: 'position',
  } : null),

  POSITION_GRADUATION_STARTERS: (f) => (n(f.starterCount) && f.position && BASIS[f.basis] ? {
    /**
     * Says "projected", and says nothing about the graduating group.
     *
     * The names here are a subset of the graduation names in all 247 real
     * cases, but the API states no relationship between the two kinds, and
     * "2 of those three" would be this screen inferring one. They are rendered
     * adjacent with both name lists visible, which lets an operator see the
     * overlap without the interface asserting it.
     */
    headline: `${f.starterCount} projected ${noun(f.position, f.starterCount)} starting`,
    detail: `Starter status is ${BASIS[f.basis]}, not an observed line-up.`,
    names: f.names ?? null,
    scope: 'position',
  } : null),

  POSITION_GROUP_SCARCITY: (f) => (n(f.count) && pct(f.share) && f.position ? {
    /**
     * Expressed as the SHARE, not as "N in a squad of M".
     *
     * Both this kind and POSITION_GROUP_SIZE carry a field called `squadSize`
     * and they do not always agree: 47 of 228 real programmes differ, Eastern
     * Oregon by 23 against 32. They are each right for their own purpose — one
     * is the denominator behind this share, the other is every roster row —
     * but printing both as "a squad of N" put two contradictory squad totals a
     * line apart with nothing to tell them apart. Reconciling them would be
     * this screen inventing a third figure, so it prints the share, which is
     * exactly what this kind's denominator exists for, and leaves the squad
     * total to the kind whose job it is. Scarcity never appears without that
     * kind beside it — 0 of 228 — so nothing is lost.
     */
    headline: `${f.count} ${noun(f.position, f.count)} — ${pct(f.share)} of the squad`,
    detail: 'A relatively thin position group for this programme.',
    scope: 'position',
  } : null),

  RETURNING_POSITION_DEPTH: (f) => (n(f.returning) && n(f.groupSize) && f.position ? {
    headline: `${f.returning} of ${f.groupSize} ${positionPlural(f.position)} returning`,
    detail: [
      f.beforeClassYear ? `Still eligible through the ${f.beforeClassYear} intake.` : null,
      // Surfaced only when it is not zero, which is 5 of 89 real cases. It
      // qualifies the returning count and hiding it would overstate certainty.
      f.unknownEligibility > 0
        ? `${f.unknownEligibility} more with no eligibility on file, counted neither way.`
        : null,
    ].filter(Boolean).join(' ') || null,
    scope: 'position',
  } : null),

  ELIGIBILITY_CLIFF: (f) => {
    if (!n(f.players) || !f.position || !f.beforeClassYear) return null;
    // Years with nobody in them are dropped rather than shown as zeroes: a row
    // reading "2026 — 0 players" is not a finding, it is padding.
    const years = (f.byYear ?? []).filter((y) => y.players > 0);
    return {
      /**
       * The HORIZON leads when there is more than one year, not the total.
       *
       * The total is real and is this kind's own, but it counts a different
       * population from the graduating class above it — at Jacksonville, 5
       * across 2026 and 2027 where the 2026 rows are the same three players.
       * Leading with "5" beside "3 in the graduating class" invites the reader
       * to add or to substitute, and nothing in the payload licenses either.
       * The per-year rows say what is actually known.
       */
      headline: years.length > 1
        ? `Eligibility runs out across ${years[0].year}–${years[years.length - 1].year}`
        : `${f.players} ${noun(f.position, f.players)} reaching the end of eligibility`,
      detail: years.length > 1
        ? `Counted separately from the graduating class — the same player can appear in both.`
        : `Eligibility ends before the ${f.beforeClassYear} intake.`,
      timeline: years.length > 1 ? years.map((y) => ({
        label: String(y.year),
        value: `${y.players} ${noun(f.position, y.players)}`
          + `${num(y.minutes) ? ` · ${num(y.minutes)} projected minutes` : ''}`,
      })) : null,
      scope: 'position',
    };
  },

  POSITION_GROUP_SIZE: (f) => (n(f.count) && n(f.squadSize) && f.position ? {
    headline: `${f.count} ${noun(f.position, f.count)} on the current roster`,
    detail: `In a squad of ${f.squadSize}.`,
    scope: 'position',
  } : null),

  SQUAD_GRADUATION: (f) => (n(f.total) && f.beforeClassYear ? {
    /**
     * The only kind whose facts name no position, which is exactly why it is
     * programme-wide: it counts the whole squad, not this athlete's group. The
     * scope is read off the data rather than hard-coded to this kind.
     */
    headline: `${f.total} ${f.total === 1 ? 'player' : 'players'} graduating squad-wide`,
    detail: [
      `Across every position, before the ${f.beforeClassYear} intake.`,
      n(f.starters) ? `${f.starters} of them projected starters.` : null,
    ].filter(Boolean).join(' '),
    names: f.names ?? null,
    scope: 'programme',
  } : null),
});

/** Every roster kind this module can present. Used by its tests, not the UI. */
export const ROSTER_COPY_KINDS = Object.freeze(Object.keys(ROSTER_COPY));

/**
 * Presentation content for one roster fact item, or null.
 *
 * Null means "this screen has no way to show this", and the caller must say so
 * rather than skipping the item — a row dropped for want of copy looks exactly
 * like a programme that has no such evidence.
 */
export function rosterCopyFor(item) {
  const build = ROSTER_COPY[item?.kind];
  if (!build) return null;
  const content = build(item.facts ?? {});
  if (!content?.headline) return null;
  return {
    detail: null, names: null, timeline: null, ...content,
  };
}

/**
 * A compact qualification line, or null when there is nothing worth saying.
 *
 * Deliberately thin. The full provenance view is a later step, and the two
 * things an operator needs here are which season the roster claim describes
 * and whether the reading is stale. Nothing about how the server validated the
 * item crosses — `minConfidence`, `requiresWindow` and `requiresComparison`
 * are not on the payload at all, by design.
 *
 * Freshness appears ONLY when it is not current. Every roster item in the
 * database reads CURRENT today, so this renders nothing on real data — it is
 * here so a stale roster announces itself rather than being discovered later.
 */
export function rosterQualification(item) {
  const q = item?.qualification ?? {};
  const parts = [];
  if (q.season) parts.push(`${q.season} roster`);
  if (q.freshness && q.freshness.state !== 'CURRENT') {
    parts.push(q.freshness.reason || `roster reading is ${String(q.freshness.state).toLowerCase()}`);
  }
  return parts.length ? parts.join(' · ') : null;
}
