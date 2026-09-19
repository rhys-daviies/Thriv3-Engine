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
import db, { dbPath } from '../db/client.js';
import { corpus, sharedCorpusNotice, corpusChangeToken } from '../db/corpusIdentity.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const EXPECTED_PATH = path.join(HERE, '__baselines__/evidence.json');

export const readExpected = () => (existsSync(EXPECTED_PATH)
  ? JSON.parse(readFileSync(EXPECTED_PATH, 'utf8'))
  : null);

const argv = process.argv.slice(2);
const JSON_MODE = argv.includes('--json');
const UPDATE = argv.includes('--update');

/**
 * L7ZM — did the corpus move WHILE this measurement was running?
 *
 * A baseline takes minutes over a corpus other checkouts can write. L7ZL-C is
 * the whole argument for this: another session wrote 39,430 roster rows between
 * one measurement and the next, and every signal this branch had pointed at its
 * own code. A digest taken across a corpus that moved mid-run is not a failing
 * measurement, it is NOT A MEASUREMENT, and it must not be reported as though
 * this branch broke something.
 *
 * Same principle H18 established for the manifest: when the question changed
 * underneath the answer, the verdict is UNCOMPARABLE, never FAIL.
 */
function main() {
  const startedAt = corpusChangeToken(db);
  const actual = buildBaselines();
  const movedDuringRun = corpusChangeToken(db) !== startedAt;
  const expected = readExpected();
  const cmp = compareBaselines(expected, actual);

  if (JSON_MODE) {
    // Deterministic: same repository state and dataset, same bytes.
    process.stdout.write(`${JSON.stringify({
      dataset: movedDuringRun ? 'CORPUS_MOVED' : cmp.dataset,
      corpusMovedDuringRun: movedDuringRun,
      datasetDigest: cmp.datasetActual,
      stats: cmp.stats,
      invariants: cmp.invariants,
      invariantsOk: cmp.invariantsOk,
      baselines: cmp.results.map((r) => ({
        name: r.name, size: r.size, digest: r.digest, expected: r.expected, status: r.status,
      })),
      ok: movedDuringRun ? false : cmp.ok,
    }, null, 2)}\n`);
    process.exit(!movedDuringRun && cmp.ok ? 0 : 1);
  }

  const s = cmp.stats;
  console.log('\nEVIDENCE BEHAVIOURAL BASELINE\n');
  /*
   * L7ZL-C. Stated BEFORE the numbers, because it changes how every number
   * below should be read: on a shared corpus a moved digest is not by itself
   * evidence of a local defect.
   */
  const notice = sharedCorpusNotice(corpus(dbPath));
  if (notice) console.log(`  ${notice}\n`);
  console.log(`  corpus     ${s.pairs} athlete-programme pairs`);
  console.log(`             ${s.personalised} personalised, ${s.generic} generic`);
  console.log(`             ${s.sentences} rendered sentences, ${s.held} held claims`);
  console.log(`             ${Object.entries(s.structures).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  console.log(`  dataset    ${short(cmp.datasetActual)}  ${cmp.dataset}  (manifest ${cmp.manifestVersion})`);
  if (cmp.dataset === 'DEFINITION_CHANGED') {
    console.log(`             the committed pin was taken under manifest ${cmp.manifestVersionExpected}.`);
    console.log('             A digest from an older manifest DEFINITION answers a different');
    console.log('             question, so every product line reads UNCOMPARABLE rather than');
    console.log('             FAIL. Repin once, deliberately, and say why.');
  }
  if (cmp.dataset === 'CHANGED') {
    console.log(`             expected ${short(cmp.datasetExpected ?? '—')}`);
    console.log('             The data moved, so a product hash cannot be compared to one');
    console.log('             taken over different rows. Components:\n');
  }
  if (cmp.dataset !== 'UNCHANGED') {
    // Named and marked, so the answer is "roster measurements moved" rather
    // than "something in the dataset moved".
    for (const t of cmp.components ?? cmp.manifest.tables) {
      console.log(`               ${t.table.padEnd(22)} ${String(t.rows ?? '—').padStart(8)} rows  `
        + `${short(t.digest ?? '—')}  ${t.status ?? ''}`);
    }
    console.log();
  }
  console.log();
  for (const r of cmp.results) {
    console.log(`  ${r.name.padEnd(20)} ${String(r.size).padStart(6)} pairs  ${short(r.digest)}  ${r.status}`);
    if (r.status === 'FAIL') console.log(`  ${''.padEnd(20)} ${''.padStart(6)}         expected ${short(r.expected)}`);
  }

  if (UPDATE) {
    /*
     * Repinning to a corpus that moved mid-run would write down a number no
     * single state of the data ever produced.
     */
    if (movedDuringRun) {
      console.log('\n  CORPUS MOVED DURING THIS RUN — refusing to repin. Re-measure on a\n'
        + '  corpus nothing else is writing (RECRUITMATCH_DB pointed at a snapshot).\n');
      process.exitCode = 1;
      return;
    }
    const moved = cmp.results.filter((r) => r.status !== 'PASS');
    console.log(`\n  --update: rewriting ${EXPECTED_PATH.replace(`${process.cwd()}/`, '')}\n`);
    if (cmp.dataset === 'CHANGED') console.log('    dataset fingerprint  repinned');
    for (const r of moved) {
      console.log(`    ${r.name.padEnd(20)} ${short(r.expected ?? '—')} -> ${short(r.digest)}  (${r.status})`);
    }
    if (!moved.length && cmp.dataset === 'UNCHANGED') console.log('    nothing moved.');
    writeFileSync(EXPECTED_PATH, `${JSON.stringify({
      note: 'Committed Evidence behavioural baseline. See docs/EVIDENCE_BASELINES.md before repinning.',
      now: cmp.now,
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

  if (movedDuringRun) {
    console.log('\n  CORPUS MOVED DURING THIS RUN — UNCOMPARABLE, not a regression.\n'
      + '  Another writer reached this database while the baselines were being\n'
      + '  measured, so these digests span more than one state of the data. This\n'
      + '  says nothing about this branch. Re-measure against a corpus nothing\n'
      + '  else is writing before drawing any conclusion.\n');
    process.exitCode = 1;
    return;
  }
  console.log(cmp.ok
    ? '\n  All baselines match. Read-only; nothing was changed.\n'
    : '\n  A baseline moved. Do NOT repin until you can say what changed and why —'
      + '\n  see docs/EVIDENCE_BASELINES.md.\n');
  if (!cmp.ok) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
