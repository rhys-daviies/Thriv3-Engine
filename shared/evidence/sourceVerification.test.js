import { describe, it, expect } from 'vitest';
import {
  verifyRosterSource, SOURCE_STATUS, safeUrl, canonicalHost, DIRECTLY_VERIFIABLE_KINDS,
} from './sourceVerification.js';
import { buildProgrammeContext, generateEvidence } from './generate.js';
import { outreachCopyFor, OUTREACH_COPY_KINDS } from './outreachCopy.js';
import { EVIDENCE_KIND_NAMES } from './kinds.js';
import { readFileSync } from 'node:fs';

/**
 * WHEN A PAGE MAY BE OFFERED AS A SOURCE.
 *
 * The cost is asymmetric, and that asymmetry is the whole design. A missing
 * link costs an operator a click they cannot make. A wrong link costs them the
 * belief that any of the panel is checkable — and H11 found Stonehill's 2025
 * roster row pointing at Stanton's athletics site, so that failure is already
 * in the data rather than hypothetical.
 *
 * So the gate refuses on every doubt: an unparseable URL, a player bio, a host
 * nobody verified, an institution id that disagrees, a season that is not the
 * one the claim is about. Null is a correct answer and the panel says nothing
 * about it.
 */

const UCONN = 129020;
const OTHER = 195809;
const domains = new Map([['judolphins.com', UCONN], ['redstormsports.com', OTHER]]);
const ok = (over = {}) => verifyRosterSource({
  url: 'https://judolphins.com/sports/mens-soccer/roster/2026',
  unitid: UCONN, season: '2026', urlSeason: '2026', verifiedDomains: domains, ...over,
});

describe('a page is offered only when everything checks', () => {
  it('accepts a verified host on the right institution and season', () => {
    const r = ok();
    expect(r.status).toBe(SOURCE_STATUS.VERIFIED_DIRECT);
    expect(r.url).toBe('https://judolphins.com/sports/mens-soccer/roster/2026');
  });

  it('ignores a leading www when matching the host', () => {
    expect(ok({ url: 'https://www.judolphins.com/sports/mens-soccer/roster/2026' }).status)
      .toBe(SOURCE_STATUS.VERIFIED_DIRECT);
    expect(canonicalHost('WWW.Example.COM')).toBe('example.com');
  });

  it('refuses a host whose institution id disagrees', () => {
    // Six of the ten live cases are a registry id that disagrees while naming
    // the right school. We cannot tell that from a genuinely wrong host, and
    // refusing is the only safe answer to not knowing.
    expect(ok({ url: 'https://redstormsports.com/sports/mens-soccer/roster/2026' }).status)
      .toBe(SOURCE_STATUS.INSTITUTION_MISMATCH);
  });

  it('refuses a host nobody has verified', () => {
    expect(ok({ url: 'https://someschool.com/sports/mens-soccer/roster/2026' }).status)
      .toBe(SOURCE_STATUS.UNVERIFIED_HOST);
  });

  it('refuses a programme with no institution id to check against', () => {
    expect(ok({ unitid: null }).status).toBe(SOURCE_STATUS.UNKNOWN_INSTITUTION);
  });

  it('refuses a player bio, including one whose path contains "roster"', () => {
    // Both real shapes. The second is the one a naive "does it say roster"
    // test would wave through.
    expect(ok({ url: 'https://judolphins.com/sports/msoc/2024-25/bios/tinner_loic' }).status)
      .toBe(SOURCE_STATUS.PLAYER_BIO);
    expect(ok({ url: 'https://judolphins.com/sports/mens-soccer/roster/player/owen-purvis' }).status)
      .toBe(SOURCE_STATUS.PLAYER_BIO);
  });

  it('accepts the roster shapes the providers actually use', () => {
    for (const path of ['/sports/mens-soccer/roster/2026', '/sports/msoc/roster/2026',
      '/sports/msoc/2026-27/roster', '/sports/msoc/2026-27/roster?view=table']) {
      expect(ok({ url: `https://judolphins.com${path}` }).status, path)
        .toBe(SOURCE_STATUS.VERIFIED_DIRECT);
    }
  });

  it('refuses a page that is not a roster at all', () => {
    expect(ok({ url: 'https://judolphins.com/news/2026/09/01/soccer-preview' }).status)
      .toBe(SOURCE_STATUS.OTHER_SHAPE);
  });
});

describe('nothing unsafe is ever returned', () => {
  it('refuses javascript:, data:, relative and empty', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<b>x', '/sports/roster/2026',
      '//judolphins.com/roster/2026', 'file:///etc/passwd', '', '   ', null, undefined, 42]) {
      const r = ok({ url: bad });
      expect(r.url, String(bad)).toBeNull();
      expect([SOURCE_STATUS.MALFORMED, SOURCE_STATUS.MISSING], String(bad)).toContain(r.status);
    }
  });

  it('parses only absolute http(s) URLs', () => {
    expect(safeUrl('https://a.test/roster/2026')).toBeTruthy();
    expect(safeUrl('http://a.test/roster/2026')).toBeTruthy();
    for (const bad of ['javascript:x', 'data:x', 'ftp://a.test/x', 'a.test/x', '']) {
      expect(safeUrl(bad), bad).toBeNull();
    }
  });
});

describe('the season is the claim\'s, never the nearest one', () => {
  it('refuses a URL recorded for a different season', () => {
    // A 2026 claim linked to the 2025 roster would show a squad that has since
    // turned over. There is no fallback, however well the host verifies.
    expect(ok({ urlSeason: '2025' }).status).toBe(SOURCE_STATUS.MISSING);
    expect(ok({ urlSeason: '2025' }).url).toBeNull();
  });
});

describe('school identity is matched, never guessed', () => {
  it('resolves on institution id and not on the name', () => {
    /**
     * 71 hosts differ from their college row only by naming variant — "Avila"
     * against "Avila University". Deciding those by string similarity would be
     * a guess wearing a check's clothes, so the rule compares IPEDS ids and
     * the helper is never handed a name at all.
     */
    const code = readFileSync(new URL('./sourceVerification.js', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
    for (const guess of ['levenshtein', 'similarity', 'fuzzy', 'startsWith', 'toLowerCase().includes']) {
      expect(code, guess).not.toContain(guess);
    }
    expect(code).toContain('unitid');
    // The helper is never handed a school name, so it cannot compare one.
    expect(code).not.toContain('collegeName');
    expect(code).not.toContain('claimed_keys');
  });
});

describe('only the four kinds one page can prove carry a link', () => {
  const row = (o = {}) => ({
    college_name: 'Test', sport: 'mens-soccer', season: '2026',
    player_name: 'A Player', position: 'D', minutes_played: null,
    class_year_label: 'Jr.', nationality: 'USA', country: '',
    estimated_graduation_year: 2027, eligibility_end_year: 2027,
    projected_minutes: 600, prior_programme: null,
    updated_date: new Date().toISOString().slice(0, 10), ...o,
  });
  const athlete = {
    full_name: 'Rhys Davies', position: 'Defender', country: 'New Zealand',
    nationality: 'New Zealand', recruiting_class_year: 2027, sport: 'mens-soccer',
  };
  const URL_ = 'https://judolphins.com/sports/mens-soccer/roster/2026';
  const evidence = () => generateEvidence(athlete, buildProgrammeContext({
    college: { name: 'Test', sport: 'mens-soccer' }, sport: 'mens-soccer',
    rosterSource: { status: 'VERIFIED_DIRECT', url: URL_ },
    squad: [
      ...Array.from({ length: 24 }, (_, i) => row({ player_name: `P${i}` })),
      ...Array.from({ length: 4 }, (_, i) => row({ player_name: `I${i}`, nationality: 'International', country: 'Spain' })),
      row({ player_name: 'Kiwi Now', nationality: 'International', country: 'New Zealand' }),
    ],
    history: [row({ season: '2024', minutes_played: 600 })],
    match: { graduating_at_position: 2, graduating_names_at_position: ['P0', 'P1'], roster_season: '2026', graduating_total: 3 },
  }));

  it('links exactly the directly-verifiable kinds', () => {
    const linked = evidence().filter((e) => e.sourceUrl).map((e) => e.kind).sort();
    expect(linked).toEqual([...DIRECTLY_VERIFIABLE_KINDS].sort());
    for (const e of evidence()) {
      if (e.sourceUrl) expect(e.sourceUrl, e.kind).toBe(URL_);
    }
  });

  it('leaves every derived and aggregate claim without one', () => {
    /**
     * The graduation kinds read the same rows and must NOT link: their year
     * comes from `eligibility_end_year`, which the importer records as "only
     * ever derived" — the page prints a class label and we do the arithmetic.
     * Linking it would offer to prove the half we computed.
     */
    const NEVER = ['POSITION_GRADUATION', 'SQUAD_GRADUATION', 'POSITION_GRADUATION_STARTERS',
      'ELIGIBILITY_CLIFF', 'RETURNING_POSITION_DEPTH', 'POSITION_GROUP_SCARCITY',
      'TRANSFER_BEHAVIOUR', 'HISTORICAL_SAME_COUNTRY', 'HISTORICAL_SAME_REGION',
      'COACH_ARRIVAL_SAME_COUNTRY', 'ARRIVAL_SAME_COUNTRY_POSITION',
      'ARRIVAL_SAME_REGION_POSITION', 'POSITION_INTAKE_HISTORY', 'COACH_CONTEXT',
      'FRESHMAN_MINUTES_LADDER', 'ATHLETE_COHORT_LADDER', 'PROGRAMME_POOL_BENCHMARK',
      'PROGRAMME_DEVELOPMENT_PATTERN', 'ACADEMIC_FIT', 'CONFERENCE_TITLE',
      'POSTSEASON_RESULT', 'PROGRAM_MOMENTUM', 'INTERNATIONAL_ROSTER'];
    for (const e of evidence()) {
      if (NEVER.includes(e.kind) && !DIRECTLY_VERIFIABLE_KINDS.includes(e.kind)) {
        expect(e.sourceUrl, e.kind).toBeNull();
      }
    }
    // And the list is a real subset — nobody has quietly widened it.
    expect(DIRECTLY_VERIFIABLE_KINDS).toHaveLength(4);
    for (const k of DIRECTLY_VERIFIABLE_KINDS) expect(EVIDENCE_KIND_NAMES).toContain(k);
  });

  it('links nothing when the source did not verify', () => {
    const none = generateEvidence(athlete, buildProgrammeContext({
      college: { name: 'Test', sport: 'mens-soccer' }, sport: 'mens-soccer',
      rosterSource: { status: 'UNVERIFIED_HOST', url: null },
      squad: [row({ player_name: 'Kiwi Now', nationality: 'International', country: 'New Zealand' }),
        ...Array.from({ length: 24 }, (_, i) => row({ player_name: `P${i}` }))],
    }));
    expect(none.filter((e) => e.sourceUrl)).toEqual([]);
  });

  it('links nothing for a caller with no database at all', () => {
    const none = generateEvidence(athlete, buildProgrammeContext({
      college: { name: 'Test', sport: 'mens-soccer' }, sport: 'mens-soccer',
      squad: [row({ player_name: 'Kiwi Now', nationality: 'International', country: 'New Zealand' }),
        ...Array.from({ length: 24 }, (_, i) => row({ player_name: `P${i}` }))],
    }));
    expect(none.filter((e) => e.sourceUrl)).toEqual([]);
  });
});

describe('a link is operator provenance and nothing else', () => {
  it('never reaches a coach, however the facts are handed over', () => {
    const FACTS = {
      COACH_ARRIVAL_SAME_COUNTRY: { coach: 'A', country: 'New Zealand', count: 1, seasons: ['2025'] },
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
      const out = outreachCopyFor({
        kind,
        facts: { ...FACTS[kind], sourceUrl: 'https://judolphins.com/sports/mens-soccer/roster/2026' },
      }, { firstName: 'Rhys' });
      const text = out?.clause ?? out?.recognition ?? '';
      expect(text, kind).toBeTruthy();
      expect(text, kind).not.toContain('judolphins');
      expect(text, kind).not.toMatch(/http|see |source/i);
    }
  });
});
