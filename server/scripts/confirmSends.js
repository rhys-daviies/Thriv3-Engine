#!/usr/bin/env node
/**
 * Confirming which drafts were actually sent.
 *
 * `npm run draft -- --apply` opens draft windows in Outlook. Nothing observes
 * whether you then press Send — there is no callback and no honest way to
 * infer it — so a draft stays UNCONFIRMED, and every denominator that keys on
 * `sent_at` ignores it: evidence performance, reply rates, the per-inbox send
 * cap. This is how a confirmation gets recorded.
 *
 * The workflow:
 *
 *   npm run draft -- --athlete "Rhys Davies" --top 20 --apply   drafts open
 *   ... send them in Outlook ...
 *   npm run confirm-sends -- --athlete "Rhys Davies"            what is pending
 *   npm run confirm-sends -- --athlete "Rhys Davies" --apply    confirm the batch
 *
 * Listing is the default and confirming needs `--apply`, the same way drafting
 * does. Confirming the wrong batch inflates a denominator with mail nobody
 * received, which is the failure this whole command exists to prevent, so it
 * is not something to do by pressing return.
 */
import 'dotenv/config';
import db from '../db/client.js';
import { Player } from '../db/entities/player.js';
import {
  pendingBatches, confirmSent, draftSummary, BATCH_GAP_MINUTES,
} from '../lib/confirmSends.js';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const flag = (n) => argv.includes(`--${n}`);

function findAthlete(needle) {
  if (!needle) return null;
  return Player.get(needle)
    || db.prepare('SELECT * FROM players WHERE lower(full_name) = lower(?)').get(needle)
    || db.prepare('SELECT * FROM players WHERE lower(full_name) LIKE lower(?)').get(`%${needle}%`);
}

const ageOf = (iso) => {
  const days = (Date.now() - Date.parse(iso)) / 86_400_000;
  if (!Number.isFinite(days)) return 'unknown age';
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h ago`;
  return `${Math.round(days)}d ago`;
};

function main() {
  const athleteName = arg('athlete');
  const athlete = athleteName ? findAthlete(athleteName) : null;
  if (athleteName && !athlete) {
    console.error(`No athlete matching "${athleteName}".`);
    process.exit(1);
  }
  const athleteId = athlete?.id ?? null;

  const batches = pendingBatches({ athleteId });
  const summary = draftSummary({ athleteId });

  console.log(`\nOUTREACH STATUS${athlete ? ` — ${athlete.full_name}` : ''}`);
  console.log(`  ${summary.confirmed_sent} confirmed sent · ${summary.pending} drafted awaiting `
    + `confirmation · ${summary.revoked} revoked`);

  if (!batches.length) {
    console.log('\n  Nothing is waiting to be confirmed.\n');
    return;
  }

  console.log(`\n  ${batches.length} pending batch(es), split on gaps over ${BATCH_GAP_MINUTES} minutes:\n`);
  for (const b of batches) {
    console.log(`  [${b.index}] ${b.count} draft(s) · ${b.from.slice(0, 16).replace('T', ' ')} `
      + `· ${ageOf(b.from)}`);
    console.log(`      ${b.athletes.join(', ')} → ${b.colleges.length} programme(s): `
      + `${b.colleges.slice(0, 6).join(', ')}${b.colleges.length > 6 ? ', …' : ''}`);
    if (flag('verbose')) {
      for (const r of b.rows) {
        console.log(`        ${r.school.padEnd(26)} ${(r.coach_name || '').padEnd(22)} ${r.email}`);
      }
    }
  }

  /**
   * Which batch. The LAST one by default, because it is the run just finished
   * — but never silently: the chosen batch is printed before anything is
   * written, and `--all` has to be asked for by name.
   */
  const wanted = flag('all')
    ? batches
    : [batches[Number(arg('batch', batches.length)) - 1]].filter(Boolean);

  if (!wanted.length) {
    console.error(`\n  No batch ${arg('batch')}. Pick 1-${batches.length}, or --all.\n`);
    process.exit(1);
  }

  const ids = wanted.flatMap((b) => b.rows.map((r) => r.id));
  const label = flag('all')
    ? `all ${batches.length} batch(es)`
    : `batch [${wanted[0].index}] from ${wanted[0].from.slice(0, 16).replace('T', ' ')}`;

  if (!flag('apply')) {
    console.log(`\n  Would confirm ${ids.length} draft(s) — ${label}.`);
    console.log('  Confirm ONLY what you actually sent from Outlook: a confirmation puts these');
    console.log('  into every reply-rate denominator, and mail nobody received cannot be');
    console.log('  distinguished from mail that got no reply.');
    console.log(`\n  Re-run with --apply to confirm${batches.length > 1 ? ', or --batch N / --all to choose' : ''}.\n`);
    return;
  }

  const result = confirmSent(ids);
  console.log(`\n  Confirmed ${result.confirmed} send(s) at ${result.at} — ${label}.`);
  if (result.skipped.length) {
    // Already confirmed, revoked, or drafted since the listing was built.
    console.log(`  ${result.skipped.length} skipped (already confirmed or revoked).`);
  }
  const after = draftSummary({ athleteId });
  console.log(`  Now: ${after.confirmed_sent} confirmed sent · ${after.pending} still awaiting confirmation.\n`);
}

main();
