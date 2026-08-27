#!/usr/bin/env node
/**
 * When a starter leaves, who gets the minutes?
 *
 * One observation per (programme, position, season transition). Read-only.
 * The write-up of what this found is in ROADMAP.md under Phase 4.1.
 *
 *   node server/scripts/vacancyResearch.js
 *   node server/scripts/vacancyResearch.js --json
 */
import db from '../db/client.js';
import { isTrueFreshman, minutesAreMissing, freshmanProfile, classifyProgramme } from '../../shared/freshmanMinutes.js';
import { canonicalPosition } from '../../shared/positions.js';
import { tenureFor } from '../../shared/coachTenure.js';
const STARTER = 600;
const TRANSITIONS = [['2022', '2023'], ['2023', '2024'], ['2024', '2025']];
const POSITIONS = ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'];
// A position group has to carry a real season's load before its shares mean
// anything: 1,500 minutes is roughly one player's season and a bit.
const MIN_POSITION_MINUTES = 1500;

// Normalised for the season join. The raw name join reports 25% of
// underclassmen "leaving", which is above real attrition — punctuation,
// accents and middle initials differ between one season's page and the next,
// and each difference invents a departure.
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

const rows = db.prepare(`SELECT college_name c, sport sp, season s, player_name n, position p,
  minutes_played m, games_played g, class_year_label k
  FROM roster_players WHERE season IN ('2022','2023','2024','2025')`).all()
  .map((r) => ({ ...r, s: String(r.s), pos: canonicalPosition(r.p), nk: norm(r.n),
    min: Number(r.m) || 0,
    // isTrueFreshman and minutesAreMissing read the column names, not mine.
    fresh: isTrueFreshman({ class_year_label: r.k, season: String(r.s) }),
    missing: minutesAreMissing({ minutes_played: r.m, games_played: r.g }) }));

const byProgSeason = new Map();
for (const r of rows) {
  const k = `${r.c}||${r.sp}||${r.s}`;
  if (!byProgSeason.has(k)) byProgSeason.set(k, []);
  byProgSeason.get(k).push(r);
}

const coaches = new Map();
for (const r of db.prepare('SELECT school, sport, season, coach_name FROM coach_seasons').all()) {
  if (r.coach_name) coaches.set(`${r.school}||${r.sport}||${r.season}`, r.coach_name);
}
const colleges = new Map();
for (const c of db.prepare('SELECT name, sport, division FROM colleges WHERE active = 1').all()) {
  colleges.set(`${c.name}||${c.sport}`, c.division);
}

// ---- build the observation table ----
const obs = [];
const progKeys = new Set(rows.map((r) => `${r.c}||${r.sp}`));
for (const pk of progKeys) {
  const [school, sport] = pk.split('||');
  for (const [a, b] of TRANSITIONS) {
    const prev = byProgSeason.get(`${pk}||${a}`);
    const next = byProgSeason.get(`${pk}||${b}`);
    if (!prev || !next) continue;
    // Two different sets, and using one for both jobs is how "returning" came
    // back as 100%: `returned` answers "did last season's player come back",
    // `wasHere` answers "was this season's player here before".
    const returned = new Set(next.map((r) => r.nk));
    const wasHere = new Set(prev.map((r) => r.nk));

    for (const pos of POSITIONS) {
      const prevP = prev.filter((r) => r.pos === pos && !r.missing);
      const nextP = next.filter((r) => r.pos === pos && !r.missing);
      const prevLoad = prevP.reduce((s, r) => s + r.min, 0);
      const nextLoad = nextP.reduce((s, r) => s + r.min, 0);
      if (prevLoad < MIN_POSITION_MINUTES || nextLoad < MIN_POSITION_MINUTES) continue;

      const left = prevP.filter((r) => !returned.has(r.nk));
      const leftStarters = left.filter((r) => r.min >= STARTER);
      const vacated = left.reduce((s, r) => s + r.min, 0);
      const vacatedStarter = leftStarters.reduce((s, r) => s + r.min, 0);

      const fresh = nextP.filter((r) => r.fresh);
      const freshMin = fresh.reduce((s, r) => s + r.min, 0);
      const freshStarters = fresh.filter((r) => r.min >= STARTER).length;
      const bestFresh = fresh.length ? Math.max(...fresh.map((r) => r.min)) : 0;

      // Where did next season's minutes at this position come from?
      //   returning  — on last season's roster
      //   freshman   — new, and labelled a first-year
      //   newcomer   — new, and NOT a first-year: a transfer, a JUCO arrival,
      //                or an older recruit. This is the third option the
      //                freshman-versus-promotion framing leaves out, and at a
      //                position that empties completely it is the answer.
      const returningMin = nextP.filter((r) => wasHere.has(r.nk)).reduce((s, r) => s + r.min, 0);
      const newcomerMin = nextP.filter((r) => !wasHere.has(r.nk) && !r.fresh).reduce((s, r) => s + r.min, 0);
      const newcomerStarters = nextP.filter((r) => !wasHere.has(r.nk) && !r.fresh && r.min >= STARTER).length;

      obs.push({
        school, sport, division: colleges.get(pk) ?? null, pos, from: a, to: b,
        coach: coaches.get(`${school}||${sport}||${b}`) ?? null,
        coachPrev: coaches.get(`${school}||${sport}||${a}`) ?? null,
        prevLoad, nextLoad,
        departed: left.length, departedStarters: leftStarters.length,
        vacated, vacatedStarter,
        vacatedShare: vacated / prevLoad,
        vacatedStarterShare: vacatedStarter / prevLoad,
        freshCount: fresh.length, freshMin, freshStarters, bestFresh,
        freshShare: freshMin / nextLoad,
        returningMin, newcomerMin, newcomerStarters,
        returningShare: returningMin / nextLoad,
        newcomerShare: newcomerMin / nextLoad,
        // Whether this squad's class labels can be read at all. Bates,
        // Hamilton and Elmira print a graduation year or nothing where the
        // class belongs, so every player reads as "not a freshman" and the
        // programme reads as one that never plays them. Six of the ten
        // lowest-scoring coaches in the first run were this defect.
        squadFreshmenReadable: next.some((r) => r.fresh),
      });
    }
  }
}

// ---- statistics ----
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
function pearson(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b; dx += a * a; dy += b * b;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}
const pct = (n, d) => (d ? Math.round(1000 * n / d) / 10 : null);

const unreadable = obs.filter((o) => !o.squadFreshmenReadable);
const readable = obs.filter((o) => o.squadFreshmenReadable);
const out = { n: obs.length, readable: readable.length, dropped: unreadable.length,
  droppedProgrammes: new Set(unreadable.map((o) => `${o.school}||${o.sport}`)).size };

// Everything below reads only the observations whose class labels can be
// read at all — see squadFreshmenReadable.
const _o = readable;
out.correlation = {
  vacatedShare_vs_freshShare: Number(pearson(_o.map((o) => o.vacatedShare), _o.map((o) => o.freshShare)).toFixed(3)),
  vacatedStarterShare_vs_freshShare: Number(pearson(_o.map((o) => o.vacatedStarterShare), _o.map((o) => o.freshShare)).toFixed(3)),
  departedStarters_vs_freshStarters: Number(pearson(_o.map((o) => o.departedStarters), _o.map((o) => o.freshStarters)).toFixed(3)),
  vacatedStarterShare_vs_bestFresh: Number(pearson(_o.map((o) => o.vacatedStarterShare), _o.map((o) => o.bestFresh)).toFixed(3)),
};

// binned: how much of the position's load walked out, against what freshmen got
const BINS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 1.01];
out.bins = [];
for (let i = 0; i < BINS.length - 1; i += 1) {
  const sub = _o.filter((o) => o.vacatedStarterShare >= BINS[i] && o.vacatedStarterShare < BINS[i + 1]);
  if (!sub.length) continue;
  out.bins.push({
    band: `${Math.round(BINS[i] * 100)}–${Math.round(BINS[i + 1] * 100)}%`,
    n: sub.length,
    meanFreshShare: Math.round(1000 * mean(sub.map((o) => o.freshShare))) / 10,
    pctWithAFreshStarter: pct(sub.filter((o) => o.freshStarters > 0).length, sub.length),
    medianBestFresh: [...sub.map((o) => o.bestFresh)].sort((a, b) => a - b)[Math.floor(sub.length / 2)],
  });
}

// the recruit's question, stated plainly
const withStarterGone = _o.filter((o) => o.departedStarters > 0);
const withoutStarterGone = _o.filter((o) => o.departedStarters === 0);
out.plainQuestion = {
  starterDeparted: { n: withStarterGone.length,
    pctWithAFreshStarter: pct(withStarterGone.filter((o) => o.freshStarters > 0).length, withStarterGone.length),
    meanFreshShare: Math.round(1000 * mean(withStarterGone.map((o) => o.freshShare))) / 10 },
  noStarterDeparted: { n: withoutStarterGone.length,
    pctWithAFreshStarter: pct(withoutStarterGone.filter((o) => o.freshStarters > 0).length, withoutStarterGone.length),
    meanFreshShare: Math.round(1000 * mean(withoutStarterGone.map((o) => o.freshShare))) / 10 },
};

// two or more starters gone
const two = _o.filter((o) => o.departedStarters >= 2);
out.plainQuestion.twoOrMoreDeparted = { n: two.length,
  pctWithAFreshStarter: pct(two.filter((o) => o.freshStarters > 0).length, two.length),
  meanFreshShare: Math.round(1000 * mean(two.map((o) => o.freshShare))) / 10 };

// by position
out.byPosition = POSITIONS.map((pos) => {
  const sub = _o.filter((o) => o.pos === pos);
  const gone = sub.filter((o) => o.departedStarters > 0);
  const stay = sub.filter((o) => o.departedStarters === 0);
  return { pos, n: sub.length,
    r: Number(pearson(sub.map((o) => o.vacatedStarterShare), sub.map((o) => o.freshShare)).toFixed(3)),
    pctFreshStarter_gone: pct(gone.filter((o) => o.freshStarters > 0).length, gone.length),
    pctFreshStarter_stay: pct(stay.filter((o) => o.freshStarters > 0).length, stay.length) };
});

// by division
out.byDivision = ['NCAA D1', 'NCAA D2', 'NCAA D3'].map((d) => {
  const sub = _o.filter((o) => o.division === d);
  const gone = sub.filter((o) => o.departedStarters > 0);
  const stay = sub.filter((o) => o.departedStarters === 0);
  return { division: d, n: sub.length,
    r: Number(pearson(sub.map((o) => o.vacatedStarterShare), sub.map((o) => o.freshShare)).toFixed(3)),
    pctFreshStarter_gone: pct(gone.filter((o) => o.freshStarters > 0).length, gone.length),
    pctFreshStarter_stay: pct(stay.filter((o) => o.freshStarters > 0).length, stay.length) };
});

out.fillMix = out.bins.map((b) => b);   // placeholder, replaced below

// Where the vacated minutes actually went, by how much of the position left.
out.mix = [];
for (let i = 0; i < BINS.length - 1; i += 1) {
  const sub = _o.filter((o) => o.vacatedStarterShare >= BINS[i] && o.vacatedStarterShare < BINS[i + 1]);
  if (!sub.length) continue;
  out.mix.push({
    band: `${Math.round(BINS[i] * 100)}\u2013${Math.round(BINS[i + 1] * 100)}%`,
    n: sub.length,
    returning: Math.round(1000 * mean(sub.map((o) => o.returningShare))) / 10,
    freshman: Math.round(1000 * mean(sub.map((o) => o.freshShare))) / 10,
    newcomer: Math.round(1000 * mean(sub.map((o) => o.newcomerShare))) / 10,
  });
}
delete out.fillMix;

// ---- the coach question ----
// Of the minutes that walked out, what share came back as freshman minutes?
// Capped at 1: a coach who gave freshmen more than the vacancy is still just
// "fills with freshmen", and uncapped it would let one blowout set a mean.
const byCoach = new Map();
for (const o of _o) {
  if (!o.coach || o.vacated < 400) continue;
  const k = `${o.coach}||${o.school}||${o.sport}`;
  if (!byCoach.has(k)) byCoach.set(k, []);
  byCoach.get(k).push({ ...o, fill: Math.min(1, o.freshMin / o.vacated) });
}
const coachRows = [...byCoach.entries()]
  .map(([k, list]) => {
    const [coach, school, sport] = k.split('||');
    return { coach, school, sport, n: list.length, fill: mean(list.map((x) => x.fill)),
      list };
  })
  .filter((c) => c.n >= 4);
out.coach = { coachesWithFourPlus: coachRows.length };
out.coach.meanFill = Math.round(1000 * mean(coachRows.map((c) => c.fill))) / 10;

// Is fill a coach trait or noise? Split each coach's observations odd/even and
// correlate the halves. A trait replicates; noise does not.
const split = coachRows.filter((c) => c.n >= 6).map((c) => {
  const odd = c.list.filter((_, i) => i % 2), even = c.list.filter((_, i) => !(i % 2));
  return { a: mean(odd.map((x) => x.fill)), b: mean(even.map((x) => x.fill)) };
});
out.coach.splitHalf = { n: split.length,
  r: Number(pearson(split.map((s) => s.a), split.map((s) => s.b)).toFixed(3)) };

// A null: shuffle which position's vacancy is paired with which position's
// freshmen, inside the same programme-transition. If the real correlation is
// about position at all, it should beat this.
const byProgTrans = new Map();
for (const o of _o) {
  const k = `${o.school}||${o.sport}||${o.to}`;
  if (!byProgTrans.has(k)) byProgTrans.set(k, []);
  byProgTrans.get(k).push(o);
}
const nx = [], ny = [];
for (const list of byProgTrans.values()) {
  if (list.length < 2) continue;
  const rotated = list.map((_, i) => list[(i + 1) % list.length]);
  for (let i = 0; i < list.length; i += 1) { nx.push(list[i].vacatedStarterShare); ny.push(rotated[i].freshShare); }
}
out.nullModel = { n: nx.length, r: Number(pearson(nx, ny).toFixed(3)) };

// ---- is any of this a coach trait, or is it noise? ----
//
// Split-half on three different tendencies. A trait replicates against itself;
// noise does not, and reporting a coach's number without knowing which would
// be the whole error.
function splitHalf(list, pick) {
  const pairs = list.filter((c) => c.n >= 6).map((c) => {
    const odd = c.list.filter((_, i) => i % 2), even = c.list.filter((_, i) => !(i % 2));
    return { a: mean(odd.map(pick)), b: mean(even.map(pick)) };
  });
  const r = pearson(pairs.map((x) => x.a), pairs.map((x) => x.b));
  return { n: pairs.length, r: Number(r.toFixed(3)),
    // Spearman-Brown: what the reliability of the FULL record is, given that
    // each half is only half as long.
    full: Number((2 * r / (1 + r)).toFixed(3)) };
}

// The stricter test: split by TIME, not by index.
//
// An odd/even split alternates position inside the same season, so both halves
// share every coach-season shock -- a bad year, an injury crisis, one big
// intake -- and the halves agree partly because they are the same seasons.
// Splitting the first transition against the last asks the question the claim
// actually makes: does this coach do the same thing two years later?
function splitByTime(list, pick) {
  const pairs = [];
  for (const c of list) {
    const early = c.list.filter((x) => x.to === '2023');
    const late = c.list.filter((x) => x.to === '2025');
    if (early.length < 2 || late.length < 2) continue;
    pairs.push({ a: mean(early.map(pick)), b: mean(late.map(pick)) });
  }
  const r = pearson(pairs.map((x) => x.a), pairs.map((x) => x.b));
  return { n: pairs.length, r: Number(r.toFixed(3)) };
}

out.traits = {
  freshmanFill: splitHalf(coachRows, (x) => x.fill),
  freshmanShare: splitHalf(coachRows, (x) => x.freshShare),
  newcomerShare: splitHalf(coachRows, (x) => x.newcomerShare),
  returningShare: splitHalf(coachRows, (x) => x.returningShare),
};
out.traitsOverTime = {
  freshmanShare: splitByTime(coachRows, (x) => x.freshShare),
  newcomerShare: splitByTime(coachRows, (x) => x.newcomerShare),
  returningShare: splitByTime(coachRows, (x) => x.returningShare),
};

// Do coaches trade freshmen off against transfers, or are they separate dials?
const withBoth = coachRows.filter((c) => c.n >= 6);
out.traits.freshVsNewcomer = Number(pearson(
  withBoth.map((c) => mean(c.list.map((x) => x.freshShare))),
  withBoth.map((c) => mean(c.list.map((x) => x.newcomerShare)))).toFixed(3));

// The spread across coaches, so "weakly reliable" can be read against how much
// there is to be reliable about.
const fills = coachRows.map((c) => c.fill).sort((a, b) => a - b);
out.traits.fillSpread = {
  p10: Math.round(100 * fills[Math.floor(fills.length * 0.1)]),
  median: Math.round(100 * fills[Math.floor(fills.length * 0.5)]),
  p90: Math.round(100 * fills[Math.floor(fills.length * 0.9)]),
};

// extremes, for the write-up
coachRows.sort((a, b) => b.fill - a.fill);
out.coach.top = coachRows.slice(0, 10).map((c) => ({ coach: c.coach, school: c.school, sport: c.sport, n: c.n, fill: Math.round(100 * c.fill) }));
out.coach.bottom = coachRows.slice(-10).reverse().map((c) => ({ coach: c.coach, school: c.school, sport: c.sport, n: c.n, fill: Math.round(100 * c.fill) }));

// ---- does OUR OWN classification pick out the programmes that persist? ----
//
// If freshman usage barely repeats year to year in general (r = 0.10 across
// two years), the label that matters is the one that separates the programmes
// where it does. `steady` is that claim, so it has to be tested against the
// same measurement rather than asserted.
const SEASONS = ['2022', '2023', '2024', '2025'];
const rosterByProg = new Map();
for (const r of rows) {
  const k = `${r.c}||${r.sp}`;
  if (!rosterByProg.has(k)) rosterByProg.set(k, []);
  rosterByProg.get(k).push({ college_name: r.c, sport: r.sp, season: r.s, player_name: r.n,
    position: r.p, minutes_played: r.m, games_played: r.g, class_year_label: r.k });
}
const coachRowsFor = new Map();
for (const r of db.prepare('SELECT school, sport, season, coach_name, reason FROM coach_seasons').all()) {
  const k = `${r.school}||${r.sport}`;
  if (!coachRowsFor.has(k)) coachRowsFor.set(k, []);
  coachRowsFor.get(k).push({ season: r.season, coach_name: r.coach_name || '', reason: r.reason || '' });
}
const verdictOf = new Map();
for (const [k, rs] of rosterByProg) {
  const prof = freshmanProfile(rs, { seasons: SEASONS });
  if (!prof) continue;
  const v = classifyProgramme(prof, tenureFor(coachRowsFor.get(k) || []));
  if (v) verdictOf.set(k, v.verdict);
}

function timeR(filter) {
  const pairs = [];
  const byProg = new Map();
  for (const o of _o.filter(filter)) {
    const k = `${o.school}||${o.sport}`;
    if (!byProg.has(k)) byProg.set(k, []);
    byProg.get(k).push(o);
  }
  for (const list of byProg.values()) {
    const early = list.filter((x) => x.to === '2023');
    const late = list.filter((x) => x.to === '2025');
    if (early.length < 2 || late.length < 2) continue;
    pairs.push({ a: mean(early.map((x) => x.freshShare)), b: mean(late.map((x) => x.freshShare)) });
  }
  return { n: pairs.length, r: Number(pearson(pairs.map((x) => x.a), pairs.map((x) => x.b)).toFixed(3)) };
}
const STEADY = new Set(['steady', 'structural-through-changes', 'continuity-through-change']);
out.doesTheLabelWork = {
  steadyish: timeR((o) => STEADY.has(verdictOf.get(`${o.school}||${o.sport}`))),
  erraticOrShifted: timeR((o) => ['erratic-same-coach', 'policy-shift-same-coach', 'regime-change']
    .includes(verdictOf.get(`${o.school}||${o.sport}`))),
  everything: timeR(() => true),
};

// ---- the two dials, per coach, and Ryan's list read through them ----
const dial = coachRows.map((c) => ({
  coach: c.coach, school: c.school, sport: c.sport, n: c.n,
  fresh: Math.round(1000 * mean(c.list.map((x) => x.freshShare))) / 10,
  newcomer: Math.round(1000 * mean(c.list.map((x) => x.newcomerShare))) / 10,
  returning: Math.round(1000 * mean(c.list.map((x) => x.returningShare))) / 10,
}));
out.dials = {
  portalHeavy: [...dial].sort((a, b) => b.newcomer - a.newcomer).slice(0, 8),
  freshmanHeavy: [...dial].sort((a, b) => b.fresh - a.fresh).slice(0, 8),
  continuity: [...dial].sort((a, b) => b.returning - a.returning).slice(0, 8),
};

const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
const RYAN = ['Babson', 'Bentley', 'Biola', 'Bradley', 'Butler', 'Caltech', 'Calvin', 'DePauw',
  'Duquesne', 'Florida Southern', 'Gustavus Adolphus', 'Lake Forest', 'Point Loma Nazarene',
  'Salve Regina', 'Springfield', 'Stonehill', 'Trinity (TX)', 'Vermont', 'Wheaton (MA)'];
out.ryan = RYAN.map((school) => {
  const mine = _o.filter((o) => o.school === school && o.sport === 'mens-soccer');
  const def = mine.filter((o) => o.pos === 'DEFENSE');
  const defGone = def.reduce((s, o) => s + o.departedStarters, 0);
  // Programme-level, NOT the first coach row that happened to match the
  // school: several of these changed coach inside the window, and picking one
  // arbitrarily put Tim Dean's name on Dan Andrews' record.
  const coach2026 = coaches.get(`${school}||mens-soccer||2026`) ?? null;
  const underCurrent = coach2026
    ? mine.filter((o) => o.coach && sameName(o.coach, coach2026)).length : 0;
  return {
    school, n: mine.length,
    coach2026,
    observationsUnderThatCoach: underCurrent,
    coachesInWindow: [...new Set(mine.map((o) => o.coach).filter(Boolean))],
    fresh: mine.length ? Math.round(1000 * mean(mine.map((o) => o.freshShare))) / 10 : null,
    newcomer: mine.length ? Math.round(1000 * mean(mine.map((o) => o.newcomerShare))) / 10 : null,
    returning: mine.length ? Math.round(1000 * mean(mine.map((o) => o.returningShare))) / 10 : null,
    // The defender-specific history: how often a starting defender left, and
    // how often a freshman defender then started.
    defTransitions: def.length,
    defStartersDeparted: defGone,
    defFreshStarterAfter: def.filter((o) => o.departedStarters > 0 && o.freshStarters > 0).length,
    defNewcomerStarterAfter: def.filter((o) => o.departedStarters > 0 && o.newcomerStarters > 0).length,
    defFreshShare: def.length ? Math.round(1000 * mean(def.map((o) => o.freshShare))) / 10 : null,
    defNewcomerShare: def.length ? Math.round(1000 * mean(def.map((o) => o.newcomerShare))) / 10 : null,
  };
}).sort((a, b) => (b.defFreshShare ?? -1) - (a.defFreshShare ?? -1));

const argv = process.argv.slice(2);
if (argv.includes('--json')) {
  console.log(JSON.stringify(out, null, 1));
} else {
  report();
}

function report() {
  const pctf = (v) => `${String(v).padStart(5)}%`;
  console.log(`\n${out.n} observations, ${out.readable} readable`
    + ` (${out.dropped} dropped across ${out.droppedProgrammes} programmes whose class labels cannot be read)\n`);

  console.log('does a departing starter mean a freshman starts there?');
  for (const [k, v] of Object.entries(out.plainQuestion)) {
    console.log(`  ${k.padEnd(20)} n=${String(v.n).padStart(6)}  freshman starter ${pctf(v.pctWithAFreshStarter)}  freshman share ${pctf(v.meanFreshShare)}`);
  }
  console.log(`\n  correlation ${out.correlation.vacatedStarterShare_vs_freshShare}`
    + `  against a shuffled null of ${out.nullModel.r}`);

  console.log('\nwhere next season\'s minutes at the position came from');
  console.log(`  ${'vacated by'.padEnd(11)} ${'n'.padStart(6)}  returning  freshman  newcomer`);
  for (const m of out.mix) {
    console.log(`  ${m.band.padEnd(11)} ${String(m.n).padStart(6)}  ${pctf(m.returning)}    ${pctf(m.freshman)}   ${pctf(m.newcomer)}`);
  }

  console.log('\nis it a coach trait? (their first transition against their last, two years apart)');
  for (const [k, v] of Object.entries(out.traitsOverTime)) {
    console.log(`  ${k.padEnd(16)} n=${String(v.n).padStart(5)}  r=${v.r}`);
  }
  console.log(`  freshman share vs newcomer share, across coaches: r=${out.traits.freshVsNewcomer}`);

  console.log('\ndoes our own classification pick out the programmes that persist?');
  for (const [k, v] of Object.entries(out.doesTheLabelWork)) {
    console.log(`  ${k.padEnd(18)} n=${String(v.n).padStart(5)}  r=${v.r}`);
  }
  console.log();
}
