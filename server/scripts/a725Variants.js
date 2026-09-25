/**
 * A7.25: generate the blind preference-authority comparison packs.
 *
 *   node server/scripts/a725Variants.js --athlete=C --out=docs/validation
 *
 * READ-ONLY against the database and against production. It runs the shipped
 * `runPursuit` once and then re-sorts the SAME ranked entries under a bounded,
 * non-inverting multiplier. No scorer file is imported for writing, nothing is
 * mutated, and the variant term exists only in this file.
 *
 * -- WHY THE TERM LIVES HERE AND NOT IN A LAYER ---------------------------
 *
 * A7.25 is a validation phase with DO NOT IMPLEMENT on it. Putting the
 * candidate multiplier in `pursuit.js` behind a flag would make the phase a
 * scoring change with a switch, which is the thing the brief forbids. Here it
 * cannot reach production even by accident: nothing imports this file.
 *
 * -- THE SEALED FILE ------------------------------------------------------
 *
 * The variant -> display-letter mapping is derived from a hash, written to the
 * sealed file, and printed NOWHERE. The generator deliberately does not log
 * it. Opening the sealed file ends the blind review.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import db from '../db/client.js';
import { buildPoolContext } from '../lib/v2/poolContext.js';
import { normaliseAthlete } from '../../shared/matching/pool.js';
import { canonicalPosition } from '../../shared/positions.js';
import { buildValidationAthlete, isScoreable, programmeFacts } from '../../shared/matching/v2/index.js';
import { runPursuit } from '../lib/v2/pursuitRun.js';
import { buildValidationFacts } from '../lib/v2/validationFacts.js';
import { academicPercentileScale } from '../lib/v2/opportunityRun.js';
import { V3_ATHLETES, v3Athlete } from '../scripts/v3Athletes.js';
import { renderA725ViewA } from '../../shared/matching/v2/validation/renderA725.js';

const SEASON = '2026';
const LIST_LENGTH = 25;
const DEEP_LENGTH = 100;

const sha = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const arg = (k, d = null) => process.argv.slice(2).find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;

/**
 * THE CANDIDATE TERM. Bounded above by 1, so a weak signal is never rewarded
 * and a strong one is never given a bonus - the locked A7.24 semantics.
 */
const authority = (v, tau) => 1 - (tau * (1 - v));

/** The three variants, frozen by docs/validation/A7.25-design.md. */
export const VARIANTS = Object.freeze([
  { id: 'control', tau: 0 },
  { id: 'moderate', tau: 0.40 },
  { id: 'strong', tau: 0.70 },
]);

/** Which Opportunity component each athlete's stated-5 preference reads. */
const FOCAL = Object.freeze({
  'V3-C-strong-playing-focused': 'playingPathway',
  'V3-E-academic-priority': 'academicStrengthFit',
});

/**
 * Re-sort the production ranked list under one variant.
 *
 * The comparator is production's, character for character, with P' in place of
 * P - a different tiebreak would move programmes for a reason that is not the
 * variant.
 */
function rerank(ranked, { focalKey, tau }) {
  const scored = ranked.map((e) => {
    const ob = isScoreable(e.opportunity) ? e.opportunity.basis : null;
    const comp = ob?.components?.[focalKey] ?? null;
    // No evidence means NO ADJUSTMENT. It must never mean a penalty.
    const v = comp && Number.isFinite(comp.value) ? comp.value : null;
    const factor = (tau === 0 || v === null) ? 1 : authority(v, tau);
    return { entry: e, focal: v, factor, P: e.pursuitPriority.value * factor };
  });
  scored.sort((a, b) =>
    b.P - a.P
    || b.entry.recruitability.value - a.entry.recruitability.value
    || b.entry.financial.value - a.entry.financial.value
    || b.entry.opportunity.value - a.entry.opportunity.value
    || String(a.entry.name).localeCompare(String(b.entry.name)));
  scored.forEach((s, i) => { s.rank = i + 1; });
  return scored;
}

function build(def, ctx) {
  const p = def.player;
  const focalKey = FOCAL[def.id];
  if (!focalKey) throw new Error(`a725Variants: ${def.id} is not one of the two A7.25 athletes`);

  const v1Shape = normaliseAthlete({ ...p, preferred_divisions: '[]', preferred_conferences: '[]' });
  const { athlete, inputs } = buildValidationAthlete({
    record: p, v1Shape, position: canonicalPosition(p.position), label: def.id,
    profile: {
      competitiveLevelPriority: p.competitive_level_priority,
      playingOpportunityPriority: p.playing_opportunity_priority,
      academicStrengthPriority: p.academic_strength_priority,
    },
  });
  const run = runPursuit({ athlete, sport: p.sport, colleges: ctx.colleges, ctx });
  const ranked = run.pipeline.ranked;

  const lists = new Map(VARIANTS.map((v) => [v.id, rerank(ranked, { focalKey, tau: v.tau })]));

  /**
   * THE MAPPING. Derived, never random, and written only to the sealed file.
   * Sorting by a hash of (packId, variantId) fixes it before anything is read.
   */
  const letters = ['A', 'B', 'C'];
  const mapping = VARIANTS
    .map((v) => ({ id: v.id, key: sha([def.id, 'variant-order', v.id]) }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((v, i) => ({ letter: letters[i], variant: v.id }));

  // Every programme any variant puts in its first LIST_LENGTH.
  const shown = new Set();
  for (const v of VARIANTS) for (const s of lists.get(v.id).slice(0, LIST_LENGTH)) shown.add(s.entry.id);

  /**
   * Blind codes, assigned by hash order over the union. A code cannot track
   * any variant's rank because nothing about any ranking enters the hash.
   */
  const codes = new Map([...shown]
    .map((id) => ({ id, key: sha([def.id, 'code', id]) }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((r, i) => [r.id, `P-${String(i + 1).padStart(3, '0')}`]));

  const factsById = buildValidationFacts({
    colleges: ctx.colleges, ctx, sport: p.sport, position: canonicalPosition(p.position),
    entryYear: p.recruiting_class_year,
    athleteState: p.state ?? null,
    athleteIsInternational: v1Shape.origin === 'International',
    academicScale: academicPercentileScale(ctx.colleges),
  });
  const collegesById = new Map(ctx.colleges.map((c) => [c.id, c]));

  const programmes = [...codes.entries()]
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id, code]) => ({ code, facts: programmeFacts(collegesById.get(id), factsById.get(id) ?? null) }));

  const blindLists = mapping.map(({ letter, variant }) => ({
    letter,
    programmes: lists.get(variant).slice(0, LIST_LENGTH).map((s, i) => ({ position: i + 1, code: codes.get(s.entry.id) })),
  })).sort((a, b) => a.letter.localeCompare(b.letter));

  const pack = {
    packId: `A7.25-${def.id}`,
    athlete: {
      ...inputs, role: def.role,
      contributionState: p.contribution_state,
      maxAnnualContributionUsd: p.max_annual_contribution_usd,
    },
    universe: { ranked: run.counts.ranked, limitedData: run.counts.limitedData, poolSize: run.counts.evaluated },
    listLength: LIST_LENGTH,
    programmes,
    lists: blindLists,
    digests: {
      athlete: sha(p).slice(0, 16),
      programmes: sha(programmes).slice(0, 16),
      lists: sha(blindLists).slice(0, 16),
    },
  };

  const sealed = {
    packId: pack.packId,
    note: 'SEALED. Opening this file ends the blind review.',
    focalComponent: focalKey,
    mapping,
    variants: VARIANTS.map((v) => ({ ...v })),
    codes: [...codes.entries()].map(([id, code]) => ({ code, id, name: collegesById.get(id)?.name ?? null })),
    deep: Object.fromEntries(VARIANTS.map((v) => [v.id, lists.get(v.id).slice(0, DEEP_LENGTH).map((s) => ({
      rank: s.rank,
      id: s.entry.id,
      name: s.entry.name,
      code: codes.get(s.entry.id) ?? null,
      controlRank: s.entry.rank,
      P: s.P,
      basePursuit: s.entry.pursuitPriority.value,
      factor: s.factor,
      focal: s.focal,
      R: isScoreable(s.entry.recruitability) ? s.entry.recruitability.value : null,
      F: isScoreable(s.entry.financial) ? s.entry.financial.value : null,
      O: isScoreable(s.entry.opportunity) ? s.entry.opportunity.value : null,
      strength: collegesById.get(s.entry.id)?.soccer_score ?? null,
      division: collegesById.get(s.entry.id)?.division ?? null,
      netPrice: collegesById.get(s.entry.id)?.net_price ?? null,
      academicRating: collegesById.get(s.entry.id)?.academic_rating ?? null,
      components: isScoreable(s.entry.opportunity)
        ? Object.fromEntries(Object.entries(s.entry.opportunity.basis.components).map(([k, c]) => [k, c.value])) : null,
    }))])),
    full: Object.fromEntries(VARIANTS.map((v) => [v.id, lists.get(v.id).map((s) => s.entry.id)])),
    equivalentProgrammeScore: inputs.equivalentProgrammeScore,
  };

  return { pack, sealed };
}

function main() {
  const key = arg('athlete');
  const outDir = arg('out', 'docs/validation');
  const chosen = key && key.toLowerCase() === 'all'
    ? V3_ATHLETES.filter((a) => FOCAL[a.id])
    : [v3Athlete(key)].filter((a) => a && FOCAL[a.id]);
  if (!chosen.length) { console.error('Usage: a725Variants.js --athlete=<C|E|all> [--out=dir]'); process.exit(2); }

  const ctxCache = new Map();
  for (const def of chosen) {
    const sport = def.player.sport;
    if (!ctxCache.has(sport)) ctxCache.set(sport, buildPoolContext({ db, sport, season: SEASON }));
    const { pack, sealed } = build(def, ctxCache.get(sport));

    const md = renderA725ViewA(pack);
    /**
     * AUDITED BEFORE IT IS WRITTEN. The blind sheet must not contain a
     * programme name outside the facts block, a variant id, or a number that
     * could only be a score.
     */
    const failures = [];
    /**
     * THE CHECKS TEST FOR A LEAK, NOT FOR A WORD.
     *
     * The first draft rejected both sheets because "strong" occurs inside
     * "Programme strength" and "a strong academic profile". A substring match
     * on an ordinary English word is not an audit: it fails on prose, and it
     * would still have passed a sheet that labelled a list some other way.
     * What actually leaks is a variant id used as a LABEL, so that is what
     * these look for.
     */
    const ids = VARIANTS.map((v) => v.id).join('|');
    if (new RegExp(`(list|variant|architecture|version)\\s*[a-c]?\\s*[=:(-]\\s*(${ids})`, 'i').test(md)) {
      failures.push('a variant id is used as a list label in the sheet');
    }
    if (/\btau\b|τ|authority\s*\(|multiplier/i.test(md)) failures.push('the candidate term appears in the sheet');
    if (/pursuit priority|\bgate\b|opportunity value|recruitability value/i.test(md)) failures.push('a layer value appears in the sheet');
    for (const m of sealed.mapping) {
      for (const sep of [' = ', ': ', ' is ', ' — ', ' - ']) {
        if (md.includes(`${m.letter}${sep}${m.variant}`)) failures.push('the mapping appears in the sheet');
      }
    }
    /**
     * THE STRUCTURAL CHECK, which is the one that actually holds.
     *
     * Searching the rendered markdown for the tau values matched "0.4" inside
     * a win rate and "0.7" inside a ratio - data, not a leak. The real
     * guarantee is upstream: the object handed to the renderer carries no
     * variant id and no tau, so the renderer has nothing to print. Assert
     * that instead of grepping the output for numbers the data also contains.
     */
    const packText = JSON.stringify(pack);
    for (const v of VARIANTS) {
      if (v.tau && packText.includes(`"tau"`)) failures.push('the pack carries a tau');
      if (v.id !== 'control' && packText.includes(`"${v.id}"`)) failures.push(`the pack carries the variant id ${v.id}`);
    }
    if (packText.includes('"variant"') || packText.includes('"factor"') || packText.includes('"pursuitPriority"')) {
      failures.push('the pack carries model state');
    }

    fs.mkdirSync(outDir, { recursive: true });
    const base = path.join(outDir, pack.packId);
    if (failures.length) {
      console.error(`BLIND AUDIT FAILED for ${pack.packId} — nothing written.`);
      for (const f of failures) console.error(`  ${f}`);
      process.exitCode = 1;
      continue;
    }
    fs.writeFileSync(`${base}.viewA.md`, md);
    fs.writeFileSync(`${base}.pack.json`, `${JSON.stringify(pack, null, 2)}\n`);
    fs.writeFileSync(`${base}.sealed.json`, `${JSON.stringify(sealed, null, 2)}\n`);

    console.log(`== ${pack.packId} ==`);
    console.log(`   universe ${pack.universe.poolSize} · ranked ${pack.universe.ranked} · limited ${pack.universe.limitedData}`);
    console.log(`   distinct programmes across the three lists: ${pack.programmes.length}`);
    console.log(`   digests: athlete ${pack.digests.athlete} · programmes ${pack.digests.programmes} · lists ${pack.digests.lists}`);
    console.log(`   audit: 5 checks, 0 failures`);
    console.log(`   written ${base}.viewA.md / .pack.json / .sealed.json  (SEALED — do not open)`);
  }
}
main();
