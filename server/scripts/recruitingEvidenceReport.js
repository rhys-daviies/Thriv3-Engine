#!/usr/bin/env node
/**
 * The recruiting-history evidence kinds, against real programmes.
 *
 *   npm run recruiting:evidence                     the validation set
 *   npm run recruiting:evidence -- --athlete "Rhys Davies" --programme Elon
 *   npm run recruiting:evidence -- --distribution   what fires, and how often
 *   npm run recruiting:evidence -- --shadow         POSITION_INTAKE_HISTORY only
 *
 * Reads only. Nothing here drafts, logs or sends — it exists so the complete
 * email can be judged rather than the evidence sentence in isolation, which is
 * the only level at which a claim about a coach's own programme can actually be
 * assessed.
 */
import 'dotenv/config';
import db from '../db/client.js';
import { evidenceFor, programmeInputs, departureFields } from '../lib/evidenceQueries.js';
import { selectEvidence } from '../../shared/evidence/index.js';
import { loadPatternsForSport } from '../lib/recruitingPatterns.js';
import { emailBodyFor } from '../../src/lib/emailTemplate.js';
import { EVIDENCE_KINDS, kindLabel } from '../../shared/evidence/kinds.js';
import { renderEvidence } from '../../shared/evidence/render.js';
import { COVERAGE } from '../../shared/recruiting/patterns.js';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const has = (n) => argv.includes(`--${n}`);

/** The kinds this phase added. Everything else is the frozen baseline's. */
export const NEW_KINDS = Object.freeze([
  'COACH_ARRIVAL_SAME_COUNTRY',
  'ARRIVAL_SAME_COUNTRY_POSITION',
  'ARRIVAL_SAME_REGION_POSITION',
  'POSITION_INTAKE_HISTORY',
]);

const rule = (c = '=') => console.log(c.repeat(78));
const head = (t) => { console.log(); rule(); console.log(t); rule(); };
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');

const athleteNamed = (name) => db.prepare('SELECT * FROM players WHERE full_name = ?').get(name);
/** The same inputs `evidenceFor` builds, so the A/B differs by one field only. */
const programmeInputsFor = (name, sport, athlete) => programmeInputs(name, sport, {
  match: departureFields(name, sport, athlete),
});
const collegeNamed = (name, sport) => db.prepare('SELECT * FROM colleges WHERE name = ? AND sport = ?').get(name, sport);

/**
 * One pairing, end to end.
 *
 * AVAILABLE -> SELECTED -> DISPLAYED -> EMAIL, in that order, because those are
 * four different things and the interesting failures live between them: an
 * item can be generated and lose dedupe, be selected and not displayed, be
 * displayed and read badly.
 */
function pairing(athlete, collegeName, { label = null } = {}) {
  const sport = athlete.sport ?? 'mens-soccer';
  const evidence = evidenceFor(athlete, collegeName, { sport });
  const college = collegeNamed(collegeName, sport) ?? { name: collegeName, sport };
  const composed = emailBodyFor(athlete, college, 'Coach', { evidence });

  head(`${athlete.full_name} x ${collegeName}${label ? `   [${label}]` : ''}`);

  const p = evidence.programme;
  console.log(`  ${athlete.nationality ?? 'domestic'} · ${athlete.position} · ${sport}`);
  console.log(`  roster: squad ${p.hasSquad ? 'yes' : 'no'}, history ${p.hasHistory ? 'yes' : 'no'}`
    + `, freshness ${p.freshness?.state ?? '—'}`);

  console.log('\n  AVAILABLE EVIDENCE (generated, before selection)');
  for (const d of evidence.dispositions) {
    const flag = NEW_KINDS.includes(d.kind) ? ' *' : '  ';
    console.log(`   ${flag} ${d.kind.padEnd(32)} ${String(d.disposition).padEnd(22)}`
      + `${d.reason ? `  — ${d.reason}` : ''}`);
  }

  /**
   * Every new kind that was GENERATED, rendered, whether or not it survived.
   *
   * A kind that lost dedupe still had copy, and that copy is what would be sent
   * at a programme where the stronger kind is absent. Reading only the winners
   * would leave the identity licence and the region wording untested wherever a
   * coach-scoped claim happened to be available.
   */
  const generatedNew = evidence.all.filter((e) => NEW_KINDS.includes(e.kind));
  if (generatedNew.length) {
    console.log('\n  NEW-KIND RENDERINGS (generated, selected or not)');
    for (const ev of generatedNew) {
      console.log(`    ${ev.kind}`);
      console.log(`      "${renderEvidence(ev)}"`);
      console.log(`      count ${ev.data.count}, named in copy: ${ev.data.name ?? 'none'}`
        + `, identity ${[...new Set((ev.data.provenance?.supporting ?? []).map((x) => x.identityMethod))].join('/') || '—'}`);
    }
  }

  console.log('\n  SELECTED ORDER (ranking; what primary_kind records)');
  evidence.selected.forEach((ev, i) => {
    console.log(`    ${i + 1}. ${ev.kind.padEnd(32)} strength ${String(ev.strength).padStart(3)}`
      + `  ${ev.tier}  ${ev.confidence}`);
  });
  if (!evidence.selected.length) console.log('    (nothing selected)');

  console.log('\n  DISPLAYED ORDER (placement; what the reader meets)');
  const placement = evidence.composition?.placement ?? [];
  placement.forEach((slot, i) => {
    console.log(`    ${i + 1}. ${slot.kind.padEnd(32)} slot ${String(slot.slot).padEnd(12)}`
      + `${slot.displayed === false ? '  HELD BACK' : ''}`);
  });
  if (!placement.length) console.log('    (nothing placed)');
  console.log(`    structure: ${evidence.structure.key} (${evidence.structure.source})`);

  console.log('\n  FINAL EMAIL');
  console.log(`    [source: ${composed.source}]`);
  for (const line of composed.body.split('\n')) console.log(`    ${line}`);

  /**
   * The structured form as well, where the athlete's saved template overrides
   * it. Rhys carries a customised template, so his real sends take the
   * single-paragraph path — that is pre-existing behaviour and not something
   * this phase changed, but the structured email is what the composition
   * decisions above actually describe and it has to be judgeable too.
   */
  if (composed.source !== 'STRUCTURED' && evidence.composition?.template) {
    const structured = emailBodyFor(athlete, college, 'Coach', { evidence, structured: true });
    console.log(`\n    [structured form, for comparison]`);
    for (const line of structured.body.split('\n')) console.log(`    ${line}`);
  }

  const newlySelected = evidence.selected.filter((e) => NEW_KINDS.includes(e.kind));
  if (newlySelected.length) {
    console.log('\n  PROVENANCE (server-side only; never crosses the wire)');
    for (const ev of newlySelected) {
      const pr = ev.data.provenance ?? {};
      console.log(`    ${ev.kind}`);
      console.log(`      athlete            : ${pr.athleteCountry} / ${pr.athleteRegion} / ${pr.athletePosition}`);
      console.log(`      observation        : count ${ev.data.count}`
        + `, seasons ${(ev.data.seasons ?? []).join(',')}`
        + `, ${pr.observedTransitions}/${pr.possibleTransitions} transitions [${pr.coverageStatus}, ${pr.coverageScope}]`);
      console.log(`      field / sport      : position recorded ${(100 * (pr.fieldCoverage ?? 0)).toFixed(0)}%`
        + `, sport data ${pr.sportDataStatus}, specificity ${pr.specificity}`);
      console.log(`      named in copy      : ${ev.data.name ?? '(not licensed / count > 1)'}`);
      for (const sup of pr.supporting ?? []) {
        console.log(`      supporting         : ${sup.season} ${sup.playerName} (${sup.position})`
          + ` identity ${sup.identityMethod}, coach ${sup.coachAttribution}`
          + `, prior ${sup.priorConfidence}${sup.priorProgramme ? ` <- ${sup.priorProgramme}` : ''}`);
      }
    }
  }
  return { evidence, composed };
}

/* -------------------------------------------------------------------------- */

/** What the new kinds fire on across the whole men's pool, for one athlete. */
function distribution(athlete) {
  const sport = athlete.sport ?? 'mens-soccer';
  const patterns = loadPatternsForSport(sport);
  head(`DISTRIBUTION — ${athlete.full_name} (${athlete.nationality}, ${athlete.position}) across ${patterns.size} programmes`);

  const counts = new Map(NEW_KINDS.map((k) => [k, 0]));
  const selectedCounts = new Map(NEW_KINDS.map((k) => [k, 0]));
  const supersedes = new Map();
  let evaluated = 0;
  const examples = [];

  for (const name of patterns.keys()) {
    const ev = evidenceFor(athlete, name, { sport });
    evaluated += 1;
    for (const kind of NEW_KINDS) {
      const found = ev.all.find((e) => e.kind === kind);
      if (!found) continue;
      counts.set(kind, counts.get(kind) + 1);
      if (ev.selected.some((e) => e.kind === kind)) selectedCounts.set(kind, selectedCounts.get(kind) + 1);
      if (kind === 'POSITION_INTAKE_HISTORY') {
        examples.push({ programme: name, text: renderEvidence(found), count: found.data.count });
      }
    }
    // What the new evidence pushed aside, which is the number that says whether
    // the hierarchy is doing anything.
    for (const s of ev.suppressed) {
      if (!NEW_KINDS.includes(s.suppressedBy)) continue;
      const key = `${s.suppressedBy} > ${s.kind}`;
      supersedes.set(key, (supersedes.get(key) ?? 0) + 1);
    }
  }

  console.log(`\n  programmes evaluated: ${evaluated}\n`);
  console.log('  KIND                              GENERATED   SELECTED');
  console.log('  ' + '-'.repeat(60));
  for (const kind of NEW_KINDS) {
    const g = counts.get(kind);
    const sel = selectedCounts.get(kind);
    console.log(`  ${kind.padEnd(32)} ${String(g).padStart(8)}   ${String(sel).padStart(8)}`
      + `  ${pct(sel, g)}${EVIDENCE_KINDS[kind].emailEligible ? '' : '   (shadow, never emailed)'}`);
  }

  console.log('\n  WHAT THE NEW EVIDENCE SUPERSEDED');
  for (const [key, n] of [...supersedes.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${key}`);
  }
  if (!supersedes.size) console.log('    nothing');

  if (has('shadow')) {
    /**
     * Spread across the range rather than the first twenty alphabetically. The
     * question this list has to answer is what the kind SOUNDS like, and the
     * top and bottom of the distribution are where it sounds worst.
     */
    const sorted = [...examples].sort((a, b) => a.count - b.count);
    const step = Math.max(1, Math.floor(sorted.length / 20));
    const spread = sorted.filter((_, i) => i % step === 0).slice(0, 20);
    console.log(`\n  POSITION_INTAKE_HISTORY — 20 examples spread across ${examples.length}`
      + ' generated (SHADOW, never emailed)');
    for (const e of spread) {
      console.log(`    ${e.programme.padEnd(28)} ${e.text}`);
    }
  }
  return { counts, selectedCounts, supersedes };
}

/* -------------------------------------------------------------------------- */

/**
 * The new evidence against the frozen baseline, on the same pairings.
 *
 * The A/B is exact rather than approximate. Every change this phase made to the
 * evidence path is ADDITIVE — four registry entries, four generators, four copy
 * entries, one optional context field — so passing `recruiting: null` runs
 * byte-identical code to `outreach-baseline-2026-08-29` over the same rows. The
 * comparison is therefore of two runs of one build, not of two builds.
 */
function baselineComparison(athlete, names) {
  const sport = athlete.sport ?? 'mens-soccer';
  head(`BASELINE COMPARISON — ${athlete.full_name} across ${names.length} pairings`);

  const tally = () => ({ structures: new Map(), counts: new Map(), primary: new Map(), kinds: new Map() });
  const add = (t, ev) => {
    const inc = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
    inc(t.structures, ev.structure.key);
    inc(t.counts, ev.selected.length);
    inc(t.primary, ev.primary?.kind ?? '(none)');
    for (const e of ev.selected) inc(t.kinds, e.kind);
  };

  const before = tally();
  const after = tally();
  let changedPrimary = 0;
  let changedStructure = 0;

  for (const name of names) {
    const inputs = programmeInputsFor(name, sport, athlete);
    add(before, selectEvidence(athlete, { ...inputs, recruiting: null }));
    const withHistory = selectEvidence(athlete, inputs);
    add(after, withHistory);
    const base = selectEvidence(athlete, { ...inputs, recruiting: null });
    if ((base.primary?.kind ?? null) !== (withHistory.primary?.kind ?? null)) changedPrimary += 1;
    if (base.structure.key !== withHistory.structure.key) changedStructure += 1;
  }

  const table = (label, key, order = null) => {
    console.log(`\n  ${label}`);
    console.log('    ' + 'value'.padEnd(34) + 'BASELINE   WITH HISTORY   DELTA');
    const keys = order ?? [...new Set([...before[key].keys(), ...after[key].keys()])]
      .sort((a, b) => (after[key].get(b) ?? 0) - (after[key].get(a) ?? 0));
    for (const k of keys) {
      const b = before[key].get(k) ?? 0;
      const a = after[key].get(k) ?? 0;
      const d = a - b;
      console.log(`    ${String(k).padEnd(34)}${String(b).padStart(8)}${String(a).padStart(15)}`
        + `${(d === 0 ? '  —' : `  ${d > 0 ? '+' : ''}${d}`).padStart(8)}`);
    }
  };

  table('STRUCTURE / FLOW DISTRIBUTION', 'structures');
  table('EVIDENCE-COUNT DISTRIBUTION', 'counts');
  table('PRIMARY KIND DISTRIBUTION', 'primary');
  table('SELECTED KIND DISTRIBUTION', 'kinds');

  console.log(`\n  pairings whose PRIMARY kind changed   : ${changedPrimary} of ${names.length}  ${pct(changedPrimary, names.length)}`);
  console.log(`  pairings whose STRUCTURE changed      : ${changedStructure} of ${names.length}  ${pct(changedStructure, names.length)}`);
}

/** Picks the programmes that exercise each case the validation asks for. */
function validationSet(athlete) {
  const sport = athlete.sport ?? 'mens-soccer';
  const patterns = loadPatternsForSport(sport);
  const country = athlete.nationality;
  const position = { Defender: 'DEFENSE', Midfielder: 'MIDFIELD', Forward: 'FORWARD', Goalkeeper: 'GOALKEEPER' }[athlete.position] ?? 'UNKNOWN';

  const taken = new Set();
  const pick = (fn) => {
    for (const [name, p] of patterns) {
      if (taken.has(name)) continue;
      if (fn(p)) { taken.add(name); return name; }
    }
    return null;
  };
  // The athlete's own name is excluded here for the same reason the generators
  // exclude it: `roster_players` holds a Rhys Davies who arrived at Bellarmine
  // in 2024, and a picker that counted him would choose a programme whose
  // evidence is the recruit himself.
  const self = String(athlete.full_name ?? '').toLowerCase();
  const others = (rows = []) => rows.filter((n) => n.playerName.toLowerCase() !== self);
  const countryPos = (p) => others(p.countryPositions.pairs[`${country}||${position}`]?.named ?? []).length;
  const coachCountry = (p) => others(p.coach.countries.countries[country]?.named ?? []).length;
  const regionPos = (p) => {
    const region = p.regions.regions;
    const key = Object.keys(p.regionPositions.pairs).find((k) => k.endsWith(`||${position}`)
      && k.startsWith('OCEANIA'));
    void region;
    return key ? others(p.regionPositions.pairs[key].named).filter((n) => n.country !== country).length : 0;
  };

  return [
    ['named in the brief', 'Jacksonville'],
    ['named in the brief', 'Butler'],
    ['named in the brief', 'Elon'],
    ['same country + same position', pick((p) => countryPos(p) >= 1 && p.coverage.status === COVERAGE.SUFFICIENT)],
    ['current-coach same country', pick((p) => coachCountry(p) >= 1
      && p.coach.coverage.status === COVERAGE.SUFFICIENT)],
    ['same region + same position, no same-country', pick((p) => regionPos(p) >= 1 && countryPos(p) === 0
      && (p.countries.countries[country]?.total ?? 0) === 0 && p.coverage.status === COVERAGE.SUFFICIENT)],
    ['region suppressed by stronger country evidence', pick((p) => regionPos(p) >= 1 && countryPos(p) >= 1)],
    ['coach evidence unavailable — tenure too short', pick((p) => countryPos(p) >= 1
      && p.coach.coverage.status !== COVERAGE.SUFFICIENT)],
    ['insufficient history', pick((p) => p.coverage.status !== COVERAGE.SUFFICIENT
      && (p.countries.countries[country]?.total ?? 0) >= 1)],
    ['field-coverage failure', pick((p) => p.coverage.status === COVERAGE.SUFFICIENT
      && p.positions.knownShare !== null && p.positions.knownShare < 0.8
      && (p.countries.countries[country]?.total ?? 0) >= 1)],
    ['ambiguous prior programme — origin never stated', pick((p) => countryPos(p) >= 1
      && p.countryPositions.pairs[`${country}||${position}`].named
        .some((n) => n.priorConfidence === 'AMBIGUOUS'))],
  ].filter(([, name]) => name);
}

/* -------------------------------------------------------------------------- */

const athleteName = arg('athlete');
const programme = arg('programme');

if (has('baseline')) {
  const athlete = athleteNamed(arg('athlete', 'Rhys Davies'));
  /**
   * The pilot pairings, plus every programme with a men's roster.
   *
   * The 90 outreach rows are the real campaign and the only pairings with any
   * history behind them; the full sweep is what the next batch would draw from,
   * and it is the one that says whether the new kinds are rare or everywhere.
   */
  const pilot = db.prepare(`
    SELECT DISTINCT c.school AS name FROM outreach o
    JOIN coaches c ON c.id = o.coach_id
    WHERE c.sport = ? AND c.school IS NOT NULL
  `).all(athlete.sport ?? 'mens-soccer').map((r) => r.name)
    .filter((n) => db.prepare('SELECT 1 FROM colleges WHERE name = ? AND sport = ?')
      .get(n, athlete.sport ?? 'mens-soccer'));
  if (pilot.length) baselineComparison(athlete, pilot);
  else console.log('\n  no pilot pairings resolve to a college row.');

  if (has('full')) {
    baselineComparison(athlete, [...loadPatternsForSport(athlete.sport ?? 'mens-soccer').keys()]);
  }
} else if (has('distribution') || has('shadow')) {
  distribution(athleteNamed(arg('athlete', 'Rhys Davies')));
} else if (athleteName && programme) {
  pairing(athleteNamed(athleteName), programme);
} else {
  const rhys = athleteNamed('Rhys Davies');
  const ryan = athleteNamed('Ryan Billings');

  pairing(rhys, 'Jacksonville', { label: 'named in the brief' });
  pairing(ryan, 'Sacred Heart', { label: 'named in the brief' });
  pairing(rhys, 'Butler', { label: 'named in the brief — coach appointed 2026' });
  pairing(rhys, 'Elon', { label: 'named in the brief' });

  for (const [label, name] of validationSet(rhys)) {
    if (['Jacksonville', 'Butler', 'Elon'].includes(name)) continue;
    pairing(rhys, name, { label });
  }

  /**
   * A RECONCILED arrival, which no live athlete's country reaches.
   *
   * Loras' only Icelandic goalkeeper arrival is Jon arnar Hjalmarsson, one of
   * the thirteen rows the build merged from two spellings of one person. A
   * single arrival is exactly the case the copy would normally name, so this is
   * where the identity licence has to hold: the count survives, the name does
   * not. There is no Icelandic athlete on the books, so the case runs a
   * hypothetical profile against the real programme.
   */
  pairing({
    ...rhys,
    id: null,
    full_name: 'Test Athlete',
    nationality: 'Iceland',
    position: 'Goalkeeper',
  }, 'Loras', { label: 'RECONCILED named arrival — name withheld, count kept' });

  // Women's, which must produce none of the new kinds at all.
  const women = db.prepare("SELECT name FROM colleges WHERE sport = 'womens-soccer' LIMIT 1").get();
  if (women) {
    pairing({ ...rhys, sport: 'womens-soccer' }, women.name, {
      label: "women's suppression — sport data UNVALIDATED",
    });
  }
}

console.log(`\nRead-only. Nothing drafted, logged or sent.`);
void kindLabel;
