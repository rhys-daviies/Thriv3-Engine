import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { EVIDENCE_KIND_NAMES, defineEvidence, CONFIDENCE } from './kinds.js';
import { operatorFactsFor } from './operatorFacts.js';
import { outreachCopyFor, OUTREACH_COPY_KINDS } from './outreachCopy.js';
import { SOURCE_LABEL } from '../../src/lib/evidenceProvenance.js';

/**
 * WHERE A CLAIM CAME FROM, AND WHAT WE MAY PROMISE ABOUT IT.
 *
 * An operator reading a sentence should be able to answer three questions:
 * what family of records produced it, over what window, and whether they can
 * go and look. The first two are answered today. The third is not, and this
 * file exists to keep that honest in both directions — no missing label, and
 * no link the data cannot support.
 *
 * `sourceUrl` is null on all 10,206 live objects and H11 measured why. It is
 * NOT for want of a URL: `roster_players` carries a real athletics-site roster
 * page on 99.6% of 276,745 rows. Two things stop it being wired, and only one
 * of them is fixable by better data:
 *
 *   NINE KINDS REST ON SEVERAL SEASONS. A 2022 roster page cannot show "two
 *   have come through since 2022". One URL there would offer a verification
 *   it cannot give, which is a worse failure than no link.
 *
 *   943 OF 4,038 ROSTER URLS sit on a host the athletics-domain registry does
 *   not verify for that school, 30 point at a player bio, and Stonehill's 2025
 *   row points at Stanton's site. A link landing on the wrong programme costs
 *   more than the missing link does.
 */

const src = { source: 'roster_players', confidence: CONFIDENCE.HIGH, season: '2026' };

describe('every claim names the family of records behind it', () => {
  it('gives each kind exactly one source, and a word for it', () => {
    /**
     * Twelve live source values across the twenty-six kinds, and every one has
     * a label. A gap here renders "Unrecognised source (roster_players:x)" to
     * an operator — the drawer's own fallback, which nothing should ever hit.
     */
    const LIVE = [
      'roster_players', 'roster_players:projected_minutes',
      'roster_players:eligibility_end_year', 'roster_players:prior_programme',
      'roster_players:freshman-minutes', 'roster_players:pool-benchmarks',
      'recruiting_arrivals', 'coach_seasons', 'colleges:notable_majors',
      'colleges:recent_win_pct', 'colleges:postseason_2025_round',
      'colleges:conference_champion_2025',
    ];
    for (const s of LIVE) {
      expect(SOURCE_LABEL[s], s).toBeTruthy();
      expect(SOURCE_LABEL[s], s).not.toMatch(/Unrecognised/);
    }
    // And no label describes a source nothing produces.
    expect(Object.keys(SOURCE_LABEL).sort()).toEqual([...LIVE].sort());
  });

  it('names a source family, never a table the operator would have to decode', () => {
    for (const [key, label] of Object.entries(SOURCE_LABEL)) {
      expect(label, key).not.toMatch(/_/);
      expect(label, key).toMatch(/^[A-Z]/);
    }
  });
});

describe('no link is offered, because none can be kept', () => {
  it('leaves sourceUrl null when a generator does not set one', () => {
    const ev = defineEvidence('POSITION_GROUP_SIZE', { ...src, data: { position: 'DEFENSE', count: 3, squadSize: 28 } });
    expect(ev.sourceUrl).toBeNull();
    expect(operatorFactsFor(ev).qualification.sourceUrl).toBeNull();
  });

  it('carries the field so a surface can tell "no link" from "no field"', () => {
    // The distinction the panel needs: an absent key is a contract change, a
    // null value is an honest "we have nothing to point you at".
    const ev = defineEvidence('POSITION_GROUP_SIZE', { ...src, data: { position: 'DEFENSE', count: 3, squadSize: 28 } });
    expect(ev).toHaveProperty('sourceUrl');
    expect(operatorFactsFor(ev).qualification).toHaveProperty('sourceUrl');
  });

  it('renders no link and implies none while the field is empty', () => {
    const ui = readFileSync(new URL('../../src/lib/evidenceProvenance.js', import.meta.url), 'utf8');
    const code = ui.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    // The drawer prints label/value rows. Nothing turns a value into an anchor.
    expect(code).not.toContain('href');
    expect(code).not.toContain('sourceUrl');
    expect(code).not.toMatch(/View source|Open source|see source/i);
  });
});

describe('provenance never reaches a coach', () => {
  it('is absent from every outbound clause', () => {
    /**
     * A cold email that cited its sources would read like a report, and the
     * claims are written to be checkable against the coach's own roster
     * instead. The copy layer is handed `facts` and never the evidence object,
     * so it has nothing to cite even if a clause wanted to.
     */
    const FACTS = {
      COACH_ARRIVAL_SAME_COUNTRY: { coach: 'Ali Simmons', country: 'New Zealand', count: 1, seasons: ['2025'] },
      ARRIVAL_SAME_COUNTRY_POSITION: { country: 'New Zealand', position: 'DEFENSE', count: 2, seasons: ['2023'] },
      HISTORICAL_SAME_COUNTRY: { country: 'New Zealand', count: 2, names: ['A', 'B'], seasons: ['2022'] },
      CURRENT_SAME_COUNTRY: { country: 'New Zealand', count: 1, names: ['A'] },
      ARRIVAL_SAME_REGION_POSITION: { countries: ['Australia'], position: 'DEFENSE', count: 1, seasons: ['2024'], widerThanOwnCountry: true, excludingCountry: 'New Zealand' },
      HISTORICAL_SAME_REGION: { countries: ['Australia'], count: 1, names: ['X'], widerThanOwnCountry: true, excludingCountry: 'New Zealand' },
      POSITION_GRADUATION: { position: 'DEFENSE', count: 3, names: ['A', 'B', 'C'], classYear: 2027 },
      ACADEMIC_FIT: { athleteStatedMajor: 'exercise science', programmeMatchedSubject: 'Kinesiology' },
      CONFERENCE_TITLE: { conference: 'ACC' },
      POSTSEASON_RESULT: { round: 'semi' },
    };
    for (const kind of OUTREACH_COPY_KINDS) {
      // Handed provenance-shaped fields it must ignore.
      const out = outreachCopyFor({
        kind,
        facts: { ...FACTS[kind], source: 'roster_players', sourceUrl: 'https://example.test/roster/2024', provenance: { supporting: [] } },
      }, { firstName: 'Rhys' });
      const text = out?.clause ?? out?.recognition ?? '';
      expect(text, kind).toBeTruthy();
      expect(text, kind).not.toContain('http');
      expect(text, kind).not.toMatch(/roster_players|source|according to|per our records/i);
    }
  });

  it('is not read by the outbound modules at all', () => {
    const strip = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    for (const rel of ['./outreachCopy.js', '../email/compose.js']) {
      for (const field of ['sourceUrl', 'provenance', '.source']) {
        expect(strip(rel), `${rel} :: ${field}`).not.toContain(field);
      }
    }
  });
});

describe('one claim, one provenance', () => {
  it('gives every kind a source and never a list of them', () => {
    // A provenance object may describe many records; it is still one object,
    // owned by one claim. No kind carries a parallel array of sources.
    for (const kind of EVIDENCE_KIND_NAMES) {
      const ev = defineEvidence(kind, {
        ...src,
        describes: { seasons: ['2024', '2025'], seasonsUnread: [], n: 4 },
        comparison: { basis: 'pool', statistic: 'median', poolSize: 900, band: 'above-p75' },
        data: {},
      });
      expect(typeof ev.source, kind).toBe('string');
      expect(Array.isArray(ev.source), kind).toBe(false);
      expect(ev, kind).not.toHaveProperty('sources');
      expect(ev, kind).not.toHaveProperty('sourceUrls');
    }
  });
});
