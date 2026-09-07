import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The report scripts, protected.
 *
 * These three had no tests at all. During H7 `evidenceReport.js` lost two
 * fields it read off the evidence result, threw on every pairing, and
 * collapsed from 11,405 lines to 553 — and the whole suite stayed green,
 * because nothing ran them. The artefact hash I was comparing was a hash of a
 * stack trace.
 *
 * SO A HASH IS THE LAST ASSERTION HERE, NOT THE FIRST. Each report is checked
 * in five layers, cheapest and most fundamental first:
 *
 *   1. the process exits 0 and prints no stack trace
 *   2. the output is not far smaller than it should be
 *   3. every section heading the report owes is present
 *   4. representative content is right — the claims, the direction of a
 *      redundancy, the vocabulary of the engine that decided
 *   5. the exact bytes
 *
 * A hash tells you something changed. Layers 1-4 tell you WHAT, and each of
 * them fails on its own — which is the difference between a test that catches
 * the H7 failure and a test that reports a new number after it.
 *
 * ---------------------------------------------------------------------------
 * WHY A SUBPROCESS, AND WHY THE WORKING DATABASE.
 *
 * All three scripts call `main()` at module scope and read `server/db/client`
 * directly, so there is no seam to inject a fixture through and no way to
 * import one without running it. A subprocess is also the only way to observe
 * the failure mode that actually happened: a non-zero exit.
 *
 * The suite therefore runs against the working database and SKIPS, loudly,
 * when it is not there — these are regression tests for local report commands
 * that need that database anyway. Determinism comes from pinning a small,
 * named slice (`--athlete`, `--college`, `--programme`), which is stable
 * run-to-run; the fixtures below say which slice and why.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DB = path.join(ROOT, 'server/data/recruitmatch.sqlite');
const HAVE_DB = fs.existsSync(DB) && fs.statSync(DB).size > 1_000_000;

/** Runs a report exactly as `npm run …` does, and reports how it ended. */
const run = (script, args = []) => {
  try {
    const stdout = execFileSync('node', [path.join(ROOT, 'server/scripts', script), ...args], {
      cwd: ROOT,
      env: { ...process.env, RECRUITMATCH_DB: DB },
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, status: 0, out: stdout };
  } catch (err) {
    return {
      ok: false,
      status: err.status ?? null,
      out: `${err.stdout ?? ''}${err.stderr ?? ''}`,
    };
  }
};

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/**
 * The checks every report owes, whatever it is about.
 *
 * `floorLines` is a floor rather than an exact count: an exact one would fail
 * on a roster import that adds a season, which is not a regression. It is set
 * near the observed size, because the failure being guarded is a collapse —
 * H7's report lost 95% of its output.
 */
function assertHealthy(result, { name, floorLines, floorChars }) {
  expect(result.status, `${name} exited ${result.status}\n${result.out.slice(0, 2000)}`).toBe(0);
  expect(result.out, name).not.toMatch(/TypeError|ReferenceError|Cannot read propert|at Object\.<anonymous>/);
  const lines = result.out.split('\n').length;
  expect(lines, `${name} produced ${lines} lines, expected at least ${floorLines}`)
    .toBeGreaterThanOrEqual(floorLines);
  expect(result.out.length, `${name} produced ${result.out.length} chars`)
    .toBeGreaterThanOrEqual(floorChars);
  // Nothing half-rendered. A template hole reaches a report the same way it
  // reaches an email.
  expect(result.out, name).not.toMatch(/\bundefined\b|\bNaN\b|\[object Object\]/);
}

const describeReports = HAVE_DB ? describe : describe.skip;
if (!HAVE_DB) {
  // eslint-disable-next-line no-console
  console.warn(`\n  reports.test.js SKIPPED — no working database at ${DB}.`
    + '\n  These guard the local report commands, which need it too.\n');
}

// ---------------------------------------------------------------------------

describeReports('evidenceReport', () => {
  /**
   * ONE PAIRING, NAMED. Jacksonville is the case the whole engine is
   * documented around: a coach who brought a New Zealander in, a graduating
   * defender group, and two same-connection claims that lose to the arrival.
   * It exercises selection, redundancy and composition in 157 lines.
   */
  const result = run('evidenceReport.js', ['--athlete', 'Rhys Davies', '--college', 'Jacksonville']);

  it('runs to completion', () => {
    assertHealthy(result, { name: 'evidenceReport', floorLines: 120, floorChars: 12000 });
  });

  it('carries every section it owes', () => {
    for (const heading of ['PROGRAM:', 'ATHLETE:', 'POSITION:', 'CLASS:', 'ROSTER:',
      'AVAILABLE EVIDENCE', 'SELECTED', 'EMAIL STRUCTURE', 'EMAIL WOULD SAY']) {
      expect(result.out, heading).toContain(heading);
    }
  });

  it('states the claims, their status and their source', () => {
    expect(result.out).toContain('COACH_ARRIVAL_SAME_COUNTRY');
    expect(result.out).toMatch(/selected: true/);
    expect(result.out).toMatch(/rendered: true/);
    expect(result.out).toMatch(/source: recruiting_arrivals/);
    // Every generated kind gets a numbered entry, not just the selected ones.
    expect(result.out.match(/^ {2}\d+\. [A-Z_]+/gm).length).toBeGreaterThanOrEqual(8);
  });

  it('names the redundancy in the direction the outbound selector decided', () => {
    /**
     * The H6/H7 defect, pinned. The report read the LEGACY selector's arrays
     * and named the claim it was SENDING as the redundant one. The survivor is
     * the arrival; the two that restate it are the ones suppressed.
     */
    expect(result.out).toContain('SUPPRESSED AS REDUNDANT');
    expect(result.out).toContain('HISTORICAL_SAME_COUNTRY — says the same as COACH_ARRIVAL_SAME_COUNTRY');
    expect(result.out).not.toContain('COACH_ARRIVAL_SAME_COUNTRY — says the same as');
    expect(result.out).toContain('Primary:   COACH_ARRIVAL_SAME_COUNTRY');
  });

  it('shows the email it would send', () => {
    expect(result.out).toContain('I saw you brought Hayden Aish in from New Zealand in 2025');
  });

  it('matches its recorded output', () => {
    expect(sha(result.out)).toBe('8105bf98447a9cfe');
  });
});

// ---------------------------------------------------------------------------

describeReports('outreachQA', () => {
  /**
   * THE WHOLE RUN. It takes fifteen programmes by design — the spread of
   * outbound shapes is the thing it exists to show — and costs under two
   * seconds. Narrowing it would remove the coverage it is for.
   */
  const result = run('outreachQA.js');

  it('runs to completion', () => {
    assertHealthy(result, { name: 'outreachQA', floorLines: 1200, floorChars: 50000 });
  });

  it('carries every section it owes, for every programme', () => {
    // Fourteen since J3, not fifteen. `outreachQA` had a
    // "HISTORICAL_SAME_REGION fallback" category worth one programme; that
    // kind is now OUTREACH DENIED, so the slot can never be filled and was
    // removed rather than left to shorten the sample silently.
    for (const [heading, atLeast] of [['OUTBOUND DISPOSITIONS', 14], ['SELECTED ORDER', 14],
      ['DISPLAYED ORDER', 14], ['FINAL EMAIL', 14], ['FACT CHECK', 14]]) {
      const n = result.out.split(heading).length - 1;
      expect(n, `${heading} appeared ${n} times`).toBeGreaterThanOrEqual(atLeast);
    }
    for (const heading of ['SAFETY CHECK', 'LENGTH DISTRIBUTION', 'SUBJECT LINES']) {
      expect(result.out, heading).toContain(heading);
    }
  });

  it('has no retired legacy diagnostic section', () => {
    // H7 removed it: the outbound section above already lists every kind with
    // a reason, and this restated a different question's answer under a
    // heading that looked like this one's.
    expect(result.out).not.toContain('LEGACY DIAGNOSTIC');
    expect(result.out).not.toContain('SUPPRESSED EVIDENCE');
  });

  it('speaks the deciding engine\'s vocabulary and not the retired one', () => {
    expect(result.out).toMatch(/\bNOT_LICENSED\b/);
    expect(result.out).toMatch(/\bSELECTED\b/);
    for (const retired of ['SUPPRESSED_REDUNDANT', 'BELOW_THRESHOLD', 'INTERNAL_ONLY']) {
      expect(result.out, retired).not.toContain(retired);
    }
  });

  it('shows a real email, with its structure and its selected order', () => {
    expect(result.out).toContain('OUTREACH QA — Rhys Davies');
    expect(result.out).toMatch(/STRUCTURE {5}: (RELATIONSHIP_FIRST|PLAYER_FIRST) \((ENGINE|OPERATOR)\)/);
    expect(result.out).toMatch(/Hi \w+,/);
    expect(result.out).toContain('I\'m reaching out about Rhys Davies');
  });

  it('leaks no registry key into the prose a coach would read', () => {
    /**
     * The email bodies are quoted verbatim in this report, so a key that
     * reached a clause would be visible here. Scoped to the FINAL EMAIL
     * blocks: the disposition tables are supposed to print kind names.
     */
    for (const block of result.out.split('FINAL EMAIL').slice(1)) {
      const body = block.split('FACT CHECK')[0];
      expect(body).not.toMatch(/[A-Z]{3,}_[A-Z_]{3,}/);
    }
  });

  it('matches its recorded output', () => {
    /**
     * Re-pinned in H10, for eight lines. A New Zealander at Utah Valley
     * appears in 2025 and on the 2026 roster; the historical claim counted the
     * snapshot, so its span read 2025-2026 and the sentence said "since 2025".
     * The measured span is one season, so it now says "in 2025" — the same
     * player, the same fact, one season more precisely.
     *
     * The other two report fixtures did not move.
     */
    /**
     * Re-pinned in J3, and the movement is the product change.
     *
     * HISTORICAL_SAME_REGION is DENIED and ARRIVAL_SAME_REGION_POSITION now
     * requires a season inside two of the squad season, so 302 emails across
     * the corpus lost a hook they should not have had. In this report the
     * sample also drops from fifteen programmes to fourteen, because the
     * category that existed to show a regional-history email has nothing left
     * to show.
     */
    /**
     * Re-pinned in J4 for two changes, both visible in this report:
     * POSITION_FLOW_HOLD withholding POSITION_GRADUATION where a
     * position-bearing arrival already opens the email, and the credentials
     * block no longer repeating the position and class year.
     *
     * Re-pinned again at J7, for copy alone: a graduating cohort of four or
     * more now counts and names two rather than listing all of them, "back in"
     * starts a season later so nothing inside a recency window is called
     * distant, and the conference congratulation dropped its appended
     * compliment.
     */
    expect(sha(result.out)).toBe('ebca1e370d5b5ca3');
  });
});

// ---------------------------------------------------------------------------

describeReports('recruitingEvidenceReport', () => {
  /**
   * WHAT IT IS FOR, which is not the same as the other two. It inspects the
   * recruiting-history kinds — the ones built from `recruiting_arrivals` — and
   * its distinctive contract is PROVENANCE: for every claim it prints the
   * transitions observed, the coverage status, the identity method and the
   * supporting players, so a count can be checked against the rows it came
   * from. That block is server-side only and must never reach the wire, which
   * is exactly why a report is where it is read.
   */
  const result = run('recruitingEvidenceReport.js', ['--athlete', 'Rhys Davies', '--programme', 'Jacksonville']);

  it('runs to completion', () => {
    assertHealthy(result, { name: 'recruitingEvidenceReport', floorLines: 60, floorChars: 3500 });
  });

  it('carries every section it owes', () => {
    for (const heading of ['OUTBOUND DISPOSITIONS', 'SELECTED ORDER', 'DISPLAYED ORDER',
      'FINAL EMAIL', 'PROVENANCE']) {
      expect(result.out, heading).toContain(heading);
    }
    expect(result.out).toContain('Rhys Davies x Jacksonville');
  });

  it('says the provenance is server-side only', () => {
    // The label is the contract: these fields are readable here and nowhere a
    // client can reach.
    expect(result.out).toContain('PROVENANCE (server-side only; never crosses the wire)');
  });

  it('shows the recruiting kinds it exists to inspect, with their outcome', () => {
    expect(result.out).toMatch(/COACH_ARRIVAL_SAME_COUNTRY +SELECTED/);
    expect(result.out).toMatch(/POSITION_INTAKE_HISTORY +NOT_LICENSED/);
    // Marked with a star as one of the newer kinds this report was built for.
    expect(result.out).toMatch(/\* COACH_ARRIVAL_SAME_COUNTRY/);
  });

  it('reports the outbound account, not the retired selector\'s', () => {
    expect(result.out).toContain('OUTBOUND DISPOSITIONS (every kind generated, and what became of it)');
    expect(result.out).toContain('not permitted in an outbound email');
    for (const retired of ['SUPPRESSED_REDUNDANT', 'BELOW_THRESHOLD', 'INTERNAL_ONLY', 'AVAILABLE EVIDENCE']) {
      expect(result.out, retired).not.toContain(retired);
    }
  });

  it('matches its recorded output', () => {
    /**
     * Re-pinned in J4 for the credentials block alone. Jacksonville opens on a
     * COACH_ARRIVAL_SAME_COUNTRY hook, which carries no position, so the
     * cross-group hold does not apply and the evidence here is unchanged.
     */
    expect(sha(result.out)).toBe('922e6a0813a1b113');
  });
});
