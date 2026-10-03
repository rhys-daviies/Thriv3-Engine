/**
 * WHICH MATCHING ENGINE THE TAB RENDERS — §T.
 *
 * ===========================================================================
 * ONE BRANCH POINT, AND A WAY BACK THAT NEEDS NO DEPLOY.
 *
 * V2 is the default and V1 is still here. During internal rollout the thing
 * that matters is not how the switch is spelled, it is that a consultant on a
 * call can get the old screen back in the time it takes to edit a URL — and
 * that an operator watching them can reproduce exactly what they saw.
 *
 *   ?matching=v1   this tab, this session, right now. No rebuild, no restart.
 *   VITE_MATCHMAKING_ENGINE=v1   the default for a whole build.
 *   neither        v2.
 *
 * The query parameter wins because it is the narrower instrument: a build
 * pinned to v1 must still let one person check v2, and a build on v2 must let
 * one person fall back. `useSearchParams` is already the idiom here —
 * DecisionTab, ReportsTab and NewPlayer all read params this way.
 *
 * An unrecognised value is NOT an error and NOT v1. It falls through to the
 * default, because `?matching=V2 ` or `?matching=two` showing a blank screen
 * would be a worse failure than showing the normal one.
 * ===========================================================================
 */

export const MATCHING_V1 = 'v1';
export const MATCHING_V2 = 'v2';

/** The only two spellings that mean anything. */
const KNOWN = new Set([MATCHING_V1, MATCHING_V2]);

const normalise = (value) => {
  const v = (value ?? '').toString().trim().toLowerCase();
  return KNOWN.has(v) ? v : null;
};

/**
 * @param {URLSearchParams|null} search  the tab's query parameters
 * @param {object} env  injected for tests; defaults to the build's own
 */
export function matchmakingVersion(search, env = import.meta.env) {
  return normalise(search?.get?.('matching'))
    ?? normalise(env?.VITE_MATCHMAKING_ENGINE)
    ?? MATCHING_V2;
}
