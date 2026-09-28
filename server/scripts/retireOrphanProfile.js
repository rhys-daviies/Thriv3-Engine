#!/usr/bin/env node
/**
 * Retires an orphaned public slug — a page the last deployment served whose
 * athlete record no longer exists.
 *
 * Publishing refuses to drop any page the previous deployment contained unless
 * something says so deliberately. For an athlete who still exists that is
 * archive. For a slug whose row was deleted rather than archived there is
 * nothing left to carry the flag, so the refusal stands forever until someone
 * names the slug here and says why.
 *
 *   node server/scripts/retireOrphanProfile.js <slug> --reason "old test athlete"
 *   node server/scripts/retireOrphanProfile.js --list
 *
 * This does NOT publish. It records permission; the next publish is what
 * actually removes the page from Cloudflare.
 */
import 'dotenv/config';
import { OUTPUT_DIR } from '../export/exportProfiles.js';
import { readLedger } from '../lib/publishManifest.js';
import {
  readRetirements, retireOrphanSlug, retirementRegistryPath,
} from '../lib/orphanRetirement.js';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };

const register = readRetirements(OUTPUT_DIR);
if (register.error) {
  console.error(`\n  The retirement register is unreadable: ${register.error}`);
  console.error('  Nothing can be retired until that is fixed.\n');
  process.exit(1);
}

if (args.includes('--list')) {
  console.log(`\n  ${retirementRegistryPath(OUTPUT_DIR)}\n`);
  if (!register.entries.length) {
    console.log('  No slugs have been retired.\n');
    process.exit(0);
  }
  console.log(`  ${'slug'.padEnd(34)} ${'retired'.padEnd(26)} reason`);
  for (const r of register.entries) {
    console.log(`  ${r.slug.padEnd(34)} ${r.retiredAt.padEnd(26)} ${r.reason}`);
  }
  console.log();
  process.exit(0);
}

const slug = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--reason');
const reason = flag('reason');

if (!slug || !reason) {
  console.error('\nUsage: node server/scripts/retireOrphanProfile.js <slug> --reason "why"');
  console.error('       node server/scripts/retireOrphanProfile.js --list\n');
  process.exit(1);
}

// A slug the last deployment never contained cannot be the cause of a refusal,
// and retiring it would record a decision that changes nothing. Much the most
// likely explanation is a mistyped slug, so say so rather than accept it.
const ledger = readLedger(OUTPUT_DIR);
if (ledger && !ledger.slugs.includes(slug)) {
  console.error(`\n  ${slug} was not in the last deployment (${ledger.slugs.length} page(s), ${ledger.at}).`);
  console.error('  Retiring it would change nothing. Check the slug against the refusal message.\n');
  process.exit(1);
}

let result;
try {
  result = retireOrphanSlug({ slug, reason, outputDir: OUTPUT_DIR });
} catch (err) {
  console.error(`\n  Refused: ${err.message}\n`);
  process.exit(1);
}

console.log(result.alreadyRetired
  ? `\n  ${slug} was already retired on ${result.retiredAt} — "${result.reason}". Nothing changed.\n`
  : `\n  Retired ${slug} — "${result.reason}".\n`
    + '  The page stays live until the next successful publish, which will drop it.\n');
