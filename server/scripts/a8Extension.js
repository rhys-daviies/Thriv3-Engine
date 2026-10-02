/**
 * A8.0B — THE COVERAGE EXTENSION, AND THE CONTROLLED COMPARISONS IN IT.
 *
 * A8.0 froze a baseline that could not assess `majorFit`, could not reach the
 * MEASURED side of the A7.37 horizon rule, and never exercised an unstated
 * family contribution. This builds the arms that close those three gaps.
 *
 *   node server/scripts/a8Extension.js --out=docs/validation/A8.0B-extension.json
 *
 * THE A8.0 BASELINE IS NOT TOUCHED. This writes a separate artifact, and the
 * two together are the complete input set for A8.1.
 *
 * -- WHAT A CONTROLLED ARM IS ----------------------------------------------
 *
 * Every arm is the SAME athlete with one patch applied. The arms are not
 * additional athletes and are not pinned in any regression baseline. Each one
 * declares the fields it is allowed to differ in, and `a8Extension.test.js`
 * fails if it differs in any other - so an arm cannot quietly become a second
 * person and have the difference read as an effect.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildBaseline, decodeBaseline } from './a8Baseline.js';
import { VALIDATION_FIXTURES } from './v2ValidationFixtures.js';
import {
  COVERAGE_FIXTURE, MAJOR_ARMS, FINANCIAL_PATCHES, ENTRY_YEARS, MAJOR_SELECTION,
} from './a8CoverageFixtures.js';

/**
 * What each arm family needs observed, and nothing else.
 *
 * MAJOR needs majorFit, because the layer total cannot distinguish a component
 * that scored 0 from one that was never applicable. ENTRY_YEAR needs the two
 * components the horizon rule can reach, so that a grade change can be shown
 * to be the horizon rather than the roster. FINANCIAL needs none: its whole
 * question is answered by the Financial layer cell, which every artifact
 * already carries.
 */
export const CAPTURED_COMPONENTS = Object.freeze({
  MAJOR: Object.freeze(['majorFit']),
  ENTRY_YEAR: Object.freeze(['playingPathway', 'programmeTrajectory']),
  FINANCIAL: Object.freeze([]),
});

/** The A8.0 athlete each counterfactual family is built on. */
const base = (id) => {
  const f = VALIDATION_FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`no validation fixture ${id}`);
  return f;
};

export function buildArms() {
  const arms = [];
  for (const a of MAJOR_ARMS) {
    arms.push({ id: a.id, family: 'MAJOR', against: a.against, differsBy: a.differsBy, why: a.why, player: a.player });
  }
  const fin = base('V-WMID-womens');
  for (const f of FINANCIAL_PATCHES) {
    arms.push({
      id: `V-WMID-${f.id}`, family: 'FINANCIAL',
      against: `V-WMID-${FINANCIAL_PATCHES[0].id}`,
      differsBy: ['budget_range', 'contribution_state', 'max_annual_contribution_usd'],
      why: f.why, player: { ...fin.player, ...f.patch },
    });
  }
  const ent = base('V-ELITE-mens');
  for (const y of ENTRY_YEARS) {
    arms.push({
      id: `V-ELITE-${y.id}`, family: 'ENTRY_YEAR',
      against: 'V-ELITE-Y-2028', differsBy: ['recruiting_class_year'],
      why: `Entry ${y.year}, depth ${y.depth}: ${y.expect}`,
      player: { ...ent.player, recruiting_class_year: y.year },
    });
  }
  return arms;
}

/** Percentile summary of a list of numbers. */
const summarise = (v) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  return { n: s.length, min: s[0], p25: at(25), median: at(50), p75: at(75), max: s[s.length - 1] };
};

const EPS = 1e-9;
const same = (a, b) => (a === null || a === undefined) && (b === null || b === undefined)
  ? true : (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < EPS : a === b);

/**
 * One arm against another, cell by cell.
 *
 * `unrelated` names the layers the patch has NO authority over. They are
 * reported as a count of differing cells rather than asserted here, because a
 * harness that threw would hide the size of a violation - and the size is the
 * finding.
 */
export function compareArms(cellsById, armId, againstId, { unrelated }) {
  const A = cellsById.get(againstId); const B = cellsById.get(armId);
  if (!A || !B) return null;
  const ma = new Map(A.map((c) => [c.programmeId, c]));
  const out = {
    arm: armId,
    against: againstId,
    cells: B.length,
    unrelatedChanged: Object.fromEntries(unrelated.map((u) => [u, 0])),
    opportunityChanged: 0,
    pursuitChanged: 0,
    stateChanged: 0,
    rankChanged: 0,
    rankDisplacement: null,
    topChurn: {},
    majorFitStates: {},
  };
  const disp = [];
  for (const b of B) {
    const a = ma.get(b.programmeId);
    if (!a) continue;
    for (const u of unrelated) {
      const la = a[u] ?? {}; const lb = b[u] ?? {};
      if (!same(la.value ?? null, lb.value ?? null) || la.state !== lb.state
        || (la.reason ?? null) !== (lb.reason ?? null) || !same(la.coverage ?? null, lb.coverage ?? null)) {
        out.unrelatedChanged[u] += 1;
      }
    }
    if (!same(a.opportunity.value ?? null, b.opportunity.value ?? null)) out.opportunityChanged += 1;
    if (!same(a.pursuit, b.pursuit)) out.pursuitChanged += 1;
    if (a.rankingState !== b.rankingState) out.stateChanged += 1;
    if (a.rank !== b.rank) out.rankChanged += 1;
    if (a.rank && b.rank) disp.push(Math.abs(a.rank - b.rank));
    const s = b.majorFit?.state ?? 'ABSENT';
    out.majorFitStates[s] = (out.majorFitStates[s] || 0) + 1;
  }
  out.rankDisplacement = summarise(disp);
  for (const n of [25, 50, 100]) {
    const sa = new Set(A.filter((c) => c.rank && c.rank <= n).map((c) => c.programmeId));
    const sb = new Set(B.filter((c) => c.rank && c.rank <= n).map((c) => c.programmeId));
    const kept = [...sb].filter((x) => sa.has(x)).length;
    out.topChurn[`top${n}`] = { shared: kept, entered: sb.size - kept, left: sa.size - kept };
  }
  return out;
}

/** The long-form cells, grouped by arm, with majorFit lifted alongside. */
export function groupCells(ext) {
  const rows = decodeBaseline(ext);
  const byArm = new Map();
  rows.forEach((r, i) => {
    const raw = ext.cells[i];
    r.majorFit = raw.cmp?.majorFit ? expand(raw.cmp.majorFit) : { state: 'ABSENT' };
    r.playingPathway = raw.cmp?.playingPathway ? expand(raw.cmp.playingPathway) : { state: 'ABSENT' };
    r.programmeTrajectory = raw.cmp?.programmeTrajectory ? expand(raw.cmp.programmeTrajectory) : { state: 'ABSENT' };
    if (!byArm.has(r.fixtureId)) byArm.set(r.fixtureId, []);
    byArm.get(r.fixtureId).push(r);
  });
  return byArm;
}

const COMPONENT_CODEC = { s: 'state', v: 'value', g: 'grade', w: 'weight', sh: 'share', r: 'reason' };
const expand = (c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [COMPONENT_CODEC[k] ?? k, v]));

export async function buildExtension() {
  const arms = buildArms();
  const fixtures = arms.map((a) => ({ id: a.id, player: a.player, frozen: false }));
  const components = Object.fromEntries(arms.map((a) => [a.id, CAPTURED_COMPONENTS[a.family]]));
  const ext = await buildBaseline({ fixtures, components });

  const byArm = groupCells(ext);
  const comparisons = [];
  comparisons.push(compareArms(byArm, 'X-null-major', 'X-declared-major',
    { unrelated: ['recruitability', 'financial'] }));
  for (const f of FINANCIAL_PATCHES.slice(1)) {
    comparisons.push(compareArms(byArm, `V-WMID-${f.id}`, `V-WMID-${FINANCIAL_PATCHES[0].id}`,
      { unrelated: ['recruitability', 'opportunity'] }));
  }
  for (const y of ENTRY_YEARS.filter((x) => x.year !== 2028)) {
    comparisons.push(compareArms(byArm, `V-ELITE-${y.id}`, 'V-ELITE-Y-2028',
      /** Recruitability legitimately reads entryYear, so only Financial is unrelated here. */
      { unrelated: ['financial'] }));
  }

  const body = {
    ...ext,
    extensionOf: 'docs/validation/A8.0-baseline.json',
    extensionOfDigest: '78db6413ead4baf82b6e86b49aebaf9cef8bd59befa8185fb7a5388f798a41f8',
    majorSelection: MAJOR_SELECTION,
    arms: arms.map(({ player, ...rest }) => rest),
    capturedComponents: CAPTURED_COMPONENTS,
    comparisons: comparisons.filter(Boolean),
  };
  return { ...body, cellDigest: crypto.createHash('sha256').update(JSON.stringify(ext.cells)).digest('hex') };
}

async function main() {
  const out = process.argv.slice(2).find((a) => a.startsWith('--out='))?.split('=')[1] ?? null;
  const ext = await buildExtension();
  console.log(`A8.0B extension  cells=${ext.cells.length}  arms=${ext.arms.length}`);
  console.log(`digest ${ext.cellDigest}`);
  for (const a of ext.athletes) {
    console.log(`  ${a.fixtureId.padEnd(26)} pool ${String(a.poolSize).padStart(4)}  RANKED ${String(a.counts.ranked).padStart(4)}  LIMITED ${String(a.counts.limitedData).padStart(4)}`);
  }
  console.log('');
  for (const c of ext.comparisons) {
    console.log(`${c.arm} vs ${c.against}`);
    console.log(`   unrelated changed: ${JSON.stringify(c.unrelatedChanged)}  opportunity ${c.opportunityChanged}  pursuit ${c.pursuitChanged}  ranks ${c.rankChanged}`);
    console.log(`   displacement ${JSON.stringify(c.rankDisplacement)}  churn ${JSON.stringify(c.topChurn)}`);
  }
  if (out) {
    const file = path.resolve(out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(ext)}\n`);
    console.log(`\nwrote ${file}`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('a8Extension.js')) await main();
