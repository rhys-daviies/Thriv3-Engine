import express from 'express';
import {
  createCampaign, updateCampaignDetails,
  activateCampaign, closeCampaign, setCampaignState,
  setProgrammeTier, restoreAutoTier, setProgrammeCampaignState,
  getCampaign, listCampaignsForAthlete, getProgrammeCampaign, listProgrammeCampaigns,
  CAMPAIGN_STATES, PROGRAMME_CAMPAIGN_STATES, TIERS,
} from '../lib/campaigns.js';
import { campaignExecutionPlan } from '../lib/campaignExecution.js';
import {
  executeProgrammeMessage, reattemptExecution, EXECUTION_REFUSAL,
} from '../lib/executeProgrammeMessage.js';
import { RETRY_REFUSAL } from '../lib/executionRetry.js';
import { executionReadiness } from '../lib/executionReadiness.js';
import { CLAIM_REFUSAL } from '../lib/executionClaim.js';
import { BUDGET_REFUSAL } from '../lib/outboundBudget.js';
import {
  programmePursuitPlan, materialiseNextContactAttempt, PREPARATION_REFUSAL,
} from '../lib/pursuitPolicy.js';
import { CONTACT_REFUSAL } from '../lib/campaignAttribution.js';
import {
  generateProgrammeMessage, GENERATION_REFUSAL,
} from '../lib/programmeMessageGeneration.js';
import {
  programmeMessageWithContext, editProgrammeMessage, reviewProgrammeMessage,
} from '../lib/programmeMessages.js';
import {
  approveFirstTouch, existingApproval, APPROVAL_STATUS,
} from '../lib/firstTouchApprovals.js';

/**
 * THE CAMPAIGN API — a doorway, not a second data layer.
 *
 * Every mutation here delegates to `server/lib/campaigns.js`, which owns the
 * invariants. This module's own job is the three things a library cannot do
 * for itself: decide what a request is ALLOWED to say, map a domain failure to
 * a status code, and decide what leaves the building.
 *
 * `campaigns` and `programme_campaigns` are deliberately absent from the
 * `ENTITIES` registry in server/index.js. That registry is unvalidated
 * pass-through CRUD; through it a client could PUT a new `rank`, `match_score`
 * or `snapshot_taken_at` and rewrite what a campaign says happened. The whole
 * point of the snapshot is that it cannot be rewritten, so the only way in is
 * the allow-lists below.
 *
 * ---------------------------------------------------------------------------
 * ALLOW-LISTS REFUSE, THEY DO NOT IGNORE.
 *
 * An unknown or immutable field is a 400 naming it, never a silent drop. A
 * client that believes it just changed `match_score` and got a 200 has been
 * told something false, and the next thing it does is built on that.
 * ---------------------------------------------------------------------------
 */

export const campaignsRouter = express.Router();

// ---------------------------------------------------------------------------
// What a request may say
// ---------------------------------------------------------------------------

/** Operator-authored at creation. `sport` is NOT here: it comes from the athlete. */
const CREATE_FIELDS = Object.freeze(['label', 'starts_on', 'outreach_ends_on', 'ends_on']);

/** Operator-authored afterwards, plus the lifecycle pair. */
const CAMPAIGN_PATCH_FIELDS = Object.freeze([
  'label', 'starts_on', 'outreach_ends_on', 'ends_on', 'state', 'close_reason',
]);
const CAMPAIGN_DETAIL_FIELDS = Object.freeze(['label', 'starts_on', 'outreach_ends_on', 'ends_on']);

const PROGRAMME_PATCH_FIELDS = Object.freeze(['tier', 'tier_source', 'state', 'state_reason']);

/**
 * Named so the refusal can say WHY, rather than "unknown field".
 *
 * Every one of these is either snapshot — frozen when the campaign was created
 * and the reason it is worth anything later — or derived. A client asking to
 * change one has misunderstood what a campaign is, and the message says so.
 */
const IMMUTABLE_FIELDS = Object.freeze({
  id: 'assigned at creation',
  campaign_id: 'a programme belongs to the campaign that froze it',
  athlete_id: 'a campaign belongs to the athlete it was created for',
  sport: 'snapshotted from the athlete at creation',
  source_analysis_ref: 'names the analysis this campaign froze',
  snapshot_taken_at: 'dates the freeze',
  matching_inputs: 'records how the ranking was produced',
  programme_count: 'counts what was actually frozen',
  created_at: 'dates the record',
  updated_at: 'maintained by the server',
  closed_at: 'set by closing the campaign, not by editing it',
  rank: 'the snapshotted position in the ranked list',
  match_score: 'the score as it was given',
  score_breakdown: 'the scoring as it was given',
  college_name: 'the programme identity as it was frozen',
  college_id: 'the programme identity as it was frozen',
  division: 'snapshotted; divisions change and the campaign records what was true',
  conference: 'snapshotted; conferences realign and the campaign records what was true',
  tier_set_at: 'set by changing the tier, not by editing it',
  state_changed_at: 'set by a state change, not by editing it',
  // Things a client might try to send from a match list.
  recommendations: 'a campaign freezes the stored analysis; it is never posted one',
  programmes: 'programme rows come from the snapshot, never from a request',
  programme_campaigns: 'programme rows come from the snapshot, never from a request',
});

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

/**
 * The body may name these fields and no others.
 *
 * Immutable names get their own sentence, because "unknown field: match_score"
 * reads like a typo when the truth is that the field exists and is history.
 */
function readBody(body, allowed, what) {
  if (body === null || body === undefined) return {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest(`A ${what} request body must be an object.`);
  }
  const offered = Object.keys(body);
  const immutable = offered.filter((k) => !allowed.includes(k) && k in IMMUTABLE_FIELDS);
  if (immutable.length) {
    throw badRequest(
      `Cannot change ${immutable.join(', ')}: `
      + immutable.map((k) => `${k} ${IMMUTABLE_FIELDS[k]}`).join('; ')
      + '. A campaign records what happened and is not rewritten.',
    );
  }
  const unknown = offered.filter((k) => !allowed.includes(k));
  if (unknown.length) {
    throw badRequest(`Unknown field(s) for a ${what} request: ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}.`);
  }
  return body;
}

// ---------------------------------------------------------------------------
// What leaves the building
// ---------------------------------------------------------------------------

/**
 * Explicit projections, never a row passed through.
 *
 * A column added to either table later does not silently become part of the
 * API, which matters most for a table whose whole purpose is to hold things
 * nobody may change.
 */
function campaignSummary(row) {
  return {
    id: row.id,
    athlete_id: row.athlete_id,
    sport: row.sport,
    label: row.label,
    state: row.state,
    starts_on: row.starts_on,
    outreach_ends_on: row.outreach_ends_on,
    ends_on: row.ends_on,
    programme_count: row.programme_count,
    snapshot_taken_at: row.snapshot_taken_at,
    source_analysis_ref: row.source_analysis_ref,
    created_at: row.created_at,
    updated_at: row.updated_at,
    closed_at: row.closed_at,
    close_reason: row.close_reason,
  };
}

/** The detail view adds the provenance, parsed so a reader need not unpick it. */
function campaignDetail(row) {
  let matchingInputs = null;
  if (row.matching_inputs) {
    try { matchingInputs = JSON.parse(row.matching_inputs); } catch { matchingInputs = null; }
  }
  return { ...campaignSummary(row), matching_inputs: matchingInputs };
}

/**
 * `tier` here is ALWAYS the campaign tier — A, B or C.
 *
 * It is not `engagement_rollup.tier`, which is a temperature (cold | warm |
 * hot | priority | responded) derived from what a coach did. Nothing in this
 * response joins engagement, and a test asserts no engagement field can appear
 * in it. When something does join the two, the fields must be named
 * `campaign_tier` and `engagement_tier` — one word answering two questions is
 * how the wrong one gets rendered.
 */
function programmeCampaign(row) {
  return {
    id: row.id,
    campaign_id: row.campaign_id,
    college_name: row.college_name,
    sport: row.sport,
    college_id: row.college_id,
    rank: row.rank,
    match_score: row.match_score,
    score_breakdown: row.score_breakdown,
    division: row.division,
    conference: row.conference,
    tier: row.tier,
    tier_source: row.tier_source,
    tier_set_at: row.tier_set_at,
    state: row.state,
    state_reason: row.state_reason,
    state_changed_at: row.state_changed_at,
  };
}

// ---------------------------------------------------------------------------
// Domain failure -> status code
// ---------------------------------------------------------------------------

/**
 * A TABLE, not a chain of message matches.
 *
 * `server/lib/campaigns.js` puts a machine-readable `code` on everything it
 * throws precisely so this can be a lookup. Matching on message text would
 * break the first time somebody improved a sentence.
 */
const STATUS_BY_CODE = Object.freeze({
  ATHLETE_NOT_FOUND: 404,
  CAMPAIGN_NOT_FOUND: 404,
  PROGRAMME_CAMPAIGN_NOT_FOUND: 404,

  // The athlete exists and the campaign is real; the request conflicts with
  // the state of the world, and the caller can fix it and retry.
  CAMPAIGN_ACTIVE_CONFLICT: 409,
  NO_STORED_ANALYSIS: 409,

  // Well-formed, and asking for something that is not allowed to be true.
  ILLEGAL_TRANSITION: 422,
  // F6d. Asking to approve a review that is not required, or naming a coach
  // this campaign is not pursuing.
  NO_REVIEW_REQUIRED: 422,
  COACH_NOT_IN_PURSUIT: 422,

  /**
   * F9b-2. Every way preparing a contact attempt can be refused.
   *
   * ALL 422, and none of them 409: the request is well-formed and names a real
   * programme campaign, and what it asks for is not allowed to be true right
   * now. A 409 would invite a retry, and retrying changes none of these — a
   * stance, a suppression, a closed campaign and an unreviewed first touch all
   * need somebody to do something else first.
   *
   * The B3 codes are quoted rather than re-spelled, so a refusal reaches a
   * client under the same name the safety layer gave it.
   */
  [PREPARATION_REFUSAL.FIRST_TOUCH_REVIEW_REQUIRED]: 422,
  [PREPARATION_REFUSAL.NO_ELIGIBLE_COACH]: 422,
  [PREPARATION_REFUSAL.NO_ACTION_TO_PREPARE]: 422,
  [CONTACT_REFUSAL.CAMPAIGN_NOT_ACTIVE]: 422,
  [CONTACT_REFUSAL.PROGRAMME_STOPPED]: 422,
  [CONTACT_REFUSAL.PROGRAMME_COMPLETED]: 422,
  [CONTACT_REFUSAL.OUTREACH_REVOKED]: 422,
  [CONTACT_REFUSAL.RELATIONSHIP_DO_NOT_CONTACT]: 422,
  [CONTACT_REFUSAL.RELATIONSHIP_MANUAL_ONLY]: 422,
  [CONTACT_REFUSAL.SUPPRESSED]: 422,

  /**
   * F10b-4. Generating, editing and reviewing a programme message.
   *
   * The generation refusals join the preparation ones above rather than getting
   * a block of their own, because they are the same kind of answer: the request
   * is well-formed and names real things, and what it asks for is not allowed to
   * be true. Every one of them needs somebody to do something else first, so
   * none is a 409 inviting a retry.
   *
   * PROGRAMME_MESSAGE_NOT_FOUND is a 404 and CONTACT_ATTEMPT_NOT_FOUND is not:
   * the first is a resource a caller asked for by id, the second is a thing the
   * campaign was expected to hold and does not.
   */
  [GENERATION_REFUSAL.CONTACT_ATTEMPT_REQUIRED]: 422,
  [GENERATION_REFUSAL.CONTACT_ATTEMPT_NOT_PLANNED]: 422,
  [GENERATION_REFUSAL.COACH_NO_LONGER_CURRENT]: 422,
  [GENERATION_REFUSAL.CONTACT_ATTEMPT_STEP_DRIFT]: 422,
  CONTACT_ATTEMPT_NOT_FOUND: 422,
  MESSAGE_ALREADY_GENERATED: 422,
  MESSAGE_NOT_EDITABLE: 422,
  REVIEWER_REQUIRED: 422,
  EMPTY_SUBJECT: 422,
  EMPTY_BODY: 422,
  ILLEGAL_MESSAGE_TRANSITION: 422,
  COMPOSITION_ATTEMPT_MISMATCH: 422,
  COMPOSITION_NOT_ATTRIBUTED: 422,
  INVALID_MESSAGE_STEP: 422,
  UNSUPPORTED_SEQUENCE_STEP: 422,
  PROGRAMME_MESSAGE_NOT_FOUND: 404,
  COACH_NOT_FOUND: 404,
  INVALID_STATE: 422,
  INVALID_TIER: 422,
  INVALID_RANK: 422,
  INVALID_DATE: 422,
  INVALID_DATE_ORDER: 422,
  CLOSE_REASON_REQUIRED: 422,
  UNKNOWN_CLOSE_REASON: 422,
  STOP_REASON_REQUIRED: 422,
  ANALYSIS_EMPTY: 422,
  ANALYSIS_TOO_LARGE: 422,
  ANALYSIS_INVALID: 422,

  /* ---- D4.9: sending a reviewed message ---------------------------------- */
  /**
   * THE STATUSES ARE CHOSEN TO DISCOURAGE A RETRY THAT COULD SEND TWICE.
   *
   * ===========================================================================
   * THE RULE: A REQUEST THAT REACHED A PROVIDER IS A 200, WHATEVER IT LEARNED.
   *
   * ACCEPTED, FAILED and UNKNOWN_PROVIDER_RESULT are all answered 200 with the
   * durable state in the body, and UNKNOWN especially. A 5xx for an ambiguous
   * send would invite the client, a proxy or a service worker to retry it —
   * and the one thing that must never be retried is a message that may already
   * be in a coach's inbox. The request succeeded; the outcome is the payload.
   * ===========================================================================
   *
   * 409 — the world is not as the caller believed, and they can look and retry:
   *      the review moved, this message has already gone, somebody else holds
   *      the claim, an earlier message to this coach is unresolved.
   *
   * 422 — well-formed, naming real things, and not allowed to be true. A retry
   *      changes none of them: a closed campaign, a suppression, a spent cap or
   *      budget, an unreviewed first touch, a revoked mailbox, a follow-up that
   *      is not due. Somebody has to do something else first.
   *
   * 503 — there is no transport. Nothing was claimed and no capacity was spent,
   *      and it is the server's condition rather than the request's, so this is
   *      the one refusal a client may reasonably retry later.
   */
  [EXECUTION_REFUSAL.MESSAGE_REVIEW_CHANGED]: 409,
  /* ---- D5.0: explicit re-execution of a proven non-send ------------------ */
  /**
   * 409, NOT 422, AND THE DIFFERENCE IS DELIBERATE. Each of these says the
   * execution is not in a state a re-attempt applies to — accepted, unresolved,
   * already in flight, a mailbox that is not the frozen one, or another open
   * message on the relationship. That is a conflict with the resource as it
   * stands, which a caller resolves by looking at it rather than by waiting.
   */
  /**
   * 404: THE EXECUTION IS NOT THERE. Answered like any other missing resource,
   * and before any policy refusal could imply that it is.
   */
  [RETRY_REFUSAL.EXECUTION_NOT_FOUND]: 404,
  [RETRY_REFUSAL.EXECUTION_NOT_RETRYABLE]: 409,
  [RETRY_REFUSAL.NO_PRE_TRANSPORT_EVIDENCE]: 409,
  [RETRY_REFUSAL.RETRY_CLAIM_LOST]: 409,
  [RETRY_REFUSAL.RETRY_MAILBOX_MISMATCH]: 409,
  [RETRY_REFUSAL.RELATIONSHIP_HAS_OPEN_MESSAGE]: 409,
  [RETRY_REFUSAL.EXECUTION_SNAPSHOT_INCOMPLETE]: 409,
  EXECUTION_RETRY_ARGUMENT_REQUIRED: 422,
  [CLAIM_REFUSAL.MESSAGE_ALREADY_EXECUTED]: 409,
  [CLAIM_REFUSAL.SEND_CLAIM_LOST]: 409,
  [CLAIM_REFUSAL.RELATIONSHIP_HAS_UNRESOLVED_SEND]: 409,

  [EXECUTION_REFUSAL.MESSAGE_NOT_REVIEWED]: 422,
  [CLAIM_REFUSAL.MESSAGE_NOT_REVIEWED]: 422,
  [CLAIM_REFUSAL.MESSAGE_NOT_CURRENT]: 422,
  [CLAIM_REFUSAL.RECIPIENT_EMAIL_CHANGED]: 422,
  [CLAIM_REFUSAL.NO_ACTION_TO_EXECUTE]: 422,
  [CLAIM_REFUSAL.SEND_CAP_REACHED]: 422,
  [CLAIM_REFUSAL.FOLLOW_UP_NOT_DUE]: 422,
  [CLAIM_REFUSAL.MAILBOX_NOT_FOUND]: 422,
  [CLAIM_REFUSAL.MAILBOX_NOT_CONNECTED]: 422,
  [CLAIM_REFUSAL.MAILBOX_ATHLETE_MISMATCH]: 422,
  [CLAIM_REFUSAL.MAILBOX_CREDENTIAL_MISSING]: 422,
  [BUDGET_REFUSAL.ATHLETE_DAILY_BUDGET_EXHAUSTED]: 422,
  [BUDGET_REFUSAL.MAILBOX_DAILY_BUDGET_EXHAUSTED]: 422,
  [BUDGET_REFUSAL.SENDING_IDENTITY_REQUIRED]: 422,
  [BUDGET_REFUSAL.MAILBOX_LIMIT_REQUIRED]: 422,
  EXECUTION_ARGUMENT_REQUIRED: 422,

  [EXECUTION_REFUSAL.TRANSPORT_NOT_CONFIGURED]: 503,
});

/**
 * Server-side data problems. The stored analysis is missing, unreadable or
 * points somewhere it should not — none of which the client did, and none of
 * whose detail the client may see.
 *
 * Their real messages carry the upload reference and, for the unsafe case,
 * whatever hostile string was in the database. Those are logged and replaced
 * with one sentence, because an error message is an exfiltration channel.
 */
const OPAQUE_CODES = Object.freeze({
  ANALYSIS_FILE_MISSING: 'The stored match analysis for this athlete could not be read. Re-run the match analysis and try again.',
  ANALYSIS_UNREADABLE: 'The stored match analysis for this athlete could not be read. Re-run the match analysis and try again.',
  ANALYSIS_REF_UNSAFE: 'The stored match analysis for this athlete could not be read. Re-run the match analysis and try again.',
});

/**
 * One handler for every route, so no endpoint can develop its own opinion
 * about what a 404 is.
 */
/**
 * ASYNC-SAFE SINCE D4.9, AND SYNCHRONOUS HANDLERS ARE UNAFFECTED.
 *
 * Every route here was synchronous, so `fn(req)` was destructured directly.
 * The execution endpoint cannot be: it claims, then awaits a transport, then
 * persists the result. Handed an async `fn`, the old form destructured a
 * Promise — `status` and `body` both undefined — and a rejection became an
 * unhandled promise rejection with no response ever written.
 *
 * `await` on a non-promise is the value itself, so the twenty-odd existing
 * routes behave exactly as before and their tests prove it. The catch now
 * covers a rejected promise as well as a throw, so there is still exactly one
 * place that decides what a 404 is, and exactly one response per request.
 */
function handle(label, fn) {
  return async (req, res) => {
    try {
      const { status = 200, body } = await fn(req);
      return res.status(status).json(body);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });

      if (err.code && err.code in OPAQUE_CODES) {
        console.error(`[${label}] ${err.code}: ${err.message}`);
        return res.status(500).json({ error: OPAQUE_CODES[err.code] });
      }
      const status = STATUS_BY_CODE[err.code];
      if (status) return res.status(status).json({ error: err.message, code: err.code });

      // Anything else — a SQLite constraint, a bug — is ours, and its text may
      // name a table, a column or a path. Logged in full, reported as nothing.
      console.error(`[${label}]`, err);
      return res.status(500).json({ error: 'Unexpected error.' });
    }
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Freeze the athlete's currently stored analysis into a draft campaign.
 *
 * The body carries the operator's four fields and nothing else. It does NOT
 * carry the Top 100: the server reads the athlete's own
 * `players.recommendations` and snapshots that, so what a campaign records is
 * what the product actually ranked rather than what a long-open browser tab
 * was holding. The same reasoning as `/api/players/:id/evidence`, which takes
 * programme names and recomputes every fact for itself.
 */
campaignsRouter.post('/players/:playerId/campaigns', handle('campaigns/create', (req) => {
  const body = readBody(req.body, CREATE_FIELDS, 'campaign creation');
  const { campaign, programmes } = createCampaign(req.params.playerId, {
    label: body.label ?? null,
    startsOn: body.starts_on ?? null,
    outreachEndsOn: body.outreach_ends_on ?? null,
    endsOn: body.ends_on ?? null,
  });
  return {
    status: 201,
    body: { campaign: campaignDetail(campaign), programmes: programmes.map(programmeCampaign) },
  };
}));

/**
 * Summaries only. A hundred programme rows per campaign, for an athlete with a
 * history of them, is a payload nobody asked for — the detail route exists for
 * the one campaign being looked at.
 */
campaignsRouter.get('/players/:playerId/campaigns', handle('campaigns/list', (req) => ({
  body: { campaigns: listCampaignsForAthlete(req.params.playerId).map(campaignSummary) },
})));

campaignsRouter.get('/campaigns/:id', handle('campaigns/get', (req) => {
  const campaign = getCampaign(req.params.id);
  if (!campaign) throw notFoundCampaign(req.params.id);
  return {
    body: {
      campaign: campaignDetail(campaign),
      // In snapshot rank order, always — see listProgrammeCampaigns.
      programmes: listProgrammeCampaigns(campaign.id).map(programmeCampaign),
    },
  };
}));

/**
 * WHAT THIS CAMPAIGN WOULD DO NEXT, AND WHAT IS STOPPING IT.
 *
 * READ-ONLY, AND THERE IS DELIBERATELY NO SIBLING THAT EXECUTES IT. No POST
 * /execute, no /send, no /process-next. The point of this endpoint is that the
 * plan can be inspected — by an operator, and by us — before anything is
 * permitted to act on it, and an execution endpoint shipped alongside it would
 * make that inspection a formality.
 *
 * Every field is computed on the way past and nothing is stored: opening this
 * a hundred times must not make the campaign different for having been looked
 * at. A test asserts the whole database is byte-identical across a request.
 *
 * THE SENDING MAILBOX COMES FROM SERVER CONFIG, never from the query. It is
 * what the budget is charged against, and letting a caller name it would let
 * them read — and eventually spend — against a mailbox of their choosing.
 *
 * `on_date` is accepted because campaign boundaries and follow-up eligibility
 * are timezone-free DATES, and an operator reviewing tomorrow's plan today is
 * a real thing to want. It is the same argument B3 takes, for the same reason.
 */
const EXECUTION_PLAN_QUERY = Object.freeze(['on_date']);

campaignsRouter.get('/campaigns/:id/execution-plan', handle('campaigns/execution-plan', (req) => {
  const unknown = Object.keys(req.query ?? {}).filter((k) => !EXECUTION_PLAN_QUERY.includes(k));
  if (unknown.length) {
    throw badRequest(
      `Unknown query parameter(s): ${unknown.join(', ')}. Allowed: ${EXECUTION_PLAN_QUERY.join(', ')}.`,
    );
  }
  const onDate = req.query?.on_date;
  if (onDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(onDate))) {
    throw badRequest('on_date must be a YYYY-MM-DD date.');
  }
  // 404 before anything is planned, so an unknown id costs nothing and leaks
  // nothing about what a hundred programmes would have said.
  if (!getCampaign(req.params.id)) throw notFoundCampaign(req.params.id);

  return {
    body: campaignExecutionPlan(req.params.id, ...(onDate ? [{ onDate }] : [])),
  };
}));

/**
 * ONE REQUEST EXPRESSES ONE KIND OF CHANGE.
 *
 * Either the operator's details (label and dates, in any combination) or a
 * lifecycle move — never both. They are separate operations in the data layer
 * and each is its own transaction, so a mixed request could apply one and fail
 * the other, leaving the caller with a 422 and a half-applied edit. Refusing
 * the mix costs a second request and removes the possibility.
 *
 * `state` never reaches an UPDATE. It is dispatched to the transition
 * functions, so the table in campaigns.js remains the only description of what
 * a campaign may do, and no route can grow a shortcut around it.
 */
campaignsRouter.patch('/campaigns/:id', handle('campaigns/patch', (req) => {
  const body = readBody(req.body, CAMPAIGN_PATCH_FIELDS, 'campaign update');
  const keys = Object.keys(body);
  if (!keys.length) throw badRequest('Nothing to change.');

  const details = keys.filter((k) => CAMPAIGN_DETAIL_FIELDS.includes(k));
  const lifecycle = keys.filter((k) => k === 'state' || k === 'close_reason');
  if (details.length && lifecycle.length) {
    throw badRequest(
      'A state change and a detail edit are separate requests. '
      + `Send ${details.join(', ')} and ${lifecycle.join(', ')} one at a time.`,
    );
  }
  if (!details.length && !('state' in body)) {
    throw badRequest('close_reason means nothing without a state change. Send state: "closed" with it.');
  }

  if (details.length) {
    return { body: { campaign: campaignDetail(updateCampaignDetails(req.params.id, body)) } };
  }

  const { state, close_reason: closeReason } = body;
  if (!CAMPAIGN_STATES.includes(state)) {
    throw badRequest(`Unknown campaign state "${state}". One of: ${CAMPAIGN_STATES.join(', ')}.`);
  }
  if (state !== 'closed' && closeReason !== undefined) {
    throw badRequest('close_reason applies only when closing a campaign.');
  }

  let result;
  if (state === 'active') result = activateCampaign(req.params.id);
  else if (state === 'closed') result = closeCampaign(req.params.id, { reason: closeReason });
  // 'draft' reaches the transition table and is refused there, which is where
  // the rule lives; the route does not get to have its own opinion about it.
  else result = setCampaignState(req.params.id, state);

  return { body: { campaign: campaignDetail(result), changed: result.changed } };
}));

/**
 * A programme campaign, addressed THROUGH its campaign.
 *
 * The parent in the URL is checked against the row's own `campaign_id`, so
 * `PATCH /campaigns/A/programmes/<a programme of B>` cannot reach into B. It
 * answers 404 rather than 403: a caller who guessed an id belonging to another
 * campaign learns nothing about whether it exists.
 *
 * ONE KIND OF CHANGE PER REQUEST, for the same reason as above: a tier change
 * and a state change are two operations and two transactions.
 */
campaignsRouter.patch('/campaigns/:campaignId/programmes/:programmeId', handle('campaigns/patch-programme', (req) => {
  const body = readBody(req.body, PROGRAMME_PATCH_FIELDS, 'programme update');
  const keys = Object.keys(body);
  if (!keys.length) throw badRequest('Nothing to change.');

  const row = getProgrammeCampaign(req.params.programmeId);
  if (!row || row.campaign_id !== req.params.campaignId) {
    const err = new Error(`No programme ${req.params.programmeId} in campaign ${req.params.campaignId}`);
    err.status = 404;
    throw err;
  }

  const tierChange = keys.filter((k) => k === 'tier' || k === 'tier_source');
  const stateChange = keys.filter((k) => k === 'state' || k === 'state_reason');
  if (tierChange.length && stateChange.length) {
    throw badRequest('A tier change and a state change are separate requests.');
  }

  if (tierChange.length) {
    const { tier, tier_source: tierSource } = body;
    /**
     * `tier_source` is a REQUEST TO RESTORE, not a value to write. An operator
     * may say "put this back where the model had it", which derives the tier
     * from the immutable rank; they may not declare that a tier they chose was
     * the model's, because that is the distinction the column exists to keep.
     */
    if (tierSource !== undefined) {
      if (tierSource !== 'AUTO') {
        throw badRequest(
          'tier_source may only be set to "AUTO", which restores the tier the rank bands give. '
          + 'It becomes "OPERATOR" by setting a tier, and is never declared directly.',
        );
      }
      if (tier !== undefined) {
        throw badRequest('Send either a tier or tier_source: "AUTO", not both.');
      }
      return { body: { programme: programmeCampaign(restoreAutoTier(req.params.programmeId)) } };
    }
    if (!TIERS.includes(tier)) {
      throw badRequest(`Unknown tier "${tier}". One of: ${TIERS.join(', ')}.`);
    }
    return { body: { programme: programmeCampaign(setProgrammeTier(req.params.programmeId, tier)) } };
  }

  const { state, state_reason: stateReason } = body;
  if (!('state' in body)) {
    throw badRequest('state_reason means nothing without a state change. It records why a programme stopped.');
  }
  if (!PROGRAMME_CAMPAIGN_STATES.includes(state)) {
    throw badRequest(`Unknown programme state "${state}". One of: ${PROGRAMME_CAMPAIGN_STATES.join(', ')}.`);
  }
  if (state !== 'stopped' && stateReason !== undefined) {
    throw badRequest('state_reason applies only when stopping outreach to a programme.');
  }
  // The requirement that a stop HAS a reason lives in the data layer, with the
  // rule that clears it on every other transition. Not restated here.
  const updated = setProgrammeCampaignState(req.params.programmeId, state, { reason: stateReason ?? null });
  return { body: { programme: programmeCampaign(updated), changed: updated.changed } };
}));

/**
 * "I HAVE SEEN THAT THIS ATHLETE ALREADY WROTE TO THIS COACH." — F6d.
 *
 * The one write that clears a first-touch review hold, and everything it
 * records is derived here rather than accepted: the programme campaign and its
 * coach from the pursuit plan, the history from the plan's own prior-contact
 * fact, and the approver from the session. THE REQUEST BODY IS NOT READ AT
 * ALL, which is what stops an approval being minted over history nobody looked
 * at, in somebody else's name.
 *
 * It refuses rather than quietly succeeding where there is nothing to approve:
 * an approval row for a coach with no prior contact would sit there waiting to
 * clear a hold that has not happened yet, and its snapshot would describe a
 * history that did not exist when it was written.
 *
 * APPROVING IS NOT SENDING. This clears one hold; every stance, suppression,
 * revocation and lifecycle rule is evaluated afterwards exactly as before, and
 * the campaign-local sequence is untouched — the message is still this
 * campaign's step one, because it is.
 */
campaignsRouter.post(
  '/programme-campaigns/:programmeCampaignId/coaches/:coachId/first-touch-approval',
  handle('campaigns/first-touch-approval', (req) => {
    const { programmeCampaignId, coachId } = req.params;

    /**
     * THE PLAN IS THE AUTHORITY, not a lookup of our own. It resolves the
     * programme campaign, chooses who this campaign would write to, loads the
     * prior-contact facts and decides whether a review is required — so an
     * approval can only ever be recorded for the coach and the history the
     * campaign machinery itself is holding on.
     */
    const plan = programmePursuitPlan({ programmeCampaignId });

    const coach = plan.coaches.find((c) => c.coachId === coachId);
    if (!coach) {
      const err = new Error(
        `Coach ${coachId} is not one this campaign would pursue at ${plan.programmeCampaign.collegeName}. `
        + 'A first-touch review belongs to a coach the campaign is actually planning to write to.',
      );
      err.code = 'COACH_NOT_IN_PURSUIT';
      throw err;
    }

    /**
     * ONLY THE COACH THE HOLD IS ABOUT. `firstTouchReview` is derived for the
     * plan's CURRENT coach, so approving anyone else would record a decision
     * that clears nothing — and would look, later, like a review that had been
     * given.
     */
    const isCurrent = plan.current?.coachId === coachId;

    /**
     * ALREADY REVIEWED, AND STILL CURRENT: nothing to decide, so nothing is
     * written. The existing row comes back unchanged rather than being
     * rewritten with a new time and a new approver — a second click must not
     * quietly reattribute somebody else's decision, and it is not an error
     * either, because what the caller asked for is already true.
     */
    if (isCurrent && plan.firstTouchReview.approval.status === APPROVAL_STATUS.CURRENT) {
      return {
        body: {
          approval: describe(existingApproval({ programmeCampaignId, coachId })),
          firstTouchReview: plan.firstTouchReview,
        },
      };
    }

    if (!isCurrent || !plan.firstTouchReview.required) {
      const err = new Error(
        'There is no first-touch review to approve for this coach: '
        + (coach.priorContact.hasConfirmedSend
          ? 'the campaign is not making a first approach to them right now.'
          : 'this athlete has no confirmed prior contact with them.'),
      );
      err.code = 'NO_REVIEW_REQUIRED';
      throw err;
    }

    const row = approveFirstTouch({
      programmeCampaignId,
      coachId,
      // The session's operator, never a field. `requireOperator` guards every
      // /api route, so this is present by the time the handler runs.
      operatorId: req.operator.id,
      priorContact: coach.priorContact,
    });

    return {
      body: {
        approval: describe(row),
        /**
         * WHERE THE REVIEW STANDS NOW, re-derived rather than asserted — so a
         * caller learns that the hold has cleared from the same machinery that
         * imposed it, and would learn if it had not.
         */
        firstTouchReview: programmePursuitPlan({ programmeCampaignId }).firstTouchReview,
      },
    };
  }),
);

/**
 * PREPARE THE NEXT CONTACT ATTEMPT AT THIS PROGRAMME — F9b-2.
 *
 * ---------------------------------------------------------------------------
 * IT RECORDS AN INTENT. IT DOES NOT SEND ANYTHING.
 *
 * No message is composed, no body exists, no mailbox is touched, no budget is
 * reserved or spent, no transport is called and nothing is scheduled. What it
 * writes is one row saying THIS CAMPAIGN INTENDS TO WRITE TO THIS COACH, which
 * is what a `planned` attempt has always meant. `outreach_send` remains the only
 * thing in this system that says a message happened.
 * ---------------------------------------------------------------------------
 *
 * THE ROUTE PARAM IS THE WHOLE REQUEST. The server derives the athlete, the
 * campaign, the coach, the step, the action, the safety and the review from the
 * pursuit plan — so a client cannot name a coach this campaign would not
 * approach, nor a step the message history does not support, nor a date that
 * would move a lifecycle check. There is nothing for a body to say, so a body
 * with anything in it is a 400 rather than a field quietly ignored.
 *
 * IDEMPOTENT, WHICH IS WHY A REPLAY IS 200 AND NOT AN ERROR. The attempt is
 * keyed on (programme campaign, coach) and the server picks the coach, so a
 * retried request after a dropped connection lands on the same row and gets it
 * back with `created: false`. 201 means a row was written by THIS call.
 *
 * A REFUSAL IS NEVER A 200. `created: false` already means "it was already
 * there", so returning it for a refusal too would make the two indistinguishable
 * to a client that only reads the flag.
 */
campaignsRouter.post(
  '/programme-campaigns/:programmeCampaignId/contact-attempts',
  handle('campaigns/prepare-contact-attempt', (req) => {
    // An empty allow-list: any field at all is an unknown field.
    readBody(req.body, [], 'contact attempt preparation');
    const query = Object.keys(req.query ?? {});
    if (query.length) {
      throw badRequest(
        `Unknown query parameter(s): ${query.join(', ')}. This request takes none — the server `
        + 'derives the coach, the step and the date from the campaign itself.',
      );
    }

    /**
     * THE MATERIALISER IS THE AUTHORITY, and this route adds no rule of its own.
     * It re-derives the plan, asks the shared preparation decision, and writes
     * only if that decision allows it — so the button, the dry run and the write
     * cannot disagree. An unknown id throws PROGRAMME_CAMPAIGN_NOT_FOUND from
     * inside the plan, which the table above already maps to 404.
     */
    const out = materialiseNextContactAttempt({ programmeCampaignId: req.params.programmeCampaignId });

    /**
     * `attempt: null` is the refusal shape and `created` alone cannot express
     * it — see the note on the envelope in pursuitPolicy.js. The reason is B6's
     * or B3's own code; only the sentence is composed here.
     */
    if (!out.attempt) {
      const reason = out.preparation?.reason ?? 'CONTACT_CHECK_FAILED';
      const err = new Error(refusalSentence(reason, out));
      err.code = reason;
      throw err;
    }

    return {
      status: out.created ? 201 : 200,
      body: { created: out.created, attempt: contactAttemptBody(out.attempt) },
    };
  }),
);

/** One shape for a prepared attempt. Deliberately small — no plan, no history. */
function contactAttemptBody(row) {
  return {
    id: row.id,
    programmeCampaignId: row.programme_campaign_id,
    coachId: row.coach_id,
    state: row.state,
    step: row.step,
    createdAt: row.created_at,
  };
}

/**
 * WHY PREPARING WAS REFUSED, IN A SENTENCE.
 *
 * The CODES are B3's and B6's and are quoted; only the PROSE is here, which is
 * this module's stated job. It is written for PREPARING rather than reused from
 * the send path on purpose: "nothing was drafted or sent" is true of a refused
 * preparation and beside the point, and "activate the campaign first" is the
 * wrong advice for a campaign that has closed for good.
 */
function refusalSentence(reason, out) {
  const where = out.plan?.programmeCampaign
    ? `${out.plan.programmeCampaign.collegeName} (${out.plan.programmeCampaign.sport})`
    : 'This programme';
  switch (reason) {
    case PREPARATION_REFUSAL.FIRST_TOUCH_REVIEW_REQUIRED:
      return `${where}: this athlete has already had confirmed outreach to this coach, so the `
        + 'campaign\'s first message would read as an introduction to somebody who has heard '
        + 'from them before. '
        + (out.review?.approval?.status === 'stale'
          ? 'The earlier review no longer matches what is on file — something has been sent '
            + 'since it was given. Review the contact history again and approve it.'
          : 'Review the contact history and approve the first touch first.');
    case PREPARATION_REFUSAL.NO_ELIGIBLE_COACH:
      return `${where} has nobody this campaign can approach — every address on file is `
        + 'unusable, opted out, or there is no staff record at all.';
    case PREPARATION_REFUSAL.NO_ACTION_TO_PREPARE:
      return `${where} has no next message to prepare: either somebody there has replied and it `
        + 'is waiting for a person, or the programme\'s cold outreach is finished.';
    case CONTACT_REFUSAL.CAMPAIGN_NOT_ACTIVE:
      return `The campaign is ${out.plan?.campaign?.state ?? 'not active'}, so nothing further `
        + 'may be prepared under it.';
    case CONTACT_REFUSAL.PROGRAMME_STOPPED:
      return `Outreach to ${where} was stopped. A programme-level stop covers every coach there.`;
    case CONTACT_REFUSAL.PROGRAMME_COMPLETED:
      return `Outreach to ${where} is complete.`;
    case CONTACT_REFUSAL.OUTREACH_REVOKED:
      return 'This outreach was revoked. Its tracking link no longer resolves, so there is '
        + 'nothing further to pursue through it.';
    case CONTACT_REFUSAL.RELATIONSHIP_DO_NOT_CONTACT:
      return `${where} is set to do-not-contact for this athlete. Change the contact stance on `
        + 'the relationship first.';
    case CONTACT_REFUSAL.RELATIONSHIP_MANUAL_ONLY:
      return `${where} is set to manual contact only for this athlete, so an automated campaign `
        + 'may not pursue it. A person still may — send it from Relationship Outreach or Email '
        + 'Coaches, or change the contact stance.';
    case CONTACT_REFUSAL.SUPPRESSED:
      return 'This address has opted out of Thriv3, across every athlete and campaign.';
    default:
      return `Preparing a contact attempt was refused: ${reason}`;
  }
}

/* -------------------------------------------------------------------------- */
/* Programme messages — F10b-4                                                 */
/* -------------------------------------------------------------------------- */

/**
 * ONE SHAPE FOR A MESSAGE, WHICHEVER ENDPOINT PRODUCED IT.
 *
 * Generating, reading, editing and reviewing all return this. A client that had
 * to learn four contracts for one resource would eventually read the wrong
 * field off the wrong response, and the values differ between them anyway —
 * which is the whole point of returning the resource rather than an outcome.
 *
 * THE EVIDENCE COMES WITH IT. "Why was this written" is not a follow-up
 * question about a message; it is part of what a message IS, and the review
 * screen cannot show a sentence without the claim behind it. It is parsed
 * rather than handed over as the stored JSON string.
 *
 * WHAT IS NOT HERE. No sender, mailbox, reply-to or signature — none of those
 * columns exists, and inventing them in a response would promise a design
 * nobody has made. No send state, no schedule, no delivery: a message is
 * content, and `outreach_send` remains the only thing that says one happened.
 */
function programmeMessageBody(row) {
  return {
    id: row.id,
    programmeContactAttemptId: row.programme_contact_attempt_id,
    step: row.step,

    coachId: row.coach_id,
    recipientEmail: row.recipient_email,

    generatedSubject: row.generated_subject,
    generatedBody: row.generated_body,
    subject: row.subject,
    body: row.body,
    /**
     * Both hashes, so a client can tell an edited message from an untouched one
     * without comparing two long texts — and so it never has to guess by
     * diffing them itself.
     */
    generatedBodyHash: row.generated_body_hash,
    bodyHash: row.body_hash,

    bodySource: row.body_source,
    structure: row.structure,
    policyVersion: row.policy_version,
    sequencePolicyVersion: row.sequence_policy_version,

    state: row.state,
    generatedAt: row.generated_at,
    updatedAt: row.updated_at,
    reviewedByOperatorId: row.reviewed_by_operator_id,
    reviewedAt: row.reviewed_at,

    evidence: row.evidence_snapshot,
  };
}

/** No query parameter is accepted on any of these — the ids are the request. */
function refuseQuery(req) {
  const keys = Object.keys(req.query ?? {});
  if (keys.length) {
    throw badRequest(
      `Unknown query parameter(s): ${keys.join(', ')}. This request takes none.`,
    );
  }
}

function notFoundMessage(id) {
  const err = new Error(`No programme message ${id}`);
  err.status = 404;
  return err;
}

/**
 * WRITE THE MESSAGE THIS CAMPAIGN INTENDS TO SEND THIS COACH — F10b-4.
 *
 * ---------------------------------------------------------------------------
 * IT COMPOSES NOTHING AND DECIDES NOTHING.
 *
 * The route is an adapter: it refuses input it must not accept, calls the one
 * gate, and turns the result into a resource. Every question worth asking —
 * whether an intent exists, whether the campaign still names this coach,
 * whether the steps agree, whether a stance, a suppression, a revocation, a
 * lifecycle rule or an unreviewed first touch forbids it — is
 * `generateProgrammeMessage`'s, and a guard elsewhere keeps this from being the
 * second place that wires composition to persistence.
 * ---------------------------------------------------------------------------
 *
 * THE ROUTE PARAMS ARE THE WHOLE REQUEST. No body and no query: the server
 * derives the athlete, the recipient, the step, the evidence, the structure and
 * every sentence, so a client cannot ask for content addressed to somebody this
 * campaign would not approach, or claim a second message is a first.
 *
 * 201 means a message was written by this call and 200 means one was already
 * there. A refusal is never a 200 — `created: false` already means "it was
 * already written", and overloading it would let a client record a generation
 * that never happened.
 */
campaignsRouter.post(
  '/programme-campaigns/:programmeCampaignId/coaches/:coachId/message',
  handle('campaigns/generate-message', (req) => {
    readBody(req.body, [], 'programme message generation');
    refuseQuery(req);

    const { created, message } = generateProgrammeMessage({
      programmeCampaignId: req.params.programmeCampaignId,
      coachId: req.params.coachId,
    });

    return { status: created ? 201 : 200, body: programmeMessageBody(message) };
  }),
);

/**
 * READ ONE MESSAGE, AND THE CHAIN THAT OWNS IT.
 *
 * ---------------------------------------------------------------------------
 * READING HISTORY IS NOT ACTIONABILITY.
 *
 * A message written under a campaign that has since closed, to a programme now
 * set to do-not-contact, or to an address that has since opted out, is still
 * exactly what was written — and stays readable. Hiding it would destroy the
 * record the table exists to keep, and would make "what did we write" a
 * question the product could answer only while nothing had changed.
 *
 * So this validates OWNERSHIP and never SAFETY. It recomposes nothing,
 * revalidates no eligibility, moves no state and writes nothing.
 * ---------------------------------------------------------------------------
 *
 * AN ID IS NOT AUTHORITY. The chain — message, attempt, programme campaign,
 * campaign — is resolved in one query, and a message whose chain does not
 * resolve is a 404 rather than a row returned on the strength of its id alone.
 */
campaignsRouter.get(
  '/programme-messages/:messageId',
  handle('campaigns/read-message', (req) => {
    refuseQuery(req);
    const found = programmeMessageWithContext(req.params.messageId);
    if (!found) throw notFoundMessage(req.params.messageId);
    return { body: programmeMessageBody(found.message) };
  }),
);

/**
 * CHANGE THE WORDS A PERSON HAS NOT YET APPROVED.
 *
 * TWO FIELDS, and the allow-list refuses rather than ignores — a client that
 * believed it had just changed the recipient and got a 200 has been told
 * something false. Everything else about a message is either the server's
 * (recipient, step, evidence, policy versions) or immutable provenance
 * (`generatedSubject`, `generatedBody`), and neither is editable by anybody.
 *
 * NO CAMPAIGN SAFETY GATE HERE, and that is deliberate. Editing is content
 * work, not execution: a message whose programme has since become
 * do-not-contact may still be tidied up, and doing so makes it no more sendable
 * than it was. The state machine controls editability — reviewed words are not
 * edited — and live safety is execution's to revalidate. Nothing in this
 * response implies the campaign is actionable.
 */
const MESSAGE_PATCH_FIELDS = Object.freeze(['subject', 'body']);

campaignsRouter.patch(
  '/programme-messages/:messageId',
  handle('campaigns/edit-message', (req) => {
    const body = readBody(req.body, MESSAGE_PATCH_FIELDS, 'programme message edit');
    refuseQuery(req);

    const offered = MESSAGE_PATCH_FIELDS.filter((f) => f in body);
    if (!offered.length) {
      throw badRequest(
        `Name what to change: ${MESSAGE_PATCH_FIELDS.join(' or ')}. An empty edit is not a change.`,
      );
    }

    // 404 before the writer, so an unknown id reads as a missing resource
    // rather than as a domain refusal about one.
    if (!programmeMessageWithContext(req.params.messageId)) {
      throw notFoundMessage(req.params.messageId);
    }

    const updated = editProgrammeMessage(req.params.messageId, {
      ...(('subject' in body) ? { subject: body.subject } : {}),
      ...(('body' in body) ? { body: body.body } : {}),
    });
    return { body: programmeMessageBody(updated) };
  }),
);

/**
 * A PERSON APPROVES THESE EXACT WORDS.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS NOT. Not send-approved, not queued, not scheduled, not a mailbox
 * decision and not permission to contact anybody. Every stance, suppression,
 * revocation, lifecycle rule, first-touch review, budget and timing check is
 * evaluated afterwards exactly as before.
 * ---------------------------------------------------------------------------
 *
 * THE REVIEWER IS THE SESSION'S, NEVER A FIELD. `requireOperator` guards every
 * /api route, so `req.operator` is present by the time this runs — and an
 * `operatorId` in the body is REFUSED rather than ignored, because a request
 * that could name its own reviewer would make the attribution decorative.
 *
 * NO SAFETY GATE, for the same reason as the edit above and one more: the
 * content being approved is durable, and a campaign that closed after it was
 * written does not make the words somebody read any less approved. Whether they
 * may be sent is asked at send, where the consequence is a message leaving.
 */
campaignsRouter.post(
  '/programme-messages/:messageId/review',
  handle('campaigns/review-message', (req) => {
    readBody(req.body, [], 'programme message review');
    refuseQuery(req);

    if (!programmeMessageWithContext(req.params.messageId)) {
      throw notFoundMessage(req.params.messageId);
    }

    const reviewed = reviewProgrammeMessage(req.params.messageId, {
      // The session's operator, never a field. See above.
      operatorId: req.operator.id,
    });
    return { body: programmeMessageBody(reviewed) };
  }),
);

/**
 * ---- SEND A REVIEWED MESSAGE — D4.9 ---------------------------------------
 *
 * ===========================================================================
 * THE BODY CARRIES TWO FIELDS, AND NEITHER IS EXECUTION AUTHORITY.
 *
 *   bodyHash            the reviewed hash the client was shown, so a message
 *                       edited since it was loaded is refused rather than sent
 *   connectedMailboxId  which of the athlete's mailboxes to send from
 *
 * Everything else is DERIVED SERVER-SIDE from rows a request cannot write: the
 * athlete, the campaign, the programme, the coach, the recipient, the subject,
 * the body, the step, the sequence, the evidence, the provider, the sending
 * identity, the budget, the timing and every policy. `readBody` refuses any
 * other field by name, so a caller cannot smuggle a recipient or a subject past
 * it and be told it worked.
 *
 * THE OPERATOR COMES FROM THE SESSION, never the body — the same rule review
 * follows, and for a stronger reason: this one sends an email.
 * ===========================================================================
 *
 * THE MAILBOX IS NAMED BUT NOT TRUSTED. A caller may choose among the
 * athlete's mailboxes; `executionClaim` independently proves the one named
 * exists, belongs to this operator AND this athlete, is CONNECTED, holds a
 * credential and has a supported provider. Naming a mailbox is not authority to
 * send from it.
 */
campaignsRouter.post(
  '/programme-messages/:messageId/send',
  handle('campaigns/send-message', async (req) => {
    const body = readBody(req.body, ['bodyHash', 'connectedMailboxId'], 'programme message send');
    refuseQuery(req);

    for (const field of ['bodyHash', 'connectedMailboxId']) {
      if (typeof body[field] !== 'string' || !body[field].trim()) {
        throw badRequest(`A programme message send request needs ${field}.`);
      }
    }

    /**
     * 404 BEFORE ANYTHING ELSE, so a message that does not exist is not
     * answered with a policy refusal that implies it does.
     */
    if (!programmeMessageWithContext(req.params.messageId)) {
      throw notFoundMessage(req.params.messageId);
    }

    const out = await executeProgrammeMessage({
      programmeMessageId: req.params.messageId,
      operatorUserId: req.operator.id,
      connectedMailboxId: body.connectedMailboxId,
      bodyHash: body.bodyHash,
    });

    /**
     * 200 WITH THE DURABLE STATE, INCLUDING FOR UNKNOWN — see STATUS_BY_CODE.
     * The request succeeded; what the provider said is the payload. A 5xx for
     * an ambiguous send would invite the retry that must never happen.
     */
    return { body: out };
  }),
);

/**
 * ---- ATTEMPT AGAIN A MESSAGE THAT PROVABLY NEVER LEFT — D5.0 --------------
 *
 * ===========================================================================
 * KEYED ON THE EXECUTION, NOT ON THE MESSAGE, BECAUSE THAT IS WHAT IT REPEATS.
 *
 * `POST /programme-messages/:id/send` creates an execution; there is exactly
 * one per approved message and a second is refused. This endpoint does not
 * create anything — it re-attempts the execution that already exists, reusing
 * its id, its frozen bytes, its sequence and its mailbox. Naming it after the
 * message would suggest a second send of the same words was on offer, which is
 * the one thing MESSAGE_ALREADY_EXECUTED exists to prevent.
 *
 * It is on this router rather than a new one: `campaignsRouter` is mounted at
 * /api and already owns every execution route, and a router per resource noun
 * would be architecture for its own sake.
 * ===========================================================================
 *
 * ---------------------------------------------------------------------------
 * IT TAKES NO BODY AT ALL, AND THAT IS THE STRONGEST VERSION OF THE RULE.
 *
 * A first send needs `bodyHash`, because the operator is approving words they
 * were shown and those words could have moved. A re-attempt cannot have that
 * problem: the bytes are frozen on `outreach_send` and are the only bytes that
 * can go — nothing regenerates them, and `programme_messages` is not read for
 * content here. There is nothing for an acknowledgement to acknowledge.
 *
 * `connectedMailboxId` is likewise absent. A retry goes from the mailbox the
 * message was authorised to be sent from; the authority refuses any other, and
 * an endpoint that accepted one would imply a choice that does not exist.
 * ---------------------------------------------------------------------------
 *
 * NOT AUTOMATIC, ANYWHERE. Nothing in the product calls this on a timer, on a
 * failure, or on a page load. It runs because somebody asked.
 */
campaignsRouter.post(
  '/outreach-sends/:sendId/retry',
  handle('campaigns/retry-send', async (req) => {
    readBody(req.body, [], 'execution re-attempt');
    refuseQuery(req);

    const out = await reattemptExecution({
      outreachSendId: req.params.sendId,
      operatorUserId: req.operator.id,
    });

    /** 200 with the durable state, on the same terms as a first send. */
    return { body: out };
  }),
);

/**
 * ---- IS THIS MESSAGE READY TO SEND? — D4.9 --------------------------------
 *
 * ===========================================================================
 * ADVISORY. IT IS NOT PERMISSION AND IT CANNOT BE TRADED FOR ANY.
 *
 * Every fact here can move between this answer and a send: an address, a
 * stance, a suppression, a mailbox, a day's capacity, the four-day clock. So
 * `readyNow` means READY WHEN ASKED and nothing stronger, and
 * `claimRechecksEverything` is on the response to say so in the payload rather
 * than only in this comment.
 *
 * There is no code path from a readiness answer into the claim. The claim takes
 * ids and re-establishes every one of these itself, inside the transaction that
 * writes. A design where "readiness said yes" let the claim skip a check would
 * be a preview of a world that had already moved.
 * ===========================================================================
 *
 * IT WRITES NOTHING AND SPENDS NOTHING. No claim, no send row, no budget, no
 * token, no attempt. Budget is READ through the athlete-level decision, which
 * consumes nothing.
 */
campaignsRouter.get(
  '/programme-messages/:messageId/execution-readiness',
  handle('campaigns/execution-readiness', (req) => {
    const mailboxId = req.query?.connectedMailboxId ?? null;
    for (const key of Object.keys(req.query ?? {})) {
      if (key !== 'connectedMailboxId') {
        throw badRequest(`Unknown query parameter: ${key}. This request takes connectedMailboxId.`);
      }
    }
    if (!programmeMessageWithContext(req.params.messageId)) {
      throw notFoundMessage(req.params.messageId);
    }
    return {
      body: executionReadiness({
        programmeMessageId: req.params.messageId,
        operatorUserId: req.operator.id,
        connectedMailboxId: typeof mailboxId === 'string' && mailboxId.trim() ? mailboxId : null,
      }),
    };
  }),
);

/** One shape for an approval row, wherever it came from. */
function describe(row) {
  return {
    programmeCampaignId: row.programme_campaign_id,
    coachId: row.coach_id,
    approvedAt: row.approved_at,
    approvedByOperatorId: row.approved_by_operator_id,
    reviewedConfirmedSendCount: row.reviewed_confirmed_send_count,
    reviewedLastConfirmedSendAt: row.reviewed_last_confirmed_send_at,
  };
}

function notFoundCampaign(id) {
  const err = new Error(`No campaign ${id}`);
  err.status = 404;
  return err;
}
