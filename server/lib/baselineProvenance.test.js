import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  canonical, projectBehavioural, nonBehaviouralSites, NON_BEHAVIOURAL_FIELDS, BASELINE_NOW,
} from './evidenceBaseline.js';
import { rosterFreshness, FRESHNESS, FRESH_DAYS, ACCEPTABLE_DAYS } from '../../shared/evidence/freshness.js';

/**
 * L7D2 — a behavioural baseline hashes what is true, not when we looked.
 *
 * L7D imported 85 roster rows and moved OPERATOR_WIRE and LOG_PAYLOAD for 3,584
 * pairs. Every one of those pairs differed in `rosterUpdatedAt` and in nothing
 * else, because the import re-stamps `updated_date` on all 1,926 programmes
 * whether or not a player changed. Two of the six surfaces could therefore never
 * be stable across a refresh, which makes them useless for detecting the thing
 * they exist to detect.
 *
 * The danger in fixing that is obvious and is what most of this file is about:
 * the timestamp DOES reach behaviour, through `rosterFreshness`. So the derived
 * state, age and reason stay hashed and only the raw instant is dropped.
 *
 * Measured on the real corpus before the change, and repeated in the shape
 * assertions below: +37 seconds on all 58,270 roster rows moved OPERATOR_WIRE
 * and LOG_PAYLOAD and nothing else; -400 days moved all six and took
 * personalisation from 1,758 to 1,284.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DB = path.join(ROOT, 'server/data/recruitmatch.sqlite');
const HAVE_DB = fs.existsSync(DB) && fs.statSync(DB).size > 1_000_000;

/** A programme payload shaped like the one `toWire` and the log actually emit. */
const wireLike = (stamp, freshness) => ({
  programme: {
    name: 'Example',
    rosterSeason: '2026',
    rosterUpdatedAt: stamp,
    rosterAgeDays: freshness.ageDays,
    freshness: { state: freshness.state, ageDays: freshness.ageDays, reason: freshness.reason },
    squadSize: 28,
  },
  claims: [{ kind: 'CURRENT_SAME_COUNTRY', text: 'two New Zealanders' }],
});

describe('an observation instant is not a behavioural fact', () => {
  const now = BASELINE_NOW;
  const day = 24 * 60 * 60 * 1000;

  it('drops the raw timestamp and keeps everything derived from it', () => {
    const stamp = new Date(now - 3 * day).toISOString();
    const f = rosterFreshness({ updatedAt: stamp, now });
    const out = projectBehavioural(wireLike(stamp, f));
    expect(out).not.toContain('rosterUpdatedAt');
    // The three things `applyFreshness` and the operator copy actually read.
    expect(out).toContain('"rosterAgeDays":3');
    expect(out).toContain(`"state":"${FRESHNESS.CURRENT}"`);
    expect(out).toContain('"squadSize":28');
  });

  it('is stable when only the instant moves', () => {
    /*
     * Thirty-seven seconds apart and NOT across a whole-day boundary. `ageDays`
     * is `Math.floor((now - then) / DAY)`, so a shift that does cross one is a
     * real one-day change in a value the operator is shown and `applyFreshness`
     * reads — the test below covers that direction. Half past the boundary is
     * where a pure re-stamp lives.
     */
    const a = new Date(now - 3.5 * day).toISOString();
    const b = new Date(now - 3.5 * day + 37_000).toISOString();
    const fa = rosterFreshness({ updatedAt: a, now });
    const fb = rosterFreshness({ updatedAt: b, now });
    expect(fa.ageDays).toBe(fb.ageDays);
    expect(projectBehavioural(wireLike(a, fa))).toBe(projectBehavioural(wireLike(b, fb)));
    // And the old definition did not have that property, which is the defect.
    expect(canonical(wireLike(a, fa))).not.toBe(canonical(wireLike(b, fb)));
  });

  it('MOVES when the freshness outcome changes', () => {
    // The guard against fixing this by hiding it. Crossing FRESH_DAYS turns
    // CURRENT into ACCEPTABLE, which `applyFreshness` reads to downgrade
    // evidence — a real behavioural change that must still be visible.
    const fresh = new Date(now - (FRESH_DAYS - 1) * day).toISOString();
    const aged = new Date(now - (FRESH_DAYS + 1) * day).toISOString();
    const ff = rosterFreshness({ updatedAt: fresh, now });
    const fa = rosterFreshness({ updatedAt: aged, now });
    expect(ff.state).toBe(FRESHNESS.CURRENT);
    expect(fa.state).toBe(FRESHNESS.ACCEPTABLE);
    expect(projectBehavioural(wireLike(fresh, ff))).not.toBe(projectBehavioural(wireLike(aged, fa)));
  });

  it('MOVES when a claim goes stale', () => {
    const ok = new Date(now - (ACCEPTABLE_DAYS - 1) * day).toISOString();
    const stale = new Date(now - (ACCEPTABLE_DAYS + 1) * day).toISOString();
    const a = rosterFreshness({ updatedAt: ok, now });
    const b = rosterFreshness({ updatedAt: stale, now });
    expect(b.state).toBe(FRESHNESS.STALE);
    expect(projectBehavioural(wireLike(ok, a))).not.toBe(projectBehavioural(wireLike(stale, b)));
  });

  it('MOVES when the roster content changes and the instant does not', () => {
    const stamp = new Date(now - 3 * day).toISOString();
    const f = rosterFreshness({ updatedAt: stamp, now });
    const before = wireLike(stamp, f);
    const after = { ...before, programme: { ...before.programme, squadSize: 29 } };
    expect(projectBehavioural(before)).not.toBe(projectBehavioural(after));
  });

  it('reports UNKNOWN rather than fresh when there is no instant at all', () => {
    // Dropping the field from the hash must not become "assume it was recent".
    const f = rosterFreshness({ updatedAt: null, now });
    expect(f.state).toBe(FRESHNESS.UNKNOWN);
    expect(projectBehavioural(wireLike(null, f))).toContain(`"state":"${FRESHNESS.UNKNOWN}"`);
  });
});

describe('the projection is narrow and says where it applies', () => {
  it('names exactly one field, and it is the measured one', () => {
    expect([...NON_BEHAVIOURAL_FIELDS]).toEqual(['rosterUpdatedAt']);
  });

  it('leaves every other key, including nested and array members, untouched', () => {
    const v = { a: 1, b: { c: [{ d: 2, rosterUpdatedAt: 'x' }], rosterUpdatedAt: 'y' }, e: null };
    expect(JSON.parse(projectBehavioural(v))).toEqual({ a: 1, b: { c: [{ d: 2 }] }, e: null });
  });

  it('is identical to canonical for a payload that has no such field', () => {
    // Which is why four of the six pinned hashes did not move.
    const v = { kinds: ['A', 'B'], personalised: true, nested: [{ x: 1 }] };
    expect(projectBehavioural(v)).toBe(canonical(v));
  });

  it('normalises undefined the way canonical does', () => {
    expect(projectBehavioural({ a: undefined })).toBe(canonical({ a: null }));
  });

  it('reports the paths a field was found at', () => {
    expect(nonBehaviouralSites({ programme: { rosterUpdatedAt: 'x' } }, 'WIRE'))
      .toEqual(['WIRE::programme.rosterUpdatedAt']);
    expect(nonBehaviouralSites({ nothing: 1 })).toEqual([]);
  });
});

const d = HAVE_DB ? describe : describe.skip;
if (!HAVE_DB) console.warn(`\n  baselineProvenance.test.js DB section SKIPPED — no database at ${DB}\n`);

const inDb = (expr) => JSON.parse(execFileSync('node', ['--input-type=module', '-e', `
  import db from '${path.join(ROOT, 'server/db/client.js')}';
  import { canonicalCorpus, BASELINE_NOW, nonBehaviouralSites } from '${path.join(ROOT, 'server/lib/evidenceBaseline.js')}';
  import { evidenceFor } from '${path.join(ROOT, 'server/lib/evidenceQueries.js')}';
  import { evidenceLogPayload } from '${path.join(ROOT, 'shared/evidence/index.js')}';
  import { toWire } from '${path.join(ROOT, 'server/routes/evidence.js')}';
  import { wireOperatorEvidence } from '${path.join(ROOT, 'server/routes/operatorEvidence.js')}';
  import { operatorEvidenceFor } from '${path.join(ROOT, 'shared/evidence/operatorEvidence.js')}';
  void canonicalCorpus; void BASELINE_NOW; void evidenceFor; void evidenceLogPayload;
  void toWire; void wireOperatorEvidence; void operatorEvidenceFor; void nonBehaviouralSites; void db;
  process.stdout.write(JSON.stringify(${expr}));
`], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: DB }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

d('runtime still tells the truth about when we looked', () => {
  const sample = `(() => {
    const out = { wire: [], log: [], operator: [], seen: 0 };
    for (const c of canonicalCorpus()) {
      if (out.seen >= 300) break;
      let ev; try { ev = evidenceFor(c.athlete, c.college, { now: BASELINE_NOW }); } catch { continue; }
      out.seen += 1;
      out.wire.push(...nonBehaviouralSites(toWire(ev), 'OPERATOR_WIRE'));
      out.log.push(...nonBehaviouralSites(evidenceLogPayload(ev), 'LOG_PAYLOAD'));
      out.operator.push(...nonBehaviouralSites(wireOperatorEvidence(operatorEvidenceFor(ev)), 'OPERATOR_EVIDENCE'));
    }
    const u = (a) => [...new Set(a)].sort();
    return { wire: u(out.wire), log: u(out.log), operator: u(out.operator), seen: out.seen };
  })()`;
  const r = inDb(sample);

  it('keeps the real timestamp on the operator wire', () => {
    expect(r.wire).toEqual(['OPERATOR_WIRE::programme.rosterUpdatedAt']);
  });

  it('keeps the real timestamp in the log payload', () => {
    expect(r.log).toEqual(['LOG_PAYLOAD::payload.programme.rosterUpdatedAt']);
  });

  it('finds it in those two places and nowhere else', () => {
    // If a third surface starts reporting when it was scraped, this fails and
    // somebody has to decide whether that is provenance or behaviour — rather
    // than the projection silently absorbing it.
    expect(r.operator).toEqual([]);
    expect(r.seen).toBeGreaterThan(100);
  });

  it('carries a real ISO instant, not a placeholder the projection left behind', () => {
    const stamps = inDb(`(() => {
      const out = [];
      for (const c of canonicalCorpus()) {
        if (out.length >= 5) break;
        let ev; try { ev = evidenceFor(c.athlete, c.college, { now: BASELINE_NOW }); } catch { continue; }
        const s = toWire(ev)?.programme?.rosterUpdatedAt;
        if (s) out.push(s);
      }
      return out;
    })()`);
    expect(stamps.length).toBeGreaterThan(0);
    for (const s of stamps) expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });
});

describe('the fixed clock K3A introduced is still the other half of this', () => {
  it('pins now, so age is a function of two fixed inputs', () => {
    // K3A stopped the baselines changing value once a day as programmes aged
    // past a whole-day boundary. That fixed `now`; this fixes the other operand.
    expect(BASELINE_NOW).toBe(Date.parse('2026-09-06T00:00:00Z'));
    const stamp = new Date(BASELINE_NOW - 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(rosterFreshness({ updatedAt: stamp, now: BASELINE_NOW }).ageDays).toBe(5);
  });
});
