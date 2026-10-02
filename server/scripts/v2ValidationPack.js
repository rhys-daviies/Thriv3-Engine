/**
 * Generate the human-review packs for V2.
 *
 * READ-ONLY against the model and the database. It runs the pipeline, writes
 * markdown and JSON, and changes nothing. V1 continues to serve every
 * recommendation.
 *
 *   node server/scripts/v2ValidationPack.js --first-set
 *   node server/scripts/v2ValidationPack.js --fixture=C --profile=UNDECLARED
 *   node server/scripts/v2ValidationPack.js --first-set --out=docs/validation
 *
 * The markdown is what a person fills in. The JSON beside it is canonical and
 * is what a later model version is compared against.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { FIXTURES } from './v2Fixtures.js';
import { VALIDATION_FIXTURES, FIRST_PACK_SET, PACK_SET_V2, ARCHETYPE_COVERAGE, PROFILES } from './v2ValidationFixtures.js';

const SEASON = '2026';
const DEFAULT_OUT = 'docs/validation';

/**
 * The freeze point recorded in docs/v1-freeze.md. Named, not inferred.
 *
 * MOVED ONCE, at A7.48B, from `480a915` to `711af51` - the input-compatibility
 * repair that let V1 keep reading a budget after the form stopped writing
 * bands. The audit is in the freeze record: no V1 formula, constant, threshold
 * or criterion changed, all fourteen bands resolve identically under either
 * representation, and the eight reference athletes rank identically across the
 * full universe. Packs generated before the move name `480a915` and are right
 * to; that is the baseline they were measured against.
 */
const V1_FREEZE_COMMIT = '711af51da9b16e4037ef990a6c1175a3cb70a2f8';

function usage(code) {
  console.error('Usage: v2ValidationPack.js (--first-set | --v2-set | --fixture=<A-H|V-ELITE|V-WMID> | --athlete=<file.json>) [--profile=<UNDECLARED|LEVEL_FIRST|PLAYING_FIRST|BOTH_HIGH|BALANCED>] [--out=dir] [--quiet]');
  console.error('  --athlete  a real Thriv3 athlete in the player shape. Nothing about them is committed.');
  process.exit(code);
}

const git = (...args) => {
  try { return execFileSync('git', args, { encoding: 'utf8' }).trim(); } catch { return 'UNKNOWN'; }
};

const isAncestor = (a, b) => {
  try { execFileSync('git', ['merge-base', '--is-ancestor', a, b], { stdio: 'ignore' }); return true; } catch { return false; }
};

function findFixture(key) {
  const k = key.toUpperCase();
  return [...FIXTURES, ...VALIDATION_FIXTURES]
    .find((f) => f.id.toUpperCase() === k || f.id.toUpperCase().startsWith(`${k}-`));
}

/**
 * A real athlete, supplied as a file rather than imported.
 *
 * A7.7 §5 asks that the harness be able to run actual Thriv3 athletes without
 * importing client data into this environment. A file path does that: the
 * operator exports one record in the player shape, runs it, and nothing about
 * that athlete is committed. The required fields are REQUIRED_INPUTS in
 * shared/matching/v2/validation/athleteInput.js and the pack reports whatever
 * was absent rather than filling it in.
 */
function loadAthleteFile(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const player = raw.player ?? raw;
  return {
    id: raw.id ?? path.basename(file, '.json'),
    why: raw.why ?? 'A real Thriv3 athlete, supplied from a file. Not committed to this repository.',
    validationOnly: true,
    recruitType: raw.recruitType ?? null,
    player,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const firstSet = args.includes('--first-set');
  const v2Set = args.includes('--v2-set');
  const quiet = args.includes('--quiet');
  const out = args.find((a) => a.startsWith('--out='))?.split('=')[1] ?? DEFAULT_OUT;
  const one = args.find((a) => a.startsWith('--fixture='))?.split('=')[1];
  const athleteFile = args.find((a) => a.startsWith('--athlete='))?.split('=')[1];
  const profileArg = args.find((a) => a.startsWith('--profile='))?.split('=')[1]?.toUpperCase() ?? 'UNDECLARED';
  if ([firstSet, v2Set, Boolean(one), Boolean(athleteFile)].filter(Boolean).length !== 1) usage(2);

  const fromFile = athleteFile ? loadAthleteFile(athleteFile) : null;
  const wanted = v2Set ? PACK_SET_V2 : firstSet
    ? FIRST_PACK_SET
    : [{ fixture: fromFile ? fromFile.id : one, profile: profileArg, why: fromFile ? 'real athlete' : 'ad hoc' }];
  for (const w of wanted) {
    if (!fromFile && !findFixture(w.fixture)) { console.error(`No fixture ${w.fixture}`); usage(2); }
    if (!PROFILES[w.profile]) { console.error(`No profile ${w.profile}`); usage(2); }
  }

  const { default: db } = await import('../db/client.js');
  const { buildPoolContext } = await import('../lib/v2/poolContext.js');
  const { buildRosterIndex } = await import('../../shared/matching/pool.js');
  const { buildValidationPack } = await import('../lib/v2/validationRun.js');
  const { renderPack } = await import('../../shared/matching/v2/index.js');

  const commits = {
    v2Commit: git('rev-parse', 'HEAD'),
    explanationCommit: git('log', '-1', '--format=%H', '--', 'shared/matching/v2/explain'),
    v1FreezeCommit: V1_FREEZE_COMMIT,
    v1ScoringLastTouched: git('log', '-1', '--format=%H', '--',
      'shared/matching/criteria.js', 'shared/matching/score.js', 'shared/matching/weights.js', 'shared/matching/couplings.js'),
  };
  /**
   * The freeze check that means something.
   *
   * Comparing the last V1-scoring commit to the freeze SHA by equality cries
   * wolf: the freeze commit only added the record, so the last behavioural
   * commit is legitimately older. What matters is direction - if V1 scoring
   * was touched AFTER the freeze, every comparison in every pack is against
   * something other than the baseline it names.
   */
  const v1Moved = commits.v1ScoringLastTouched !== 'UNKNOWN'
    && commits.v1ScoringLastTouched !== V1_FREEZE_COMMIT
    && !isAncestor(commits.v1ScoringLastTouched, V1_FREEZE_COMMIT);
  commits.v1MovedSinceFreeze = v1Moved;
  if (v1Moved) {
    console.error(`REFUSING: V1 scoring was changed at ${commits.v1ScoringLastTouched.slice(0, 7)}, which is not an ancestor of the recorded freeze ${V1_FREEZE_COMMIT.slice(0, 7)}.`);
    console.error('          A pack generated now would compare V2 against something other than the frozen baseline it names.');
    process.exit(4);
  }
  const generatedAt = new Date().toISOString();

  const cache = new Map();
  const contextFor = (sport) => {
    if (cache.has(sport)) return cache.get(sport);
    const colleges = db.prepare('SELECT * FROM colleges WHERE sport = ? AND active = 1').all(sport);
    const roster = db.prepare(`
      SELECT college_name, player_name, position, minutes_played, projected_minutes, games_started, projected_games_started,
             estimated_graduation_year, eligibility_end_year, country,
             season, division, class_year_label
        FROM roster_players WHERE sport = ? AND season = ?
    `).all(sport, SEASON);
    const arrivals = db.prepare('SELECT programme, sport, arrival_season, canonical_position, is_international FROM recruiting_arrivals WHERE sport = ?').all(sport);
    const ctx = buildPoolContext({ db, sport, season: SEASON });
    cache.set(sport, ctx);
    return ctx;
  };

  fs.mkdirSync(out, { recursive: true });
  const written = [];
  for (const w of wanted) {
    const fixture = fromFile ?? findFixture(w.fixture);
    const ctx = contextFor(fixture.player.sport);
    const { pack } = buildValidationPack({
      fixture, profileId: w.profile, ctx, commits, rosterSeason: SEASON, generatedAt,
    });
    pack.purpose = w.why;
    /**
     * VERSIONED. The A7.6 packs keep their names and their review; nothing
     * here may overwrite them, and a refusal is better than a clobber.
     */
    const base = path.join(out, `pack-${pack.packId}${v2Set ? '-v2' : ''}`);
    if (v2Set && fs.existsSync(`${base}.md`) && !args.includes('--force')) {
      console.error(`Refusing to overwrite ${base}.md — pass --force only if you mean it.`);
      process.exit(5);
    }
    fs.writeFileSync(`${base}.md`, renderPack(pack));
    fs.writeFileSync(`${base}.json`, `${JSON.stringify(pack, null, 2)}\n`);
    written.push({ packId: pack.packId, md: `${base}.md`, json: `${base}.json`, pack });
    if (!quiet) {
      const d = pack.distribution;
      console.log(`${pack.packId.padEnd(18)} sample ${String(pack.sample.size).padStart(2)}  ranked ${String(d.ranked).padStart(4)}  limited ${String(d.limitedData).padStart(4)}`
        + `  median P ${String(d.poolMedianPriority).padEnd(7)}  J(level,playing) ${pack.ambition.levelVsPlayingJaccard}`
        + `  V1 overlap ${pack.v1Comparison.overlapTop100}/100  V1-top100-now-limited ${pack.v1Comparison.v1Top100NowLimitedData}`);
    }
  }

  if (firstSet || v2Set) {
    const indexName = v2Set ? 'README-v2.md' : 'README.md';
    fs.writeFileSync(path.join(out, indexName), renderIndex(written, commits, generatedAt));
    written.push({ packId: indexName, md: path.join(out, indexName) });
  }
  if (!quiet) {
    console.log('');
    for (const w of written) console.log(`  wrote ${w.md}${w.json ? `\n  wrote ${w.json}` : ''}`);
  }
}

function renderIndex(written, commits, generatedAt) {
  const packs = written.filter((w) => w.pack);
  const lines = [];
  lines.push('# V2 human validation — first review set', '');
  lines.push('V2 has never been adopted. V1 serves every recommendation in production and is unchanged.',
    'These packs exist so that a person can decide whether V2 behaves like a useful recruiting system',
    'before that changes.', '');
  lines.push(`Generated ${generatedAt} from \`${commits.v2Commit.slice(0, 7)}\`, explanations \`${commits.explanationCommit.slice(0, 7)}\`, against frozen V1 \`${commits.v1FreezeCommit.slice(0, 7)}\`.`, '');
  lines.push('## How to do this', '');
  lines.push('1. Open one pack. Read **View A only**. Do not scroll past the STOP divider.',
    '2. For each programme, tick one classification and any reasons that apply. If you cannot judge, tick INSUFFICIENT INFORMATION — it is a real answer, not a soft one.',
    '3. When View A is finished, read View B.',
    '4. For each programme you and V2 disagree about, say which of the six categories it is.',
    '5. Answer the thirteen questions at the end.',
    '6. Say whether each proposed red flag is the right line.', '');
  lines.push('**The order matters.** Once you have read View B for a pack, that pack can no longer produce a blind review. If you want a second reviewer, give them a clean copy.', '');
  lines.push('## Suggested order', '');
  lines.push('Start with **C**. It is the fixture that exposed the original V1 pathology, and it is the one where a bad answer would be most obvious. Then the **A pair** together, because the comparison between them is the review. **G** and the **H pair** can follow in a second sitting.', '');
  lines.push('| pack | athlete | why | programmes to review |', '|---|---|---|---|');
  for (const w of packs) {
    lines.push(`| [\`${w.packId}\`](${path.basename(w.md)}) | ${w.pack.athlete.label} | ${w.pack.purpose} | ${w.pack.sample.size} |`);
  }
  lines.push('', `Total: ${packs.reduce((s, w) => s + w.pack.sample.size, 0)} programme reviews across ${packs.length} packs.`, '');
  lines.push('## What is deliberately not in View A', '');
  lines.push('No V2 rank, no pursuit priority, no layer value, no gate, no explanation, and no V1 rank.',
    'Programme strength and the athlete\'s calibrated percentile **are** shown, because "would you contact this school for this athlete" cannot be answered without knowing the school\'s standard. What is withheld is every model output, including the relationship between those two numbers.',
    '',
    'The programmes are listed in an order derived from a hash of the pack id, so page order carries no information about rank.', '');
  lines.push('## Archetype coverage', '');
  lines.push('| archetype | covered by | source |', '|---|---|---|');
  for (const a of ARCHETYPE_COVERAGE) lines.push(`| ${a.archetype} | ${a.covered} | ${a.source} |`);
  lines.push('');
  lines.push('## Running a real athlete', '');
  lines.push('```bash', 'node server/scripts/v2ValidationPack.js --athlete=/path/to/athlete.json', '```', '',
    'The file holds one record in the player shape. Nothing about that athlete is written into this',
    'repository, and the pack reports which required inputs were absent rather than filling them in.',
    'An athlete who answered the intake preference questions keeps their own answers, and the pack is',
    'named `AS_STATED` rather than `UNDECLARED` so the label matches the run.', '');
  lines.push('## Recording the review', '');
  lines.push('Fill the markdown by hand, then transcribe into the `review.rows` array of the matching `.json`,',
    'or write a sibling file `pack-<id>.review.json` with the same row shape. Either way the review keeps the',
    'pack\'s commit, calibration and pool digest with it, which is what lets the same review be replayed',
    'against a later model.', '');
  lines.push('## What happens afterwards', '');
  lines.push('`agreementFor(pack, reviews)` turns a filled review into the agreement metrics. It produces no',
    'single accuracy number, on purpose. Nothing in the model may be fitted to these labels: a disagreement',
    'is triaged into one of six categories first, and most of them are not model defects.', '');
  return lines.join('\n');
}

main().catch((err) => { console.error(err); process.exit(1); });
