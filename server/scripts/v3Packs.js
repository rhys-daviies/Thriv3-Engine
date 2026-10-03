/**
 * A7.13: generate the V3 outreach-review packs.
 *
 *   node server/scripts/v3Packs.js --athlete=A
 *   node server/scripts/v3Packs.js --athlete=A --out=docs/validation
 *
 * READ-ONLY against the model and the database. It runs the same pipeline
 * every phase since A7.5 has run and writes two files per athlete: the blind
 * markdown a human fills in, and the JSON that pins what they were shown.
 *
 * IT DOES NOT GENERATE VIEW B. See server/lib/v2/outreachPack.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import db from '../db/client.js';
import { buildPoolContext } from '../lib/v2/poolContext.js';
import { buildOutreachPack, sealedModelState } from '../lib/v2/outreachPack.js';
import { renderOutreachViewA } from '../../shared/matching/v2/validation/renderOutreach.js';
import { auditBlindPack } from '../lib/v2/blindAudit.js';
import { V3_ATHLETES, v3Athlete } from './v3Athletes.js';

const SEASON = '2026';
const COMMITS = {
  v2Commit: '711af51',
  preferenceCommit: '3056215',
  checkpointCommit: '2ded421',
};

function usage(code) {
  console.error('Usage: v3Packs.js --athlete=<A-F|all> [--out=<dir>] [--no-write]');
  console.error(`  athletes: ${V3_ATHLETES.map((a) => a.id).join(', ')}`);
  process.exit(code);
}

const arg = (k, d = null) => process.argv.slice(2).find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;

async function main() {
  const key = arg('athlete');
  if (!key) usage(2);
  const outDir = arg('out', 'docs/validation');
  const write = !process.argv.includes('--no-write');

  const chosen = key.toLowerCase() === 'all' ? V3_ATHLETES : [v3Athlete(key)].filter(Boolean);
  if (!chosen.length) usage(2);

  const generatedAt = new Date().toISOString();
  const ctxCache = new Map();

  for (const def of chosen) {
    const sport = def.player.sport;
    if (!ctxCache.has(sport)) ctxCache.set(sport, buildPoolContext({ db, sport, season: SEASON }));
    const ctx = ctxCache.get(sport);

    const { pack, run, sample } = buildOutreachPack({
      athlete: def, ctx, commits: COMMITS, rosterSeason: SEASON, generatedAt,
    });

    /**
     * THE PACK IS AUDITED BEFORE IT IS WRITTEN, not after. A leak found in a
     * file somebody has already opened is not a leak that has been prevented.
     */
    const markdown = renderOutreachViewA(pack);
    const audit = auditBlindPack({ pack, markdown, ctx, sample });

    console.log(`== ${def.id} — ${def.role} ==`);
    console.log(`   universe ${pack.universe.poolSize} · ranked ${pack.universe.ranked} · limited ${pack.universe.limitedData}`);
    console.log(`   sample ${pack.sample.size}  (top100 ${pack.sample.composition.inTop100}`
      + ` · outside ${pack.sample.composition.outsideTop100}`
      + ` · limited ${pack.sample.composition.limitedData}`
      + ` · divisions ${pack.sample.composition.distinctDivisions})`);
    console.log(`   strata: ${Object.entries(pack.sample.counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    console.log(`   digests: athlete ${pack.digests.athlete} · pool ${pack.digests.pool}`
      + ` · sample ${pack.digests.sample} · viewA ${pack.digests.viewA} · metrics ${pack.digests.metrics}`);
    console.log(`   audit: ${audit.checks.length} checks, ${audit.failures.length} failures`);
    for (const c of audit.checks) console.log(`     ${c.ok ? 'pass' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    if (!audit.ok) {
      console.error('   BLIND AUDIT FAILED — nothing written.');
      process.exitCode = 1;
      continue;
    }

    if (write) {
      fs.mkdirSync(outDir, { recursive: true });
      const md = path.join(outDir, `${def.id}.viewA.md`);
      const js = path.join(outDir, `${def.id}.pack.json`);
      const sealed = path.join(outDir, `${def.id}.sealed.json`);
      fs.writeFileSync(md, markdown);
      fs.writeFileSync(js, `${JSON.stringify(pack, null, 2)}\n`);
      fs.writeFileSync(sealed, `${JSON.stringify(sealedModelState({ pack, run, sample }), null, 2)}\n`);
      console.log(`   written: ${md}`);
      console.log(`            ${js}`);
      console.log(`            ${sealed}  (SEALED — do not open)`);
    }
    console.log('');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
