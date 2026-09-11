import express from 'express';
import {
  listAthleteProgrammes, getAthleteProgramme,
  upsertAthleteProgramme, updateAthleteProgramme,
  RELATIONSHIP_FIELDS,
} from '../lib/athleteProgrammes.js';
import { searchColleges, SEARCH_LIMITS } from '../lib/collegeSearch.js';

/**
 * THE ATHLETE-PROGRAMME API — a doorway, in the shape campaigns already set.
 *
 * Every mutation delegates to server/lib/athleteProgrammes.js, which owns the
 * invariants. This module decides what a request is ALLOWED to say, maps a
 * domain failure to a status code, and decides what leaves the building.
 *
 * `athlete_programmes` is deliberately absent from the ENTITIES registry in
 * server/index.js, for the reason campaigns gives and one more of its own.
 * That registry is unvalidated pass-through CRUD: through it a client could
 * POST any `college_name` it liked and write a school that does not exist into
 * an athlete's list, which is precisely the identity guarantee this table is
 * for. The only way in is the allow-lists below, and the only way to name a
 * programme is a `college_id` the registry already holds.
 *
 * ---------------------------------------------------------------------------
 * ALLOW-LISTS REFUSE, THEY DO NOT IGNORE. An unknown or immutable field is a
 * 400 naming it, never a silent drop — a client that believes it just set
 * `college_name` and got a 200 has been told something false.
 * ---------------------------------------------------------------------------
 */

export const athleteProgrammesRouter = express.Router();

// ---------------------------------------------------------------------------
// What a request may say
// ---------------------------------------------------------------------------

/** Creating or upserting: the programme selection, plus any operator state. */
const UPSERT_FIELDS = Object.freeze(['college_id', ...RELATIONSHIP_FIELDS]);

/** Patching: state only. The programme a relationship is WITH does not change. */
const PATCH_FIELDS = Object.freeze([...RELATIONSHIP_FIELDS]);

/**
 * Named so the refusal can say WHY.
 *
 * `college_name` and `sport` head the list because they are the fields a
 * client is most likely to send in good faith — a picker result carries both —
 * and sending them is exactly the mistake that must not half-work. They are
 * copied from the registry row the `college_id` names and from nowhere else.
 */
const IMMUTABLE_FIELDS = Object.freeze({
  id: 'assigned at creation',
  athlete_id: 'a relationship belongs to the athlete it was created for',
  college_name: 'read from the registry row college_id names, never from a request',
  sport: 'read from the athlete and the registry row, never from a request',
  college_id: 'the programme a relationship is with is fixed when it is created',
  requested_at: 'stamped when a request is recorded, not by editing it',
  flagged_at: 'stamped when a flag is set, not by editing it',
  note_updated_at: 'stamped when the note changes, not by editing it',
  flagged_by_operator_id: 'read from the signed-in operator, never from a request',
  note_updated_by_operator_id: 'read from the signed-in operator, never from a request',
  created_at: 'dates the record',
  updated_at: 'maintained by the server',
});

/**
 * WHO IS ACTING, READ FROM THE SESSION AND NEVER FROM THE BODY.
 *
 * `attachOperator` puts `req.operator` there when a valid session cookie says
 * so, and `requireOperator` guarantees one in front of every route in
 * server/index.js. It is read here rather than accepted as a field for the
 * obvious reason: an attribution a client can choose is not an attribution.
 *
 * Null is tolerated rather than required, because these routes are mounted
 * bare in their own tests and a missing author is honest — the alternative is
 * a write that fails for a reason unrelated to what it was trying to do.
 */
function actor(req) {
  return { operatorId: req.operator?.id ?? null };
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function readBody(body, allowed, what) {
  if (body === null || body === undefined) return {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest(`A ${what} request body must be an object.`);
  }
  const offered = Object.keys(body);
  const immutable = offered.filter((k) => !allowed.includes(k) && k in IMMUTABLE_FIELDS);
  if (immutable.length) {
    throw badRequest(
      `Cannot set ${immutable.join(', ')}: `
      + immutable.map((k) => `${k} ${IMMUTABLE_FIELDS[k]}`).join('; ')
      + '. A programme relationship names a registry row; it does not describe one.',
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

/** An explicit projection, so a column added later is not silently an API. */
function relationship(row) {
  return {
    id: row.id,
    athlete_id: row.athlete_id,
    college_name: row.college_name,
    sport: row.sport,
    college_id: row.college_id,
    request_state: row.request_state,
    requested_by: row.requested_by,
    requested_at: row.requested_at,
    flagged: row.flagged,
    flag_reason: row.flag_reason,
    flagged_at: row.flagged_at,
    visibility: row.visibility,
    contact_stance: row.contact_stance,
    note: row.note,
    note_updated_at: row.note_updated_at,
    flagged_by_operator_id: row.flagged_by_operator_id ?? null,
    note_updated_by_operator_id: row.note_updated_by_operator_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // Read live from `colleges` at request time, not stored on the row — see
    // JOIN_REGISTRY in server/lib/athleteProgrammes.js. Null when the registry
    // row has gone; the relationship and its own identity survive that.
    division: row.division ?? null,
    conference: row.conference ?? null,
    city: row.city ?? null,
    state: row.state ?? null,
    college_active: row.college_active ?? null,
  };
}

/**
 * Compact, and compact on purpose: a picker needs enough to tell two schools
 * apart and nothing more. Ratings and scores are absent because a search box
 * is not a place to compare programmes — that is what the match list is.
 */
function candidate(row) {
  return {
    id: row.id,
    name: row.name,
    sport: row.sport,
    division: row.division,
    conference: row.conference,
    city: row.city,
    state: row.state,
    matched_on: row.matched_on,
  };
}

// ---------------------------------------------------------------------------
// Domain failure -> status code
// ---------------------------------------------------------------------------

const STATUS_BY_CODE = Object.freeze({
  ATHLETE_NOT_FOUND: 404,
  COLLEGE_NOT_FOUND: 404,
  RELATIONSHIP_NOT_FOUND: 404,

  // Well-formed, and asking for something not allowed to be true.
  COLLEGE_REQUIRED: 422,
  COLLEGE_SPORT_MISMATCH: 422,
  COLLEGE_INACTIVE: 422,
  ATHLETE_SPORT_UNKNOWN: 422,
  INVALID_REQUEST_STATE: 422,
  INVALID_REQUESTED_BY: 422,
  INVALID_VISIBILITY: 422,
  INVALID_CONTACT_STANCE: 422,
  INVALID_FLAG: 422,
  INVALID_FIELD: 422,
  REQUESTED_BY_REQUIRED: 422,
  FLAG_REASON_REQUIRED: 422,

  // The caller's query is malformed, which is a 400 rather than a 422: there
  // is no entity being asked to become something impossible.
  SPORT_REQUIRED: 400,
  SEARCH_QUERY_TOO_SHORT: 400,
});

/** One handler for every route, so no endpoint invents its own 404. */
function handle(label, fn) {
  return (req, res) => {
    try {
      const { status = 200, body } = fn(req);
      return res.status(status).json(body);
    } catch (err) {
      if (err.status) return res.status(err.status).json({ error: err.message });
      const status = STATUS_BY_CODE[err.code];
      if (status) return res.status(status).json({ error: err.message, code: err.code });

      // Anything else — a SQLite constraint, a bug — is ours, and its text may
      // name a table or a column. Logged in full, reported as nothing.
      console.error(`[${label}]`, err);
      return res.status(500).json({ error: 'Unexpected error.' });
    }
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Find programmes an operator may then select.
 *
 * DISCOVERY, NOT RESOLUTION. It returns candidates; choosing is the operator's
 * act and storing happens only when they POST the id of one of these rows. See
 * the head of server/lib/collegeSearch.js for why there is no code path that
 * turns typed text into an identity on its own.
 */
athleteProgrammesRouter.get('/colleges/search', handle('colleges/search', (req) => {
  const { sport, q, limit } = req.query;
  const parsedLimit = limit === undefined ? undefined : Number.parseInt(limit, 10);
  if (limit !== undefined && !Number.isInteger(parsedLimit)) {
    throw badRequest(`limit must be a whole number; got ${JSON.stringify(limit)}.`);
  }
  const results = searchColleges({ sport, query: q, limit: parsedLimit });
  return {
    body: {
      query: typeof q === 'string' ? q.trim() : '',
      sport: typeof sport === 'string' ? sport.trim() : '',
      limits: SEARCH_LIMITS,
      results: results.map(candidate),
    },
  };
}));

/** Every relationship this athlete has. */
athleteProgrammesRouter.get('/players/:playerId/programmes', handle('programmes/list', (req) => ({
  body: { programmes: listAthleteProgrammes(req.params.playerId).map(relationship) },
})));

/** One relationship, by its own id. */
athleteProgrammesRouter.get('/players/:playerId/programmes/:id', handle('programmes/get', (req) => {
  const row = getAthleteProgramme(req.params.playerId, req.params.id);
  if (!row) return { status: 404, body: { error: 'No such programme relationship for this athlete.' } };
  return { body: { programme: relationship(row) } };
}));

/**
 * Create the relationship, or apply this state to the one that already exists.
 *
 * 200 rather than 201 when it already existed, so a client can tell whether it
 * made something. Two features write here and neither can know in advance
 * whether the other got there first.
 */
athleteProgrammesRouter.post('/players/:playerId/programmes', handle('programmes/upsert', (req) => {
  const body = readBody(req.body, UPSERT_FIELDS, 'programme relationship');
  const { programme, created } = upsertAthleteProgramme(req.params.playerId, body, actor(req));
  return { status: created ? 201 : 200, body: { programme: relationship(programme) } };
}));

/** Change the state of an existing relationship. Never the programme it is with. */
athleteProgrammesRouter.patch('/players/:playerId/programmes/:id', handle('programmes/update', (req) => {
  const body = readBody(req.body, PATCH_FIELDS, 'programme relationship update');
  const row = updateAthleteProgramme(req.params.playerId, req.params.id, body, actor(req));
  return { body: { programme: relationship(row) } };
}));
