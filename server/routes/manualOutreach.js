import express from 'express';
import db from '../db/client.js';
import { getAthleteProgramme } from '../lib/athleteProgrammes.js';
import { manualContactDecision } from '../lib/manualOutreachSafety.js';
import {
  confirmManualDraftSent, discardManualDraft, pendingManualDraftsForAthlete,
  CONFIRMATION_REFUSAL,
} from '../lib/manualDraftConfirmation.js';
import { isSendCapped, recentSendCount } from '../lib/sendCap.js';
import { PER_COACH_MAX_SENDS, PER_COACH_WINDOW_DAYS } from '../lib/config.js';
import { programmeCoaches } from './programmeCoaches.js';
import { historyForAthleteProgramme } from '../lib/programmeContactHistory.js';
import { contactIntelligenceForProgramme } from '../lib/contactIntelligence.js';
import { sendOutreach } from './sendOutreach.js';
import { OUTREACH_ORIGIN } from '../../shared/outreachOrigin.js';

/**
 * MANUAL OUTREACH AGAINST ONE ATHLETE-PROGRAMME RELATIONSHIP.
 *
 * A case-by-case act: the athlete asked for this school, or somebody here
 * already knows the coach. It is emphatically NOT a campaign, and the design
 * of this route is mostly about making that impossible to fake.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE CLIENT MAY SAY, AND WHAT IT MAY NOT.
 *
 * MAY: which coaches to write to, the subject, the body, which evidence
 * angles to prefer, and whether to send rather than draft. All of those are
 * things a person composing a message genuinely decides.
 *
 * MAY NOT: the programme. The contact stance. The campaign. The origin. Those
 * come from the URL and the database, and there is no field a request can set
 * to change any of them — an unknown field is a 400 naming it.
 *
 * The consequence worth stating plainly: a browser cannot get past a
 * do-not-contact relationship by editing what it posts. It can change which
 * coach, and what the email says, and neither of those is the rule.
 * ---------------------------------------------------------------------------
 *
 * `programme_campaign_id` IS FORCED TO NULL and `origin` to `manual`, so a
 * manual send can never consume campaign cadence, satisfy a campaign step, or
 * be counted as one afterwards. The provenance is recorded so that a later
 * slice can ask "has anybody written to this coach outside a campaign" — which
 * today has no answer — without this route having to know what that slice will
 * decide.
 */

export const manualOutreachRouter = express.Router();

const COMPOSE_FIELDS = Object.freeze([
  'coachIds', 'subject', 'body', 'greetingName', 'send',
  'evidenceSelection', 'evidenceStructure', 'bodySource',
]);

/**
 * Named so a refusal can say why, rather than "unknown field". Each of these
 * is something a caller might plausibly send in good faith, and each is a
 * thing this route reads from somewhere the caller cannot reach.
 */
const SERVER_OWNED = Object.freeze({
  origin: 'set by this route; a message cannot describe its own provenance',
  programmeCampaignId: 'always null here — manual outreach is not campaign outreach',
  contact_stance: 'read from the relationship, never from a request',
  visibility: 'not a contact decision, and not read by this route',
  flagged: 'not a contact decision, and not read by this route',
  request_state: 'not a contact decision, and not read by this route',
  athleteId: 'named by the URL',
  collegeName: 'read from the relationship named by the URL',
  division: 'read from the registry row the relationship names',
  coaches: 'send coachIds; addresses are resolved from the registry, not accepted',
  matchId: 'derived from the programme identity',
});

function badRequest(message, code) {
  const err = new Error(message);
  err.status = 400;
  err.code = code;
  return err;
}

function readBody(body) {
  if (body === null || body === undefined) return {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('A manual outreach request body must be an object.');
  }
  const offered = Object.keys(body);
  const owned = offered.filter((k) => !COMPOSE_FIELDS.includes(k) && k in SERVER_OWNED);
  if (owned.length) {
    throw badRequest(
      `Cannot set ${owned.join(', ')}: `
      + owned.map((k) => `${k} ${SERVER_OWNED[k]}`).join('; ') + '.',
      'SERVER_OWNED_FIELD',
    );
  }
  const unknown = offered.filter((k) => !COMPOSE_FIELDS.includes(k));
  if (unknown.length) {
    throw badRequest(`Unknown field(s): ${unknown.join(', ')}. Allowed: ${COMPOSE_FIELDS.join(', ')}.`);
  }
  return body;
}

/**
 * PREVIOUS CONTACT, DERIVED AND NEVER STORED.
 *
 * The SQL lives in server/lib/programmeContactHistory.js so this route, and
 * anything that later needs the same answer, cannot drift into two versions of
 * it. Copying a `previously_contacted` flag onto `athlete_programmes` would be
 * a second answer to a question `outreach` already answers.
 *
 * FACTS, NOT A VERDICT. Nothing here blocks anything: the most ordinary reason
 * to open this dialog is a deliberate second message to a coach who replied.
 */
/** The relationship named by the URL, or a 404 that says which part is missing. */
function loadContext(req) {
  const { playerId, id } = req.params;
  const relationship = getAthleteProgramme(playerId, id);
  if (!relationship) {
    throw Object.assign(new Error('No such programme relationship for this athlete.'), {
      status: 404, code: 'RELATIONSHIP_NOT_FOUND',
    });
  }
  const college = relationship.college_id
    ? db.prepare('SELECT id, name, sport, division, active FROM colleges WHERE id = ?')
      .get(relationship.college_id)
    : null;

  return {
    playerId,
    relationship,
    college,
    // The relationship's own identity wins over the registry row's, because
    // the relationship is what outreach joins on and the registry row may have
    // been renamed or removed underneath it.
    collegeName: relationship.college_name,
    sport: relationship.sport,
    division: college?.division ?? null,
  };
}

/** Everything the composer needs, in one request. */
manualOutreachRouter.get('/players/:playerId/programmes/:id/outreach', (req, res) => {
  try {
    const ctx = loadContext(req);
    const decision = manualContactDecision({
      athleteId: ctx.playerId, collegeName: ctx.collegeName, sport: ctx.sport,
    });
    return res.json({
      relationship: ctx.relationship,
      college: ctx.college,
      coaches: programmeCoaches({ collegeName: ctx.collegeName, sport: ctx.sport }),
      contact: decision,
      priorContact: historyForAthleteProgramme({
        athleteId: ctx.playerId, collegeName: ctx.collegeName, sport: ctx.sport,
      }),
      /**
       * The same summary the cards read, for the one programme being written
       * to. No N+1 concern here — this dialog is already about one programme —
       * and reusing the helper is what keeps the card and the dialog from
       * disagreeing about whether a coach has been written to.
       */
      contactIntelligence: contactIntelligenceForProgramme({
        athleteId: ctx.playerId, collegeName: ctx.collegeName, sport: ctx.sport,
      }),
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    console.error('[manual-outreach/context]', err);
    return res.status(500).json({ error: 'Unexpected error.' });
  }
});

manualOutreachRouter.post('/players/:playerId/programmes/:id/outreach', async (req, res) => {
  try {
    const body = readBody(req.body);
    const ctx = loadContext(req);

    /**
     * REFUSED HERE AS WELL AS INSIDE `sendOutreach`, and both are wanted.
     *
     * This one answers with a code the screen can explain. The one inside
     * `sendOutreach` is the guarantee — it stands on every path to a send,
     * including ones that do not exist yet, and it is the reason a client
     * cannot route around this route.
     */
    const decision = manualContactDecision({
      athleteId: ctx.playerId, collegeName: ctx.collegeName, sport: ctx.sport,
    });
    if (!decision.allowed) {
      return res.status(422).json({
        error: `${ctx.collegeName} is set to do-not-contact for this athlete.`,
        code: decision.reason,
      });
    }

    /**
     * THRIV3 DOES NOT SEND THIS MESSAGE — F7b.
     *
     * =====================================================================
     * REFUSED, NOT COERCED. A caller asking for an automatic send is asking
     * for something this workflow no longer does, and quietly turning it into
     * a draft would hand them a 200 describing an action they did not request.
     * They would reasonably believe a coach had the email.
     *
     * Specific Search outreach is deliberately draft-only: Thriv3 composes,
     * Outlook opens, A PERSON reviews and edits and presses Send, and the
     * person then says so. The shared `/api/outreach/send` endpoint and the
     * Top 100 and bulk composers keep their immediate-send capability; this
     * one surface gives it up.
     * =====================================================================
     *
     * FIRST, BEFORE EVERYTHING. No relationship is created, no outbound
     * capacity reserved, no Outlook window opened, no message row written and
     * no contact stance touched. `sendOutreach` is never reached.
     */
    if (body.send === true) {
      return res.status(422).json({
        code: 'MANUAL_OUTREACH_DRAFT_ONLY',
        error: 'Thriv3 does not send individual outreach for you. It opens a draft in Outlook '
          + 'for you to review and send yourself, and you then mark it as sent here. Nothing '
          + 'was drafted or sent.',
      });
    }

    /**
     * ADDRESSES COME FROM THE REGISTRY, NOT FROM THE REQUEST.
     *
     * The shared endpoint accepts `coaches: [{name, email, title}]` and will
     * write to whatever address it is handed. Here the client names ids and
     * they are looked up against this programme's own staff, so a request
     * cannot introduce a recipient who does not work at the school the
     * relationship is with — which is the one thing a contact rule scoped to a
     * programme would otherwise be unable to mean.
     */
    const staff = programmeCoaches({ collegeName: ctx.collegeName, sport: ctx.sport });
    const wanted = Array.isArray(body.coachIds) ? body.coachIds : [];
    if (!wanted.length) {
      return res.status(400).json({ error: 'Name at least one coach to write to.', code: 'NO_COACH_SELECTED' });
    }
    const byId = new Map(staff.map((c) => [c.coach_id, c]));
    const unknown = wanted.filter((id) => !byId.has(id));
    if (unknown.length) {
      return res.status(422).json({
        error: `Not on this programme's staff: ${unknown.join(', ')}.`,
        code: 'COACH_NOT_AT_PROGRAMME',
      });
    }
    const coaches = wanted.map((id) => {
      const c = byId.get(id);
      return { name: c.name, email: c.email, title: c.title };
    });

    /**
     * THE RECIPIENT'S OWN PROTECTION, MOVED TO DRAFT TIME — F7b.
     *
     * ---------------------------------------------------------------------
     * `sendOutreach` checks the per-inbox cap only when it is about to send —
     * `if (send && isSendCapped(...))` — which was right while this route
     * could send. Draft-only would have removed the cap from this workflow
     * entirely: a draft would open for a coach who has already had three
     * approaches this month, a person would send it, and nothing would ever
     * have objected.
     *
     * So it is asked HERE, at the last moment Thriv3 controls anything. Once
     * the draft is in Outlook this system has no handle on it and no way to
     * stop a send, so draft creation is where a refusal can still mean
     * something.
     *
     * THE SAME HELPER, UNCHANGED, AND SCOPED TO THIS SURFACE. `isSendCapped`
     * is read-only and is the single implementation of this rule; the campaign
     * path reads it through its own callers and its behaviour is untouched.
     * `sendOutreach` keeps its own check for the callers that still send.
     * ---------------------------------------------------------------------
     *
     * PER COACH, AND ONLY THE CAPPED ONES ARE REFUSED. Writing to a head coach
     * and an assistant where only one inbox is over its limit should draft the
     * other, not fail the run — so the capped recipients are named and the rest
     * proceed. All of them capped is a refusal with nothing drafted.
     */
    const capped = coaches
      .filter((c) => isSendCapped(c.email))
      .map((c) => ({
        name: c.name,
        email: c.email,
        recentSends: recentSendCount(c.email),
      }));
    const allowed = coaches.filter((c) => !capped.some((x) => x.email === c.email));
    if (!allowed.length) {
      return res.status(422).json({
        code: 'RECIPIENT_SEND_CAP_REACHED',
        error: `Nothing was drafted. ${capped.length === 1 ? 'That inbox has' : 'Those inboxes have'} `
          + `already had ${PER_COACH_MAX_SENDS} approach${PER_COACH_MAX_SENDS === 1 ? '' : 'es'} `
          + `from Thriv3 in the last ${PER_COACH_WINDOW_DAYS} days, across every athlete.`,
        capped,
      });
    }


    const result = await sendOutreach({
      athleteId: ctx.playerId,
      // Only the inboxes that may still be approached. A capped one is
      // reported below rather than silently dropped.
      coaches: allowed,
      subject: body.subject,
      body: body.body,
      greetingName: body.greetingName,
      collegeName: ctx.collegeName,
      division: ctx.division,
      // The programme identity, exactly as the recommendation composer records
      // it — `match_id` has always held a college name rather than a row id.
      matchId: ctx.collegeName,
      /**
       * ALWAYS FALSE — F7b. Not "unless asked": `send: true` was refused at
       * the top of this handler, so by here there is nothing left to ask for.
       * The literal is deliberate — a derived value would leave somebody
       * wondering which caller could make it true.
       */
      send: false,
      evidenceSelection: body.evidenceSelection ?? null,
      evidenceStructure: body.evidenceStructure ?? null,
      bodySource: body.bodySource ?? null,
      // NOT A CAMPAIGN, and not a thing a caller may say otherwise about.
      programmeCampaignId: null,
    }, { origin: OUTREACH_ORIGIN.MANUAL });

    /**
     * NO STANCE IS ESTABLISHED HERE ANY MORE — F7b, AND THE SEAM MOVED RATHER
     * THAN DISAPPEARED.
     *
     * F5b put `establishManualOnly` on this line, conditional on a result
     * reporting `status: 'sent'`. That result could only ever come from
     * `send: true`, which this route now refuses outright — so the branch was
     * unreachable and a dead conditional claiming to establish contact policy
     * is worse than none.
     *
     * The authority is now the per-message confirmation below, which is the
     * only place in this workflow that learns a message was actually sent —
     * because the only thing that knows is the person who pressed Send in
     * Outlook.
     */
    return res.json({
      ...result,
      /**
       * NAMED RATHER THAN DROPPED. A coach who was not drafted to because
       * their inbox is over its limit is a thing the operator needs told;
       * silently composing to two of three would look like success.
       */
      capped,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err.code) return res.status(422).json({ error: err.message, code: err.code });
    console.error('[manual-outreach/send]', err);
    return res.status(400).json({ error: err.message });
  }
});

/* -------------------------------------------------------------------------- */
/* After the human sends — F7b                                                 */
/* -------------------------------------------------------------------------- */

/**
 * WHAT IS STILL WAITING FOR THIS OPERATOR, FOR THE WHOLE ATHLETE, IN ONE CALL.
 *
 * Specific Schools renders a list, so this is athlete-level for the same reason
 * `/contact-intelligence` is: a pending-draft lookup per card would be an N+1
 * that grows with exactly the athletes who have the most outreach. The client
 * indexes it by programme and every row reads a local entry.
 *
 * MANUAL DRAFTS ONLY. A campaign message is not something an operator confirms
 * by hand, and listing one would put an action on screen that the route below
 * refuses.
 */
manualOutreachRouter.get('/players/:playerId/pending-manual-drafts', (req, res) => {
  try {
    const athlete = db.prepare('SELECT id FROM players WHERE id = ?').get(req.params.playerId);
    if (!athlete) {
      return res.status(404).json({ error: 'No such athlete.', code: 'ATHLETE_NOT_FOUND' });
    }
    return res.json({ drafts: pendingManualDraftsForAthlete(req.params.playerId) });
  } catch (err) {
    console.error('[manual-outreach/pending]', err);
    return res.status(500).json({ error: 'Unexpected error.' });
  }
});

/** Domain refusal -> status. All of these are facts about the row, not policy. */
const CONFIRMATION_STATUS = Object.freeze({
  [CONFIRMATION_REFUSAL.SEND_NOT_FOUND]: 404,
  [CONFIRMATION_REFUSAL.SEND_NOT_FOR_RELATIONSHIP]: 404,
  [CONFIRMATION_REFUSAL.NOT_A_MANUAL_MESSAGE]: 422,
  [CONFIRMATION_REFUSAL.NOT_AWAITING_CONFIRMATION]: 409,
  [CONFIRMATION_REFUSAL.OUTREACH_REVOKED]: 422,
});

/**
 * THE ATHLETE, THE PROGRAMME AND THE MESSAGE, ALL THREE PROVED — F7b.
 *
 * The URL names the first two and they are resolved through `loadContext`,
 * which 404s a relationship this athlete does not have. The message id is the
 * only thing the client supplies, and it is checked against both — a valid
 * uuid is not an entitlement, and a client that guessed one must not be able
 * to confirm somebody else's message.
 */
function withSend(req, action) {
  const ctx = loadContext(req);
  return action({
    sendId: req.params.sendId,
    athleteId: ctx.playerId,
    collegeName: ctx.collegeName,
    sport: ctx.sport,
  });
}

function confirmationError(err, res, label) {
  const status = CONFIRMATION_STATUS[err.code];
  if (status) return res.status(status).json({ error: err.message, code: err.code });
  if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
  console.error(`[${label}]`, err);
  return res.status(500).json({ error: 'Unexpected error.' });
}

/**
 * "I SENT THIS ONE." — AN ASSERTION, AND THE ONLY KIND AVAILABLE.
 *
 * ===========================================================================
 * THRIV3 DID NOT SEE THIS HAPPEN AND MUST NEVER SAY OTHERWISE.
 *
 * Outlook is driven by AppleScript that returns no message id and no handle,
 * so there is nothing to poll and nothing to match on. This endpoint records
 * what a person says, sourced OPERATOR_ASSERTED, which is the weakest of the
 * four accepted-sources and the honest one. No wording on this path — response,
 * log or screen — may read as "verified", "detected" or "delivered".
 * ===========================================================================
 *
 * It is what establishes `manual_only`, and therefore what makes the automated
 * campaign back off from this school. That happens inside the domain function
 * through F5b's own seam, which re-reads the message's origin rather than
 * trusting that we are in a manual route.
 */
manualOutreachRouter.post(
  '/players/:playerId/programmes/:id/outreach/:sendId/confirm-sent',
  (req, res) => {
    try {
      return res.json(withSend(req, confirmManualDraftSent));
    } catch (err) {
      return confirmationError(err, res, 'manual-outreach/confirm-sent');
    }
  },
);

/**
 * "I NEVER SENT THIS ONE."
 *
 * The draft was deleted in Outlook, or abandoned, or replaced by something
 * written by hand — F7a found such a row stays pending for ever with no way to
 * clear it. CANCELLED is the state the machine already defines for exactly
 * this: "withdrawn before it went anywhere. Terminal."
 *
 * IT CLAIMS NOTHING ABOUT OUTLOOK, which this system cannot see. It records
 * that Thriv3's own books no longer treat the message as awaiting an answer.
 * The row, its subject, its body hash and its evidence all survive; nothing is
 * marked sent, and no contact stance is established.
 */
manualOutreachRouter.post(
  '/players/:playerId/programmes/:id/outreach/:sendId/discard',
  (req, res) => {
    try {
      return res.json(withSend(req, discardManualDraft));
    } catch (err) {
      return confirmationError(err, res, 'manual-outreach/discard');
    }
  },
);
