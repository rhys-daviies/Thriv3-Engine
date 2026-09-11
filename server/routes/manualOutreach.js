import express from 'express';
import db from '../db/client.js';
import { getAthleteProgramme } from '../lib/athleteProgrammes.js';
import { manualContactDecision } from '../lib/manualOutreachSafety.js';
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

    const result = await sendOutreach({
      athleteId: ctx.playerId,
      coaches,
      subject: body.subject,
      body: body.body,
      greetingName: body.greetingName,
      collegeName: ctx.collegeName,
      division: ctx.division,
      // The programme identity, exactly as the recommendation composer records
      // it — `match_id` has always held a college name rather than a row id.
      matchId: ctx.collegeName,
      // DRAFT UNLESS ASKED. `send` is the operator's explicit opt-in and the
      // default everywhere it is absent.
      send: body.send === true,
      evidenceSelection: body.evidenceSelection ?? null,
      evidenceStructure: body.evidenceStructure ?? null,
      bodySource: body.bodySource ?? null,
      // NOT A CAMPAIGN, and not a thing a caller may say otherwise about.
      programmeCampaignId: null,
    }, { origin: OUTREACH_ORIGIN.MANUAL });

    return res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err.code) return res.status(422).json({ error: err.message, code: err.code });
    console.error('[manual-outreach/send]', err);
    return res.status(400).json({ error: err.message });
  }
});
