/**
 * A7.42 — the repair fixture authorises exactly 72 rows and nothing else.
 *
 * The applier deletes by fixture row id, never by programme name, so the
 * fixture IS the authorisation. These tests guard that authorisation: its
 * size, its split, its self-consistency, and the privacy rule that no athlete
 * name may appear in it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'docs/validation/a742/A7.42-contamination-fixture.json'), 'utf8'));

describe('the fixture authorises exactly the frozen set', () => {
  it('holds 72 rows', () => {
    expect(fixture.changes).toHaveLength(72);
  });

  it('splits 43 Grand Canyon and 29 Kansas State, both women\'s soccer', () => {
    const by = fixture.changes.reduce((m, c) => { m[c.programme] = (m[c.programme] || 0) + 1; return m; }, {});
    expect(by).toEqual({ 'Grand Canyon': 43, 'Kansas State': 29 });
    expect(new Set(fixture.changes.map((c) => c.sport))).toEqual(new Set(['womens-soccer']));
    expect(new Set(fixture.changes.map((c) => c.season))).toEqual(new Set(['2026']));
  });

  it('every row id is distinct, so no row can be authorised twice', () => {
    expect(new Set(fixture.changes.map((c) => c.id)).size).toBe(72);
  });

  it('the membership fingerprint matches its own rows', () => {
    // A tampered fixture - a row added, removed or swapped - fails here before
    // the applier ever reaches the database.
    const recomputed = crypto.createHash('sha256')
      .update(JSON.stringify(fixture.changes.map((c) => c.id).sort())).digest('hex');
    expect(recomputed).toBe(fixture.membershipFingerprint);
  });

  it('carries the source URL that produced the contamination', () => {
    const urls = new Set(fixture.changes.map((c) => c.sourceRosterUrl));
    expect(urls.size).toBe(2);
    for (const u of urls) expect(u).toMatch(/\/roster\/season\/2026$/);
  });

  it('records every stored position as UNKNOWN, which is how they were found', () => {
    expect(new Set(fixture.changes.map((c) => c.positionStored))).toEqual(new Set(['UNKNOWN']));
  });
});

describe('privacy: the fixture names no athlete', () => {
  it('carries digests, never names', () => {
    const text = JSON.stringify(fixture);
    expect(text).not.toMatch(/"playerName"|"sourceName"|"player_name"/);
    for (const c of fixture.changes) {
      expect(c.playerNameDigest).toMatch(/^[0-9a-f]{16}$/);
      expect(c.rowFingerprint).toMatch(/^[0-9a-f]{16}$/);
      expect(Object.keys(c)).not.toContain('playerName');
    }
  });

  it('declares how the digest is formed, so it can be recomputed', () => {
    expect(fixture.nameDigest.algorithm).toBe('sha256');
    expect(fixture.nameDigest.salt).toBeTruthy();
  });
});

describe('the recorded roster gap is explicit, not implied by absence', () => {
  it('names both programmes, the reason and the removed count', () => {
    const gaps = fixture.knownRosterGaps;
    expect(gaps).toHaveLength(2);
    for (const g of gaps) {
      expect(g.status).toBe('KNOWN_ROSTER_GAP_AFTER_CONTAMINATION_REMOVAL');
      expect(g.sport).toBe('womens-soccer');
      expect(g.season).toBe('2026');
      expect(g.removedRowCount).toBeGreaterThan(0);
      expect(g.reason).toBeTruthy();
      expect(g.repairPhase).toBe('A7.42');
    }
    expect(gaps.reduce((s, g) => s + g.removedRowCount, 0)).toBe(72);
  });

  it('records a correct source without having acquired it', () => {
    for (const g of fixture.knownRosterGaps) {
      expect(g.correctSourceStatus).toBe('CORRECT_SOURCE_ESTABLISHED');
      expect(g.correctSourceUrl).toMatch(/womens-soccer\/roster$/);
      // Recorded and deliberately NOT used: the acquisition path still cannot
      // prove sport identity before extraction.
      expect(g.reacquired).toBe(false);
    }
  });
});
