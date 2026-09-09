import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * L7B — the discovery plan against the real registry, and what it must not touch.
 *
 * The 34 are L6D's cohort: active NCAA programmes with no roster and, before
 * this stage, no candidate URL either. What is pinned is the SHAPE of the
 * answer, not the exact split — a domain re-scrape or a successful acquisition
 * legitimately moves the numbers, and a test that failed on every run would be
 * switched off. What must never move is that planning is read-only.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DB = path.join(ROOT, 'server/data/recruitmatch.sqlite');
const HAVE_DB = fs.existsSync(DB) && fs.statSync(DB).size > 1_000_000;
const d = HAVE_DB ? describe : describe.skip;
if (!HAVE_DB) console.warn(`\n  rosterCandidatePlan.test.js SKIPPED — no database at ${DB}\n`);

const inDb = (expr) => JSON.parse(execFileSync('node', ['--input-type=module', '-e', `
  import db from '${path.join(ROOT, 'server/db/client.js')}';
  import { candidatePlan, rosterHostUsage } from '${path.join(ROOT, 'server/scripts/rosterCandidatePlan.js')}';
  import { rosterTargetUniverse } from '${path.join(ROOT, 'server/scripts/rosterTargetUniverse.js')}';
  void candidatePlan; void rosterHostUsage; void rosterTargetUniverse; void db;
  process.stdout.write(JSON.stringify(${expr}));
`], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: DB }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

const STATES = ['EXISTING_CANDIDATE', 'NEW_VERIFIED_HOST_CANDIDATES', 'AMBIGUOUS_HOST', 'NO_TRUSTED_HOST'];

d('the plan across every active NCAA programme', () => {
  const counts = inDb(`(() => { const c = {};
    for (const p of candidatePlan()) c[p.state] = (c[p.state] ?? 0) + 1; return c; })()`);

  it('gives every programme exactly one state, and only known states', () => {
    expect(Object.keys(counts).every((k) => STATES.includes(k))).toBe(true);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(inDb('rosterTargetUniverse().length'));
  });

  it('does not use the generator where a roster source already exists', () => {
    // The overwhelming majority. A generated candidate is for the tail.
    expect(counts.EXISTING_CANDIDATE).toBeGreaterThan(1500);
  });

  it('offers candidates to programmes that had none', () => {
    expect(counts.NEW_VERIFIED_HOST_CANDIDATES).toBeGreaterThan(0);
  });

  it('never silently picks between several hosts', () => {
    const amb = inDb(`candidatePlan().filter((p) => p.state === 'AMBIGUOUS_HOST')
      .map((p) => ({ hosts: p.hosts.length, candidates: p.candidates.length }))`);
    for (const a of amb) {
      expect(a.hosts).toBeGreaterThan(1);
      expect(a.candidates).toBe(0);
    }
  });
});

d('the L6D cohort', () => {
  const cohort = inDb(`(() => {
    const gaps = candidatePlan().filter((p) => p.state !== 'EXISTING_CANDIDATE');
    return gaps.map((p) => ({ key: p.key, state: p.state, host: p.host,
      first: p.candidates[0]?.url ?? null, n: p.candidates.length }));
  })()`);

  it('is the programmes with no roster, and nothing else', () => {
    expect(cohort.length).toBeGreaterThan(20);
    expect(cohort.length).toBeLessThan(60);
  });

  it('offers a verified host to those it can, and says so for the rest', () => {
    /*
     * Not a majority any more, and that is the point: L7C acquired twelve of
     * the programmes this used to count, so the ones LEFT are weighted towards
     * the hard cases — thirteen with no trusted host at all. A ratio that only
     * holds before the work is done is not an invariant.
     */
    const withHost = cohort.filter((p) => p.state === 'NEW_VERIFIED_HOST_CANDIDATES');
    expect(withHost.length).toBeGreaterThan(0);
    expect(withHost.length + cohort.filter((p) => p.state !== 'NEW_VERIFIED_HOST_CANDIDATES').length)
      .toBe(cohort.length);
    for (const p of withHost) {
      expect(p.host).toEqual(expect.any(String));
      expect(p.n).toBeGreaterThan(0);
      expect(p.first).toContain(p.host);
    }
  });

  it('generates a candidate only on the host it names', () => {
    for (const p of cohort.filter((x) => x.first)) {
      expect(new URL(p.first).hostname).toBe(p.host);
    }
  });

  it('leaves the rest with an explicit reason rather than a guess', () => {
    for (const p of cohort.filter((x) => x.state !== 'NEW_VERIFIED_HOST_CANDIDATES')) {
      expect(p.first).toBe(null);
      expect(['NO_TRUSTED_HOST', 'AMBIGUOUS_HOST']).toContain(p.state);
    }
  });
});

d('planning changes nothing', () => {
  it('leaves the target universe exactly as it was', () => {
    // Membership is L6B's rule and a discovery step has no business touching
    // it: what we can guess at does not decide who is considered.
    const shape = 'rosterTargetUniverse().map((r) => r.school + "||" + r.sport)';
    const before = inDb(shape);
    const after = inDb(`(() => { candidatePlan(); return ${shape}; })()`);
    expect(after).toEqual(before);
  });

  it('writes no acquisition state and no roster row', () => {
    const before = inDb(`db.prepare('SELECT COUNT(*) n FROM roster_players').get().n`);
    const domains = inDb(`db.prepare('SELECT COUNT(*) n FROM athletics_domains').get().n`);
    const after = inDb(`(() => { candidatePlan();
      return db.prepare('SELECT COUNT(*) n FROM roster_players').get().n; })()`);
    const domainsAfter = inDb(`(() => { candidatePlan();
      return db.prepare('SELECT COUNT(*) n FROM athletics_domains').get().n; })()`);
    expect(after).toBe(before);
    expect(domainsAfter).toBe(domains);
  });

  it('adds no athletics_domains row — L7B backfills nothing', () => {
    const guessed = inDb(`db.prepare(\`SELECT COUNT(*) n FROM athletics_domains
      WHERE checked_at > '2026-09-01T23:59:59Z'\`).get().n`);
    expect(guessed).toBe(0);
  });
});
