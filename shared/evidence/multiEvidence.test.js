import { describe, it, expect } from 'vitest';
import {
  selectEvidence, defineEvidence, evidenceLogPayload,
  MAX_EMAIL_EVIDENCE, MAX_PER_FAMILY, SLOT_FLOORS,
  FLOWS, FLOW_KEYS, eligibleFlows,
} from './index.js';
import { selectFrom, priorityOf, DISPOSITION } from './select.js';
import { canonicalPosition, POSITIONS } from '../positions.js';
import { EVIDENCE_KINDS, permissionsFor, PERMISSION } from './kinds.js';
import { planFromRoles } from './structures.js';
import { outreachEvidenceFor, ROLES } from './outreachEvidence.js';

/**
 * Multi-evidence selection, redundancy control and the structure library.
 *
 * The failures being engineered against here are all failures of RESTRAINT
 * rather than of correctness: an engine allowed to say four things will say
 * four things about a programme that supports one, and an email carrying four
 * readings of the same roster fact reads worse than one carrying the fact.
 * Every test below is a bound on what the engine is allowed to do with the
 * extra room, not a check that it can use it.
 */

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

/**
 * The LEGACY selector's own answer, asked for explicitly.
 *
 * These tests are about `selectFrom` — its ranking, its family caps, its slot
 * floors, its operator swap. Since G4 that engine no longer decides what an
 * email says; `outreachEvidenceFor` does, under a licence.
 *
 * Until H7 it still RAN on every production request and returned its answer
 * under `result.legacy`, so this helper read it from there. Nothing consumed
 * it, so H7 stopped computing it — and the assertions below did not change,
 * because the function is exported and its behaviour is unchanged. That is the
 * whole shape of the migration: the old policy is still testable, and a
 * request no longer pays to compute it.
 */
const selectEvidenceLegacy = (athlete, ctx, opts = {}) => {
  const r = selectEvidence(athlete, ctx, opts);
  return { ...r, ...selectFrom(r.all, { maxEmail: opts.maxEmail, prefer: opts.prefer }) };
};

const nzDefender = {
  full_name: 'Rhys Davies',
  position: 'Defender',
  nationality: 'New Zealand',
  intended_major: 'Business',
  recruiting_class_year: 2027,
  sport: 'mens-soccer',
};

const RECENT = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

const row = (o = {}) => ({
  college_name: 'Example University',
  sport: 'mens-soccer',
  season: '2026',
  updated_date: RECENT(),
  player_name: 'A Player',
  position: 'D',
  minutes_played: null,
  projected_minutes: 600,
  estimated_graduation_year: 2029,
  eligibility_end_year: 2028,
  class_year_label: 'Jr.',
  nationality: 'USA',
  country: '',
  prior_programme: null,
  ...o,
});

const squadOf = (n, o = {}) => Array.from({ length: n }, (_, i) => row({ player_name: `P${i}`, ...o }));
const college = (o = {}) => ({ name: 'Example University', sport: 'mens-soccer', notable_majors: [], ...o });

/**
 * A programme with something genuine to say in four different families.
 *
 * Built from real generator inputs rather than hand-made evidence objects, so
 * it exercises the same path a real programme does — a fixture that skips
 * generation can only test the parts of selection that were already obvious.
 */
function richProgramme(over = {}) {
  return {
    college: college({
      conference_champion_2025: 1,
      conference_champion_name: 'ACC',
      notable_majors: ['Business'],
      ...over.college,
    }),
    squad: [
      ...squadOf(4, { position: 'D' }),
      ...squadOf(10, { position: 'M' }),
      row({ player_name: 'Kiwi Now', country: 'New Zealand', nationality: 'International' }),
    ],
    history: [row({ season: '2023', country: 'New Zealand', player_name: 'Kiwi Past' })],
    match: {
      graduating_at_position: 3,
      graduating_names_at_position: ['A', 'B', 'C'],
      graduating_total: 7,
    },
    ...over.rest,
  };
}

/** A hand-built evidence object, for the selection rules that need exact numbers. */
/**
 * A piece of evidence of a given kind and strength.
 *
 * Supplies whatever the registry requires of that kind — a measured window, a
 * comparison — so these tests keep asking about SELECTION. The requirements
 * themselves are asserted in contractV2.test.js; duplicating them here would
 * mean a change to one of them broke thirty unrelated ranking tests.
 */
const ev = (kind, strength, o = {}) => defineEvidence(kind, {
  strength,
  confidence: 'HIGH',
  source: 'test',
  ...(EVIDENCE_KINDS[kind]?.requiresWindow
    ? { describes: { seasons: ['2024', '2025'], seasonsUnread: [], n: 8 } } : {}),
  ...(EVIDENCE_KINDS[kind]?.requiresComparison
    ? {
      comparison: {
        basis: 'pool', statistic: 'median', poolSize: 900, band: 'above-p75',
      },
    } : {}),
  ...o,
});

// ---------------------------------------------------------------------------
// 1. how many pieces
// ---------------------------------------------------------------------------

describe('how much evidence an email carries', () => {
  it('uses more than two when a programme genuinely supports it', () => {
    const result = selectEvidenceLegacy(nzDefender, richProgramme());
    expect(result.selected.length).toBeGreaterThan(2);
    expect(result.selected.length).toBeLessThanOrEqual(MAX_EMAIL_EVIDENCE);
  });

  it('never exceeds the ceiling, however much is known', () => {
    const result = selectEvidenceLegacy(nzDefender, richProgramme());
    expect(result.selected.length).toBeLessThanOrEqual(MAX_EMAIL_EVIDENCE);
    // The ceiling has to be REACHABLE in this fixture or the test above proves
    // nothing about the cap. Since G4 only ten kinds are licensed for outreach
    // at all, so the ranked pool is smaller and the cap is met rather than
    // exceeded — which is still the cap doing its job.
    expect(result.ranked.length).toBeGreaterThanOrEqual(MAX_EMAIL_EVIDENCE);
  });

  it('uses one when only one thing is worth saying', () => {
    const result = selectEvidenceLegacy(nzDefender, {
      college: college({ conference_champion_2025: 1, conference_champion_name: 'ACC' }),
    });
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].kind).toBe('CONFERENCE_TITLE');
  });

  it('uses none when there is nothing to say, and still produces a structure', () => {
    const result = selectEvidenceLegacy(nzDefender, { college: college() });
    expect(result.selected).toHaveLength(0);
    expect(result.structure.key).toBe('PLAYER_FIRST');
    expect(result.paragraph).toBe('');
    // The composed template must still be a whole email, not a shell with a
    // hole where the evidence was meant to be.
    expect(result.composition.template).toContain('{{coach_first_name}}');
    expect(result.composition.template).not.toContain('{{evidence_');
  });

  /**
   * The rule the brief states most plainly: quality over filling slots.
   *
   * Four items are available and all four clear their confidence floors; the
   * bottom two are weak, and the engine must decline them rather than pad.
   */
  it('leaves slots empty rather than filling them with weak evidence', () => {
    const selection = selectFrom([
      ev('CONFERENCE_TITLE', 80),          // priority 86
      ev('POSITION_GRADUATION', 48),       // priority 56 — fine as second
      ev('COACH_CONTEXT', 45, { confidence: 'MEDIUM' }),  // priority 45 — never third
      ev('PROGRAM_MOMENTUM', 40, { confidence: 'MEDIUM' }),
    ].filter(Boolean));

    // SQUAD_GRADUATION, COACH_CONTEXT and PROGRAM_MOMENTUM are all DENIED for
    // outreach since G4 and never reach the ranking; POSITION_GRADUATION takes
    // the second slot in their place. The slot floor is still what this tests.
    expect(selection.selected.map((e) => e.kind)).toEqual(['CONFERENCE_TITLE', 'POSITION_GRADUATION']);
    expect(selection.internal.map((e) => e.kind)).toContain('COACH_CONTEXT');
  });

  it('never adds a weak coach-tenure signal behind stronger evidence', () => {
    const selection = selectFrom([
      ev('HISTORICAL_SAME_COUNTRY', 88, { data: { country: 'New Zealand', count: 1, names: [] } }),
      ev('POSITION_GRADUATION', 76),
      ev('COACH_CONTEXT', 45, { confidence: 'MEDIUM' }),
    ]);
    expect(selection.selected.map((e) => e.kind)).not.toContain('COACH_CONTEXT');
    // ...and since G4 it cannot lead either, because it cannot be emailed at
    // all: a stranger telling a coach how long they have held their own job.
    // It is set aside as intelligence rather than ranked away.
    const alone = selectFrom([ev('COACH_CONTEXT', 45, { confidence: 'MEDIUM' })]);
    expect(alone.selected).toEqual([]);
    expect(alone.internal.map((e) => e.kind)).toEqual(['COACH_CONTEXT']);
  });

  it('raises the bar for each successive slot', () => {
    expect(SLOT_FLOORS).toHaveLength(MAX_EMAIL_EVIDENCE);
    for (let i = 1; i < SLOT_FLOORS.length; i += 1) {
      expect(SLOT_FLOORS[i]).toBeGreaterThan(SLOT_FLOORS[i - 1]);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. redundancy
// ---------------------------------------------------------------------------

describe('redundancy control', () => {
  /**
   * The exact case the brief names: four readings of one relationship.
   *
   * A programme with a New Zealander on the roster nearly always also has NZ
   * history, an Australasian history and a high international share. Before
   * multi-evidence only one could be selected because only two were selected
   * at all; with four slots the failure mode is an email that says the same
   * thing four ways, which is the mail-merge texture this system exists to
   * avoid.
   */
  it('never sends four readings of the same international relationship', () => {
    const result = selectEvidenceLegacy(nzDefender, {
      college: college(),
      squad: [
        row({ player_name: 'Kiwi Now', country: 'New Zealand', nationality: 'International' }),
        ...squadOf(12, { country: 'Spain', nationality: 'International' }),
      ],
      history: [
        row({ season: '2022', country: 'New Zealand', player_name: 'Kiwi Past' }),
        row({ season: '2023', country: 'Australia', player_name: 'Aussie Past' }),
      ],
    });

    const internationalKinds = result.selected.filter((e) => e.category === 'international');
    expect(internationalKinds.length).toBeLessThanOrEqual(1);
    // And the ones that lost are recorded with a reason, not dropped silently.
    expect(result.suppressed.length).toBeGreaterThan(0);
    for (const s of result.suppressed) expect(s.reason).toBeTruthy();
  });

  it('caps any one family at two, even across different dedupe groups', () => {
    // Four roster kinds in three different dedupe groups, so the hard collapse
    // cannot be what bounds this — only the family cap can.
    const selection = selectFrom([
      ev('POSITION_GRADUATION', 90),        // position-opportunity
      ev('POSITION_GROUP_SCARCITY', 88, { confidence: 'HIGH' }),   // position-depth
      ev('SQUAD_GRADUATION', 86),           // squad-turnover
    ]);
    /**
     * Since G4 the family cap is no longer what bounds this, because the
     * LICENCE bounds it first: POSITION_GROUP_SCARCITY and SQUAD_GRADUATION
     * are both DENIED for outreach, so one roster kind survives and the cap
     * never binds. The cap itself is unchanged and still tested against the
     * licensed set below.
     */
    const roster = selection.selected.filter((e) => e.category === 'roster');
    expect(roster.length).toBeLessThanOrEqual(MAX_PER_FAMILY);
    expect(roster.map((e) => e.kind)).toEqual(['POSITION_GRADUATION']);
    expect(selection.internal.map((e) => e.kind))
      .toEqual(expect.arrayContaining(['POSITION_GROUP_SCARCITY', 'SQUAD_GRADUATION']));
  });

  it('prefers a second family over a third helping of the first', () => {
    const selection = selectFrom([
      ev('POSITION_GRADUATION', 90),
      ev('POSITION_GROUP_SCARCITY', 88, { confidence: 'HIGH' }),
      ev('SQUAD_GRADUATION', 86),
      // Weaker than all three roster items, and still selected — because it is
      // the only thing in the email that is not about the roster.
      ev('ACADEMIC_FIT', 70, { data: { major: 'Business' } }),
    ]);
    // ACADEMIC_FIT is the weakest of the four and still selected, because the
    // two roster slots are full. The third roster item is dropped instead.
    expect(selection.selected.map((e) => e.kind)).toContain('ACADEMIC_FIT');
    expect(selection.selected.map((e) => e.kind)).not.toContain('POSITION_GROUP_SCARCITY');
  });

  it('draws from multiple families when a programme supports it', () => {
    const result = selectEvidenceLegacy(nzDefender, richProgramme());
    const families = new Set(result.selected.map((e) => e.category));
    expect(families.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// 3. dispositions
// ---------------------------------------------------------------------------

describe('dispositions', () => {
  it('gives every generated kind exactly one disposition', () => {
    const result = selectEvidenceLegacy(nzDefender, richProgramme());
    expect(result.dispositions).toHaveLength(result.all.length);
    const kinds = result.dispositions.map((d) => d.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const d of result.dispositions) {
      expect(Object.values(DISPOSITION), d.kind).toContain(d.disposition);
    }
  });

  it('marks the selected ones SELECTED, in order', () => {
    const result = selectEvidenceLegacy(nzDefender, richProgramme());
    const selected = result.dispositions.filter((d) => d.disposition === DISPOSITION.SELECTED);
    expect(selected.map((d) => d.kind).sort())
      .toEqual(result.selected.map((e) => e.kind).sort());
    for (const [i, e] of result.selected.entries()) {
      expect(selected.find((d) => d.kind === e.kind).order).toBe(i);
    }
  });

  it('marks internal-only intelligence INTERNAL_ONLY and never selects it', () => {
    const result = selectEvidenceLegacy(nzDefender, {
      college: college(),
      squad: squadOf(6, { position: 'D', prior_programme: 'Somewhere Else' }),
    });
    const internal = result.dispositions.filter((d) => d.disposition === DISPOSITION.INTERNAL_ONLY);
    for (const d of internal) {
      expect(result.selected.map((e) => e.kind)).not.toContain(d.kind);
    }
  });

  it('explains every non-selection', () => {
    const result = selectEvidenceLegacy(nzDefender, richProgramme());
    for (const d of result.dispositions) {
      if (d.disposition === DISPOSITION.SELECTED || d.disposition === DISPOSITION.AVAILABLE) continue;
      expect(d.reason, `${d.kind} (${d.disposition}) must say why`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. operator control
// ---------------------------------------------------------------------------

describe('operator selection', () => {
  const programme = richProgramme();

  it('honours a removal', () => {
    const engine = selectEvidence(nzDefender, programme);
    const keep = engine.selected.map((e) => e.kind).slice(1);
    const result = selectEvidence(nzDefender, programme, { prefer: keep });
    expect(result.selected.map((e) => e.kind)).toEqual(keep);
    expect(result.operatorSelected).toBe(true);
    // The engine's own answer is retained, so an analysis can later ask
    // whether operators improved on it.
    expect(result.engineSelected).toEqual(engine.selected.map((e) => e.kind));
  });

  it('honours a reorder within a role, and never across roles', () => {
    /**
     * Since G4 an operator reorders within the licensed set and roles are not
     * theirs to move: a congratulation cannot become the reason for writing
     * and a relevance claim cannot open cold, because both are properties of
     * the kind. `applyPrefer` re-buckets by the kind's own role and keeps the
     * operator's order inside each bucket.
     */
    const engine = selectEvidence(nzDefender, programme);
    const flipped = [...engine.selected.map((e) => e.kind)].reverse();
    const result = selectEvidence(nzDefender, programme, { prefer: flipped });
    expect(result.operatorSelected).toBe(true);
    for (const item of [...result.roles.hooks, ...result.roles.relevance]) {
      expect(item.role, item.kind).toBe(engine.roles.hooks.concat(engine.roles.relevance)
        .find((i) => i.kind === item.kind)?.role);
    }
    expect(result.roles.recognition.every((i) => i.role === 'RECOGNITION')).toBe(true);
  });

  it('honours a swap among the licensed claims', () => {
    const engine = selectEvidence(nzDefender, programme);
    const licensed = engine.selected.map((e) => e.kind);
    expect(licensed.length).toBeGreaterThan(1);
    const result = selectEvidence(nzDefender, programme, { prefer: [licensed[1]] });
    expect(result.selected.map((e) => e.kind)).toEqual([licensed[1]]);
  });

  it('ignores a kind the engine did not generate, and says so', () => {
    const result = selectEvidence(nzDefender, programme, {
      prefer: ['ACADEMIC_FIT', 'NOT_A_REAL_KIND'],
    });
    expect(result.selected.map((e) => e.kind)).toEqual(['ACADEMIC_FIT']);
    expect(result.unavailableRequests).toContain('NOT_A_REAL_KIND');
  });

  it('cannot reach internal-only intelligence', () => {
    const result = selectEvidenceLegacy(nzDefender, {
      college: college(),
      squad: squadOf(6, { position: 'D', prior_programme: 'Somewhere Else' }),
    }, { prefer: ['TRANSFER_BEHAVIOUR', 'POSITION_GROUP_SIZE'] });
    expect(result.selected).toHaveLength(0);
    expect(result.unavailableRequests).toEqual(['TRANSFER_BEHAVIOUR', 'POSITION_GROUP_SIZE']);
  });

  it('cannot reach evidence suppressed for staleness', () => {
    // A roster old enough for CURRENT claims to be suppressed outright. The
    // operator cannot select what was never generated — which is why freshness
    // is applied at generation and not at rendering.
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    const result = selectEvidenceLegacy(nzDefender, {
      college: college(),
      squad: [row({
        updated_date: old, player_name: 'Kiwi Now',
        country: 'New Zealand', nationality: 'International',
      })],
    }, { prefer: ['CURRENT_SAME_COUNTRY'] });
    expect(result.selected.map((e) => e.kind)).not.toContain('CURRENT_SAME_COUNTRY');
    expect(result.unavailableRequests).toContain('CURRENT_SAME_COUNTRY');
  });

  it('still respects the count ceiling', () => {
    const result = selectEvidence(nzDefender, programme, {
      prefer: selectEvidence(nzDefender, programme).all.map((e) => e.kind),
    });
    expect(result.selected.length).toBeLessThanOrEqual(MAX_EMAIL_EVIDENCE);
  });

  it('drops a duplicate request rather than repeating a sentence', () => {
    const result = selectEvidence(nzDefender, programme, {
      prefer: ['ACADEMIC_FIT', 'ACADEMIC_FIT'],
    });
    expect(result.selected.map((e) => e.kind)).toEqual(['ACADEMIC_FIT']);
  });
});

// ---------------------------------------------------------------------------
// 5. structures
// ---------------------------------------------------------------------------

describe('structure eligibility', () => {
  it('defines two flows, each with blocks and a predicate', () => {
    // Two, not five. The old set was distinguished by which evidence opened
    // the email; once presentation decided that most kinds cannot open one,
    // three of them collapsed onto the same shape.
    expect(FLOW_KEYS).toEqual(['RELATIONSHIP_FIRST', 'PLAYER_FIRST']);
    for (const key of FLOW_KEYS) {
      expect(FLOWS[key].blocks.length, key).toBeGreaterThan(5);
      expect(typeof FLOWS[key].eligible, key).toBe('function');
    }
  });

  it('cannot run the international structure without international evidence', () => {
    const result = selectEvidence(
      { ...nzDefender, nationality: 'USA' },
      richProgramme(),
    );
    expect(result.structure.eligible).not.toContain('RELATIONSHIP_FIRST');
    expect(result.structure.key).not.toBe('RELATIONSHIP_FIRST');
  });

  it('offers the relationship flow only when a country link was selected', () => {
    // richProgramme carries NZ history, so both flows are available.
    const withLink = selectEvidence(nzDefender, richProgramme());
    expect(withLink.structure.eligible).toEqual(['RELATIONSHIP_FIRST', 'PLAYER_FIRST']);

    // A domestic athlete has no country link at any programme.
    const without = selectEvidence({ ...nzDefender, nationality: 'USA' }, richProgramme());
    expect(without.structure.eligible).toEqual(['PLAYER_FIRST']);
  });

  it('cannot run the roster structure on a programme with no roster', () => {
    const result = selectEvidenceLegacy(nzDefender, {
      college: college({ conference_champion_2025: 1, conference_champion_name: 'ACC' }),
    });
    expect(result.structure.eligible).toEqual(['PLAYER_FIRST']);
  });

  it('always leaves the fallback eligible', () => {
    for (const programme of [{ college: college() }, richProgramme()]) {
      expect(selectEvidence(nzDefender, programme).structure.eligible).toContain('PLAYER_FIRST');
    }
  });

  it('refuses an operator structure the evidence does not support', () => {
    const result = selectEvidence(
      { ...nzDefender, nationality: 'USA' },
      richProgramme(),
      { preferStructure: 'RELATIONSHIP_FIRST' },
    );
    expect(result.structure.key).not.toBe('RELATIONSHIP_FIRST');
    expect(result.structure.source).toBe('ENGINE');
    expect(result.structure.refusedRequest.key).toBe('RELATIONSHIP_FIRST');
  });

  it('refuses an unknown structure rather than throwing', () => {
    const result = selectEvidence(nzDefender, richProgramme(), { preferStructure: 'NONSENSE' });
    expect(FLOW_KEYS).toContain(result.structure.key);
    expect(result.structure.refusedRequest.reason).toMatch(/unknown/i);
  });

  it('honours an eligible operator structure and records that a human chose it', () => {
    const engine = selectEvidence(nzDefender, richProgramme());
    const other = engine.structure.eligible.find((k) => k !== engine.structure.key);
    expect(other).toBeTruthy();
    const result = selectEvidence(nzDefender, richProgramme(), { preferStructure: other });
    expect(result.structure.key).toBe(other);
    expect(result.structure.source).toBe('OPERATOR');
  });

  /**
   * A structure cannot become a route to evidence selection could not reach.
   *
   * The order matters: eligibility is evaluated against the SELECTION, after
   * suppression and the confidence floors have run. If it were evaluated
   * against everything generated, choosing INTERNATIONAL_CONNECTION would
   * open an email on a relationship that had been suppressed as stale.
   */
  it('evaluates eligibility against what survived selection, not what was generated', () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    const result = selectEvidenceLegacy(nzDefender, {
      college: college(),
      squad: [row({
        updated_date: old, player_name: 'Kiwi Now',
        country: 'New Zealand', nationality: 'International',
      })],
    }, { preferStructure: 'RELATIONSHIP_FIRST' });
    expect(result.structure.key).not.toBe('RELATIONSHIP_FIRST');
  });

  it('re-evaluates eligibility after an operator changes the evidence', () => {
    const programme = richProgramme();
    const engine = selectEvidence(nzDefender, programme);
    expect(engine.structure.key).toBe('RELATIONSHIP_FIRST');
    // Drop the international lead: the structure that opened on it must stop
    // being eligible, rather than opening on whatever is now first.
    const withoutInternational = engine.selected
      .filter((e) => e.category !== 'international').map((e) => e.kind);
    const result = selectEvidence(nzDefender, programme, { prefer: withoutInternational });
    expect(result.structure.eligible).not.toContain('RELATIONSHIP_FIRST');
  });
});

// ---------------------------------------------------------------------------
// 6. positions
// ---------------------------------------------------------------------------

describe('the roster structure never invents a sub-position', () => {
  it.each(['CB', 'LB', 'RB', 'CDM', 'Winger', 'Striker', 'Full Back'])(
    'collapses %s to a canonical position', (raw) => {
      expect([...POSITIONS, 'UNKNOWN']).toContain(canonicalPosition(raw));
    },
  );

  it('says only the canonical word in a roster-led email', () => {
    const result = selectEvidence({ ...nzDefender, position: 'CB' }, richProgramme());
    const text = result.sentences.map((s) => s.text).join(' ');
    for (const banned of ['centre back', 'center back', 'CB', 'left back', 'winger', 'striker']) {
      expect(text.toLowerCase()).not.toContain(banned.toLowerCase());
    }
    expect(result.athlete.position).toBe('DEFENSE');
  });
});

// ---------------------------------------------------------------------------
// 7. logging
// ---------------------------------------------------------------------------

describe('multi-evidence logging', () => {
  it('records the ordered set as a first-class value', () => {
    const result = selectEvidenceLegacy(nzDefender, richProgramme());
    const payload = evidenceLogPayload(result);
    expect(payload.selected_kinds).toBe(result.selected.map((e) => e.kind).join(','));
    expect(payload.evidence_count).toBe(result.selected.length);
    expect(payload.payload.selectedDetail.map((d) => d.kind))
      .toEqual(result.selected.map((e) => e.kind));
    for (const [i, d] of payload.payload.selectedDetail.entries()) expect(d.order).toBe(i);
  });

  it('keeps primary and secondary as convenience columns', () => {
    const payload = evidenceLogPayload(selectEvidence(nzDefender, richProgramme()));
    expect(payload.primary_kind).toBe(payload.payload.selectedDetail[0].kind);
    expect(payload.secondary_kind).toBe(payload.payload.selectedDetail[1].kind);
  });

  it('records where in the email each claim went', () => {
    const payload = evidenceLogPayload(selectEvidence(nzDefender, richProgramme()));
    // Selected is not rendered since G4: the licence permits up to three body
    // claims and composition carries at most two, so a selected item with no
    // slot is a deliberate hold rather than a lost record.
    const shown = payload.payload.selectedDetail.filter((d) => d.displayed);
    expect(shown.length).toBeGreaterThan(0);
    for (const d of shown) expect(d.slot).toBeTruthy();
  });

  /**
   * Per-item render status, which is the point of the whole change.
   *
   * An operator who keeps the opening sentence and deletes the supporting
   * paragraph has delivered one claim of three. Logging three would credit
   * every angle with whatever reply the email earned.
   */
  it('records which items survived into the body, item by item', () => {
    const result = selectEvidenceLegacy(nzDefender, richProgramme());
    const kept = new Set([result.selected[0].kind]);
    const payload = evidenceLogPayload(result, { renderedKinds: kept });

    expect(payload.rendered_count).toBe(1);
    expect(payload.payload.selectedDetail[0].rendered).toBe(true);
    expect(payload.payload.selectedDetail[1].rendered).toBe(false);
  });

  it('distinguishes "nobody checked" from "nothing survived"', () => {
    const payload = evidenceLogPayload(selectEvidence(nzDefender, richProgramme()));
    expect(payload.rendered_count).toBeNull();
    for (const d of payload.payload.selectedDetail) expect(d.rendered).toBeNull();

    const none = evidenceLogPayload(selectEvidence(nzDefender, richProgramme()), {
      renderedKinds: new Set(),
    });
    expect(none.rendered_count).toBe(0);
    for (const d of none.payload.selectedDetail) expect(d.rendered).toBe(false);
  });

  it('records who chose the structure', () => {
    const engine = evidenceLogPayload(selectEvidence(nzDefender, richProgramme()));
    expect(engine.structure_source).toBe('ENGINE');

    const eligible = selectEvidence(nzDefender, richProgramme()).structure.eligible;
    const other = eligible.find((k) => k !== eligible[0]);
    const chosen = evidenceLogPayload(
      selectEvidence(nzDefender, richProgramme(), { preferStructure: other }),
    );
    expect(chosen.structure_source).toBe('OPERATOR');
  });

  it('carries the dispositions and the reasons into the payload', () => {
    const payload = evidenceLogPayload(selectEvidence(nzDefender, richProgramme()));
    expect(payload.payload.dispositions.length).toBeGreaterThan(0);
    expect(payload.payload).toHaveProperty('engineSelected');
    // H7 stopped logging the legacy selector's parallel account entirely.
    expect(payload.payload).not.toHaveProperty('legacy_belowThreshold');
    // The logged dispositions are the OUTBOUND selector's, so every kind the
    // email carries appears as SELECTED with an order rather than by absence.
    const sent = payload.payload.dispositions.filter((d) => d.disposition === 'SELECTED');
    expect(sent.map((d) => d.kind)).toEqual(payload.selected_kinds.split(','));
  });
});

// ---------------------------------------------------------------------------
// 8. one programme's picture is its own
// ---------------------------------------------------------------------------

describe('a bulk run keeps each programme separate', () => {
  it('gives two programmes their own evidence, structure and placement', () => {
    const international = selectEvidence(nzDefender, {
      college: college({ name: 'Alpha' }),
      history: [row({ season: '2022', country: 'New Zealand', player_name: 'Kiwi' })],
    });
    const academic = selectEvidence(nzDefender, {
      college: college({ name: 'Beta', notable_majors: ['Business'] }),
    });

    expect(international.structure.key).toBe('RELATIONSHIP_FIRST');
    expect(academic.structure.key).toBe('PLAYER_FIRST');
    expect(international.selected.map((e) => e.kind))
      .not.toEqual(academic.selected.map((e) => e.kind));
    expect(international.composition.template)
      .not.toBe(academic.composition.template);
  });

  it('does not leak one programme\'s operator override into another', () => {
    const programme = { college: college({ notable_majors: ['Business'] }) };
    const overridden = selectEvidence(nzDefender, programme, { prefer: [] });
    const plain = selectEvidence(nzDefender, programme);
    // An empty preference is not a selection — the engine's own ranking stands
    // rather than an empty email being sent.
    expect(overridden.operatorSelected).toBe(false);
    expect(overridden.selected.map((e) => e.kind)).toEqual(plain.selected.map((e) => e.kind));
  });
});

// ---------------------------------------------------------------------------
// 9. priorities are unchanged
// ---------------------------------------------------------------------------

/**
 * The experimental guarantee.
 *
 * Multi-evidence changed how far down the ranking we read. It must not have
 * changed the ranking itself, or an email with three items would contain a
 * different first two from the email of two it replaced — and every row logged
 * before today would stop being comparable to every row logged after.
 */
describe('the ranking itself did not move', () => {
  it('scores each kind exactly as before', () => {
    const expected = {
      HISTORICAL_SAME_COUNTRY: 102,
      CURRENT_SAME_COUNTRY: 96,
      HISTORICAL_SAME_REGION: 84,
      ACADEMIC_FIT: 88,
      CONFERENCE_TITLE: 86,
      POSITION_GRADUATION: 84,
      POSTSEASON_RESULT: 80,
      COACH_CONTEXT: 45,
    };
    for (const [kind, priority] of Object.entries(expected)) {
      expect(priorityOf(ev(kind, undefined)), kind).toBe(priority);
    }
  });

  it('puts the same evidence first as a two-item selection would', () => {
    const programme = richProgramme();
    const generated = selectEvidence(nzDefender, programme).all;
    const four = selectFrom(generated, { maxEmail: 4 });
    const two = selectFrom(generated, { maxEmail: 2 });
    expect(four.selected.slice(0, 2).map((e) => e.kind))
      .toEqual(two.selected.map((e) => e.kind));
  });
});

// ---------------------------------------------------------------------------
// 10. what may open an email
// ---------------------------------------------------------------------------

/**
 * Facts good enough to pass each licensed kind's outreach qualification.
 *
 * Roles are only assigned to objects that could actually be SENT, so a kind
 * asked for its role with empty data reports none — which would make every
 * assertion below vacuously true. Anything not listed here is unlicensed, and
 * its absence is the point.
 */
const FACTS = {
  COACH_ARRIVAL_SAME_COUNTRY: { coach: 'Ali Simmons', country: 'New Zealand', count: 1, seasons: ['2025'] },
  ARRIVAL_SAME_COUNTRY_POSITION: { country: 'New Zealand', position: 'DEFENSE', count: 2, seasons: ['2023'] },
  HISTORICAL_SAME_COUNTRY: { country: 'New Zealand', count: 2, names: ['A', 'B'], seasons: ['2022'] },
  CURRENT_SAME_COUNTRY: { country: 'New Zealand', count: 1, names: ['A'] },
  ARRIVAL_SAME_REGION_POSITION: { countries: ['Australia'], position: 'DEFENSE', count: 1, seasons: ['2024'], athleteCountry: 'New Zealand' },
  HISTORICAL_SAME_REGION: { countries: ['Australia'], athleteCountry: 'New Zealand', count: 1, names: ['X'] },
  POSITION_GRADUATION: { position: 'DEFENSE', count: 3, names: ['A', 'B', 'C'], classYear: 2027 },
  ACADEMIC_FIT: { stated: 'exercise science', major: 'Kinesiology' },
  CONFERENCE_TITLE: { conference: 'ACC' },
  POSTSEASON_RESULT: { round: 'semi' },
};

/**
 * WHAT MAY OPEN AN EMAIL: role === HOOK, and nothing else.
 *
 * This block used to ask `canOpenCold`, a predicate over a three-valued
 * `leadSuitability` property carried by all 26 kinds. It agreed with the roles
 * for every kind — and had not been consulted since G4, because production
 * supplies roles and the predicate only ran on the fallback branch. H4 deleted
 * it. The properties it defended were real, so they are asked of the owner.
 *
 * The distinction itself is unchanged and is the reason any of this exists:
 * strong evidence and a good opening sentence are not the same judgement.
 */
describe('what may open an email cold', () => {
  /** The roles an object of this kind would be given, with facts good enough to pass. */
  const roleOf = (kind) => {
    const r = outreachEvidenceFor({ all: [ev(kind, 80, { data: FACTS[kind] ?? {} })] });
    return [...r.hooks, ...r.relevance, ...r.recognition][0]?.role ?? null;
  };

  it('lets only the country and region relationships open one', () => {
    const openers = Object.keys(EVIDENCE_KINDS).filter((k) => roleOf(k) === ROLES.HOOK);
    expect(openers.sort()).toEqual([
      // The three recruiting-history kinds join the roster-derived ones: an
      // arrival from the athlete's country is the same KIND of reason to be
      // writing to this coach, observed one level more specifically.
      'ARRIVAL_SAME_COUNTRY_POSITION', 'ARRIVAL_SAME_REGION_POSITION',
      'COACH_ARRIVAL_SAME_COUNTRY',
      'CURRENT_SAME_COUNTRY', 'HISTORICAL_SAME_COUNTRY', 'HISTORICAL_SAME_REGION',
    ]);
  });

  it('never opens on a kind whose reasoning names the athlete', () => {
    // The tell that started this: "I noticed you've got three defenders
    // graduating, so I thought Ryan could be worth putting on your radar" as
    // the first line to someone who does not know who Ryan is.
    for (const kind of ['POSITION_GRADUATION', 'POSITION_GROUP_SCARCITY', 'COACH_CONTEXT']) {
      expect(roleOf(kind), kind).not.toBe(ROLES.HOOK);
    }
  });

  it('never opens on a congratulation', () => {
    // "Congrats on winning the ACC last year" is a fine thing to say and a
    // strange thing to say first, to a stranger, before saying who you are.
    for (const kind of ['CONFERENCE_TITLE', 'POSTSEASON_RESULT']) {
      expect(roleOf(kind), kind).toBe(ROLES.RECOGNITION);
    }
  });

  it('gives every kind that may be emailed exactly one role, and the rest none', () => {
    // Replaces an assertion that every kind carried a valid `leadSuitability`
    // value. A licence without a role is a claim with no job in the email.
    for (const kind of Object.keys(EVIDENCE_KINDS)) {
      const licensed = permissionsFor(kind).OUTREACH !== PERMISSION.DENIED;
      const role = roleOf(kind);
      if (licensed) expect(Object.values(ROLES), kind).toContain(role);
      else expect(role, kind).toBeNull();
    }
  });
});

describe('a selection with no roles cannot manufacture a relationship', () => {
  /**
   * The fallback H4 removed, asserted as behaviour rather than as absence.
   *
   * `eligibleFlows` used to re-derive an opener from kind metadata when a
   * selection arrived without roles. It never fired in production — roles have
   * been supplied since G4 — but what it would have done is worse than
   * nothing: manufacture RELATIONSHIP_FIRST for a caller that had not decided
   * any claim could open. Missing role data is missing data, not a hook.
   */
  const leadable = [ev('HISTORICAL_SAME_COUNTRY', 90, { data: { country: 'New Zealand', count: 2, names: ['A', 'B'] } })];

  it('gets PLAYER_FIRST when roles are absent', () => {
    expect(eligibleFlows({ selected: leadable })).toEqual(['PLAYER_FIRST']);
  });

  it('gets PLAYER_FIRST when roles are empty, null or malformed', () => {
    for (const roles of [
      { hooks: [], relevance: [], recognition: [] },
      { relevance: [], recognition: [] },
      null, undefined, {},
    ]) {
      expect(eligibleFlows({ selected: leadable, roles }), JSON.stringify(roles))
        .toEqual(['PLAYER_FIRST']);
    }
  });

  it('does not throw on a selection object with nothing in it at all', () => {
    // Graceful degradation is the composer's established contract: a malformed
    // selection costs the email its opener, not the send.
    expect(eligibleFlows({})).toEqual(['PLAYER_FIRST']);
    expect(eligibleFlows(null)).toEqual(['PLAYER_FIRST']);
  });

  it('gets RELATIONSHIP_FIRST as soon as one hook is present', () => {
    const roles = outreachEvidenceFor({ all: leadable });
    expect(roles.hooks).toHaveLength(1);
    expect(eligibleFlows({ selected: leadable, roles })).toEqual(['RELATIONSHIP_FIRST', 'PLAYER_FIRST']);
  });

  it('does not change class when there is more than one hook', () => {
    // Two reasons to be writing is still one email, in the same shape.
    const two = [
      ...leadable,
      ev('CURRENT_SAME_COUNTRY', 80, { data: { country: 'New Zealand', count: 1, names: ['C'] } }),
    ];
    const roles = outreachEvidenceFor({ all: two });
    expect(eligibleFlows({ selected: two, roles })).toEqual(['RELATIONSHIP_FIRST', 'PLAYER_FIRST']);
  });
});

describe('presentation does not reach back into selection', () => {
  it('leaves selection order alone', () => {
    // ACADEMIC_FIT outranks POSITION_GRADUATION on priority and cannot open an
    // email. It must still be selected first — its role decides where it goes,
    // not whether it was chosen.
    const selection = selectFrom([
      ev('ACADEMIC_FIT', 78, { data: { major: 'Business' } }),
      ev('POSITION_GRADUATION', 76),
    ]);
    expect(selection.selected.map((e) => e.kind)).toEqual(['ACADEMIC_FIT', 'POSITION_GRADUATION']);
  });
});

/**
 * PLACEMENT, WHICH IS SEPARATE FROM RANKING.
 *
 * These asked `planPlacement`, deleted in H4: a second placement function that
 * inferred a hook from `leadSuitability` and a congratulation from a registry
 * flag. It had no caller after G4. The block it produced is now produced by
 * `planFromRoles`, from roles that were decided under a licence and a
 * qualification rule, so the same properties are asked of that.
 *
 * Three of the old assertions are not migrated, and deliberately:
 *
 *   "lifts a lower-ranked NATURAL_LEAD into the hook" and "puts a contextual
 *   item in front of a SUPPORT_ONLY one" described `leadWithContextual`, a
 *   presentation reorder that existed because selection order and opening
 *   quality were decided by different properties. Roles decide both now: a
 *   HOOK is a hook wherever it ranked, and there is nothing left to reorder.
 *
 *   "holds back what will not fit" described the gathered-slot capacity of two
 *   or three. Composition renders one body claim beside the hook; the cap it
 *   enforces is asserted in outreachEvidence.test.js, where it lives.
 */
describe('placement, which is separate from ranking', () => {
  /** Roles from real objects, then the plan — the path production takes. */
  const plan = (kinds, flow) => {
    const objects = kinds.map((k) => ev(k, 80, { data: FACTS[k] ?? {} }));
    const roles = outreachEvidenceFor({ all: objects });
    return planFromRoles(roles, new Map(objects.map((e) => [e.kind, e])), flow);
  };

  it('opens on the hook wherever it ranked', () => {
    // The Sacred Heart case: the roster count ranks first and the region
    // connection second, and the email opens on the connection.
    const p = plan(['POSITION_GRADUATION', 'HISTORICAL_SAME_REGION'], 'RELATIONSHIP_FIRST');
    expect(p.hook.kind).toBe('HISTORICAL_SAME_REGION');
    expect(p.relevance.map((e) => e.kind)).toEqual(['POSITION_GRADUATION']);
  });

  it('takes the highest-ranked hook when there is more than one', () => {
    const p = plan(['HISTORICAL_SAME_COUNTRY', 'CURRENT_SAME_COUNTRY'], 'RELATIONSHIP_FIRST');
    expect(p.hook.kind).toBe('HISTORICAL_SAME_COUNTRY');
  });

  it('has no hook in the player-first flow, and does not waste the claim', () => {
    // The hook still has something to say; it says it after the introduction.
    const p = plan(['HISTORICAL_SAME_COUNTRY', 'POSITION_GRADUATION'], 'PLAYER_FIRST');
    expect(p.hook).toBeNull();
    expect(p.relevance.map((e) => e.kind)).toEqual(['HISTORICAL_SAME_COUNTRY']);
  });

  it('pulls a congratulation out of the reasoning, wherever it ranked', () => {
    const p = plan(['CONFERENCE_TITLE', 'POSITION_GRADUATION'], 'PLAYER_FIRST');
    expect(p.recognition.map((e) => e.kind)).toEqual(['CONFERENCE_TITLE']);
    expect(p.relevance.map((e) => e.kind)).toEqual(['POSITION_GRADUATION']);
    // ...and never as the hook, however highly it ranked.
    expect(plan(['CONFERENCE_TITLE'], 'RELATIONSHIP_FIRST').hook).toBeNull();
  });

  it('never shows two congratulations', () => {
    // Selection already prevents it — both share a dedupe group — but two
    // congratulations in one email is bad enough to refuse here as well.
    const p = plan(['CONFERENCE_TITLE', 'POSTSEASON_RESULT'], 'PLAYER_FIRST');
    expect(p.recognition).toHaveLength(1);
  });

  it('keeps role order inside the body', () => {
    const p = plan(['POSITION_GRADUATION', 'ACADEMIC_FIT'], 'PLAYER_FIRST');
    expect(p.relevance.map((e) => e.kind)).toEqual(['POSITION_GRADUATION']);
    expect(p.held.map((e) => e.kind)).toEqual(['ACADEMIC_FIT']);
  });
});

