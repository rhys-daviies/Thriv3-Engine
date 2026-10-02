import express from 'express';
import db from '../db/client.js';
import { LINK_DECISION, isFactual } from '../../shared/players/identity.js';

/**
 * PLAYER HISTORY — read only (Phase 8B.1A).
 *
 * `roster_players.prior_programme` carries FACTUAL origins only (VERIFIED_SAME_PERSON). This route
 * exposes the claims that are NOT factual — a same-name player at another programme last season,
 * probable or not — so the operator can see a POSSIBLE transfer for what it is, labelled, beside
 * the verified ones and never in their place. There is no write route: deciding a link is a review.
 *
 * Every row says `factual: false`. A caller cannot render one of these as a transfer without
 * ignoring that field.
 */
export const playerHistoryRouter = express.Router();
const SHOWN = [LINK_DECISION.PROBABLE_SAME_PERSON, LINK_DECISION.CANDIDATE, LINK_DECISION.AMBIGUOUS];

playerHistoryRouter.get('/player-history/possible-transfers', (req, res) => {
  const season = String(req.query.season || '');
  const sport = String(req.query.sport || '');
  if (!/^\d{4}$/.test(season) || !sport) return res.status(400).json({ error: 'season (YYYY) and sport are required' });
  const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='player_observation_links'").get();
  if (!has) return res.json({ season, sport, links: [] });
  const rows = db.prepare(`SELECT to_observation_id, from_programme, relation, decision, evidence_class
      FROM player_observation_links
     WHERE to_season = ? AND sport = ? AND relation <> 'SAME_PROGRAMME_CONTINUATION'
       AND decision IN (${SHOWN.map(() => '?').join(',')})`).all(season, sport, ...SHOWN);
  res.json({ season, sport, links: rows.filter((r) => !isFactual(r.decision)).map((r) => ({ ...r, factual: false })) });
});
