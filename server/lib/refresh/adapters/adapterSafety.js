/**
 * ADAPTER SAFETY — Phase 8A. What a gatherer must refuse BEFORE anything is staged.
 *
 * Every check returns a refusal code (or null). A refused page is emitted as a REFUSAL
 * record the operator sees in the gather report — never as an empty observation, because an
 * empty roster/staff list staged as "complete" would read as every held record having
 * DISAPPEARED. A zero-result scrape is never evidence that a programme or person is gone.
 */
import { SHARED_PLATFORM_ROOT } from '../identityResolver.js';
import { sportEvidence, seasonEvidence, SPORT_STATUS, SEASON_STATUS } from './sourceEvidence.js';

export const REFUSAL = Object.freeze({
  BLOCKED: 'BLOCKED_OR_INCOMPLETE_PAGE',
  OLD_SEASON: 'OLD_SEASON_PAGE_CLAIMED_AS_CURRENT',
  WRONG_SPORT: 'WRONG_SPORT',
  SPORT_UNRESOLVED: 'SPORT_UNRESOLVED',
  SEASON_UNRESOLVED: 'SEASON_UNRESOLVED',
  SEASON_CONTRADICTION: 'SEASON_CONTRADICTION',
  STAFF_IN_ROSTER: 'STAFF_MIXED_INTO_ROSTER',
  SHARED_ROOT: 'SHARED_PLATFORM_ROOT_WITHOUT_ENTITY_OWNERSHIP',
  INSTITUTION_MISMATCH: 'INSTITUTION_MISMATCH',
  FOREIGN_REDIRECT: 'REDIRECTED_TO_ANOTHER_INSTITUTION',
  AMBIGUOUS: 'AMBIGUOUS_PROGRAMME',
  ZERO: 'PARSER_RETURNED_ZERO_RECORDS',
  COLLAPSE: 'COUNT_COLLAPSE_VS_PRIOR_OBSERVATION',
  STRUCTURE: 'PARSER_STRUCTURE_UNKNOWN',
});

/**
 * Phase 8C.3C: what happens to a page stopped by each refusal. REFUSED — the page is not this
 * programme's current source. HELD — it may be, but the page does not prove it: a person decides,
 * nothing is staged. Neither is ever evidence that anything disappeared.
 */
export const DISPOSITION = Object.freeze({ HELD: 'HELD', REFUSED: 'REFUSED' });
const HELD_CODES = new Set([REFUSAL.SPORT_UNRESOLVED, REFUSAL.SEASON_UNRESOLVED, REFUSAL.SEASON_CONTRADICTION]);
export const dispositionOf = (code) => (HELD_CODES.has(code) ? DISPOSITION.HELD : DISPOSITION.REFUSED);

const NON_PLAYER = /\b(head coach|assistant coach|coach|manager|trainer|director|coordinator|staff)\b/i;

/**
 * Check one fetched page for one intended programme.
 *   page: fetchPage() result;  intent: { sport, season, kind: 'ROSTER'|'COACH', entityOwnsHost(host), expectHost }
 *   records: parsed records;   prior: { count } from the last observation of this programme (optional)
 *
 * ORDER (Phase 8C.3C): fetch block -> SOURCE OWNERSHIP -> SPORT -> SEASON -> parser output (zero
 * records, staff rows, count collapse). Programme identity and player validation follow at staging.
 * A ROSTER page reaches the parser checks only with ownership, sport AND season proven by the page
 * itself (sourceEvidence.js); intent.season is what was asked for, never what the page proves.
 * A COACH page is refused on a contradicted sport; staff pages carry no season.
 * Every refusal carries `disposition` (HELD | REFUSED) and, past ownership, the `evidence` used.
 */
export function refusePage(page, intent, records = [], prior = null) {
  const r = refusalOf(page, intent, records, prior);
  return r ? { ...r, disposition: dispositionOf(r.code) } : null;
}

/** The page's own proof of sport and season (Phase 8C.3C). Stored on staged pages; null for a blocked page. */
export function pageEvidence(page, intent) {
  if (page.block) return null;
  const url = page.final_url || page.url;
  return { sport: sportEvidence({ url, html: page.body, sport: intent.sport }), season: intent.kind === 'ROSTER' ? seasonEvidence({ url, html: page.body }) : null };
}
const brief = (e) => e && { status: e.status, ...(e.season !== undefined ? { season: e.season, evidence_class: e.evidence_class } : { sport_observed: e.sport_observed }), detail: e.detail };

function refusalOf(page, intent, records, prior) {
  if (page.block) return { code: REFUSAL.BLOCKED, detail: page.block };
  const host = page.final_host || page.host;
  // ownership is decided on the URL when a path-scoped check is supplied (Phase 8B.1: an
  // institution-path source owns /athletics/..., never the rest of its host), else on the host
  const finalUrl = page.final_url || page.url;
  const owns = intent.entityOwnsUrl ? () => intent.entityOwnsUrl(finalUrl) : intent.entityOwnsHost ? (h) => intent.entityOwnsHost(h) : null;
  if (host && SHARED_PLATFORM_ROOT.test(host) && !(owns && owns(host))) return { code: REFUSAL.SHARED_ROOT, detail: host };
  if (page.final_host && page.host && page.final_host !== page.host && !(owns && owns(page.final_host))) return { code: REFUSAL.FOREIGN_REDIRECT, detail: `${page.host} -> ${page.final_host}` };
  if (owns && host && !owns(host)) return { code: REFUSAL.INSTITUTION_MISMATCH, detail: intent.entityOwnsUrl ? `${finalUrl} is not inside a source owned by the programme's athletics entity` : `${host} is not owned by the programme's athletics entity` };
  const ev = pageEvidence(page, intent); const evidence = { sport: brief(ev.sport), season: brief(ev.season) };
  // SPORT: only a page that positively names this programme's sport may continue
  if (ev.sport.status === SPORT_STATUS.CONTRADICTED) return { code: REFUSAL.WRONG_SPORT, detail: `page is ${ev.sport.sport_observed}, wanted ${intent.sport} — ${ev.sport.detail}`, evidence };
  if (intent.kind === 'ROSTER' && ev.sport.status !== SPORT_STATUS.CONFIRMED) return { code: REFUSAL.SPORT_UNRESOLVED, detail: `the page does not establish ${intent.sport}: ${ev.sport.detail}`, evidence };
  // SEASON: the page must name its own season; the requested season is never evidence
  if (intent.kind === 'ROSTER' && intent.season != null) {
    const s = ev.season;
    if (s.status === SEASON_STATUS.CONTRADICTION) return { code: REFUSAL.SEASON_CONTRADICTION, detail: `the page's season evidence disagrees: ${s.detail}`, evidence };
    if (s.status !== SEASON_STATUS.CONFIRMED) return { code: REFUSAL.SEASON_UNRESOLVED, detail: `no season evidence (${s.detail}); ${intent.season} was requested, which is not evidence`, evidence };
    if (s.season < intent.season) return { code: REFUSAL.OLD_SEASON, detail: `page says ${s.season}, wanted ${intent.season}`, evidence };
    if (s.season > intent.season) return { code: REFUSAL.SEASON_CONTRADICTION, detail: `page says ${s.season} (${s.evidence_class}), gathered as ${intent.season}`, evidence };
  }
  if (!records.length) return { code: REFUSAL.ZERO, detail: 'parser returned no records — not evidence that the programme or anyone on it is gone' };
  if (intent.kind === 'ROSTER') {
    const staff = records.filter((r) => NON_PLAYER.test(r.position || '') || NON_PLAYER.test(r.player_name || ''));
    if (staff.length > Math.max(1, records.length * 0.2)) return { code: REFUSAL.STAFF_IN_ROSTER, detail: `${staff.length} of ${records.length} rows look like staff` };
  }
  if (prior?.count && records.length < prior.count * 0.5 && prior.count - records.length >= 5) return { code: REFUSAL.COLLAPSE, detail: `${records.length} records vs ${prior.count} last observation` };
  return null;
}
