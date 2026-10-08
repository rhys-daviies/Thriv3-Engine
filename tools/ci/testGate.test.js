import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, validateBaseline, MAX_EXEMPTION_DAYS } from './testGate.mjs';

const ROOT = '/repo';
const TODAY = '2026-10-08';
const pass = (title) => ({ title, fullName: title, status: 'passed', failureMessages: [] });
const fail = (title) => ({ title, fullName: title, status: 'failed', failureMessages: ['AssertionError: boom\n at x'] });
const skip = (title) => ({ title, fullName: title, status: 'skipped', failureMessages: [] });
const suite = (file, tests, extra = {}) => ({
  name: `${ROOT}/${file}`,
  status: tests.some((t) => t.status === 'failed') ? 'failed' : 'passed',
  message: '',
  assertionResults: tests,
  ...extra,
});
const known = (file, test, over = {}) => ({ file, test, reason: 'r', owner: 'o', added: '2026-10-01', expires: '2026-10-31', ...over });
const run = (suites, baseline = {}, opts = {}) => evaluate({ testResults: suites }, baseline, { root: ROOT, today: TODAY, ...opts });

describe('testGate', () => {
  it('passes a clean run', () => {
    const r = run([suite('a.test.js', [pass('x'), pass('y')])]);
    expect(r.ok).toBe(true);
    expect(r.totals).toMatchObject({ passed: 2, failed: 0, skipped: 0 });
  });

  it('fails a suite whose beforeAll threw, although vitest shows its tests as skipped', () => {
    const r = run([suite('a.test.js', [skip('x'), skip('y')], { status: 'failed', message: 'Error: setup blew up' })]);
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual([expect.stringContaining('SUITE FAILED TO RUN: a.test.js — Error: setup blew up')]);
  });

  it('fails a suite that could not load at all', () => {
    const r = run([suite('a.test.js', [], { status: 'failed', message: 'SyntaxError: nope' })]);
    expect(r.errors[0]).toMatch(/^SUITE FAILED TO RUN: a\.test\.js/);
  });

  it('a suite-level failure cannot be baselined', () => {
    const r = run(
      [suite('a.test.js', [skip('x')], { status: 'failed', message: 'Error: setup' })],
      { expectedSkips: { 'a.test.js': ['x'] }, knownFailures: [known('a.test.js', 'x')] },
    );
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.startsWith('SUITE FAILED TO RUN'))).toBe(true);
  });

  it('fails a new failure and tolerates a listed, unexpired one', () => {
    const suites = [suite('a.test.js', [fail('old'), fail('new')])];
    const r = run(suites, { knownFailures: [known('a.test.js', 'old')] });
    expect(r.errors).toEqual([expect.stringMatching(/^NEW FAILURE: a\.test\.js › new — AssertionError: boom$/)]);
    expect(r.totals.knownFailing).toBe(1);
  });

  it('a second failure with the same name is not covered by one entry', () => {
    const r = run([suite('a.test.js', [fail('dup'), fail('dup')])], { knownFailures: [known('a.test.js', 'dup')] });
    expect(r.errors).toEqual([expect.stringMatching(/^NEW FAILURE: a\.test\.js › dup/)]);
  });

  it('fails an exemption whose test now passes, so the list only shrinks', () => {
    const r = run([suite('a.test.js', [pass('old')])], { knownFailures: [known('a.test.js', 'old')] });
    expect(r.errors).toEqual(['STALE EXEMPTION: a.test.js › old no longer fails — remove it from knownFailures']);
  });

  it('fails an expired exemption even though the test still fails as listed', () => {
    const r = run([suite('a.test.js', [fail('old')])], { knownFailures: [known('a.test.js', 'old', { expires: '2026-10-07' })] });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/expired on 2026-10-07/);
  });

  it(`refuses an exemption longer than ${MAX_EXEMPTION_DAYS} days, or one missing a field`, () => {
    expect(validateBaseline({ knownFailures: [known('a', 'b', { expires: '2027-01-01' })] }, TODAY)[0]).toMatch(/the limit is 45/);
    expect(validateBaseline({ knownFailures: [known('a', 'b', { owner: '' })] }, TODAY)[0]).toMatch(/missing "owner"/);
  });

  it('fails an unexpected skip and tolerates an expected one', () => {
    const r = run([suite('a.test.js', [skip('db'), skip('other')])], { expectedSkips: { 'a.test.js': ['db'] } });
    expect(r.errors).toEqual(['UNEXPECTED SKIP: a.test.js › other']);
  });

  it('an expected skip that ran is a warning locally and an error under --strict', () => {
    const suites = [suite('a.test.js', [pass('db')])];
    const baseline = { expectedSkips: { 'a.test.js': ['db'] } };
    expect(run(suites, baseline)).toMatchObject({ ok: true, warnings: [expect.stringMatching(/did not skip/i)] });
    expect(run(suites, baseline, { strict: true }).errors).toEqual([expect.stringMatching(/^EXPECTED SKIP DID NOT SKIP/)]);
  });

  describe('critical suites', () => {
    const critical = { criticalSuites: ['safe.test.js'] };

    it('must be reported', () => {
      expect(run([suite('a.test.js', [pass('x')])], critical).errors).toEqual(['CRITICAL SUITE MISSING: safe.test.js was not reported by vitest']);
    });
    it('must run at least one test', () => {
      expect(run([suite('safe.test.js', [])], critical).errors[0]).toMatch(/^CRITICAL SUITE RAN NO TESTS/);
    });
    it('may not skip', () => {
      const r = run([suite('safe.test.js', [pass('x'), skip('y')])], critical);
      expect(r.errors).toContain('CRITICAL SUITE SKIPPED TESTS: safe.test.js skipped 1');
    });
    it('can never be exempted: the baseline entry is refused and the failure still counts', () => {
      const r = run([suite('safe.test.js', [fail('x')])], { ...critical, knownFailures: [known('safe.test.js', 'x')] });
      expect(r.errors).toEqual(expect.arrayContaining([
        expect.stringMatching(/exempts critical suite safe\.test\.js/),
        expect.stringMatching(/^NEW FAILURE: safe\.test\.js › x/),
      ]));
    });
    it('cannot be listed as an expected skip', () => {
      expect(validateBaseline({ ...critical, expectedSkips: { 'safe.test.js': ['y'] } }, TODAY)).toEqual(['expectedSkips lists critical suite safe.test.js — critical suites may not skip']);
    });
  });

  it('fails a tracked test file that vitest never reported', () => {
    const r = run([suite('a.test.js', [pass('x')])], {}, { trackedFiles: ['a.test.js', 'gone.test.js'] });
    expect(r.errors).toEqual(['TEST FILE NOT COLLECTED: gone.test.js']);
  });

  it('fails when the vitest log reports unhandled errors', () => {
    const r = run([suite('a.test.js', [pass('x')])], {}, { log: '⎯⎯ Unhandled Errors ⎯⎯\nVitest caught 1 unhandled error' });
    expect(r.errors).toEqual(['UNHANDLED ERROR: vitest reported unhandled errors — see the test log']);
  });

  it('the committed baseline is well formed and names suites that exist', () => {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'test-baseline.json');
    const baseline = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Expiry is the gate's job at run time; this checks shape, horizon and the
    // critical-suite rules without becoming a second date bomb.
    expect(validateBaseline(baseline, '1970-01-01')).toEqual([]);
    for (const f of baseline.criticalSuites) expect(fs.existsSync(path.resolve(file, '../../..', f)), f).toBe(true);
  });
});
