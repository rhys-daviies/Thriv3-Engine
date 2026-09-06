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
 * WHAT THIS MODULE DOES NOT DO, and must not grow into: it does not read
 * `players.recommendations`, does not create campaigns or snapshot a match
 * list, does not touch `outreach` or `outreach_send`, does not choose coaches,
 * does not send, does not schedule, and stores no counters. Creation is the
 * next slice; the rest are later phases.
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
import db from '../db/client.js';
import { utcNow } from './time.js';

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
