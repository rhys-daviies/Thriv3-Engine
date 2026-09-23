/**
 * A7.7.6a: does a stated academic preference let an athletically unrealistic
 * elite programme onto a developmental athlete's list?
 *
 * READ-ONLY. It runs the real pipeline and reports; it changes nothing.
 *
 *   node server/scripts/v2EliteGuard.js --audit
 *   node server/scripts/v2EliteGuard.js --sweep
 *   node server/scripts/v2EliteGuard.js --trace="Bryn Athyn"
 *
 * THE COHORT: academic_rating >= 8 AND soccer_score >= 55 - elite on both
 * axes, which for a rating-3 athlete is the case Fixture C exists to guard
 * against and the one its 43-row blind sample happened to contain none of.
 */
import db from '../db/client.js';
import { canonicalPosition } from '../../shared/positions.js';
import { normaliseAthlete } from '../../shared/matching/pool.js';
import { buildPoolContext } from '../lib/v2/poolContext.js';
import { runPursuit } from '../lib/v2/pursuitRun.js';
import { isScoreable, isNotApplicable, PURSUIT_GATES, tailGate } from '../../shared/matching/v2/index.js';
import { FIXTURES } from './v2Fixtures.js';

const SEASON = '2026';
const ELITE = { academic: 8, strength: 55 };
const N = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');

let CTX = null;
function run(academicPriority) {
  const f = FIXTURES.find((x) => x.id.startsWith('C-'));
  const sport = f.player.sport;
  if (!CTX) CTX = buildPoolContext({ db, sport, season: SEASON });
  const position = canonicalPosition(f.player.position);
  const v1Shape = normaliseAthlete({ ...f.player, preferred_divisions: '[]', preferred_conferences: '[]' });
  const rep = runPursuit({
    athlete: {
      label: { id: f.id }, v1Shape,
      recruitability: {
        sport, rating: f.player.football_ability, position,
        entryYear: f.player.recruiting_class_year, isInternational: false,
        homeState: f.player.state ?? null,
      },
      opportunity: {
        sport, position, rating: f.player.football_ability, intendedMajor: null, priorityRanking: null,
        competitiveLevelPriority: 3, playingOpportunityPriority: 3,
        academicStrengthPriority: academicPriority,
      },
    },
    sport, colleges: CTX.colleges, ctx: CTX,
  });
  return { rep, f, byId: new Map(CTX.colleges.map((c) => [c.id, c])) };
}

/** Everything about one programme, flattened, with no model conclusion hidden. */
function describe(entry, college) {
  const rOk = isScoreable(entry.recruitability);
  const b = rOk ? entry.recruitability.basis : (entry.recruitability.detail ?? {});
  const mk = rOk ? b.market : null;
  const oppOk = isScoreable(entry.opportunity);
  const ob = oppOk ? entry.opportunity.basis : {};
  const pOk = isScoreable(entry.pursuitPriority);
  return {
    name: entry.name, division: entry.division,
    academic: college?.academic_rating ?? null, strength: college?.soccer_score ?? null,
    state: entry.rankingState, rank: entry.rank ?? null,
    A: b.athleticPlausibility ?? null,
    delta: b.athleticDelta ?? null,
    positionalState: rOk ? (b.positionalState ?? null) : (entry.recruitability.reason ?? null),
    positional: rOk && b.positional
      ? (b.positional.expectedNewcomerPlaces - b.positional.claims) / b.positional.typicalStarters : null,
    marketArm: mk?.arm ?? (rOk ? b.marketState : null),
    market: rOk ? (b.signals?.find((s) => s.key === 'recruitingMarket')?.value ?? null) : null,
    support: b.support ?? null,
    coverage: rOk ? entry.recruitability.coverage : null,
    R: rOk ? entry.recruitability.value : null,
    gR: rOk ? tailGate(entry.recruitability.value, PURSUIT_GATES.recruitability) : null,
    F: isScoreable(entry.financial) ? entry.financial.value : null,
    O: oppOk ? entry.opportunity.value : null,
    academicComponent: ob.academic ? ob.academic.academicPercentile : (isNotApplicable(ob.academic) ? 'N/A' : null),
    P: pOk ? entry.pursuitPriority.value : null,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) { console.error('Usage: --audit | --sweep | --trace="Name"'); process.exit(2); }

  if (args.includes('--audit')) {
    const { rep, byId } = run(5);
    const all = [...rep.pipeline.ranked, ...rep.pipeline.limited];
    const elite = all.map((e) => ({ e, c: byId.get(e.id) }))
      .filter(({ c }) => c && c.academic_rating >= ELITE.academic && c.soccer_score >= ELITE.strength)
      .map(({ e, c }) => describe(e, c))
      .sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0));

    console.log(`== ELITE GUARD: academic >= ${ELITE.academic} AND strength >= ${ELITE.strength} ==`);
    console.log(`   Fixture C, academic_strength_priority = 5. Pool ${rep.counts.evaluated}, ranked ${rep.counts.ranked}.`);
    console.log(`   Cohort size: ${elite.length}`);
    console.log('');
    const inTop = (n) => elite.filter((x) => x.rank !== null && x.rank <= n).length;
    console.log(`   in top 10: ${inTop(10)}   top 25: ${inTop(25)}   top 50: ${inTop(50)}   top 100: ${inTop(100)}`);
    const ranked = elite.filter((x) => x.state === 'RANKED');
    console.log(`   RANKED: ${ranked.length}   LIMITED_DATA: ${elite.length - ranked.length}`);
    if (ranked.length) {
      const rs = ranked.map((x) => x.rank).sort((a, b) => a - b);
      console.log(`   best rank ${rs[0]}   median ${rs[Math.floor(rs.length / 2)]}   worst ${rs[rs.length - 1]}`);
    }
    console.log('');
    console.log(`   ${'programme'.padEnd(26)}${'div'.padEnd(9)}${'acad'.padStart(5)}${'str'.padStart(7)}${'A'.padStart(7)}${'delta'.padStart(8)}${'R'.padStart(7)}${'gR'.padStart(7)}${'F'.padStart(6)}${'O'.padStart(6)}${'P'.padStart(7)}${'rank'.padStart(6)}  state`);
    for (const x of elite) {
      console.log(`   ${x.name.slice(0, 25).padEnd(26)}${String(x.division).padEnd(9)}${String(x.academic).padStart(5)}${String(x.strength).padStart(7)}`
        + `${N(x.A, 2).padStart(7)}${N(x.delta, 2).padStart(8)}${N(x.R, 2).padStart(7)}${N(x.gR, 2).padStart(7)}`
        + `${N(x.F, 2).padStart(6)}${N(x.O, 2).padStart(6)}${N(x.P, 3).padStart(7)}${String(x.rank ?? '—').padStart(6)}  ${x.state}`);
    }
    console.log('');
    console.log('   TEN STRONGEST, traced:');
    for (const x of elite.slice(0, 10)) {
      console.log(`     ${x.name} (${x.division}, academic ${x.academic}, strength ${x.strength})`);
      console.log(`       athlete percentile 0.180 vs programme percentile ${N(0.180 - (x.delta ?? 0), 3)}  ->  delta ${N(x.delta, 3)}`);
      console.log(`       athletic plausibility A = ${N(x.A, 4)}`);
      console.log(`       positional ${x.positionalState} ${x.positional === null ? '' : N(x.positional, 3)} · market ${x.marketArm} ${x.market === null ? '' : N(x.market, 3)} · support ${N(x.support, 3)} · coverage ${x.coverage}`);
      console.log(`       R = A x (0.35 + 0.65 x support) = ${N(x.R, 4)}   gate gR = ${N(x.gR, 3)}`);
      console.log(`       F ${N(x.F, 2)} · O ${N(x.O, 2)} (academic component ${x.academicComponent === 'N/A' ? 'NOT_APPLICABLE' : N(x.academicComponent, 3)})`);
      console.log(`       P = ${N(x.P, 4)}  ->  ${x.state}${x.rank ? ` #${x.rank}` : ''}`);
    }
  }

  if (args.includes('--sweep')) {
    console.log('== ACADEMIC PRIORITY SWEEP over the elite cohort ==');
    console.log(`   ${'priority'.padEnd(10)}${'ranked'.padStart(8)}${'elite RANKED'.padStart(14)}${'best rank'.padStart(11)}${'median'.padStart(8)}${'top100'.padStart(8)}${'top25'.padStart(7)}${'top10'.padStart(7)}`);
    for (const p of [null, 1, 3, 5]) {
      const { rep, byId } = run(p);
      const all = [...rep.pipeline.ranked, ...rep.pipeline.limited];
      const elite = all.map((e) => ({ e, c: byId.get(e.id) }))
        .filter(({ c }) => c && c.academic_rating >= ELITE.academic && c.soccer_score >= ELITE.strength)
        .map(({ e, c }) => describe(e, c));
      const ranked = elite.filter((x) => x.state === 'RANKED').map((x) => x.rank).sort((a, b) => a - b);
      console.log(`   ${String(p ?? 'NULL').padEnd(10)}${String(rep.counts.ranked).padStart(8)}${String(ranked.length).padStart(14)}`
        + `${String(ranked[0] ?? '—').padStart(11)}${String(ranked.length ? ranked[Math.floor(ranked.length / 2)] : '—').padStart(8)}`
        + `${String(ranked.filter((r) => r <= 100).length).padStart(8)}${String(ranked.filter((r) => r <= 25).length).padStart(7)}${String(ranked.filter((r) => r <= 10).length).padStart(7)}`);
    }
  }

  const traceArg = args.find((a) => a.startsWith('--trace='));
  if (traceArg) {
    const want = traceArg.split('=')[1].replace(/^["']|["']$/g, '');
    for (const p of [5, null]) {
      const { rep, byId } = run(p);
      const entry = [...rep.pipeline.ranked, ...rep.pipeline.limited].find((e) => e.name === want);
      if (!entry) { console.log(`${want}: not in the evaluated pool`); break; }
      const x = describe(entry, byId.get(entry.id));
      console.log(`== ${want} — academic_strength_priority ${p ?? 'NULL'} ==`);
      console.log(`   division ${x.division} · academic ${x.academic} · strength ${x.strength}`);
      console.log(`   athletic plausibility A       ${N(x.A, 4)}   (delta ${N(x.delta, 3)})`);
      console.log(`   positional evidence           ${x.positionalState}${x.positional === null ? '' : ` value ${N(x.positional, 3)}`}`);
      console.log(`   recruiting market             ${x.marketArm}${x.market === null ? '' : ` value ${N(x.market, 3)}`}`);
      console.log(`   behavioural support           ${N(x.support, 3)}   coverage ${x.coverage}`);
      console.log(`   RECRUITABILITY R              ${x.R === null ? 'UNSCOREABLE' : N(x.R, 4)}`);
      console.log(`   Financial F                   ${N(x.F, 3)}`);
      console.log(`   Opportunity O                 ${N(x.O, 3)}   academic component ${x.academicComponent === 'N/A' ? 'NOT_APPLICABLE' : N(x.academicComponent, 3)}`);
      console.log(`   Pursuit P                     ${N(x.P, 4)}`);
      console.log(`   STATE                         ${x.state}${x.rank ? `  rank #${x.rank} of ${rep.counts.ranked}` : ''}`);
      console.log('');
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
