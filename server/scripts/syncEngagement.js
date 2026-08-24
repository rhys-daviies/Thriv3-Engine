/**
 * Syncs with the edge collector.
 *
 *   npm run sync
 *
 * Pushes the live token list up, then pulls new events down and resolves each
 * one to a coach locally. Safe to re-run: pulls are idempotent on the edge's
 * own row id.
 */
import 'dotenv/config';
import { syncWithEdge, isEdgeConfigured } from '../lib/edgeSync.js';

if (!isEdgeConfigured()) {
  console.error('[sync] THRIV3_EDGE_URL and THRIV3_SYNC_SECRET must both be set (see .env)');
  process.exit(1);
}

const result = await syncWithEdge();
console.log(
  `[sync] pushed ${result.tokens.pushed} token(s)`
  + (result.tokens.liveAtEdge === null ? '' : `, ${result.tokens.liveAtEdge} live at the edge`)
);
console.log(
  `[sync] fetched ${result.events.fetched}, inserted ${result.events.inserted}`
  + `, unresolved ${result.events.unresolved}, cursor now ${result.events.cursor}`
);
console.log(`[sync] rebuilt ${result.events.rollups} rollup(s)`);

// Non-zero exit so whatever ends up scheduling this has something to alert on.
// A mismatch means the links coaches are holding do not resolve, which is
// silent from the local database's point of view — see ROADMAP.md §1.1.
if (result.tokens.mismatch) {
  console.error(
    `[sync] MISMATCH: expected ${result.tokens.expectedLive} live token(s) at the edge, `
    + `it reports ${result.tokens.liveAtEdge}. Tracked links may be serving the neutral page.`
  );
  process.exit(1);
}
