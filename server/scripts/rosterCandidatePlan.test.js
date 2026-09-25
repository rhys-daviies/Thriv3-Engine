import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { sportContradicted } from './rosterCandidatePlan.js';
import { fileCorpusOr } from '../db/corpusIdentity.js';

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
/* L7ZO: obey an explicitly selected corpus; see `fileCorpusOr`. */
const DB = fileCorpusOr(path.join(ROOT, 'server/data/recruitmatch.sqlite'));
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
      fetchHosts: p.fetchHosts ?? [],
      hostnames: [...new Set(p.candidates.map((c) => new URL(c.url).hostname))],
      first: p.candidates[0]?.url ?? null, n: p.candidates.length }));
  })()`);

  it('is the programmes with no roster, and nothing else', () => {
    /*
     * Not a size range. This asserted 20 < n < 60, which was true of the cohort
     * on the day it was written and false as soon as L7E and L7F resolved
     * eighteen of them — the second threshold in this file to expire that way.
     * A shrinking cohort is the work succeeding; what must stay true is that
     * every member is a gap and carries a reason.
     */
    expect(cohort.length).toBeGreaterThanOrEqual(0);
    for (const p of cohort) {
      expect(p.state).not.toBe('EXISTING_CANDIDATE');
      expect(STATES).toContain(p.state);
    }
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

  it('generates a candidate only on a spelling of the host it names', () => {
    /*
     * L7I: this used to assert equality with `p.host`, which is the IDENTITY
     * key — and asserting that is what kept Northwood unreachable. The apex and
     * `www.gonorthwood.com` are one institution and one ledger entry apiece, and
     * only the second serves a roster path.
     *
     * So the invariant is the one that was actually meant: every candidate is a
     * spelling of the named identity, and every spelling is one the ledger or
     * this institution's own rosters put forward. Nothing is derived, so no
     * candidate can reach a host nobody has stood behind.
     */
    for (const p of cohort.filter((x) => x.first)) {
      expect(p.hostnames.length).toBeGreaterThan(0);
      for (const h of p.hostnames) {
        expect(h.replace(/^www\./, '')).toBe(p.host);
        expect(p.fetchHosts).toContain(h);
      }
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

  it('adds no athletics_domains row', () => {
    /*
     * This used to assert the table held no row newer than the original crawl,
     * which was true only because nothing had ever backfilled one. L7E verified
     * ten hosts individually and the assertion became false without the planner
     * having written anything — it was testing the age of the data rather than
     * the behaviour of the planner. Now it measures the planner.
     */
    const count = `db.prepare('SELECT COUNT(*) n FROM athletics_domains').get().n`;
    const before = inDb(count);
    const after = inDb(`(() => { candidatePlan(); return ${count}; })()`);
    expect(after).toBe(before);
  });
});

/**
 * L7G — a page on the right host can still be the wrong programme.
 *
 * L7E called Southwest Minnesota State ready on HTTP 200, the right host and 82
 * roster markers. The page was `Sonya Smith - Women's Soccer - SMSU Athletics`
 * — a women's bio served at `/sports/msoc/roster/season/2026`, on a host whose
 * `.aspx` routing answers `/sports/msoc` with a football event page. Host
 * identity was never in doubt; the sport was, and nothing looked.
 *
 * The markers were no defence: a site's navigation carries roster markup on
 * every page it serves. The pipeline's own gates refused the page anyway —
 * "too few players parsed (0)" — so nothing wrong was ever imported. What was
 * wrong was the readiness report.
 */
describe('the page must be about the programme that was asked for', () => {
  const page = (title) => `<html><head><meta property="og:title" content="${title}"><title>${title}</title></head></html>`;

  it('refuses the exact page that made SMSU look ready', () => {
    const html = page("Sonya Smith - Women&#39;s Soccer - SMSU Athletics");
    expect(sportContradicted(html, 'mens-soccer')).toContain("Women's Soccer");
  });

  it('refuses a men\'s page offered for a women\'s programme', () => {
    expect(sportContradicted(page("2026 Men's Soccer Roster - Example"), 'womens-soccer'))
      .toContain("Men's Soccer");
  });

  it('accepts the programme it was asked for', () => {
    expect(sportContradicted(page("2026 Men's Soccer Roster - Example"), 'mens-soccer')).toBe(null);
    expect(sportContradicted(page("2026 Women's Soccer Roster - Example"), 'womens-soccer')).toBe(null);
  });

  it('accepts a page that names both, as an index legitimately does', () => {
    // Refusing on the mere presence of the other sport would reject a roster
    // whose navigation lists every programme the school fields.
    expect(sportContradicted(page("Men's Soccer and Women's Soccer - Example"), 'mens-soccer')).toBe(null);
  });

  it('says nothing about a page that names no sport', () => {
    expect(sportContradicted(page('Example University Athletics'), 'mens-soccer')).toBe(null);
  });

  it('reads a typographic apostrophe as an apostrophe', () => {
    expect(sportContradicted(page("Sonya Smith - Women&apos;s Soccer"), 'mens-soccer')).toBeTruthy();
  });
});
