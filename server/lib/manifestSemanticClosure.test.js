import { describe, it, expect, beforeEach } from 'vitest';
import db from '../db/client.js';
import {
  datasetManifest, MANIFEST_VERSION, digest, canonical,
  ARRIVAL_SEMANTIC_FIELDS, recruitingArrivalsFingerprint,
} from './evidenceBaseline.js';

/**
 * L7ZQ — the manifest's one promise, enforced.
 *
 *   If data capable of changing a behavioural baseline changes,
 *   dataset identity changes with it.
 *
 * L7ZP broke that promise in production: a `recruiting_arrivals` rebuild moved
 * all six behavioural baselines and left the V5 digest exactly where it was.
 * These tests are the regression for that, and for the second hole the audit
 * found beside it.
 *
 * The converse is deliberately NOT asserted. The manifest may move for a
 * governance or provenance reason that no sampled surface reflects — L7ZI
 * moved it for a table holding zero rows. One-directional is the honest
 * contract.
 */

/**
 * V5 exactly as it was: the same components, minus the two L7ZQ added.
 *
 * Verified faithful against the real pin — this reconstruction reproduces
 * `a433a7c149fe1628` on the canonical corpus L7ZP left behind, so "V5 could
 * not see this" is a measurement rather than a claim.
 */
const V5_ADDED_BY_L7ZQ = ['coach_seasons', 'recruiting_arrivals'];
const manifestV5 = () => digest(canonical(
  datasetManifest().tables.filter((t) => !V5_ADDED_BY_L7ZQ.includes(t.table))));
const manifestV6 = () => datasetManifest().digest;
const manifestV7 = () => datasetManifest().digest;

const clear = () => {
  for (const t of ['recruiting_arrivals', 'coach_seasons', 'roster_players']) db.prepare(`DELETE FROM ${t}`).run();
};

const ARRIVAL_DEFAULTS = {
  programme: 'Alpha College', sport: 'mens-soccer', arrival_season: '2026', prior_season: '2025',
  source_transition: '2025->2026', roster_row_id: 'rr-1', player_name: 'Sam Reed', name_key: 'samreed',
  arrival_confidence: 'DIRECT', identity_method: 'EXACT', reconciled_from: null,
  canonical_position: 'DEFENSE', nationality_flag: 'International', country: 'Australia',
  region: 'OCEANIA', is_international: 1, class_label_raw: 'Fr.', entry_type: 'FRESHMAN',
  prior_programme: null, prior_confidence: 'NONE', prior_candidates: null,
  coach: 'Pat Vaughan', coach_attribution: 'DIRECT', built_at: '2026-01-01T00:00:00.000Z',
};

function insertArrival(over = {}) {
  const row = { ...ARRIVAL_DEFAULTS, ...over };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO recruiting_arrivals (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`).run(row);
}

const insertCoachSeason = (over = {}) => db.prepare(
  `INSERT INTO coach_seasons (school, sport, season, coach_name, coach_title, method, confidence, reason, imported_at)
   VALUES (@school, @sport, @season, @coach_name, @coach_title, @method, @confidence, @reason, @imported_at)`,
).run({
  school: 'Alpha College', sport: 'mens-soccer', season: 2026, coach_name: 'Pat Vaughan',
  coach_title: 'Head Coach', method: 'roster-live', confidence: 'High', reason: null,
  imported_at: '2026-01-01T00:00:00.000Z', ...over,
});

beforeEach(() => { clear(); insertArrival(); insertCoachSeason(); });

describe('L7ZQ — the version moved, deliberately', () => {
  it('is V7', () => {
    expect(MANIFEST_VERSION).toBe('V7');
  });

  it('carries every table the six outputs execute against', () => {
    const names = datasetManifest().tables.map((t) => t.table);
    for (const t of ['players', 'colleges', 'roster_players', 'roster_season_trust', 'coaches',
      'athletics_domains', 'programme_status', 'coach_seasons', 'recruiting_arrivals',
      'recruiting_arrivals_build']) expect(names, t).toContain(t);
  });
});

describe('L7ZQ — the L7ZP blind spot, as a regression', () => {
  it('DERIVED: arrivals content moves V6 while V5 cannot see it', () => {
    /*
     * The exact shape of L7ZP: source inputs untouched, the materialised table
     * different, every behavioural product different. V5 reported UNCHANGED.
     */
    const v5before = manifestV5();
    const v6before = manifestV6();

    db.prepare("DELETE FROM recruiting_arrivals WHERE arrival_season = '2026'").run();

    expect(manifestV5()).toBe(v5before);      // blind, as it was in production
    expect(manifestV6()).not.toBe(v6before);  // closed
  });

  it('SOURCE: coach_seasons moves V6 while V5 cannot see it', () => {
    /*
     * A separate hole found beside the first. `philosophyQueries` reads this
     * table straight into Evidence; V5 carried `coaches`, a different table.
     */
    const v5before = manifestV5();
    const v6before = manifestV6();

    db.prepare("UPDATE coach_seasons SET coach_name = 'Someone Else'").run();

    expect(manifestV5()).toBe(v5before);
    expect(manifestV6()).not.toBe(v6before);
  });

  it('every semantic arrival field moves it', () => {
    /* A column-by-column guard, so a future edit cannot quietly drop one. */
    const identity = ['programme', 'sport', 'arrival_season', 'prior_season', 'player_name', 'name_key'];
    for (const field of ARRIVAL_SEMANTIC_FIELDS) {
      clear(); insertArrival(); insertCoachSeason();
      const before = manifestV6();
      const next = identity.includes(field) || typeof ARRIVAL_DEFAULTS[field] === 'string'
        ? 'MUTATED' : 0;
      db.prepare(`UPDATE recruiting_arrivals SET ${field} = ?`).run(next);
      expect(manifestV6(), field).not.toBe(before);
    }
  });
});

describe('L8B-2 — V7 moves for anything, which is the point', () => {
  /*
   * V6 asked which columns matter and answered by hand. L8B-1 measured the
   * answer being wrong — see the blind spot below — so V7 stopped asking.
   * These assertions are the inverse of V6's and are deliberate: the churn they
   * now accept cannot occur on the PINNED acceptance corpus, where nothing
   * writes, and acceptance is the only place a false CHANGED would cost
   * anything.
   */
  it('THE BLIND SPOT: the freshness fingerprint is behavioural, and V7 sees it', () => {
    /*
     * L8B-1: tampering with input_digest moved ALL SIX behavioural baselines,
     * because assertServable gates every recruiting claim on it — while V6
     * reported the dataset UNCHANGED. This is the regression for that.
     */
    db.prepare(`INSERT INTO recruiting_arrivals_build (sport, input_digest, builder_version, built_at, generation)
      VALUES ('mens-soccer', 'real', 'v1', '2026-01-01T00:00:00.000Z', 1)`).run();
    const before = manifestV7();
    db.prepare("UPDATE recruiting_arrivals_build SET input_digest = 'TAMPERED'").run();
    expect(manifestV7()).not.toBe(before);
  });

  it('provenance churn moves it too, and that is accepted', () => {
    const before = manifestV7();
    db.prepare("UPDATE recruiting_arrivals SET roster_row_id = 'different-entirely'").run();
    expect(manifestV7()).not.toBe(before);
  });

  it('a new column moves it automatically — no registration step', () => {
    /* Schema evolution is the property a hand-picked projection cannot have. */
    const before = manifestV7();
    db.prepare('ALTER TABLE roster_players ADD COLUMN l8b2_probe TEXT').run();
    expect(manifestV7()).not.toBe(before);
  });

  it('is not a code hash: identical data, same digest', () => {
    expect(manifestV7()).toBe(manifestV7());
  });

  it('row ORDER cannot move it', () => {
    const before = manifestV7();
    insertArrival({ player_name: 'Zzz Later', name_key: 'zzzlater' });
    db.prepare("DELETE FROM recruiting_arrivals WHERE name_key = 'zzzlater'").run();
    expect(manifestV7()).toBe(before);
  });
});

describe('L7ZQ — freshness and dataset identity stay separate questions', () => {
  it('a truncated table still reports FRESH, which is why V6 hashes content', async () => {
    /*
     * THE ARGUMENT AGAINST REUSING THE FRESHNESS FINGERPRINT.
     *
     * L7ZL's fingerprint covers what the table was built FROM. Delete every row
     * afterwards and it still matches, because no input moved — measured on the
     * real corpus during this stage. Freshness asks "does this match its
     * inputs"; the manifest asks "what will the product read". A table emptied
     * after a good build answers the first and fails the second.
     */
    const { materialisationState } = await import('./recruitingMaterialisation.js');
    const before = manifestV6();
    const freshBefore = materialisationState('mens-soccer');

    db.prepare('DELETE FROM recruiting_arrivals').run();

    expect(materialisationState('mens-soccer').state).toBe(freshBefore.state);  // unchanged
    expect(manifestV6()).not.toBe(before);                                       // but identity moved
  });
});
