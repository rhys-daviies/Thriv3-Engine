import express from 'express';
import { trustQueue } from '../scripts/seasonTrustQueue.js';
import {
  recordDisposition, attributionOf, exclusionBlockedReason,
} from '../lib/seasonTrustReview.js';
import { DIAGNOSIS_KEYS, DISPOSITION_KEYS } from '../../shared/roster/seasonTrust.js';

/**
 * THE HISTORICAL SEASON TRUST API — a doorway, and for now a locked one.
 *
 * `server/lib/seasonTrustReview.js` owns persistence and every rule about who
 * may decide; `shared/roster/seasonTrust.js` owns the vocabulary. This module
 * does what a library cannot: decide what a request is ALLOWED to say, resolve
 * the operator identity from the server's own context, map a domain refusal to
 * a status code, and decide what leaves the building.
 *
 * ---------------------------------------------------------------------------
 * THE WRITE PATH IS BUILT AND DISABLED, on purpose.
 *
 * From L7ZK the governance rule is that every new human disposition carries an
 * authenticated operator identity. This application has no authentication:
 * `server/index.js` mounts `cors()` and `express.json()` and nothing else,
 * there is no auth dependency in `package.json`, no request ever carries a
 * `req.user`, and `operator_users` is created by no code in this repository.
 * `rosterGaps.js` reached the same conclusion in L7L and writes `operatorId:
 * null` for exactly this reason.
 *
 * So `operatorFromRequest` returns null, `recordDisposition` refuses without an
 * identity, and the POST answers 503 with the prerequisite named. The door is
 * built so that when sign-in arrives the change is one function; it is shut so
 * that until then nothing can decide anonymously.
 *
 * EXCLUDE_FROM_EVIDENCE is blocked for a SECOND, independent reason — see
 * `exclusionBlockedReason`. Both would have to be lifted, and the refusal says
 * which one it hit first.
 *
 * ---------------------------------------------------------------------------
 * ALLOW-LISTS REFUSE, THEY DO NOT IGNORE. An unknown field is a 400 naming it,
 * following `campaigns.js` and `rosterGaps.js`. A client that believes it just
 * set a reviewer and got a 200 has been told something false — which for THIS
 * field would be the whole governance rule quietly failing.
 */
export const rosterSeasonTrustRouter = express.Router();

/**
 * The authenticated operator for this request, or null.
 *
 * ONE FUNCTION, deliberately, so the prerequisite has a single address. When
 * the application gains sign-in this reads the session; until then it returns
 * null and every write refuses. It never consults the body or a header a
 * client controls, because an identity a caller can set is not an identity.
 */
export function operatorFromRequest(req) {
  return req?.operator?.id ?? null;
}

/** What a trust record looks like on the wire. Factual fields only. */
function toWire(r) {
  return {
    identity: { college_name: r.college_name, sport: r.sport, season: String(r.season) },
    programme: {
      college_name: r.college_name,
      sport: r.sport,
      season: String(r.season),
      association: r.association,
      division: r.division,
      row_count: r.rows,
    },
    /* The machine half. A measurement, and it changes nothing on its own. */
    machine: {
      diagnosis: r.diagnosis,
      diagnosis_evidence: r.diagnosis_evidence,
      diagnosed_at: r.diagnosed_at,
    },
    /*
     * The human half. `attribution` says whether a reviewer is recorded rather
     * than leaving a null to be read as "nobody" — the two RETAIN rows L7ZJ
     * wrote predate the attribution rule and are LEGACY_UNATTRIBUTED, which is
     * a fact about the record and not a gap in it.
     */
    operator: {
      disposition: r.disposition,
      disposition_evidence: r.disposition_evidence,
      reviewed_at: r.reviewed_at,
      reviewed_by_operator_id: r.reviewed_by_operator_id,
      attribution: attributionOf(r),
      next_action: r.next_action,
      previous_disposition: r.previous_disposition,
      previous_reviewed_at: r.previous_reviewed_at,
    },
    /* What this record currently does, stated rather than left to inference. */
    effect: {
      evidence_exposed: r.evidenceExposed,
      excluded_from_evidence: r.excludedFromEvidence,
      review_state: r.reviewState,
    },
  };
}

const FILTERS = Object.freeze(['diagnosis', 'disposition', 'reviewState', 'association', 'exposedOnly']);

rosterSeasonTrustRouter.get('/roster-season-trust', (req, res) => {
  const unknown = Object.keys(req.query ?? {}).filter((k) => !FILTERS.includes(k));
  if (unknown.length) {
    return res.status(400).json({ error: `unknown filter(s): ${unknown.join(', ')}. `
      + `Supported: ${FILTERS.join(', ')}` });
  }
  const { diagnosis, disposition, reviewState, association, exposedOnly } = req.query ?? {};
  if (diagnosis && !DIAGNOSIS_KEYS.includes(diagnosis)) {
    return res.status(400).json({ error: `diagnosis must be one of ${DIAGNOSIS_KEYS.join(', ')}` });
  }
  if (disposition && !DISPOSITION_KEYS.includes(disposition)) {
    return res.status(400).json({ error: `disposition must be one of ${DISPOSITION_KEYS.join(', ')}` });
  }
  if (reviewState && !['PENDING_REVIEW', 'DISPOSITIONED'].includes(reviewState)) {
    return res.status(400).json({ error: 'reviewState must be PENDING_REVIEW or DISPOSITIONED' });
  }

  /*
   * ORDER PRESERVED FROM L7ZJ. `trustQueue` sorts by Evidence exposure, then
   * NCAA, then programme identity, and filtering never reorders — a reviewer
   * working down the queue across sittings must see the same sequence whether
   * or not they narrowed it.
   */
  let rows = trustQueue();
  if (diagnosis) rows = rows.filter((r) => r.diagnosis === diagnosis);
  if (disposition) rows = rows.filter((r) => r.disposition === disposition);
  if (reviewState) rows = rows.filter((r) => r.reviewState === reviewState);
  if (association) rows = rows.filter((r) => r.association === association);
  if (exposedOnly === 'true') rows = rows.filter((r) => r.evidenceExposed);

  return res.json({
    records: rows.map(toWire),
    summary: {
      total: rows.length,
      pending_review: rows.filter((r) => r.reviewState === 'PENDING_REVIEW').length,
      dispositioned: rows.filter((r) => r.reviewState === 'DISPOSITIONED').length,
      excluded_from_evidence: rows.filter((r) => r.excludedFromEvidence).length,
    },
    /*
     * Stated on every read so a client cannot discover the closure only by
     * attempting a write, and so a future UI can render the door as locked
     * rather than offering a control that always fails.
     */
    write: {
      enabled: false,
      reason: 'no authenticated operator identity exists in this application; '
        + 'every new human disposition requires one',
      /*
       * Per sport, since L7ZL: whether an exclusion is technically safe now
       * depends on whether that sport's derived recruiting data can be
       * verified against the roster. Reported for both so a reader sees which
       * blocker they would hit, rather than one generic sentence.
       */
      exclude_blocked_by_sport: Object.fromEntries(['mens-soccer', 'womens-soccer']
        .map((s) => [s, exclusionBlockedReason(s)])),
    },
  });
});

/** Fields a client may send. Everything else is refused by name. */
const ALLOWED = Object.freeze(['college_name', 'sport', 'season',
  'disposition', 'disposition_evidence', 'next_action', 'expected_disposition']);
/** Fields the server owns. Sending one is an error, not something to ignore. */
const SERVER_OWNED = Object.freeze(['reviewed_by_operator_id', 'reviewed_at',
  'diagnosis', 'diagnosis_evidence', 'diagnosed_at',
  'previous_disposition', 'previous_reviewed_at']);

rosterSeasonTrustRouter.post('/roster-season-trust/disposition', (req, res) => {
  const body = req.body ?? {};

  /*
   * A SPOOF IS REFUSED, NEVER SILENTLY DROPPED. Ignoring a caller-supplied
   * reviewer would return 200 to a client that believes it attributed the
   * decision to someone else — the failure would be invisible at exactly the
   * point the governance rule matters most. 400, naming the field.
   */
  const spoofed = Object.keys(body).filter((k) => SERVER_OWNED.includes(k));
  if (spoofed.length) {
    return res.status(400).json({ error: `${spoofed.join(', ')} ${spoofed.length === 1 ? 'is' : 'are'} `
      + 'set by the server and may not be supplied. Reviewer identity comes from the authenticated '
      + 'session and the review time from the server clock.' });
  }
  const unknown = Object.keys(body).filter((k) => !ALLOWED.includes(k));
  if (unknown.length) {
    return res.status(400).json({ error: `unknown field(s): ${unknown.join(', ')}` });
  }

  /*
   * Identity is resolved BEFORE the payload is judged. A 400 listing payload
   * problems would tell an unauthenticated caller how to form a better request
   * for an action it may not take at all.
   */
  const operatorId = operatorFromRequest(req);
  if (!operatorId) {
    return res.status(503).json({
      error: 'disposition writing is unavailable: this application has no authenticated operator '
        + 'identity, and every new human disposition requires one.',
      prerequisite: 'operator sign-in, exposing the reviewer on the request context',
    });
  }

  const result = recordDisposition({
    season: body.season,
    college_name: body.college_name,
    sport: body.sport,
    disposition: body.disposition,
    evidence: body.disposition_evidence,
    nextAction: body.next_action ?? null,
    expectedDisposition: 'expected_disposition' in body ? body.expected_disposition : undefined,
    operatorId,
  });
  if (!result.ok) {
    /* A stale read is a conflict; everything else here is a malformed request. */
    const status = /has moved since it was read/.test(result.reason) ? 409 : 400;
    return res.status(status).json({ error: result.reason });
  }
  return res.json({ record: toWire({ ...result.record, rows: null, division: null, association: null }) });
});
