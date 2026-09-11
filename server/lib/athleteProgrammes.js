import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { findCanonicalCollege } from './collegeSearch.js';
import { utcNow } from './time.js';

/**
 * THE ATHLETE-TO-PROGRAMME RELATIONSHIP, AND THE INVARIANTS ON IT.
 *
 * The table's own reasoning is in server/db/schema.sql. What this module owns
 * is everything that cannot be expressed as a CHECK constraint: that identity
 * comes from the registry rather than from a request, that the three states
 * stay three states, and that a timestamp is written by the transition it
 * describes rather than by a caller who might name any instant it liked.
 *
 * ---------------------------------------------------------------------------
 * IT NEVER TOUCHES `suppressions`. There is no import of ./suppressions.js in
 * this file and there must never be one. That table is keyed on email with no
 * athlete column — a row in it silences an address for every athlete in the
 * system — and the per-athlete equivalent here is `contact_stance`, which the
 * campaign layer will read in its own right. The regression test in
 * athleteProgrammes.test.js asserts the count of suppression rows is unchanged
 * across every write this module performs.
 * ---------------------------------------------------------------------------
 */

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export const REQUEST_STATES = Object.freeze(['none', 'requested', 'withdrawn']);
export const REQUESTED_BY = Object.freeze(['athlete', 'family', 'operator']);
export const VISIBILITY = Object.freeze(['default', 'suppressed']);
export const CONTACT_STANCES = Object.freeze(['default', 'manual_only', 'do_not_contact']);

/**
 * The fields an operator may author. Everything else on the row — the identity
 * columns, every timestamp, the id — is written here and by nothing else.
 */
export const RELATIONSHIP_FIELDS = Object.freeze([
  'request_state', 'requested_by', 'flagged', 'flag_reason',
  'visibility', 'contact_stance', 'note',
]);

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const SELECT_COLUMNS = `
  id, athlete_id, college_name, sport, college_id,
  request_state, requested_by, requested_at,
  flagged, flag_reason, flagged_at,
  visibility, contact_stance,
  note, note_updated_at,
  created_at, updated_at
`;

/**
 * `flagged` is stored as 0/1 because SQLite has no boolean, and is handed out
 * as a boolean because every caller wants one. Converted here rather than at
 * each call site, so no reader can forget and find `0` truthy.
 */
function shape(row) {
  if (!row) return null;
  return { ...row, flagged: row.flagged === 1 };
}

export function listAthleteProgrammes(athleteId) {
  requireAthlete(athleteId);
  const rows = db.prepare(`
    SELECT ${SELECT_COLUMNS} FROM athlete_programmes
     WHERE athlete_id = ?
     ORDER BY college_name, sport
  `).all(athleteId);
  return rows.map(shape);
}

export function getAthleteProgramme(athleteId, id) {
  const row = db.prepare(`
    SELECT ${SELECT_COLUMNS} FROM athlete_programmes
     WHERE athlete_id = ? AND id = ?
  `).get(athleteId, id);
  return shape(row);
}

/** The relationship for one programme, if there is one. Used by the upsert. */
export function findRelationship(athleteId, collegeName, sport) {
  const row = db.prepare(`
    SELECT ${SELECT_COLUMNS} FROM athlete_programmes
     WHERE athlete_id = ? AND college_name = ? AND sport = ?
  `).get(athleteId, collegeName, sport);
  return shape(row);
}

// ---------------------------------------------------------------------------
// Identity — resolved from the registry, never from the request
// ---------------------------------------------------------------------------

function requireAthlete(athleteId) {
  const athlete = db.prepare('SELECT id, sport FROM players WHERE id = ?').get(athleteId);
  if (!athlete) {
    throw fail('ATHLETE_NOT_FOUND', `No athlete ${JSON.stringify(athleteId)}.`);
  }
  return athlete;
}

/**
 * Turn a selected college id into the identity that gets stored.
 *
 * THREE DIFFERENT REFUSALS, not one. "No such college", "that college is a
 * different sport" and "that programme is inactive" are three different things
 * for an operator to be told, and collapsing them into a single not-found is
 * how somebody spends ten minutes wondering why a school they can see in the
 * registry cannot be added.
 *
 * The sport comes from the ATHLETE, not from the request. An athlete's
 * relationships are with programmes in the sport they play; letting a caller
 * name the sport would let a women's-soccer programme be filed under a
 * men's-soccer athlete by supplying one extra field.
 */
function resolveProgramme(athlete, collegeId) {
  const id = typeof collegeId === 'string' ? collegeId.trim() : '';
  if (!id) {
    throw fail('COLLEGE_REQUIRED',
      'A relationship must name a college_id selected from the programme search. '
      + 'A school name on its own is not an identity this will store.');
  }
  const sport = typeof athlete.sport === 'string' ? athlete.sport.trim() : '';
  if (!sport) {
    throw fail('ATHLETE_SPORT_UNKNOWN',
      'This athlete has no sport, so there is no programme registry to resolve against.');
  }

  const college = findCanonicalCollege({ collegeId: id, sport });
  if (college) return { college, sport };

  // Nothing matched under the athlete's sport. Say which of the three it was.
  const anySport = db.prepare('SELECT id, name, sport, active FROM colleges WHERE id = ?').get(id);
  if (!anySport) {
    throw fail('COLLEGE_NOT_FOUND', `No college ${JSON.stringify(id)} in the registry.`);
  }
  if (anySport.sport !== sport) {
    throw fail('COLLEGE_SPORT_MISMATCH',
      `${anySport.name} is a ${anySport.sport} programme and this athlete plays ${sport}. `
      + 'The same college name is a different programme in each sport.');
  }
  throw fail('COLLEGE_INACTIVE',
    `${anySport.name} is not an active ${sport} programme, so it cannot be added to an athlete's list.`);
}

// ---------------------------------------------------------------------------
// Validating what an operator asked for
// ---------------------------------------------------------------------------

function oneOf(value, allowed, field, code) {
  if (!allowed.includes(value)) {
    throw fail(code, `${field} must be one of ${allowed.join(', ')}; got ${JSON.stringify(value)}.`);
  }
  return value;
}

function text(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    throw fail('INVALID_FIELD', `${field} must be a string or null; got ${JSON.stringify(value)}.`);
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Normalise one patch against the row it will be applied to, and refuse
 * anything the row cannot honestly become.
 *
 * A REASON IS REQUIRED WITH THE STATE THAT NEEDS ONE, following the convention
 * campaigns already set with CLOSE_REASON_REQUIRED and STOP_REASON_REQUIRED. A
 * flag whose reason is blank records that somebody clicked something; the
 * reason IS the flag, as far as anyone reading it later is concerned.
 *
 * `requested_by` is required alongside a request for the same reason, and is
 * emphatically NOT an operator identity — 'operator' means "a member of staff
 * added this", not which one. Nothing in this build can say which one.
 */
function normalisePatch(patch, current) {
  const out = {};
  const now = utcNow();

  if ('request_state' in patch) {
    const next = oneOf(patch.request_state, REQUEST_STATES, 'request_state', 'INVALID_REQUEST_STATE');
    out.request_state = next;
    if (next === 'requested') {
      const by = 'requested_by' in patch ? patch.requested_by : current?.requested_by ?? null;
      if (!by) {
        throw fail('REQUESTED_BY_REQUIRED',
          'Recording a specific-school request must say who asked for it: '
          + `${REQUESTED_BY.join(', ')}.`);
      }
      out.requested_by = oneOf(by, REQUESTED_BY, 'requested_by', 'INVALID_REQUESTED_BY');
      // Stamped on the transition INTO requested, and left alone when a row
      // that is already requested is patched for some other reason — a note
      // edit must not re-date the request.
      if (!current || current.request_state !== 'requested') out.requested_at = now;
    } else {
      // Leaving 'requested' keeps who asked and when: a withdrawn request that
      // forgets it was ever made is indistinguishable from one never made.
      if ('requested_by' in patch) {
        out.requested_by = patch.requested_by === null
          ? null
          : oneOf(patch.requested_by, REQUESTED_BY, 'requested_by', 'INVALID_REQUESTED_BY');
      }
    }
  } else if ('requested_by' in patch) {
    out.requested_by = patch.requested_by === null
      ? null
      : oneOf(patch.requested_by, REQUESTED_BY, 'requested_by', 'INVALID_REQUESTED_BY');
  }

  if ('flagged' in patch) {
    const raw = patch.flagged;
    if (typeof raw !== 'boolean') {
      throw fail('INVALID_FLAG', `flagged must be true or false; got ${JSON.stringify(raw)}.`);
    }
    out.flagged = raw ? 1 : 0;
    if (raw) {
      const reason = 'flag_reason' in patch ? text(patch.flag_reason, 'flag_reason') : current?.flag_reason ?? null;
      if (!reason) {
        throw fail('FLAG_REASON_REQUIRED',
          'Flagging an existing relationship must say what the relationship is. '
          + 'A flag with no reason records that somebody clicked something.');
      }
      out.flag_reason = reason;
      if (!current || current.flagged !== true) out.flagged_at = now;
    } else {
      // Unflagging clears the reason and the timestamp together. A stale
      // reason under flagged = 0 reads as a flag in every list view.
      out.flag_reason = null;
      out.flagged_at = null;
    }
  } else if ('flag_reason' in patch) {
    const reason = text(patch.flag_reason, 'flag_reason');
    if (!reason && current?.flagged) {
      throw fail('FLAG_REASON_REQUIRED', 'A flagged relationship cannot have its reason cleared. Unflag it instead.');
    }
    out.flag_reason = reason;
  }

  if ('visibility' in patch) {
    out.visibility = oneOf(patch.visibility, VISIBILITY, 'visibility', 'INVALID_VISIBILITY');
  }
  if ('contact_stance' in patch) {
    out.contact_stance = oneOf(patch.contact_stance, CONTACT_STANCES, 'contact_stance', 'INVALID_CONTACT_STANCE');
  }
  if ('note' in patch) {
    out.note = text(patch.note, 'note');
    out.note_updated_at = out.note === null ? null : now;
  }

  return { patch: out, now };
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * Create the relationship, or apply the patch to the one that already exists.
 *
 * AN UPSERT RATHER THAN A CREATE, because the UNIQUE (athlete_id,
 * college_name, sport) constraint means there is only ever one row per
 * programme and a caller has no way to know whether it exists yet. Two
 * features write here — a specific request and a flag — and whichever arrives
 * second must land on the same row rather than get a constraint error.
 *
 * Returns `{ programme, created }`. The flag is part of the answer rather than
 * something a caller re-derives: the only honest way to tell afterwards would
 * be to count rows before and after, and a caller that guesses from
 * `created_at === updated_at` is wrong for the upsert that changed nothing.
 */
export function upsertAthleteProgramme(athleteId, { college_id: collegeId, ...fields } = {}) {
  const athlete = requireAthlete(athleteId);
  const { college, sport } = resolveProgramme(athlete, collegeId);

  const existing = findRelationship(athleteId, college.name, sport);
  const { patch, now } = normalisePatch(fields, existing);

  if (existing) {
    return { programme: applyPatch(athleteId, existing.id, patch, now), created: false };
  }

  const row = {
    id: randomUUID(),
    athlete_id: athleteId,
    // FROM THE REGISTRY ROW, never from the request. A caller may have sent a
    // name alongside the id; the router refuses it, and this would ignore it
    // regardless.
    college_name: college.name,
    sport,
    college_id: college.id,
    request_state: patch.request_state ?? 'none',
    requested_by: patch.requested_by ?? null,
    requested_at: patch.requested_at ?? null,
    flagged: patch.flagged ?? 0,
    flag_reason: patch.flag_reason ?? null,
    flagged_at: patch.flagged_at ?? null,
    visibility: patch.visibility ?? 'default',
    contact_stance: patch.contact_stance ?? 'default',
    note: patch.note ?? null,
    note_updated_at: patch.note_updated_at ?? null,
    created_at: now,
    updated_at: now,
  };

  db.prepare(`
    INSERT INTO athlete_programmes (
      id, athlete_id, college_name, sport, college_id,
      request_state, requested_by, requested_at,
      flagged, flag_reason, flagged_at,
      visibility, contact_stance,
      note, note_updated_at, created_at, updated_at
    ) VALUES (
      @id, @athlete_id, @college_name, @sport, @college_id,
      @request_state, @requested_by, @requested_at,
      @flagged, @flag_reason, @flagged_at,
      @visibility, @contact_stance,
      @note, @note_updated_at, @created_at, @updated_at
    )
  `).run(row);

  return { programme: getAthleteProgramme(athleteId, row.id), created: true };
}

/** Patch an existing relationship, addressed by its own id. */
export function updateAthleteProgramme(athleteId, id, fields = {}) {
  requireAthlete(athleteId);
  const existing = getAthleteProgramme(athleteId, id);
  if (!existing) {
    throw fail('RELATIONSHIP_NOT_FOUND', `No programme relationship ${JSON.stringify(id)} for this athlete.`);
  }
  const { patch, now } = normalisePatch(fields, existing);
  return applyPatch(athleteId, id, patch, now);
}

function applyPatch(athleteId, id, patch, now) {
  const columns = Object.keys(patch);
  if (columns.length === 0) {
    // Nothing to change is not an error — an upsert that only names a college
    // is how a relationship gets created with no state on it yet — but it must
    // not bump `updated_at` and claim something happened.
    return getAthleteProgramme(athleteId, id);
  }
  db.prepare(`
    UPDATE athlete_programmes
       SET ${columns.map((c) => `${c} = @${c}`).join(', ')}, updated_at = @updated_at
     WHERE athlete_id = @athlete_id AND id = @id
  `).run({ ...patch, updated_at: now, athlete_id: athleteId, id });
  return getAthleteProgramme(athleteId, id);
}
