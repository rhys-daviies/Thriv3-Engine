import express from 'express';
import {
  createCampaign, updateCampaignDetails,
  activateCampaign, closeCampaign, setCampaignState,
  setProgrammeTier, restoreAutoTier, setProgrammeCampaignState,
  getCampaign, listCampaignsForAthlete, getProgrammeCampaign, listProgrammeCampaigns,
  CAMPAIGN_STATES, PROGRAMME_CAMPAIGN_STATES, TIERS,
} from '../lib/campaigns.js';
import { campaignExecutionPlan } from '../lib/campaignExecution.js';
import { programmePursuitPlan } from '../lib/pursuitPolicy.js';
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
function handle(label, fn) {
  return (req, res) => {
    try {
      const { status = 200, body } = fn(req);
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
