import express from 'express';
import db from '../db/client.js';
import { Player } from '../db/entities/player.js';
import {
  recordObservation, reviewObservation, observationsFor, observationsForSelection,
  programmeIntelligence, currentState,
  OBSERVATION_KIND, OBSERVATION_CATEGORY, OBSERVATION_SOURCE,
  CLASSIFIER_METHOD, REVIEW_STATE, CORRECTION, categoryOf,
} from '../lib/v2/recruitingObservations.js';
import { KIND_ATTRIBUTES } from '../../shared/recruitingObservations.js';
import { sendProvenance } from '../lib/v2/outreachProvenance.js';
import { recordReply, classifyReply, replyChain } from '../lib/v2/replyIntake.js';
import { selectionsOverview } from '../lib/v2/selectionsOverview.js';

/**
 * THE OBSERVATION API — A9.6 §N.
 *
 * A doorway, in the shape `matchmaking.js` set. All the thinking is in
 * `server/lib/v2/recruitingObservations.js`; this module decides who may ask,
 * maps a domain failure to a status code, and decides what leaves the
 * building.
 *
 * -- WHAT IT WILL NOT ACCEPT -----------------------------------------------
 *
 * A client-defined machine event name. §N is explicit about it, and the
 * vocabulary endpoint below is the reason it costs nothing to refuse: an
 * operator surface asks what the legal kinds are and renders those, rather
 * than inventing a string and hoping.
 *
 * -- ACCESS ----------------------------------------------------------------
 *
 * `requireOperator` in server/index.js, exactly like every other player route.
 * No new access model is introduced beside a telemetry feature.
 */
export const observationsRouter = express.Router();

const STATUS_BY_CODE = Object.freeze({
  PLAYER_NOT_FOUND: 404,
  OBSERVATION_NOT_FOUND: 404,
  SEND_NOT_FOUND: 404,
  SELECTION_NOT_FOUND: 404,
  CORRECTION_TARGET_NOT_FOUND: 404,

  // Well formed, and asking for something not allowed to be true.
  OBSERVATION_KIND_UNKNOWN: 422,
  OBSERVATION_SOURCE_UNKNOWN: 422,
  CLASSIFIER_METHOD_UNKNOWN: 422,
  REVIEW_STATE_UNKNOWN: 422,
  REVIEW_STATE_INVALID: 422,
  CORRECTION_UNKNOWN: 422,
  CORRECTION_INCOMPLETE: 422,
  CORRECTION_SUBJECT_MISMATCH: 422,
  OBSERVATION_ATTRIBUTES_INVALID: 422,
  OBSERVATION_SEND_MISMATCH: 422,
  OBSERVATION_SEND_PROGRAMME_MISMATCH: 422,
  OBSERVATION_SELECTION_MISMATCH: 422,
  OBSERVATION_SELECTION_PROGRAMME_MISMATCH: 422,

  OBSERVATION_SUBJECT_REQUIRED: 400,
  PROGRAMME_REQUIRED: 400,

  /* ---- A9.7 §H / §I: replies -------------------------------------------- */
  /**
   * 422, not 400. The request is well formed and names a real message; what it
   * asks for is not allowed to be TRUE — there is no reply to classify, or the
   * kind named is about the athlete rather than the coach.
   */
  NO_REPLY_RECORDED: 422,
  NOT_A_REPLY_CLASSIFICATION: 422,
  SEND_PROGRAMME_UNKNOWN: 422,
});

function handle(label, fn) {
  return (req, res) => {
    try {
      const { status = 200, body } = fn(req);
      return res.status(status).json(body);
    } catch (err) {
      const status = STATUS_BY_CODE[err.code];
      if (status) return res.status(status).json({ error: err.message, code: err.code });
      console.error(`[${label}]`, err);
      return res.status(500).json({ error: 'Unexpected error.' });
    }
  };
}

const notFound = (id) => {
  const err = new Error(`Unknown player: ${id}`);
  err.code = 'PLAYER_NOT_FOUND';
  return err;
};

const needProgramme = () => {
  const err = new Error('An observation is about a programme: give collegeName and sport.');
  err.code = 'PROGRAMME_REQUIRED';
  return err;
};

const player = (req) => {
  const row = Player.get(req.params.id);
  if (!row || row.archived_at) throw notFound(req.params.id);
  return row;
};

/**
 * THE VOCABULARY, SERVED.
 *
 * So an operator surface renders the legal kinds and their required attributes
 * instead of keeping a second copy that drifts — the same reasoning that put
 * the contribution states on the intake form from the model rather than from a
 * restatement.
 */
observationsRouter.get('/observations/vocabulary', handle('observations:vocabulary', () => ({
  body: {
    categories: OBSERVATION_CATEGORY,
    kinds: Object.values(OBSERVATION_KIND).map((kind) => ({
      kind,
      category: categoryOf(kind),
      required: KIND_ATTRIBUTES[kind]?.required ?? [],
      optional: KIND_ATTRIBUTES[kind]?.optional ?? [],
    })),
    sources: OBSERVATION_SOURCE,
    classifierMethods: CLASSIFIER_METHOD,
    reviewStates: REVIEW_STATE,
    corrections: CORRECTION,
  },
})));

/** Record one observation about this athlete and one programme. */
observationsRouter.post('/players/:id/observations', handle('observations:record', (req) => {
  const row = player(req);
  const b = req.body ?? {};
  if (!b.collegeName || !b.sport) throw needProgramme();
  return {
    status: 201,
    body: recordObservation(db, {
      athleteId: row.id,
      collegeName: b.collegeName,
      sport: b.sport,
      collegeId: b.collegeId ?? null,
      coachId: b.coachId ?? null,
      outreachSendId: b.outreachSendId ?? null,
      matchmakingSelectionId: b.matchmakingSelectionId ?? null,
      kind: b.kind,
      attributes: b.attributes ?? null,
      note: b.note ?? null,
      source: b.source,
      classifierMethod: b.classifierMethod ?? CLASSIFIER_METHOD.MANUAL,
      classifierVersion: b.classifierVersion ?? null,
      confidence: b.confidence ?? null,
      correctsObservationId: b.correctsObservationId ?? null,
      correction: b.correction ?? null,
      providerEventId: b.providerEventId ?? null,
      observedAt: b.observedAt ?? null,
    }),
  };
}));

/** Everything observed about this athlete and one programme, oldest first. */
observationsRouter.get('/players/:id/observations', handle('observations:list', (req) => {
  const row = player(req);
  const { collegeName, sport } = req.query;
  if (!collegeName || !sport) throw needProgramme();
  return {
    body: {
      observations: observationsFor(db, { athleteId: row.id, collegeName, sport }),
      /**
       * THE DERIVED STATE, BESIDE THE ROWS THAT PRODUCE IT — §Q. Returned
       * together on purpose: a surface that renders only the projection would
       * make a rebuildable summary look like stored truth.
       */
      state: currentState(db, { athleteId: row.id, collegeName, sport }),
    },
  };
}));

/** Confirm or reject one classification. Never un-review it. */
observationsRouter.post('/observations/:observationId/review', handle('observations:review', (req) => ({
  body: reviewObservation(db, {
    observationId: req.params.observationId,
    state: req.body?.state,
    operatorId: req.body?.operatorId ?? null,
  }),
})));

/** What came of one selection — the attribution read, end to end. */
observationsRouter.get('/selections/:selectionId/observations', handle('observations:selection', (req) => ({
  body: { observations: observationsForSelection(db, req.params.selectionId) },
})));

/**
 * One programme's stated recruiting position over time — §T.
 *
 * ATHLETE-INDEPENDENT, and that is the whole point of the endpoint: it returns
 * only the recruiting-intelligence kinds, so "who is this programme looking
 * for" can be asked without dragging in how any athlete fared with it.
 */
observationsRouter.get('/programmes/intelligence', handle('observations:intelligence', (req) => {
  const { collegeName, sport, since } = req.query;
  if (!collegeName || !sport) throw needProgramme();
  return {
    body: {
      collegeName,
      sport,
      observations: programmeIntelligence(db, { collegeName, sport, since: since || null }),
    },
  };
}));

/**
 * Everything this athlete has been selected for, and what came of it — §K.
 *
 * The operational verification surface for rollout, and deliberately not an
 * analytics one: one row per selection with the run's own frozen numbers, what
 * was sent, whether a reply was recorded, and the latest REVIEWED reading.
 */
observationsRouter.get('/players/:id/selections/overview', handle('observations:overview', (req) => {
  const row = player(req);
  return { body: selectionsOverview(row.id) };
}));

/**
 * Record that a reply arrived — A9.7 §H.
 *
 * NOTHING INGESTS REPLIES IN THIS BUILD. There is no IMAP reader, no Gmail
 * watch and no inbound webhook, and `contactIntelligence.js` has said so since
 * it was written. This is the operator asserting it, which is the only honest
 * producer available, and it classifies nothing.
 */
observationsRouter.post('/sends/:sendId/reply', handle('observations:reply', (req) => ({
  status: 201,
  body: recordReply(db, {
    sendId: req.params.sendId,
    observedAt: req.body?.observedAt ?? null,
    note: req.body?.note ?? null,
  }),
})));

/**
 * Record what a reply MEANT — A9.7 §I.
 *
 * The caller names a KIND and nothing else about the subject: the athlete, the
 * programme, the coach and the selection are read from the message. There is
 * no parameter with which to misfile a classification against the wrong
 * programme.
 */
observationsRouter.post('/sends/:sendId/classification', handle('observations:classify', (req) => {
  const b = req.body ?? {};
  return {
    status: 201,
    body: classifyReply(db, {
      sendId: req.params.sendId,
      kind: b.kind,
      attributes: b.attributes ?? null,
      note: b.note ?? null,
      classifierMethod: b.classifierMethod ?? undefined,
      classifierVersion: b.classifierVersion ?? null,
      confidence: b.confidence ?? null,
      observedAt: b.observedAt ?? null,
      /**
       * Explicit, never defaulted true by a caller omitting it. The default
       * REQUIRES a recorded reply; passing false is a caller stating that this
       * came from a telephone call, which is the one honest exception.
       */
      requireReply: b.fromCall === true ? false : undefined,
    }),
  };
}));

/** reply -> send -> selection -> programme -> run, for one message. */
observationsRouter.get('/sends/:sendId/reply-chain', handle('observations:reply-chain', (req) => ({
  body: replyChain(db, req.params.sendId),
})));

/** The provenance chain behind one message, or the honest absence of one. */
observationsRouter.get('/sends/:sendId/provenance', handle('observations:provenance', (req) => ({
  body: sendProvenance(db, req.params.sendId),
})));
