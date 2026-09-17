import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { utcNow } from './time.js';

/**
 * PURSUING ONE COACH, FOR ONE CAMPAIGN.
 *
 * The layer between "this athlete is pursuing this programme" and "this message
 * happened". It is campaign-specific by construction: Campaign 1 pursuing Coach
 * Smith and Campaign 2 pursuing Coach Smith a season later are two attempts
 * sharing one lifetime `outreach` row, and keying this on the relationship
 * would have lost the second campaign's progression entirely.
 *
 * ---------------------------------------------------------------------------
 * A ROW HERE IS A PLAN. IT IS NOT A CONTACT.
 *
 * An attempt may exist before anything is drafted, and before the campaign is
 * active — an operator reviewing a draft campaign decides who to pursue, and
 * that is planning. Nothing may read the existence of a row as evidence that a
 * coach was written to; `outreach_send` is the only thing that says a message
 * happened, and B3 is the only thing that says one may.
 *
 * SO THIS MODULE ADDS NO CONTACT GATE. `createContactAttempt` deliberately does
 * not require an active campaign. The moment a message is actually written, B3
 * runs inside `createOutreach` and `recordDraft` and answers that question
 * properly.
 * ---------------------------------------------------------------------------
 *
 * WHAT IT DELIBERATELY DOES NOT DECIDE: which coach, how many coaches, how deep
 * a tier goes, what a step says, how long to wait, or when a programme becomes
 * active. Those are a sequence policy's, and this is only where its state will
 * live.
 */

/**
 * Reachable today. Three, because three is what B4 can truthfully know: it was
 * selected, it is being pursued, it is not being pursued any more.
 */
export const ATTEMPT_STATE = Object.freeze({
  PLANNED: 'planned',
  ACTIVE: 'active',
  STOPPED: 'stopped',
});

/**
 * Declared in the schema's CHECK so the column never needs a table rebuild —
 * SQLite cannot alter one — and refused here by name until the thing that gives
 * each meaning exists.
 *
 *   waiting    waiting for a reply, or for an interval to pass. Needs a
 *              scheduler and reply ingestion; there is neither.
 *   completed  a planned sequence finished. Needs a sequence policy to have
 *              planned one.
 *
 * A state that nothing can produce is honest. A state something can produce and
 * nothing can act on is not.
 */
export const UNREACHABLE_STATES = Object.freeze({
  waiting: 'a scheduler and reply ingestion, which do not exist yet',
  completed: 'a sequence policy that has planned a sequence to finish',
});

/**
 * Lowercase, matching this table's neighbours: `campaigns.state` and
 * `programme_campaigns.state` are lowercase, while `outreach_send.state` is
 * SCREAMING_SNAKE. The convention is per-table and this one follows the
 * campaign side it belongs to.
 */
const LEGAL_TRANSITIONS = Object.freeze({
  planned: Object.freeze(['active', 'stopped']),
  // Not terminal: a pursuit stopped in September can resume in January, the
  // same reasoning programme_campaigns uses for stopped -> active.
  active: Object.freeze(['stopped']),
  stopped: Object.freeze(['active']),
});

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

const BY_ID = db.prepare('SELECT * FROM programme_contact_attempts WHERE id = ?');

/**
 * The programme campaign, with the athlete its parent campaign belongs to.
 *
 * Deliberately not `resolveProgrammeCampaignFor` from campaignAttribution.js:
 * that answers "may this campaign contact this coach", which is B3's question
 * and includes state and dates. Planning is allowed before any of that is true,
 * so this reads identity only — and applies the SAME identity rule, matching on
 * (college_name, sport) exactly as A6 does.
 */
const PROGRAMME_CAMPAIGN = db.prepare(`
  SELECT pc.id, pc.college_name, pc.sport, pc.campaign_id, c.athlete_id
  FROM programme_campaigns pc
  JOIN campaigns c ON c.id = pc.campaign_id
  WHERE pc.id = ?
`);

const COACH = db.prepare('SELECT id, full_name, email, school, sport FROM coaches WHERE id = ?');

/**
 * Identity, and only identity: the programme campaign exists, the coach exists,
 * and the coach is at that programme in that sport.
 *
 * The sport is checked as well as the name because one person can staff a
 * school's men's and women's programmes and `coaches` is keyed on
 * (email, school, sport) so those are two rows — the same reasoning A6 gives.
 */
function resolvePair(programmeCampaignId, coachId, athleteId = null) {
  const pc = PROGRAMME_CAMPAIGN.get(programmeCampaignId);
  if (!pc) {
    throw fail('PROGRAMME_CAMPAIGN_NOT_FOUND', `No programme campaign ${programmeCampaignId}`);
  }
  if (athleteId && pc.athlete_id !== athleteId) {
    throw fail('CAMPAIGN_ATHLETE_MISMATCH',
      `Programme campaign ${programmeCampaignId} belongs to a different athlete's campaign.`);
  }
  const coach = COACH.get(coachId);
  if (!coach) throw fail('COACH_NOT_FOUND', `No coach ${coachId}`);
  if (coach.school !== pc.college_name || coach.sport !== pc.sport) {
    throw fail('CAMPAIGN_PROGRAMME_MISMATCH',
      `Programme campaign ${programmeCampaignId} is for ${pc.college_name} (${pc.sport}), `
      + `but this coach is at ${coach.school} (${coach.sport}).`);
  }
  return { pc, coach };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function contactAttempt(id) {
  return BY_ID.get(id) || null;
}

/** The attempt this campaign has for this coach, or null. At most one. */
export function attemptForCoach(programmeCampaignId, coachId) {
  return db.prepare(`
    SELECT * FROM programme_contact_attempts
    WHERE programme_campaign_id = ? AND coach_id = ?
  `).get(programmeCampaignId, coachId) || null;
}

/** One programme's attempts, oldest first. Total order: `id` breaks a tie. */
export function attemptsForProgrammeCampaign(programmeCampaignId) {
  return db.prepare(`
    SELECT * FROM programme_contact_attempts
    WHERE programme_campaign_id = ? ORDER BY created_at, id
  `).all(programmeCampaignId);
}

/**
 * Every attempt in one campaign, in the order a review screen wants: by the
 * programme's snapshotted rank, then oldest first.
 *
 * One join and no counters. It exists because "what would this campaign do"
 * is the question the dry-run harness will ask, and asking it per programme
 * would be a hundred round trips.
 */
export function attemptsForCampaign(campaignId) {
  return db.prepare(`
    SELECT a.*, pc.college_name, pc.sport, pc.rank, pc.tier
    FROM programme_contact_attempts a
    JOIN programme_campaigns pc ON pc.id = a.programme_campaign_id
    WHERE pc.campaign_id = ?
    ORDER BY pc.rank, a.created_at, a.id
  `).all(campaignId);
}

/** Attempts running through one lifetime relationship, across campaigns. */
export function attemptsForOutreach(outreachId) {
  return db.prepare(`
    SELECT * FROM programme_contact_attempts WHERE outreach_id = ? ORDER BY created_at, id
  `).all(outreachId);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Plan to pursue this coach for this campaign.
 *
 * IDEMPOTENT, and returns the existing attempt UNCHANGED — matching
 * `createOutreach` and `suppress()`. It never resurrects a stopped attempt:
 * asking to plan something that was deliberately stopped must not quietly
 * restart it, and `transitionContactAttempt` is where resuming is said out
 * loud. `created` distinguishes the two cases.
 *
 * NO CAMPAIGN GATE. Planning happens while a campaign is still a draft, which
 * is the point of a draft. B3 governs whether a message may be written, at the
 * write.
 */
export function createContactAttempt({
  programmeCampaignId, coachId, athleteId = null, outreachId = null,
  /**
   * WHERE THIS CAMPAIGN'S PURSUIT OF THIS COACH ALREADY IS — F9b-1.
   *
   * Defaults to 1 because a pursuit usually starts at its first message, and
   * every caller before F9b-1 meant exactly that. It is a PARAMETER rather than
   * a constant because an attempt can legitimately be created part-way through
   * a pursuit: a campaign-attributed message may be confirmed for a coach no
   * attempt was ever planned for — which is every message this build has sent,
   * since nothing has ever written to this table — and the attempt recorded
   * afterwards starts where the campaign actually is.
   *
   * IT IS NOT A SECOND SEQUENCE POLICY. The caller passes the step B6 DERIVED
   * from accepted campaign-local messages; nothing here computes one. Creating
   * at 1 against a derived 2 is what produced `CONTACT_ATTEMPT_STEP_DRIFT` the
   * moment an attempt was prepared for a follow-up.
   */
  step = 1,
  at = utcNow(),
}) {
  const { pc } = resolvePair(programmeCampaignId, coachId, athleteId);
  assertStep(step);

  const existing = attemptForCoach(programmeCampaignId, coachId);
  if (existing) return { ...existing, created: false };

  if (outreachId) assertOutreachFits(outreachId, pc, coachId);

  const row = {
    id: randomUUID(),
    programme_campaign_id: programmeCampaignId,
    coach_id: coachId,
    outreach_id: outreachId,
    state: ATTEMPT_STATE.PLANNED,
    state_reason: null,
    state_changed_at: null,
    // The step this attempt is ON, not a count of what it has done.
    step,
    next_action_at: null,
    created_at: at,
    updated_at: at,
  };
  db.prepare(`
    INSERT INTO programme_contact_attempts (
      id, programme_campaign_id, coach_id, outreach_id, state, state_reason,
      state_changed_at, step, next_action_at, created_at, updated_at
    ) VALUES (
      @id, @programme_campaign_id, @coach_id, @outreach_id, @state, @state_reason,
      @state_changed_at, @step, @next_action_at, @created_at, @updated_at
    )
  `).run(row);
  return { ...row, created: true };
}

/**
 * The only writer of `state`.
 *
 * Same-state writes nothing and returns `changed: false`, the convention
 * `suppress()`, `createOutreach`, `markOutreachSent` and every campaign
 * transition already follow — a repeat must not restamp a timestamp that dates
 * a real decision.
 *
 * Stopping requires a reason, for the same reason `programme_campaigns` does: a
 * stop nobody can explain cannot be reviewed or reversed. Any other transition
 * clears it, so a resumed attempt does not carry the sentence that stopped it.
 */
export function transitionContactAttempt(id, nextState, { reason = null, at = utcNow() } = {}) {
  if (nextState in UNREACHABLE_STATES) {
    throw fail('ATTEMPT_STATE_UNAVAILABLE',
      `"${nextState}" needs ${UNREACHABLE_STATES[nextState]}. The column can hold it; `
      + 'nothing can truthfully put it there yet.');
  }
  if (!Object.values(ATTEMPT_STATE).includes(nextState)) {
    throw fail('INVALID_ATTEMPT_STATE', `Unknown contact attempt state "${nextState}"`);
  }
  const row = requireAttempt(id);
  if (row.state === nextState) return { ...row, changed: false };

  if (!LEGAL_TRANSITIONS[row.state]?.includes(nextState)) {
    throw fail('ILLEGAL_ATTEMPT_TRANSITION',
      `A contact attempt cannot go from ${row.state} to ${nextState}`
      + ` (allowed: ${(LEGAL_TRANSITIONS[row.state] ?? []).join(', ') || 'nothing'})`);
  }

  let nextReason = null;
  if (nextState === ATTEMPT_STATE.STOPPED) {
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    if (!trimmed) {
      throw fail('ATTEMPT_STOP_REASON_REQUIRED',
        'Stopping the pursuit of a coach needs a reason — a stop nobody can explain '
        + 'cannot be reviewed or reversed.');
    }
    nextReason = trimmed;
  }

  db.prepare(`
    UPDATE programme_contact_attempts
    SET state = ?, state_reason = ?, state_changed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(nextState, nextReason, at, at, id);
  return { ...BY_ID.get(id), changed: true };
}

/**
 * Move this campaign's pursuit of this coach on by one step.
 *
 * ONE AT A TIME AND FORWARD ONLY. There is no jumping and no going back: a
 * step is a position in a progression, and a caller that could set it
 * arbitrarily could make the progression say anything. It does NOT decide what
 * a step is worth or how many there should be — that is a sequence policy's,
 * and a bound here would be tier depth in disguise.
 *
 * A stopped attempt cannot advance; whether an attempt in any other state
 * should is a policy question and is deliberately left open.
 */
export function advanceContactAttemptStep(id, { at = utcNow() } = {}) {
  const row = requireAttempt(id);
  if (row.state === ATTEMPT_STATE.STOPPED) {
    throw fail('ATTEMPT_STOPPED', 'A stopped contact attempt does not advance.');
  }
  db.prepare(`
    UPDATE programme_contact_attempts SET step = step + 1, updated_at = ? WHERE id = ?
  `).run(at, id);
  return { ...BY_ID.get(id), changed: true };
}

/**
 * BRING A STORED STEP BACK UP TO THE DERIVED ONE — F9b-1. FORWARD ONLY.
 *
 * The stored step is a REFLECTION of the campaign-local step B6 derives from
 * accepted messages, never a counter of its own. When the two disagree the
 * derived one is right by construction — it counts messages that exist — so
 * catching the stored one up loses nothing.
 *
 * ---------------------------------------------------------------------------
 * IT WILL NOT GO BACKWARDS, AND THAT IS THE POINT OF IT.
 *
 * A stored step AHEAD of the derived one cannot be explained by anything this
 * module does: it would mean an attempt claiming a message that is not on file.
 * Rewriting it would erase the only evidence of whatever produced it, so this
 * writes nothing and returns `changed: false` — leaving B7's
 * `CONTACT_ATTEMPT_STEP_DRIFT` blocker to keep saying so.
 *
 * It does NOT throw on that case. The caller is the materialiser, and a
 * programme in an integrity state must still be readable and refusable rather
 * than breaking the operation that noticed.
 * ---------------------------------------------------------------------------
 *
 * A STOPPED ATTEMPT IS LEFT ALONE, matching `advanceContactAttemptStep`: a
 * pursuit somebody stopped is not quietly resumed by bookkeeping.
 */
export function reconcileContactAttemptStep(id, derivedStep, { at = utcNow() } = {}) {
  const row = requireAttempt(id);
  assertStep(derivedStep);

  if (row.state === ATTEMPT_STATE.STOPPED) return { ...row, changed: false };
  // Equal is the ordinary case and must not restamp `updated_at`; behind is the
  // integrity case and must not be touched at all.
  if (derivedStep <= row.step) return { ...row, changed: false };

  db.prepare('UPDATE programme_contact_attempts SET step = ?, updated_at = ? WHERE id = ?')
    .run(derivedStep, at, id);
  return { ...BY_ID.get(id), changed: true };
}

/**
 * A CONFIRMED CAMPAIGN MESSAGE MOVED THE PURSUIT ON — F9b-1.
 *
 * Called from the one transition that makes `outreach_send.state` ACCEPTED,
 * which is the same fact B6 counts to derive the campaign-local step. So the
 * stored step advances at the instant the derived one does, and the two cannot
 * drift apart by a campaign simply doing its work.
 *
 * ONE STEP, BECAUSE ONE MESSAGE WAS ACCEPTED. Before the acceptance the derived
 * step was `n + 1`; after it, `n + 2`. Adding one is the whole arithmetic, and
 * re-deriving the count here would be this module growing an opinion about
 * campaign sequencing that B6 already owns.
 *
 * IT REFUSES NOTHING AND REPORTS EVERYTHING. Confirming a send is the more
 * important operation of the two and must never fail because of bookkeeping, so
 * every case this cannot act on returns a reason instead of throwing:
 *
 *   NO_ATTEMPT   no attempt was ever planned for this coach — which is every
 *                message sent before F9, since nothing wrote to this table
 *   STOPPED      the pursuit was stopped; advancing it would undo a decision
 *
 * @returns {{changed: boolean, attempt: object|null, reason: string|null}}
 */
export function advanceAttemptForConfirmedSend({ programmeCampaignId, coachId, at = utcNow() }) {
  if (!programmeCampaignId || !coachId) return { changed: false, attempt: null, reason: 'NO_ATTEMPT' };

  const row = attemptForCoach(programmeCampaignId, coachId);
  if (!row) return { changed: false, attempt: null, reason: 'NO_ATTEMPT' };
  if (row.state === ATTEMPT_STATE.STOPPED) {
    return { changed: false, attempt: row, reason: 'STOPPED' };
  }

  const out = advanceContactAttemptStep(row.id, { at });
  return { changed: true, attempt: out, reason: null };
}

/**
 * Point this attempt at the lifetime relationship it executes through.
 *
 * The relationship must be the RIGHT one: the same coach, and the athlete whose
 * campaign this is. Without that check a caller could attach another athlete's
 * relationship and every message written afterwards would carry the wrong
 * token.
 *
 * RE-LINKING TO A DIFFERENT RELATIONSHIP IS REFUSED. Messages have been written
 * through the first one and repointing would falsify which conversation this
 * attempt belongs to; linking to the same one again is a no-op.
 */
export function linkContactAttemptToOutreach(id, outreachId, { at = utcNow() } = {}) {
  const row = requireAttempt(id);
  const { pc } = resolvePair(row.programme_campaign_id, row.coach_id);

  if (row.outreach_id === outreachId) return { ...row, changed: false };
  if (row.outreach_id) {
    throw fail('ATTEMPT_ALREADY_LINKED',
      `This attempt already executes through outreach ${row.outreach_id}. Repointing it would `
      + 'falsify which conversation its messages belong to.');
  }

  assertOutreachFits(outreachId, pc, row.coach_id);
  db.prepare('UPDATE programme_contact_attempts SET outreach_id = ?, updated_at = ? WHERE id = ?')
    .run(outreachId, at, id);
  return { ...BY_ID.get(id), changed: true };
}

/**
 * A step is a POSITION in a progression: a whole number, starting at one. The
 * column's CHECK says the same thing; this says it in a sentence a caller can
 * read, before SQLite says it as a constraint failure.
 */
function assertStep(step) {
  if (!Number.isInteger(step) || step < 1) {
    throw fail('INVALID_ATTEMPT_STEP',
      `A contact attempt step is a whole number from 1 upwards; got ${JSON.stringify(step)}.`);
  }
  return step;
}

function requireAttempt(id) {
  const row = BY_ID.get(id);
  if (!row) throw fail('CONTACT_ATTEMPT_NOT_FOUND', `No contact attempt ${id}`);
  return row;
}

function assertOutreachFits(outreachId, pc, coachId) {
  const o = db.prepare('SELECT id, athlete_id, coach_id FROM outreach WHERE id = ?').get(outreachId);
  if (!o) throw fail('OUTREACH_NOT_FOUND', `No outreach ${outreachId}`);
  if (o.athlete_id !== pc.athlete_id) {
    throw fail('OUTREACH_ATHLETE_MISMATCH',
      'That outreach relationship belongs to a different athlete.');
  }
  if (o.coach_id !== coachId) {
    throw fail('OUTREACH_COACH_MISMATCH',
      'That outreach relationship is with a different coach.');
  }
  return o;
}
