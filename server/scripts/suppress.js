#!/usr/bin/env node
/**
 * Adds an address to the opt-out list by hand.
 *
 * For the replies that arrive as prose — "please take me off this" — rather
 * than through the link. At pilot volume those are read in a mailbox, and the
 * gap between reading one and honouring it should be one command rather than
 * a note to self.
 *
 *   node server/scripts/suppress.js coach@example.edu
 *   node server/scripts/suppress.js coach@example.edu --reason bounced
 *   node server/scripts/suppress.js --list
 */
import { suppress, listSuppressions, isSuppressed } from '../lib/suppressions.js';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };

if (args.includes('--list')) {
  const rows = listSuppressions();
  if (!rows.length) { console.log('\nNo suppressions.\n'); process.exit(0); }
  console.log(`\n${rows.length} suppressed address(es):\n`);
  console.log(`  ${'email'.padEnd(38)} ${'reason'.padEnd(13)} ${'source'.padEnd(8)} when`);
  for (const r of rows) {
    console.log(`  ${r.email.padEnd(38)} ${(r.reason || '').padEnd(13)} ${(r.source || '').padEnd(8)} ${r.created_at}`);
  }
  console.log();
  process.exit(0);
}

const email = args.find((a) => a.includes('@'));
if (!email) {
  console.error('Usage: node server/scripts/suppress.js <email> [--reason unsubscribed|bounced|complained|manual]');
  console.error('       node server/scripts/suppress.js --list');
  process.exit(1);
}

if (isSuppressed(email)) {
  console.log(`\n${email} is already suppressed — nothing to do.\n`);
  process.exit(0);
}

const result = suppress({ email, reason: flag('reason') || 'manual', source: 'manual', note: flag('note') });
console.log(`\nSuppressed ${result.email} (${result.reason}). No athlete will contact this address again.\n`);
