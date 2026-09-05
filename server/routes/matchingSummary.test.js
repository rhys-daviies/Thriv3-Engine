import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { matchingSummaries, assertWireSafe, MAX_COLLEGES } from './matchingSummary.js';
import { MAX_FACTS } from '../../shared/evidence/matchingSummary.js';
import { evidenceSummaries, MAX_COLLEGES as COMPOSER_MAX } from './evidence.js';
import { operatorEvidenceSummaries } from './operatorEvidence.js';
import { EVIDENCE_KINDS, PERMISSION, permissionsFor } from '../../shared/evidence/kinds.js';

/**
 * The recruiting-signal endpoint.
 *
 * The read model already proved what may be selected; what this suite defends
 * is the HTTP boundary around it. A denied kind must not reach JSON by any
 * route, the payload must fail closed when the read model grows a field, and a
 * programme with no signals must come back as a successful answer rather than
 * as a gap — 79% of real pairs are in that state, so it is the ordinary case
 * and not an edge one.
 */

const athleteId = randomUUID();
const SIGNAL = 'Pathway University';    // a coach arrival from the athlete's country
const QUIET = 'Quiet College';          // resolved, licensed nothing
const COMPATRIOT = 'Compatriot State';  // a compatriot on the CURRENT squad and nowhere else
const MISSING = 'Not A Real Programme'; // never inserted

let baseUrl;

/** The route exactly as index.js mounts it. */
function mount() {
  const app = express().use(express.json());
  app.post('/api/players/:playerId/matching-summary', (req, res) => {
    try {
      res.json(matchingSummaries({
        playerId: req.params.playerId,
        collegeNames: (req.body || {}).collegeNames,
      }));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });
  return app;
}

async function post(playerId, body) {
  const r = await fetch(`${baseUrl}/api/players/${playerId}/matching-summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

function roster(school, o = {}) {
  db.prepare(`INSERT INTO roster_players
    (id, created_date, updated_date, college_name, sport, division, season, player_name,
     position, minutes_played, projected_minutes, estimated_graduation_year,
     eligibility_end_year, class_year_label, nationality, country, prior_programme)
    VALUES (@id, @stamp, @stamp, @college_name, 'mens-soccer', 'NCAA D1', @season,
     @player_name, @position, @minutes_played, @projected_minutes, @estimated_graduation_year,
     @eligibility_end_year, @class_year_label, @nationality, @country, @prior_programme)`)
    .run({
      stamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      id: randomUUID(), college_name: school, season: '2026', player_name: 'A Player',
      position: 'MIDFIELD', minutes_played: null, projected_minutes: 600,
      estimated_graduation_year: 2029, eligibility_end_year: 2028, class_year_label: 'Jr.',
      nationality: 'USA', country: '', prior_programme: null, ...o,
    });
}

function college(name) {
  db.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active)
    VALUES (?, '2026-01-01', '2026-01-01', ?, 'mens-soccer', 'NCAA D1', 1)`)
    .run(randomUUID(), name);
}

beforeAll(async () => {
  // The athlete's country is derived from `nationality` — `players` has no
  // country column, and `normaliseAthlete` reads anything other than USA as
  // the country to look for a pipeline from.
  db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, sport,
      nationality, recruiting_class_year)
    VALUES (?, '2026-01-01', '2026-01-01', 'Test Athlete', 'Defender', 'mens-soccer',
      'New Zealand', 2027)`).run(athleteId);
  college(SIGNAL);
  college(QUIET);
  college(COMPATRIOT);

  // A compatriot on an earlier roster, which licenses a country signal, plus a
  // graduating cohort, which licenses nothing here and must never appear.
  for (const season of ['2022', '2023', '2024', '2025', '2026']) {
    for (let i = 0; i < 6; i += 1) {
      roster(SIGNAL, { season, player_name: `Squad ${season}-${i}` });
    }
  }
  roster(SIGNAL, { season: '2023', player_name: 'Kiwi One', country: 'New Zealand', nationality: 'International' });
  roster(SIGNAL, { player_name: 'Leaver One', position: 'DEFENSE', estimated_graduation_year: 2027, projected_minutes: 1200 });
  roster(SIGNAL, { player_name: 'Leaver Two', position: 'DEFENSE', estimated_graduation_year: 2027, projected_minutes: 1100 });

  /**
   * A squad with real evidence, none of it licensed here.
   *
   * Half defenders, so the position group is not thin and scarcity does not
   * fire; no compatriots, so no country signal; and two defenders graduating,
   * which the Decision Evidence page reports and this surface must not. That
   * combination is what makes the hasEvidence assertion below meaningful
   * rather than a statement about an empty programme.
   */
  for (let i = 0; i < 12; i += 1) roster(QUIET, { player_name: `Quiet Mid ${i}` });
  for (let i = 0; i < 10; i += 1) roster(QUIET, { player_name: `Quiet Def ${i}`, position: 'DEFENSE' });
  roster(QUIET, { player_name: 'Quiet Leaver One', position: 'DEFENSE', estimated_graduation_year: 2027, projected_minutes: 1200 });
  roster(QUIET, { player_name: 'Quiet Leaver Two', position: 'DEFENSE', estimated_graduation_year: 2027, projected_minutes: 1100 });

  /**
   * The programme whose only evidence is the one kind the score already has.
   *
   * A New Zealander on the 2026 squad and on no earlier roster, so
   * CURRENT_SAME_COUNTRY fires and HISTORICAL_SAME_COUNTRY deliberately does
   * not — the generator refuses to call a player who has only ever been in the
   * current squad "history". The match score counts this same person through
   * `internationalFit`'s `sameCountryRows`, which is why the kind is denied
   * this surface, and this fixture is what makes that denial testable rather
   * than asserted against a programme that never had one.
   *
   * Balanced position groups so scarcity does not fire and leave the card
   * something else to say.
   */
  for (let i = 0; i < 12; i += 1) roster(COMPATRIOT, { player_name: `Compat Mid ${i}` });
  for (let i = 0; i < 10; i += 1) roster(COMPATRIOT, { player_name: `Compat Def ${i}`, position: 'DEFENSE' });
  roster(COMPATRIOT, {
    player_name: 'Kiwi Now', position: 'DEFENSE', country: 'New Zealand', nationality: 'International',
  });

  const app = mount();
  await new Promise((resolve) => {
    const server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
    server.unref();
  });
});

const DENIED = Object.keys(EVIDENCE_KINDS)
  .filter((k) => permissionsFor(k).MATCHING_SUMMARY === PERMISSION.DENIED);

describe('the endpoint answers for one athlete across many programmes', () => {
  it('keys the response by every programme asked for', async () => {
    const { status, body } = await post(athleteId, { collegeNames: [SIGNAL, QUIET] });
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual([QUIET, SIGNAL].sort());
  });

  it('uses the identity mechanism the sibling routes use', async () => {
    // Athlete in the path, programme names in the body. A second identifier
    // system would let three surfaces disagree about who is being asked about.
    const { body } = await post(athleteId, { collegeNames: [SIGNAL] });
    expect(body[SIGNAL].programme).toBeDefined();
  });

  it('caps at the same number as the composer route', () => {
    expect(MAX_COLLEGES).toBe(COMPOSER_MAX);
  });

  it('refuses an unknown athlete with the established error shape', async () => {
    const { status, body } = await post(randomUUID(), { collegeNames: [SIGNAL] });
    expect(status).toBe(400);
    expect(body.error).toMatch(/^Unknown player/);
  });

  it('refuses a request with no programmes', async () => {
    const { status, body } = await post(athleteId, {});
    expect(status).toBe(400);
    expect(body.error).toBe('collegeNames is required');
  });

  it('refuses a collegeNames that is not an array', async () => {
    expect((await post(athleteId, { collegeNames: SIGNAL })).status).toBe(400);
  });

  it('refuses more programmes than the cap, naming it', async () => {
    const many = Array.from({ length: MAX_COLLEGES + 1 }, (_, i) => `School ${i}`);
    const { status, body } = await post(athleteId, { collegeNames: many });
    expect(status).toBe(400);
    expect(body.error).toContain(String(MAX_COLLEGES));
  });

  it('answers a mixed batch without one programme costing the others', async () => {
    const { status, body } = await post(athleteId, { collegeNames: [SIGNAL, QUIET, MISSING] });
    expect(status).toBe(200);
    expect(body[SIGNAL].hasEvidence).toBe(true);
    expect(body[QUIET].hasEvidence).toBe(false);
    expect(body[MISSING].programme.resolved).toBe(false);
  });
});

describe('the three programme states stay distinct', () => {
  it('returns signals for a programme that has them', async () => {
    const { body } = await post(athleteId, { collegeNames: [SIGNAL] });
    expect(body[SIGNAL].programme.resolved).toBe(true);
    expect(body[SIGNAL].facts.length).toBeGreaterThan(0);
    expect(body[SIGNAL].hasEvidence).toBe(true);
  });

  it('returns a successful empty answer for a resolved programme with none', async () => {
    const { status, body } = await post(athleteId, { collegeNames: [QUIET] });
    // The ordinary case: 79% of real pairs. Not an error, not a gap.
    expect(status).toBe(200);
    expect(body[QUIET]).toEqual({ programme: { resolved: true }, facts: [], hasEvidence: false });
  });

  it('reports an unresolved name as unresolved, not as a failure', async () => {
    const { status, body } = await post(athleteId, { collegeNames: [MISSING] });
    expect(status).toBe(200);
    expect(body[MISSING]).toEqual({ programme: { resolved: false }, facts: [], hasEvidence: false });
  });

  it('separates a resolved empty programme from an unresolved name', async () => {
    const { body } = await post(athleteId, { collegeNames: [QUIET, MISSING] });
    expect(body[QUIET].facts).toEqual(body[MISSING].facts);
    expect(body[QUIET].programme.resolved).toBe(true);
    expect(body[MISSING].programme.resolved).toBe(false);
  });

  it('does not turn a server error into an unresolved programme', async () => {
    // A request that cannot be answered is a 400 with no programme block at
    // all. `resolved: false` is a data state and never an API failure.
    const { status, body } = await post('nobody', { collegeNames: [SIGNAL] });
    expect(status).toBe(400);
    expect(body).not.toHaveProperty('programme');
  });
});

describe('the wire boundary fails closed', () => {
  it('carries exactly three top-level keys', async () => {
    const { body } = await post(athleteId, { collegeNames: [SIGNAL] });
    expect(Object.keys(body[SIGNAL]).sort()).toEqual(['facts', 'hasEvidence', 'programme']);
  });

  it('carries exactly four keys per fact', async () => {
    const { body } = await post(athleteId, { collegeNames: [SIGNAL] });
    for (const fact of body[SIGNAL].facts) {
      expect(Object.keys(fact).sort()).toEqual(['category', 'facts', 'kind', 'qualification']);
      expect(Object.keys(fact.qualification).sort()).toEqual(['seasons', 'temporality']);
    }
  });

  it('rejects a payload that grew a top-level field', () => {
    // The read model and the route are edited independently. A field added
    // upstream must be a decision to publish it.
    expect(() => assertWireSafe({
      programme: { resolved: true }, facts: [], hasEvidence: false, evidenceCount: 0,
    })).toThrow(/must carry exactly/);
  });

  it('rejects a programme block that grew a field', () => {
    expect(() => assertWireSafe({
      programme: { resolved: true, hasSquad: true }, facts: [], hasEvidence: false,
    })).toThrow(/programme must carry only/);
  });

  it('rejects a fact that grew a field', () => {
    expect(() => assertWireSafe({
      programme: { resolved: true },
      facts: [{ kind: 'X', category: 'c', facts: {}, qualification: {}, lead: true }],
      hasEvidence: true,
    })).toThrow(/must carry exactly/);
  });

  it('rejects a forbidden field nested inside a fact', () => {
    // `facts` is per-kind and cannot be allowlisted generically, so the depth
    // scan is what catches a projection that started passing something new.
    expect(() => assertWireSafe({
      programme: { resolved: true },
      facts: [{ kind: 'X', category: 'c', qualification: {}, facts: { region: 'OCEANIA' } }],
      hasEvidence: true,
    })).toThrow(/forbidden field\(s\): region/);
  });

  it('rejects more facts than a card may show', () => {
    const fact = { kind: 'X', category: 'c', facts: {}, qualification: {} };
    expect(() => assertWireSafe({
      programme: { resolved: true },
      facts: Array.from({ length: MAX_FACTS + 1 }, () => fact),
      hasEvidence: true,
    })).toThrow(/more than a card may show/);
  });
});

describe('hasEvidence means one thing on this surface', () => {
  it('is exactly facts.length > 0', async () => {
    const { body } = await post(athleteId, { collegeNames: [SIGNAL, QUIET, MISSING] });
    for (const m of Object.values(body)) {
      expect(m.hasEvidence).toBe(m.facts.length > 0);
    }
  });

  it('is refused when it disagrees with the facts it carries', () => {
    expect(() => assertWireSafe({
      programme: { resolved: true }, facts: [], hasEvidence: true,
    })).toThrow(/facts.length > 0/);
  });

  it('means "has a recruiting signal", never "we hold evidence"', async () => {
    // The quiet programme has five seasons of roster history and a graduating
    // cohort. The Decision Evidence page has plenty to say about it; this
    // surface reports false, and that is the correct answer for a card.
    const { body } = await post(athleteId, { collegeNames: [QUIET] });
    expect(body[QUIET].hasEvidence).toBe(false);
    // The Decision Evidence payload for the same programme, which is what
    // "we hold evidence" would mean if this flag meant that.
    const decision = operatorEvidenceSummaries({ playerId: athleteId, collegeNames: [QUIET] })[QUIET];
    expect(decision.summary.hasEvidence).toBe(true);
    expect(decision.summary.evidenceCount).toBeGreaterThan(0);
  });
});

describe('no denied kind reaches JSON', () => {
  it('names none of the twenty denied kinds in a real response', async () => {
    const { body } = await post(athleteId, { collegeNames: [SIGNAL, QUIET, MISSING] });
    const json = JSON.stringify(body);
    for (const kind of DENIED) expect(json, kind).not.toContain(kind);
    expect(DENIED).toHaveLength(21);
  });

  /**
   * The kind the match score already counts.
   *
   * Denied for MATCHING_SUMMARY because `internationalFit` — which the
   * geography criterion delegates to for every international athlete — reads
   * the same compatriots off the same current roster. On a card it would have
   * appeared beside the score's own "a compatriot here" label, under a line
   * saying it was not an input to the score.
   */
  it('will not serve CURRENT_SAME_COUNTRY, even as a programme’s only evidence', async () => {
    const { status, body } = await post(athleteId, { collegeNames: [COMPATRIOT] });
    expect(status).toBe(200);
    expect(JSON.stringify(body)).not.toContain('CURRENT_SAME_COUNTRY');
    expect(body[COMPATRIOT].facts).toEqual([]);
    expect(body[COMPATRIOT].hasEvidence).toBe(false);
    // A resolved programme with nothing to show — not a failure, not unknown.
    expect(body[COMPATRIOT].programme.resolved).toBe(true);
  });

  it('names nobody the denied kind would have named', async () => {
    const { body } = await post(athleteId, { collegeNames: [COMPATRIOT] });
    expect(JSON.stringify(body)).not.toContain('Kiwi Now');
    expect(JSON.stringify(body)).not.toContain('New Zealand');
  });

  it('proves that denial is doing the work, not an empty fixture', async () => {
    // The same programme, on the surfaces that may say it: the composer offers
    // the kind and the Decision Evidence page holds it. If this ever stops
    // being true the assertions above go quiet and prove nothing.
    const composer = evidenceSummaries({ playerId: athleteId, collegeNames: [COMPATRIOT] })[COMPATRIOT];
    expect(composer.available.map((e) => e.kind)).toContain('CURRENT_SAME_COUNTRY');
    const decision = operatorEvidenceSummaries({ playerId: athleteId, collegeNames: [COMPATRIOT] })[COMPATRIOT];
    expect(decision.summary.hasEvidence).toBe(true);
  });

  it('names none of the kinds most likely to be argued back in', async () => {
    const { body } = await post(athleteId, { collegeNames: [SIGNAL] });
    const json = JSON.stringify(body);
    for (const kind of ['POSITION_GRADUATION', 'POSITION_GRADUATION_STARTERS',
      'INTERNATIONAL_ROSTER', 'INTERNATIONAL_SHARE', 'ELIGIBILITY_CLIFF', 'ACADEMIC_FIT',
      'PROGRAM_MOMENTUM', 'COACH_CONTEXT', 'PROGRAMME_DEVELOPMENT_PATTERN',
      'FRESHMAN_MINUTES_LADDER', 'ATHLETE_COHORT_LADDER', 'PROGRAMME_POOL_BENCHMARK']) {
      expect(json, kind).not.toContain(kind);
    }
    // And the fixture really does generate the graduating cohort that would
    // have appeared, so the assertion is not vacuous.
    const composer = evidenceSummaries({ playerId: athleteId, collegeNames: [SIGNAL] })[SIGNAL];
    expect(composer.available.map((e) => e.kind)).toContain('POSITION_GRADUATION');
  });

  it('leaks no region key and no raw evidence data', async () => {
    const { body } = await post(athleteId, { collegeNames: [SIGNAL, QUIET] });
    const json = JSON.stringify(body);
    expect(json).not.toContain('OCEANIA');
    expect(json).not.toContain('"data"');
  });

  it('does not reimplement qualification, it refuses what the model dropped', async () => {
    // The route holds no rule of its own; anything the read model qualified
    // away simply never arrives. Proven by the licensed set being the only
    // kinds that ever appear.
    const { body } = await post(athleteId, { collegeNames: [SIGNAL, QUIET, MISSING] });
    const kinds = Object.values(body).flatMap((m) => (m.facts ?? []).map((f) => f.kind));
    const licensed = Object.keys(EVIDENCE_KINDS)
      .filter((k) => permissionsFor(k).MATCHING_SUMMARY !== PERMISSION.DENIED);
    for (const kind of kinds) expect(licensed).toContain(kind);
  });
});

describe('the endpoint is independent of matching', () => {
  it('accepts no score, weight or criterion in the body', async () => {
    const plain = await post(athleteId, { collegeNames: [SIGNAL] });
    const withScore = await post(athleteId, {
      collegeNames: [SIGNAL], match_score: 99, breakdown: [{ key: 'roster', contribution: 40 }],
      weights: { roster: 1 }, recommendation: { name: SIGNAL },
    });
    expect(withScore.body).toEqual(plain.body);
  });

  it('mentions nothing score-shaped in its module', async () => {
    const { body } = await post(athleteId, { collegeNames: [SIGNAL] });
    const json = JSON.stringify(body);
    for (const word of ['match_score', 'breakdown', 'contribution', 'weight', 'criterion']) {
      expect(json).not.toContain(word);
    }
  });
});

describe('the sibling routes are untouched', () => {
  it('leaves the composer answering on its own key set', () => {
    const out = evidenceSummaries({ playerId: athleteId, collegeNames: [SIGNAL] });
    expect(Object.keys(out[SIGNAL])).toContain('paragraph');
    expect(out[SIGNAL]).not.toHaveProperty('facts');
    expect(out[SIGNAL]).not.toHaveProperty('hasEvidence');
  });
});
