/**
 * Static profile page generator.
 *
 *   npm run export:profiles                      every eligible athlete
 *   npm run export:profiles -- --athlete <id>    one athlete, by id or exact name
 *   npm run export:profiles -- --dry-run         pages log events instead of posting
 *
 * Output lands in build/public/. Serve it over http (not file://) or the
 * YouTube IFrame API will not initialise.
 */
import { exportAll, exportAthlete, findAthlete, trackingEndpoint, writeRobotsTxt, OUTPUT_DIR } from '../export/exportProfiles.js';
import { checkRequiredCore } from '../export/renderProfile.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const athleteArg = args.includes('--athlete') ? args[args.indexOf('--athlete') + 1] : null;

console.log(`[export] endpoint ${trackingEndpoint()}${dryRun ? ' (dry run)' : ''}`);
console.log(`[export] output   ${OUTPUT_DIR}`);

if (athleteArg) {
  const athlete = findAthlete(athleteArg);
  if (!athlete) {
    console.error(`[export] no athlete matching "${athleteArg}"`);
    process.exit(1);
  }
  const missing = checkRequiredCore(athlete);
  if (missing.length) {
    console.error(`[export] refusing to generate for ${athlete.full_name} — missing: ${missing.join(', ')}`);
    process.exit(1);
  }
  const result = exportAthlete(athlete, { dryRun });
  writeRobotsTxt();
  console.log(`[export] wrote ${result.name} -> p/${result.slug}.html`);
} else {
  const { written, skipped } = exportAll({ dryRun });
  for (const w of written) console.log(`[export] wrote ${w.name} -> p/${w.slug}.html`);
  for (const s of skipped) console.log(`[export] skipped ${s.name} — missing: ${s.missing.join(', ')}`);
  console.log(`[export] ${written.length} written, ${skipped.length} skipped`);
}
