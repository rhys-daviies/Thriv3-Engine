/**
 * Rebuilds engagement_rollup for every outreach row that has events.
 *
 *   npm run rollup
 *
 * The collector rebuilds affected rows automatically as events arrive; this is
 * for backfills, and after any change to the scoring weights in brief §10.
 */
import { rebuildAllRollups } from '../lib/engagementRollup.js';

const rows = rebuildAllRollups();
for (const row of rows) {
  console.log(
    `[rollup] ${row.outreach_id.slice(0, 8)}  visits=${row.qualified_visits}`
    + `  coverage=${row.best_coverage_pct}%  rewinds=${row.total_rewinds}`
    + `  score=${row.engagement_score}  ${row.tier}`
  );
}
console.log(`[rollup] ${rows.length} outreach rows rebuilt`);
