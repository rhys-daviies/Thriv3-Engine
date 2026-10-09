#!/usr/bin/env node
/**
 * Published athletes against generated profile pages, for one backup
 * (deployment readiness §2d, check 3). Read-only, on COPIES only.
 *
 *   node server/scripts/verifyPublishedProfiles.js <copy.sqlite> <profiles dir | profiles.tgz> [--json]
 *
 * Exits 0 when no published athlete is missing a page and no page is orphaned,
 * 1 otherwise. Prints ids and slugs only.
 */
import { verifyPublishedProfiles } from '../lib/verifyPublishedProfiles.js';

const args = process.argv.slice(2);
const [dbFile, profiles] = args.filter((a) => !a.startsWith('--'));
if (!dbFile || !profiles) {
  console.error('Usage: verifyPublishedProfiles.js <copy.sqlite> <profiles dir | profiles.tgz> [--json]');
  process.exit(2);
}
const r = verifyPublishedProfiles(dbFile, profiles);
if (args.includes('--json')) {
  process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
} else {
  const c = r.counts;
  console.log(`published athletes ${c.athletesPublished}   pages ${c.pages}`);
  console.log(`missing ${c.missing}   orphaned ${c.orphaned}   unstamped (informational) ${c.unstamped}`);
  for (const m of r.missing) console.log(`  MISSING   ${m.slug}  athlete ${m.athleteId}`);
  for (const o of r.orphaned) console.log(`  ORPHANED  ${o.slug}  ${o.why}`);
  for (const b of r.invalidSlugs) console.log(`  INVALID SLUG  athlete ${b.athleteId}`);
  for (const l of r.interruptedPublish) console.log(`  INTERRUPTED PUBLISH LEFTOVER  ${l}`);
  console.log(r.ok ? 'OK' : 'FAIL');
}
process.exit(r.ok ? 0 : 1);
