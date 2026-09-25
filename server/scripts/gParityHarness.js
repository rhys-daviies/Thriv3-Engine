/**
 * A7.18: the parity harness for Candidate G.
 *
 * Captures every layer output for the four benchmark athletes over the whole
 * eligible universe, so a baseline taken BEFORE the change can be compared
 * rank-for-rank and value-for-value against the same run afterwards.
 *
 *   node server/scripts/gParityHarness.js --out=/tmp/baseline.json
 *
 * READ-ONLY against the database and the model.
 */
import fs from 'node:fs';
import db from '../db/client.js';
import { buildPoolContext } from '../lib/v2/poolContext.js';
import { normaliseAthlete } from '../../shared/matching/pool.js';
import { canonicalPosition } from '../../shared/positions.js';
import { buildValidationAthlete, isScoreable } from '../../shared/matching/v2/index.js';
import { runPursuit } from '../lib/v2/pursuitRun.js';
import { V3_ATHLETES } from './v3Athletes.js';
import { W3_ATHLETES } from './w3Athletes.js';

const SEASON = '2026';
const arg = (k, d = null) => process.argv.slice(2).find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;

/** The extra profile A7.16 used for the playing-opportunity sensitivity condition. */
const PLAYING_FIRST = {
  id: 'A-playingfirst',
  player: null, // filled below from V3-A
};

export function capture({ ctx, def }) {
  const p = def.player;
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
  const sig = (basis, key) => basis?.signals?.find((s) => s.key === key) ?? null;
  return {
    equivalentProgrammeScore: inputs.equivalentProgrammeScore,
    counts: { ...run.counts },
    ranked: run.pipeline.ranked.map((e) => {
      const rb = isScoreable(e.recruitability) ? e.recruitability.basis : null;
      const ob = isScoreable(e.opportunity) ? e.opportunity.basis : null;
      const pos = sig(rb, 'positionalOpportunity');
      const mkt = sig(rb, 'recruitingMarket');
      return {
        id: e.id,
        rank: e.rank,
        P: e.pursuitPriority.value,
        R: isScoreable(e.recruitability) ? e.recruitability.value : null,
        F: isScoreable(e.financial) ? e.financial.value : null,
        O: isScoreable(e.opportunity) ? e.opportunity.value : null,
        A: rb?.athleticPlausibility ?? null,
        delta: rb?.athleticDelta ?? null,
        support: rb?.support ?? null,
        positionalValue: pos?.value ?? null,
        positionalState: pos?.state ?? null,
        marketValue: mkt?.value ?? null,
        marketState: mkt?.state ?? null,
        gR: e.pursuitPriority.basis?.recruitabilityGate ?? null,
        gF: e.pursuitPriority.basis?.financialGate ?? null,
        base: e.pursuitPriority.basis?.base ?? null,
        opportunityComponents: ob ? Object.fromEntries(
          Object.entries(ob.components).map(([k, v]) => [k, v.value])) : null,
      };
    }),
    limited: run.pipeline.limited.map((e) => e.id).sort(),
  };
}

function main() {
  const out = arg('out');
  if (!out) { console.error('Usage: gParityHarness.js --out=<file>'); process.exit(2); }
  const ctxCache = new Map();
  const a = V3_ATHLETES.find((x) => x.id.startsWith('V3-A-'));
  PLAYING_FIRST.player = { ...a.player, competitive_level_priority: 1, playing_opportunity_priority: 5 };
  // A7.23: the women's set joins the parity surface, so a change has to
  // reproduce on both universes rather than on the one it was designed against.
  const defs = [...V3_ATHLETES, ...W3_ATHLETES, PLAYING_FIRST];
  const snap = {};
  for (const def of defs) {
    const sport = def.player.sport;
    if (!ctxCache.has(sport)) ctxCache.set(sport, buildPoolContext({ db, sport, season: SEASON }));
    snap[def.id] = capture({ ctx: ctxCache.get(sport), def });
    console.log(`${def.id}: ranked ${snap[def.id].counts.ranked} limited ${snap[def.id].counts.limitedData}`);
  }
  fs.writeFileSync(out, JSON.stringify(snap));
  console.log(`written ${out}`);
}
main();
