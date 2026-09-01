import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';

process.env.RECRUITMATCH_DB = ':memory:';

const db = (await import('../db/client.js')).default;
const { evidenceSummaries, toWire, MAX_COLLEGES } = await import('./evidence.js');
const { departureFields, evidenceFor } = await import('../lib/evidenceQueries.js');

const athleteId = randomUUID();
const SCHOOL = 'Example University';

/** A roster row in the shape roster_players actually holds. */
function roster(o = {}) {
  db.prepare(`INSERT INTO roster_players
    (id, created_date, updated_date, college_name, sport, division, season, player_name,
     position, minutes_played, projected_minutes, estimated_graduation_year,
     eligibility_end_year, class_year_label, nationality, country, prior_programme)
    VALUES (@id, @stamp, @stamp, @college_name, 'mens-soccer', 'NCAA D1', @season,
     @player_name, @position, @minutes_played, @projected_minutes, @estimated_graduation_year,
     @eligibility_end_year, @class_year_label, @nationality, @country, @prior_programme)`)
    .run({
      // A recent scrape stamp. The freshness policy reads an old or missing
      // `updated_date` as reason to downgrade or suppress a present-tense
      // claim, so a fixture dated months back would silently be testing the
      // degraded path — see shared/evidence/freshness.js.
      stamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      id: randomUUID(), college_name: SCHOOL, season: '2026', player_name: 'A Player',
      position: 'DEFENSE', minutes_played: null, projected_minutes: 600,
      estimated_graduation_year: 2029, eligibility_end_year: 2028, class_year_label: 'Jr.',
      nationality: 'USA', country: '', prior_programme: null, ...o,
    });
}

beforeAll(() => {
  db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, sport,
      nationality, recruiting_class_year)
    VALUES (?, '2026-01-01', '2026-01-01', 'Rhys Davies', 'Defender', 'mens-soccer',
      'New Zealand', 2027)`).run(athleteId);
  db.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active,
      conference_champion_2025, conference_champion_name)
    VALUES (?, '2026-01-01', '2026-01-01', ?, 'mens-soccer', 'NCAA D1', 1, 1, 'ACC')`)
    .run(randomUUID(), SCHOOL);

  // A New Zealander in an earlier season — the evidence the browser cannot
  // compute for itself, because it never loads these seasons.
  roster({ season: '2023', player_name: 'Kiwi One', country: 'New Zealand', nationality: 'International' });
  // Two defenders whose spot opens for the 2027 intake.
  roster({ player_name: 'Leaver One', estimated_graduation_year: 2027, projected_minutes: 900 });
  roster({ player_name: 'Leaver Two', estimated_graduation_year: 2027, projected_minutes: 100 });
  for (let i = 0; i < 18; i += 1) roster({ player_name: `Squad ${i}`, position: 'MIDFIELD' });
});

describe('departure numbers are the matching engine\'s own', () => {
  it('computes the cohort server-side without ranking the pool', () => {
    const athlete = db.prepare('SELECT * FROM players WHERE id = ?').get(athleteId);
    const d = departureFields(SCHOOL, 'mens-soccer', athlete);
    expect(d.graduating_at_position).toBe(2);
    expect(d.graduating_names_at_position.sort()).toEqual(['Leaver One', 'Leaver Two']);
    // Only the 900-minute projection clears the starter bar.
    expect(d.graduating_starters_at_position).toBe(1);
    expect(d.roster_season).toBe('2026');
  });
});

describe('a match row is not trusted unless it declares its season', () => {
  const athlete = () => db.prepare('SELECT * FROM players WHERE id = ?').get(athleteId);

  /**
   * The drafting CLI ranks on the 2025 roster. Passing that row through as
   * `match` built departure evidence from last season and labelled it 2026:
   * Evansville was drafted claiming four graduating defenders by name, none of
   * whom are on its 2026 roster. Freshness cannot catch it — the 2026 rows are
   * a day old — so the guard has to be that an undeclared season is not
   * trusted at all.
   */
  it('ignores a match with no season and recomputes from the current squad', () => {
    const stale = {
      graduating_at_position: 4,
      graduating_names_at_position: ['Gone One', 'Gone Two', 'Gone Three', 'Gone Four'],
    };
    const out = evidenceFor(athlete(), SCHOOL, { sport: 'mens-soccer', match: stale });
    const ev = out.all.find((e) => e.kind === 'POSITION_GRADUATION');
    // The fixture's own 2026 squad has two, not four, and neither is named Gone.
    expect(ev.data.count).toBe(2);
    expect(ev.data.names.sort()).toEqual(['Leaver One', 'Leaver Two']);
    expect(JSON.stringify(out.sentences)).not.toContain('Gone');
  });

  it('ignores a match declaring a season that is not the current one', () => {
    const wrongSeason = {
      roster_season: '2025',
      graduating_at_position: 9,
      graduating_names_at_position: ['Last Year'],
    };
    const ev = evidenceFor(athlete(), SCHOOL, { sport: 'mens-soccer', match: wrongSeason })
      .all.find((e) => e.kind === 'POSITION_GRADUATION');
    expect(ev.data.count).toBe(2);
  });

  it('uses a match that does declare the current season', () => {
    const current = {
      roster_season: '2026',
      graduating_at_position: 3,
      graduating_names_at_position: ['A', 'B', 'C'],
    };
    const ev = evidenceFor(athlete(), SCHOOL, { sport: 'mens-soccer', match: current })
      .all.find((e) => e.kind === 'POSITION_GRADUATION');
    expect(ev.data.count).toBe(3);
  });
});

describe('the composer route', () => {
  it('returns rendered prose keyed by college name', () => {
    const out = evidenceSummaries({ playerId: athleteId, collegeNames: [SCHOOL] });
    const got = out[SCHOOL];
    expect(got.paragraph).toContain('New Zealand');
    expect(got.structure).toBe('RELATIONSHIP_FIRST');
    expect(got.programme.hasSquad).toBe(true);
    expect(got.programme.hasHistory).toBe(true);
  });

  it('finds the historical evidence the browser could never compute', () => {
    const got = evidenceSummaries({ playerId: athleteId, collegeNames: [SCHOOL] })[SCHOOL];
    expect(got.selected.map((e) => e.kind)).toContain('HISTORICAL_SAME_COUNTRY');
  });

  it('includes the departure evidence without the client sending any numbers', () => {
    const got = evidenceSummaries({ playerId: athleteId, collegeNames: [SCHOOL] })[SCHOOL];
    expect(got.available.map((e) => e.kind)).toContain('POSITION_GRADUATION');
  });

  it('sends no evidence objects over the wire — only prose and metadata', () => {
    const got = evidenceSummaries({ playerId: athleteId, collegeNames: [SCHOOL] })[SCHOOL];
    // `data` is where a client could find raw values to compose its own
    // sentence, and it must not be there: the client has no renderer, which is
    // what stops it ever stating a SIGNAL as a fact.
    for (const ev of got.selected) expect(ev).not.toHaveProperty('data');
    expect(JSON.stringify(got)).not.toContain('"dedupeGroup"');
  });

  it('marks each selected piece with its tier so the operator can see which is which', () => {
    const got = evidenceSummaries({ playerId: athleteId, collegeNames: [SCHOOL] })[SCHOOL];
    for (const ev of got.selected) expect(['FACT', 'SIGNAL']).toContain(ev.tier);
  });

  it('reports an unknown programme as unavailable rather than as nothing to say', () => {
    const out = evidenceSummaries({ playerId: athleteId, collegeNames: [SCHOOL, 'Nowhere College'] });
    // Nowhere has no rows at all, so it has no roster evidence — but the entry
    // must still exist, and must not claim zero anything.
    expect(out).toHaveProperty('Nowhere College');
    expect(out['Nowhere College'].programme.hasSquad).toBe(false);
    expect(out['Nowhere College'].paragraph).toBe('');
  });

  it('one bad programme does not cost the operator the rest of the batch', () => {
    const out = evidenceSummaries({ playerId: athleteId, collegeNames: [SCHOOL, 'Nowhere College'] });
    expect(out[SCHOOL].paragraph).toBeTruthy();
  });

  it('refuses an unknown player', () => {
    expect(() => evidenceSummaries({ playerId: 'nope', collegeNames: [SCHOOL] }))
      .toThrow(/Unknown player/);
  });

  it('refuses an empty or oversized request', () => {
    expect(() => evidenceSummaries({ playerId: athleteId, collegeNames: [] }))
      .toThrow(/collegeNames is required/);
    const many = Array.from({ length: MAX_COLLEGES + 1 }, (_, i) => `S${i}`);
    expect(() => evidenceSummaries({ playerId: athleteId, collegeNames: many }))
      .toThrow(/Too many programmes/);
  });
});

describe('operator override', () => {
  const athlete = () => db.prepare('SELECT * FROM players WHERE id = ?').get(athleteId);

  it('offers every eligible angle with a server-rendered sentence', () => {
    const got = evidenceSummaries({ playerId: athleteId, collegeNames: [SCHOOL] })[SCHOOL];
    expect(got.available.length).toBeGreaterThan(got.selected.length);
    for (const ev of got.available) {
      expect(typeof ev.text, ev.kind).toBe('string');
      expect(ev.text.length, ev.kind).toBeGreaterThan(0);
      expect(ev).not.toHaveProperty('data');
    }
    expect(got.available.filter((e) => e.selected).length).toBe(got.selected.length);
  });

  it('honours a chosen angle over the engine\'s ranking', () => {
    const auto = evidenceSummaries({ playerId: athleteId, collegeNames: [SCHOOL] })[SCHOOL];
    expect(auto.primary?.kind ?? auto.selected[0].kind).toBe('HISTORICAL_SAME_COUNTRY');

    const chosen = evidenceSummaries({
      playerId: athleteId, collegeNames: [SCHOOL],
      prefer: { [SCHOOL]: ['POSITION_GRADUATION'] },
    })[SCHOOL];
    expect(chosen.selected[0].kind).toBe('POSITION_GRADUATION');
    expect(chosen.operatorSelected).toBe(true);
    expect(chosen.paragraph).toContain('defenders');
  });

  it('ignores a kind that was never generated, rather than inventing it', () => {
    const out = evidenceFor(athlete(), SCHOOL, {
      sport: 'mens-soccer', prefer: ['ACADEMIC_FIT', 'HISTORICAL_SAME_COUNTRY'],
    });
    // No intended major on this athlete, so ACADEMIC_FIT does not exist here.
    expect(out.selected.map((e) => e.kind)).toEqual(['HISTORICAL_SAME_COUNTRY']);
    expect(out.unavailableRequests).toEqual(['ACADEMIC_FIT']);
  });

  it('cannot be used to reach internal-only intelligence', () => {
    const out = evidenceFor(athlete(), SCHOOL, {
      sport: 'mens-soccer', prefer: ['TRANSFER_BEHAVIOUR'],
    });
    expect(out.selected.map((e) => e.kind)).not.toContain('TRANSFER_BEHAVIOUR');
    expect(out.operatorSelected).toBe(false);   // nothing valid was chosen
  });

  it('cannot promote a SIGNAL — a chosen signal is still hedged', () => {
    const out = evidenceFor(athlete(), SCHOOL, {
      sport: 'mens-soccer', prefer: ['POSITION_GRADUATION_STARTERS'],
    });
    const picked = out.selected[0];
    if (picked) {
      expect(picked.tier).toBe('SIGNAL');
      expect(out.paragraph).toMatch(/going off last season's minutes/i);
    }
  });

  it('falls back to the engine when nothing valid was requested', () => {
    const out = evidenceFor(athlete(), SCHOOL, { sport: 'mens-soccer', prefer: ['NOT_A_KIND'] });
    expect(out.selected[0].kind).toBe('HISTORICAL_SAME_COUNTRY');
    expect(out.operatorSelected).toBe(false);
  });
});

describe('wire shape', () => {
  /**
   * An allowlist rather than a snapshot, because the risk it guards is a NEW
   * key rather than a changed one: the wire is meant to carry rendered prose
   * and flat decisions, and the way that stops being true is somebody adding a
   * field that happens to hold the evidence object it came from. A new key has
   * to be added here deliberately, and the assertion below then checks what it
   * contains.
   */
  it('carries what the panel needs and nothing it does not', () => {
    const athlete = db.prepare('SELECT * FROM players WHERE id = ?').get(athleteId);
    const wire = toWire(evidenceFor(athlete, SCHOOL, { sport: 'mens-soccer' }));
    expect(Object.keys(wire).sort()).toEqual([
      'available', 'belowThreshold', 'composition', 'dispositions', 'engineSelected',
      'internal', 'maxEvidence', 'operatorSelected', 'otherKnown', 'paragraph',
      'programme', 'rejected', 'selected', 'structure', 'structureEligible',
      'structureLabel', 'structureOptions', 'structureRefused', 'structureSource',
      'suppressed', 'unavailableRequests',
    ]);
  });

  /**
   * The property the allowlist exists to protect.
   *
   * No item anywhere on the wire may carry a `data` field. That is what stops
   * the client having anything to render a sentence FROM — it holds prose the
   * server wrote and keys it can send back, and so cannot state a SIGNAL as a
   * fact however it is misused.
   */
  it('never carries raw evidence data, at any depth', () => {
    const athlete = db.prepare('SELECT * FROM players WHERE id = ?').get(athleteId);
    const wire = toWire(evidenceFor(athlete, SCHOOL, { sport: 'mens-soccer' }));
    const walk = (node, path) => {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
      if (!node || typeof node !== 'object') return undefined;
      expect(Object.keys(node), `${path} must not carry evidence data`).not.toContain('data');
      return Object.entries(node).forEach(([k, v]) => walk(v, `${path}.${k}`));
    };
    walk(wire, 'wire');
  });

  /**
   * The composer renders `composition.template`, so if it is absent the
   * browser silently falls back to the athlete's saved template and every
   * draft comes out the same shape while the panel names a structure that
   * changed nothing. That is precisely what happened before this was added,
   * and it is invisible from the panel — hence a test rather than a look.
   */
  it('carries the composed template the browser renders', () => {
    const athlete = db.prepare('SELECT * FROM players WHERE id = ?').get(athleteId);
    const wire = toWire(evidenceFor(athlete, SCHOOL, { sport: 'mens-soccer' }));
    expect(wire.composition.template).toContain('{{coach_first_name}}');
    // Case-insensitively: a slot capitalises the clause that opens it, which
    // is why the composer joins server-rendered clauses rather than the
    // client assembling sentences of its own.
    const slots = Object.values(wire.composition.tokens).join(' ').toLowerCase();
    for (const s of wire.selected) expect(slots).toContain(s.text.toLowerCase());
  });

  it('offers only structures this evidence supports', () => {
    const athlete = db.prepare('SELECT * FROM players WHERE id = ?').get(athleteId);
    const wire = toWire(evidenceFor(athlete, SCHOOL, { sport: 'mens-soccer' }));
    expect(wire.structureOptions.map((o) => o.key)).toEqual(wire.structureEligible);
    expect(wire.structureOptions).toContainEqual({ key: 'PLAYER_FIRST', label: 'Player first' });
  });
});
