import express from 'express';
import { gapQueue, QUEUE_SEASON } from '../scripts/rosterGapQueue.js';
import { recordReview, reviewFor } from '../lib/rosterGapReview.js';
import { DISPOSITIONS, NEXT_ACTIONS, allowedActionsFor } from '../../shared/roster/gapReview.js';
import { allStatuses, activeForSeason, TARGET_SEASON } from '../lib/programmeStatus.js';

/**
 * THE ROSTER-GAP REVIEW API — a doorway, not a second data layer.
 *
 * `server/lib/rosterGapReview.js` owns persistence and
 * `shared/roster/gapReview.js` owns the vocabulary and every rule about which
 * conclusions may be stored. This module does the three things a library
 * cannot do for itself: decide what a request is ALLOWED to say, map a domain
 * refusal to a status code, and decide what leaves the building.
 *
 * ---------------------------------------------------------------------------
 * THE THREE LAYERS SURVIVE THE WIRE.
 *
 * L7K's whole finding was that a machine observation and a human conclusion had
 * been travelling as one vocabulary. A response that flattened them into a
 * single `status` would undo that at the last possible moment, so the queue
 * sends three named groups — `machine`, `recorded` and `operator` — and there
 * is deliberately no top-level `status` field for a caller to reach for.
 *
 * ---------------------------------------------------------------------------
 * ALLOW-LISTS REFUSE, THEY DO NOT IGNORE.
 *
 * An unknown field is a 400 naming it, following `campaigns.js`. A client that
 * believes it just set something and got a 200 has been told something false.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS ENDPOINT CANNOT DO.
 *
 * It writes one table. It cannot start an acquisition, touch
 * `_state/state<S>.json`, `athletics_domains`, `roster_players` or
 * `colleges.active`, and it imports nothing from Evidence, matching or
 * outreach. A `PROGRAMME_STATUS_QUESTION` records that a programme's status is
 * in doubt; deciding it is a separate act by whoever owns the registry.
 */

export const rosterGapsRouter = express.Router();

/** Everything a review may say. Anything else is a 400 naming it. */
const REVIEW_FIELDS = Object.freeze([
  'season', 'school', 'sport', 'disposition', 'nextAction', 'retryAfter', 'evidence',
]);

/**
 * A sentence, not a payload.
 *
 * Long enough for a real observation — "site returns 503 on every route, host
 * unchanged since August" — and short enough that nobody pastes a page into it.
 */
export const EVIDENCE_MAX = 400;

const unknownFields = (body, allowed) => Object.keys(body ?? {}).filter((k) => !allowed.includes(k));

/** One row, with the layers kept in named groups rather than flattened. */
function present(r) {
  return {
    key: r.key,
    school: r.school,
    sport: r.sport,
    gender: r.gender,
    division: r.division,
    unitid: r.unitid,
    machine: {
      candidateState: r.candidateState,
      candidates: r.candidates,
      fetchHosts: r.fetchHosts,
      lastStatus: r.lastStatus,
      lastStage: r.lastStage,
      lastFailureClass: r.lastFailureClass,
      lastError: r.lastError,
      lastAttempts: r.lastAttempts,
      // L7J: a durable reason froze at the first attempt. Where the live
      // planner contradicts it, say so rather than presenting it as current.
      recordedStale: r.recordedStale,
    },
    operator: {
      reviewStatus: r.reviewStatus,
      disposition: r.disposition,
      nextAction: r.nextAction,
      retryAfter: r.retryAfter,
      reviewedAt: r.reviewedAt,
      reviewedByOperatorId: r.reviewedByOperatorId ?? null,
      evidence: r.reviewEvidence,
      previousDisposition: r.previousDisposition ?? null,
      previousReviewedAt: r.previousReviewedAt ?? null,
    },
    retryEligible: r.retryEligible,
    retryReason: r.retryReason,
  };
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

rosterGapsRouter.get('/roster-gaps', (req, res) => {
  try {
    const q = gapQueue({ season: Number(req.query.season) || QUEUE_SEASON });
    res.json({
      season: q.season,
      rows: q.rows.map(present),
      summary: q.summary,
      /*
       * The vocabulary travels with the queue so a form cannot drift from the
       * server's rules — one contract, and the server is still the authority.
       */
      vocabulary: {
        dispositions: DISPOSITIONS.map((d) => ({ value: d, allowedActions: allowedActionsFor(d) })),
        nextActions: NEXT_ACTIONS,
        evidenceMaxLength: EVIDENCE_MAX,
      },
    });
  } catch (err) {
    console.error('[roster-gaps]', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// One review
// ---------------------------------------------------------------------------

rosterGapsRouter.post('/roster-gaps/review', (req, res) => {
  const body = req.body ?? {};
  const unknown = unknownFields(body, REVIEW_FIELDS);
  if (unknown.length) {
    return res.status(400).json({ error: `unknown field(s): ${unknown.join(', ')}` });
  }
  const season = Number(body.season) || QUEUE_SEASON;
  const { school, sport } = body;
  if (!school || !sport) return res.status(400).json({ error: 'school and sport are required' });

  const evidence = String(body.evidence ?? '').trim();
  if (evidence.length > EVIDENCE_MAX) {
    return res.status(400).json({ error: `evidence must be ${EVIDENCE_MAX} characters or fewer` });
  }

  /*
   * REVIEWING A GAP THAT IS NOT IN THE QUEUE IS A MISTAKE, NOT A FEATURE.
   *
   * The queue is derived from the registry, so a key outside it is either a
   * typo or a programme that already holds a roster — and a review of the
   * second would sit there asserting something about a gap that closed.
   */
  const inQueue = gapQueue({ season }).rows.some((r) => r.school === school && r.sport === sport);
  if (!inQueue) {
    return res.status(404).json({ error: `${school} / ${sport} is not an open NCAA roster gap for ${season}` });
  }

  /*
   * REVIEWER IDENTITY IS NOT INVENTED HERE.
   *
   * This API has no authentication — the operator app runs behind whatever
   * protects the deployment, and `server/index.js` mounts only `cors()` and
   * `express.json()`. There is therefore no identity to attribute, and putting
   * a placeholder in `reviewed_by_operator_id` would make the column lie in a
   * way that is worse than its being empty. It stays null, exactly as
   * `athlete_programmes` leaves its operator note unattributed, until the
   * application has a sign-in worth recording.
   */
  const result = recordReview({
    season,
    school,
    sport,
    disposition: body.disposition,
    nextAction: body.nextAction,
    retryAfter: body.retryAfter ?? null,
    evidence,
    operatorId: null,
  });
  if (!result.ok) return res.status(400).json({ error: result.reason });
  return res.json({ review: result.review });
});

/**
 * Programme status, read only.
 *
 * Sparse by design, so this is the whole table — a few rows, not a page of a
 * thousand. There is deliberately NO write route: the six records are approved
 * product decisions recorded by a narrow library call, and a generic mutation
 * endpoint would make it easy to remove a programme from the universe by
 * accident. If a status ever needs changing from the UI, that is a deliberate
 * stage of its own.
 */
rosterGapsRouter.get('/programme-status', (req, res) => {
  try {
    const season = Number(req.query.season) || TARGET_SEASON;
    const rows = [...allStatuses().values()].map((r) => ({
      school: r.school,
      sport: r.sport,
      status: r.status,
      reason: r.reason,
      activeFromSeason: r.activeFromSeason,
      activeToSeason: r.activeToSeason,
      activeForSeason: activeForSeason(r, season),
      evidence: r.evidence,
      sourceUrl: r.sourceUrl,
      recordedAt: r.recordedAt,
    })).sort((a, b) => a.school.localeCompare(b.school) || a.sport.localeCompare(b.sport));
    res.json({ season, rows });
  } catch (err) {
    console.error('[programme-status]', err);
    res.status(500).json({ error: err.message });
  }
});

rosterGapsRouter.get('/roster-gaps/review', (req, res) => {
  const { school, sport } = req.query;
  if (!school || !sport) return res.status(400).json({ error: 'school and sport are required' });
  const review = reviewFor(Number(req.query.season) || QUEUE_SEASON, school, sport);
  return res.json({ review });
});
