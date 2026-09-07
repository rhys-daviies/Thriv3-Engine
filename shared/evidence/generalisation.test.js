import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { K_EU, K_DOM, K_ASIA, K_TIGHT, VALIDATION_ATHLETES } from './__fixtures__/validationAthletes.js';
import { normaliseEvidenceAthlete } from './index.js';
import { canonicalPosition } from '../positions.js';
import { permissionsFor, PERMISSION, EVIDENCE_KINDS } from './kinds.js';

/**
 * DOES STAGE J GENERALISE?
 *
 * Stage J was proved on three New Zealanders and one US midfielder. The
 * mechanics were tested hard; the SHAPES were not, and a rule can be
 * mechanically perfect and still say something absurd to an athlete nobody
 * tried it on.
 *
 * ---------------------------------------------------------------------------
 * TWO KINDS OF CHECK, AND THEY FAIL DIFFERENTLY.
 *
 * MECHANICAL assertions hard-fail. A denied kind rendering, a stale claim
 * opening an email, a position that will not travel — those are regressions
 * and this suite is red until they are fixed.
 *
 * SEMANTIC findings are REPORTED, not asserted. Whether "the same part of the
 * world" is a credible thing to say to a Norwegian about Portugal is a product
 * judgement, and encoding today's answer as a passing test would make the
 * suite agree with whatever production currently does — which is the one thing
 * a validation suite must not do. K2 reports; K3 decides.
 *
 * So a semantic failure leaves this suite GREEN and appears in the printed
 * findings. Read them.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DB = path.join(ROOT, 'server/data/recruitmatch.sqlite');
const HAVE_DB = fs.existsSync(DB) && fs.statSync(DB).size > 1_000_000;
const d = HAVE_DB ? describe : describe.skip;
if (!HAVE_DB) console.warn(`\n  generalisation.test.js SKIPPED — no database at ${DB}\n`);

/**
 * Every scenario, driven through the REAL path in one subprocess.
 *
 * `evidenceFor` -> permissions -> qualification -> outreachEvidenceFor ->
 * dedupe -> POSITION_FLOW_HOLD -> planFromRoles -> outreachCopyFor ->
 * composition -> emailBodyFor. Nothing here reimplements any of it; the
 * harness observes.
 */
const runScenarios = () => JSON.parse(execFileSync('node', [
  path.join(ROOT, 'server/scripts/generalisationRun.js'), '--json',
], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: DB }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

const RESULT = HAVE_DB ? runScenarios() : { scenarios: [], findings: {} };
const byName = (n) => RESULT.scenarios.find((s) => s.scenario === n);

/* -------------------------------------------------------------------------- */
/* The fixtures themselves                                                     */
/* -------------------------------------------------------------------------- */

describe('the validation personas are shaped as designed', () => {
  it('carries only fields production consumes', () => {
    const ALLOWED = new Set(['id', 'full_name', 'sport', 'nationality', 'position',
      'secondary_position', 'recruiting_class_year', 'intended_major', 'gpa',
      'sat_score', 'act_score']);
    for (const a of VALIDATION_ATHLETES) {
      for (const k of Object.keys(a)) expect(ALLOWED.has(k), `${a.id}.${k}`).toBe(true);
    }
  });

  it('normalises to the four intended shapes', () => {
    const n = (a) => normaliseEvidenceAthlete(a);
    expect(n(K_EU)).toMatchObject({ position: 'DEFENSE', country: 'Norway', intendedMajor: null, sport: 'mens-soccer' });
    expect(n(K_DOM)).toMatchObject({ position: 'GOALKEEPER', intendedMajor: 'computer science', sport: 'mens-soccer' });
    expect(n(K_ASIA)).toMatchObject({ position: 'FORWARD', country: 'Japan', intendedMajor: null });
    expect(n(K_TIGHT)).toMatchObject({ position: 'MIDFIELD', country: 'Ireland', intendedMajor: 'nursing', sport: 'womens-soccer' });
  });

  it('covers the position groups the Stage J corpus never reached', () => {
    // GOALKEEPER had no athlete at all; MIDFIELD only on the women's side.
    const positions = VALIDATION_ATHLETES.map((a) => canonicalPosition(a.position));
    expect(positions).toContain('GOALKEEPER');
    expect(new Set(positions).size).toBe(4);
    for (const p of positions) expect(p).not.toBe('UNKNOWN');
  });
});

/* -------------------------------------------------------------------------- */
/* MECHANICAL — these hard-fail                                                */
/* -------------------------------------------------------------------------- */

d('criterion 1 — no DENIED evidence renders, for any persona', () => {
  it('renders nothing the registry denies', () => {
    const denied = new Set(Object.keys(EVIDENCE_KINDS)
      .filter((k) => permissionsFor(k).OUTREACH === PERMISSION.DENIED));
    for (const s of RESULT.scenarios) {
      for (const k of s.rendered) expect(denied.has(k), `${s.scenario} rendered ${k}`).toBe(false);
    }
  });
});

d('criterion 2 — nothing renders that failed its qualification', () => {
  it('renders only kinds that reached a role', () => {
    for (const s of RESULT.scenarios) {
      for (const k of s.rendered) {
        expect(s.qualified, `${s.scenario}: ${k} rendered without qualifying`).toContain(k);
      }
      // And an UNQUALIFIED disposition never appears among the rendered.
      for (const k of s.unqualified) expect(s.rendered, `${s.scenario}: ${k}`).not.toContain(k);
    }
  });
});

d('criterion 3 — a stale regional claim never opens an email', () => {
  it('refuses a regional arrival outside the recency window', () => {
    const stale = byName('K-EU/REGIONAL_STALE');
    expect(stale, 'the stale scenario must exist').toBeTruthy();
    expect(stale.rendered).not.toContain('ARRIVAL_SAME_REGION_POSITION');
    expect(stale.structure).not.toBe('RELATIONSHIP_FIRST');
  });

  it('never renders a regional claim whose newest season is too old', () => {
    for (const s of RESULT.scenarios) {
      if (!s.rendered.includes('ARRIVAL_SAME_REGION_POSITION')) continue;
      expect(s.regionalNewestSeason, `${s.scenario}`).toBeGreaterThanOrEqual(2024);
    }
  });
});

d('criterion 4 — POSITION_FLOW_HOLD survives new profiles', () => {
  it('withholds the graduation beside a position-bearing arrival', () => {
    const held = RESULT.scenarios.filter((s) => s.held.includes('POSITION_GRADUATION'));
    expect(held.length, 'no persona reached the hold').toBeGreaterThan(0);
    for (const s of held) {
      expect(s.rendered).not.toContain('POSITION_GRADUATION');
      const arrival = s.rendered.some((k) => ['ARRIVAL_SAME_COUNTRY_POSITION', 'ARRIVAL_SAME_REGION_POSITION'].includes(k));
      expect(arrival, `${s.scenario} held graduation with no arrival`).toBe(true);
      expect(s.holdReason, s.scenario).toMatch(/roster need/);
    }
  });
});

d('criterion 5 — no template bypass, for any persona', () => {
  it('resolves no retired claim token', () => {
    for (const s of RESULT.scenarios) {
      expect(s.bypass, `${s.scenario} leaked: ${s.bypass}`).toBe('');
    }
  });
});

d('criterion 8 — academic vocabularies stay distinct', () => {
  it('says the athlete\'s words and the programme\'s label separately', () => {
    for (const s of RESULT.scenarios.filter((x) => x.rendered.includes('ACADEMIC_FIT'))) {
      const line = s.sentences.find((x) => x.kind === 'ACADEMIC_FIT').text;
      expect(line, s.scenario).toMatch(/is looking to study/);
      // Either two labels kept apart, or the collapse branch when they are
      // literally the same word — never the athlete's plan stated as ours.
      expect(line, s.scenario).toMatch(/, and .+ is among the programmes you list$|, which you offer$/);
    }
  });

  it('renders no academic claim for a persona with no major', () => {
    for (const s of RESULT.scenarios.filter((x) => ['K-EU', 'K-ASIA'].includes(x.persona))) {
      expect(s.rendered, s.scenario).not.toContain('ACADEMIC_FIT');
    }
  });
});

d('criterion 9 — position semantics travel end to end', () => {
  it('carries the goalkeeper through generation, copy and agreement', () => {
    const gk = RESULT.scenarios.filter((s) => s.persona === 'K-DOM' && s.rendered.includes('POSITION_GRADUATION'));
    expect(gk.length, 'no goalkeeper graduation scenario').toBeGreaterThan(0);
    for (const s of gk) {
      const line = s.sentences.find((x) => x.kind === 'POSITION_GRADUATION').text;
      expect(line, s.scenario).toMatch(/goalkeepers? (is|are) listed to graduate/);
      expect(line, s.scenario).not.toMatch(/UNKNOWN|utilitys/);
    }
  });

  it('never prints a raw position key or a broken plural', () => {
    for (const s of RESULT.scenarios) {
      for (const line of s.sentences.map((x) => x.text)) {
        expect(line, s.scenario).not.toMatch(/GOALKEEPER|DEFENSE|MIDFIELD|FORWARD|UNKNOWN/);
        expect(line, s.scenario).not.toMatch(/\butilitys\b/);
      }
    }
  });
});

d('criterion 6 — the generic email stays professional', () => {
  it('says nothing about the programme when it has nothing to say', () => {
    const zero = RESULT.scenarios.filter((s) => s.rendered.length === 0);
    expect(zero.length, 'no zero-evidence scenario').toBeGreaterThan(0);
    for (const s of zero) {
      expect(s.body, s.scenario).toContain('Validation Persona');
      expect(s.body, s.scenario).not.toMatch(/\{\{|\bundefined\b|\bNaN\b|\[object/);
      expect(s.body, s.scenario).not.toMatch(/\n{3,}/);
      expect(s.structure, s.scenario).toBe('PLAYER_FIRST');
    }
  });
});

d('criterion 10 — K2N negative controls', () => {
  it('asserts no arrival at a programme with no recorded arrivals', () => {
    const controls = RESULT.scenarios.filter((s) => s.scenario.startsWith('K2N/'));
    expect(controls.length, 'no negative controls ran').toBe(4);
    for (const s of controls) {
      expect(s.arrivalSourcedRendered, `${s.scenario} invented an arrival`).toEqual([]);
      expect(s.body, s.scenario).not.toMatch(/\{\{|\bundefined\b|\bNaN\b|\[object/);
    }
  });

  it('never names the athlete\'s own country in the regional clause', () => {
    for (const s of RESULT.scenarios) {
      expect(s.regionalNamesOwnCountry, `${s.scenario} named ${s.ownCountry} back at the coach`).toBeFalsy();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* SEMANTIC — reported, never asserted                                         */
/* -------------------------------------------------------------------------- */

d('criterion 7 — regional credibility is REPORTED, not asserted', () => {
  /**
   * Deliberately not an expectation. Encoding today's behaviour as a passing
   * test would make this suite ratify whatever production does, which is the
   * failure mode a validation corpus exists to avoid. The run prints the
   * sentences and their verdicts; K3 decides.
   */
  it('prints every regional sentence the personas produced', () => {
    expect(RESULT.findings).toHaveProperty('regional');
    expect(Array.isArray(RESULT.findings.regional.samples)).toBe(true);
  });

  it('records how many countries each regional clause enumerated', () => {
    expect(RESULT.findings).toHaveProperty('countryList');
    const dist = RESULT.findings.countryList.distribution;
    expect(typeof dist).toBe('object');
  });

  /**
   * The tight-region question Task E asked cannot be answered on K-TIGHT,
   * because women's soccer is unlicensed for every recruiting-pattern kind by
   * two independent gates. K-TIGHT-M holds the region constant and opens the
   * sport gate, which is what separates "UK_IRELAND is too tight" from "this
   * sport generates none of these claims at all".
   *
   * Reported, not asserted, for the same reason as the rest of criterion 7 —
   * and asserting the blackout would freeze it in place, which is precisely
   * the product decision K3 owns.
   */
  it('records the per-sport licence both regional gates read', () => {
    const licence = RESULT.findings.sportLicence;
    expect(licence).toBeTruthy();
    expect(licence['mens-soccer']).toHaveProperty('licensed');
    expect(licence['womens-soccer']).toHaveProperty('licensed');
  });

  it('records the tight-region isolation probe', () => {
    expect(byName('K-TIGHT-M/TIGHT_REGION_ISOLATED'), 'the probe must run').toBeTruthy();
  });

  it('records how often the printed span disagrees with the qualifying season', () => {
    const scale = RESULT.findings.scale;
    expect(scale).toBeTruthy();
    expect(scale.rendered, 'the scale scan rendered nothing to measure').toBeGreaterThan(0);
    expect(typeof scale.staleSpan).toBe('number');
  });
});
