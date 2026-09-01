/**
 * The two Competitive Intelligence pages, and the contracts they have to keep.
 *
 * Most of this suite reads the STRINGS THE PAGES ACTUALLY DRAW rather than the
 * helpers behind them. A language rule asserted over `competitiveHistoryReading`
 * is a rule about one function; the same rule asserted over every string that
 * reaches `doc.text` is a rule about the page, and it is the page that a family
 * reads. Three phases of this report shipped a defect that every unit test
 * passed.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { render } from './philosophyPdf.js';
import {
  competitiveHistoryPage, competitiveEnvironmentPage, competitiveHistoryReading,
  competitiveEnvironmentReading, competitiveSentences, coverageLines, benchmarkLabel,
  BENCHMARK_LABEL,
} from './reportCompetitive.js';
import { competitiveHistory } from '../../shared/competitiveHistory.js';
import { competitivePackage, FORBIDDEN_READER_LANGUAGE, FORBIDDEN_STRUCTURAL, V1_FIELDS }
  from '../../shared/report/competitivePackage.js';
import { conferenceRecordRow } from '../../shared/conferenceHistory.js';
import { planSections, competitiveEnvironmentIsWorthAPage } from '../../shared/report/sections.js';

// ---------------------------------------------------------------------------
// Fixtures, built through the frozen package so the shape cannot drift
// ---------------------------------------------------------------------------

/** A comparison pool wide enough to clear MIN_POOL, centred where we ask. */
const pool = (centre) => ({ rates: Array.from({ length: 40 }, (_, i) => centre - 0.2 + (i * 0.4) / 39) });

/**
 * @param spec seasons as `{ season, w, l, d, division, conference, conferenceId,
 *   conferenceRecord, conferenceSize, rate }`
 */
function fixture(spec, { coach = null, missing = [], unreadable = [] } = {}) {
  const rows = spec.map((s) => ({
    season: s.season, wins: s.w, losses: s.l, draws: s.d,
    matchesPlayed: s.w + s.l + s.d, historicalDivision: s.division ?? null,
  }));
  const pools = {};
  for (const s of spec) {
    if (!s.division) continue;
    pools[s.season] = { ...(pools[s.season] ?? {}), [s.division]: pool(0.5) };
  }
  const history = competitiveHistory({ rows, pools, coachAttribution: coach });
  // `competitiveHistory` derives its own absences from the window; the two
  // lists are handed back in so a fixture can state a season nobody has.
  history.missingSeasons = missing.length ? missing : history.missingSeasons;
  history.unreadableSeasons = unreadable.length ? unreadable : history.unreadableSeasons;
  const structural = {
    rows: spec.filter((s) => s.conference).map((s) => ({
      season: s.season, conferenceId: s.conferenceId ?? s.conference, conferenceName: s.conference,
      historicalDivision: s.division ?? null, conferenceSize: s.conferenceSize ?? null,
      source: { provenance: 'NCAA_MEMBER_DIRECTORY', url: 'https://example.test' },
    })),
    conferenceRecords: spec.filter((s) => s.conferenceRecord).map((s) => conferenceRecordRow({
      season: s.season, record: s.conferenceRecord, conferenceName: s.conference,
      conferenceSize: s.conferenceSize ?? null,
    })),
  };
  const pkg = competitivePackage({ history, structural, coach });
  return { college: { name: 'Test College', sport: 'mens-soccer', division: 'NCAA D2' }, competitive: pkg };
}

const FULL = () => fixture([
  { season: 2022, w: 19, l: 1, d: 1, division: 'NCAA D2', conference: 'Test State Athletic Conference', conferenceRecord: '10-0-0', conferenceSize: 13 },
  { season: 2023, w: 14, l: 3, d: 1, division: 'NCAA D2', conference: 'Test State Athletic Conference', conferenceRecord: '7-2-1', conferenceSize: 13 },
  { season: 2024, w: 8, l: 7, d: 2, division: 'NCAA D1', conference: 'Test Northeast Conference', conferenceRecord: '5-1-2', conferenceSize: 9 },
  { season: 2025, w: 3, l: 10, d: 4, division: 'NCAA D1', conference: 'Test Northeast Conference', conferenceRecord: '3-5-1', conferenceSize: 10 },
]);

/** Four seasons of record and no structural evidence at all — 229 programmes. */
const RECORD_ONLY = () => fixture([
  { season: 2022, w: 6, l: 8, d: 6 }, { season: 2023, w: 5, l: 11, d: 1 },
  { season: 2024, w: 4, l: 12, d: 2 }, { season: 2025, w: 5, l: 6, d: 6 },
]);

const SINGLE = () => fixture([
  { season: 2023, w: 10, l: 7, d: 2, division: 'NCAA D3', conference: 'Test Heartland Conference', conferenceRecord: '3-5-1', conferenceSize: 10 },
]);

/** A gap in the middle of the window, and a move across it. */
const GAPPED = () => fixture([
  { season: 2022, w: 12, l: 3, d: 5, division: 'NAIA', conference: 'Test Pacific Conference', conferenceRecord: '7-0-4', conferenceSize: 13 },
  { season: 2024, w: 12, l: 1, d: 3, division: 'NAIA', conference: 'Test Pacific Conference', conferenceRecord: '6-0-1', conferenceSize: 8 },
  { season: 2025, w: 3, l: 10, d: 3, division: 'NCAA D2', conference: 'Test Collegiate Athletic Association', conferenceRecord: '2-7-1', conferenceSize: 11 },
]);

const EMPTY = () => ({
  college: { name: 'Test College', sport: 'mens-soccer', division: 'NCAA D3' },
  competitive: competitivePackage({ history: null }),
});

const ALL = () => ({ FULL: FULL(), RECORD_ONLY: RECORD_ONLY(), SINGLE: SINGLE(), GAPPED: GAPPED() });

/** Every string a page hands to pdfkit, in order. */
async function drawn(pageFn, model) {
  const strings = [];
  await render((k) => {
    let first = true;
    const addPage = k.doc.addPage.bind(k.doc);
    k.doc.addPage = (...a) => (first ? ((first = false), k.doc) : addPage(...a));
    const text = k.doc.text.bind(k.doc);
    k.doc.text = (str, ...rest) => {
      if (typeof str === 'string') strings.push(str);
      return text(str, ...rest);
    };
    pageFn(k, model);
  });
  return strings;
}

const bothPages = async (model) => [
  ...await drawn(competitiveHistoryPage, model),
  ...(competitiveEnvironmentIsWorthAPage(model.competitive)
    ? await drawn(competitiveEnvironmentPage, model) : []),
];

const SOURCE = fs.readFileSync(path.resolve(process.cwd(), 'server/lib/reportCompetitive.js'), 'utf-8');
/** The module's own text with the comments taken out, for source-level rules. */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------

describe('the data firewall', () => {
  it('reads model.competitive and nothing else', async () => {
    // Handed a model with NOTHING on it but the package, both pages draw. A page
    // that had reached for `colleges.division`, a roster row or the current
    // rating would throw here, which is the point.
    const only = { competitive: FULL().competitive };
    expect((await drawn(competitiveHistoryPage, only)).length).toBeGreaterThan(10);
    expect((await drawn(competitiveEnvironmentPage, only)).length).toBeGreaterThan(10);
  });

  it('imports no query module and contains no SQL', () => {
    expect(CODE).not.toMatch(/from\s+'[^']*(?:db\/client|Queries)\.js'/);
    expect(CODE).not.toMatch(/\b(?:SELECT|INSERT|UPDATE|DELETE)\b\s/i);
    expect(CODE).not.toMatch(/soccer_score|colleges\.division|football_ability/);
  });

  it('draws no INTERNAL_ONLY or DEFER field', async () => {
    const internal = Object.entries(V1_FIELDS)
      .filter(([, v]) => v.verdict === 'INTERNAL_ONLY' || v.verdict === 'DEFER')
      .map(([k]) => k);
    // The internal fields live under `internal` on every season, and the page
    // must not read that key at all — the frozen contract is what decides which
    // ones are drawable, so the test reads the contract rather than a list.
    expect(internal).toContain('conferenceTableRow');
    expect(CODE).not.toMatch(/\.internal\b/);
    for (const field of internal) {
      if (field === 'conferenceSize') continue;   // reached only inside frozen sentences
      expect(CODE).not.toContain(field);
    }
  });
});

describe('the language firewall', () => {
  it('draws no forbidden word on either page, in any coverage state', async () => {
    for (const [name, model] of Object.entries(ALL())) {
      for (const line of await bothPages(model)) {
        expect(FORBIDDEN_READER_LANGUAGE.test(line), `${name}: ${line}`).toBe(false);
        expect(FORBIDDEN_STRUCTURAL.test(line), `${name}: ${line}`).toBe(false);
      }
    }
  });

  it('has no forbidden word in its own source strings', () => {
    for (const literal of CODE.match(/'(?:[^'\\]|\\.)*'/g) ?? []) {
      expect(FORBIDDEN_READER_LANGUAGE.test(literal), literal).toBe(false);
    }
  });

  it('draws no score, grade, rating or ranking', async () => {
    for (const model of Object.values(ALL())) {
      for (const line of await bothPages(model)) {
        expect(line, line).not.toMatch(/\b(?:scores?|scored|grade[ds]?|grading|rating|ranked|ranking|rank|stars?|percentile)\b/i);
      }
    }
  });

  it('draws no arrow and no direction glyph', async () => {
    for (const model of Object.values(ALL())) {
      for (const line of await bothPages(model)) {
        expect(line, line).not.toMatch(/[←-⇿▲▼▴▾⬆⬇^v]{1}\s*$/);
        expect(line, line).not.toMatch(/[←-⇿▲▼⬆⬇]/);
      }
    }
  });
});

describe('the benchmark vocabulary', () => {
  it('is three labels and no others', async () => {
    const allowed = new Set(Object.values(BENCHMARK_LABEL));
    const seen = new Set();
    for (const model of Object.values(ALL())) {
      for (const line of await bothPages(model)) {
        if (/QUARTER|HALF/.test(line)) seen.add(line);
      }
    }
    for (const label of seen) expect(allowed.has(label), label).toBe(true);
    expect(seen.size).toBeGreaterThan(0);
  });

  it('gives the boundary to the middle half', () => {
    expect(benchmarkLabel({ available: true, percentile: 0.75 })).toBe(BENCHMARK_LABEL.MIDDLE);
    expect(benchmarkLabel({ available: true, percentile: 0.25 })).toBe(BENCHMARK_LABEL.MIDDLE);
    expect(benchmarkLabel({ available: true, percentile: 0.751 })).toBe(BENCHMARK_LABEL.UPPER);
    expect(benchmarkLabel({ available: true, percentile: 0.249 })).toBe(BENCHMARK_LABEL.LOWER);
  });

  it('has no label at all where the benchmark was refused', () => {
    expect(benchmarkLabel({ available: false, reason: 'nope' })).toBeNull();
    expect(benchmarkLabel(null)).toBeNull();
  });

  it('states the pool size wherever it states a position', async () => {
    const lines = await drawn(competitiveHistoryPage, FULL());
    const labels = lines.filter((l) => /QUARTER|HALF/.test(l)).length;
    const sizes = lines.filter((l) => /^of \d+ measured$/.test(l)).length;
    expect(labels).toBe(4);
    expect(sizes).toBe(4);
  });
});

describe('missing is not zero', () => {
  it('draws a season’s own rate even where there is no comparison', async () => {
    const lines = await drawn(competitiveHistoryPage, RECORD_ONLY());
    // Every record and every rate, and four statements that there is no
    // benchmark — never a zero, never a blank, never an implied position.
    for (const rec of ['6-8-6', '5-11-1', '4-12-2', '5-6-6']) expect(lines).toContain(rec);
    expect(lines.filter((l) => l === 'NO BENCHMARK')).toHaveLength(4);
    expect(lines.filter((l) => l === 'no division on file')).toHaveLength(4);
    for (const r of ['.450', '.324', '.278', '.471']) expect(lines).toContain(r);
    // '.000' is the axis floor, drawn once. It must never be a season's rate.
    expect(lines.filter((l) => l === '.000')).toHaveLength(1);
    expect(lines.filter((l) => /QUARTER|HALF/.test(l))).toHaveLength(0);
  });

  it('labels an unestablished season in the timeline rather than leaving it blank', async () => {
    const lines = await drawn(competitiveEnvironmentPage, GAPPED());
    expect(lines).toContain('no season read');       // 2023, which nobody has
    expect(lines.filter((l) => l === 'not established').length).toBe(0);
  });

  it('lists a season the conference published no record for, with a dash', async () => {
    const model = fixture([
      { season: 2022, w: 15, l: 4, d: 2, division: 'NCAA D3', conference: 'Test North Conference', conferenceRecord: '5-0-0', conferenceSize: 12 },
      { season: 2023, w: 13, l: 5, d: 3, division: 'NCAA D3', conference: 'Test North Conference', conferenceRecord: '6-0-0', conferenceSize: 14 },
      { season: 2024, w: 8, l: 6, d: 4, division: 'NCAA D3', conference: 'Test North Conference' },
      { season: 2025, w: 7, l: 9, d: 4, division: 'NCAA D3', conference: 'Test North Conference' },
    ]);
    const lines = await drawn(competitiveEnvironmentPage, model);
    // All four seasons in the table, and the two without a published record
    // print an em dash under a note that says what a dash is.
    for (const season of ['2022', '2023', '2024', '2025']) expect(lines).toContain(season);
    expect(lines.filter((l) => l === '—').length).toBeGreaterThanOrEqual(4);
    expect(lines.some((l) => /A dash is a record the conference did not publish/.test(l))).toBe(true);
  });

  it('never turns a refused figure into a midpoint', async () => {
    for (const model of Object.values(ALL())) {
      for (const line of await bothPages(model)) {
        expect(line, line).not.toMatch(/\bassum|\bestimated\b|\bapprox/i);
      }
    }
  });
});

describe('coverage is stated, never dropped', () => {
  it('names every season the package refuses', () => {
    const kinds = ['SEASON_NOT_READABLE', 'SEASON_ABSENT', 'POOL_TOO_SMALL', 'DIVISION_UNKNOWN',
      'CONFERENCE_UNKNOWN', 'RECORD_UNAVAILABLE', 'WINDOW_PARTIAL'];
    for (const model of Object.values(ALL())) {
      const pkg = model.competitive;
      const text = coverageLines(pkg, kinds).join(' ');
      const seasons = new Set(pkg.refusals.filter((r) => r.season).map((r) => String(r.season)));
      for (const season of seasons) expect(text, `${season} in ${text}`).toContain(season);
    }
  });

  it('prints the package’s own sentence verbatim where there is only one', () => {
    const pkg = SINGLE().competitive;
    const absent = pkg.refusals.filter((r) => r.kind === 'SEASON_ABSENT');
    expect(absent).toHaveLength(3);
    // Three of a kind is aggregated; one of a kind is quoted.
    const one = coverageLines({ refusals: [absent[0]] }, ['SEASON_ABSENT']);
    expect(one).toEqual([absent[0].text]);
  });

  it('states the structural absences on the history page when there is no environment page', async () => {
    const model = RECORD_ONLY();
    expect(competitiveEnvironmentIsWorthAPage(model.competitive)).toBe(false);
    const lines = await drawn(competitiveHistoryPage, model);
    expect(lines.some((l) => /conference membership could not be established/i.test(l))).toBe(true);
  });

  it('does not repeat those absences on the history page when the environment page exists', async () => {
    const model = GAPPED();
    expect(competitiveEnvironmentIsWorthAPage(model.competitive)).toBe(true);
    const lines = await drawn(competitiveHistoryPage, model);
    expect(lines.some((l) => /conference membership could not be established/i.test(l))).toBe(false);
  });
});

describe('the historical-movement invariant', () => {
  it('states both seasons and both divisions, and no direction', async () => {
    const lines = await drawn(competitiveEnvironmentPage, FULL());
    const move = lines.find((l) => /moved from/.test(l));
    expect(move).toBeTruthy();
    expect(move).toContain('NCAA Division II');
    expect(move).toContain('NCAA Division I');
    expect(move).toContain('2024');
    expect(move).not.toMatch(/\bup\b|\bdown\b|\bstep\b/i);
  });

  it('carries the caveat that a division change is not a direction', async () => {
    const lines = await drawn(competitiveEnvironmentPage, FULL());
    expect(lines.some((l) => /never a step in any direction|not presented as a step|and nothing more/i.test(l))).toBe(true);
  });

  it('draws every division block the same way', () => {
    // One fill, one opacity, one stroke for a known block, whichever division
    // it names. A palette keyed on the division would rank the divisions.
    expect(CODE).not.toMatch(/NCAA D1['"]?\s*[:?]/);
    expect(CODE.match(/fillOpacity\(0\.07\)\.fill\(NAVY\)/g) ?? []).toHaveLength(1);
  });
});

describe('conference records are never compared across conferences', () => {
  it('groups the table by conference', async () => {
    const lines = await drawn(competitiveEnvironmentPage, FULL());
    expect(lines).toContain('TEST STATE ATHLETIC CONFERENCE');
    expect(lines).toContain('TEST NORTHEAST CONFERENCE');
  });

  it('says so in words where the seasons span two conferences', async () => {
    const said = competitiveEnvironmentReading(FULL());
    expect(said.some((s) => /cannot be compared with each other/.test(s))).toBe(true);
  });

  it('says the opposite where they do not', async () => {
    const model = fixture([
      { season: 2024, w: 6, l: 7, d: 6, division: 'NAIA', conference: 'Test Wolverine Conference', conferenceRecord: '5-4-3', conferenceSize: 13 },
      { season: 2025, w: 7, l: 8, d: 4, division: 'NAIA', conference: 'Test Wolverine Conference', conferenceRecord: '3-4-4', conferenceSize: 12 },
    ]);
    const said = competitiveEnvironmentReading(model);
    expect(said.some((s) => /Both of the conference records/.test(s))).toBe(true);
  });
});

describe('the coach block', () => {
  const coach = (attributed) => ({
    currentCoach: { name: 'A Coach' },
    currentCoachReason: 'named on the 2026 roster',
    measuredSeasons: [2022, 2023, 2024, 2025].map((season) => ({
      season, attribution: attributed.includes(season) ? 'CURRENT_COACH' : 'PREVIOUS_COACH',
    })),
  });

  it('states a count and its denominator, with the seasons', async () => {
    const model = fixture([
      { season: 2022, w: 9, l: 8, d: 2, division: 'NCAA D2', conference: 'Test State Athletic Conference', conferenceRecord: '4-4-1', conferenceSize: 12 },
      { season: 2023, w: 9, l: 8, d: 2, division: 'NCAA D2', conference: 'Test State Athletic Conference', conferenceRecord: '4-4-1', conferenceSize: 12 },
      { season: 2024, w: 9, l: 8, d: 2, division: 'NCAA D2', conference: 'Test State Athletic Conference', conferenceRecord: '4-4-1', conferenceSize: 12 },
      { season: 2025, w: 9, l: 8, d: 2, division: 'NCAA D2', conference: 'Test State Athletic Conference', conferenceRecord: '4-4-1', conferenceSize: 12 },
    ], { coach: coach([2024, 2025]) });
    const lines = await drawn(competitiveHistoryPage, model);
    const said = lines.find((l) => /attributed to A Coach/.test(l));
    expect(said).toMatch(/^2 of the 4 seasons read here \(2024 and 2025\)/);
  });

  it('never splits the record before and after a coach', async () => {
    const model = fixture([
      { season: 2022, w: 3, l: 14, d: 2, division: 'NCAA D2', conference: 'Test State Athletic Conference', conferenceRecord: '1-8-1', conferenceSize: 12 },
      { season: 2025, w: 16, l: 2, d: 2, division: 'NCAA D2', conference: 'Test State Athletic Conference', conferenceRecord: '9-1-0', conferenceSize: 12 },
    ], { coach: coach([2025]) });
    for (const line of await bothPages(model)) {
      expect(line, line).not.toMatch(/\bbefore\b.*\bcoach|\bcoach\b.*\bsince\b|under (?:the )?(?:new|previous) coach/i);
      expect(line, line).not.toMatch(/\bunder A Coach\b/);
    }
  });

  it('carries the caveat that a count is not a cause', async () => {
    const model = fixture([{ season: 2025, w: 9, l: 8, d: 2, division: 'NCAA D2' }], { coach: coach([2025]) });
    const lines = await drawn(competitiveHistoryPage, model);
    expect(lines.some((l) => /cannot separate a coach from/.test(l))).toBe(true);
  });

  it('says nothing at all where there is no coach model', async () => {
    const lines = await drawn(competitiveHistoryPage, FULL());
    expect(lines.some((l) => /attributed/.test(l))).toBe(false);
  });
});

describe('the sparse states', () => {
  it('draws four, three, two and one readable season without inventing the rest', async () => {
    const spec = [
      { season: 2022, w: 9, l: 8, d: 2, division: 'NCAA D3', conference: 'Test Heartland Conference', conferenceRecord: '4-4-1', conferenceSize: 10 },
      { season: 2023, w: 10, l: 7, d: 2, division: 'NCAA D3', conference: 'Test Heartland Conference', conferenceRecord: '5-3-1', conferenceSize: 10 },
      { season: 2024, w: 11, l: 6, d: 2, division: 'NCAA D3', conference: 'Test Heartland Conference', conferenceRecord: '6-2-1', conferenceSize: 10 },
      { season: 2025, w: 12, l: 5, d: 2, division: 'NCAA D3', conference: 'Test Heartland Conference', conferenceRecord: '7-1-1', conferenceSize: 10 },
    ];
    for (const n of [4, 3, 2, 1]) {
      const model = fixture(spec.slice(0, n));
      const lines = await bothPages(model);
      expect(lines.some((l) => l === `${n} of 4`), `${n}: denominator`).toBe(true);
      // No season the fixture does not have.
      for (const s of spec.slice(n)) {
        expect(lines.some((l) => l === s.conferenceRecord), `${n}: ${s.season}`).toBe(false);
      }
      const read = competitiveHistoryReading(model);
      expect(read[0]).toContain(n === 1 ? 'one season' : `${n} seasons`);
    }
  });

  it('says a single season is a single season', async () => {
    const lines = await drawn(competitiveHistoryPage, SINGLE());
    expect(lines.some((l) => /One season is one season/.test(l))).toBe(true);
    // The highest and the lowest are the same season, so neither row is drawn.
    expect(lines.some((l) => /Highest of the seasons read/.test(l))).toBe(false);
  });

  it('plans neither page where no season can be read', () => {
    const model = EMPTY();
    expect(model.competitive.available).toBe(false);
    expect(competitiveEnvironmentIsWorthAPage(model.competitive)).toBe(false);
    const plan = planSections({ model, summary: null, philosophy: null });
    expect(plan.map((s) => s.id).filter((id) => id.startsWith('competitive-'))).toEqual([]);
  });

  it('plans the history page alone where there is a record and no structure', () => {
    const model = RECORD_ONLY();
    const plan = planSections({ model, summary: null, philosophy: null });
    expect(plan.map((s) => s.id).filter((id) => id.startsWith('competitive-')))
      .toEqual(['competitive-history']);
  });
});

describe('the running order', () => {
  it('files both pages in the programme-evidence act, after the roster material', () => {
    const model = { ...FULL(), lifecycle: null, squad: { rostered: 0 }, athlete: null };
    const plan = planSections({ model, summary: null, philosophy: null });
    const ids = plan.map((s) => s.id);
    const history = ids.indexOf('competitive-history');
    const environment = ids.indexOf('competitive-environment');
    expect(history).toBeGreaterThan(-1);
    expect(environment).toBe(history + 1);
    for (const s of plan.filter((x) => x.id.startsWith('competitive-'))) {
      expect(s.layer).toBe('programme-evidence');
      expect(s.act).toBe('programme-evidence');
      expect(s.scope).toBe('programme');
    }
    // Before the supporting record, whichever of those sections this model has.
    const supporting = plan.findIndex((s) => s.layer === 'supporting');
    if (supporting > -1) expect(environment).toBeLessThan(supporting);
  });

  it('describes its own scope for the contents page', () => {
    const plan = planSections({ model: FULL(), summary: null, philosophy: null });
    const history = plan.find((s) => s.id === 'competitive-history');
    expect(history.scopeNotes).toEqual(['4 of 4 seasons read', '4 compared against its own division']);
    const environment = plan.find((s) => s.id === 'competitive-environment');
    expect(environment.scopeNotes).toEqual(['conference on file for 4 of 4', 'division on file for 4']);
  });
});

describe('the two pages answer two questions', () => {
  it('asks the record question on one and the environment question on the other', async () => {
    const history = await drawn(competitiveHistoryPage, FULL());
    const environment = await drawn(competitiveEnvironmentPage, FULL());
    expect(history).toContain('How has this programme competed across the seasons we can measure?');
    expect(environment).toContain('Where were these results produced?');
    // Neither question appears on the other's page.
    expect(environment.some((l) => /across the seasons we can measure/.test(l))).toBe(false);
    expect(history.some((l) => /Where were these results produced/.test(l))).toBe(false);
  });

  it('keeps the benchmark on the record page and the membership on the other', async () => {
    const history = await drawn(competitiveHistoryPage, FULL());
    const environment = await drawn(competitiveEnvironmentPage, FULL());
    expect(history.some((l) => /QUARTER|HALF/.test(l))).toBe(true);
    expect(environment.some((l) => /QUARTER|HALF/.test(l))).toBe(false);
    expect(environment).toContain('Test State Athletic Conference');
  });
});

describe('competitiveSentences', () => {
  it('collects every authored sentence both pages can draw', () => {
    const all = competitiveSentences(FULL());
    expect(all.length).toBeGreaterThan(6);
    for (const line of all) {
      expect(FORBIDDEN_READER_LANGUAGE.test(line), line).toBe(false);
      expect(typeof line).toBe('string');
    }
  });
});
