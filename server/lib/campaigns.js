/**
 * THE CAMPAIGN DATA LAYER — the only place campaign state may change.
 *
 * `campaigns` and `programme_campaigns` are deliberately NOT registered in the
 * `ENTITIES` map in server/index.js. That registry is unvalidated pass-through
 * CRUD: it would let any caller PUT a new `rank`, `match_score` or
 * `snapshot_taken_at`, which is precisely the guarantee the two tables exist to
 * make. Every mutation goes through a named function here, and every function
 * here owns an invariant that the schema alone cannot express.
 *
 * IT ALSO OWNS CREATION, which is where a mutable pointer becomes a durable
 * record: `createCampaign` freezes the athlete's currently stored match
 * analysis into rows that no later re-analysis can move. It reads that one
 * blob and the athlete row and nothing else — it re-runs no matching, re-scores
 * nothing, and never consults a college or roster table, because the ranking
 * being frozen is the historical one rather than today's answer to the same
 * question.
 *
 * WHAT THIS MODULE DOES NOT DO, and must not grow into: it does not touch
 * `outreach` or `outreach_send`, does not choose coaches, does not send, does
 * not schedule, and stores no counters. Those are later phases.
 *
 * ---------------------------------------------------------------------------
 * SAME-STATE REQUESTS ARE IDEMPOTENT NO-OPS, NOT ERRORS.
 *
 * This follows the convention already set by `suppress()` (returns
 * `alreadySuppressed` rather than throwing), `createOutreach` (returns the
 * existing row) and `markOutreachSent` (`AND sent_at IS NULL`, so the FIRST
 * confirmation wins). The hazard those all guard against is the same one here:
 * a repeated call must not rewrite a timestamp that dates a real event.
 * Closing a campaign twice would otherwise move `closed_at` and replace
 * `close_reason` with whatever the second caller happened to pass — the exact
 * defect that let a draft's timestamp overwrite a send's.
 *
 * So a request to enter the current state writes NOTHING and returns the row
 * with `changed: false`. The corollary, stated plainly because it is a real
 * limitation: there is no way here to AMEND a stop or close reason. If that is
 * ever wanted it is its own operation, not a side effect of re-issuing a
 * transition.
 * ---------------------------------------------------------------------------
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { visibleTop100 } from '../../shared/matching/visibleTop100.js';
import { readReserve } from '../../shared/matching/reserve.js';
import { suppressedProgrammesForAthlete } from './athleteProgrammes.js';
import db from '../db/client.js';
import { utcNow } from './time.js';
import { UPLOADS_DIR, UPLOAD_URL_PREFIX } from './uploadPath.js';

export const CAMPAIGN_STATES = Object.freeze(['draft', 'active', 'closed']);
export const PROGRAMME_CAMPAIGN_STATES = Object.freeze(['queued', 'active', 'stopped', 'completed']);
export const TIERS = Object.freeze(['A', 'B', 'C']);
export const TIER_SOURCES = Object.freeze(['AUTO', 'OPERATOR']);

/**
 * Legal moves. Read them as the whole lifecycle, because they are.
 *
 * `closed` and `completed` are terminal and have no exits. A campaign never
 * returns to `draft`: the snapshot has been acted on by then, and a "back to
 * draft" would mean a reviewable, un-sent campaign that has already sent.
 */
const CAMPAIGN_TRANSITIONS = Object.freeze({
  draft: ['active', 'closed'],
  active: ['closed'],
  closed: [],
});

/**
 * `queued -> stopped` is legal without ever going active: a programme can be
 * removed from outreach before its first message, because its only contact is
 * suppressed, its addresses are inferred, or an operator says so.
 *
 * `stopped -> active` is legal because a stop is not a verdict for all time —
 * a coach who said "not this year" in September can be worth writing to in
 * January, and new contact data reopens the programmes that had none.
 *
 * `queued -> completed` and `stopped -> completed` are NOT legal. `completed`
 * means the planned outreach finished; a programme that never sent a message,
 * or that stopped short, did not finish it. Reopening a stopped programme goes
 * through `active`, which is also the only honest description of what is
 * happening to it.
 */
const PROGRAMME_TRANSITIONS = Object.freeze({
  queued: ['active', 'stopped'],
  active: ['stopped', 'completed'],
  stopped: ['active'],
  completed: [],
});

/**
 * Why a campaign ended. Validated HERE and deliberately not as a database
 * CHECK, so the vocabulary can grow without a schema migration — the same
 * split `suppress()` uses for its own reasons.
 */
export const CLOSE_REASONS = Object.freeze([
  'completed',            // ran its course
  'athlete_committed',    // they signed somewhere; the service has succeeded
  'athlete_withdrawn',    // the athlete left representation
  'operator',             // a human ended it for a reason of their own
]);

/**
 * Why outreach to a programme stopped. NOT validated against a fixed list.
 *
 * These are the reasons known today — not_recruiting, not_interested,
 * no_contact, suppressed, athlete_declined, committed_elsewhere, operator —
 * and reply classification (a later phase) will produce more of them. A closed
 * vocabulary here would mean the classifier could not record what it found
 * without a migration, so the only rule enforced is that a stop HAS a reason.
 */
export const KNOWN_STOP_REASONS = Object.freeze([
  'not_recruiting', 'not_interested', 'no_contact', 'suppressed',
  'athlete_declined', 'committed_elsewhere', 'operator',
]);

/**
 * A domain failure with a machine-readable `code`.
 *
 * The routes slice needs to tell "you asked for an illegal move" (422) apart
 * from "somebody else is already active" (409) apart from "no such campaign"
 * (404), and it cannot do that by matching on a message string. The code is
 * the only addition; nothing else about how this repository throws changes.
 */
function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

// ---------------------------------------------------------------------------
// Tier banding
// ---------------------------------------------------------------------------

/**
 * The approved default bands. Data, not branches, so the boundaries can be
 * read at a glance and are testable as a table.
 */
export const TIER_BANDS = Object.freeze([
  Object.freeze({ tier: 'A', from: 1, to: 20 }),
  Object.freeze({ tier: 'B', from: 21, to: 50 }),
  Object.freeze({ tier: 'C', from: 51, to: 100 }),
]);

/** A campaign is a Top 100 campaign by definition; nothing ranks 101st. */
export const MAX_RANK = TIER_BANDS[TIER_BANDS.length - 1].to;

/**
 * rank -> campaign tier. That is the whole question it answers.
 *
 * It says nothing about how much outreach a tier receives, how often, or in
 * what order. Depth and cadence are a later phase's rules and must not be
 * reachable from here, or two places will end up deciding them.
 *
 * REFUSES rather than guesses. A rank of 0, 101, 12.5, null or "3" is a bug in
 * whatever produced it, and quietly banding it as C would put a programme in a
 * campaign at a tier no rule chose.
 */
export function tierForRank(rank) {
  if (!Number.isInteger(rank)) {
    throw fail('INVALID_RANK', `Rank must be an integer, got ${JSON.stringify(rank)}`);
  }
  if (rank < 1 || rank > MAX_RANK) {
    throw fail('INVALID_RANK', `Rank must be between 1 and ${MAX_RANK}, got ${rank}`);
  }
  const band = TIER_BANDS.find((b) => rank >= b.from && rank <= b.to);
  // Unreachable while the bands cover 1..MAX_RANK contiguously. Kept so that a
  // future gap in the table fails loudly instead of returning undefined.
  if (!band) throw fail('INVALID_RANK', `No tier band covers rank ${rank}`);
  return band.tier;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Rows come back exactly as the tables hold them — single-table reads with no
 * join, so nothing here can carry an engagement figure.
 *
 * `tier` therefore always means the CAMPAIGN tier (A/B/C). It is not
 * `engagement_rollup.tier`, which is a temperature (cold|warm|hot|priority|
 * responded) derived from what a coach did. Any later read that joins the two
 * MUST alias them — `campaign_tier` and `engagement_tier` — because one word
 * answering two questions is how the wrong one gets rendered. Aliasing them
 * here instead would give this table's own column two names, which is the
 * other way to get it wrong.
 */
export function getCampaign(id) {
  return db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id) || null;
}

/** Scoped to one athlete, newest first. `id` breaks ties so the order is total. */
export function listCampaignsForAthlete(athleteId) {
  return db.prepare(`
    SELECT * FROM campaigns WHERE athlete_id = ?
    ORDER BY starts_on DESC, created_at DESC, id DESC
  `).all(athleteId);
}

/** The one active campaign, or null. The partial unique index guarantees "one". */
export function activeCampaignForAthlete(athleteId) {
  return db.prepare("SELECT * FROM campaigns WHERE athlete_id = ? AND state = 'active'").get(athleteId) || null;
}

export function getProgrammeCampaign(id) {
  return db.prepare('SELECT * FROM programme_campaigns WHERE id = ?').get(id) || null;
}

/**
 * In SNAPSHOT RANK ORDER, always. `rank` is unique per campaign, so this is a
 * total order with no tiebreak needed, and it is the order the list was
 * ranked in — not the order tiers happen to sort in, which would reorder the
 * list the moment an operator promoted anything.
 */
export function listProgrammeCampaigns(campaignId) {
  return db.prepare('SELECT * FROM programme_campaigns WHERE campaign_id = ? ORDER BY rank ASC').all(campaignId);
}

// ---------------------------------------------------------------------------
// Campaign lifecycle
// ---------------------------------------------------------------------------

function requireCampaign(id) {
  const row = getCampaign(id);
  if (!row) throw fail('CAMPAIGN_NOT_FOUND', `No campaign ${id}`);
  return row;
}

/**
 * The single entry point for a campaign state change.
 *
 * Named wrappers (`activateCampaign`, `closeCampaign`) exist below and are
 * what callers should reach for; this is exposed because the transition table
 * is the invariant, and a rule that can only be exercised through two
 * convenience functions is a rule with untested corners.
 */
export function setCampaignState(id, nextState, { reason = null, at = utcNow() } = {}) {
  if (!CAMPAIGN_STATES.includes(nextState)) {
    throw fail('INVALID_STATE', `Unknown campaign state "${nextState}"`);
  }
  const row = requireCampaign(id);

  // Idempotent no-op. Writes nothing, so `closed_at` and `close_reason` keep
  // dating the transition that actually happened.
  if (row.state === nextState) return { ...row, changed: false };

  if (!CAMPAIGN_TRANSITIONS[row.state].includes(nextState)) {
    throw fail(
      'ILLEGAL_TRANSITION',
      `A campaign cannot go from ${row.state} to ${nextState}`
      + (CAMPAIGN_TRANSITIONS[row.state].length
        ? ` (allowed: ${CAMPAIGN_TRANSITIONS[row.state].join(', ')})`
        : ` — ${row.state} is terminal`),
    );
  }

  if (nextState === 'active') return activate(row, at);
  return close(row, reason, at);
}

function activate(row, at) {
  /**
   * Checked here so the caller gets a sentence rather than
   * "UNIQUE constraint failed: campaigns.athlete_id".
   *
   * The partial unique index remains the real protection and is NOT
   * redundant: this read and the write below are two statements, and the
   * catch beneath closes the window between them. A check without the index
   * would be a race; an index without the check would be an opaque error.
   */
  const conflict = activeCampaignForAthlete(row.athlete_id);
  if (conflict) {
    throw fail(
      'CAMPAIGN_ACTIVE_CONFLICT',
      `${row.athlete_id} already has an active campaign (${conflict.id}). `
      + 'Close it before activating another — an athlete runs one campaign at a time.',
    );
  }
  try {
    db.prepare("UPDATE campaigns SET state = 'active', updated_at = ? WHERE id = ?").run(at, row.id);
  } catch (err) {
    if (String(err.code).startsWith('SQLITE_CONSTRAINT_UNIQUE')) {
      throw fail(
        'CAMPAIGN_ACTIVE_CONFLICT',
        `${row.athlete_id} already has an active campaign. `
        + 'Close it before activating another — an athlete runs one campaign at a time.',
      );
    }
    throw err;
  }
  return { ...getCampaign(row.id), changed: true };
}

/**
 * Closing REQUIRES a reason.
 *
 * A campaign that ended for no recorded reason is unreadable a year later, and
 * "did this athlete commit, or did we give up" is the first question anybody
 * asks of a closed campaign. The vocabulary lives in `CLOSE_REASONS` here
 * rather than in a CHECK constraint, so adding to it is a one-line change.
 */
function close(row, reason, at) {
  if (!reason) {
    throw fail(
      'CLOSE_REASON_REQUIRED',
      `Closing a campaign needs a reason (one of: ${CLOSE_REASONS.join(', ')})`,
    );
  }
  if (!CLOSE_REASONS.includes(reason)) {
    throw fail(
      'UNKNOWN_CLOSE_REASON',
      `Unknown close reason "${reason}" (expected one of: ${CLOSE_REASONS.join(', ')})`,
    );
  }
  db.prepare(`
    UPDATE campaigns SET state = 'closed', closed_at = ?, close_reason = ?, updated_at = ? WHERE id = ?
  `).run(at, reason, at, row.id);
  return { ...getCampaign(row.id), changed: true };
}

/**
 * The operator-authored fields of an existing campaign: its name and its
 * service boundaries. Nothing else.
 *
 * IT VALIDATES THE MERGED RESULT, not the incoming fields. A campaign running
 * 1 September to 7 October, patched with `starts_on: 2026-10-10` alone, is a
 * perfectly well-formed field and an impossible campaign — so the current row
 * is read, the change applied on top, and the whole set put through the same
 * rule creation uses. There is one date rule and this is not a second copy of it.
 *
 * Deliberately CANNOT change state: lifecycle goes through
 * `setCampaignState` and its transition table, so a detail edit can never
 * activate or close anything. Nor can it reach the snapshot — `athlete_id`,
 * `sport`, `source_analysis_ref`, `snapshot_taken_at`, `matching_inputs` and
 * `programme_count` are absent from the update by construction rather than by
 * a filter somebody has to maintain.
 *
 * `undefined` leaves a field alone; an explicit `null` clears an end date,
 * which is how an open-ended campaign is expressed. Those are different
 * requests and the distinction is deliberate.
 */
export function updateCampaignDetails(id, changes = {}, { at = utcNow() } = {}) {
  const row = requireCampaign(id);

  const next = {
    label: 'label' in changes
      ? (typeof changes.label === 'string' && changes.label.trim() ? changes.label.trim() : null)
      : row.label,
    starts_on: 'starts_on' in changes && changes.starts_on != null ? changes.starts_on : row.starts_on,
    outreach_ends_on: 'outreach_ends_on' in changes ? changes.outreach_ends_on : row.outreach_ends_on,
    ends_on: 'ends_on' in changes ? changes.ends_on : row.ends_on,
  };

  // Throws before anything is written, so a refused edit leaves the campaign
  // exactly as it was.
  const dates = validateCampaignDates(next);

  db.prepare(`
    UPDATE campaigns
    SET label = ?, starts_on = ?, outreach_ends_on = ?, ends_on = ?, updated_at = ?
    WHERE id = ?
  `).run(next.label, dates.starts_on, dates.outreach_ends_on, dates.ends_on, at, id);

  return { ...getCampaign(id), changed: true };
}

export function activateCampaign(id, opts = {}) {
  return setCampaignState(id, 'active', opts);
}

/**
 * Nothing closes a campaign on `ends_on` passing. That date is a planned
 * boundary an operator set, and acting on it is a service-lifecycle decision
 * belonging to a scheduler that does not exist. A campaign stays open until
 * somebody closes it, which is at least a state we can explain.
 */
export function closeCampaign(id, { reason, at = utcNow() } = {}) {
  return setCampaignState(id, 'closed', { reason, at });
}

// ---------------------------------------------------------------------------
// Programme campaign lifecycle
// ---------------------------------------------------------------------------

function requireProgrammeCampaign(id) {
  const row = getProgrammeCampaign(id);
  if (!row) throw fail('PROGRAMME_CAMPAIGN_NOT_FOUND', `No programme campaign ${id}`);
  return row;
}

/**
 * The single entry point for a programme's state.
 *
 * `state_reason` is a property of being STOPPED, not a history: it answers
 * "why is outreach to this programme not running", and the schema comment
 * says exactly that. So it is written only on entry to `stopped` and cleared
 * on every other transition — a `completed` row inheriting "not_recruiting"
 * from a stop three weeks ago would be a sentence the database asserts and
 * nobody wrote. Anything wanting the full history of stops and restarts wants
 * an event log, which is not this and is not yet asked for.
 */
export function setProgrammeCampaignState(id, nextState, { reason = null, at = utcNow() } = {}) {
  if (!PROGRAMME_CAMPAIGN_STATES.includes(nextState)) {
    throw fail('INVALID_STATE', `Unknown programme campaign state "${nextState}"`);
  }
  const row = requireProgrammeCampaign(id);

  if (row.state === nextState) return { ...row, changed: false };

  if (!PROGRAMME_TRANSITIONS[row.state].includes(nextState)) {
    throw fail(
      'ILLEGAL_TRANSITION',
      `A programme campaign cannot go from ${row.state} to ${nextState}`
      + (PROGRAMME_TRANSITIONS[row.state].length
        ? ` (allowed: ${PROGRAMME_TRANSITIONS[row.state].join(', ')})`
        : ` — ${row.state} is terminal`),
    );
  }

  let nextReason = null;
  if (nextState === 'stopped') {
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    if (!trimmed) {
      throw fail(
        'STOP_REASON_REQUIRED',
        'Stopping outreach to a programme needs a reason — a stop nobody can explain '
        + `cannot be reviewed or reversed (known reasons: ${KNOWN_STOP_REASONS.join(', ')})`,
      );
    }
    nextReason = trimmed;
  }

  db.prepare(`
    UPDATE programme_campaigns
    SET state = ?, state_reason = ?, state_changed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(nextState, nextReason, at, at, id);

  return { ...getProgrammeCampaign(id), changed: true };
}

/** Named moves. Thin, so the transition table stays the only rule. */
export const startProgrammeCampaign = (id, opts = {}) => setProgrammeCampaignState(id, 'active', opts);
export const stopProgrammeCampaign = (id, { reason, at = utcNow() } = {}) =>
  setProgrammeCampaignState(id, 'stopped', { reason, at });
export const completeProgrammeCampaign = (id, opts = {}) => setProgrammeCampaignState(id, 'completed', opts);

// ---------------------------------------------------------------------------
// Tier assignment
// ---------------------------------------------------------------------------

/**
 * An operator promotes or demotes a programme.
 *
 * Touches `tier`, `tier_source` and `tier_set_at` and NOTHING ELSE. `rank`,
 * `match_score`, `score_breakdown`, `college_name`, `sport`, `college_id`,
 * `division` and `conference` are the snapshot, and the entire reason rank is
 * stored separately from tier is that #62 can be promoted to Tier A without
 * rewriting where the model put it. A promotion that moved the rank would
 * destroy the only record of the disagreement.
 */
export function setProgrammeTier(id, tier, { at = utcNow() } = {}) {
  if (!TIERS.includes(tier)) {
    throw fail('INVALID_TIER', `Unknown tier "${tier}" (expected one of: ${TIERS.join(', ')})`);
  }
  const row = requireProgrammeCampaign(id);

  /**
   * An operator setting the tier the band already chose still records that a
   * human chose it — `tier_source` becomes OPERATOR. This is NOT the
   * same-state no-op above: state is a lifecycle position, whereas who decided
   * a tier is itself the fact being recorded, and "the operator confirmed the
   * band" is different information from "nobody looked".
   */
  db.prepare(`
    UPDATE programme_campaigns
    SET tier = ?, tier_source = 'OPERATOR', tier_set_at = ?, updated_at = ?
    WHERE id = ?
  `).run(tier, at, at, id);

  return { ...getProgrammeCampaign(id), changed: true, previousTier: row.tier };
}

/**
 * Put a programme back where the model put it.
 *
 * Without this an override is effectively irreversible, because undoing it by
 * hand means re-deriving the band somewhere else — and a second copy of the
 * banding rule is how the two would drift apart. It derives from the
 * IMMUTABLE `rank`, which is exactly what the snapshot is for.
 */
export function restoreAutoTier(id, { at = utcNow() } = {}) {
  const row = requireProgrammeCampaign(id);
  const tier = tierForRank(row.rank);
  db.prepare(`
    UPDATE programme_campaigns
    SET tier = ?, tier_source = 'AUTO', tier_set_at = ?, updated_at = ?
    WHERE id = ?
  `).run(tier, at, at, id);
  return { ...getProgrammeCampaign(id), changed: true, previousTier: row.tier };
}

// ---------------------------------------------------------------------------
// Creation — freezing a stored analysis into a campaign
// ---------------------------------------------------------------------------

/**
 * WHERE UPLOADED ANALYSES LIVE — the one declaration, shared with the route
 * that writes them and the static mount that serves them.
 *
 * It used to be declared here as well as in server/index.js, which is how two
 * copies of a security boundary come to disagree. `server/lib/uploadPath.js`
 * owns it now, along with the write-side containment rule; this module keeps
 * its own, separate read-side guard below, because what we are willing to
 * write and what we are willing to open are different questions.
 */

/**
 * A FINGERPRINT OF A STORED BLOB, deliberately not imported from
 * shared/matching/weights.js.
 *
 * It identifies which model produced a recommendation list by the shape of
 * what was stored. Importing the live criterion list would mean a future
 * change to the model retroactively changed how a five-year-old snapshot is
 * identified — the opposite of what a fingerprint is for. It is frozen here on
 * purpose and must not be "kept in step" with the matcher.
 */
const SIX_CRITERION_KEYS = Object.freeze([
  'athletic', 'roster', 'academic', 'affordability', 'programQuality', 'geography',
]);

export const MATCHING_MODEL_SIX_CRITERION = 'SIX_CRITERION_V1';
export const MATCHING_MODEL_UNKNOWN = 'UNKNOWN';

/**
 * The most programmes a campaign can freeze.
 *
 * Not an arbitrary cap: `tierForRank` has no band above `MAX_RANK`, so a
 * 101st programme would have to be given a tier no rule chose.
 */
const MAX_PROGRAMMES = MAX_RANK;

/** Control characters have no business in a filename and are refused outright. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Resolve `players.recommendations` to a file inside the upload store, or
 * refuse.
 *
 * A DATABASE VALUE IS NOT A SAFE PATH. This one is built from a filename the
 * browser supplied, so it must be treated as untrusted: the store is flat, so
 * anything carrying a separator, a parent segment or a scheme is refused
 * outright rather than normalised into something that looks acceptable. The
 * realpath check afterwards is the belt to those braces — it also catches a
 * symlink pointing out of the store, which no amount of string inspection
 * would.
 *
 * The browser's own loader (src/pages/player/PlayerWorkspace.jsx) additionally
 * accepts an http(s) URL and a raw JSON string. Neither is accepted here: the
 * server must not fetch a URL a database row names, and no row in existence
 * carries inline JSON.
 */
export function resolveAnalysisPath(ref) {
  if (typeof ref !== 'string' || !ref.startsWith(UPLOAD_URL_PREFIX)) {
    throw fail('ANALYSIS_REF_UNSAFE',
      `A stored analysis must be an upload reference beginning "${UPLOAD_URL_PREFIX}", got ${JSON.stringify(ref)}`);
  }
  const name = ref.slice(UPLOAD_URL_PREFIX.length);
  if (!name || name.includes('/') || name.includes('\\') || CONTROL_CHARS.test(name)
      || name === '.' || name === '..' || path.basename(name) !== name) {
    throw fail('ANALYSIS_REF_UNSAFE', `Unsafe stored-analysis reference ${JSON.stringify(ref)}`);
  }
  const resolved = path.resolve(UPLOADS_DIR, name);
  if (resolved !== path.join(UPLOADS_DIR, name) || !resolved.startsWith(UPLOADS_DIR + path.sep)) {
    throw fail('ANALYSIS_REF_UNSAFE', `Stored-analysis reference escapes the upload store: ${JSON.stringify(ref)}`);
  }
  if (!fs.existsSync(resolved)) {
    throw fail('ANALYSIS_FILE_MISSING',
      `The stored analysis ${ref} is no longer on disk. Re-run the match analysis before creating a campaign.`);
  }
  // Follows symlinks, so a link inside the store pointing outside it is caught
  // where the string checks above cannot see it.
  const real = fs.realpathSync(resolved);
  if (real !== resolved && !real.startsWith(fs.realpathSync(UPLOADS_DIR) + path.sep)) {
    throw fail('ANALYSIS_REF_UNSAFE',
      `Stored-analysis reference resolves outside the upload store: ${JSON.stringify(ref)}`);
  }
  return resolved;
}

/**
 * Which model produced this list, INFERRED from what was stored.
 *
 * The analysis never recorded its own version — there is no such field in any
 * blob on disk — so this is an inference from shape and says so. Of the 98
 * stored analyses, 39 carry neither a `breakdown` nor a college `id` on any
 * row: those predate the six-criterion model and cannot be identified further,
 * so they are UNKNOWN rather than assigned a version they may not have had.
 */
function identifyModel(recommendations) {
  const shaped = recommendations.filter((r) => {
    if (!Array.isArray(r.breakdown) || r.breakdown.length === 0) return false;
    const keys = r.breakdown.map((b) => b && b.key);
    return SIX_CRITERION_KEYS.every((k) => keys.includes(k));
  }).length;

  if (shaped === recommendations.length) {
    return {
      id: MATCHING_MODEL_SIX_CRITERION,
      identifiedBy: 'RECOMMENDATION_BREAKDOWN_SHAPE',
      criteria: [...SIX_CRITERION_KEYS],
      note: 'Inferred from the stored breakdown, not recorded by the analysis run.',
    };
  }
  return {
    id: MATCHING_MODEL_UNKNOWN,
    identifiedBy: shaped === 0 ? 'NO_BREAKDOWN_STORED' : 'MIXED_BREAKDOWN_SHAPES',
    criteria: null,
    note: 'The stored analysis carries no per-criterion breakdown this code recognises. '
      + 'No version is asserted, because none was ever recorded.',
  };
}

/** JSON columns arrive as strings or as already-parsed values; neither may throw. */
function safeJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

/**
 * Everything that can honestly be said about how this ranking was produced.
 *
 * THREE KINDS OF FACT, KEPT APART, because merging them would be the exact
 * fabrication this field exists to prevent:
 *
 *   analysis     HISTORICAL. Read out of the stored blob itself. The summary is
 *                kept verbatim rather than parsed — it is the analysis's own
 *                account of itself, and it states the eligible-pool size in
 *                prose that would be a guess to extract.
 *   athlete      SNAPSHOT-TIME. Read from `players` at creation, NOT from the
 *                analysis run. Believed to be the inputs, because the only edit
 *                path in the product nulls `recommendations` on save — so a
 *                surviving pointer means the profile has not been edited
 *                through the UI since. That is an argument, not a guarantee,
 *                and it is recorded as such rather than promoted to history.
 *   unavailable  NEVER RECORDED. Named individually with the reason, so a
 *                reader can tell "we did not keep this" from "this was absent".
 */
function buildMatchingInputs({ athlete, analysis, ref, count, derived = null }) {
  return {
    schema: 'campaign-matching-inputs/2',
    model: identifyModel(analysis.recommendations),
    analysis: {
      provenance: 'HISTORICAL',
      source_analysis_ref: ref,
      // Verbatim. It states the eligible pool and what the filters removed.
      summary: typeof analysis.summary === 'string' ? analysis.summary : null,
      returned: count,
    },

    /**
     * WHY THIS CAMPAIGN HOLDS WHAT IT HOLDS — schema 2.
     *
     * OPERATOR-TIME, a third provenance alongside HISTORICAL and
     * SNAPSHOT_TIME: these are decisions a person made about this athlete,
     * read when the campaign was frozen. Without them "why is Stanford not in
     * here" has no answer a year later, because the analysis still contains
     * Stanford and always will.
     *
     * `promoted` names the programmes that entered from the reserve AND THE
     * RANK THE MODEL GAVE THEM. That is the only place rank 101 survives: the
     * campaign row records the ACTIONABLE position, because that is what the
     * tier bands read, and the two numbers must not be confused.
     *
     * Absent entirely on a campaign frozen from an analysis this code could
     * not derive over, rather than present and zeroed — a zero here would
     * assert that nothing was suppressed.
     */
    actionable: derived ? {
      provenance: 'OPERATOR_TIME',
      note: 'Athlete-specific visibility decisions read from athlete_programmes when the '
        + 'campaign was frozen. The stored analysis is unchanged and still contains every '
        + 'programme named here.',
      suppressed_count: derived.suppressedCount,
      suppressed: derived.suppressedNames,
      promoted_count: derived.promoted.length,
      promoted: derived.promoted,
      actionable_count: derived.programmes.length,
      // TRUE when suppression outran the reserve, so the campaign holds fewer
      // than the athlete's analysis could have supplied. Recorded rather than
      // padded.
      reserve_exhausted: derived.exhausted,
      short_by: derived.shortfall,
    } : null,
    athlete: {
      provenance: 'SNAPSHOT_TIME',
      note: 'Read from the athlete row when the campaign was created, not recorded by the '
        + 'analysis run. Saving a profile clears players.recommendations, so a surviving '
        + 'pointer is evidence these were the inputs — not proof.',
      sport: athlete.sport ?? null,
      position: athlete.position ?? null,
      secondary_position: athlete.secondary_position ?? null,
      recruiting_class_year: athlete.recruiting_class_year ?? null,
      graduation_year: athlete.graduation_year ?? null,
      origin: athlete.origin ?? null,
      nationality: athlete.nationality ?? null,
      state: athlete.state ?? null,
      city: athlete.city ?? null,
      academic_minimum: athlete.academic_minimum ?? null,
      budget_range: athlete.budget_range ?? null,
      preferred_divisions: safeJson(athlete.preferred_divisions),
      preferred_conferences: safeJson(athlete.preferred_conferences),
      match_weights: safeJson(athlete.match_weights),
      criterion_ranking: safeJson(athlete.criterion_ranking),
    },
    unavailable: [
      { field: 'roster_season', why: 'The season the opportunity figures came from is not stored in the analysis.' },
      { field: 'pool_size', why: 'Not stored as a value. Stated in prose in analysis.summary.' },
      { field: 'excluded_counts', why: 'Not stored as values. Stated in prose in analysis.summary.' },
      { field: 'analysed_at', why: 'The analysis records no timestamp of its own; only snapshot_taken_at is known.' },
      {
        field: 'resolved_weights',
        why: 'The weights actually used were computed at run time and never persisted. '
          + 'athlete.match_weights and athlete.criterion_ranking are the inputs to that computation as they stand now.',
      },
    ],
  };
}

/**
 * Validate the stored analysis and turn it into rows, WITHOUT touching the
 * database. Everything that can be refused is refused here, so the transaction
 * below either writes a whole campaign or is never opened.
 */
function freezeRecommendations({ analysis, sport, at, actionable }) {
  /**
   * WHAT A CAMPAIGN FREEZES IS THE ACTIONABLE HUNDRED, NOT THE RAW ONE.
   *
   * `actionable` is the derived list — the stored analysis with this athlete's
   * suppressed programmes removed and reserve entries promoted in their place
   * (see shared/matching/visibleTop100.js). It is passed in rather than
   * derived here so that this function stays what it was: validation and row
   * building over a list somebody else decided on.
   *
   * The SHAPE IS UNCHANGED. Array order is still the ranking, rank is still
   * index + 1, and the cap below still refuses anything over MAX_PROGRAMMES —
   * a promoted programme enters the campaign at its ACTIONABLE position, never
   * at 101, because the tier bands stop at 100 and a rank with no band is a
   * tier no rule chose.
   */
  const list = actionable ?? (analysis && analysis.recommendations);
  if (!Array.isArray(list)) {
    throw fail('ANALYSIS_INVALID',
      'The stored analysis has no `recommendations` array — it is not a match analysis this can freeze.');
  }
  if (list.length === 0) {
    throw fail('ANALYSIS_EMPTY',
      'The stored analysis ranked no programmes. There is nothing to build a campaign from.');
  }
  if (list.length > MAX_PROGRAMMES) {
    throw fail('ANALYSIS_TOO_LARGE',
      `The stored analysis holds ${list.length} programmes and a campaign tiers at most ${MAX_PROGRAMMES}. `
      + 'Ranks beyond that have no band, and giving them one would be a tier no rule chose.');
  }

  const seen = new Set();
  return list.map((rec, index) => {
    const rank = index + 1;              // ARRAY ORDER IS THE RANKING. Never re-sorted.
    const where = `entry ${rank}`;

    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
      throw fail('ANALYSIS_INVALID', `${where} of the stored analysis is not a programme record.`);
    }
    const collegeName = typeof rec.name === 'string' ? rec.name.trim() : '';
    if (!collegeName) {
      throw fail('ANALYSIS_INVALID', `${where} of the stored analysis has no programme name.`);
    }
    /**
     * A score that is null, a float or a string is refused rather than coerced.
     * One orphaned blob on disk carries `match_score: null` on all 100 rows;
     * rounding or defaulting it would put a number in the record that the
     * analysis never produced.
     */
    if (!Number.isInteger(rec.match_score)) {
      throw fail('ANALYSIS_INVALID',
        `${where} (${collegeName}) has match_score ${JSON.stringify(rec.match_score)}, which is not an integer. `
        + 'A campaign records the score that was given, never one this code invented.');
    }

    const key = `${collegeName} ${sport}`;
    if (seen.has(key)) {
      throw fail('ANALYSIS_INVALID',
        `${collegeName} appears twice in the stored analysis. A programme is in a campaign once.`);
    }
    seen.add(key);

    // Present on six-criterion analyses, absent on the 39 older ones. Absent
    // is stored as absent.
    const breakdown = Array.isArray(rec.breakdown) && rec.breakdown.length ? rec.breakdown : null;
    const labels = rec.labels && typeof rec.labels === 'object' ? rec.labels : null;
    const confidence = typeof rec.confidence === 'string' ? rec.confidence : null;

    return {
      id: randomUUID(),
      college_name: collegeName,
      // The campaign's own snapshotted sport, not anything on the record: a
      // recommendation carries no sport, and the athlete plays one.
      sport,
      college_id: typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim() : null,
      rank,
      match_score: rec.match_score,
      score_breakdown: breakdown || labels || confidence
        ? JSON.stringify({ breakdown, labels, confidence })
        : null,
      division: typeof rec.division === 'string' ? rec.division : null,
      conference: typeof rec.conference === 'string' ? rec.conference : null,
      tier: tierForRank(rank),
      tier_source: 'AUTO',
      tier_set_at: at,
      state: 'queued',
      state_reason: null,
      state_changed_at: null,
      created_at: at,
      updated_at: at,
    };
  });
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in YYYY-MM-DD, with no timezone interpretation at all. */
function validDate(value, field) {
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) {
    throw fail('INVALID_DATE', `${field} must be a YYYY-MM-DD date, got ${JSON.stringify(value)}`);
  }
  // Round-trips through UTC so 2026-02-30 and 2026-13-01 are refused rather
  // than silently rolling into March and the following January.
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw fail('INVALID_DATE', `${field} is not a real date: ${value}`);
  }
  return value;
}

/**
 * THE DATE RULE, in one place, for creation and for every later edit.
 *
 * It validates a COMPLETE set rather than the fields somebody happens to be
 * changing. That distinction is the whole reason it is a function: a PATCH
 * moving `starts_on` to October on a campaign whose `ends_on` is already
 * September is a valid field and an impossible campaign, and a route checking
 * only what it received would accept it.
 *
 * `starts_on` is required; the two ends are optional and null means open.
 * Comparison is lexicographic, which is exact for YYYY-MM-DD and involves no
 * timezone, no clock and no locale.
 */
export function validateCampaignDates({ starts_on: startsOn, outreach_ends_on: outreachEndsOn = null, ends_on: endsOn = null }) {
  const starts = validDate(startsOn, 'starts_on');
  const outreachEnds = outreachEndsOn == null ? null : validDate(outreachEndsOn, 'outreach_ends_on');
  const ends = endsOn == null ? null : validDate(endsOn, 'ends_on');

  if (outreachEnds && outreachEnds < starts) {
    throw fail('INVALID_DATE_ORDER', `outreach_ends_on (${outreachEnds}) is before starts_on (${starts})`);
  }
  if (ends && ends < starts) {
    throw fail('INVALID_DATE_ORDER', `ends_on (${ends}) is before starts_on (${starts})`);
  }
  if (ends && outreachEnds && ends < outreachEnds) {
    throw fail('INVALID_DATE_ORDER', `ends_on (${ends}) is before outreach_ends_on (${outreachEnds})`);
  }
  return { starts_on: starts, outreach_ends_on: outreachEnds, ends_on: ends };
}

/**
 * CREATE A CAMPAIGN BY FREEZING THE ATHLETE'S CURRENT STORED ANALYSIS.
 *
 * This is the moment a mutable pointer becomes a durable record. Everything it
 * writes comes from the blob that pointer named and from the athlete row; it
 * re-runs nothing, re-scores nothing, and reads no college or roster table —
 * the ranking being frozen is the historical one, not today's answer to the
 * same question.
 *
 * Always opens in `draft`. Activation is a separate, deliberate act, so a
 * hundred programmes cannot become live outreach as a side effect of creation.
 *
 * ALL OR NOTHING. Validation happens entirely before the transaction opens, and
 * the parent row and every programme row are written inside one, so a failure
 * anywhere leaves no campaign behind.
 *
 * @returns {{campaign: object, programmes: object[]}} programmes in rank order.
 */
export function createCampaign(athleteId, {
  label = null, startsOn = null, outreachEndsOn = null, endsOn = null, at = utcNow(),
} = {}) {
  const athlete = db.prepare('SELECT * FROM players WHERE id = ?').get(athleteId);
  if (!athlete) throw fail('ATHLETE_NOT_FOUND', `No athlete ${athleteId}`);

  // Read ONCE, and every later step uses this exact value — so the campaign
  // records the analysis it actually froze, even if the pointer moves under it
  // a moment later.
  const ref = athlete.recommendations;
  if (!ref) {
    throw fail('NO_STORED_ANALYSIS',
      `${athlete.full_name || athleteId} has no stored match analysis. `
      + 'Run Find Matches before creating a campaign.');
  }

  const file = resolveAnalysisPath(ref);
  let analysis;
  try {
    analysis = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw fail('ANALYSIS_UNREADABLE', `The stored analysis ${ref} could not be read: ${err.message}`);
  }
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) {
    throw fail('ANALYSIS_INVALID', `The stored analysis ${ref} is not an analysis object.`);
  }

  // The athlete's sport, snapshotted. The athlete row is mutable and a sport
  // changed later must not re-interpret these programme rows.
  const sport = athlete.sport || 'mens-soccer';

  /**
   * THE ACTIONABLE HUNDRED, DERIVED AT FREEZE TIME.
   *
   * The stored analysis is the model's answer and is not edited to make a
   * campaign work: what this reads is the same blob as before, plus the
   * athlete's own visibility decisions out of `athlete_programmes`. A school
   * the operator removed from this athlete's Top 100 does not enter their
   * campaign, and the next programme the model ranked takes the slot.
   *
   * Derived HERE and not inside freezeRecommendations so the audit metadata
   * below can describe what the derivation did.
   */
  const suppressedNames = suppressedProgrammesForAthlete(athlete.id, sport);
  const derived = visibleTop100({
    recommendations: Array.isArray(analysis.recommendations) ? analysis.recommendations : [],
    reserve: readReserve(analysis),
    suppressed: new Set(suppressedNames),
  });
  const programmes = freezeRecommendations({
    analysis, sport, at,
    // Only when the analysis is shaped as one — an unusable blob must still
    // reach freezeRecommendations' own refusals rather than be turned into an
    // empty list here.
    actionable: Array.isArray(analysis.recommendations) ? derived.programmes : undefined,
  });

  const { starts_on: starts, outreach_ends_on: outreachEnds, ends_on: ends } =
    validateCampaignDates({
      starts_on: startsOn ?? at.slice(0, 10),
      outreach_ends_on: outreachEndsOn,
      ends_on: endsOn,
    });

  const campaign = {
    id: randomUUID(),
    athlete_id: athlete.id,
    sport,
    label: typeof label === 'string' && label.trim() ? label.trim() : null,
    // NEVER 'active'. Review, then activate.
    state: 'draft',
    starts_on: starts,
    outreach_ends_on: outreachEnds,
    ends_on: ends,
    created_at: at,
    updated_at: at,
    closed_at: null,
    close_reason: null,
    source_analysis_ref: ref,
    snapshot_taken_at: at,
    matching_inputs: JSON.stringify(
      buildMatchingInputs({ athlete, analysis, ref, count: programmes.length, derived }),
    ),
    // What was ACTUALLY frozen, not what a Top 100 is meant to hold. Of the 98
    // analyses on disk, counts of 6, 27, 46, 50 and 53 all occur legitimately
    // where division and conference filters left a smaller eligible pool.
    programme_count: programmes.length,
  };

  const insertCampaign = db.prepare(`
    INSERT INTO campaigns (
      id, athlete_id, sport, label, state, starts_on, outreach_ends_on, ends_on,
      created_at, updated_at, closed_at, close_reason,
      source_analysis_ref, snapshot_taken_at, matching_inputs, programme_count
    ) VALUES (
      @id, @athlete_id, @sport, @label, @state, @starts_on, @outreach_ends_on, @ends_on,
      @created_at, @updated_at, @closed_at, @close_reason,
      @source_analysis_ref, @snapshot_taken_at, @matching_inputs, @programme_count
    )
  `);
  const insertProgramme = db.prepare(`
    INSERT INTO programme_campaigns (
      id, campaign_id, college_name, sport, college_id, rank, match_score, score_breakdown,
      division, conference, tier, tier_source, tier_set_at,
      state, state_reason, state_changed_at, created_at, updated_at
    ) VALUES (
      @id, @campaign_id, @college_name, @sport, @college_id, @rank, @match_score, @score_breakdown,
      @division, @conference, @tier, @tier_source, @tier_set_at,
      @state, @state_reason, @state_changed_at, @created_at, @updated_at
    )
  `);

  db.transaction(() => {
    insertCampaign.run(campaign);
    for (const p of programmes) insertProgramme.run({ ...p, campaign_id: campaign.id });
  })();

  return { campaign: getCampaign(campaign.id), programmes: listProgrammeCampaigns(campaign.id) };
}
