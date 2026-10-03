/**
 * A7.12.1: the full-universe version of the production-parity proof.
 *
 * The same athlete twice - once as the literal every earlier phase used, and
 * once as a row written through `Player.create`, stored in SQLite and read
 * back with `Player.get` - ranked over all 1,166 men's or 1,235 women's
 * programmes, and required to agree to the last decimal.
 *
 *   node server/scripts/v2PreferenceParity.js
 *   node server/scripts/v2PreferenceParity.js --null
 *
 * WHY A SCRIPT AS WELL AS A TEST. vitest hands every suite a `:memory:`
 * database on purpose, so a test can never read the working one - which
 * means the CI version of this runs over a seeded pool of 36 programmes.
 * That is the right trade for CI and the wrong one for the phase report, so
 * the real universe is measured here and the numbers are quoted once.
 *
 * It writes throwaway player rows and deletes them. It changes no scorer, no
 * constant, and no existing record.
 */
import db from '../db/client.js';
import { Player } from '../db/entities/player.js';
import { canonicalPosition } from '../../shared/positions.js';
import { normaliseAthlete } from '../../shared/matching/pool.js';
import { buildPoolContext } from '../lib/v2/poolContext.js';
import { runPursuit } from '../lib/v2/pursuitRun.js';
import { buildValidationAthlete, PROFILES } from '../../shared/matching/v2/index.js';
import { PREFERENCE_FIELD_NAMES } from '../../shared/matching/v2/athletePreferences.js';
import { FIXTURES } from './v2Fixtures.js';

const SEASON = '2026';
const N = (n, d = 4) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const pad = (s, n) => String(s).slice(0, n).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

const CTX = new Map();
const contextFor = (sport) => {
  if (!CTX.has(sport)) CTX.set(sport, buildPoolContext({ db, sport, season: SEASON }));
  return CTX.get(sport);
};

const created = [];
const cleanup = () => { for (const id of created) db.prepare('DELETE FROM players WHERE id = ?').run(id); };

function rank(athlete, sport) {
  const ctx = contextFor(sport);
  const rep = runPursuit({ athlete, sport, colleges: ctx.colleges, ctx });
  return {
    counts: rep.counts,
    rows: new Map(rep.pipeline.ranked.map((e) => [e.id, {
      name: e.name, rank: e.rank,
      R: e.recruitability.value, F: e.financial.value,
      O: e.opportunity.value, P: e.pursuitPriority.value,
    }])),
  };
}

const fixture = (key) => FIXTURES.find((x) => x.id.toUpperCase().startsWith(`${key}-`));

function harness(key, profileId) {
  const f = fixture(key);
  const v1Shape = normaliseAthlete({ ...f.player, preferred_divisions: '[]', preferred_conferences: '[]' });
  const { athlete } = buildValidationAthlete({
    record: f.player, v1Shape, position: canonicalPosition(f.player.position),
    label: f.id, profile: PROFILES[profileId],
  });
  return { athlete, sport: f.player.sport };
}

/**
 * The same athlete, written through the real entity and read back.
 *
 * `Player.create` is the boundary every route and every form eventually
 * reaches, and it is where the validator and the column both live. The
 * form-side sanitiser is covered by the vitest suite, which can resolve the
 * `@/` alias; Node cannot, and importing it here would only prove the alias.
 */
function persisted(key, profileId) {
  const f = fixture(key);
  const p = PROFILES[profileId];
  const row = Player.create({
    ...f.player,
    full_name: `A7.12.1 parity ${key} ${profileId}`,
    preferred_divisions: [], preferred_conferences: [],
    criterion_ranking: f.player.criterion_ranking ? JSON.parse(f.player.criterion_ranking) : [],
    competitive_level_priority: p.competitiveLevelPriority,
    playing_opportunity_priority: p.playingOpportunityPriority,
    academic_strength_priority: p.academicStrengthPriority,
  });
  created.push(row.id);
  const stored = Player.get(row.id);
  const { athlete } = buildValidationAthlete({
    record: stored,
    v1Shape: normaliseAthlete(stored),
    position: canonicalPosition(stored.position),
    label: stored.full_name,
  });
  return { stored, athlete, sport: stored.sport };
}

function compare(label, a, b) {
  const onlyA = [...a.rows.keys()].filter((id) => !b.rows.has(id)).length;
  const onlyB = [...b.rows.keys()].filter((id) => !a.rows.has(id)).length;
  const diffs = { R: 0, F: 0, O: 0, P: 0, rank: 0 };
  let worst = { field: null, delta: 0, name: null };
  for (const [id, x] of a.rows) {
    const y = b.rows.get(id);
    if (!y) continue;
    for (const field of ['R', 'F', 'O', 'P']) {
      const d = Math.abs(x[field] - y[field]);
      if (d > 1e-12) { diffs[field] += 1; if (d > worst.delta) worst = { field, delta: d, name: x.name }; }
    }
    if (x.rank !== y.rank) diffs.rank += 1;
  }
  const exact = onlyA === 0 && onlyB === 0 && Object.values(diffs).every((v) => v === 0);
  console.log(`  ${pad(label, 30)}ranked ${rpad(a.counts.ranked, 5)} vs ${rpad(b.counts.ranked, 5)}`
    + `  limited ${rpad(a.counts.limitedData, 4)} vs ${rpad(b.counts.limitedData, 4)}`
    + `  differing R ${diffs.R} F ${diffs.F} O ${diffs.O} P ${diffs.P} rank ${diffs.rank}`
    + `  ${exact ? '— EXACT' : `— WORST ${worst.field} ${N(worst.delta, 10)} at ${worst.name}`}`);
  return exact;
}

async function main() {
  const args = process.argv.slice(2);
  const nullOnly = args.includes('--null');
  let ok = true;

  if (!nullOnly) {
    console.log('== PERSISTED vs HARNESS, full universe ==\n');
    console.log('  literal fixture            -> buildValidationAthlete -> runPursuit');
    console.log('  Player.create -> Player.get -> buildValidationAthlete -> runPursuit\n');
    for (const [key, profileId] of [
      ['A', 'FULLY_DECLARED_LEVEL'], ['A', 'ACADEMIC_FIRST'],
      ['C', 'ACADEMIC_FIRST'], ['C', 'FULLY_DECLARED_PLAYING'],
      ['H', 'FULLY_DECLARED_LEVEL'],
    ]) {
      const h = harness(key, profileId);
      const p = persisted(key, profileId);
      const stored = PREFERENCE_FIELD_NAMES.map((c) => `${c.split('_')[0]} ${p.stored[c]}`).join(' · ');
      console.log(`  fixture ${key} / ${profileId}   stored: ${stored}`);
      ok = compare(`${key}/${profileId}`, rank(h.athlete, h.sport), rank(p.athlete, p.sport)) && ok;
    }
    console.log('');
  }

  console.log('== NULL REGRESSION: A-H, all three columns NULL ==\n');
  for (const f of FIXTURES) {
    const key = f.id[0];
    const h = harness(key, 'UNDECLARED');
    const p = persisted(key, 'UNDECLARED');
    const allNull = PREFERENCE_FIELD_NAMES.every((c) => p.stored[c] === null);
    ok = compare(`${f.id.slice(0, 28)}`, rank(h.athlete, h.sport), rank(p.athlete, p.sport)) && ok;
    if (!allNull) { console.log(`    ${f.id}: STORED VALUES ARE NOT NULL`); ok = false; }
  }

  console.log('');
  console.log(ok ? 'ALL COMPARISONS EXACT' : 'DIVERGENCE FOUND');
  cleanup();
  const left = db.prepare("SELECT COUNT(*) n FROM players WHERE full_name LIKE 'A7.12.1 parity%'").get().n;
  console.log(`throwaway rows deleted; ${left} left behind`);
  if (!ok) process.exit(1);
}

main().catch((e) => { cleanup(); console.error(e); process.exit(1); });
