/**
 * A8.1 §F-I — PREFERENCE AUTHORITY, MEASURED AGAINST THE FROZEN PROFILES.
 *
 * Re-runs the same athletes under the eight frozen `PROFILES` and compares each
 * against UNDECLARED. READ-ONLY: it changes no weight and no gate, and a
 * profile is an INPUT the model already accepts, not a modification of it.
 *
 *   node server/scripts/a8Preference.js --profiles=PLAYING_FIRST,LEVEL_FIRST
 *
 * -- WHAT "THROUGH THE INTENDED MECHANISM ONLY" MEANS ----------------------
 *
 * A preference may change how much a component's EVIDENCE counts. It may not
 * change the evidence, and it may not reach a layer it has no authority over.
 * `opportunityRules.js` is explicit that only two of the six components answer
 * to the athlete: `athletic` belongs to Coach Recruitability and `academic` to
 * majorFit. So the test is not "did the ranking move" - it is whether
 * Recruitability and Financial moved at all, and whether the component the
 * preference names moved in the direction it names.
 */
import { buildBaseline, decodeBaseline } from './a8Baseline.js';

const CAPTURE = ['playingPathway', 'athleticOutcome', 'academicStrengthFit', 'majorFit'];

const group = (art) => {
  const m = new Map();
  const rows = decodeBaseline(art);
  rows.forEach((r, i) => {
    const raw = art.cells[i];
    r.cmp = raw.cmp ?? {};
    if (!m.has(r.fixtureId)) m.set(r.fixtureId, []);
    m.get(r.fixtureId).push(r);
  });
  return m;
};

const summ = (v) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const at = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, p50: at(0.5), p90: at(0.9), max: s[s.length - 1] };
};

export function comparePreference(baseRows, armRows) {
  const ma = new Map(baseRows.map((r) => [r.programmeId, r]));
  let unrelatedR = 0; let unrelatedF = 0; let oppChanged = 0; let rankChanged = 0;
  const disp = [];
  for (const b of armRows) {
    const a = ma.get(b.programmeId);
    if (!a) continue;
    if ((a.recruitability.value ?? null) !== (b.recruitability.value ?? null)
      || a.recruitability.state !== b.recruitability.state) unrelatedR += 1;
    if ((a.financial.value ?? null) !== (b.financial.value ?? null)
      || a.financial.state !== b.financial.state) unrelatedF += 1;
    if ((a.opportunity.value ?? null) !== (b.opportunity.value ?? null)) oppChanged += 1;
    if (a.rank !== b.rank) rankChanged += 1;
    if (a.rank && b.rank) disp.push(Math.abs(a.rank - b.rank));
  }
  const churn = {};
  for (const n of [25, 50, 100]) {
    const sa = new Set(baseRows.filter((r) => r.rank && r.rank <= n).map((r) => r.programmeId));
    const sb = new Set(armRows.filter((r) => r.rank && r.rank <= n).map((r) => r.programmeId));
    churn[`top${n}`] = [...sb].filter((x) => sa.has(x)).length;
  }
  return { unrelatedR, unrelatedF, oppChanged, rankChanged, displacement: summ(disp), churn };
}

/** Mean of a captured component over the cells where it scored. */
export function componentMean(rows, name) {
  const v = rows.map((r) => r.cmp?.[name]).filter((c) => c && c.s === 'SCOREABLE').map((c) => c.v);
  return v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(4)) : null;
}

/** Mean WEIGHT SHARE the component took - what a preference is supposed to move. */
export function componentShare(rows, name) {
  const v = rows.map((r) => r.cmp?.[name]).filter((c) => c && c.s === 'SCOREABLE' && typeof c.sh === 'number').map((c) => c.sh);
  return v.length ? Number((v.reduce((a, b) => a + b, 0) / v.length).toFixed(4)) : null;
}

async function main() {
  const list = (process.argv.slice(2).find((a) => a.startsWith('--profiles='))?.split('=')[1]
    ?? 'PLAYING_FIRST,LEVEL_FIRST,ACADEMIC_FIRST,BOTH_HIGH').split(',');
  const components = { '*': CAPTURE };
  const baseArt = await buildBaseline({ profileName: 'UNDECLARED', components });
  const base = group(baseArt);

  for (const profileName of list) {
    const art = await buildBaseline({ profileName, components });
    const arm = group(art);
    console.log(`\n########## ${profileName} vs UNDECLARED ##########`);
    const rows = [];
    for (const [id, armRows] of arm) {
      const c = comparePreference(base.get(id), armRows);
      const bRanked = base.get(id).filter((r) => r.rankingState === 'RANKED');
      const aRanked = armRows.filter((r) => r.rankingState === 'RANKED');
      rows.push({
        athlete: id.split('-')[0],
        'R moved': c.unrelatedR, 'F moved': c.unrelatedF,
        'O moved': c.oppChanged, 'ranks moved': c.rankChanged,
        'disp p50': c.displacement?.p50 ?? null, 'disp p90': c.displacement?.p90 ?? null,
        't25 kept': c.churn.top25, 't100 kept': c.churn.top100,
        'pathway share': `${componentShare(bRanked, 'playingPathway')}→${componentShare(aRanked, 'playingPathway')}`,
        'outcome share': `${componentShare(bRanked, 'athleticOutcome')}→${componentShare(aRanked, 'athleticOutcome')}`,
        'academic share': `${componentShare(bRanked, 'academicStrengthFit')}→${componentShare(aRanked, 'academicStrengthFit')}`,
      });
    }
    console.table(rows);
  }
}

if (process.argv[1] && process.argv[1].endsWith('a8Preference.js')) await main();
