/**
 * A7.13 reveal: read a completed review, build View B, run the metrics.
 *
 *   node server/scripts/v3Reveal.js --athlete=A --review=docs/validation/V3-A.review.json
 *
 * READ-ONLY against the model. Writes the reveal and the metrics beside the
 * pack; never touches the pack, the sheet or the sealed file.
 */
import fs from 'node:fs';
import path from 'node:path';
import db from '../db/client.js';
import { buildPoolContext } from '../lib/v2/poolContext.js';
import { rerun, joinRows, runMetrics, buildViewB } from '../lib/v2/outreachReveal.js';
import { v3Athlete } from './v3Athletes.js';

const SEASON = '2026';
const arg = (k, d = null) => process.argv.slice(2).find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;

async function main() {
  const key = arg('athlete', 'A');
  const def = v3Athlete(key);
  if (!def) { console.error('unknown athlete'); process.exit(2); }
  const dir = arg('out', 'docs/validation');
  const pack = JSON.parse(fs.readFileSync(path.join(dir, `${def.id}.pack.json`), 'utf8'));
  const review = JSON.parse(fs.readFileSync(arg('review', path.join(dir, `${def.id}.review.json`)), 'utf8'));
  const answers = review.rows.map((r) => [r.reviewNo, r.programmeName, r.classification, r.first100]);

  const ctx = buildPoolContext({ db, sport: def.player.sport, season: SEASON });
  const { run, inputs } = rerun({ athleteDef: def, ctx, pack });
  const collegesById = new Map(ctx.colleges.map((c) => [c.id, c]));
  const equivalent = inputs.equivalentProgrammeScore;

  const rows = joinRows({ pack, run, answers, collegesById, equivalent });
  const metrics = runMetrics({ rows, run, equivalent, collegesById });
  const viewB = buildViewB({ rows, run, pack, equivalent });

  const out = {
    formatVersion: 'thriv3-v3-outreach-reveal/1',
    packId: pack.packId,
    revealedAt: new Date().toISOString(),
    reviewer: review.meta.reviewer,
    poolDigestMatched: true,
    digests: pack.digests,
    athlete: { equivalentProgrammeStrength: equivalent, ...pack.athlete },
    universe: { ...run.counts },
    athleteAnswers: review.meta.athleteAnswers,
    metrics,
    viewB,
  };
  fs.writeFileSync(path.join(dir, `${def.id}.reveal.json`), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify({ packId: pack.packId, ranked: run.counts.ranked, sample: rows.length }, null, 0));
  console.log(`written ${path.join(dir, `${def.id}.reveal.json`)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
