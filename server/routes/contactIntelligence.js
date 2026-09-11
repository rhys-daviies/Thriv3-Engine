import express from 'express';
import db from '../db/client.js';
import { contactIntelligenceForAthlete } from '../lib/contactIntelligence.js';

/**
 * ONE REQUEST FOR A WHOLE ATHLETE'S OUTREACH HISTORY.
 *
 * The matching page shows a hundred programmes twenty at a time, so the shape
 * of this endpoint is the performance requirement rather than a convenience:
 * one call, indexed client-side by programme, and every card reads a local
 * map. A per-card endpoint would be a hundred requests for one screen, and the
 * count would silently become a function of how the page happens to paginate.
 *
 * READ-ONLY, and there is deliberately no sibling that writes. Nothing here
 * marks a programme contacted, sets a flag, or touches `athlete_programmes` —
 * the history already exists in `outreach`, `outreach_send` and
 * `engagement_rollup`, and this only reads it.
 */

export const contactIntelligenceRouter = express.Router();

contactIntelligenceRouter.get('/players/:playerId/contact-intelligence', (req, res) => {
  try {
    const athlete = db.prepare('SELECT id FROM players WHERE id = ?').get(req.params.playerId);
    if (!athlete) {
      return res.status(404).json({ error: 'No such athlete.', code: 'ATHLETE_NOT_FOUND' });
    }
    /**
     * Programmes with no history are ABSENT rather than returned empty. The
     * client keys a map on the programme, and a miss is the honest
     * representation of "nobody has written to them" — a hundred empty
     * summaries would be a payload asserting a hundred facts that are all the
     * same non-fact.
     */
    return res.json({ programmes: contactIntelligenceForAthlete(req.params.playerId) });
  } catch (err) {
    console.error('[contact-intelligence]', err);
    return res.status(500).json({ error: 'Unexpected error.' });
  }
});
