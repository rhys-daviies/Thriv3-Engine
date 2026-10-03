/**
 * THE A8 FULL-UNIVERSE VALIDATION BASELINE.
 *
 * Writes one deterministic, PII-safe record per reference athlete x evaluated
 * programme, and a digest over it. READ-ONLY: it adopts nothing, serves
 * nothing and changes no ranking anyone sees.
 *
 *   node server/scripts/a8Baseline.js --out=docs/validation/A8.0-baseline.json
 *   node server/scripts/a8Baseline.js --check          # digest only, no write
 *   node server/scripts/a8Baseline.js --profile=LEVEL_FIRST
 *
 * -- WHAT IS IN A CELL, AND WHY --------------------------------------------
 *
 * The temptation is to record the rank and the pursuit value and stop. That
 * produces an artifact which can tell you THAT something moved and never why,
 * which is the failure mode A7.47 spent a phase recovering from. So every cell
 * carries the three layers' value, state and coverage alongside the refusal
 * codes, and a comparison can therefore attribute a movement to the layer and
 * the evidence that caused it without re-running anything.
 *
 * -- PII --------------------------------------------------------------------
 *
 * Programme id, name, division and state are public institutional facts. The
 * athletes are synthetic fixtures. NO roster player name, hometown, email or
 * any other person-level field is read into this file, and the digest is taken
 * over the serialised cells so that a later run which quietly started emitting
 * one would not match.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES } from './v2Fixtures.js';
import { VALIDATION_FIXTURES } from './v2ValidationFixtures.js';

export const SEASON = '2026';

/** The artifact's own version. Bump when a CELL FIELD changes, never for data. */
export const A8_BASELINE_VERSION = 1;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(6)) : null);

/**
 * One layer, flattened.
 *
 * A refusal and a score are the same shape here on purpose: a comparison that
 * had to branch on which one it was holding would be a comparison that could
 * silently skip one of them.
 */
function layerCell(result) {
  if (!result) return { s: 'ABSENT' };
  if (result.ok === false) {
    return drop({
      s: 'UNSCOREABLE',
      c: num(result.coverage),
      r: result.reason ?? null,
      m: Array.isArray(result.missing) && result.missing.length ? [...result.missing].sort() : null,
    });
  }
  return drop({
    s: 'SCOREABLE', v: num(result.value), g: result.grade ?? null, c: num(result.coverage),
  });
}

/**
 * The cell encoding, written down because a short key is only acceptable when
 * its meaning is not guesswork.
 *
 * `f` and `p` are INDICES into `athletes[]` and `programmes[]`. Interning them
 * is what keeps this artifact around two megabytes rather than eleven: a
 * fixture id is 46 characters and a programme id a 36-character uuid, and
 * every one of the 12,484 cells would otherwise carry both in full. Nothing is
 * lost - `decodeBaseline` expands a cell back to the long-form object, and the
 * tests read the long form.
 */
export const CELL_CODEC = Object.freeze({
  f: 'athleteIndex', p: 'programmeIndex', st: 'rankingState', rk: 'rank',
  pp: 'pursuit', pg: 'pursuitGrade', ml: 'missingLayers',
  R: 'recruitability', F: 'financial', O: 'opportunity',
});

export const LAYER_CODEC = Object.freeze({
  s: 'state', v: 'value', g: 'grade', c: 'coverage', r: 'reason', m: 'missing',
});

const expandLayer = (l) => Object.fromEntries(
  Object.entries(l ?? {}).map(([k, v]) => [LAYER_CODEC[k] ?? k, v]));

/** One cell, in long form, with its athlete and programme resolved. */
export function decodeBaseline(baseline) {
  return baseline.cells.map((c) => {
    const a = baseline.athletes[c.f];
    const prog = baseline.programmes[c.p];
    return {
      fixtureId: a.fixtureId,
      profile: baseline.profile,
      programmeId: prog.programmeId,
      programme: prog.programme,
      division: prog.division,
      sport: prog.sport,
      universe: prog.universe,
      eligibilityModel: prog.eligibilityModel,
      rankingState: c.st,
      rank: c.rk ?? null,
      pursuit: c.pp ?? null,
      pursuitGrade: c.pg ?? null,
      missingLayers: c.ml ?? null,
      recruitability: expandLayer(c.R),
      financial: expandLayer(c.F),
      opportunity: expandLayer(c.O),
    };
  });
}

/**
 * Absent rather than null.
 *
 * A null-valued key costs ~14 bytes and appears in most of the 37,000 layer
 * records this file holds. Omitting it is not a compression trick - it is the
 * honest encoding, because `value: null` on a refusal invites a reader to
 * treat the refusal as a zero, which is the one reading V2 exists to prevent.
 * A consumer writes `cell.value ?? null` and gets the same answer.
 */
function drop(o) {
  for (const k of Object.keys(o)) if (o[k] === null || o[k] === undefined) delete o[k];
  return o;
}

/**
 * A8.0B. One component's own state, lifted out of the Opportunity basis.
 *
 * The A8.0 cell records each LAYER's state and value, which is all the
 * baseline needed. Validating `majorFit` needs the component itself: whether
 * it scored, refused, or was not applicable because nobody stated a major -
 * three outcomes the layer total cannot distinguish between, since all three
 * leave Opportunity scoreable.
 *
 * Off by default, so the A8.0 baseline rebuilds to the same digest. The
 * caller names the components it wants; nothing is captured speculatively.
 */
function componentCell(result, name) {
  if (!result || result.ok === false) return { s: 'LAYER_UNSCOREABLE' };
  const b = result.basis ?? {};
  const got = b.components?.[name];
  if (got) {
    return drop({ s: 'SCOREABLE', v: num(got.value), g: got.grade ?? null, w: num(got.weight), sh: num(got.share) });
  }
  const na = b.notApplicable ?? [];
  if (Array.isArray(na) && na.some((x) => (x?.key ?? x) === name)) return { s: 'NOT_APPLICABLE' };
  const miss = b.missing ?? [];
  const m = Array.isArray(miss) ? miss.find((x) => (x?.key ?? x) === name) : null;
  if (m) return drop({ s: 'UNSCOREABLE', r: m?.reason ?? null });
  return { s: 'ABSENT' };
}

export async function buildBaseline({
  profileName = 'UNDECLARED', fixtures = null, components = null,
} = {}) {
  const { default: db } = await import('../db/client.js');
  const { canonicalPosition } = await import('../../shared/positions.js');
  const { normaliseAthlete } = await import('../../shared/matching/pool.js');
  const { buildPoolContext } = await import('../lib/v2/poolContext.js');
  const { runPursuit } = await import('../lib/v2/pursuitRun.js');
  const { universeOf } = await import('../lib/v2/validationUniverse.js');
  const { eligibilityRuleFor } = await import('../../shared/eligibility.js');
  const { PROFILES } = await import('../../shared/matching/v2/index.js');

  const profile = PROFILES[profileName];
  if (!profile) throw new Error(`Unknown profile ${profileName}`);

  const chosen = fixtures ?? [
    ...FIXTURES.map((f) => ({ ...f, frozen: true })),
    ...VALIDATION_FIXTURES.map((f) => ({ ...f, frozen: false })),
  ];

  const cache = new Map();
  const contextFor = (sport) => {
    if (!cache.has(sport)) {
      cache.set(sport, {
        ctx: buildPoolContext({ db, sport, season: SEASON }),
        colleges: db.prepare('SELECT * FROM colleges WHERE sport = ? AND active = 1').all(sport),
      });
    }
    return cache.get(sport);
  };

  const cells = [];
  const athletes = [];
  /** Programme metadata is identical across fixtures; carried once, not 12,484 times. */
  const programmes = new Map();

  for (const f of chosen) {
    const p = f.player;
    const { ctx, colleges } = contextFor(p.sport);
    const position = canonicalPosition(p.position);
    const v1Shape = normaliseAthlete({ ...p, preferred_divisions: '[]', preferred_conferences: '[]' });
    const athlete = {
      label: { id: f.id, sport: p.sport, position, rating: p.football_ability, budget: p.budget_range },
      v1Shape,
      recruitability: {
        sport: p.sport, rating: p.football_ability, position,
        entryYear: p.recruiting_class_year,
        isInternational: p.origin === 'International',
        homeState: p.state ?? null,
      },
      opportunity: {
        sport: p.sport, position, rating: p.football_ability,
        intendedMajor: p.intended_major ?? null,
        priorityRanking: p.criterion_ranking ? JSON.parse(p.criterion_ranking) : null,
        competitiveLevelPriority: profile.competitiveLevelPriority,
        playingOpportunityPriority: profile.playingOpportunityPriority,
        academicStrengthPriority: profile.academicStrengthPriority,
      },
    };

    /**
     * Components are captured PER FIXTURE, not per run. An arm that varies the
     * family contribution needs no Opportunity component at all, and carrying
     * three for it anyway cost two megabytes of artifact describing cells
     * nothing asks about.
     */
    const wanted = Array.isArray(components) ? components
      : (components?.[f.id] ?? components?.['*'] ?? []);

    const rep = runPursuit({ athlete, sport: p.sport, colleges, ctx });
    const rankById = new Map(rep.pipeline.ranked.map((r) => [r.id, r.rank]));

    const athleteIndex = athletes.length;
    athletes.push({
      fixtureId: f.id,
      frozen: f.frozen,
      sport: p.sport,
      position,
      rating: p.football_ability,
      entryYear: p.recruiting_class_year,
      gpa: p.gpa,
      sat: p.sat_score ?? null,
      budgetRange: p.budget_range ?? null,
      homeState: p.state ?? null,
      nationality: p.nationality ?? p.origin ?? null,
      profile: profileName,
      preferences: {
        competitiveLevelPriority: profile.competitiveLevelPriority,
        playingOpportunityPriority: profile.playingOpportunityPriority,
        academicStrengthPriority: profile.academicStrengthPriority,
      },
      counts: rep.counts,
      poolSize: colleges.length,
    });

    for (const e of [...rep.pipeline.ranked, ...rep.pipeline.limited,
      ...(rep.pipeline.ineligible ?? []), ...(rep.pipeline.suppressed ?? [])]) {
      if (!programmes.has(e.id)) {
        const rule = eligibilityRuleFor({ division: e.division, season: Number(SEASON) });
        programmes.set(e.id, {
          programmeId: e.id,
          programme: e.name,
          division: e.division,
          sport: p.sport,
          universe: universeOf({ division: e.division, season: Number(SEASON) }),
          eligibilityModel: rule.model,
        });
      }
      cells.push(drop({
        f: athleteIndex,
        p: e.id,
        st: e.rankingState,
        rk: rankById.get(e.id) ?? null,
        pp: e.pursuitPriority && e.pursuitPriority.ok !== false
          ? num(e.pursuitPriority.value) : null,
        pg: e.pursuitPriority?.grade ?? null,
        ml: Array.isArray(e.missingLayers) && e.missingLayers.length
          ? [...e.missingLayers].sort() : null,
        R: layerCell(e.recruitability),
        F: layerCell(e.financial),
        O: layerCell(e.opportunity),
        cmp: wanted.length
          ? Object.fromEntries(wanted.map((n) => [n, componentCell(e.opportunity, n)]))
          : null,
      }));
    }
  }

  const { corpusDigests } = await import('./a8CorpusGuard.js');
  const corpus = corpusDigests(db, { season: SEASON });

  const programmeRows = [...programmes.values()].sort((a, b) => a.programmeId.localeCompare(b.programmeId));
  const programmeIndex = new Map(programmeRows.map((r, i) => [r.programmeId, i]));
  for (const c of cells) c.p = programmeIndex.get(c.p);

  /** Sorted so the digest cannot depend on pool iteration order. */
  cells.sort((a, b) => (a.f - b.f) || (a.p - b.p));
  const body = {
    version: A8_BASELINE_VERSION, season: SEASON, profile: profileName,
    /**
     * The corpus this describes. Without it the artifact is a set of numbers
     * with no stated subject - and on a database two branches write to, "the
     * numbers moved" and "the evidence moved" are not the same finding.
     */
    corpus,
    athletes, programmes: programmeRows, cells,
  };
  const digest = crypto.createHash('sha256').update(JSON.stringify(cells)).digest('hex');
  return { ...body, cellDigest: digest, cellCount: cells.length };
}

async function main() {
  const args = process.argv.slice(2);
  const out = args.find((a) => a.startsWith('--out='))?.split('=')[1] ?? null;
  const profileName = args.find((a) => a.startsWith('--profile='))?.split('=')[1] ?? 'UNDECLARED';
  const baseline = await buildBaseline({ profileName });

  console.log(`A8 baseline  profile=${baseline.profile}  cells=${baseline.cellCount}`);
  console.log(`digest ${baseline.cellDigest}`);
  for (const a of baseline.athletes) {
    const c = a.counts;
    console.log(`  ${a.fixtureId.padEnd(46)} pool ${String(a.poolSize).padStart(4)}  `
      + `RANKED ${String(c.ranked).padStart(4)}  LIMITED ${String(c.limitedData).padStart(4)}  `
      + `INELIGIBLE ${c.ineligible}  SUPPRESSED ${c.suppressed}`);
  }
  if (out) {
    const file = path.resolve(out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(baseline)}\n`);
    console.log(`wrote ${file}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('a8Baseline.js')) await main();
