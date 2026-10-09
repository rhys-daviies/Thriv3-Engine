import express from 'express';
import {
  listProgrammes, programmeFacets, programmeDetail, programmeRecruiting, programmeIntelligenceFor,
  ProgrammeQueryError,
} from '../lib/programmeDatabase.js';

/**
 * THE PROGRAMME DATABASE — Phase 4. GET only.
 *
 *   GET /api/programmes                       filtered, paginated list
 *   GET /api/programmes/facets?sport=         divisions, conferences, classes
 *   GET /api/programmes/:id?classYear=        overview + roster & openings
 *   GET /api/programmes/:id/recruiting        recruiting intelligence
 *   GET /api/programmes/:id/intelligence      philosophy + competitive history
 *
 * Coaches & Contacts reuse /api/colleges/:id/coaches and
 * /api/colleges/:id/programme-contacts unchanged, so their eligibility floors
 * are the ones every other surface applies.
 *
 * The existing GET /api/programmes/intelligence (observations router, by
 * programme NAME) is mounted BEFORE this router, so it keeps answering that
 * exact path; `:id/intelligence` here takes an id.
 */
export const programmesRouter = express.Router();

function fail(res, err, label) {
  if (err instanceof ProgrammeQueryError) return res.status(400).json({ error: err.message, code: err.code });
  console.error(`[programmes${label}]`, err);
  return res.status(500).json({ error: 'Could not load programmes.' });
}

programmesRouter.get('/programmes', (req, res) => {
  try { return res.json(listProgrammes(req.query)); } catch (err) { return fail(res, err, ''); }
});

programmesRouter.get('/programmes/facets', (req, res) => {
  try {
    return res.json(programmeFacets({ sport: req.query.sport, includeInactive: req.query.includeInactive === '1' }));
  } catch (err) { return fail(res, err, '/facets'); }
});

const notFound = (res) => res.status(404).json({ error: 'No such programme.', code: 'PROGRAMME_NOT_FOUND' });

programmesRouter.get('/programmes/:id', (req, res) => {
  try {
    const out = programmeDetail(req.params.id, { classYear: req.query.classYear });
    return out ? res.json(out) : notFound(res);
  } catch (err) { return fail(res, err, '/detail'); }
});

programmesRouter.get('/programmes/:id/recruiting', async (req, res) => {
  try {
    const out = await programmeRecruiting(req.params.id);
    return out ? res.json(out) : notFound(res);
  } catch (err) { return fail(res, err, '/recruiting'); }
});

programmesRouter.get('/programmes/:id/intelligence', async (req, res) => {
  try {
    const out = await programmeIntelligenceFor(req.params.id);
    return out ? res.json(out) : notFound(res);
  } catch (err) { return fail(res, err, '/intelligence'); }
});
