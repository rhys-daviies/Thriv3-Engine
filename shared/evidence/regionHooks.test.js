import { describe, it, expect } from 'vitest';
import { outreachEvidenceFor, LICENSED_KINDS } from './outreachEvidence.js';
import { outreachCopyFor, OUTREACH_COPY_KINDS } from './outreachCopy.js';
import {
  CONTRACT_KINDS, hasContract, requiredFields, recentSeasons, REGION_RECENCY_SEASONS,
} from './outreachContract.js';
import { permissionsFor, PERMISSION } from './kinds.js';
import { REGIONS } from '../recruiting/regions.js';
import { SQUAD_SEASON } from '../philosophy.js';

/**
 * WHAT A REGIONAL CLAIM MAY OPEN AN EMAIL WITH.
 *
 * J3 measured the two regional hooks separately and they turned out to be
 * different claims wearing the same word.
 *
 *   HISTORICAL_SAME_REGION opened 286 emails, 224 of them saying "one player
 *   from Australia has come through the programme" to a New Zealander — one
 *   person, another country, no date. Its `data` never carried the seasons its
 *   own evidence object had, so the copy had nothing to print; and dating it
 *   made it worse, because "in 2022" reads as the stretch it is.
 *
 *   ARRIVAL_SAME_REGION_POSITION conjoins region AND position and has always
 *   carried its seasons. It survives, with the date made mandatory and recent.
 *
 * The rule underneath is J2's: an outreach fact earns its place by
 * CONJUNCTION. One conjunct, undated, count of one, is not a reason to write.
 */

const REGION_KINDS = ['ARRIVAL_SAME_REGION_POSITION', 'HISTORICAL_SAME_REGION'];
const CUR = Number(SQUAD_SEASON);

const through = (kind, data) => {
  let facts = null;
  try {
    const r = outreachEvidenceFor({ all: [{ kind, data, confidence: 'HIGH' }] });
    const hit = [...r.hooks, ...r.relevance, ...r.recognition, ...r.alternatives]
      .find((i) => i.kind === kind);
    if (hit) facts = hit.facts;
  } catch { /* an unlicensed kind never appears */ }
  if (!facts) return { qualified: false, rendered: false, text: null };
  const copy = outreachCopyFor({ kind, facts }, { firstName: 'Shaan' });
  const text = copy?.clause ?? copy?.recognition ?? null;
  return { qualified: true, rendered: Boolean(text), text, facts };
};

/** A complete, recent, valid regional arrival. */
const ARRIVAL = {
  countries: ['Australia'], position: 'forward', count: 1,
  seasons: [String(CUR - 1)], athleteCountry: 'New Zealand',
};

/* -------------------------------------------------------------------------- */

describe('HISTORICAL_SAME_REGION may no longer open an email', () => {
  it('is denied by the registry', () => {
    expect(permissionsFor('HISTORICAL_SAME_REGION').OUTREACH).toBe(PERMISSION.DENIED);
  });

  it('has no role, no contract and no words', () => {
    // All four must go together — a kind licensed with any one of them left
    // behind throws at load, which is the guard H17 installed.
    expect(LICENSED_KINDS).not.toContain('HISTORICAL_SAME_REGION');
    expect(CONTRACT_KINDS).not.toContain('HISTORICAL_SAME_REGION');
    expect(OUTREACH_COPY_KINDS).not.toContain('HISTORICAL_SAME_REGION');
    expect(hasContract('HISTORICAL_SAME_REGION')).toBe(false);
  });

  it('cannot be rendered even with complete, recent, plural data', () => {
    // The strongest form it could ever take, and it still says nothing.
    const r = through('HISTORICAL_SAME_REGION', {
      countries: ['Australia'], count: 4, athleteCountry: 'New Zealand',
      seasons: [String(CUR - 1)], names: ['A', 'B', 'C', 'D'],
    });
    expect(r.qualified).toBe(false);
    expect(r.rendered).toBe(false);
    expect(outreachCopyFor({ kind: 'HISTORICAL_SAME_REGION', facts: { countries: ['Australia'], count: 4 } })).toBe(null);
  });

  it('leaves the outbound surface with nine kinds and five hooks', () => {
    expect(LICENSED_KINDS).toHaveLength(9);
    expect(CONTRACT_KINDS).toHaveLength(9);
    expect(OUTREACH_COPY_KINDS).toHaveLength(9);
    const grade = (k) => permissionsFor(k).OUTREACH;
    expect(LICENSED_KINDS.filter((k) => grade(k) === PERMISSION.ALLOWED)).toHaveLength(4);
    expect(LICENSED_KINDS.filter((k) => grade(k) === PERMISSION.QUALIFIED)).toHaveLength(5);
  });
});

describe('ARRIVAL_SAME_REGION_POSITION keeps the hook, and must earn it', () => {
  it('still opens an email on a recent, dated, positioned arrival', () => {
    const r = through('ARRIVAL_SAME_REGION_POSITION', ARRIVAL);
    expect(r.qualified).toBe(true);
    expect(r.text).toContain('Australia');
    expect(r.text).toContain('forward');
    expect(r.text).toContain('the same part of the world');
    expect(r.text).toMatch(new RegExp(String(CUR - 1)));
  });

  it('requires the season, and requires it to be recent', () => {
    expect(requiredFields('ARRIVAL_SAME_REGION_POSITION')).toContain('seasons');
    for (const back of [0, 1, 2]) {
      expect(through('ARRIVAL_SAME_REGION_POSITION', { ...ARRIVAL, seasons: [String(CUR - back)] }).qualified,
        `${CUR - back} must qualify`).toBe(true);
    }
    for (const back of [3, 4, 6]) {
      expect(through('ARRIVAL_SAME_REGION_POSITION', { ...ARRIVAL, seasons: [String(CUR - back)] }).qualified,
        `${CUR - back} is too old to be why we wrote`).toBe(false);
    }
  });

  it('refuses an undated claim rather than saying something vaguer', () => {
    /**
     * The failure `HISTORICAL_SAME_REGION` shipped with: seasons on the
     * evidence object, absent from `data`, and a sentence that quietly said
     * "at some point". There is no vague form to fall back to.
     */
    for (const seasons of [[], null, undefined, ['']]) {
      const r = through('ARRIVAL_SAME_REGION_POSITION', { ...ARRIVAL, seasons });
      expect(r.qualified, JSON.stringify(seasons)).toBe(false);
      expect(r.rendered).toBe(false);
    }
    expect(outreachCopyFor({
      kind: 'ARRIVAL_SAME_REGION_POSITION',
      facts: { countries: ['Australia'], position: 'forward', count: 1 },
    })).toBe(null);
  });

  it('refuses a malformed season', () => {
    for (const seasons of [['soon'], ['20'], [null], ['1899'], [String(CUR + 40)]]) {
      expect(through('ARRIVAL_SAME_REGION_POSITION', { ...ARRIVAL, seasons }).qualified,
        JSON.stringify(seasons)).toBe(false);
    }
  });

  it('keeps its position requirement — region alone is not the claim', () => {
    expect(requiredFields('ARRIVAL_SAME_REGION_POSITION')).toContain('position');
    expect(through('ARRIVAL_SAME_REGION_POSITION', { ...ARRIVAL, position: null }).qualified).toBe(false);
    // And a position the registry cannot name is not a position.
    expect(through('ARRIVAL_SAME_REGION_POSITION', { ...ARRIVAL, position: 'Utility' }).qualified).toBe(false);
  });

  it('keeps its countries requirement, and never prints the region key', () => {
    expect(through('ARRIVAL_SAME_REGION_POSITION', { ...ARRIVAL, countries: [] }).qualified).toBe(false);
    const r = through('ARRIVAL_SAME_REGION_POSITION', { ...ARRIVAL, region: 'OCEANIA' });
    expect(r.text).not.toMatch(/OCEANIA/i);
    expect(r.facts).not.toHaveProperty('region');
  });

  it('accepts n = 1, deliberately', () => {
    /**
     * A count floor was simulated and rejected. n>=2 would have left SIX
     * regional hooks across 4,742 pairs — deleting the kind by arithmetic
     * rather than by decision. What made the old regional claims weak was the
     * missing conjunct and the missing date, not the count: one Australian
     * FORWARD signed last season is a narrower fact than four Australians at
     * any position, ever.
     */
    expect(through('ARRIVAL_SAME_REGION_POSITION', { ...ARRIVAL, count: 1 }).qualified).toBe(true);
    expect(through('ARRIVAL_SAME_REGION_POSITION', { ...ARRIVAL, count: 0 }).qualified).toBe(false);
  });

  it('still says the cut is wider than the athlete\'s own country', () => {
    const r = through('ARRIVAL_SAME_REGION_POSITION', ARRIVAL);
    expect(r.facts.widerThanOwnCountry).toBe(true);
    expect(r.facts.excludingCountry).toBe('New Zealand');
    expect(r.text).not.toContain('New Zealand');
  });
});

describe('the recency window', () => {
  it('is two seasons, measured from the squad season', () => {
    expect(REGION_RECENCY_SEASONS).toBe(2);
    expect(recentSeasons([String(CUR)])).toBeTruthy();
    expect(recentSeasons([String(CUR - REGION_RECENCY_SEASONS)])).toBeTruthy();
    expect(recentSeasons([String(CUR - REGION_RECENCY_SEASONS - 1)])).toBe(null);
  });

  it('reads the newest season in a span, not the oldest', () => {
    // "since 2023" with an arrival in 2025 is a recent claim.
    expect(recentSeasons([String(CUR - 5), String(CUR - 1)])).toBeTruthy();
    expect(recentSeasons([String(CUR - 6), String(CUR - 5)])).toBe(null);
  });

  it('refuses an empty or absent list', () => {
    for (const v of [[], null, undefined, '2025', {}]) expect(recentSeasons(v)).toBe(null);
  });

  it('applies to the regional hook and to nothing else', () => {
    // A compatriot is a compatriot whenever they came through. Only the claim
    // whose justification IS its recency carries the requirement.
    for (const k of CONTRACT_KINDS) {
      const req = requiredFields(k);
      if (k === 'ARRIVAL_SAME_REGION_POSITION') expect(req).toContain('seasons');
      else expect(req, `${k} must not require seasons`).not.toContain('seasons');
    }
  });
});

describe('the region taxonomy is unchanged, and excludes the athlete', () => {
  it('never counts the athlete\'s own country as a regional peer', () => {
    // Same-country claims are a different, stronger kind. A region hook that
    // included compatriots would be counting different people.
    expect(REGIONS.OCEANIA).toContain('New Zealand');
    expect(REGIONS.OCEANIA).toContain('Australia');
    const r = through('ARRIVAL_SAME_REGION_POSITION', ARRIVAL);
    expect(r.facts.countries).not.toContain(r.facts.excludingCountry);
  });

  it('is broad, which is why the surviving claim needs its other conjuncts', () => {
    // 50 countries in EUROPE, 56 in AFRICA. The corpus only ever shows
    // OCEANIA, where the neighbour genuinely is next door — so the live data
    // flatters the claim and the taxonomy is the honest measure of it.
    expect(REGIONS.EUROPE.length).toBeGreaterThan(40);
    expect(REGIONS.AFRICA.length).toBeGreaterThan(40);
    expect(REGIONS.OCEANIA.length).toBeGreaterThan(10);
  });
});

describe('the hook ladder', () => {
  it('has five rungs, ending with the regional arrival', () => {
    const hooks = LICENSED_KINDS.filter((k) => permissionsFor(k).OUTREACH !== PERMISSION.DENIED
      && ['COACH_ARRIVAL_SAME_COUNTRY', 'ARRIVAL_SAME_COUNTRY_POSITION', 'HISTORICAL_SAME_COUNTRY',
        'CURRENT_SAME_COUNTRY', 'ARRIVAL_SAME_REGION_POSITION'].includes(k));
    expect(hooks).toHaveLength(5);
  });

  it('lets a same-country claim beat the regional one on the same connection', () => {
    // Both are in `international-connection`; exactly one survives, and the
    // ladder decides which. The wider cut must never win.
    const r = outreachEvidenceFor({
      all: [
        { kind: 'ARRIVAL_SAME_REGION_POSITION', data: ARRIVAL, confidence: 'HIGH' },
        { kind: 'HISTORICAL_SAME_COUNTRY', data: { country: 'New Zealand', count: 1, names: ['Sam'], seasons: ['2024'] }, confidence: 'HIGH' },
      ],
    });
    expect(r.hooks.map((h) => h.kind)).toEqual(['HISTORICAL_SAME_COUNTRY']);
    expect(r.alternatives.map((a) => a.kind)).toContain('ARRIVAL_SAME_REGION_POSITION');
  });
});
