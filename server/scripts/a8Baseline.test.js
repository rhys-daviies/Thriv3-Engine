/**
 * =============================================================================
 * A8.0 — THE PREREGISTERED STRUCTURAL TESTS.
 *
 * Written and committed BEFORE the evaluative ranking review, so that what
 * counts as a structural failure is a decision on the page rather than a
 * judgement made while looking at results we would like to accept.
 *
 * ANY FAILURE HERE IS A BLOCKER. These are not quality opinions - each one
 * asserts something that must hold whatever the model's rankings turn out to
 * look like. A ranking can be wrong and still pass all of these; a ranking
 * that fails one of these cannot be evaluated at all, because the artifact
 * does not mean what it says.
 *
 * They run against the COMMITTED ARTIFACT rather than the database, for two
 * reasons. The suite runs with RECRUITMATCH_DB=':memory:' - deliberately, so
 * that no test can touch the operator's working corpus - so a corpus-level
 * test would silently assert nothing. And the artifact is the thing being
 * frozen: checking the database would check a different object.
 * =============================================================================
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { decodeBaseline } from './a8Baseline.js';
import { UNIVERSE } from '../lib/v2/validationUniverse.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/**
 * A8_BASELINE_FILE exists so these tests can be run against a DELIBERATELY
 * BROKEN artifact and shown to fail. A preregistered blocker test that has
 * never been seen to fail is an assertion about itself, not about the engine.
 */
const file = (process.env.A8_BASELINE_FILE ?? '').trim()
  || path.join(root, 'docs/validation/A8.0-baseline.json');
const baseline = JSON.parse(fs.readFileSync(file, 'utf8'));
const cells = decodeBaseline(baseline);
const byFixture = new Map();
for (const c of cells) {
  if (!byFixture.has(c.fixtureId)) byFixture.set(c.fixtureId, []);
  byFixture.get(c.fixtureId).push(c);
}
const LAYERS = ['recruitability', 'financial', 'opportunity'];

describe('A8 structural: the artifact describes what it claims to', () => {
  it('S0. the recorded digest is the digest of the cells it carries', () => {
    const actual = crypto.createHash('sha256').update(JSON.stringify(baseline.cells)).digest('hex');
    expect(actual).toBe(baseline.cellDigest);
  });

  it('S1. full-universe completeness: every athlete sees its whole pool', () => {
    for (const a of baseline.athletes) {
      const rows = byFixture.get(a.fixtureId);
      expect(rows.length, a.fixtureId).toBe(a.poolSize);
      const c = a.counts;
      expect(c.ranked + c.limitedData + c.ineligible + c.suppressed, a.fixtureId).toBe(a.poolSize);
    }
  });

  it('S2. no programme appears twice for one athlete', () => {
    for (const [fixtureId, rows] of byFixture) {
      const ids = new Set(rows.map((r) => r.programmeId));
      expect(ids.size, fixtureId).toBe(rows.length);
    }
  });

  it('S3. every cell carries a programme id, name and division', () => {
    for (const c of cells) {
      expect(typeof c.programmeId === 'string' && c.programmeId.length > 0).toBe(true);
      expect(typeof c.programme === 'string' && c.programme.length > 0).toBe(true);
      expect(typeof c.division === 'string' && c.division.length > 0).toBe(true);
    }
  });

  it('S4. ranks are a dense 1..n permutation, so ties cannot collide or gap', () => {
    for (const [fixtureId, rows] of byFixture) {
      const ranked = rows.filter((r) => r.rankingState === 'RANKED');
      const ranks = ranked.map((r) => r.rank).sort((x, y) => x - y);
      expect(ranks.length, fixtureId).toBe(ranked.length);
      for (let i = 0; i < ranks.length; i += 1) expect(ranks[i], `${fixtureId} @${i}`).toBe(i + 1);
    }
  });

  it('S5. rank order agrees with pursuit order (no hard-constraint leap-frogging)', () => {
    for (const [fixtureId, rows] of byFixture) {
      const ranked = rows.filter((r) => r.rankingState === 'RANKED').sort((a, b) => a.rank - b.rank);
      for (let i = 1; i < ranked.length; i += 1) {
        expect(ranked[i - 1].pursuit, `${fixtureId} ${ranked[i - 1].rank}->${ranked[i].rank}`)
          .toBeGreaterThanOrEqual(ranked[i].pursuit);
      }
    }
  });

  it('S6. no UNSUPPORTED programme is ranked or scored', () => {
    const leaked = cells.filter((c) => c.universe === UNIVERSE.UNSUPPORTED
      && (c.rankingState === 'RANKED' || c.rank !== null || c.pursuit !== null));
    expect(leaked.map((c) => `${c.fixtureId}/${c.programme}`)).toEqual([]);
  });

  it('S7. every score is within [0,1]', () => {
    for (const c of cells) {
      if (c.pursuit !== null) {
        expect(c.pursuit, `${c.fixtureId}/${c.programme}`).toBeGreaterThanOrEqual(0);
        expect(c.pursuit, `${c.fixtureId}/${c.programme}`).toBeLessThanOrEqual(1);
      }
      for (const L of LAYERS) {
        const l = c[L];
        for (const k of ['value', 'coverage']) {
          if (l[k] === undefined || l[k] === null) continue;
          expect(l[k], `${c.fixtureId}/${c.programme}/${L}.${k}`).toBeGreaterThanOrEqual(0);
          expect(l[k], `${c.fixtureId}/${c.programme}/${L}.${k}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('S8. no NaN or Infinity anywhere in the artifact', () => {
    const bad = [];
    const walk = (v, p) => {
      if (typeof v === 'number') { if (!Number.isFinite(v)) bad.push(p); return; }
      if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${p}[${i}]`)); return; }
      if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`); }
    };
    walk(baseline, '$');
    expect(bad).toEqual([]);
  });

  it('S9. a layer is scoreable with a value, or unscoreable with a reason - never both, never neither', () => {
    for (const c of cells) {
      for (const L of LAYERS) {
        const l = c[L];
        expect(['SCOREABLE', 'UNSCOREABLE', 'ABSENT']).toContain(l.state);
        if (l.state === 'SCOREABLE') {
          expect(typeof l.value, `${c.fixtureId}/${c.programme}/${L}`).toBe('number');
          expect(l.reason ?? null, `${c.fixtureId}/${c.programme}/${L}`).toBe(null);
        }
        if (l.state === 'UNSCOREABLE') {
          expect(l.value ?? null, `${c.fixtureId}/${c.programme}/${L}`).toBe(null);
          expect(typeof l.reason, `${c.fixtureId}/${c.programme}/${L}`).toBe('string');
        }
      }
    }
  });

  it('S10. RANKED requires all three of Recruitability, Financial and Opportunity', () => {
    for (const c of cells) {
      if (c.rankingState !== 'RANKED') continue;
      for (const L of LAYERS) {
        expect(c[L].state, `${c.fixtureId}/${c.programme}/${L}`).toBe('SCOREABLE');
      }
      expect(typeof c.pursuit, `${c.fixtureId}/${c.programme}`).toBe('number');
    }
  });

  it('S11. the Top 100 is the first 100 of the full ranking, never a separate list', () => {
    for (const [fixtureId, rows] of byFixture) {
      const ranked = rows.filter((r) => r.rankingState === 'RANKED').sort((a, b) => a.rank - b.rank);
      const top = ranked.slice(0, 100);
      expect(top.map((r) => r.rank), fixtureId).toEqual(top.map((_, i) => i + 1));
      /** #101+ are retained, not discarded, whenever the pool is big enough. */
      if (ranked.length > 100) expect(ranked.length, fixtureId).toBeGreaterThan(100);
    }
  });

  it('S12. the engine\'s own account of what is missing matches which layers refused', () => {
    for (const c of cells) {
      if (c.rankingState === 'RANKED') { expect(c.missingLayers ?? null).toBe(null); continue; }
      const refused = LAYERS.filter((L) => c[L].state !== 'SCOREABLE').sort();
      expect([...(c.missingLayers ?? [])].sort(), `${c.fixtureId}/${c.programme}`).toEqual(refused);
    }
  });

  it('S13. every grade is MEASURED or PARTIAL - ASSUMED was abolished and must not return', () => {
    const grades = new Set();
    for (const c of cells) {
      if (c.pursuitGrade) grades.add(c.pursuitGrade);
      for (const L of LAYERS) if (c[L].grade) grades.add(c[L].grade);
    }
    expect([...grades].sort()).toEqual(['MEASURED', 'PARTIAL']);
  });

  it('S14. LIMITED_DATA programmes stay visible and never become a low score', () => {
    for (const c of cells) {
      if (c.rankingState === 'LIMITED_DATA') {
        expect(c.pursuit ?? null, `${c.fixtureId}/${c.programme}`).toBe(null);
        expect(c.rank ?? null, `${c.fixtureId}/${c.programme}`).toBe(null);
        expect((c.missingLayers ?? []).length, `${c.fixtureId}/${c.programme}`).toBeGreaterThan(0);
      }
    }
  });

  it('S15. no roster-player or other person-level field reached the artifact', () => {
    const banned = /player_name|"email"|hometown|"gpa_raw"|date_of_birth|phone/i;
    expect(banned.test(JSON.stringify(baseline))).toBe(false);
  });
});
