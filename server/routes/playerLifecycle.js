import express from 'express';
import { Player } from '../db/entities/player.js';
import { deactivateAthlete } from '../lib/athleteLifecycle.js';

/**
 * Listing and deleting athletes, as the operator experiences them.
 *
 * A router of its own rather than two more handlers in index.js, so the
 * deletion boundary can be exercised over HTTP without standing up the whole
 * application — this is the path that erased two athletes when it was a raw
 * DELETE, and it should be the easiest thing in the codebase to test.
 */
export const playerLifecycleRouter = express.Router();

/**
 * The athletes currently being represented — what the Players screen shows.
 *
 * A route of its own rather than a filter on /api/entities/players, so an
 * archived athlete stays reachable through the generic entity layer for the
 * code that legitimately needs them: the publish gate, the permanence
 * validator, the public page handler, engagement attribution. Narrowing the
 * generic list to suit one screen would hide the record from the very code
 * whose job is to reason about it.
 */
playerLifecycleRouter.get('/players/active', (req, res) => {
  const limit = req.query._limit ? Number(req.query._limit) : undefined;
  res.json(Player.listActive(req.query._sort, limit));
});

/**
 * "Delete player" — which archives.
 *
 * The row survives with its history. The athlete's outreach tokens are
 * revoked, so every link already in a coach's inbox stops resolving, and
 * `createOutreach` refuses to mint any more. They leave the active list.
 *
 * What does NOT happen here: their Cloudflare page keeps serving until the
 * next successful publish. That is what the confirmation dialog says, and it
 * is deliberate — deleting an athlete must not depend on a network the
 * operator cannot see, so nothing in this request touches Cloudflare or D1.
 * The permanence gate then accepts the eventual disappearance because
 * `archived_at` accounts for it.
 *
 * Idempotent: `deactivateAthlete` updates only where `archived_at IS NULL`, so
 * a second press reports zero newly revoked and leaves the first timestamp.
 */
playerLifecycleRouter.post('/players/:id/archive', (req, res) => {
  try {
    const athlete = Player.get(req.params.id);
    if (!athlete) return res.status(404).json({ error: 'Unknown athlete' });
    const result = deactivateAthlete(req.params.id);
    return res.json({ ...result, fullName: athlete.full_name });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * Refuses a hard delete of a player row, wherever the generic entity route
 * lives.
 *
 * TWO ATHLETES WERE ERASED THIS WAY. Their rows went; their Cloudflare pages
 * did not, and nothing was left to explain the difference — so the permanence
 * gate, which can only sanction an absence it can account for, refused every
 * publish afterwards until each slug was retired by name.
 *
 * The UI archives instead. Leaving the raw delete reachable would mean one
 * stray request could recreate that state, so it is refused here rather than
 * merely avoided upstream. Exported as middleware so the guard that actually
 * ships is the one under test, rather than a copy of it.
 */
export function blockPlayerHardDelete(req, res, next) {
  if (req.params.table !== 'players') return next();
  return res.status(405).json({
    error: 'Players are archived, not deleted, so their history and their public page can be '
      + 'accounted for. Use POST /api/players/:id/archive.',
  });
}
