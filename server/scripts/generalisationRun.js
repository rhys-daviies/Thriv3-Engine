#!/usr/bin/env node
/**
 * Drives the four validation personas through the REAL production path.
 *
 *   npm run test:generalisation     the suite, with these findings printed
 *   node server/scripts/generalisationRun.js          the report on its own
 *   node server/scripts/generalisationRun.js --json   for the suite
 *
 * OBSERVES, NEVER REIMPLEMENTS. Every scenario calls `evidenceFor` and
 * `emailBodyFor` exactly as a draft does, so what is measured is production
 * behaviour and not a second engine that agrees with it.
 *
 * NOTHING IS INSERTED. The personas are objects; `evidenceFor` takes one. The
 * canonical corpus stays four athletes and every Stage J baseline stays put.
 *
 * PAIRS WERE CHOSEN FROM FACTS, BEFORE ANY OUTPUT WAS READ — from
 * `recruiting_arrivals` and `roster_players`, by the branch each was meant to
 * exercise. Choosing a programme because its email already looked right would
 * have made this a screenshot of production rather than a test of it.
 */
import 'dotenv/config';
import db from '../db/client.js';
import { evidenceFor } from '../lib/evidenceQueries.js';
import { loadProgrammePatterns } from '../lib/recruitingPatterns.js';
import { RECRUITING_EVIDENCE_SPORTS } from '../../shared/evidence/generate.js';
import { DATA_STATUS } from '../../shared/recruiting/patterns.js';
import { emailBodyFor, buildEmailContext, fillTemplate } from '../../src/lib/emailTemplate.js';
import { K_EU, K_DOM, K_ASIA, K_TIGHT } from '../../shared/evidence/__fixtures__/validationAthletes.js';

const JSON_MODE = process.argv.includes('--json');

/**
 * NOT a fifth persona. K1 designed four and four is what the corpus holds.
 *
 * K-TIGHT is women's soccer, and women's soccer turns out to be unlicensed for
 * every recruiting-pattern kind (see `sportLicence` below). That confounds the
 * tight-region question: a null at Appalachian State could mean "UK_IRELAND is
 * too tight to fire" or "this sport generates no regional Evidence at all",
 * and Task E needs those told apart. This probe is K-TIGHT with one field
 * changed, run at a men's programme with six UK_IRELAND midfield arrivals, so
 * the sport gate is open and only granularity is under test.
 */
const K_TIGHT_M = Object.freeze({ ...K_TIGHT, id: 'K-TIGHT-M', sport: 'mens-soccer' });

/**
 * The expectation table, written before the run.
 *
 * `expect` is what K1 predicted; the report says whether it held. Programmes
 * were selected from arrival and roster facts:
 *
 *   Akron            four European DEFENSE arrivals 2025-26 (Austria, Belgium,
 *                    Greece, Portugal) and no Norwegian — the multi-country case
 *   Bethany Lutheran two Portuguese DEFENSE arrivals 2025, no Norwegian
 *   Bowling Green    a Portuguese DEFENSE arrival whose newest season is 2023
 *   McKendree        a Chinese FORWARD arrival 2026, no Japanese
 *   Appalachian St   a British MIDFIELD arrival 2026, women's, no Irish
 */
const SCENARIOS = [
  { persona: K_EU, college: 'Akron', scenario: 'K-EU/REGIONAL_RECENT_MULTI',
    expect: 'a recent regional arrival at the athlete\'s position, naming several European countries' },
  { persona: K_EU, college: 'Alfred University', scenario: 'K-EU/REGIONAL_STALE',
    expect: 'nothing regional — every European arrival at defence is 2023 or older' },
  { persona: K_EU, college: 'Jacksonville', scenario: 'K-EU/SAME_COUNTRY_OR_GENERIC',
    expect: 'whatever Norway supports here; no academic claim, since the persona has no major' },
  { persona: K_ASIA, college: 'McKendree', scenario: 'K-ASIA/REGIONAL_RECENT',
    expect: 'a recent regional arrival at forward, naming a non-Japanese Asian country' },
  { persona: K_ASIA, college: 'Akron', scenario: 'K-ASIA/REGIONAL_ABSENT',
    expect: 'no regional claim — Akron\'s European arrivals are not in ASIA' },
  { persona: K_TIGHT, college: 'Appalachian State', scenario: 'K-TIGHT/REGIONAL_RECENT',
    expect: 'a recent British arrival at midfield — the tight-region control' },
  { persona: K_TIGHT, college: 'Akron', scenario: 'K-TIGHT/ACADEMIC_OR_GENERIC',
    expect: 'no regional claim; nursing may or may not match' },
  { persona: K_DOM, college: 'Jacksonville', scenario: 'K-DOM/DOMESTIC_1',
    expect: 'no international kind at all; graduation/academic/recognition only' },
  { persona: K_DOM, college: 'Akron', scenario: 'K-DOM/DOMESTIC_2',
    expect: 'the same, at a programme rich in European arrivals it cannot use' },
  { persona: K_DOM, college: 'California', scenario: 'K-DOM/GOALKEEPER_GRADUATION',
    expect: 'a goalkeeper cohort graduating in 2027 — four of them on the 2026 roster' },
  { persona: K_DOM, college: 'Adelphi', scenario: 'K-DOM/GOALKEEPER_GRADUATION_2',
    expect: 'a smaller goalkeeper cohort, testing singular/plural agreement' },
  { persona: K_TIGHT_M, college: 'USC Upstate', scenario: 'K-TIGHT-M/TIGHT_REGION_ISOLATED',
    expect: 'a UK_IRELAND midfield claim — tight region with the sport gate open' },
  { persona: K_EU, college: 'Palm Beach Atlantic', scenario: 'K-EU/POSITION_FLOW_HOLD',
    expect: 'both sides of the J4 pair are available at defence — POSITION_GRADUATION must be HELD' },
  { persona: K_EU, college: 'Bridgeport', scenario: 'K-EU/POSITION_FLOW_HOLD_2',
    expect: 'the same, at a second programme — the hold must not be a one-programme accident' },

  /*
   * K2N — negative controls. A suite of positives measures whether a claim can
   * be produced; only a negative measures whether it can be produced when it
   * should not be. Morningside has a 61-player roster and ZERO rows in
   * `recruiting_arrivals`, so every kind that asserts somebody ARRIVED must be
   * absent for all four personas.
   *
   * ROSTER-SOURCED KINDS ARE NOT IN THAT LIST, and the first run of this
   * control is why the distinction is written down. K-EU renders
   * `HISTORICAL_SAME_COUNTRY` here — "Even Bjornstad came through the
   * programme from Norway in 2025" — which looked like a leak and is not one:
   * he is on the 2025 roster with `country = 'Norway'`. Morningside has no
   * arrival because no prior->current transition was reconciled for him, not
   * because no Norwegian was there. A control that failed on this would be
   * demanding the engine forget a true fact.
   */
  { persona: K_EU, college: 'Morningside', scenario: 'K2N/K-EU/NO_ARRIVAL_DATA',
    expect: 'no arrival kind of any shape; roster-derived kinds only' },
  { persona: K_ASIA, college: 'Morningside', scenario: 'K2N/K-ASIA/NO_ARRIVAL_DATA',
    expect: 'the same' },
  { persona: K_DOM, college: 'Morningside', scenario: 'K2N/K-DOM/NO_ARRIVAL_DATA',
    expect: 'the same, and domestic on top of it' },
  { persona: K_TIGHT_M, college: 'Morningside', scenario: 'K2N/K-TIGHT-M/NO_ARRIVAL_DATA',
    expect: 'the same' },
];

/**
 * Kinds sourced from `recruiting_arrivals`. None may appear in a K2N email.
 *
 * `HISTORICAL_SAME_COUNTRY`, `HISTORICAL_SAME_REGION` and `CURRENT_SAME_COUNTRY`
 * read `roster_players` instead and are deliberately absent from this list.
 */
const ARRIVAL_SOURCED = Object.freeze(['ARRIVAL_SAME_COUNTRY_POSITION',
  'ARRIVAL_SAME_REGION_POSITION', 'COACH_ARRIVAL_SAME_COUNTRY', 'POSITION_INTAKE_HISTORY']);

/** The tokens J5 and J6 retired. None may resolve for any persona. */
const RETIRED = ['graduating_seniors_count', 'graduating_seniors_names', 'has_graduating_seniors',
  'graduating_starters_names', 'graduating_total_count', 'international_players_count',
  'players_from_country_count', 'is_conference_champion', 'postseason_round_label',
  'has_postseason_result', 'intended_major_label'];

/**
 * The eleven hand-picked scenarios can show that a defect exists. They cannot
 * show how often it fires, and "how often" is the whole product question K3
 * has to answer. So the regional clause is also driven at scale: two personas
 * against 400 men's programmes each, through the same `evidenceFor` the
 * scenarios use, counting only clauses production actually rendered.
 *
 * Men's only, because that is the only sport licensed to render one at all.
 */
const SCALE_PROGRAMME_LIMIT = 400;

/** Countries whose name needs a definite article after "from". */
const NEEDS_ARTICLE = /^(United Kingdom|United States|Netherlands|Philippines|Czech Republic|Dominican Republic|Ivory Coast|Gambia|Bahamas|Maldives|United Arab Emirates)$/;

function scaleScan() {
  const out = { rendered: 0, staleSpan: 0, countryN: {}, needsArticle: 0, examples: [] };
  for (const persona of [K_EU, K_ASIA]) {
    const programmes = db.prepare(
      `SELECT DISTINCT programme FROM recruiting_arrivals
       WHERE sport = 'mens-soccer' AND arrival_confidence = 'DIRECT'
         AND region IS NOT NULL AND country <> ? LIMIT ?`,
    ).all(persona.nationality, SCALE_PROGRAMME_LIMIT).map((r) => r.programme);

    for (const college of programmes) {
      let ev;
      try { ev = evidenceFor(persona, college, { sport: persona.sport }); } catch { continue; }
      const sentence = (ev.composition?.sentences ?? [])
        .find((x) => x.kind === 'ARRIVAL_SAME_REGION_POSITION');
      if (!sentence) continue;
      const roles = ev.roles ?? { hooks: [], relevance: [], recognition: [] };
      const facts = [...roles.hooks, ...roles.relevance, ...roles.recognition]
        .find((i) => i.kind === 'ARRIVAL_SAME_REGION_POSITION')?.facts;
      const years = [...new Set((facts?.seasons ?? []).map(Number))].filter(Number.isFinite);
      const countries = facts?.countries ?? [];

      out.rendered += 1;
      out.countryN[countries.length] = (out.countryN[countries.length] ?? 0) + 1;
      if (countries.some((c) => NEEDS_ARTICLE.test(String(c)))) out.needsArticle += 1;
      if (years.length > 1 && Math.min(...years) !== Math.max(...years)) {
        out.staleSpan += 1;
        if (out.examples.length < 4) {
          out.examples.push({
            persona: persona.id,
            college,
            printed: Math.min(...years),
            qualifiedOn: Math.max(...years),
            text: sentence.text,
          });
        }
      }
    }
  }
  return out;
}

const newestSeason = (facts) => {
  const yrs = (facts?.seasons ?? []).map((s) => Number(String(s))).filter(Number.isFinite);
  return yrs.length ? Math.max(...yrs) : null;
};

function run() {
  const scenarios = [];
  for (const { persona, college, scenario, expect } of SCENARIOS) {
    const row = db.prepare('SELECT name FROM colleges WHERE name = ? AND sport = ?').get(college, persona.sport);
    if (!row) { scenarios.push({ scenario, persona: persona.id, college, missing: true }); continue; }
    const ev = evidenceFor(persona, college, { sport: persona.sport });
    const roles = ev.roles ?? { hooks: [], relevance: [], recognition: [] };
    const items = new Map([...roles.hooks, ...roles.relevance, ...roles.recognition,
      ...(ev.alternatives ?? [])].map((i) => [i.kind, i.facts]));
    const sentences = (ev.composition?.sentences ?? []).map((s) => ({ slot: s.slot, kind: s.kind, text: s.text }));
    const disp = ev.dispositions ?? [];
    const heldNote = disp.find((x) => x.disposition === 'HELD');
    const body = emailBodyFor(persona, { name: college }, 'Coach Validation',
      { evidence: ev, profileUrl: 'https://validation.invalid/p' }).body;

    /* The bypass attempt, with the richest college object the row supports. */
    const full = db.prepare('SELECT * FROM colleges WHERE name = ? AND sport = ?').get(college, persona.sport);
    const ctx = buildEmailContext(persona, full, 'Coach', { evidence: ev });
    const bypass = fillTemplate(RETIRED.map((t) => `{{#if ${t}}}LEAK{{/if}}{{${t}}}`).join(''), ctx)
      .replace(/\{\{[^}]+\}\}/g, '').trim();

    const regional = items.get('ARRIVAL_SAME_REGION_POSITION');
    scenarios.push({
      scenario, persona: persona.id, college, expect,
      structure: ev.structure?.key ?? null,
      personalised: Boolean(ev.hasPersonalisation),
      generated: [...new Set((ev.all ?? []).map((e) => e.kind))],
      qualified: [...items.keys()],
      unqualified: disp.filter((x) => x.disposition === 'UNQUALIFIED').map((x) => x.kind),
      rendered: sentences.map((s) => s.kind),
      held: disp.filter((x) => x.disposition === 'HELD').map((x) => x.kind),
      deduped: disp.filter((x) => x.disposition === 'DEDUPED').map((x) => x.kind),
      holdReason: heldNote?.reason ?? null,
      sentences, body, bypass,
      regionalCountries: regional?.countries ?? null,
      regionalNewestSeason: newestSeason(regional),
      ownCountry: persona.nationality,
      /* K2N: arrival-sourced kinds that reached the READER, not merely the engine. */
      arrivalSourcedRendered: sentences.map((x) => x.kind).filter((k) => ARRIVAL_SOURCED.includes(k)),
      /*
       * The regional clause names the countries it SAW and never the athlete's
       * own — that is the whole reason "the same part of the world" is in the
       * sentence. Checked on the clause, not on the body: the introduction
       * says where the athlete is from and is supposed to.
       */
      regionalNamesOwnCountry: (regional?.countries ?? [])
        .some((c) => String(c).toLowerCase() === String(persona.nationality).toLowerCase()),
    });
  }

  /* Findings, reported rather than asserted. */
  const regionalSamples = scenarios
    .filter((s) => s.rendered?.includes('ARRIVAL_SAME_REGION_POSITION'))
    .map((s) => ({
      scenario: s.scenario,
      countries: s.regionalCountries,
      n: (s.regionalCountries ?? []).length,
      text: s.sentences.find((x) => x.kind === 'ARRIVAL_SAME_REGION_POSITION').text,
    }));
  const distribution = {};
  for (const r of regionalSamples) distribution[r.n] = (distribution[r.n] ?? 0) + 1;

  /*
   * The two gates every recruiting-pattern kind passes through, read from
   * production rather than restated. Both are per-SPORT, so a null on the
   * women's side says nothing about the athlete, the programme or the region.
   */
  const licence = {};
  for (const [sport, programme] of [['mens-soccer', 'Akron'], ['womens-soccer', 'Appalachian State']]) {
    const patterns = loadProgrammePatterns(sport, programme);
    licence[sport] = {
      sampleProgramme: programme,
      arrivalsAtSample: patterns?.arrivals ?? 0,
      sportAllowlisted: RECRUITING_EVIDENCE_SPORTS.includes(sport),
      dataStatus: patterns?.dataStatus?.status ?? null,
      licensed: RECRUITING_EVIDENCE_SPORTS.includes(sport)
        && patterns?.dataStatus?.status === DATA_STATUS.LICENSED,
      reason: patterns?.dataStatus?.reason ?? null,
    };
  }

  return {
    scenarios,
    findings: {
      regional: { samples: regionalSamples },
      countryList: { distribution, worst: Math.max(0, ...regionalSamples.map((r) => r.n)) },
      sportLicence: licence,
      scale: scaleScan(),
    },
  };
}

const result = run();
if (JSON_MODE) {
  process.stdout.write(JSON.stringify(result));
} else {
  console.log('\nGENERALISATION VALIDATION — four synthetic personas, real programme data\n');
  for (const s of result.scenarios) {
    if (s.missing) { console.log(`  ${s.scenario}: programme ${s.college} not on file for that sport`); continue; }
    console.log(`  ${s.scenario}  [${s.college}]  ${s.structure}  ${s.personalised ? 'personalised' : 'generic'}`);
    console.log(`     expected: ${s.expect}`);
    for (const x of s.sentences) console.log(`     ${x.slot.padEnd(12)} ${x.text}`);
    if (!s.sentences.length) console.log('     (no evidence — generic email)');
    if (s.held.length) console.log(`     HELD: ${s.held.join(', ')} — ${s.holdReason}`);
    if (s.deduped.length) console.log(`     DEDUPED: ${s.deduped.join(', ')}`);
    if (s.bypass) console.log(`     *** TEMPLATE BYPASS LEAKED: ${s.bypass}`);
    console.log();
  }
  const { sportLicence, scale, countryList } = result.findings;
  console.log('  PER-SPORT LICENCE (both gates, read from production):');
  for (const [sport, l] of Object.entries(sportLicence)) {
    console.log(`     ${sport.padEnd(14)} allowlisted=${String(l.sportAllowlisted).padEnd(5)} `
      + `dataStatus=${String(l.dataStatus).padEnd(11)} -> ${l.licensed ? 'LICENSED' : 'NO RECRUITING EVIDENCE'}`);
  }
  console.log();
  console.log('  REGIONAL CLAUSES BY COUNTRY COUNT (scenarios):', JSON.stringify(countryList.distribution));
  console.log(`  AT SCALE (${scale.rendered} clauses production actually rendered):`);
  console.log(`     ${scale.staleSpan} print a start year older than the season that qualified them`);
  console.log(`     ${scale.needsArticle} name a country that reads wrong without "the"`);
  console.log('     by country count:', JSON.stringify(scale.countryN));
  for (const e of scale.examples) {
    console.log(`     e.g. ${e.college}: printed ${e.printed}, qualified on ${e.qualifiedOn}`);
  }
  console.log('\n  Semantic credibility is a product judgement — see the K2 report.\n');
}
