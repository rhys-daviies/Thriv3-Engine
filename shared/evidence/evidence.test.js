import { describe, it, expect } from 'vitest';
import {
  selectEvidence, generateEvidence, buildProgrammeContext, normaliseEvidenceAthlete,
  factParts, signalParts, renderEvidence, EvidenceRenderError,
  EVIDENCE_KINDS, EVIDENCE_KIND_NAMES, defineEvidence, TIERS, evidenceParagraph, MAX_EMAIL_EVIDENCE,
  evidenceLogPayload, regionFor,
} from './index.js';
import { RENDERABLE_KINDS } from './render.js';
import { selectFrom, priorityOf } from './select.js';

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const nzDefender = {
  full_name: 'Rhys Davies',
  position: 'Defender',
  nationality: 'New Zealand',
  recruiting_class_year: 2027,
  sport: 'mens-soccer',
};

/**
 * A scrape stamp a day old, so fixtures exercise the CURRENT freshness path.
 *
 * Every real `roster_players` row carries `updated_date`, and the freshness
 * policy reads absence as UNKNOWN and downgrades — deliberately, because the
 * reassuring reading of missing provenance is what puts unverified claims in
 * front of people. Fixtures therefore have to carry it too, or they are
 * testing the degraded path by accident.
 */
const RECENT = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

/** A roster row, defaulting to the shape roster_players actually produces. */
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

// ---------------------------------------------------------------------------

describe('registry integrity', () => {
  it('gives every kind a tier, category, dedupe group and confidence floor', () => {
    for (const [kind, spec] of Object.entries(EVIDENCE_KINDS)) {
      expect(Object.values(TIERS), kind).toContain(spec.tier);
      expect(spec.category, kind).toBeTruthy();
      expect(spec.dedupeGroup, kind).toBeTruthy();
      expect(spec.minConfidence, kind).toBeTruthy();
    }
  });

  it('has copy for every email-eligible kind', () => {
    for (const kind of EVIDENCE_KIND_NAMES) {
      if (EVIDENCE_KINDS[kind].emailEligible) expect(RENDERABLE_KINDS, kind).toContain(kind);
    }
  });

  // An internal kind MAY keep a sentence — POSITION_GROUP_SIZE does, for the
  // operator view — but it can never be selected into an email, which
  // selectFrom enforces rather than the copy map.
  it('never selects an internal-only kind into an email', () => {
    const internalKinds = EVIDENCE_KIND_NAMES.filter((k) => !EVIDENCE_KINDS[k].emailEligible);
    expect(internalKinds.length).toBeGreaterThan(0);
    const squad = [...squadOf(11, { position: 'D', eligibility_end_year: 2029 }),
      ...squadOf(20, { position: 'M', prior_programme: 'Elsewhere' })];
    const result = selectEvidence(nzDefender, { college: college(), squad });
    for (const k of internalKinds) {
      expect(result.selected.map((e) => e.kind), k).not.toContain(k);
    }
  });

  it('refuses a tier supplied by the caller — the tier comes from the registry', () => {
    const ev = defineEvidence('POSITION_GRADUATION_STARTERS', {
      tier: 'FACT', source: 'test', data: {},
    });
    expect(ev.tier).toBe(TIERS.SIGNAL);
  });

  it('freezes evidence so a later stage cannot promote a signal in place', () => {
    const ev = defineEvidence('PROGRAM_MOMENTUM', { source: 'test', data: {} });
    expect(() => { 'use strict'; ev.tier = TIERS.FACT; }).toThrow();
    expect(ev.tier).toBe(TIERS.SIGNAL);
  });

  it('will not build evidence with no declared source', () => {
    expect(() => defineEvidence('CONFERENCE_TITLE', { data: {} })).toThrow(/source/);
  });
});

describe('FACT / SIGNAL separation is mechanical', () => {
  it('refuses to render a SIGNAL through the fact renderer', () => {
    const ev = defineEvidence('POSITION_GRADUATION_STARTERS', {
      source: 'roster_players:projected_minutes',
      data: { position: 'DEFENSE', count: 3, names: [], basis: 'projected' },
    });
    expect(() => factParts(ev)).toThrow(EvidenceRenderError);
    expect(() => factParts(ev)).toThrow(/cannot be rendered as a statement of fact/);
  });

  it('refuses every SIGNAL kind through the fact renderer, not just the one', () => {
    for (const kind of EVIDENCE_KIND_NAMES) {
      if (EVIDENCE_KINDS[kind].tier !== TIERS.SIGNAL) continue;
      const ev = defineEvidence(kind, { source: 'test', data: {} });
      expect(() => factParts(ev), kind).toThrow(EvidenceRenderError);
    }
  });

  it('allows a FACT to be stated softly — the safe direction', () => {
    const ev = defineEvidence('CONFERENCE_TITLE', { source: 'test', data: { conference: 'ACC' } });
    expect(signalParts(ev).recognition).toContain('ACC');
  });

  it('routes each piece to the renderer its own tier demands', () => {
    const fact = defineEvidence('CONFERENCE_TITLE', { source: 't', data: { conference: 'ACC' } });
    const signal = defineEvidence('PROGRAM_MOMENTUM', {
      source: 't', data: { classification: 'RISING', recentWinPct: 0.7, priorWinPct: 0.5 },
    });
    expect(renderEvidence(fact)).toMatch(/congrats on winning/i);
    expect(renderEvidence(signal)).toMatch(/trending up/);
  });
});

describe('position integrity', () => {
  it('turns CB / RB / LB into DEFENDER evidence and never mentions the sub-position', () => {
    const squad = [
      row({ position: 'CB', player_name: 'One' }),
      row({ position: 'RB', player_name: 'Two' }),
      row({ position: 'LB', player_name: 'Three' }),
      ...squadOf(20, { position: 'M' }),
    ];
    const result = selectEvidence(nzDefender, { college: college(), squad });
    const size = result.all.find((e) => e.kind === 'POSITION_GROUP_SIZE');
    expect(size.data.position).toBe('DEFENSE');
    expect(size.data.count).toBe(3);

    const rendered = JSON.stringify(result.sentences) + JSON.stringify(result.all);
    for (const banned of ['CB', 'RB', 'LB', 'LWB', 'RWB', 'centre back', 'center back', 'fullback']) {
      expect(rendered).not.toContain(banned);
    }
  });

  it('collapses CDM / CAM / winger to the four canonical groups only', () => {
    const squad = [
      row({ position: 'CDM' }), row({ position: 'CAM' }), row({ position: 'RW' }),
      row({ position: 'ST' }), row({ position: 'GK' }),
    ];
    const ctx = buildProgrammeContext({ college: college(), squad });
    const seen = new Set();
    for (const pos of ['Midfielder', 'Forward', 'Goalkeeper', 'Defender']) {
      const ev = generateEvidence(normaliseEvidenceAthlete({ ...nzDefender, position: pos }), ctx);
      for (const e of ev) if (e.data.position) seen.add(e.data.position);
    }
    expect([...seen].sort()).toEqual(['FORWARD', 'GOALKEEPER', 'MIDFIELD'].sort());
  });

  it('keeps UNKNOWN as UNKNOWN and produces no position evidence for it', () => {
    const athlete = normaliseEvidenceAthlete({ ...nzDefender, position: 'Sweeper Keeper Hybrid' });
    expect(athlete.position).toBe('UNKNOWN');

    const ctx = buildProgrammeContext({ college: college(), squad: squadOf(25) });
    const kinds = generateEvidence(athlete, ctx).map((e) => e.kind);
    for (const positional of ['POSITION_GROUP_SIZE', 'POSITION_GROUP_SCARCITY',
      'RETURNING_POSITION_DEPTH', 'ELIGIBILITY_CLIFF', 'POSITION_GRADUATION']) {
      expect(kinds, positional).not.toContain(positional);
    }
  });

  it('reads zero at a position as a parsing failure, not as scarcity', () => {
    // Every real college squad has defenders. Twenty midfielders and none of
    // them is our reader failing, and a confident "light at defender" built on
    // that is worse than saying nothing.
    const squad = squadOf(20, { position: 'M' });
    const kinds = selectEvidence(nzDefender, { college: college(), squad }).all.map((e) => e.kind);
    expect(kinds).not.toContain('POSITION_GROUP_SCARCITY');
  });

  it('excludes UNKNOWN squad rows from the scarcity denominator', () => {
    // 4 defenders in 30 classified rows is 13% and thin. Adding 20 unreadable
    // rows must not dilute it to 8% and invent a scarcity that is really a
    // fact about our scrape.
    const squad = [
      ...squadOf(4, { position: 'D' }),
      ...squadOf(26, { position: 'M' }),
      ...squadOf(20, { position: 'Utility' }),
    ];
    const ev = generateEvidence(normaliseEvidenceAthlete(nzDefender),
      buildProgrammeContext({ college: college(), squad }));
    const scarcity = ev.find((e) => e.kind === 'POSITION_GROUP_SCARCITY');
    expect(scarcity.data.classifiedSquad).toBe(30);
    expect(scarcity.data.share).toBeCloseTo(0.13, 2);
  });
});

describe('evidence never argues against the athlete', () => {
  // Air Force returns all eleven of its defenders through 2027, and the engine
  // offered a coach "around eleven of that group are still eligible" as a
  // reason to sign another one.
  it('says nothing about returning depth when the group is full', () => {
    const squad = Array.from({ length: 11 }, (_, i) => row({
      player_name: `D${i}`, position: 'D', eligibility_end_year: 2029,
    })).concat(squadOf(20, { position: 'M' }));
    const kinds = selectEvidence(nzDefender, { college: college(), squad }).all.map((e) => e.kind);
    expect(kinds).not.toContain('RETURNING_POSITION_DEPTH');
  });

  it('still reports returning depth when the group is genuinely thin', () => {
    const squad = [
      ...Array.from({ length: 3 }, (_, i) => row({ player_name: `D${i}`, position: 'D', eligibility_end_year: 2029 })),
      ...squadOf(22, { position: 'M' }),
    ];
    const ev = selectEvidence(nzDefender, { college: college(), squad })
      .all.find((e) => e.kind === 'RETURNING_POSITION_DEPTH');
    expect(ev.data.returning).toBe(3);
  });

  it('never tells a coach their squad is well stocked', () => {
    const squad = Array.from({ length: 11 }, (_, i) => row({
      player_name: `D${i}`, position: 'D', eligibility_end_year: 2029,
    })).concat(squadOf(20, { position: 'M' }));
    const text = selectEvidence(nzDefender, { college: college(), squad })
      .sentences.map((s) => s.text).join(' ');
    expect(text).not.toMatch(/still eligible/);
  });
});

describe('missing roster produces unknown, never zero', () => {
  it('emits no roster evidence at all when there is no roster', () => {
    const result = selectEvidence(nzDefender, { college: college({ conference_champion_2025: 1 }) });
    expect(result.programme.hasSquad).toBe(false);
    const kinds = result.all.map((e) => e.kind);
    for (const rosterKind of ['POSITION_GROUP_SIZE', 'INTERNATIONAL_ROSTER', 'INTERNATIONAL_SHARE',
      'CURRENT_SAME_COUNTRY', 'HISTORICAL_SAME_COUNTRY', 'POSITION_GROUP_SCARCITY']) {
      expect(kinds, rosterKind).not.toContain(rosterKind);
    }
  });

  it('never renders a zero-valued roster claim', () => {
    const result = selectEvidence(nzDefender, { college: college() });
    const text = result.sentences.map((s) => s.text).join(' ');
    expect(text).not.toMatch(/\b(zero|0)\b/);
  });

  it('falls back to non-roster evidence rather than going silent', () => {
    const result = selectEvidence(nzDefender, {
      college: college({ conference_champion_2025: 1, conference_champion_name: 'ACC' }),
    });
    expect(result.primary.kind).toBe('CONFERENCE_TITLE');
    // PLAYER_FIRST rather than an evidence-led shape, and deliberately: the
    // title is the ONLY thing we know here, and an email that opens on a
    // congratulation and then never mentions the programme again reads as a
    // pretext. EVIDENCE_FIRST requires two selected items for that reason.
    // (Before the structure library this was PROGRAM_SUCCESS, which has been
    // folded into EVIDENCE_FIRST — see LEGACY_STRUCTURE_KEYS.)
    expect(result.structure.key).toBe('PLAYER_FIRST');
    expect(result.structure.eligible).not.toContain('EVIDENCE_FIRST');
  });

  it('still uses history when only the current season is missing', () => {
    // The 325 men's programmes with no 2026 roster but earlier seasons on file.
    const history = [row({ season: '2024', country: 'New Zealand', player_name: 'Kiwi One' })];
    const result = selectEvidence(nzDefender, { college: college(), history });
    expect(result.programme.hasSquad).toBe(false);
    expect(result.programme.hasHistory).toBe(true);
    expect(result.primary.kind).toBe('HISTORICAL_SAME_COUNTRY');
  });

  it('chooses the always-eligible fallback structure when nothing is known', () => {
    const result = selectEvidence(nzDefender, { college: college() });
    expect(result.selected).toHaveLength(0);
    expect(result.structure.key).toBe('PLAYER_FIRST');
    expect(evidenceParagraph(result.selected)).toBe('');
  });
});

describe('historical same-country', () => {
  it('finds New Zealanders across every season on file', () => {
    const history = [
      row({ season: '2022', country: 'New Zealand', player_name: 'Kiwi One' }),
      row({ season: '2023', country: 'New Zealand', player_name: 'Kiwi One' }),
      row({ season: '2024', country: 'New Zealand', player_name: 'Kiwi Two' }),
    ];
    const result = selectEvidence(nzDefender, { college: college(), history });
    const ev = result.all.find((e) => e.kind === 'HISTORICAL_SAME_COUNTRY');
    expect(ev.data.country).toBe('New Zealand');
    expect(ev.data.count).toBe(2);          // two people, three rows
    expect(ev.season).toBe('2022-2024');
    expect(ev.tier).toBe(TIERS.FACT);
  });

  it('counts one player who stayed four years as one player', () => {
    const history = ['2022', '2023', '2024', '2025'].map((season) =>
      row({ season, country: 'New Zealand', player_name: 'Same Person' }));
    const ev = selectEvidence(nzDefender, { college: college(), history })
      .all.find((e) => e.kind === 'HISTORICAL_SAME_COUNTRY');
    expect(ev.data.count).toBe(1);
    // The copy names the single player rather than counting them, so the
    // count is asserted on the data and the text is checked for the absence of
    // the four-fold reading this test exists to catch.
    const text = renderEvidence(ev);
    expect(text).toContain('Same Person');
    expect(text).not.toMatch(/\b(four|two|three)\b/);
  });

  // Found on real data: Bellarmine's 2024 and 2025 rosters carry a Rhys Davies
  // from Waipu, New Zealand, and the athlete being drafted for is a New Zealand
  // defender of the same name. Either reading of that makes the sentence wrong.
  it('never offers the athlete themselves as evidence of a pipeline', () => {
    const history = [
      row({ season: '2024', country: 'New Zealand', player_name: 'Rhys Davies' }),
      row({ season: '2025', country: 'New Zealand', player_name: 'Rhys Davies' }),
    ];
    const kinds = selectEvidence(nzDefender, { college: college(), history }).all.map((e) => e.kind);
    expect(kinds).not.toContain('HISTORICAL_SAME_COUNTRY');
  });

  it('still counts genuine compatriots alongside the athlete\'s own name', () => {
    const history = [
      row({ season: '2024', country: 'New Zealand', player_name: 'Rhys Davies' }),
      row({ season: '2024', country: 'New Zealand', player_name: 'Somebody Else' }),
    ];
    const ev = selectEvidence(nzDefender, { college: college(), history })
      .all.find((e) => e.kind === 'HISTORICAL_SAME_COUNTRY');
    expect(ev.data.count).toBe(1);
    expect(ev.data.names).toEqual(['Somebody Else']);
  });

  it('excludes the athlete from the current-roster and international counts too', () => {
    const squad = [
      row({ country: 'New Zealand', player_name: 'Rhys Davies' }),
      ...squadOf(20, { position: 'M' }),
    ];
    const kinds = selectEvidence(nzDefender, { college: college(), squad }).all.map((e) => e.kind);
    expect(kinds).not.toContain('CURRENT_SAME_COUNTRY');
    expect(kinds).not.toContain('INTERNATIONAL_ROSTER');
  });

  // Adelphi: Louis Spillane is on the 2026 roster and no earlier one, and this
  // produced "you've had one New Zealander come through the programme since
  // 2026" — a past-tense claim about a season that has not been played.
  it('is not "historical" when the only compatriot is on the current squad', () => {
    const squad = [row({ season: '2026', country: 'New Zealand', player_name: 'Only Now' })];
    const result = selectEvidence(nzDefender, { college: college(), squad });
    const kinds = result.all.map((e) => e.kind);
    expect(kinds).not.toContain('HISTORICAL_SAME_COUNTRY');
    // The same row is still evidence — just the honest kind for it.
    expect(kinds).toContain('CURRENT_SAME_COUNTRY');
    // Anchored to the present squad. The wording is "you've already got a Kiwi
    // on the roster"; the property is that it cannot be read as "ever".
    expect(result.paragraph).toMatch(/on the roster/);
    expect(result.paragraph).not.toMatch(/come through|since \d{4}/);
  });

  it('is historical as soon as one earlier season carries a compatriot', () => {
    const squad = [row({ season: '2026', country: 'New Zealand', player_name: 'Now' })];
    const history = [row({ season: '2024', country: 'New Zealand', player_name: 'Then' })];
    const kinds = selectEvidence(nzDefender, { college: college(), squad, history }).all.map((e) => e.kind);
    expect(kinds).toContain('HISTORICAL_SAME_COUNTRY');
  });

  it('applies the same rule to regional history', () => {
    const squad = [row({ season: '2026', country: 'Australia', player_name: 'Aussie Now' })];
    const kinds = selectEvidence(nzDefender, { college: college(), squad }).all.map((e) => e.kind);
    expect(kinds).not.toContain('HISTORICAL_SAME_REGION');
  });

  it('produces nothing for a domestic athlete', () => {
    const usAthlete = { ...nzDefender, nationality: 'USA' };
    const history = [row({ season: '2024', country: 'New Zealand' })];
    const kinds = selectEvidence(usAthlete, { college: college(), history }).all.map((e) => e.kind);
    expect(kinds).not.toContain('HISTORICAL_SAME_COUNTRY');
  });
});

describe('region is distinct from country', () => {
  it('maps New Zealand to Oceania and an unlisted country to nothing', () => {
    expect(regionFor('New Zealand')).toBe('OCEANIA');
    expect(regionFor('Australia')).toBe('OCEANIA');
    expect(regionFor('Brazil')).toBeNull();
  });

  it('never labels Australian players as same-country for a NZ athlete', () => {
    const history = [
      row({ season: '2023', country: 'Australia', player_name: 'Aussie One' }),
      row({ season: '2024', country: 'Australia', player_name: 'Aussie Two' }),
    ];
    const result = selectEvidence(nzDefender, { college: college(), history });
    const kinds = result.all.map((e) => e.kind);
    expect(kinds).toContain('HISTORICAL_SAME_REGION');
    expect(kinds).not.toContain('HISTORICAL_SAME_COUNTRY');

    const region = result.all.find((e) => e.kind === 'HISTORICAL_SAME_REGION');
    expect(region.data.countries).toEqual(['Australia']);
    expect(region.data.athleteCountry).toBe('New Zealand');
    expect(renderEvidence(region)).not.toContain('New Zealand');
  });

  it('excludes the athlete\'s own country from the regional count', () => {
    const history = [
      row({ season: '2023', country: 'New Zealand', player_name: 'Kiwi' }),
      row({ season: '2023', country: 'Australia', player_name: 'Aussie' }),
    ];
    const region = selectEvidence(nzDefender, { college: college(), history })
      .all.find((e) => e.kind === 'HISTORICAL_SAME_REGION');
    expect(region.data.count).toBe(1);
  });

  it('ranks same-country above same-region', () => {
    const country = defineEvidence('HISTORICAL_SAME_COUNTRY', { source: 't', data: {} });
    const region = defineEvidence('HISTORICAL_SAME_REGION', { source: 't', data: {} });
    expect(priorityOf(country)).toBeGreaterThan(priorityOf(region));
  });
});

describe('redundancy', () => {
  it('lets historical NZ evidence suppress the weaker international angles', () => {
    const squad = [
      row({ country: 'New Zealand', player_name: 'Kiwi Now' }),
      ...squadOf(8, { country: 'Brazil', nationality: 'International' }),
      ...squadOf(16),
    ];
    const history = [row({ season: '2023', country: 'New Zealand', player_name: 'Kiwi Then' })];
    const result = selectEvidence(nzDefender, { college: college(), squad, history });

    expect(result.primary.kind).toBe('HISTORICAL_SAME_COUNTRY');
    const selectedKinds = result.selected.map((e) => e.kind);
    for (const weaker of ['CURRENT_SAME_COUNTRY', 'INTERNATIONAL_ROSTER', 'INTERNATIONAL_SHARE']) {
      expect(selectedKinds, weaker).not.toContain(weaker);
    }
    // Suppressed, not forgotten — the comparison later needs to know it was
    // available.
    expect(result.suppressed.map((s) => s.kind)).toContain('INTERNATIONAL_ROSTER');
  });

  it('keeps at most one observation per dedupe group', () => {
    const squad = [...squadOf(3, { position: 'D' }), ...squadOf(27, { position: 'M' })];
    const result = selectEvidence(nzDefender, { college: college(), squad });
    const groups = result.selected.map((e) => e.dedupeGroup);
    expect(new Set(groups).size).toBe(groups.length);
  });

  it('never lets internal-only evidence suppress an email-eligible piece', () => {
    const squad = squadOf(25, { prior_programme: 'Another College' });
    const result = selectEvidence(nzDefender, { college: college(), squad });
    expect(result.selected.every((e) => e.emailEligible)).toBe(true);
    expect(result.internal.map((e) => e.kind)).toContain('TRANSFER_BEHAVIOUR');
  });
});

describe('projected minutes never become a current-season fact', () => {
  it('classifies graduating starters as SIGNAL, not FACT', () => {
    expect(EVIDENCE_KINDS.POSITION_GRADUATION_STARTERS.tier).toBe(TIERS.SIGNAL);
    expect(EVIDENCE_KINDS.POSITION_GRADUATION.tier).toBe(TIERS.FACT);
  });

  it('hedges the starter sentence and names the season it came from', () => {
    const match = {
      graduating_at_position: 4,
      graduating_names_at_position: ['A', 'B', 'C', 'D'],
      graduating_starters_at_position: 3,
      graduating_starter_names_at_position: ['A', 'B', 'C'],
    };
    const result = selectEvidence(nzDefender, { college: college(), match });
    const starters = result.all.find((e) => e.kind === 'POSITION_GRADUATION_STARTERS');
    expect(starters.data.basis).toBe('projected');
    expect(starters.source).toContain('projected_minutes');

    const text = renderEvidence(starters);
    // The season it came from must still be named — that is the whole reason
    // this kind is separate from POSITION_GRADUATION.
    expect(text).toMatch(/going off last season's minutes/i);
    expect(text).toMatch(/looked to be starting regularly/);
    expect(text).not.toMatch(/\bare starters\b/);
  });

  it('still states the departure count itself plainly', () => {
    const match = { graduating_at_position: 4, graduating_names_at_position: ['A', 'B', 'C', 'D'] };
    const ev = selectEvidence(nzDefender, { college: college(), match })
      .all.find((e) => e.kind === 'POSITION_GRADUATION');
    expect(factParts(ev).clause).toContain('four defenders');
  });

  it('reads the legacy field names stored in older recommendation blobs', () => {
    const legacy = { graduating_seniors_at_position: 2, graduating_senior_names_at_position: ['A', 'B'] };
    const ev = selectEvidence(nzDefender, { college: college(), match: legacy })
      .all.find((e) => e.kind === 'POSITION_GRADUATION');
    expect(ev.data.count).toBe(2);
  });
});

describe('momentum is never negative', () => {
  it('produces nothing for a programme in decline', () => {
    const kinds = selectEvidence(nzDefender, {
      college: college({ recent_win_pct: 0.25, prior_win_pct: 0.62 }),
    }).all.map((e) => e.kind);
    expect(kinds).not.toContain('PROGRAM_MOMENTUM');
  });

  it('produces nothing for a flat, unremarkable record', () => {
    const kinds = selectEvidence(nzDefender, {
      college: college({ recent_win_pct: 0.44, prior_win_pct: 0.44 }),
    }).all.map((e) => e.kind);
    expect(kinds).not.toContain('PROGRAM_MOMENTUM');
  });

  it('recognises a rising record and a consistently strong one', () => {
    const rising = selectEvidence(nzDefender, {
      college: college({ recent_win_pct: 0.6, prior_win_pct: 0.4 }),
    }).all.find((e) => e.kind === 'PROGRAM_MOMENTUM');
    expect(rising.data.classification).toBe('RISING');

    const strong = selectEvidence(nzDefender, {
      college: college({ recent_win_pct: 0.72, prior_win_pct: 0.71 }),
    }).all.find((e) => e.kind === 'PROGRAM_MOMENTUM');
    expect(strong.data.classification).toBe('STRONG');
  });

  it('never writes a losing record into a sentence', () => {
    const result = selectEvidence(nzDefender, {
      college: college({ recent_win_pct: 0.15, prior_win_pct: 0.5 }),
    });
    const text = result.sentences.map((s) => s.text).join(' ');
    expect(text).not.toMatch(/15|won|lost|only/i);
  });
});

describe('coach tenure respects the observed window', () => {
  const seasons = (name) => [2022, 2023, 2024, 2025, 2026]
    .map((season) => ({ season, coach_name: name, reason: '' }));

  it('says "at least N seasons" when the coach predates our window', () => {
    const ev = selectEvidence(nzDefender, { college: college(), coachRows: seasons('Pat Smith') })
      .all.find((e) => e.kind === 'COACH_CONTEXT');
    expect(ev.data.windowBounded).toBe(true);
    const text = renderEvidence(ev);
    expect(text).toContain('at least');
    // The year we started looking is not the year they were appointed.
    expect(text).not.toContain('2022');
    expect(text).not.toMatch(/since \d{4}/);
  });

  it('may describe a coach who demonstrably arrived inside the window', () => {
    const rows = [
      { season: 2022, coach_name: 'Old Coach', reason: '' },
      { season: 2023, coach_name: 'Old Coach', reason: '' },
      { season: 2024, coach_name: 'Old Coach', reason: '' },
      { season: 2025, coach_name: 'New Coach', reason: '' },
      { season: 2026, coach_name: 'New Coach', reason: '' },
    ];
    const ev = selectEvidence(nzDefender, { college: college(), coachRows: rows })
      .all.find((e) => e.kind === 'COACH_CONTEXT');
    expect(ev.data.windowBounded).toBe(false);
    expect(ev.data.context).toBe('NEW');
    expect(ev.data.seasonsObserved).toBe(2);
  });

  // Notre Dame: 2022 and 2023 came back `no-usable-page`, so tenureFor starts
  // Chad Riley's segment at 2024 — and he has in fact had the job since 2018.
  // An unreadable page before the segment is not evidence he was absent.
  it('will not claim a start date when earlier seasons were unreadable', () => {
    const rows = [
      { season: 2022, coach_name: '', reason: 'no-usable-page' },
      { season: 2023, coach_name: '', reason: 'no-usable-page' },
      { season: 2024, coach_name: 'Chad Riley', reason: '' },
      { season: 2025, coach_name: 'Chad Riley', reason: '' },
    ];
    const ev = selectEvidence(nzDefender, { college: college(), coachRows: rows })
      .all.find((e) => e.kind === 'COACH_CONTEXT');
    expect(ev.data.windowBounded).toBe(true);
    expect(ev.data.context).toBe('ESTABLISHED');
    expect(renderEvidence(ev)).toContain('at least');
    expect(renderEvidence(ev)).not.toMatch(/first season|two seasons into/);
  });

  it('reads as a clause that works anywhere in the paragraph', () => {
    const rows = [
      { season: 2022, coach_name: 'Old', reason: '' },
      { season: 2023, coach_name: 'Old', reason: '' },
      { season: 2024, coach_name: 'New Coach', reason: '' },
      { season: 2025, coach_name: 'New Coach', reason: '' },
    ];
    const result = selectEvidence(nzDefender, {
      college: college({ postseason_2025_round: 'r32' }), coachRows: rows,
    });
    const para = evidenceParagraph(result.selected);
    // Previously produced "..., and with you now two seasons into the job."
    // The clause has to stand on its own wherever the composer puts it.
    expect(para).not.toContain('and with you');
    expect(para).toMatch(/you're two seasons into the job/);
    expect(para.endsWith('.')).toBe(true);
  });

  it('produces nothing when no season resolved a name', () => {
    const rows = [{ season: 2025, coach_name: '', reason: 'page-unreadable' }];
    const kinds = selectEvidence(nzDefender, { college: college(), coachRows: rows })
      .all.map((e) => e.kind);
    expect(kinds).not.toContain('COACH_CONTEXT');
  });
});

describe('academic fit', () => {
  it('fires only on a genuine match against the school\'s notable majors', () => {
    const athlete = { ...nzDefender, intended_major: 'Business' };
    const yes = selectEvidence(athlete, { college: college({ notable_majors: ['Business'] }) });
    expect(yes.all.map((e) => e.kind)).toContain('ACADEMIC_FIT');

    const no = selectEvidence(athlete, { college: college({ notable_majors: ['Nursing'] }) });
    expect(no.all.map((e) => e.kind)).not.toContain('ACADEMIC_FIT');
  });

  it('stays silent when the athlete has stated no major — the live pilot case', () => {
    const kinds = selectEvidence(nzDefender, { college: college({ notable_majors: ['Business'] }) })
      .all.map((e) => e.kind);
    expect(kinds).not.toContain('ACADEMIC_FIT');
  });

  it('accepts notable_majors as a JSON string, as the database stores it', () => {
    const athlete = { ...nzDefender, intended_major: 'Business' };
    const result = selectEvidence(athlete, { college: college({ notable_majors: '["Business"]' }) });
    expect(result.all.map((e) => e.kind)).toContain('ACADEMIC_FIT');
  });
});

describe('structure selection', () => {
  it('will not choose INTERNATIONAL_CONNECTION without international evidence', () => {
    const result = selectEvidence({ ...nzDefender, nationality: 'USA' }, {
      college: college({ conference_champion_2025: 1, conference_champion_name: 'ACC' }),
    });
    expect(result.structure.key).not.toBe('RELATIONSHIP_FIRST');
    expect(result.structure.eligible).not.toContain('RELATIONSHIP_FIRST');
  });

  it('chooses INTERNATIONAL_CONNECTION when the country link leads', () => {
    const history = [
      row({ season: '2022', country: 'New Zealand', player_name: 'One' }),
      row({ season: '2024', country: 'New Zealand', player_name: 'Two' }),
    ];
    const result = selectEvidence(nzDefender, { college: college(), history });
    expect(result.structure.key).toBe('RELATIONSHIP_FIRST');
  });

  it('always leaves PLAYER_FIRST eligible as a floor', () => {
    const result = selectEvidence(nzDefender, { college: college() });
    expect(result.structure.eligible).toContain('PLAYER_FIRST');
  });
});

describe('copy holds up grammatically', () => {
  // "one player are in that graduating group across the squad" reached a real
  // rendered paragraph for Albany.
  it('agrees the verb with a count of one', () => {
    const one = selectEvidence(nzDefender, { college: college(), match: { graduating_total: 1 } })
      .all.find((e) => e.kind === 'SQUAD_GRADUATION');
    // "one player are graduating" was the bug. The copy no longer needs an
    // is/are at all — "you've got one player graduating" agrees either way —
    // so the guard is the absence of the disagreement rather than a fixed
    // sentence, and the plural form below still exercises the count word.
    expect(renderEvidence(one)).toContain('one player graduating');
    expect(renderEvidence(one)).not.toMatch(/one player are/);

    const many = selectEvidence(nzDefender, { college: college(), match: { graduating_total: 4 } })
      .all.find((e) => e.kind === 'SQUAD_GRADUATION');
    expect(renderEvidence(many)).toContain('four players graduating');
  });

  it('names the year rather than pointing at a group nobody mentioned', () => {
    const ev = selectEvidence(nzDefender, { college: college(), match: { graduating_total: 2 } })
      .all.find((e) => e.kind === 'SQUAD_GRADUATION');
    expect(renderEvidence(ev)).toContain('in 2027');
    expect(renderEvidence(ev)).not.toContain('that graduating group');
  });

  it('never renders a bare "1 " count where a word belongs', () => {
    const squad = [...squadOf(2, { position: 'D', eligibility_end_year: 2029 }), ...squadOf(20, { position: 'M' })];
    const result = selectEvidence(nzDefender, {
      college: college({ conference_champion_2025: 1, conference_champion_name: 'ACC' }),
      squad,
      history: [row({ season: '2023', country: 'New Zealand', player_name: 'Kiwi' })],
      match: { graduating_at_position: 1, graduating_names_at_position: ['A'], graduating_total: 1 },
    });
    for (const ev of result.ranked) {
      const text = renderEvidence(ev);
      expect(text, ev.kind).not.toMatch(/\b1 \w/);
      expect(text, ev.kind).not.toMatch(/\ss are\b|\bplayer are\b/);
    }
  });
});

describe('composition and logging', () => {
  it('joins two pieces into one paragraph rather than a list', () => {
    const history = [row({ season: '2023', country: 'New Zealand', player_name: 'Kiwi' })];
    const match = { graduating_at_position: 3, graduating_names_at_position: ['A', 'B', 'C'] };
    const result = selectEvidence(nzDefender, { college: college(), history, match });
    const para = evidenceParagraph(result.selected);
    // The lead states its own reasoning; anything sharing the paragraph is
    // gathered under one lead-in rather than conjoined to it, which is what
    // stops three "I noticed" sentences in a row.
    expect(para).toMatch(/^I saw you've had/);
    expect(para).toContain('I also noticed');
    expect(para.endsWith('.')).toBe(true);
  });

  it('caps an email at four pieces of evidence, however much is known', () => {
    const squad = [...squadOf(3, { position: 'D' }), ...squadOf(24, { position: 'M', country: 'Spain' })];
    const history = [row({ season: '2023', country: 'New Zealand', player_name: 'Kiwi' })];
    const result = selectEvidence(nzDefender, {
      college: college({ conference_champion_2025: 1, recent_win_pct: 0.8, prior_win_pct: 0.4 }),
      squad, history,
    });
    expect(result.selected.length).toBeLessThanOrEqual(MAX_EMAIL_EVIDENCE);
    expect(result.ranked.length).toBeGreaterThan(2);
  });

  it('produces a log payload carrying what was used and what was not', () => {
    const history = [row({ season: '2023', country: 'New Zealand', player_name: 'Kiwi' })];
    const payload = evidenceLogPayload(selectEvidence(nzDefender, { college: college(), history }));
    expect(payload.primary_kind).toBe('HISTORICAL_SAME_COUNTRY');
    expect(payload.primary_tier).toBe('FACT');
    expect(payload.structure).toBe('RELATIONSHIP_FIRST');
    expect(payload.payload.ranked.length).toBeGreaterThan(0);
    expect(payload.payload).toHaveProperty('suppressed');
    expect(payload.payload).toHaveProperty('rejected');
  });

  it('renders every selected sentence without throwing, across a busy programme', () => {
    const squad = [
      ...squadOf(3, { position: 'D' }),
      ...squadOf(24, { position: 'M', country: 'Spain', nationality: 'International' }),
      row({ country: 'New Zealand', player_name: 'Kiwi Now' }),
    ];
    const history = [row({ season: '2022', country: 'Australia', player_name: 'Aussie' })];
    const result = selectEvidence(nzDefender, {
      college: college({
        conference_champion_2025: 1, conference_champion_name: 'ACC',
        postseason_2025_round: 'semi', recent_win_pct: 0.8, prior_win_pct: 0.5,
        notable_majors: ['Business'],
      }),
      squad,
      history,
      match: { graduating_at_position: 2, graduating_names_at_position: ['A', 'B'], graduating_total: 7 },
      coachRows: [{ season: 2026, coach_name: 'Pat Smith', reason: '' }],
    });
    for (const ev of result.ranked) expect(() => renderEvidence(ev), ev.kind).not.toThrow();
    expect(result.sentences.length).toBe(result.selected.length);
  });
});

describe('selection hygiene', () => {
  it('rejects evidence below its own confidence floor', () => {
    const low = defineEvidence('ACADEMIC_FIT', {
      confidence: 'MEDIUM', source: 't', data: { major: 'Business' },
    });
    const out = selectFrom([low]);
    expect(out.selected).toHaveLength(0);
    expect(out.rejected[0].kind).toBe('ACADEMIC_FIT');
  });

  it('sorts by priority, with facts edging out equal-strength signals', () => {
    const fact = defineEvidence('POSITION_GROUP_SIZE', { strength: 50, source: 't', data: {} });
    const signal = defineEvidence('RETURNING_POSITION_DEPTH', { strength: 50, source: 't', data: {} });
    expect(priorityOf(fact)).toBeGreaterThan(priorityOf(signal));
  });
});
