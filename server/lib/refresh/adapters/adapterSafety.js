/**
 * ADAPTER SAFETY — Phase 8A. What a gatherer must refuse BEFORE anything is staged.
 *
 * Every check returns a refusal code (or null). A refused page is emitted as a REFUSAL
 * record the operator sees in the gather report — never as an empty observation, because an
 * empty roster/staff list staged as "complete" would read as every held record having
 * DISAPPEARED. A zero-result scrape is never evidence that a programme or person is gone.
 */
import { pageSeason, pageSportFromTitle } from './presto.js';
import { sportOfUrl } from '../changeClassifier.js';
import { SHARED_PLATFORM_ROOT } from '../identityResolver.js';

export const REFUSAL = Object.freeze({
  BLOCKED: 'BLOCKED_OR_INCOMPLETE_PAGE',
  OLD_SEASON: 'OLD_SEASON_PAGE_CLAIMED_AS_CURRENT',
  WRONG_SPORT: 'WRONG_SPORT',
  STAFF_IN_ROSTER: 'STAFF_MIXED_INTO_ROSTER',
  SHARED_ROOT: 'SHARED_PLATFORM_ROOT_WITHOUT_ENTITY_OWNERSHIP',
  INSTITUTION_MISMATCH: 'INSTITUTION_MISMATCH',
  FOREIGN_REDIRECT: 'REDIRECTED_TO_ANOTHER_INSTITUTION',
  AMBIGUOUS: 'AMBIGUOUS_PROGRAMME',
  ZERO: 'PARSER_RETURNED_ZERO_RECORDS',
  COLLAPSE: 'COUNT_COLLAPSE_VS_PRIOR_OBSERVATION',
});

const NON_PLAYER = /\b(head coach|assistant coach|coach|manager|trainer|director|coordinator|staff)\b/i;

/**
 * Check one fetched page for one intended programme.
 *   page: fetchPage() result;  intent: { sport, season, kind: 'ROSTER'|'COACH', entityOwnsHost(host), expectHost }
 *   records: parsed records;   prior: { count } from the last observation of this programme (optional)
 */
export function refusePage(page, intent, records = [], prior = null) {
  if (page.block) return { code: REFUSAL.BLOCKED, detail: page.block };
  const host = page.final_host || page.host;
  if (host && SHARED_PLATFORM_ROOT.test(host) && !(intent.entityOwnsHost && intent.entityOwnsHost(host))) return { code: REFUSAL.SHARED_ROOT, detail: host };
  if (page.final_host && page.host && page.final_host !== page.host && !(intent.entityOwnsHost && intent.entityOwnsHost(page.final_host))) return { code: REFUSAL.FOREIGN_REDIRECT, detail: `${page.host} -> ${page.final_host}` };
  if (intent.entityOwnsHost && host && !intent.entityOwnsHost(host)) return { code: REFUSAL.INSTITUTION_MISMATCH, detail: `${host} is not owned by the programme's athletics entity` };
  const urlSport = sportOfUrl(page.final_url || page.url); const titleSport = pageSportFromTitle(page.body);
  if ((urlSport && urlSport !== intent.sport) || (titleSport && titleSport !== intent.sport)) return { code: REFUSAL.WRONG_SPORT, detail: `page is ${urlSport || titleSport}, wanted ${intent.sport}` };
  const ps = pageSeason(page.body);
  if (intent.season != null && ps != null && ps < intent.season) return { code: REFUSAL.OLD_SEASON, detail: `page says ${ps}, wanted ${intent.season}` };
  if (!records.length) return { code: REFUSAL.ZERO, detail: 'parser returned no records — not evidence that the programme or anyone on it is gone' };
  if (intent.kind === 'ROSTER') {
    const staff = records.filter((r) => NON_PLAYER.test(r.position || '') || NON_PLAYER.test(r.player_name || ''));
    if (staff.length > Math.max(1, records.length * 0.2)) return { code: REFUSAL.STAFF_IN_ROSTER, detail: `${staff.length} of ${records.length} rows look like staff` };
  }
  if (prior?.count && records.length < prior.count * 0.5 && prior.count - records.length >= 5) return { code: REFUSAL.COLLAPSE, detail: `${records.length} records vs ${prior.count} last observation` };
  return null;
}
