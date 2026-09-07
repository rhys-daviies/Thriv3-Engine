import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { canonical, digest, short, datasetManifest, compareBaselines } from './evidenceBaseline.js';

/**
 * THE BASELINES, AND THE RULE FOR READING THEM.
 *
 * A failure here is not a bug in this file. It says a coach-facing boundary
 * moved, and the response is to find out what moved and why — never to paste
 * the new hash in. `docs/EVIDENCE_BASELINES.md` has the workflow; the short
 * version is that repinning is a product decision with a named reason, and
 * `npm run evidence:baseline -- --update` prints exactly what it is about to
 * change so that reason can be written down.
 *
 * The dataset is checked first and separately. A roster re-import moves every
 * product hash for reasons that are not code, and reporting that as five
 * regressions is how people learn to repin without reading.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DB = path.join(ROOT, 'server/data/recruitmatch.sqlite');
const EXPECTED = path.join(ROOT, 'server/scripts/__baselines__/evidence.json');
const HAVE_DB = fs.existsSync(DB) && fs.statSync(DB).size > 1_000_000;
const d = HAVE_DB ? describe : describe.skip;
if (!HAVE_DB) console.warn(`\n  evidenceBaseline.test.js SKIPPED — no database at ${DB}\n`);

/**
 * Run the real command, in a subprocess.
 *
 * Not an in-process import: the thing being protected is a command a developer
 * runs, and a test that exercised the library while the CLI was broken would
 * be testing the half nobody uses. `--json` is the machine mode, so this also
 * pins that the mode works.
 */
/**
 * The command exits non-zero when a baseline moves — which is what CI needs and
 * what this test must NOT be stopped by. `execFileSync` throws on a non-zero
 * exit, and an uncaught throw at module scope makes the whole file report "no
 * tests": the one outcome worse than a red build, because it looks like
 * nothing ran. So the failure is captured and the JSON on stdout is read
 * either way, letting the assertions below name the baseline that moved.
 */
const runBaseline = () => {
  const opts = {
    cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: DB },
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  };
  const args = [path.join(ROOT, 'server/scripts/evidenceBaseline.js'), '--json'];
  try { return execFileSync('node', args, opts); }
  catch (err) {
    const out = String(err.stdout ?? '');
    if (out.trim().startsWith('{')) return out;
    throw new Error(`evidence:baseline could not run:\n${out}${err.stderr ?? ''}`);
  }
};

/**
 * Walked TWICE and no more. The corpus is 4,742 pairs and each walk costs about
 * ten seconds, so every test below reads one of these two runs: the first is
 * the subject, the second exists only to prove the first is reproducible.
 */
const FIRST = HAVE_DB ? runBaseline() : '{}';
const SECOND = HAVE_DB ? runBaseline() : '{}';
const result = JSON.parse(FIRST);

/* -------------------------------------------------------------------------- */

describe('canonical serialization', () => {
  it('does not depend on the order keys were written in', () => {
    expect(canonical({ b: 1, a: { d: 2, c: 3 } })).toBe(canonical({ a: { c: 3, d: 2 }, b: 1 }));
    expect(canonical([{ z: 1, a: 2 }])).toBe(canonical([{ a: 2, z: 1 }]));
  });

  it('DOES depend on the order of a collection', () => {
    // Sequence is meaning: the order claims were selected in and the order
    // sentences appear in. Sorting it away would hide the likeliest regression.
    expect(canonical([1, 2])).not.toBe(canonical([2, 1]));
    expect(canonical(['HOOK', 'RELEVANCE'])).not.toBe(canonical(['RELEVANCE', 'HOOK']));
  });

  it('moves for any meaningful value change', () => {
    const base = { kind: 'POSITION_GRADUATION', count: 2, names: ['A', 'B'] };
    for (const changed of [
      { ...base, count: 3 },
      { ...base, kind: 'ACADEMIC_FIT' },
      { ...base, names: ['A', 'C'] },
      { ...base, names: ['A'] },
      { ...base, extra: null },
    ]) expect(canonical(changed), JSON.stringify(changed)).not.toBe(canonical(base));
  });

  it('treats a missing field and an undefined field alike, and both as null', () => {
    // A field that stops being set must move the hash rather than disappear.
    expect(canonical({ a: 1, b: undefined })).toBe(canonical({ a: 1, b: null }));
    expect(canonical({ a: 1, b: undefined })).not.toBe(canonical({ a: 1 }));
  });

  it('hashes with SHA-256 and compares the whole digest', () => {
    expect(digest('x')).toHaveLength(64);
    expect(digest('x')).toBe('2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881');
    // Display truncates; nothing compares the truncation.
    expect(short(digest('x'))).toHaveLength(16);
  });
});

d('the committed baselines', () => {
  const expected = JSON.parse(fs.readFileSync(EXPECTED, 'utf8'));

  it('is comparing the dataset it was pinned against', () => {
    /**
     * DATASET CHANGED is its own verdict and comes first. If this fails, the
     * product hashes below are UNCOMPARABLE rather than wrong — a roster
     * import, a new programme or a domain re-scrape moved the rows underneath
     * them. Establish that, repin the manifest deliberately, and only then
     * read the product lines.
     */
    expect(result.dataset, 'DATASET CHANGED — the underlying rows moved, so product'
      + ' hashes below cannot be compared. See docs/EVIDENCE_BASELINES.md.')
      .toBe('UNCHANGED');
    expect(result.datasetDigest).toBe(expected.manifest.digest);
  });

  for (const want of JSON.parse(fs.readFileSync(EXPECTED, 'utf8')).baselines) {
    it(`${want.name} is unchanged`, () => {
      const got = result.baselines.find((b) => b.name === want.name);
      expect(got, `${want.name} is committed but the command no longer produces it`).toBeTruthy();
      expect(got.size, `${want.name} corpus size moved`).toBe(want.size);
      expect(got.digest, `\n\n  ${want.name} MOVED.\n`
        + `    expected ${short(want.digest)}\n    actual   ${short(got.digest)}\n\n`
        + '  A coach-facing boundary changed. Do not repin until you can say what\n'
        + '  changed and why — see docs/EVIDENCE_BASELINES.md.\n')
        .toBe(want.digest);
      expect(got.status).toBe('PASS');
    });
  }

  it('reports every baseline as passing, and says so in its exit code', () => {
    expect(result.ok).toBe(true);
    expect(result.baselines.map((b) => b.name)).toEqual([
      'OUTBOUND_DECISION', 'COACH_COMPOSITION', 'EMAIL_BODY',
      'OPERATOR_WIRE', 'LOG_PAYLOAD', 'OPERATOR_EVIDENCE',
    ]);
  });

  it('produces the same bytes twice', () => {
    // Nothing in the corpus may depend on row order, iteration accident, the
    // filesystem or the clock.
    expect(SECOND).toBe(FIRST);
  });

  it('never rewrites the expectations during a normal run', () => {
    // Two full runs happened above; the file must be exactly as committed.
    const onDisk = JSON.parse(fs.readFileSync(EXPECTED, 'utf8'));
    expect(onDisk.manifest.digest).toBe(expected.manifest.digest);
    expect(onDisk.baselines).toEqual(expected.baselines);
    // Only `--update` writes, and it is not what a test or CI run invokes.
    // The single write is inside the `--update` branch and nowhere else.
    const cli = fs.readFileSync(path.join(ROOT, 'server/scripts/evidenceBaseline.js'), 'utf8');
    const calls = cli.match(/^\s*writeFileSync\(/gm) ?? [];
    expect(calls, 'exactly one write, and it must be behind --update').toHaveLength(1);
    expect(cli.slice(cli.indexOf('if (UPDATE) {'))).toContain('writeFileSync(');
    expect(cli.slice(0, cli.indexOf('if (UPDATE) {'))).not.toMatch(/^\s*writeFileSync\(/m);
  });
});

/**
 * THE OTHER HALF OF THE GUARANTEE.
 *
 * A hash says the output did not move. These say the output and the record
 * agree about what the output was — the failure a hash cannot see, because
 * both the log and the body can be perfectly stable while describing different
 * emails. That is what the legacy `primary` did for 701 emails.
 */
d('what we record is what the coach read', () => {
  const inv = result.invariants;

  it('renders every kind it records as displayed, and records every sentence', () => {
    expect(inv.renderedButNoSentence, JSON.stringify(inv.examples.slice(0, 3))).toBe(0);
    expect(inv.sentenceButNotRendered, JSON.stringify(inv.examples.slice(0, 3))).toBe(0);
  });

  it('puts every recorded sentence in a block the template actually carries', () => {
    // A slot filled but dropped from the flow's block list would leave a
    // sentence logged that no coach could read.
    expect(inv.sentenceMissingFromTemplate, JSON.stringify(inv.examples.slice(0, 3))).toBe(0);
  });

  it('claims personalisation only when an evidence sentence appeared', () => {
    expect(inv.personalisedWithNoEvidenceSentence).toBe(0);
    expect(inv.notPersonalisedWithEvidenceSentence).toBe(0);
  });

  it('counts a congratulation as courtesy, not personalisation', () => {
    // Recognition-only emails exist and are generic. The rule is
    // `outreachEvidenceFor`'s; this pins that nothing downstream disagrees.
    expect(inv.primaryRoleIsRecognition).toBe(0);
    expect(result.stats.generic).toBeGreaterThan(0);
  });

  it('names a primary and a hook only from what was rendered', () => {
    expect(inv.primaryKindNotRendered, JSON.stringify(inv.examples.slice(0, 3))).toBe(0);
    expect(inv.hookKindNotRendered, JSON.stringify(inv.examples.slice(0, 3))).toBe(0);
  });

  it('allows a held claim, and does not count it as a contradiction', () => {
    expect(result.stats.held).toBeGreaterThan(0);
    expect(result.invariantsOk).toBe(true);
  });
});

d('the corpus is worth hashing', () => {
  const s = result.stats;

  it('keeps the operator surfaces separable from the coach-facing ones', () => {
    /**
     * OPERATOR_EVIDENCE is the only baseline carrying `sourceUrl`, and it is
     * the only one a registry re-scrape may move. Kept distinct so a
     * provenance change reads as a provenance change: removing sourceUrl from
     * every generator moves this hash and no coach-facing one.
     */
    const names = result.baselines.map((b) => b.name);
    expect(names).toContain('OPERATOR_EVIDENCE');
    expect(names).toContain('OPERATOR_WIRE');
    // Two operator surfaces, two payloads. `toWire` feeds the panel's decision
    // view and does not carry provenance at all.
    const wire = result.baselines.find((b) => b.name === 'OPERATOR_WIRE');
    const opev = result.baselines.find((b) => b.name === 'OPERATOR_EVIDENCE');
    expect(wire.digest).not.toBe(opev.digest);
  });

  it('covers every pair, in both sports', () => {
    expect(s.pairs).toBe(4742);
    for (const b of result.baselines) expect(b.size, b.name).toBe(s.pairs);
  });

  it('carries generic emails as well as personalised ones', () => {
    // A corpus of only personalised emails would not protect PLAYER_FIRST or
    // the zero-safe-evidence path, which is most of what actually sends.
    expect(s.personalised).toBeGreaterThan(1000);
    expect(s.generic).toBeGreaterThan(1000);
    expect(s.structures.PLAYER_FIRST).toBeGreaterThan(0);
    expect(s.structures.RELATIONSHIP_FIRST).toBeGreaterThan(0);
  });

  it('renders all nine licensed kinds at least once', () => {
    // Nine since J3 denied HISTORICAL_SAME_REGION. The list is written out
    // rather than derived from LICENSED_KINDS deliberately: a kind quietly
    // losing its licence should fail here too, not disappear from the check
    // along with the licence.
    for (const kind of [
      'COACH_ARRIVAL_SAME_COUNTRY', 'ARRIVAL_SAME_COUNTRY_POSITION',
      'HISTORICAL_SAME_COUNTRY', 'CURRENT_SAME_COUNTRY',
      'ARRIVAL_SAME_REGION_POSITION',
      'POSITION_GRADUATION', 'ACADEMIC_FIT', 'CONFERENCE_TITLE', 'POSTSEASON_RESULT',
    ]) {
      expect(s.renderedByKind[kind] ?? 0, `${kind} never renders in the corpus`).toBeGreaterThan(0);
    }
  });

  it('holds claims without rendering them, and counts them separately', () => {
    // A held alternative is correct behaviour, not a contradiction.
    expect(s.held).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* The clock                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * THE GUARD THAT SHOULD HAVE EXISTED AT H18.
 *
 * Three of the six baselines carried `ageDays` — a whole-day counter derived
 * from `Date.now()` — inside the bytes being hashed. They were correct when
 * pinned and wrong the next morning, and because the corpus, the code and the
 * dataset manifest were all genuinely unchanged, the failure read as an
 * unexplained regression for two stages.
 *
 * A hash comparison cannot notice this on its own: every run inside one day
 * agrees with every other, so five runs, a fresh process and a clean worktree
 * all reproduce the same wrong answer. Only running the SAME code and data at
 * two DIFFERENT instants separates a behavioural fingerprint from a clock
 * reading, so that is what this does.
 *
 * If this test ever fails, a new environmental value has entered a payload.
 * Repinning would not fix it; it would restart the same daily decay.
 */
d('the baselines do not depend on when they are run', () => {
  const at = (iso) => JSON.parse(execFileSync('node', ['--input-type=module', '-e', `
    const F = Date.parse(${JSON.stringify(iso)});
    Date.now = () => F;
    const { buildBaselines } = await import(${JSON.stringify(path.join(ROOT, 'server/lib/evidenceBaseline.js'))});
    const b = buildBaselines();
    process.stdout.write(JSON.stringify(b.baselines.map((x) => [x.name, x.digest])));
  `], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: DB }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));

  it('produces identical digests a year apart', () => {
    // A year, not a day: it also crosses the season boundary `seasonIsBehind`
    // reads, which would flip every programme's context and move all six.
    const early = at('2026-09-06T00:00:00Z');
    const later = at('2027-09-06T00:00:00Z');
    expect(later).toEqual(early);
  });
});

/* -------------------------------------------------------------------------- */
/* Manifest V2 — roster freshness                                              */
/* -------------------------------------------------------------------------- */

/**
 * The component K3A found missing, and the two things it must get right.
 *
 * It has to MOVE when the timestamp production actually reads moves, or it is
 * decoration. It has to STAY STILL when a timestamp production never reads
 * moves, or it is claiming a behavioural dependency that does not exist and
 * will cry CHANGED on every partial re-scrape until nobody reads it.
 *
 * Both directions are exercised against a scratch copy of the database, which
 * is why this can mutate rows at all: the production file is never opened for
 * writing.
 */
d('roster_freshness mirrors what production reads', () => {
  const probe = (mutation) => {
    const tmp = path.join(os.tmpdir(), `rf-${Math.random().toString(36).slice(2)}.sqlite`);
    fs.copyFileSync(DB, tmp);
    try {
      return JSON.parse(execFileSync('node', ['--input-type=module', '-e', `
        process.env.RECRUITMATCH_DB = ${JSON.stringify(tmp)};
        const { default: db } = await import(${JSON.stringify(path.join(ROOT, 'server/db/client.js'))});
        ${mutation}
        const { rosterFreshnessFingerprint } = await import(${JSON.stringify(path.join(ROOT, 'server/lib/evidenceBaseline.js'))});
        process.stdout.write(JSON.stringify(rosterFreshnessFingerprint()));
      `], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
    } finally { fs.rmSync(tmp, { force: true }); }
  };

  const base = probe('');

  it('fingerprints one row per programme-sport in the current season', () => {
    expect(base.rows).toBeGreaterThan(1000);
    expect(base.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('MOVES when the newest current-season timestamp moves', () => {
    const moved = probe(`db.prepare("UPDATE roster_players SET updated_date = '2099-01-01T00:00:00.000Z'"
      + " WHERE rowid = (SELECT rowid FROM roster_players WHERE season = '2026' LIMIT 1)").run();`);
    expect(moved.digest).not.toBe(base.digest);
    expect(moved.rows).toBe(base.rows);
  });

  it('does NOT move when a season production never reads moves', () => {
    // 2023 is history. `squadRows` filters to SQUAD_SEASON, so no email can
    // see this row's timestamp and no digest should pretend otherwise.
    const still = probe(`db.prepare("UPDATE roster_players SET updated_date = '2099-01-01T00:00:00.000Z'"
      + " WHERE season = '2023'").run();`);
    expect(still.digest).toBe(base.digest);
  });

  it('does NOT move when a non-max row in the current season moves backwards', () => {
    const still = probe(`
      const row = db.prepare("SELECT college_name, sport FROM roster_players WHERE season = '2026'"
        + " GROUP BY college_name, sport HAVING COUNT(*) > 2 LIMIT 1").get();
      db.prepare("UPDATE roster_players SET updated_date = '2000-01-01T00:00:00.000Z'"
        + " WHERE rowid = (SELECT rowid FROM roster_players WHERE season = '2026'"
        + " AND college_name = ? AND sport = ? AND updated_date < (SELECT MAX(updated_date)"
        + " FROM roster_players WHERE season = '2026' AND college_name = ? AND sport = ?) LIMIT 1)")
        .run(row.college_name, row.sport, row.college_name, row.sport);`);
    expect(still.digest).toBe(base.digest);
  });
});

d('the manifest declares its own definition version', () => {
  it('reports V2 and carries roster_freshness', () => {
    const m = datasetManifest();
    expect(m.version).toBe('V2');
    expect(m.tables.map((t) => t.table)).toContain('roster_freshness');
  });

  it('reads a V1 pin as a definition change, not a data change', () => {
    const actual = { manifest: datasetManifest(), stats: {}, invariants: {}, baselines: [] };
    const cmp = compareBaselines({ manifest: { digest: 'old', tables: [] }, baselines: [] }, actual);
    expect(cmp.dataset).toBe('DEFINITION_CHANGED');
    expect(cmp.manifestVersionExpected).toBe('V1');
  });
});
