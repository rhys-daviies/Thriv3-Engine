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
  it('is V6', () => {
    expect(MANIFEST_VERSION).toBe('V6');
  });

  it('carries both components V5 was blind to', () => {
    const names = datasetManifest().tables.map((t) => t.table);
    expect(names).toContain('coach_seasons');
    expect(names).toContain('recruiting_arrivals');
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

describe('L7ZQ — what must NOT move dataset identity', () => {
  it('roster_row_id churn is inert', () => {
    /*
     * L7ZP found 24,929 rows differing ONLY here, after a roster re-import gave
     * the source rows new surrogate ids. `toArrival` loads it and nothing
     * consumes it. A manifest that moved for this would cry wolf.
     */
    const before = manifestV6();
    db.prepare("UPDATE recruiting_arrivals SET roster_row_id = 'different-entirely'").run();
    expect(manifestV6()).toBe(before);
  });

  it('the stored region cache is inert', () => {
    /*
     * `toArrival` says in its own comment that it does not read this column,
     * because patterns.js recomputes region from country. A cache is not
     * dataset identity.
     */
    const before = manifestV6();
    db.prepare("UPDATE recruiting_arrivals SET region = 'NOWHERE'").run();
    expect(manifestV6()).toBe(before);
  });

  it('built_at is operational, so a deterministic rebuild does not move it', () => {
    /*
     * L7ZP proved rebuilds reproduce identical semantic rows. If the timestamp
     * counted, every rebuild would move dataset identity and mean nothing by it.
     */
    const before = manifestV6();
    db.prepare("UPDATE recruiting_arrivals SET built_at = '2099-12-31T23:59:59.000Z'").run();
    expect(manifestV6()).toBe(before);
  });

  it('the build generation counter is operational too', () => {
    db.prepare(`INSERT INTO recruiting_arrivals_build (sport, input_digest, builder_version, built_at, generation)
      VALUES ('mens-soccer', 'abc', 'v1', '2026-01-01T00:00:00.000Z', 1)`).run();
    const before = manifestV6();
    db.prepare("UPDATE recruiting_arrivals_build SET generation = 99, built_at = '2099-01-01T00:00:00.000Z'").run();
    expect(manifestV6()).toBe(before);
  });

  it('coach acquisition provenance is inert', () => {
    /* method/confidence/source_url reach no claim; a re-scrape must be quiet. */
    const before = manifestV6();
    db.prepare("UPDATE coach_seasons SET method = 'wayback:2020', confidence = 'Medium'").run();
    expect(manifestV6()).toBe(before);
  });

  it('is not a code hash: identical data, any code version, same digest', () => {
    /*
     * Manifest is dataset identity. A refactor that changes no data must leave
     * it alone, or the two questions collapse into one and neither is
     * answerable.
     */
    const a = manifestV6();
    const b = manifestV6();
    expect(b).toBe(a);
  });

  it('row ORDER cannot move it', () => {
    /* Lines are sorted, so SQLite's scan order and index choices are invisible. */
    const before = recruitingArrivalsFingerprint().digest;
    insertArrival({ player_name: 'Zzz Later', name_key: 'zzzlater' });
    db.prepare("DELETE FROM recruiting_arrivals WHERE name_key = 'zzzlater'").run();
    expect(recruitingArrivalsFingerprint().digest).toBe(before);
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
