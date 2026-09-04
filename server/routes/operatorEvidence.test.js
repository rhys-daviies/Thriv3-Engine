/**
 * The operator Evidence endpoint and its serializer.
 *
 * Two things are being pinned here and they are different in kind. The
 * serializer tests assert a BOUNDARY — what may cross HTTP — and they are
 * mostly written against hand-built read models, because a boundary is about
 * shape and a fixture that happens to produce the right shape proves less than
 * one built to break it. The route tests assert the SAME BEHAVIOUR the composer
 * route already has: identity, cap, per-programme failure, error status.
 *
 * The last block asserts that none of this reached the composer route. That
 * matters more than it looks: the two surfaces share `evidenceFor` and the
 * registry beneath it, so a change made for this endpoint could reach the email
 * engine without anybody touching its file.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import {
  operatorEvidenceSummaries, wireOperatorEvidence, MAX_COLLEGES,
} from './operatorEvidence.js';
import { evidenceSummaries, toWire, MAX_COLLEGES as COMPOSER_MAX } from './evidence.js';
import { evidenceFor } from '../lib/evidenceQueries.js';
import { operatorEvidenceFor, SECTION_KEYS } from '../../shared/evidence/operatorEvidence.js';

const athleteId = randomUUID();
const OPEN = 'Opportunity University';   // an opening, a pathway, and a group of three
const BARE = 'Bare College';             // a real programme with nothing to say
const MISSING = 'Not A Real Programme';  // never inserted

let baseUrl;

/** The route exactly as index.js mounts it, so the test covers the real shape. */
function mount() {
  const app = express().use(express.json());
  app.post('/api/players/:playerId/operator-evidence', (req, res) => {
    try {
      res.json(operatorEvidenceSummaries({
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
  const r = await fetch(`${baseUrl}/api/players/${playerId}/operator-evidence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}

/** A roster row in the shape roster_players actually holds. */
function roster(school, o = {}) {
  db.prepare(`INSERT INTO roster_players
    (id, created_date, updated_date, college_name, sport, division, season, player_name,
     position, minutes_played, projected_minutes, games_played, estimated_graduation_year,
     eligibility_end_year, class_year_label, nationality, country, prior_programme)
    VALUES (@id, @stamp, @stamp, @college_name, 'mens-soccer', 'NCAA D1', @season,
     @player_name, @position, @minutes_played, @projected_minutes, @games_played,
     @estimated_graduation_year, @eligibility_end_year, @class_year_label, @nationality,
     @country, @prior_programme)`)
    .run({
      // Recent, so the freshness policy is not silently under test here.
      stamp: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      id: randomUUID(), college_name: school, season: '2026', player_name: 'A Player',
      position: 'DEFENSE', minutes_played: null, projected_minutes: 600, games_played: 15,
      estimated_graduation_year: 2029, eligibility_end_year: 2028, class_year_label: 'Jr.',
      nationality: 'USA', country: '', prior_programme: null, ...o,
    });
}

function college(name, notableMajors = []) {
  db.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active,
      notable_majors)
    VALUES (?, '2026-01-01', '2026-01-01', ?, 'mens-soccer', 'NCAA D1', 1, ?)`)
    .run(randomUUID(), name, JSON.stringify(notableMajors));
}

beforeAll(async () => {
  // An intended major, because the two surfaces load the athlete separately
  // and a narrower loader silently costs one of them ACADEMIC_FIT.
  db.prepare(`INSERT INTO players (id, created_date, updated_date, full_name, position, sport,
      nationality, recruiting_class_year, intended_major)
    VALUES (?, '2026-01-01', '2026-01-01', 'Test Athlete', 'Defender', 'mens-soccer',
      'New Zealand', 2027, 'Business')`).run(athleteId);
  college(OPEN, ['Business']);
  college(BARE);

  // Three defenders leaving before the 2027 intake, two of them projected
  // starters — the position-opportunity group that must survive as one reason
  // with two supporting items rather than being collapsed into a single fact.
  roster(OPEN, { player_name: 'Leaver One', estimated_graduation_year: 2027, eligibility_end_year: 2026, projected_minutes: 1200 });
  roster(OPEN, { player_name: 'Leaver Two', estimated_graduation_year: 2027, eligibility_end_year: 2026, projected_minutes: 1100 });
  roster(OPEN, { player_name: 'Leaver Three', estimated_graduation_year: 2027, eligibility_end_year: 2027, projected_minutes: 200 });
  // A compatriot in an earlier season — a pathway in a second category, so the
  // per-category cap is exercised rather than assumed.
  roster(OPEN, { season: '2023', player_name: 'Kiwi One', country: 'New Zealand', nationality: 'International' });
  for (let i = 0; i < 18; i += 1) roster(OPEN, { player_name: `Squad ${i}`, position: 'MIDFIELD' });

  // Bare College exists and has a squad, but nothing about it is a reason.
  for (let i = 0; i < 6; i += 1) roster(BARE, { player_name: `Bare ${i}`, position: 'MIDFIELD' });

  const app = mount();
  await new Promise((resolve) => {
    const server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
    server.unref();
  });
});

/** Every key name appearing anywhere in a payload, at any depth. */
function keysAnywhere(node, out = new Set()) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((v) => keysAnywhere(v, out)); return out; }
  for (const [k, v] of Object.entries(node)) { out.add(k); keysAnywhere(v, out); }
  return out;
}

/** A minimal fact object in the shape operatorFactsFor produces. */
function fact(over = {}) {
  return {
    kind: 'POSITION_GRADUATION',
    decisionClass: 'OPENING',
    polarity: 'POSITIVE',
    category: 'roster',
    facts: { position: 'DEFENSE', count: 3 },
    qualification: {
      tier: 'FACT', temporality: 'CURRENT', confidence: 'HIGH',
      confidenceBeforeFreshness: null, minConfidence: 'MEDIUM',
      freshness: { state: 'CURRENT', ageDays: 1, reason: null },
      season: '2026', source: 'roster_players', sourceUrl: null,
      window: null, comparison: null,
      requiresWindow: false, requiresComparison: false,
    },
    ...over,
  };
}

/** A minimal read model in the shape operatorEvidenceFor produces. */
function model(over = {}) {
  return {
    summary: {
      reasonCount: 0, hasPositiveReasons: false, openingIdentified: false,
      hasEvidence: false, evidenceCount: 0, generatedCount: 7,
      sectionCounts: Object.fromEntries(SECTION_KEYS.map((k) => [k, 0])),
    },
    topReasons: [],
    sections: Object.fromEntries(SECTION_KEYS.map((k) => [k, []])),
    diagnostics: { excluded: [], dispositions: [] },
    ...over,
  };
}

describe('the endpoint answers for one athlete across many programmes', () => {
  it('returns a payload keyed by every programme that was asked for', async () => {
    const { status, body } = await post(athleteId, { collegeNames: [OPEN, BARE] });
    expect(status).toBe(200);
    expect(Object.keys(body).sort()).toEqual([BARE, OPEN].sort());
  });

  it('uses the athlete identity mechanism the composer route already uses', async () => {
    // Path param for the athlete, body array for the programmes. A second
    // identifier system would mean the two surfaces could disagree about who
    // is being asked about.
    const { status, body } = await post(athleteId, { collegeNames: [OPEN] });
    expect(status).toBe(200);
    expect(body[OPEN].summary).toBeDefined();
  });

  it('refuses an unknown athlete with the error shape the API already uses', async () => {
    const { status, body } = await post(randomUUID(), { collegeNames: [OPEN] });
    expect(status).toBe(400);
    expect(body.error).toMatch(/^Unknown player/);
  });

  it('refuses a request with no programmes', async () => {
    const { status, body } = await post(athleteId, {});
    expect(status).toBe(400);
    expect(body.error).toBe('collegeNames is required');
  });

  it('refuses an empty programme list rather than returning an empty answer', async () => {
    const { status } = await post(athleteId, { collegeNames: [] });
    expect(status).toBe(400);
  });

  it('refuses a collegeNames that is not an array', async () => {
    const { status } = await post(athleteId, { collegeNames: OPEN });
    expect(status).toBe(400);
  });

  it('refuses more programmes than the cap, naming the cap', async () => {
    const many = Array.from({ length: MAX_COLLEGES + 1 }, (_, i) => `School ${i}`);
    const { status, body } = await post(athleteId, { collegeNames: many });
    expect(status).toBe(400);
    expect(body.error).toContain(String(MAX_COLLEGES));
  });

  it('caps at the same number the composer route caps at', () => {
    // Not a coincidence to be preserved by luck: both surfaces answer for the
    // same page of programmes, so a divergence would show as one tab working
    // and the other refusing.
    expect(MAX_COLLEGES).toBe(COMPOSER_MAX);
  });

  it('does not let one empty programme cost the operator the rest of the batch', async () => {
    const { status, body } = await post(athleteId, { collegeNames: [OPEN, MISSING] });
    expect(status).toBe(200);
    expect(body[OPEN].summary.hasEvidence).toBe(true);
  });

  it('answers for a programme it has never heard of rather than erroring', async () => {
    // `evidenceFor` does not throw on an unknown name — it finds no rows and
    // generates nothing — so the `unavailable` branch is reserved for a real
    // failure and this is the normal path.
    const { status, body } = await post(athleteId, { collegeNames: [MISSING] });
    expect(status).toBe(200);
    expect(Object.keys(body[MISSING]).sort()).toEqual(['sections', 'summary', 'topReasons']);
  });

  it('cannot yet distinguish an unknown programme from an empty one', async () => {
    const { body } = await post(athleteId, { collegeNames: [MISSING, BARE] });
    // KNOWN GAP, pinned rather than hidden. The composer route separates these
    // with `programme.hasSquad`; this payload carries no equivalent, so both
    // read as `hasEvidence: false` and a zero state would say "nothing found"
    // about a school we have never heard of. Closing it is a read-model change
    // — a field on `operatorEvidenceFor` — not a serializer one.
    expect(body[MISSING].summary.hasEvidence).toBe(false);
    expect(body[BARE].summary).toEqual(body[MISSING].summary);
  });
});

describe('the serializer is an allowlist, not a passthrough', () => {
  const live = () => wireOperatorEvidence(operatorEvidenceFor(
    evidenceFor(db.prepare('SELECT * FROM players WHERE id = ?').get(athleteId), OPEN, { sport: 'mens-soccer' }),
  ));

  it('crosses exactly three top-level keys', () => {
    expect(Object.keys(live()).sort()).toEqual(['sections', 'summary', 'topReasons']);
  });

  it('never sends a raw evidence `data` object', () => {
    // The composer route's own guarantee, held to here for the same reason: a
    // client holding `data` can manufacture a claim the engine never made.
    expect(keysAnywhere(live()).has('data')).toBe(false);
  });

  it('never sends rendered text', () => {
    // Every sentence on this surface is the client's, built from facts. A
    // rendered string crossing here would put two authors on one claim.
    expect(keysAnywhere(live()).has('text')).toBe(false);
  });

  it('never sends the permission grades it applied', () => {
    const keys = keysAnywhere(live());
    expect(keys.has('permissions')).toBe(false);
    expect(keys.has('emailEligible')).toBe(false);
  });

  it('never sends selection or ranking internals', () => {
    const keys = keysAnywhere(live());
    for (const internal of ['strength', 'describes', 'baseStrength', 'leadSuitability', 'downgraded']) {
      expect(keys.has(internal)).toBe(false);
    }
  });

  it('does not serialize diagnostics', () => {
    // Deliberate. They carry the selection vocabulary — CATEGORY_CAP,
    // MAX_REASONS, NEUTRAL_ONLY — which is how the policy works rather than
    // anything an operator asked about.
    expect(live().diagnostics).toBeUndefined();
  });

  it('fails closed when the read model grows a field nobody published', () => {
    expect(() => wireOperatorEvidence(model({ limits: [] })))
      .toThrow(/unrecognised field\(s\): limits/);
  });

  it('names every unrecognised field, so the fix is one edit', () => {
    expect(() => wireOperatorEvidence(model({ limits: [], trace: {} })))
      .toThrow(/limits, trace/);
  });

  it('accepts the read model as it stands today', () => {
    expect(() => wireOperatorEvidence(model())).not.toThrow();
  });

  it('survives a JSON round trip unchanged', () => {
    const wired = live();
    expect(JSON.parse(JSON.stringify(wired))).toEqual(wired);
  });
});

describe('the summary says enough to render every empty case', () => {
  const summaryOf = async (name) => (await post(athleteId, { collegeNames: [name] })).body[name].summary;

  it('carries exactly the fields the surface needs', async () => {
    expect(Object.keys(await summaryOf(OPEN)).sort()).toEqual([
      'evidenceCount', 'hasEvidence', 'hasPositiveReasons',
      'openingIdentified', 'reasonCount', 'sectionCounts',
    ]);
  });

  it('does not publish generatedCount', async () => {
    // The gap between it and evidenceCount says "we withheld some" without
    // saying which or why — a number a surface can only render as an
    // unexplained discrepancy.
    expect(await summaryOf(OPEN)).not.toHaveProperty('generatedCount');
  });

  it('counts every section, including the empty ones', async () => {
    expect(Object.keys((await summaryOf(OPEN)).sectionCounts).sort()).toEqual([...SECTION_KEYS].sort());
  });

  it('agrees with the number of reasons it sent', async () => {
    const { body } = await post(athleteId, { collegeNames: [OPEN] });
    expect(body[OPEN].summary.reasonCount).toBe(body[OPEN].topReasons.length);
  });

  it('reports an opening where one was identified', async () => {
    expect((await summaryOf(OPEN)).openingIdentified).toBe(true);
  });

  it('distinguishes "no reasons" from "no evidence"', async () => {
    const s = await summaryOf(BARE);
    // A programme can be fully readable and still give an operator nothing to
    // act on. Collapsing the two would make an honest answer look like a gap.
    expect(s.hasPositiveReasons).toBe(false);
    expect(s.evidenceCount).toBe(s.sectionCounts.ROSTER_OPPORTUNITY
      + s.sectionCounts.RECRUITMENT_PATHWAY + s.sectionCounts.DEVELOPMENT
      + s.sectionCounts.ACADEMIC_PROGRAMME_FIT + s.sectionCounts.PROGRAMME_CONTEXT);
  });

  it('never claims an opening it did not identify', async () => {
    expect((await summaryOf(BARE)).openingIdentified).toBe(false);
  });
});

describe('a grouped reason keeps its supporting evidence whole', () => {
  let reasons;
  beforeAll(async () => { reasons = (await post(athleteId, { collegeNames: [OPEN] })).body[OPEN].topReasons; });

  it('sends the group as one reason with its supporting items beside it', () => {
    const group = reasons.find((r) => r.dedupeGroup === 'position-opportunity');
    expect(group.supporting.length).toBeGreaterThan(0);
  });

  it('never folds a supporting item into the primary', () => {
    const group = reasons.find((r) => r.dedupeGroup === 'position-opportunity');
    // Three roster items can belong to one story and still count different
    // populations over different windows. Merging them would invent a number.
    for (const s of group.supporting) expect(s.kind).not.toBe(group.primary.kind);
  });

  it('gives every supporting item its own facts and qualification', () => {
    const group = reasons.find((r) => r.dedupeGroup === 'position-opportunity');
    for (const s of group.supporting) {
      expect(s.facts).toEqual(expect.any(Object));
      expect(s.qualification.tier).toEqual(expect.any(String));
    }
  });

  it('tells the surface which section each reason came from', () => {
    for (const r of reasons) expect(SECTION_KEYS).toContain(r.section);
  });

  it('carries only the reason fields the surface reads', () => {
    for (const r of reasons) {
      expect(Object.keys(r).sort()).toEqual([
        'category', 'decisionClass', 'dedupeGroup', 'primary', 'section', 'supporting',
      ]);
    }
  });

  it('sends a primary in the same shape as a section item', () => {
    const { primary } = reasons[0];
    expect(Object.keys(primary).sort()).toEqual([
      'category', 'decisionClass', 'facts', 'kind', 'polarity', 'qualification',
    ]);
  });

  it('sends no reasons at all where the policy found none', async () => {
    expect((await post(athleteId, { collegeNames: [BARE] })).body[BARE].topReasons).toEqual([]);
  });
});

describe('sections are fixed, and there is no bucket for the unplaced', () => {
  it('always sends all five, even when empty', async () => {
    const { body } = await post(athleteId, { collegeNames: [BARE] });
    expect(Object.keys(body[BARE].sections).sort()).toEqual([...SECTION_KEYS].sort());
  });

  it('sends no section the read model does not define', async () => {
    const { body } = await post(athleteId, { collegeNames: [OPEN] });
    // No "other". A kind with no section fails at module load instead, so a
    // new kind requires a decision before it can reach a surface.
    for (const key of Object.keys(body[OPEN].sections)) expect(SECTION_KEYS).toContain(key);
  });

  it('keeps a top reason in its section as well', async () => {
    const { body } = await post(athleteId, { collegeNames: [OPEN] });
    const r = body[OPEN].topReasons[0];
    // The two answer different questions. Removing it from the section would
    // make the section a lie about what we hold.
    expect(body[OPEN].sections[r.section].map((i) => i.kind)).toContain(r.primary.kind);
  });

  it('sends section items in the same shape as reason primaries', async () => {
    const { body } = await post(athleteId, { collegeNames: [OPEN] });
    for (const items of Object.values(body[OPEN].sections)) {
      for (const item of items) {
        expect(Object.keys(item).sort()).toEqual([
          'category', 'decisionClass', 'facts', 'kind', 'polarity', 'qualification',
        ]);
      }
    }
  });

  it('preserves the order the read model put them in', async () => {
    const athlete = db.prepare('SELECT * FROM players WHERE id = ?').get(athleteId);
    const m = operatorEvidenceFor(evidenceFor(athlete, OPEN, { sport: 'mens-soccer' }));
    const { body } = await post(athleteId, { collegeNames: [OPEN] });
    for (const key of SECTION_KEYS) {
      expect(body[OPEN].sections[key].map((i) => i.kind)).toEqual(m.sections[key].map((i) => i.kind));
    }
  });
});

describe('qualification carries what a claim rests on, and no rules', () => {
  const anyItem = async () => {
    const { body } = await post(athleteId, { collegeNames: [OPEN] });
    return body[OPEN].topReasons[0].primary.qualification;
  };

  it('carries exactly the fields a surface can explain quality with', async () => {
    expect(Object.keys(await anyItem()).sort()).toEqual([
      'comparison', 'confidence', 'confidenceBeforeFreshness', 'freshness',
      'season', 'source', 'sourceUrl', 'temporality', 'tier', 'window',
    ]);
  });

  it('does not send the confidence floor the server already enforced', async () => {
    // An item that failed its floor never reaches this payload. Sending the
    // rule would invite a surface to apply it a second time.
    expect(await anyItem()).not.toHaveProperty('minConfidence');
  });

  it('does not send the window and comparison requirements', async () => {
    const q = await anyItem();
    expect(q).not.toHaveProperty('requiresWindow');
    expect(q).not.toHaveProperty('requiresComparison');
  });

  it('leaves confidenceBeforeFreshness null when nothing was downgraded', async () => {
    expect((await anyItem()).confidenceBeforeFreshness).toBeNull();
  });

  it('carries the prior grade when freshness did downgrade one', () => {
    const stale = fact();
    stale.qualification.confidence = 'MEDIUM';
    stale.qualification.confidenceBeforeFreshness = 'HIGH';
    stale.qualification.freshness = { state: 'STALE', ageDays: 400, reason: 'roster last read in 2025' };
    const wired = wireOperatorEvidence(model({ sections: { ...Object.fromEntries(SECTION_KEYS.map((k) => [k, []])), ROSTER_OPPORTUNITY: [stale] } }));
    const q = wired.sections.ROSTER_OPPORTUNITY[0].qualification;
    // The downgrade is the operator-facing part, and it only reads as one
    // beside the reason freshness gives.
    expect(q.confidenceBeforeFreshness).toBe('HIGH');
    expect(q.freshness.reason).toBe('roster last read in 2025');
  });

  it('keeps "we did not read those seasons" apart from "there were none"', () => {
    const mk = (seasonsUnread) => {
      const f = fact({ kind: 'ATHLETE_COHORT_LADDER' });
      f.qualification.window = { seasons: ['2024'], seasonsUnread, n: 4, cohort: {} };
      return f;
    };
    const wire = (f) => wireOperatorEvidence(model({
      sections: { ...Object.fromEntries(SECTION_KEYS.map((k) => [k, []])), DEVELOPMENT: [f] },
    })).sections.DEVELOPMENT[0].qualification.window.seasonsUnread;

    // Three states, and the difference is the whole point: `null` means we do
    // not know, `[]` means we know there were none. Collapsing them would let
    // a surface say "all seasons read" about a window nobody checked.
    expect(wire(mk(null))).toBeNull();
    expect(wire(mk([]))).toEqual([]);
    expect(wire(mk(['2023']))).toEqual(['2023']);
  });

  it('holds the three window states across a JSON round trip', () => {
    const f = fact({ kind: 'ATHLETE_COHORT_LADDER' });
    f.qualification.window = { seasons: ['2024'], seasonsUnread: null, n: 4, cohort: {} };
    const wired = wireOperatorEvidence(model({
      sections: { ...Object.fromEntries(SECTION_KEYS.map((k) => [k, []])), DEVELOPMENT: [f] },
    }));
    // `undefined` would vanish here and read as an absent field rather than an
    // unknown one, which is why the read model uses null.
    expect(JSON.parse(JSON.stringify(wired)).sections.DEVELOPMENT[0].qualification.window.seasonsUnread)
      .toBeNull();
  });

  it('passes each kind\'s facts through whole rather than narrowing them twice', async () => {
    const { body } = await post(athleteId, { collegeNames: [OPEN] });
    const grad = body[OPEN].topReasons.find((r) => r.primary.kind === 'POSITION_GRADUATION');
    // operatorFactsFor is already a per-kind allowlist. A second narrowing
    // here would mean two files deciding what a kind means.
    expect(grad.primary.facts.position).toBe('DEFENSE');
    expect(grad.primary.facts.count).toBe(3);
  });
});

describe('the composer route is untouched by any of this', () => {
  it('still builds every wire item on the same nine fields', () => {
    const athlete = db.prepare('SELECT * FROM players WHERE id = ?').get(athleteId);
    const wired = toWire(evidenceFor(athlete, OPEN, { sport: 'mens-soccer' }));
    const NINE = ['category', 'confidence', 'downgraded', 'kind', 'season',
      'source', 'strength', 'text', 'tier'];
    // The two arrays that carry rendered evidence to the panel. The rest are
    // diagnostic projections — `otherKnown` is a label and a reason,
    // `suppressed` is a decision — and were never the nine.
    const arrays = ['selected', 'available'];
    const items = arrays.flatMap((key) => wired[key] ?? []);
    expect(items.length).toBeGreaterThan(0);
    for (const e of items) {
      // Each array layers its own presentation fields — `slot`, `reason`,
      // `disposition` — on top. The nine are the base, and they are all that
      // carries evidence.
      for (const field of NINE) expect(Object.keys(e)).toContain(field);
    }
  });

  it('never picks up the operator surface\'s vocabulary', () => {
    const athlete = db.prepare('SELECT * FROM players WHERE id = ?').get(athleteId);
    const wired = toWire(evidenceFor(athlete, OPEN, { sport: 'mens-soccer' }));
    const keys = keysAnywhere(wired);
    // The two surfaces run the same generators. This is the test that notices
    // if a change made for one reaches the other.
    for (const field of ['facts', 'qualification', 'section', 'polarity', 'topReasons', 'sections']) {
      expect(keys.has(field)).toBe(false);
    }
  });

  it('still layers only its own presentation fields onto the selected ones', () => {
    const athlete = db.prepare('SELECT * FROM players WHERE id = ?').get(athleteId);
    const wired = toWire(evidenceFor(athlete, OPEN, { sport: 'mens-soccer' }));
    for (const e of wired.selected) {
      // `slot`, `order` and `displayed` are the email composer's own, added on
      // top of the nine. Nothing from the operator surface appears here.
      expect(Object.keys(e).sort()).toEqual([
        'category', 'confidence', 'displayed', 'downgraded', 'kind', 'order',
        'season', 'slot', 'source', 'strength', 'text', 'tier',
      ]);
    }
  });

  it('still answers on exactly its own key set', () => {
    const out = evidenceSummaries({ playerId: athleteId, collegeNames: [OPEN] });
    // Twenty-one keys, none of them from the operator surface. If the two ever
    // share a serializer, this is the test that notices.
    expect(Object.keys(out[OPEN]).sort()).toEqual([
      'available', 'belowThreshold', 'composition', 'dispositions', 'engineSelected',
      'internal', 'maxEvidence', 'operatorSelected', 'otherKnown', 'paragraph',
      'programme', 'rejected', 'selected', 'structure', 'structureEligible',
      'structureLabel', 'structureOptions', 'structureRefused', 'structureSource',
      'suppressed', 'unavailableRequests',
    ]);
  });

  it('is looking at the same athlete the operator surface is', async () => {
    const composer = evidenceSummaries({ playerId: athleteId, collegeNames: [OPEN] })[OPEN];
    const { body } = await post(athleteId, { collegeNames: [OPEN] });
    const operatorKinds = Object.values(body[OPEN].sections).flat().map((i) => i.kind);

    // The two routes load the athlete through separate queries, and the
    // columns they select are not the same. Importing the narrower one cost
    // this surface every ACADEMIC_FIT at all 1,166 real programmes while every
    // test still passed — a kind that is never generated is indistinguishable
    // from a kind that does not apply. Asserted on a kind that exists ONLY
    // when a column outside the narrow set is present.
    expect(composer.available.map((e) => e.kind)).toContain('ACADEMIC_FIT');
    expect(operatorKinds).toContain('ACADEMIC_FIT');
  });

  it('is unaffected by the operator endpoint having been called first', async () => {
    const before = JSON.stringify(evidenceSummaries({ playerId: athleteId, collegeNames: [OPEN] }));
    await post(athleteId, { collegeNames: [OPEN, BARE] });
    // Both surfaces run `evidenceFor` over the same generators. A cache or a
    // mutation introduced for one would show up here.
    expect(JSON.stringify(evidenceSummaries({ playerId: athleteId, collegeNames: [OPEN] }))).toBe(before);
  });
});
