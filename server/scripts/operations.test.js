import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The commands, run as commands.
 *
 * Twice now the internals have changed correctly and the entry point has not.
 * H7 removed three fields from the evidence result; `evidenceReport.js` was
 * migrated in the same commit and `draftOutreach.js` was not, so `npm run
 * draft` threw on the first programme carrying any evidence and stayed broken
 * for five stages. The whole suite was green throughout.
 *
 * WHY THE EXISTING GUARDS MISSED IT. `scripts.test.js` runs every script with
 * no arguments and asserts only that its imports resolve — most exit on usage
 * long before they read anything, so the broken line was never reached. And
 * H13's tests drive `draftOne`, the extracted helper, which is the half that
 * was always fine.
 *
 * So these tests run the real thing: `node server/scripts/x.js --args`, the
 * same invocation `npm run` produces, and assert it starts, gets to its
 * summary, and exits 0. Not golden output — that is what the report baselines
 * are for. Enough to know the command still works.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DB = path.join(ROOT, 'server/data/recruitmatch.sqlite');
const HAVE_DB = fs.existsSync(DB) && fs.statSync(DB).size > 1_000_000;
const d = HAVE_DB ? describe : describe.skip;
if (!HAVE_DB) {
  // eslint-disable-next-line no-console
  console.warn(`\n  operations.test.js SKIPPED — no working database at ${DB}.`
    + '\n  These run the operator commands, which need it too.\n');
}

/**
 * The compliance environment the send path requires.
 *
 * Supplied so the draft command reaches its full dry-run summary; without it
 * the CLI exits at the compliance gate and prints nothing worth checking.
 * Deliberately fake values — they configure a footer, and nothing here sends.
 */
const COMPLIANT = {
  THRIV3_SENDER_IDENTITY: 'Thriv3 (test)',
  THRIV3_POSTAL_ADDRESS: '1 Test Street, Testville, TS 00000',
  THRIV3_UNSUBSCRIBE_BASE_URL: 'https://example.test',
};

function run(script, args = [], env = {}) {
  try {
    const stdout = execFileSync(process.execPath, [path.join(ROOT, 'server/scripts', script), ...args], {
      cwd: ROOT,
      env: { ...process.env, RECRUITMATCH_DB: DB, ...env },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    return { status: 0, out: stdout };
  } catch (err) {
    return { status: err.status ?? null, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

/** What a command that produces output for a person must always manage. */
function assertRan(r, { name, floorLines = 10 }) {
  expect(r.status, `${name} exited ${r.status}\n${r.out.slice(0, 3000)}`).toBe(0);
  expect(r.out, name).not.toMatch(/TypeError|ReferenceError|Cannot read propert|ERR_MODULE_NOT_FOUND|at Object\.<anonymous>/);
  // Exit 0 with nothing printed is not success for a command whose output IS
  // the product. `scripts.test.js` accepts that; these must not.
  expect(r.out.split('\n').length, `${name} printed ${r.out.split('\n').length} lines`)
    .toBeGreaterThanOrEqual(floorLines);
  expect(r.out, name).not.toMatch(/\bundefined\b|\bNaN\b|\[object Object\]/);
}

/** Rows in the tables a draft or a send would touch. */
function writeState() {
  const db = new Database(DB, { readonly: true });
  try {
    return {
      outreach: db.prepare('SELECT COUNT(*) n FROM outreach').get().n,
      evidence: db.prepare('SELECT COUNT(*) n FROM outreach_evidence').get().n,
      drafted: db.prepare('SELECT COUNT(*) n FROM outreach WHERE drafted_at IS NOT NULL').get().n,
      sent: db.prepare('SELECT COUNT(*) n FROM outreach WHERE sent_at IS NOT NULL').get().n,
    };
  } finally { db.close(); }
}

// ---------------------------------------------------------------------------

d('npm run draft', () => {
  const before = writeState();
  const r = run('draftOutreach.js', ['--athlete', 'Rhys Davies', '--top', '2'], COMPLIANT);
  const after = writeState();

  it('runs to completion', () => {
    assertRan(r, { name: 'draft', floorLines: 15 });
  });

  it('reaches the evidence summary, which is where it broke', () => {
    /**
     * THE H7 REGRESSION, caught by execution rather than by grep.
     *
     * `printEvidence` dereferenced `ranked`, `suppressed` and `belowThreshold`
     * — three fields deleted with the legacy selector — and threw. Reaching
     * these lines at all is the assertion: a summary that names a kind and a
     * structure means the whole function ran over a real evidence result.
     */
    expect(r.out).toMatch(/evidence: (RELATIONSHIP_FIRST|PLAYER_FIRST) \((engine|operator)\), \d+ item/);
    expect(r.out).toMatch(/\d+\. [A-Z_]+ \(FACT|SIGNAL/);
    expect(r.out).toMatch(/→ (hook|relevance|recognition)/);
  });

  it('names its programmes, contacts and provenance', () => {
    expect(r.out).toContain('Rhys Davies — mens-soccer');
    expect(r.out).toMatch(/\d+ contact\(s\)/);
    expect(r.out).toMatch(/contacts by address provenance:/);
    expect(r.out).toMatch(/\d+ programme\(s\), \d+ draft\(s\)/);
  });

  it('speaks no retired vocabulary', () => {
    // The words that would mean it had found its way back to the old result.
    for (const gone of ['also had:', 'too thin:', 'SUPPRESSED_REDUNDANT', 'BELOW_THRESHOLD', 'INTERNAL_ONLY']) {
      expect(r.out, gone).not.toContain(gone);
    }
    // And the disposition vocabulary it SHOULD use when something was dropped.
    if (r.out.includes('dropped:')) expect(r.out).toMatch(/dropped: {2}[A-Z_]+ — /);
  });

  it('drafts nothing, and says so', () => {
    expect(r.out).toContain('dry run — nothing drafted');
    expect(r.out).not.toContain('drafting…');
    expect(r.out).not.toContain('waiting in Outlook');
  });

  it('leaves no trace in the tables a draft would write', () => {
    // Three barriers, and this is the observable one. The others are that the
    // command returns before the draft loop exists in its call graph, and the
    // compliance gate below.
    expect(after).toEqual(before);
  });

  it('cannot write even in apply mode without a configured footer', () => {
    /**
     * The proof that does not rest on "we did not pass --apply".
     *
     * `sendOutreach` refuses without a sender identity, a postal address and
     * an opt-out URL, and the CLI checks the same thing first and exits. So an
     * invocation with `--apply` and no compliance environment cannot reach
     * Outlook however the flags are read.
     */
    const stateBefore = writeState();
    const applied = run('draftOutreach.js', ['--athlete', 'Rhys Davies', '--top', '1', '--apply'], {
      THRIV3_SENDER_IDENTITY: '', THRIV3_POSTAL_ADDRESS: '', THRIV3_UNSUBSCRIBE_BASE_URL: '',
    });
    expect(applied.out).toMatch(/Cannot draft yet — missing/);
    expect(applied.out).not.toContain('waiting in Outlook');
    expect(applied.status).toBe(1);
    expect(writeState()).toEqual(stateBefore);
  });
});

d('npm run roster-sources', () => {
  const r = run('rosterSourceAudit.js');

  it('runs to completion', () => {
    assertRan(r, { name: 'roster-sources', floorLines: 10 });
  });

  it('reports coverage and the repair queue', () => {
    expect(r.out).toContain('ROSTER SOURCES — mens-soccer, 2026');
    expect(r.out).toMatch(/\d+ programme-seasons with a roster on file/);
    expect(r.out).toMatch(/VERIFIED_DIRECT\s+\d+\s+\d+\.\d%/);
    expect(r.out).toMatch(/linkable: \d+ of \d+ \(\d+\.\d%\)/);
    expect(r.out).toMatch(/to repair: \d+/);
  });

  it('names the institution-id disagreements with both ids', () => {
    // The queue's only genuine defect class, and the one whose repair is an id
    // rather than a URL. If the report stops saying so, somebody goes hunting
    // for a bad link that is not there.
    expect(r.out).toContain('INSTITUTION ID DISAGREES');
    expect(r.out).toMatch(/registry says institution \d+, the college row says \d+/);
  });

  it('says it changed nothing', () => {
    expect(r.out).toContain('Read-only. Nothing was changed.');
  });

  it('lists the whole queue when asked', () => {
    const listed = run('rosterSourceAudit.js', ['--list']);
    assertRan(listed, { name: 'roster-sources --list', floorLines: 30 });
    expect(listed.out).toContain('NOT LINKABLE');
    expect(listed.out).toMatch(/UNVERIFIED_HOST\s+\S/);
  });
});

d('npm run recruiting:evidence, in every mode', () => {
  /**
   * The DEFAULT invocation is covered by `reports.test.js`. Its flags were
   * not — and `--distribution` threw on `ev.suppressed`, the same field H7
   * deleted and the third script to break on it. A command's flags are part
   * of the command.
   */
  it('runs the distribution sweep', () => {
    const r = run('recruitingEvidenceReport.js', ['--distribution']);
    assertRan(r, { name: 'recruiting:evidence --distribution', floorLines: 20 });
    expect(r.out).toMatch(/programmes evaluated: \d+/);
    expect(r.out).toMatch(/KIND\s+GENERATED\s+SELECTED/);
    // The supersession tally: the number that says whether the hierarchy does
    // anything, and the line that was throwing.
    expect(r.out).toContain('WHAT THE NEW EVIDENCE SUPERSEDED');
    expect(r.out).toMatch(/\d+ {2}[A-Z_]+ > [A-Z_]+/);
    expect(r.out).toContain('Read-only. Nothing drafted, logged or sent.');
  });

  it('runs the baseline comparison', () => {
    const r = run('recruitingEvidenceReport.js', ['--baseline']);
    assertRan(r, { name: 'recruiting:evidence --baseline', floorLines: 5 });
  });
});

d('npm run confirm-sends', () => {
  const before = writeState();
  const r = run('confirmSends.js', ['--athlete', 'Rhys Davies']);
  const after = writeState();

  it('lists without confirming', () => {
    assertRan(r, { name: 'confirm-sends', floorLines: 3 });
    expect(r.out).toMatch(/OUTREACH STATUS|nothing pending|Re-run with --apply/i);
  });

  it('confirms nothing until told to', () => {
    // Listing is the default and confirming needs `--apply`, the same shape as
    // drafting. A confirmation is what makes a send count towards the caps and
    // the reply-rate denominators, so doing it by accident would corrupt the
    // only measurement the system has.
    expect(after).toEqual(before);
    expect(r.out).not.toMatch(/confirmed \d+/i);
  });
});
