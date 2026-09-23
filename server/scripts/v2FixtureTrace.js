/**
 * A7.7.8: what V2 actually did with one validation fixture, programme by
 * programme, so a blind human review can be compared against the evidence
 * rather than against the score alone.
 *
 * READ-ONLY AND DIAGNOSTIC. Nothing here scores, weights, gates or calibrates
 * anything; the run is the ordinary `runPursuit` the pack generator uses, and
 * every number printed is read back off the basis objects it produced.
 *
 *   node server/scripts/v2FixtureTrace.js --fixture=A --profile=FULLY_DECLARED_LEVEL --table
 *   node server/scripts/v2FixtureTrace.js --fixture=A --profile=FULLY_DECLARED_LEVEL --trace=Princeton
 *   node server/scripts/v2FixtureTrace.js --fixture=A --profile=FULLY_DECLARED_LEVEL --opportunity
 */
import { VALIDATION_FIXTURES, PROFILES } from './v2ValidationFixtures.js';
import { FIXTURES } from './v2Fixtures.js';

const SEASON = '2026';
const fmt = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');

async function main() {
  const args = process.argv.slice(2);
  const arg = (k, dflt = null) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? dflt;
  const fixtureKey = (arg('fixture') ?? 'A').toUpperCase();
  const profileId = arg('profile') ?? 'FULLY_DECLARED_LEVEL';

  const { default: db } = await import('../db/client.js');
  const { canonicalPosition } = await import('../../shared/positions.js');
  const { normaliseAthlete } = await import('../../shared/matching/pool.js');
  const { buildPoolContext } = await import('../lib/v2/poolContext.js');
  const { runPursuit } = await import('../lib/v2/pursuitRun.js');
  const { buildValidationAthlete } = await import('../../shared/matching/v2/index.js');
  const { positionEvidence } = await import('../lib/v2/rosterEvidence.js');

  const fixture = [...FIXTURES, ...VALIDATION_FIXTURES]
    .find((f) => f.id.toUpperCase() === fixtureKey || f.id.toUpperCase().startsWith(`${fixtureKey}-`));
  if (!fixture) { console.error(`no fixture ${fixtureKey}`); process.exit(2); }
  const profile = PROFILES[profileId];
  if (!profile) { console.error(`no profile ${profileId}`); process.exit(2); }

  const sport = fixture.player.sport;
  const position = canonicalPosition(fixture.player.position);
  const ctx = buildPoolContext({ db, sport, season: SEASON });
  const v1Shape = normaliseAthlete({ ...fixture.player, preferred_divisions: '[]', preferred_conferences: '[]' });
  const { athlete } = buildValidationAthlete({
    record: fixture.player, v1Shape, position, label: `${fixture.id} · ${profile.label}`, profile,
    recruitType: fixture.recruitType ?? null,
  });
  const run = runPursuit({ athlete, sport, colleges: ctx.colleges, ctx });
  const byId = new Map(ctx.colleges.map((c) => [c.id, c]));

  const rowOf = (e) => {
    const b = e.recruitability.basis ?? {};
    const c = byId.get(e.id);
    const ob = e.opportunity.basis ?? {};
    const comp = (k) => ob.components?.[k] ?? null;
    return {
      id: e.id, name: e.name, division: e.division, rank: e.rank,
      strength: c?.soccer_score ?? null,
      academic: c?.academic_rating ?? null,
      A: b.athleticPlausibility ?? null,
      delta: b.athleticDelta ?? null,
      phi: b.phi ?? null,
      core: b.core ?? null,
      positional: b.signals?.find((x) => x.key === 'positionalOpportunity')?.value ?? null,
      market: b.signals?.find((x) => x.key === 'recruitingMarket')?.value ?? null,
      known: (b.signals ?? []).filter((x) => x.known).map((x) => x.key).join('+') || '—',
      R: e.recruitability.value, Rgrade: e.recruitability.grade, Rcov: e.recruitability.coverage,
      F: e.financial.value, O: e.opportunity.value, P: e.pursuitPriority.value,
      gateR: e.pursuitPriority.basis?.recruitabilityGate ?? null,
      gateF: e.pursuitPriority.basis?.financialGate ?? null,
      base: e.pursuitPriority.basis?.base ?? null,
      oPlaying: comp('playingOpportunity')?.value ?? null,
      oOutcome: comp('athleticOutcome')?.value ?? null,
      oPlayingShare: comp('playingOpportunity')?.share ?? null,
      oAcademicShare: comp('academicStrengthFit')?.share ?? null,
      multipliers: JSON.stringify(ob.ambition?.multipliers ?? {}),
      oAcademic: comp('academicStrengthFit')?.value ?? null,
      state: 'RANKED',
      fBasis: e.financial.basis ?? null,
      oBasis: ob,
      rBasis: b,
    };
  };

  const ranked = run.pipeline.ranked.map(rowOf);
  const limited = run.pipeline.limited.map((e) => ({
    id: e.id, name: e.name, division: e.division, rank: null,
    strength: byId.get(e.id)?.soccer_score ?? null,
    academic: byId.get(e.id)?.academic_rating ?? null,
    state: 'LIMITED_DATA',
    reason: (e.layers ?? []).filter((l) => !l.ok).map((l) => `${l.layer}:${l.reason}`).join(' '),
  }));
  const all = new Map([...ranked, ...limited].map((r) => [r.name, r]));

  if (args.includes('--table')) {
    const want = arg('names');
    const names = want ? want.split('|') : [...all.keys()];
    console.log('name\tdiv\tstrength\tacad\tstate\trank\tA\tdelta\tpositional\tmarket\tknown\tR\tRgrade\tF\tO\tP\tgateR\toPlaying\toOutcome\toAcad\toPlayShare\tmultipliers\treason');
    for (const n of names) {
      const r = all.get(n);
      if (!r) { console.log(`${n}\tNOT FOUND`); continue; }
      console.log([r.name, r.division, fmt(r.strength, 1), fmt(r.academic, 1), r.state, r.rank ?? '—',
        fmt(r.A), fmt(r.delta), fmt(r.positional), fmt(r.market), r.known ?? '—',
        fmt(r.R), r.Rgrade ?? '—', fmt(r.F), fmt(r.O), fmt(r.P), fmt(r.gateR),
        fmt(r.oPlaying), fmt(r.oOutcome), fmt(r.oAcademic), fmt(r.oPlayingShare), r.multipliers ?? '', r.reason ?? ''].join('\t'));
    }
  }

  if (args.includes('--summary')) {
    const n = ranked.length;
    const corr = (xs, ys) => {
      const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
      const my = ys.reduce((a, b) => a + b, 0) / ys.length;
      let sxy = 0; let sxx = 0; let syy = 0;
      for (let i = 0; i < xs.length; i += 1) { const dx = xs[i] - mx; const dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
      return sxy / Math.sqrt(sxx * syy);
    };
    const withStrength = ranked.filter((r) => Number.isFinite(r.strength));
    console.log(`ranked ${n}  limited ${limited.length}`);
    for (const k of ['R', 'F', 'O', 'P', 'A']) {
      console.log(`  corr(strength, ${k}) = ${fmt(corr(withStrength.map((r) => r.strength), withStrength.map((r) => r[k])))}`);
    }
    const top = (m) => ranked.filter((r) => r.rank <= m);
    for (const m of [25, 100]) {
      const t = top(m);
      const ss = t.map((r) => r.strength).filter(Number.isFinite).sort((a, b) => a - b);
      const comp = {};
      for (const r of t) comp[r.division] = (comp[r.division] ?? 0) + 1;
      console.log(`  top ${m}: median strength ${fmt(ss[Math.floor(ss.length / 2)], 1)}  max ${fmt(ss[ss.length - 1], 1)}  ${JSON.stringify(comp)}`);
    }
  }

  const traceName = arg('trace');
  if (traceName) {
    const r = all.get(traceName) ?? [...all.values()].find((x) => x.name.toLowerCase().includes(traceName.toLowerCase()));
    if (!r) { console.error(`${traceName} not in this run`); process.exit(3); }
    const c = byId.get(r.id);
    const ev = positionEvidence({
      programme: c.name, position, sport, division: c.division,
      entryYear: fixture.player.recruiting_class_year,
      rosterIndex: ctx.rosterIndex, arrivalIndex: ctx.arrivalIndex, arrivalsHorizon: ctx.arrivalsHorizon,
    });
    console.log(`== ${c.name} (${c.division}) · ${fixture.id} · ${profileId} ==`);
    console.log(`  programme strength   ${fmt(c.soccer_score, 1)}   academic ${fmt(c.academic_rating, 1)}`);
    console.log(`  state                ${r.state}   rank ${r.rank ?? '—'} of ${ranked.length}`);
    if (r.state !== 'RANKED') { console.log(`  refusal              ${r.reason}`); }
    console.log(`  athletic delta       ${fmt(r.delta)}   plausibility A ${fmt(r.A)}`);
    console.log(`  roster on file       ${ev.rosterOnFile}  rows at ${position} ${ev.positionRows}  unreadable ${ev.unreadable}`);
    console.log(`  vacated starters     ${ev.vacatedStarters}  openings ${ev.openings}  eligible to remain ${ev.eligibleToRemain}`);
    console.log(`  fill rate            ${fmt(ev.fill?.rate)} (${ev.fill?.hits}/${ev.fill?.trials}, ${ev.fill?.level})`);
    console.log(`  positional signal    ${fmt(r.positional)}   market signal ${fmt(r.market)}   known [${r.known}]`);
    console.log(`  phi ${fmt(r.phi)}  core ${fmt(r.core)}  ->  R ${fmt(r.R)} (${r.Rgrade}, coverage ${fmt(r.Rcov, 2)})`);
    console.log(`  F ${fmt(r.F)}   O ${fmt(r.O)}  [playing ${fmt(r.oPlaying)} (share ${fmt(r.oPlayingShare, 2)}) outcome ${fmt(r.oOutcome)} academic ${fmt(r.oAcademic)}]`);
    console.log(`  preference multipliers ${r.multipliers}`);
    console.log(`  financial basis      ${JSON.stringify(r.fBasis)}`);
    console.log(`  recruitability basis ${JSON.stringify(r.rBasis)}`);
    console.log(`  base ${fmt(r.base)}  gateR ${fmt(r.gateR)}  gateF ${fmt(r.gateF)}  ->  P ${fmt(r.P)}`);
  }

  if (args.includes('--zero')) {
    /**
     * How often a *measured* zero positional signal is produced from a cohort
     * the roster could only partly place, and whether that lands evenly across
     * divisions. A zero here is scored as confident absence of demand.
     */
    const withPositional = ranked.filter((r) => r.rBasis?.signals);
    const byDiv = {};
    for (const r of withPositional) {
      const sig = r.rBasis.signals.find((x) => x.key === 'positionalOpportunity');
      const d = r.division ?? '—';
      byDiv[d] ??= { n: 0, zero: 0, unscoreable: 0, scoredPositive: 0, meanR: 0 };
      byDiv[d].n += 1;
      byDiv[d].meanR += r.R;
      if (sig?.state === 'UNSCOREABLE') byDiv[d].unscoreable += 1;
      else if (sig?.value === 0) byDiv[d].zero += 1;
      else byDiv[d].scoredPositive += 1;
    }
    console.log('division      n   positional=0   unscoreable   scored>0   mean R');
    for (const [d, v] of Object.entries(byDiv).sort((a, b) => b[1].n - a[1].n)) {
      const pct = (x) => `${((x / v.n) * 100).toFixed(1)}%`;
      console.log(`${d.padEnd(12)} ${String(v.n).padStart(3)}   ${pct(v.zero).padStart(7)}      ${pct(v.unscoreable).padStart(7)}     ${pct(v.scoredPositive).padStart(7)}   ${fmt(v.meanR / v.n)}`);
    }
    const zeros = withPositional.filter((r) => r.rBasis.signals.find((x) => x.key === 'positionalOpportunity')?.value === 0);
    console.log('');
    console.log(`positional === 0 overall: ${zeros.length} of ${withPositional.length}`);
    console.log(`  of those, PARTIAL recruitability grade: ${zeros.filter((r) => r.Rgrade === 'PARTIAL').length}`);
    console.log(`  median rank of a zero: ${zeros.map((r) => r.rank).sort((a, b) => a - b)[Math.floor(zeros.length / 2)]}`);
    const doubtful = zeros.filter((r) => (r.rBasis?.positional?.starterEvidence?.departingUnknown ?? 0) > 0);
    console.log(`  zeros where part of the departing cohort could NOT be placed: ${doubtful.length}`);
    console.log(`    their median rank ${doubtful.map((r) => r.rank).sort((a, b) => a - b)[Math.floor(doubtful.length / 2)]}  mean R ${fmt(doubtful.reduce((s2, r) => s2 + r.R, 0) / (doubtful.length || 1))}`);
    const byDiv2 = {};
    for (const r of doubtful) { byDiv2[r.division] = (byDiv2[r.division] ?? 0) + 1; }
    console.log(`    by division ${JSON.stringify(byDiv2)}`);
    const clean = zeros.filter((r) => (r.rBasis?.positional?.starterEvidence?.departingUnknown ?? 0) === 0);
    console.log(`  zeros on a fully placed cohort: ${clean.length}  mean R ${fmt(clean.reduce((s2, r) => s2 + r.R, 0) / (clean.length || 1))}`);
  }

  if (args.includes('--opportunity')) {
    const sorted = [...ranked].sort((a, b) => b.O - a.O);
    console.log('highest Opportunity:');
    for (const r of sorted.slice(0, 15)) console.log(`  #${String(r.rank).padStart(3)} ${r.name.padEnd(30)} str ${fmt(r.strength, 1).padStart(5)}  O ${fmt(r.O)}  R ${fmt(r.R)}  P ${fmt(r.P)}  playing ${fmt(r.oPlaying)} outcome ${fmt(r.oOutcome)}`);
    console.log('lowest Opportunity in the top 100:');
    for (const r of ranked.filter((x) => x.rank <= 100).sort((a, b) => a.O - b.O).slice(0, 10)) console.log(`  #${String(r.rank).padStart(3)} ${r.name.padEnd(30)} str ${fmt(r.strength, 1).padStart(5)}  O ${fmt(r.O)}  R ${fmt(r.R)}  P ${fmt(r.P)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
