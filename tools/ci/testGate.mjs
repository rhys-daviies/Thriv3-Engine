#!/usr/bin/env node
/**
 * THE CI TEST GATE.
 *
 * `vitest run` exits non-zero for any failure, so on its own it cannot tell a
 * known failure from a new one, and it says nothing at all about the two ways
 * a suite can silently stop testing:
 *
 *   - a suite whose beforeAll throws, or that fails to load, is reported as
 *     N *skipped* tests, not failed ones (it happened on 2026-10-08 and several
 *     "no new failures" reports were wrong because of it);
 *   - a test that skips because something it needs is missing looks the same
 *     as one that skips because the private database is absent.
 *
 * So this reads vitest's JSON report and fails on:
 *
 *   1. any suite-level or load failure — never baselinable;
 *   2. any failing test not listed in `knownFailures`;
 *   3. any skipped test not listed in `expectedSkips`;
 *   4. any `knownFailures` entry that has expired, or whose test no longer
 *      fails (the list only shrinks — fix or remove, never keep a dead
 *      exemption around to absorb a future regression);
 *   5. any critical safety suite that is missing, failing, skipping, or ran no
 *      tests — critical suites can never appear in the baseline;
 *   6. any tracked test file that vitest did not report (a file that vanished
 *      from collection is a suite that stopped running);
 *   7. unhandled errors in the vitest log, when the log is given.
 *
 * Usage: node tools/ci/testGate.mjs <vitest.json> [--baseline <file>]
 *          [--log <vitest stdout>] [--strict] [--critical-only] [--print-skips]
 *
 * `--strict` (CI) also fails on `expectedSkips` entries that did not skip. In
 * a checkout that has the private database those suites run, so locally they
 * are reported as warnings instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKIP_STATUSES = new Set(['pending', 'skipped', 'todo', 'disabled']);
// Longest a known failure may be carried before it must be fixed or re-approved.
export const MAX_EXEMPTION_DAYS = 45;

const DAY_MS = 86_400_000;

function relativeFile(name, root) {
  const rel = path.isAbsolute(name) ? path.relative(root, name) : name;
  return rel.split(path.sep).join('/');
}

function testName(a) {
  return a.fullName || [...(a.ancestorTitles || []), a.title].join(' ');
}

function firstLine(text) {
  return String(text || '').split('\n').find((l) => l.trim()) || '(no message)';
}

function tally(list) {
  const m = new Map();
  for (const k of list) m.set(k, (m.get(k) || 0) + 1);
  return m;
}

/** Problems with the baseline file itself. These fail the gate too. */
export function validateBaseline(baseline, today) {
  const problems = [];
  const critical = new Set(baseline.criticalSuites || []);
  for (const [i, e] of (baseline.knownFailures || []).entries()) {
    const where = `knownFailures[${i}]`;
    for (const field of ['file', 'test', 'reason', 'owner', 'added', 'expires']) {
      if (!e[field]) problems.push(`${where} is missing "${field}"`);
    }
    if (critical.has(e.file)) {
      problems.push(`${where} exempts critical suite ${e.file} — critical suites can never be baselined`);
    }
    const added = Date.parse(e.added);
    const expires = Date.parse(e.expires);
    if (Number.isNaN(added) || Number.isNaN(expires)) {
      problems.push(`${where} has an unparseable "added" or "expires" date`);
      continue;
    }
    if ((expires - added) / DAY_MS > MAX_EXEMPTION_DAYS) {
      problems.push(`${where} runs ${Math.round((expires - added) / DAY_MS)} days; the limit is ${MAX_EXEMPTION_DAYS}`);
    }
    if (expires < Date.parse(today)) {
      problems.push(`${where} (${e.file} › ${e.test}) expired on ${e.expires} — fix the test or get explicit approval to renew it`);
    }
  }
  for (const file of Object.keys(baseline.expectedSkips || {})) {
    if (critical.has(file)) problems.push(`expectedSkips lists critical suite ${file} — critical suites may not skip`);
  }
  return problems;
}

/**
 * Pure evaluation of one vitest JSON report against the baseline.
 * `trackedFiles` is the list of test files that should have been collected
 * (null skips that check); `log` is vitest's stdout (null skips that check).
 */
export function evaluate(report, baseline, { root = process.cwd(), today, strict = false, trackedFiles = null, log = null } = {}) {
  const errors = [...validateBaseline(baseline, today)];
  const warnings = [];
  const critical = new Set(baseline.criticalSuites || []);

  const failures = [];
  const skips = [];
  const suiteFailures = [];
  const bySuite = new Map();

  for (const suite of report.testResults || []) {
    const file = relativeFile(suite.name, root);
    const results = suite.assertionResults || [];
    const failed = results.filter((a) => a.status === 'failed');
    const skipped = results.filter((a) => SKIP_STATUSES.has(a.status));
    const passed = results.filter((a) => a.status === 'passed');
    bySuite.set(file, { status: suite.status, passed: passed.length, failed: failed.length, skipped: skipped.length });

    if (suite.status === 'failed' && failed.length === 0) {
      suiteFailures.push({ file, message: firstLine(suite.message), tests: results.length });
    }
    for (const a of failed) failures.push({ file, test: testName(a), message: firstLine((a.failureMessages || [])[0]) });
    for (const a of skipped) skips.push({ file, test: testName(a) });
  }

  // 1. Suite-level and load failures.
  for (const s of suiteFailures) {
    errors.push(`SUITE FAILED TO RUN: ${s.file} — ${s.message} (${s.tests} test(s) reported as skipped)`);
  }

  // 2 & 4. Failing tests against knownFailures.
  const known = tally((baseline.knownFailures || []).map((e) => `${e.file} › ${e.test}`));
  const seenFailing = tally(failures.map((f) => `${f.file} › ${f.test}`));
  for (const f of failures) {
    const key = `${f.file} › ${f.test}`;
    if (critical.has(f.file) || !known.get(key)) {
      errors.push(`NEW FAILURE: ${key} — ${f.message}`);
    } else {
      known.set(key, known.get(key) - 1);
    }
  }
  for (const e of baseline.knownFailures || []) {
    const key = `${e.file} › ${e.test}`;
    if (!seenFailing.get(key)) {
      errors.push(`STALE EXEMPTION: ${key} no longer fails — remove it from knownFailures`);
      seenFailing.set(key, -1); // report each stale key once
    }
  }

  // 3. Skips against expectedSkips.
  const expected = new Map();
  for (const [file, names] of Object.entries(baseline.expectedSkips || {})) {
    for (const [name, n] of tally(names)) expected.set(`${file} › ${name}`, n);
  }
  const remaining = new Map(expected);
  for (const s of skips) {
    const key = `${s.file} › ${s.test}`;
    const left = remaining.get(key) || 0;
    if (critical.has(s.file) || left === 0) {
      // Already reported as a suite failure — don't repeat every test in it.
      if (!suiteFailures.some((sf) => sf.file === s.file)) errors.push(`UNEXPECTED SKIP: ${key}`);
    } else {
      remaining.set(key, left - 1);
    }
  }
  const staleSkips = [...remaining].filter(([, n]) => n > 0).map(([k]) => k);
  for (const k of staleSkips) {
    (strict ? errors : warnings).push(`EXPECTED SKIP DID NOT SKIP: ${k}${strict ? ' — remove it from expectedSkips' : ' (fine when the private DB is present)'}`);
  }

  // 5. Critical suites.
  for (const file of critical) {
    const s = bySuite.get(file);
    if (!s) errors.push(`CRITICAL SUITE MISSING: ${file} was not reported by vitest`);
    else if (s.passed === 0) errors.push(`CRITICAL SUITE RAN NO TESTS: ${file} (passed 0, failed ${s.failed}, skipped ${s.skipped})`);
    else if (s.skipped > 0) errors.push(`CRITICAL SUITE SKIPPED TESTS: ${file} skipped ${s.skipped}`);
  }

  // 6. Tracked test files that never reported.
  if (trackedFiles) {
    for (const file of trackedFiles) {
      if (!bySuite.has(file)) errors.push(`TEST FILE NOT COLLECTED: ${file}`);
    }
  }

  // 7. Unhandled errors.
  if (log && /Unhandled (Error|Rejection)s?\b/.test(log)) {
    errors.push('UNHANDLED ERROR: vitest reported unhandled errors — see the test log');
  }

  const totals = {
    suites: bySuite.size,
    passed: [...bySuite.values()].reduce((n, s) => n + s.passed, 0),
    failed: failures.length,
    knownFailing: failures.length - errors.filter((e) => e.startsWith('NEW FAILURE')).length,
    skipped: skips.length,
    suiteFailures: suiteFailures.length,
  };
  return { ok: errors.length === 0, errors, warnings, totals, skips };
}

/** Tracked test files under vitest's include roots, as vitest.config.js collects them. */
export function trackedTestFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z', '--', '*.test.js'], { cwd: root, encoding: 'utf8' });
  const roots = ['server/', 'shared/', 'worker/', 'src/', 'tools/'];
  return out.split('\0').filter((f) => f && roots.some((r) => f.startsWith(r)) && !f.startsWith('server/data/'));
}

function summary(result) {
  const t = result.totals;
  const lines = [
    `## Test gate: ${result.ok ? 'PASS' : 'FAIL'}`,
    '',
    `Suites ${t.suites} · passed ${t.passed} · failed ${t.failed} (known ${t.knownFailing}) · skipped ${t.skipped} · suite-level failures ${t.suiteFailures}`,
  ];
  if (result.errors.length) lines.push('', '### Blocking', ...result.errors.map((e) => `- ${e}`));
  if (result.warnings.length) lines.push('', '### Warnings', ...result.warnings.map((w) => `- ${w}`));
  return lines.join('\n');
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? null : args[i + 1];
  };
  const reportPath = args.find((a, i) => !a.startsWith('--') && !['--baseline', '--log'].includes(args[i - 1]));
  if (!reportPath) {
    console.error('usage: node tools/ci/testGate.mjs <vitest.json> [--baseline <file>] [--log <file>] [--strict] [--print-skips]');
    process.exit(2);
  }
  const root = process.cwd();
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const baselinePath = opt('--baseline') || path.join(path.dirname(fileURLToPath(import.meta.url)), 'test-baseline.json');
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const logPath = opt('--log');
  const today = process.env.TEST_GATE_TODAY || new Date().toISOString().slice(0, 10);

  // --critical-only judges a run of just the critical suites with no exemptions
  // at all: every one must be reported, and nothing in them may fail or skip.
  const criticalOnly = args.includes('--critical-only');
  const result = evaluate(report, criticalOnly ? { criticalSuites: baseline.criticalSuites } : baseline, {
    root,
    today,
    strict: args.includes('--strict'),
    trackedFiles: criticalOnly ? baseline.criticalSuites : trackedTestFiles(root),
    log: logPath ? fs.readFileSync(logPath, 'utf8') : null,
  });

  if (args.includes('--print-skips')) {
    const grouped = {};
    for (const s of result.skips) (grouped[s.file] ||= []).push(s.test);
    console.log(JSON.stringify(grouped, null, 2));
    return;
  }
  const text = summary(result);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main(process.argv);
