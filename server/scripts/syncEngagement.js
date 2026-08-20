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
console.log(`[sync] pushed ${result.tokens.pushed} token(s)`);
console.log(
  `[sync] fetched ${result.events.fetched}, inserted ${result.events.inserted}`
  + `, unresolved ${result.events.unresolved}, cursor now ${result.events.cursor}`
);
console.log(`[sync] rebuilt ${result.events.rollups} rollup(s)`);
