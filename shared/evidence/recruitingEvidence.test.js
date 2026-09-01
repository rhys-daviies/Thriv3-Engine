import { describe, it, expect } from 'vitest';
import {
  buildProgrammeContext, generateEvidence,
  arrivalSameCountryPosition, coachArrivalSameCountry, arrivalSameRegionPosition,
  positionIntakeHistory,
} from './generate.js';
import { selectFrom } from './select.js';
import { resolveStructure, planPlacement } from './structures.js';
import { renderEvidence, evidenceParts } from './render.js';
import { normaliseEvidenceAthlete, evidenceLogPayload, selectEvidence } from './index.js';
import { EVIDENCE_KINDS } from './kinds.js';
import { buildProgrammePatterns } from '../recruiting/patterns.js';

/**
 * The recruiting-history evidence kinds.
 *
 * What is being defended here is not that the counts are right — patterns.js
 * owns that — but that a true count only becomes a SENTENCE when four separate
 * things hold: the sport's nationality data is licensed, the programme has
 * enough observed intakes, the position column was actually filled in, and the
 * name we are about to say is one the programme itself used. Each of those
 * fails silently, each produces an email that reads perfectly, and each would
 * be wrong in a way the recipient is uniquely placed to notice.
 */

const T = ['2022->2023', '2023->2024', '2024->2025', '2025->2026'];
const seasonOf = (t) => t.split('->')[1];

const arrival = (o = {}) => ({
  programme: 'Test',
  sport: 'mens-soccer',
  arrivalSeason: '2026',
  priorSeason: '2025',
  sourceTransition: '2025->2026',
  playerName: 'Sam Smith',
  canonicalPosition: 'DEFENSE',
  identityMethod: 'EXACT',
  reconciledFrom: [],
  country: null,
  isInternational: false,
  entryType: 'FRESHMAN',
  coach: 'Pat Coach',
  coachAttribution: 'ATTRIBUTED',
  priorProgramme: null,
  priorConfidence: 'NONE',
  ...o,
});

const at = (transition, o = {}) => ({
  ...arrival(o),
  sourceTransition: transition,
  priorSeason: transition.split('->')[0],
  arrivalSeason: seasonOf(transition),
});

const intl = (country, o = {}) => ({ country, isInternational: true, ...o });

const patterns = (arrivals, opts = {}) => buildProgrammePatterns(arrivals, {
  programme: 'Test',
  sport: 'mens-soccer',
  comparableTransitions: T,
  currentCoach: { coach: 'Pat Coach', attributableTransitions: T },
  ...opts,
});

/** A roster row, so the frozen generators have something to read too. */
const row = (o = {}) => ({
  id: `r${Math.random().toString(36).slice(2, 8)}`,
  college_name: 'Test',
  sport: 'mens-soccer',
  season: '2026',
  player_name: 'Someone Else',
  position: 'D',
  class_year_label: 'Fr.',
  nationality: 'USA',
  country: null,
  updated_date: new Date().toISOString(),
  ...o,
});

const context = (recruiting, extra = {}) => buildProgrammeContext({
  college: { name: 'Test', sport: 'mens-soccer' },
  sport: 'mens-soccer',
  squad: [row()],
  history: [row({ season: '2025' })],
  recruiting,
  ...extra,
});

const RHYS = normaliseEvidenceAthlete({
  full_name: 'Rhys Davies', nationality: 'New Zealand', position: 'Defender', sport: 'mens-soccer',
});

/* ========================================================================== */

describe('A. same country + same position', () => {
  const two = () => [
    at('2023->2024', intl('New Zealand', { playerName: 'Kiwi One' })),
    at('2025->2026', intl('New Zealand', { playerName: 'Kiwi Two' })),
    at('2024->2025', { playerName: 'Local Lad' }),
  ];

  it('is a FACT with the count, the seasons and the transitions behind it', () => {
    const ev = arrivalSameCountryPosition(RHYS, context(patterns(two())));
    expect(ev.kind).toBe('ARRIVAL_SAME_COUNTRY_POSITION');
    expect(ev.tier).toBe('FACT');
    expect(ev.data.count).toBe(2);
    expect(ev.data.country).toBe('New Zealand');
    expect(ev.data.position).toBe('DEFENSE');
    expect(ev.data.seasons).toEqual(['2024', '2026']);
    expect(ev.data.provenance.observedTransitions).toBe(4);
    expect(ev.source).toBe('recruiting_arrivals');
  });

  it('does not fire on a country the athlete is not from', () => {
    const ev = arrivalSameCountryPosition(RHYS, context(patterns([
      at('2023->2024', intl('Australia', { playerName: 'Aussie One' })),
    ])));
    expect(ev).toBeNull();
  });

  it('does not fire on the athlete\'s country at another position', () => {
    const ev = arrivalSameCountryPosition(RHYS, context(patterns([
      at('2023->2024', intl('New Zealand', { playerName: 'Kiwi Keeper', canonicalPosition: 'GOALKEEPER' })),
    ])));
    expect(ev).toBeNull();
  });

  /**
   * The failure this exists to prevent. `roster_players` holds a Rhys Davies
   * who arrived at Bellarmine from New Zealand in 2024, and the first real run
   * of this generator opened an email "I saw you've had Rhys Davies come
   * through from New Zealand" — addressed to a coach, about the recruit being
   * introduced two lines below.
   */
  it('never counts the athlete themselves', () => {
    const ev = arrivalSameCountryPosition(RHYS, context(patterns([
      at('2023->2024', intl('New Zealand', { playerName: 'Rhys Davies' })),
    ])));
    expect(ev).toBeNull();
  });

  it('rebuilds the count from the rows rather than adjusting it', () => {
    const ev = arrivalSameCountryPosition(RHYS, context(patterns([
      at('2023->2024', intl('New Zealand', { playerName: 'Rhys Davies' })),
      at('2025->2026', intl('New Zealand', { playerName: 'Kiwi Two' })),
    ])));
    expect(ev.data.count).toBe(1);
    expect(ev.data.provenance.supporting).toHaveLength(1);
    expect(ev.data.seasons).toEqual(['2026']);
  });
});

describe('B. same region + same position', () => {
  const aussie = () => [
    at('2023->2024', intl('Australia', { playerName: 'Aussie One' })),
  ];

  it('is a FACT that names the country, never the region key', () => {
    const ev = arrivalSameRegionPosition(RHYS, context(patterns(aussie())));
    expect(ev.kind).toBe('ARRIVAL_SAME_REGION_POSITION');
    expect(ev.tier).toBe('FACT');
    expect(ev.data.countries).toEqual(['Australia']);
    expect(ev.data.region).toBe('OCEANIA');
    const text = renderEvidence(ev);
    expect(text).toContain('Australia');
    expect(text).not.toMatch(/OCEANIA/i);
  });

  /**
   * The athlete's own country is excluded, exactly as the frozen regional kind
   * excludes it. Otherwise the regional sentence restates the country one from
   * the same rows and dedupe is choosing between two views of one fact.
   */
  it('excludes the athlete\'s own country from the regional claim', () => {
    const ev = arrivalSameRegionPosition(RHYS, context(patterns([
      at('2023->2024', intl('New Zealand', { playerName: 'Kiwi One' })),
    ])));
    expect(ev).toBeNull();
  });

  it('uses the canonical taxonomy rather than the frozen two-country map', () => {
    const spaniard = normaliseEvidenceAthlete({
      full_name: 'Pau Roig', nationality: 'Spain', position: 'Defender', sport: 'mens-soccer',
    });
    const ev = arrivalSameRegionPosition(spaniard, context(patterns([
      at('2023->2024', intl('Germany', { playerName: 'German One' })),
    ])));
    expect(ev.data.region).toBe('EUROPE');
    expect(ev.data.countries).toEqual(['Germany']);
  });
});

describe('C. the current coach\'s own record', () => {
  const kiwiUnderCoach = () => [
    at('2023->2024', intl('New Zealand', { playerName: 'Kiwi One' })),
    at('2025->2026', intl('New Zealand', { playerName: 'Kiwi Two', canonicalPosition: 'MIDFIELD' })),
  ];

  it('is a FACT carrying the coach and their attributable window', () => {
    const ev = coachArrivalSameCountry(RHYS, context(patterns(kiwiUnderCoach())));
    expect(ev.kind).toBe('COACH_ARRIVAL_SAME_COUNTRY');
    expect(ev.tier).toBe('FACT');
    expect(ev.data.coach).toBe('Pat Coach');
    expect(ev.data.count).toBe(2);
    expect(ev.data.attributableTransitions).toBe(4);
    expect(ev.data.provenance.coverageScope).toBe('COACH');
  });

  /**
   * The position is only spoken where every supporting arrival shares it. This
   * kind outranks the country-and-position one, so without this the strongest
   * claim in the group would be the least specific.
   */
  it('names the position only when every arrival shares it', () => {
    const mixed = coachArrivalSameCountry(RHYS, context(patterns(kiwiUnderCoach())));
    expect(mixed.data.position).toBeNull();

    const allDefenders = coachArrivalSameCountry(RHYS, context(patterns([
      at('2023->2024', intl('New Zealand', { playerName: 'Kiwi One' })),
      at('2025->2026', intl('New Zealand', { playerName: 'Kiwi Two' })),
    ])));
    expect(allDefenders.data.position).toBe('DEFENSE');
    expect(renderEvidence(allDefenders)).toContain('defenders');
  });

  /** A coach's first roster is their predecessor's recruiting. */
  it('excludes an INHERITED arrival', () => {
    const ev = coachArrivalSameCountry(RHYS, context(patterns(
      [at('2022->2023', intl('New Zealand', { playerName: 'Kiwi One', coachAttribution: 'INHERITED' }))],
      { currentCoach: { coach: 'Pat Coach', attributableTransitions: T.slice(1) } },
    )));
    expect(ev).toBeNull();
  });

  it('excludes an UNKNOWN attribution', () => {
    const ev = coachArrivalSameCountry(RHYS, context(patterns(
      [at('2023->2024', intl('New Zealand', { playerName: 'Kiwi One', coachAttribution: 'UNKNOWN' }))],
    )));
    expect(ev).toBeNull();
  });

  it('excludes an arrival that belongs to the previous coach', () => {
    const ev = coachArrivalSameCountry(RHYS, context(patterns(
      [at('2022->2023', intl('New Zealand', { playerName: 'Kiwi One' }))],
      { currentCoach: { coach: 'New Boss', attributableTransitions: T.slice(1) } },
    )));
    expect(ev).toBeNull();
  });

  it('says nothing where there is no coach on file', () => {
    const ev = coachArrivalSameCountry(RHYS, context(patterns(kiwiUnderCoach(), { currentCoach: null })));
    expect(ev).toBeNull();
  });
});

describe('D. the four gates', () => {
  const kiwi = () => [at('2023->2024', intl('New Zealand', { playerName: 'Kiwi One' }))];

  /** One intake is an anecdote, whatever it contains. */
  it('suppresses everything below three comparable transitions', () => {
    const ctx = context(patterns(kiwi(), { comparableTransitions: ['2023->2024', '2024->2025'] }));
    expect(arrivalSameCountryPosition(RHYS, ctx)).toBeNull();
    expect(coachArrivalSameCountry(RHYS, ctx)).toBeNull();
    expect(arrivalSameRegionPosition(RHYS, ctx)).toBeNull();
    expect(positionIntakeHistory(RHYS, ctx)).toBeNull();
  });

  /**
   * The coach floor is separate from the programme's. Butler has four
   * programme transitions and a coach appointed for 2026: the programme can be
   * described, the coach cannot.
   */
  it('suppresses the coach kind alone below three attributable transitions', () => {
    const ctx = context(patterns(kiwi(), {
      currentCoach: { coach: 'Pat Coach', attributableTransitions: ['2023->2024', '2024->2025'] },
    }));
    expect(coachArrivalSameCountry(RHYS, ctx)).toBeNull();
    expect(arrivalSameCountryPosition(RHYS, ctx)).not.toBeNull();
  });

  /**
   * 9.7% of women's arrivals carry a nationality flag against 29.1% of men's,
   * and roster data cannot separate under-recording from a smaller
   * international share. Nothing here may become FACT until it can.
   */
  it('suppresses every kind for women\'s soccer', () => {
    const womens = buildProgrammePatterns(kiwi().map((a) => ({ ...a, sport: 'womens-soccer' })), {
      programme: 'Test',
      sport: 'womens-soccer',
      comparableTransitions: T,
      currentCoach: { coach: 'Pat Coach', attributableTransitions: T },
    });
    const ctx = context(womens, { sport: 'womens-soccer', college: { name: 'Test', sport: 'womens-soccer' } });
    expect(arrivalSameCountryPosition(RHYS, ctx)).toBeNull();
    expect(coachArrivalSameCountry(RHYS, ctx)).toBeNull();
    expect(arrivalSameRegionPosition(RHYS, ctx)).toBeNull();
    expect(positionIntakeHistory(RHYS, ctx)).toBeNull();
    expect(generateEvidence(RHYS, ctx).map((e) => e.kind))
      .not.toContain('ARRIVAL_SAME_COUNTRY_POSITION');
  });

  /**
   * Five men's programmes have four comparable transitions and a position on
   * nobody. "One defender from New Zealand" there means "one of the arrivals we
   * could classify", which is not what the sentence says.
   */
  it('suppresses the position-crossed kinds where the position column is thin', () => {
    const thin = [
      ...kiwi(),
      ...Array.from({ length: 6 }, (_, i) => at('2024->2025', {
        playerName: `Unknown ${i}`, canonicalPosition: 'UNKNOWN',
      })),
    ];
    const ctx = context(patterns(thin));
    expect(ctx.recruiting.positions.knownShare).toBeLessThan(0.8);
    expect(arrivalSameCountryPosition(RHYS, ctx)).toBeNull();
    expect(arrivalSameRegionPosition(RHYS, ctx)).toBeNull();
    expect(positionIntakeHistory(RHYS, ctx)).toBeNull();
    // The coach kind does not cross position, so it survives — and drops the
    // position from its wording rather than claiming one.
    const coachEv = coachArrivalSameCountry(RHYS, ctx);
    expect(coachEv).not.toBeNull();
    expect(coachEv.data.position).toBeNull();
  });

  it('says nothing at all where no patterns were loaded', () => {
    const ctx = context(null);
    expect(generateEvidence(RHYS, ctx).some((e) => e.source === 'recruiting_arrivals')).toBe(false);
  });
});

describe('E. positions stay canonical', () => {
  it('never produces a sub-position, whatever the roster called it', () => {
    const ctx = context(patterns([
      at('2023->2024', intl('New Zealand', { playerName: 'Kiwi One', canonicalPosition: 'DEFENSE' })),
    ]));
    const ev = arrivalSameCountryPosition(RHYS, ctx);
    expect(ev.data.position).toBe('DEFENSE');
    expect(renderEvidence(ev)).not.toMatch(/centre-back|center back|fullback|winger|striker/i);
  });

  it('refuses an athlete whose own position is UNKNOWN', () => {
    const unpositioned = normaliseEvidenceAthlete({
      full_name: 'Someone New', nationality: 'New Zealand', position: 'Utility', sport: 'mens-soccer',
    });
    expect(unpositioned.position).toBe('UNKNOWN');
    const ctx = context(patterns([at('2023->2024', intl('New Zealand', { playerName: 'Kiwi One' }))]));
    expect(arrivalSameCountryPosition(unpositioned, ctx)).toBeNull();
    expect(arrivalSameRegionPosition(unpositioned, ctx)).toBeNull();
  });
});

describe('F. naming a real person', () => {
  it('names a single EXACT arrival', () => {
    const ev = arrivalSameCountryPosition(RHYS, context(patterns([
      at('2024->2025', intl('New Zealand', { playerName: 'Hayden Aish' })),
    ])));
    expect(ev.data.name).toBe('Hayden Aish');
    expect(renderEvidence(ev)).toContain('Hayden Aish');
  });

  /**
   * A RECONCILED row is one the build merged from two spellings of one person.
   * The surviving spelling is our choice rather than the programme's — fine
   * behind a count, wrong in an email to the person who signed them. Loras'
   * only Icelandic goalkeeper arrival is exactly this case.
   */
  it('withholds the name of a RECONCILED arrival and keeps the count', () => {
    const ev = arrivalSameCountryPosition(RHYS, context(patterns([
      at('2024->2025', intl('New Zealand', {
        playerName: 'Jon Smith', identityMethod: 'RECONCILED', reconciledFrom: ['Jon Arnar Smith'],
      })),
    ])));
    expect(ev.data.count).toBe(1);
    expect(ev.data.name).toBeNull();
    const text = renderEvidence(ev);
    expect(text).not.toContain('Jon Smith');
    expect(text).toMatch(/a defender from New Zealand/);
  });

  it('never names anybody once there is more than one arrival', () => {
    const ev = arrivalSameCountryPosition(RHYS, context(patterns([
      at('2023->2024', intl('New Zealand', { playerName: 'Kiwi One' })),
      at('2025->2026', intl('New Zealand', { playerName: 'Kiwi Two' })),
    ])));
    expect(ev.data.name).toBeNull();
    expect(renderEvidence(ev)).not.toContain('Kiwi One');
  });

  /**
   * An AMBIGUOUS prior programme does not stop us naming the player as an
   * ARRIVAL — we are certain they are new here. It must stop any claim about
   * where they came from, and the copy has no route to one: `priorProgramme`
   * lives under `provenance`, which nothing in FACT_COPY reads.
   */
  it('names an arrival whose origin is ambiguous, and never states the origin', () => {
    const ev = arrivalSameCountryPosition(RHYS, context(patterns([
      at('2024->2025', intl('New Zealand', {
        playerName: 'Hunter Wilson',
        priorConfidence: 'AMBIGUOUS',
        priorProgramme: null,
      })),
    ])));
    expect(ev.data.name).toBe('Hunter Wilson');
    expect(ev.data.provenance.supporting[0].priorConfidence).toBe('AMBIGUOUS');
    const text = renderEvidence(ev);
    expect(text).toContain('Hunter Wilson');
    expect(text).not.toMatch(/transfer|from (Mount Mercy|UNC Asheville)|came from|out of/i);
  });

  it('never states a transfer origin even where one name-matched', () => {
    const ev = arrivalSameCountryPosition(RHYS, context(patterns([
      at('2024->2025', intl('New Zealand', {
        playerName: 'Kiwi One', priorConfidence: 'NAME_MATCH', priorProgramme: 'Gardner-Webb',
      })),
    ])));
    expect(renderEvidence(ev)).not.toContain('Gardner-Webb');
    // still recorded, because provenance is for the log and not for the copy
    expect(ev.data.provenance.supporting[0].priorProgramme).toBe('Gardner-Webb');
  });
});

describe('G. the dedupe hierarchy', () => {
  const kiwiRow = (season) => row({
    season, player_name: `Kiwi ${season}`, nationality: 'International', country: 'New Zealand',
  });

  const full = (arrivals, opts = {}) => selectFrom(generateEvidence(RHYS, context(
    patterns(arrivals, opts),
    { squad: [row(), kiwiRow('2026')], history: [kiwiRow('2024'), row({ season: '2024' })] },
  )));

  const kindsOf = (r) => r.selected.map((e) => e.kind);
  const suppressedBy = (r, kind) => r.suppressed.find((s) => s.kind === kind)?.suppressedBy ?? null;

  /** With no coach on file, the programme-scoped arrival kind is the winner. */
  it('supersedes HISTORICAL_SAME_COUNTRY', () => {
    const r = full([at('2023->2024', intl('New Zealand', { playerName: 'Kiwi 2024' }))],
      { currentCoach: null });
    expect(kindsOf(r)).toContain('ARRIVAL_SAME_COUNTRY_POSITION');
    expect(suppressedBy(r, 'HISTORICAL_SAME_COUNTRY')).toBe('ARRIVAL_SAME_COUNTRY_POSITION');
  });

  it('supersedes HISTORICAL_SAME_REGION', () => {
    const aussieRow = row({
      season: '2024', player_name: 'Aussie One', nationality: 'International', country: 'Australia',
    });
    const r = selectFrom(generateEvidence(RHYS, context(
      patterns([at('2023->2024', intl('Australia', { playerName: 'Aussie One' }))]),
      { squad: [row()], history: [aussieRow] },
    )));
    expect(kindsOf(r)).toContain('ARRIVAL_SAME_REGION_POSITION');
    expect(suppressedBy(r, 'HISTORICAL_SAME_REGION')).toBe('ARRIVAL_SAME_REGION_POSITION');
  });

  it('lets the country kind outrank its region equivalent', () => {
    const r = full([
      at('2023->2024', intl('New Zealand', { playerName: 'Kiwi 2024' })),
      at('2024->2025', intl('Australia', { playerName: 'Aussie One' })),
    ], { currentCoach: null });
    expect(kindsOf(r)).toContain('ARRIVAL_SAME_COUNTRY_POSITION');
    expect(suppressedBy(r, 'ARRIVAL_SAME_REGION_POSITION')).toBe('ARRIVAL_SAME_COUNTRY_POSITION');
  });

  /** The only claim in the group addressed to the person reading it. */
  it('lets the coach kind outrank the programme equivalent', () => {
    const r = full([at('2023->2024', intl('New Zealand', { playerName: 'Kiwi 2024' }))]);
    expect(kindsOf(r)).toContain('COACH_ARRIVAL_SAME_COUNTRY');
    expect(suppressedBy(r, 'ARRIVAL_SAME_COUNTRY_POSITION')).toBe('COACH_ARRIVAL_SAME_COUNTRY');
  });

  it('falls back to the frozen kinds when the arrival evidence is gated out', () => {
    const r = full([at('2023->2024', intl('New Zealand', { playerName: 'Kiwi 2024' }))], {
      comparableTransitions: ['2023->2024'],
    });
    expect(kindsOf(r)).toContain('HISTORICAL_SAME_COUNTRY');
    expect(kindsOf(r)).not.toContain('ARRIVAL_SAME_COUNTRY_POSITION');
  });

  it('leaves exactly one international claim standing', () => {
    const r = full([
      at('2023->2024', intl('New Zealand', { playerName: 'Kiwi 2024' })),
      at('2024->2025', intl('Australia', { playerName: 'Aussie One' })),
    ]);
    const international = r.selected.filter((e) => e.category === 'international');
    expect(international).toHaveLength(1);
  });
});

describe('H. what must never reach an email', () => {
  const ctx = () => context(patterns([
    at('2023->2024', intl('New Zealand', { playerName: 'Kiwi One' })),
  ]));

  it('keeps POSITION_INTAKE_HISTORY out of every email', () => {
    expect(EVIDENCE_KINDS.POSITION_INTAKE_HISTORY.emailEligible).toBe(false);
    const r = selectFrom(generateEvidence(RHYS, ctx()));
    expect(r.selected.map((e) => e.kind)).not.toContain('POSITION_INTAKE_HISTORY');
    expect(r.internal.map((e) => e.kind)).toContain('POSITION_INTAKE_HISTORY');
    const result = selectEvidence(
      { full_name: 'Rhys Davies', nationality: 'New Zealand', position: 'Defender', sport: 'mens-soccer' },
      {
        college: { name: 'Test', sport: 'mens-soccer' },
        sport: 'mens-soccer',
        squad: [row()],
        history: [row({ season: '2025' })],
        recruiting: patterns([at('2023->2024', intl('New Zealand', { playerName: 'Kiwi One' }))]),
      },
    );
    expect(result.paragraph).not.toMatch(/intakes/i);
    expect(result.composition.placement.map((p) => p.kind)).not.toContain('POSITION_INTAKE_HISTORY');
  });

  /**
   * Absence is real data internally and has no business in an email. "No New
   * Zealander has arrived in four intakes" is a finding and a terrible sentence
   * to send; the generators return null rather than a zero-count claim.
   */
  it('produces no evidence at all from an absence', () => {
    const none = context(patterns([at('2023->2024', { playerName: 'Local Lad' })]));
    for (const fn of [arrivalSameCountryPosition, coachArrivalSameCountry, arrivalSameRegionPosition]) {
      expect(fn(RHYS, none)).toBeNull();
    }
    const r = selectFrom(generateEvidence(RHYS, none));
    for (const ev of r.selected) expect(ev.source).not.toBe('recruiting_arrivals');
  });

  /**
   * The FACT wall, scanned mechanically. Every one of these words would turn a
   * count into a claim about what the coach wants, which is the thing two
   * roster snapshots cannot see.
   */
  it('uses no language that implies the coach\'s intent', () => {
    const cases = [
      arrivalSameCountryPosition(RHYS, ctx()),
      coachArrivalSameCountry(RHYS, ctx()),
      arrivalSameRegionPosition(RHYS, context(patterns([
        at('2023->2024', intl('Australia', { playerName: 'Aussie One' })),
      ]))),
      positionIntakeHistory(RHYS, ctx()),
    ].filter(Boolean);
    expect(cases.length).toBe(4);

    const FORBIDDEN = /\b(needs?|looking for|recruits?|recruiting|targets?|prefers?|likes?|gap|replacements?|will need|clearly|pipeline|tend to|typically)\b/i;
    for (const ev of cases) {
      const parts = evidenceParts(ev, { firstName: 'Rhys' });
      for (const [field, value] of Object.entries(parts)) {
        if (typeof value !== 'string') continue;
        expect(value, `${ev.kind}.${field}: ${value}`).not.toMatch(FORBIDDEN);
      }
    }
  });

  it('never quotes a share, a projection or a future tense', () => {
    const text = renderEvidence(coachArrivalSameCountry(RHYS, ctx()));
    expect(text).not.toMatch(/%|going off|projected|next year|this season/i);
  });
});

describe('I. composition and logging', () => {
  const kiwiCtx = () => context(patterns([
    at('2023->2024', intl('New Zealand', { playerName: 'Kiwi One' })),
  ]));

  it('makes RELATIONSHIP_FIRST available, and adds no new structure', () => {
    const selection = selectFrom(generateEvidence(RHYS, kiwiCtx()));
    const structure = resolveStructure(selection);
    expect(structure.key).toBe('RELATIONSHIP_FIRST');
    expect(structure.eligible).toEqual(['RELATIONSHIP_FIRST', 'PLAYER_FIRST']);
  });

  it('puts the arrival claim in the hook', () => {
    const selection = selectFrom(generateEvidence(RHYS, kiwiCtx()));
    const placed = planPlacement(selection.selected, 'RELATIONSHIP_FIRST');
    expect(placed.hook.kind).toBe('COACH_ARRIVAL_SAME_COUNTRY');
  });

  /**
   * Selection order is the ranking and displayed order is the placement. They
   * are logged separately and neither is rewritten to match the other.
   */
  it('logs selection order and displayed order as separate records', () => {
    const result = selectEvidence(
      { full_name: 'Rhys Davies', nationality: 'New Zealand', position: 'Defender', sport: 'mens-soccer' },
      {
        college: { name: 'Test', sport: 'mens-soccer' },
        sport: 'mens-soccer',
        squad: [row()],
        history: [row({ season: '2025' })],
        recruiting: patterns([at('2023->2024', intl('New Zealand', { playerName: 'Kiwi One' }))]),
      },
    );
    const payload = evidenceLogPayload(result);
    expect(payload.primary_kind).toBe('COACH_ARRIVAL_SAME_COUNTRY');
    expect(payload.selected_kinds.split(',')[0]).toBe('COACH_ARRIVAL_SAME_COUNTRY');
    for (const item of payload.payload.selectedDetail) {
      expect(item).toHaveProperty('order');
      expect(item).toHaveProperty('slot');
      expect(item).toHaveProperty('displayed');
    }
  });

  /**
   * The provenance the brief asks for, all of it, in the log payload — which is
   * server-side. `wireEvidence` carries no `data` at all, so none of this
   * crosses to the browser; that boundary is what stops a client manufacturing
   * a claim, and this phase does not widen it.
   */
  it('logs enough provenance to reconstruct the claim', () => {
    const ev = coachArrivalSameCountry(RHYS, kiwiCtx());
    const p = ev.data.provenance;
    expect(p.athleteCountry).toBe('New Zealand');
    expect(p.athletePosition).toBe('DEFENSE');
    expect(p.athleteRegion).toBe('OCEANIA');
    expect(p.observedTransitions).toBe(4);
    expect(p.coverageStatus).toBe('SUFFICIENT');
    expect(p.coverageScope).toBe('COACH');
    expect(p.sportDataStatus).toBe('LICENSED');
    expect(p.fieldCoverage).toBeGreaterThanOrEqual(0.8);
    expect(p.specificity).toBe('COACH_COUNTRY');
    expect(p.supporting[0]).toMatchObject({
      playerName: 'Kiwi One', season: '2024', identityMethod: 'EXACT', coachAttribution: 'ATTRIBUTED',
    });
    expect(ev.data.count).toBe(1);
    expect(ev.data.seasons).toEqual(['2024']);
  });
});

describe('J. the engine is relative to the athlete, not to New Zealand', () => {
  /**
   * Nothing in the recruiting generators knows what New Zealand is. The same
   * code answers for a Ghanaian midfielder against Ghanaian arrivals, and for a
   * Spanish forward against Spanish ones.
   */
  it('answers for any athlete against their own country and region', () => {
    const ghanaian = normaliseEvidenceAthlete({
      full_name: 'Kofi Mensah', nationality: 'Ghana', position: 'Midfielder', sport: 'mens-soccer',
    });
    const ev = arrivalSameCountryPosition(ghanaian, context(patterns([
      at('2023->2024', intl('Ghana', { playerName: 'Ghana One', canonicalPosition: 'MIDFIELD' })),
      at('2024->2025', intl('New Zealand', { playerName: 'Kiwi One' })),
    ])));
    expect(ev.data.country).toBe('Ghana');
    expect(ev.data.position).toBe('MIDFIELD');
    expect(ev.data.count).toBe(1);
    // A single licensed name replaces the count AND the position noun — the
    // named form says strictly less than the observation, never more.
    expect(renderEvidence(ev)).toContain('Ghana One');

    const two = arrivalSameCountryPosition(ghanaian, context(patterns([
      at('2023->2024', intl('Ghana', { playerName: 'Ghana One', canonicalPosition: 'MIDFIELD' })),
      at('2024->2025', intl('Ghana', { playerName: 'Ghana Two', canonicalPosition: 'MIDFIELD' })),
    ])));
    expect(renderEvidence(two)).toContain('midfielders');

    const region = arrivalSameRegionPosition(ghanaian, context(patterns([
      at('2023->2024', intl('Senegal', { playerName: 'Senegal One', canonicalPosition: 'MIDFIELD' })),
    ])));
    expect(region.data.region).toBe('AFRICA');
    expect(region.data.countries).toEqual(['Senegal']);
  });

  it('says nothing for a domestic athlete', () => {
    const domestic = normaliseEvidenceAthlete({
      full_name: 'Jack Miller', nationality: 'USA', position: 'Defender', sport: 'mens-soccer',
    });
    const ctx = context(patterns([at('2023->2024', intl('New Zealand', { playerName: 'Kiwi One' }))]));
    expect(arrivalSameCountryPosition(domestic, ctx)).toBeNull();
    expect(coachArrivalSameCountry(domestic, ctx)).toBeNull();
    expect(arrivalSameRegionPosition(domestic, ctx)).toBeNull();
  });
});
