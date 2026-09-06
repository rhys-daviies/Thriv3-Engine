#!/usr/bin/env node
/**
 * The Evidence behavioural baseline.
 *
 *   npm run evidence:baseline              the table
 *   npm run evidence:baseline -- --json    the same, for CI
 *   npm run evidence:baseline -- --update  rewrite the expectations
 *
 * READ `server/lib/evidenceBaseline.js` FIRST. It owns the corpus, the
 * serialization, the hashing and the comparison; this file only chooses how to
 * print them and where the committed expectations live.
 *
 * The corpus is not dumped. A baseline report exists to say WHICH boundary
 * moved; the diff itself is read by re-running the surface that moved —
 * `npm run evidence`, `npm run outreach-qa`, `npm run recruiting:evidence` —
 * on the pairing the movement points at.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildBaselines, compareBaselines, short, CONTRADICTION_KEYS } from '../lib/evidenceBaseline.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EXPECTED_PATH = path.join(HERE, '__baselines__/evidence.json');

export const readExpected = () => (existsSync(EXPECTED_PATH)
  ? JSON.parse(readFileSync(EXPECTED_PATH, 'utf8'))
  : null);

const argv = process.argv.slice(2);
const JSON_MODE = argv.includes('--json');
const UPDATE = argv.includes('--update');

function main() {
  const actual = buildBaselines();
  const expected = readExpected();
  const cmp = compareBaselines(expected, actual);

  if (JSON_MODE) {
    // Deterministic: same repository state and dataset, same bytes.
    process.stdout.write(`${JSON.stringify({
      dataset: cmp.dataset,
      datasetDigest: cmp.datasetActual,
      stats: cmp.stats,
      invariants: cmp.invariants,
      invariantsOk: cmp.invariantsOk,
      baselines: cmp.results.map((r) => ({
        name: r.name, size: r.size, digest: r.digest, expected: r.expected, status: r.status,
      })),
      ok: cmp.ok,
    }, null, 2)}\n`);
    process.exit(cmp.ok ? 0 : 1);
  }

  const s = cmp.stats;
  console.log('\nEVIDENCE BEHAVIOURAL BASELINE\n');
  console.log(`  corpus     ${s.pairs} athlete-programme pairs`);
  console.log(`             ${s.personalised} personalised, ${s.generic} generic`);
  console.log(`             ${s.sentences} rendered sentences, ${s.held} held claims`);
  console.log(`             ${Object.entries(s.structures).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  console.log(`  dataset    ${short(cmp.datasetActual)}  ${cmp.dataset}`);
  if (cmp.dataset === 'CHANGED') {
    console.log(`             expected ${short(cmp.datasetExpected ?? '—')}`);
    console.log('             The data moved, so a product hash cannot be compared to one');
    console.log('             taken over different rows. Per-table digests:\n');
    for (const t of cmp.manifest.tables) {
      console.log(`               ${t.table.padEnd(20)} ${String(t.rows ?? '—').padStart(8)} rows  ${short(t.digest ?? '—')}`);
    }
  }
  console.log();
  for (const r of cmp.results) {
    console.log(`  ${r.name.padEnd(20)} ${String(r.size).padStart(6)} pairs  ${short(r.digest)}  ${r.status}`);
    if (r.status === 'FAIL') console.log(`  ${''.padEnd(20)} ${''.padStart(6)}         expected ${short(r.expected)}`);
  }

  if (UPDATE) {
    const moved = cmp.results.filter((r) => r.status !== 'PASS');
    console.log(`\n  --update: rewriting ${EXPECTED_PATH.replace(`${process.cwd()}/`, '')}\n`);
    if (cmp.dataset === 'CHANGED') console.log('    dataset fingerprint  repinned');
    for (const r of moved) {
      console.log(`    ${r.name.padEnd(20)} ${short(r.expected ?? '—')} -> ${short(r.digest)}  (${r.status})`);
    }
    if (!moved.length && cmp.dataset === 'UNCHANGED') console.log('    nothing moved.');
    writeFileSync(EXPECTED_PATH, `${JSON.stringify({
      note: 'Committed Evidence behavioural baseline. See docs/EVIDENCE_BASELINES.md before repinning.',
      manifest: cmp.manifest,
      baselines: cmp.results.map((r) => ({ name: r.name, size: r.size, digest: r.digest })),
    }, null, 2)}\n`);
    console.log('\n  Repinning is a product decision, not a fix. Explain what moved and why.\n');
    return;
  }

  /**
   * The log must describe the email it was written about. Printed with the
   * hashes because it is the other half of the same guarantee: a hash says the
   * output did not move, this says the output and the record agree.
   */
  const broken = CONTRADICTION_KEYS.filter((k) => cmp.invariants[k] > 0);
  console.log(`\n  RENDERED / RECORDED   ${broken.length ? `${broken.length} contradiction classes` : 'no contradictions'}`);
  for (const k of broken) console.log(`    ${k.padEnd(38)} ${cmp.invariants[k]}`);
  for (const e of cmp.invariants.examples.slice(0, 5)) console.log(`      ${e.pair} — ${JSON.stringify(e)}`);
  console.log(`    ${'held claims (correct, not a contradiction)'.padEnd(38)} ${cmp.stats.held}`);

  console.log(cmp.ok
    ? '\n  All baselines match. Read-only; nothing was changed.\n'
    : '\n  A baseline moved. Do NOT repin until you can say what changed and why —'
      + '\n  see docs/EVIDENCE_BASELINES.md.\n');
  if (!cmp.ok) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
