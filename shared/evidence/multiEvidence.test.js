import { describe, it, expect } from 'vitest';
import {
  selectEvidence, defineEvidence, evidenceLogPayload,
  MAX_EMAIL_EVIDENCE, MAX_PER_FAMILY, SLOT_FLOORS,
  FLOWS, FLOW_KEYS, canOpenCold, planPlacement, LEAD_SUITABILITY,
} from './index.js';
import { selectFrom, priorityOf, DISPOSITION } from './select.js';
import { canonicalPosition, POSITIONS } from '../positions.js';
import { EVIDENCE_KINDS } from './kinds.js';

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
const ev = (kind, strength, o = {}) => defineEvidence(kind, {
  strength, confidence: 'HIGH', source: 'test', ...o,
});

// ---------------------------------------------------------------------------
// 1. how many pieces
// ---------------------------------------------------------------------------

describe('how much evidence an email carries', () => {
  it('uses more than two when a programme genuinely supports it', () => {
    const result = selectEvidence(nzDefender, richProgramme());
    expect(result.selected.length).toBeGreaterThan(2);
    expect(result.selected.length).toBeLessThanOrEqual(MAX_EMAIL_EVIDENCE);
  });

  it('never exceeds the ceiling, however much is known', () => {
    const result = selectEvidence(nzDefender, richProgramme());
    expect(result.selected.length).toBeLessThanOrEqual(MAX_EMAIL_EVIDENCE);
    // The ceiling has to be BINDING in this fixture or the test above proves
    // nothing about the cap — only that this programme happened to be thin.
    expect(result.ranked.length).toBeGreaterThan(MAX_EMAIL_EVIDENCE);
  });

  it('uses one when only one thing is worth saying', () => {
    const result = selectEvidence(nzDefender, {
      college: college({ conference_champion_2025: 1, conference_champion_name: 'ACC' }),
    });
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].kind).toBe('CONFERENCE_TITLE');
  });

  it('uses none when there is nothing to say, and still produces a structure', () => {
    const result = selectEvidence(nzDefender, { college: college() });
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
      ev('SQUAD_GRADUATION', 48),          // priority 56 — fine as second
      ev('COACH_CONTEXT', 45, { confidence: 'MEDIUM' }),  // priority 45 — never third
      ev('PROGRAM_MOMENTUM', 40, { confidence: 'MEDIUM' }),
    ].filter(Boolean));

    expect(selection.selected.map((e) => e.kind)).toEqual(['CONFERENCE_TITLE', 'SQUAD_GRADUATION']);
    expect(selection.belowThreshold.map((b) => b.kind)).toContain('COACH_CONTEXT');
  });

  it('never adds a weak coach-tenure signal behind stronger evidence', () => {
    const selection = selectFrom([
      ev('HISTORICAL_SAME_COUNTRY', 88, { data: { country: 'New Zealand', count: 1, names: [] } }),
      ev('POSITION_GRADUATION', 76),
      ev('COACH_CONTEXT', 45, { confidence: 'MEDIUM' }),
    ]);
    expect(selection.selected.map((e) => e.kind)).not.toContain('COACH_CONTEXT');
    // ...and it CAN lead, when it is all we have. A rule that made a kind
    // unusable everywhere would be a different rule from the one intended.
    const alone = selectFrom([ev('COACH_CONTEXT', 45, { confidence: 'MEDIUM' })]);
    expect(alone.selected.map((e) => e.kind)).toEqual(['COACH_CONTEXT']);
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
    const result = selectEvidence(nzDefender, {
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
    const roster = selection.selected.filter((e) => e.category === 'roster');
    expect(roster.length).toBe(MAX_PER_FAMILY);
    // The one that loses is the weakest by PRIORITY, not by raw strength:
    // scarcity is a SIGNAL and forgoes the fact bonus, which puts it below a
    // squad-graduation count it outscores on strength alone.
    expect(selection.suppressed.map((s) => s.kind)).toContain('POSITION_GROUP_SCARCITY');
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
    const result = selectEvidence(nzDefender, richProgramme());
    const families = new Set(result.selected.map((e) => e.category));
    expect(families.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// 3. dispositions
// ---------------------------------------------------------------------------

describe('dispositions', () => {
  it('gives every generated kind exactly one disposition', () => {
    const result = selectEvidence(nzDefender, richProgramme());
    expect(result.dispositions).toHaveLength(result.all.length);
    const kinds = result.dispositions.map((d) => d.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const d of result.dispositions) {
      expect(Object.values(DISPOSITION), d.kind).toContain(d.disposition);
    }
  });

  it('marks the selected ones SELECTED, in order', () => {
    const result = selectEvidence(nzDefender, richProgramme());
    const selected = result.dispositions.filter((d) => d.disposition === DISPOSITION.SELECTED);
    expect(selected.map((d) => d.kind).sort())
      .toEqual(result.selected.map((e) => e.kind).sort());
    for (const [i, e] of result.selected.entries()) {
      expect(selected.find((d) => d.kind === e.kind).order).toBe(i);
    }
  });

  it('marks internal-only intelligence INTERNAL_ONLY and never selects it', () => {
    const result = selectEvidence(nzDefender, {
      college: college(),
      squad: squadOf(6, { position: 'D', prior_programme: 'Somewhere Else' }),
    });
    const internal = result.dispositions.filter((d) => d.disposition === DISPOSITION.INTERNAL_ONLY);
    for (const d of internal) {
      expect(result.selected.map((e) => e.kind)).not.toContain(d.kind);
    }
  });

  it('explains every non-selection', () => {
    const result = selectEvidence(nzDefender, richProgramme());
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

  it('honours a reorder, and the reorder changes where a claim sits', () => {
    const engine = selectEvidence(nzDefender, programme);
    const flipped = [...engine.selected.map((e) => e.kind)].reverse();
    const result = selectEvidence(nzDefender, programme, { prefer: flipped });
    expect(result.selected.map((e) => e.kind)).toEqual(flipped);

    // Reordering changes the ORDER within the relevance paragraph. It does
    // not move a CONTEXTUAL item into the hook: what may open an email is a
    // presentation property, and an operator reordering a list is not a
    // statement that a roster count now reads well to a stranger.
    const relevance = (r) => r.composition.placement
      .filter((p) => p.slot === 'RELEVANCE').map((p) => p.kind);
    expect(relevance(result)).not.toEqual(relevance(engine));
  });

  it('honours a swap from the available list', () => {
    const engine = selectEvidence(nzDefender, programme);
    const spare = engine.ranked.map((e) => e.kind)
      .find((k) => !engine.selected.some((e) => e.kind === k));
    expect(spare).toBeTruthy();
    const result = selectEvidence(nzDefender, programme, { prefer: [spare] });
    expect(result.selected.map((e) => e.kind)).toEqual([spare]);
  });

  it('ignores a kind the engine did not generate, and says so', () => {
    const result = selectEvidence(nzDefender, programme, {
      prefer: ['ACADEMIC_FIT', 'NOT_A_REAL_KIND'],
    });
    expect(result.selected.map((e) => e.kind)).toEqual(['ACADEMIC_FIT']);
    expect(result.unavailableRequests).toContain('NOT_A_REAL_KIND');
  });

  it('cannot reach internal-only intelligence', () => {
    const result = selectEvidence(nzDefender, {
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
    const result = selectEvidence(nzDefender, {
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
      prefer: selectEvidence(nzDefender, programme).ranked.map((e) => e.kind),
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
    const result = selectEvidence(nzDefender, {
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
    const result = selectEvidence(nzDefender, {
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
    const result = selectEvidence(nzDefender, richProgramme());
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
    for (const d of payload.payload.selectedDetail) expect(d.slot).toBeTruthy();
  });

  /**
   * Per-item render status, which is the point of the whole change.
   *
   * An operator who keeps the opening sentence and deletes the supporting
   * paragraph has delivered one claim of three. Logging three would credit
   * every angle with whatever reply the email earned.
   */
  it('records which items survived into the body, item by item', () => {
    const result = selectEvidence(nzDefender, richProgramme());
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
    expect(payload.payload).toHaveProperty('belowThreshold');
    expect(payload.payload).toHaveProperty('engineSelected');
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
    const four = selectFrom(selectEvidence(nzDefender, programme).usable, { maxEmail: 4 });
    const two = selectFrom(selectEvidence(nzDefender, programme).usable, { maxEmail: 2 });
    expect(four.selected.slice(0, 2).map((e) => e.kind))
      .toEqual(two.selected.map((e) => e.kind));
  });
});

// ---------------------------------------------------------------------------
// 10. what may open an email
// ---------------------------------------------------------------------------

/**
 * `leadSuitability` — strong evidence and a good opening sentence are not the
 * same judgement.
 *
 * This replaced a `canLead: false` flag that existed only for ACADEMIC_FIT and
 * worked by reordering the SELECTION. Reordering selection to fix a
 * presentation problem is what made the two concerns hard to separate; the
 * classification now sits beside the evidence and selection is left alone.
 */
describe('lead suitability decides what may open an email', () => {
  it('classifies every email-eligible kind', () => {
    for (const kind of Object.keys(EVIDENCE_KINDS)) {
      expect(Object.values(LEAD_SUITABILITY), kind)
        .toContain(EVIDENCE_KINDS[kind].leadSuitability);
    }
  });

  it('lets only the country relationships open an email cold', () => {
    const openers = Object.keys(EVIDENCE_KINDS)
      .filter((k) => canOpenCold({ kind: k }));
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
      expect(canOpenCold({ kind }), kind).toBe(false);
    }
  });

  it('leaves selection order alone', () => {
    // ACADEMIC_FIT outranks POSITION_GRADUATION on priority and is SUPPORT_ONLY
    // for presentation. It must still be selected first — presentation decides
    // where it goes, not whether it was chosen.
    const selection = selectFrom([
      ev('ACADEMIC_FIT', 78, { data: { major: 'Business' } }),
      ev('POSITION_GRADUATION', 76),
    ]);
    expect(selection.selected.map((e) => e.kind)).toEqual(['ACADEMIC_FIT', 'POSITION_GRADUATION']);
  });
});

describe('placement, which is separate from ranking', () => {
  const plan = (kinds, flow) => planPlacement(
    kinds.map((k) => ({ kind: k, tier: EVIDENCE_KINDS[k].tier })), flow,
  );

  it('lifts a lower-ranked NATURAL_LEAD into the hook', () => {
    // The Sacred Heart case: the roster count ranks first and the Australia
    // connection second, and the email should open on the connection.
    const p = plan(['POSITION_GRADUATION', 'HISTORICAL_SAME_REGION'], 'RELATIONSHIP_FIRST');
    expect(p.hook.kind).toBe('HISTORICAL_SAME_REGION');
    expect(p.relevance.map((e) => e.kind)).toEqual(['POSITION_GRADUATION']);
  });

  it('takes the highest-ranked lead when there is more than one', () => {
    const p = plan(['HISTORICAL_SAME_COUNTRY', 'CURRENT_SAME_COUNTRY'], 'RELATIONSHIP_FIRST');
    expect(p.hook.kind).toBe('HISTORICAL_SAME_COUNTRY');
  });

  it('has no hook in the player-first flow', () => {
    const p = plan(['HISTORICAL_SAME_COUNTRY', 'POSITION_GRADUATION'], 'PLAYER_FIRST');
    expect(p.hook).toBeNull();
    expect(p.relevance.map((e) => e.kind))
      .toEqual(['HISTORICAL_SAME_COUNTRY', 'POSITION_GRADUATION']);
  });

  it('pulls a congratulation out of the reasoning, wherever it ranked', () => {
    const p = plan(['CONFERENCE_TITLE', 'POSITION_GRADUATION'], 'PLAYER_FIRST');
    expect(p.recognition.map((e) => e.kind)).toEqual(['CONFERENCE_TITLE']);
    expect(p.relevance.map((e) => e.kind)).toEqual(['POSITION_GRADUATION']);
    // ...and never as the hook, however highly it ranked.
    const q = plan(['CONFERENCE_TITLE'], 'RELATIONSHIP_FIRST');
    expect(q.hook).toBeNull();
  });

  it('never shows two congratulations', () => {
    // Selection already prevents it — both share a dedupe group — but two
    // congratulations in one email is bad enough to refuse here as well.
    const p = plan(['CONFERENCE_TITLE', 'POSTSEASON_RESULT'], 'PLAYER_FIRST');
    expect(p.recognition).toHaveLength(1);
    expect(p.held.map((e) => e.kind)).toContain('POSTSEASON_RESULT');
  });

  it('holds back what will not fit rather than crowding the paragraph', () => {
    const p = plan(
      ['HISTORICAL_SAME_COUNTRY', 'POSITION_GRADUATION', 'ACADEMIC_FIT', 'SQUAD_GRADUATION'],
      'RELATIONSHIP_FIRST',
    );
    expect(p.hook.kind).toBe('HISTORICAL_SAME_COUNTRY');
    expect(p.relevance).toHaveLength(2);
    expect(p.held.map((e) => e.kind)).toEqual(['SQUAD_GRADUATION']);
  });

  it('keeps selection order inside each block', () => {
    const p = plan(['POSITION_GRADUATION', 'ACADEMIC_FIT'], 'PLAYER_FIRST');
    expect(p.relevance.map((e) => e.kind)).toEqual(['POSITION_GRADUATION', 'ACADEMIC_FIT']);
  });
});

describe('a SUPPORT_ONLY kind never carries the opening reasoning', () => {
  const plan = (kinds, flow) => planPlacement(
    kinds.map((k) => ({ kind: k, tier: EVIDENCE_KINDS[k].tier })), flow,
  );

  /**
   * At Elon the academic match outranked the graduating defender and opened
   * the relevance paragraph with "I noticed you offer Kinesiology, so it lines
   * up with what Rhys wants to study" — true, and not a reason to have written
   * to a soccer coach.
   */
  it('puts a contextual item in front of it', () => {
    const p = plan(['ACADEMIC_FIT', 'POSITION_GRADUATION'], 'PLAYER_FIRST');
    expect(p.relevance.map((e) => e.kind)).toEqual(['POSITION_GRADUATION', 'ACADEMIC_FIT']);
  });

  it('leaves a natural lead alone, which is better at it still', () => {
    const p = plan(['HISTORICAL_SAME_COUNTRY', 'POSITION_GRADUATION'], 'PLAYER_FIRST');
    expect(p.relevance.map((e) => e.kind))
      .toEqual(['HISTORICAL_SAME_COUNTRY', 'POSITION_GRADUATION']);
  });

  it('still leads with support evidence when it is all there is', () => {
    // Saying the one thing we know beats saying nothing.
    const p = plan(['ACADEMIC_FIT'], 'PLAYER_FIRST');
    expect(p.relevance.map((e) => e.kind)).toEqual(['ACADEMIC_FIT']);
  });

  it('does not reorder inside the hook flow, where the hook carries it', () => {
    const p = plan(['ACADEMIC_FIT', 'HISTORICAL_SAME_COUNTRY', 'POSITION_GRADUATION'],
      'RELATIONSHIP_FIRST');
    expect(p.hook.kind).toBe('HISTORICAL_SAME_COUNTRY');
    expect(p.relevance.map((e) => e.kind)).toEqual(['ACADEMIC_FIT', 'POSITION_GRADUATION']);
  });
});
