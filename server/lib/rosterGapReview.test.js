import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import {
  DISPOSITION, NEXT_ACTION, REVIEW_STATUS, DISPOSITIONS,
  validateReview, retryEligible, reviewStatus, allowedActionsFor,
} from '../../shared/roster/gapReview.js';

/**
 * L7K — that a person's conclusion and a machine's observation stay apart.
 *
 * The defect being guarded is a vocabulary one. Five labels travelled through
 * four stage documents as if they were one kind of thing, and they are three:
 * `NO_HOST` is a query result, `MANUAL_REVIEW` is the absence of a review, and
 * only the remaining three are conclusions a person reached.
 *
 * Nothing here touches the network, and the DB-backed cases run against a
 * throwaway database built from the real schema.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A scratch database with the real schema, and a body of code run against it. */
function inDb(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'l7k-'));
  const file = path.join(dir, 'test.sqlite');
  try {
    return JSON.parse(execFileSync('node', ['--input-type=module', '-e', `
      process.env.RECRUITMATCH_DB = ${JSON.stringify(file)};
      const { default: db } = await import('${ROOT}/server/db/client.js');
      const R = await import('${ROOT}/server/lib/rosterGapReview.js');
      const V = await import('${ROOT}/shared/roster/gapReview.js');
      void db;
      const out = await (async () => { ${body} })();
      process.stdout.write(JSON.stringify(out ?? null));
    `], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: file }, encoding: 'utf8' }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const GAP = { season: 2026, school: 'Fixture', sport: 'mens-soccer' };

/* -------------------------------------------------------------------------- */
/* The vocabulary                                                             */
/* -------------------------------------------------------------------------- */

describe('the operator vocabulary', () => {
  it('10. carries no NO_HOST — that is a query result, not a conclusion', () => {
    expect(DISPOSITIONS).not.toContain('NO_HOST');
    expect(DISPOSITIONS).toContain('SOURCE_NOT_AVAILABLE');
    // The two were used interchangeably in stage documents and are not the
    // same claim: one says nothing trustworthy to fetch FROM, the other says a
    // trusted host and nothing found ON it.
  });

  it('13. carries no MANUAL_REVIEW — needing a person is the absence of a review', () => {
    expect(DISPOSITIONS).not.toContain('MANUAL_REVIEW');
    expect(reviewStatus(null)).toBe(REVIEW_STATUS.UNREVIEWED);
    expect(reviewStatus({ disposition: DISPOSITION.SOURCE_NOT_AVAILABLE })).toBe(REVIEW_STATUS.REVIEWED);
  });

  it('is exactly three conditions, and each states what was found', () => {
    expect([...DISPOSITIONS].sort()).toEqual([
      'PROGRAMME_STATUS_QUESTION', 'SITE_TEMPORARILY_UNAVAILABLE', 'SOURCE_NOT_AVAILABLE',
    ]);
  });

  it('refuses a disposition with no evidence behind it', () => {
    const r = validateReview({
      disposition: DISPOSITION.SOURCE_NOT_AVAILABLE, nextAction: NEXT_ACTION.NONE, evidence: '  ',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/record what was seen/);
  });

  it('11. refuses a temporary condition with no date — that is a permanent block', () => {
    const r = validateReview({
      disposition: DISPOSITION.SITE_TEMPORARILY_UNAVAILABLE,
      nextAction: NEXT_ACTION.RETRY_AFTER, evidence: 'host 503s on every route',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/permanent block wearing a temporary name/);
    expect(allowedActionsFor(DISPOSITION.SITE_TEMPORARILY_UNAVAILABLE))
      .toEqual([NEXT_ACTION.RETRY_AFTER]);
  });

  it('11b. holds a temporary condition only until its date, then releases it', () => {
    const review = {
      nextAction: NEXT_ACTION.RETRY_AFTER, retryAfter: '2026-10-01T00:00:00.000Z',
    };
    expect(retryEligible(review, new Date('2026-09-17T00:00:00Z')).eligible).toBe(false);
    expect(retryEligible(review, new Date('2026-10-02T00:00:00Z')).eligible).toBe(true);
  });

  it('12. a programme-status question asks for a decision, not an acquisition', () => {
    expect(allowedActionsFor(DISPOSITION.PROGRAMME_STATUS_QUESTION))
      .toEqual([NEXT_ACTION.CONFIRM_PROGRAMME_STATUS, NEXT_ACTION.NONE]);
    expect(validateReview({
      disposition: DISPOSITION.PROGRAMME_STATUS_QUESTION,
      nextAction: NEXT_ACTION.RETRY_ACQUISITION, evidence: 'nav says Coming in 2027',
    }).ok).toBe(false);
  });

  it('never turns a disposition into a blacklist — Northwood is the reason', () => {
    // SOURCE_NOT_AVAILABLE described what was found, and L7I then acquired it
    // at candidate one. The condition may always carry a retry.
    expect(allowedActionsFor(DISPOSITION.SOURCE_NOT_AVAILABLE))
      .toContain(NEXT_ACTION.RETRY_ACQUISITION);
    expect(retryEligible({ nextAction: NEXT_ACTION.RETRY_ACQUISITION }).eligible).toBe(true);
  });

  it('8. leaves an unreviewed gap eligible rather than quietly blocking it', () => {
    expect(retryEligible(null).eligible).toBe(true);
    expect(retryEligible(null).reason).toBe('unreviewed');
  });
});

/* -------------------------------------------------------------------------- */
/* The store                                                                  */
/* -------------------------------------------------------------------------- */

describe('recording a review', () => {
  it('stores a valid review and reads it back', () => {
    const out = inDb(`
      const w = R.recordReview({ ...${JSON.stringify(GAP)},
        disposition: V.DISPOSITION.SOURCE_NOT_AVAILABLE, nextAction: V.NEXT_ACTION.RETRY_ACQUISITION,
        evidence: 'trusted host answers, no roster path found' });
      return { ok: w.ok, read: R.reviewFor(2026, 'Fixture', 'mens-soccer') };`);
    expect(out.ok).toBe(true);
    expect(out.read.disposition).toBe('SOURCE_NOT_AVAILABLE');
    expect(out.read.nextAction).toBe('RETRY_ACQUISITION');
    expect(out.read.evidence).toBe('trusted host answers, no roster path found');
    expect(out.read.reviewedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('keeps the previous conclusion when one is replaced', () => {
    const out = inDb(`
      R.recordReview({ ...${JSON.stringify(GAP)}, disposition: V.DISPOSITION.SOURCE_NOT_AVAILABLE,
        nextAction: V.NEXT_ACTION.NONE, evidence: 'first look' });
      R.recordReview({ ...${JSON.stringify(GAP)}, disposition: V.DISPOSITION.PROGRAMME_STATUS_QUESTION,
        nextAction: V.NEXT_ACTION.CONFIRM_PROGRAMME_STATUS, evidence: 'nav says coming in 2027' });
      return R.reviewFor(2026, 'Fixture', 'mens-soccer');`);
    expect(out.disposition).toBe('PROGRAMME_STATUS_QUESTION');
    expect(out.previousDisposition).toBe('SOURCE_NOT_AVAILABLE');
    expect(out.previousReviewedAt).toMatch(/^\d{4}/);
  });

  it('refuses an invalid review rather than storing something nobody concluded', () => {
    const out = inDb(`
      const w = R.recordReview({ ...${JSON.stringify(GAP)}, disposition: 'MANUAL_REVIEW',
        nextAction: V.NEXT_ACTION.NONE, evidence: 'the machine failed' });
      return { ok: w.ok, reason: w.reason, stored: R.reviewFor(2026, 'Fixture', 'mens-soccer') };`);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/unknown disposition/);
    expect(out.stored).toBe(null);
  });

  it('14. one programme cannot inherit another\'s review', () => {
    const out = inDb(`
      R.recordReview({ season: 2026, school: 'Alpha', sport: 'mens-soccer',
        disposition: V.DISPOSITION.SOURCE_NOT_AVAILABLE, nextAction: V.NEXT_ACTION.NONE, evidence: 'a' });
      return { beta: R.reviewFor(2026, 'Beta', 'mens-soccer'),
               otherSport: R.reviewFor(2026, 'Alpha', 'womens-soccer'),
               otherSeason: R.reviewFor(2027, 'Alpha', 'mens-soccer'),
               alpha: R.reviewFor(2026, 'Alpha', 'mens-soccer').disposition };`);
    expect(out.beta).toBe(null);
    expect(out.otherSport).toBe(null);
    expect(out.otherSeason).toBe(null);
    expect(out.alpha).toBe('SOURCE_NOT_AVAILABLE');
  });

  it('5/9. withdrawing a review is a deliberate act that records why', () => {
    const out = inDb(`
      R.recordReview({ ...${JSON.stringify(GAP)}, disposition: V.DISPOSITION.SOURCE_NOT_AVAILABLE,
        nextAction: V.NEXT_ACTION.RETRY_ACQUISITION, evidence: 'no source found' });
      const silent = R.withdrawReview({ ...${JSON.stringify(GAP)}, evidence: '' });
      const proper = R.withdrawReview({ ...${JSON.stringify(GAP)}, evidence: 'acquired in L7I' });
      return { silent: { ok: silent.ok, reason: silent.reason },
               proper: { ok: proper.ok, withdrew: proper.withdrew.disposition },
               after: R.reviewFor(2026, 'Fixture', 'mens-soccer') };`);
    expect(out.silent.ok).toBe(false);
    expect(out.silent.reason).toMatch(/record why/);
    expect(out.proper.ok).toBe(true);
    expect(out.proper.withdrew).toBe('SOURCE_NOT_AVAILABLE');
    expect(out.after).toBe(null);
  });

  it('1/2/3. never writes a machine field, and holds no machine vocabulary', () => {
    const out = inDb(`
      R.recordReview({ ...${JSON.stringify(GAP)}, disposition: V.DISPOSITION.SOURCE_NOT_AVAILABLE,
        nextAction: V.NEXT_ACTION.NONE, evidence: 'looked' });
      const cols = (await import('${ROOT}/server/db/client.js')).default
        .prepare('PRAGMA table_info(roster_gap_reviews)').all().map(c => c.name);
      return cols;`);
    // The machine's layers live in the pipeline's state file, not here.
    for (const machine of ['failure_class', 'err', 'stage', 'status', 'tried', 'url', 'parser']) {
      expect(out).not.toContain(machine);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Phase 19 — no product coupling                                             */
/* -------------------------------------------------------------------------- */

describe('operator review is operational metadata and nothing else', () => {
  /** Every source file in a product area, minus tests. */
  const sources = (dir, extra = []) => [
    ...fs.readdirSync(path.join(ROOT, dir))
      .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'))
      .map((f) => path.join(ROOT, dir, f)),
    ...extra.map((f) => path.join(ROOT, f)),
  ].filter((f) => fs.existsSync(f) && fs.statSync(f).isFile());

  const REVIEW = /gapReview|rosterGapReview|roster_gap_reviews|rosterGapQueue/;

  it('18/19/20. no Evidence, matching or outreach source imports it', () => {
    const offenders = [];
    for (const dir of ['shared/evidence', 'server/lib', 'server/routes', 'src/lib', 'shared/roster']) {
      for (const f of sources(dir)) {
        const base = path.basename(f);
        if (base === 'rosterGapReview.js' || base === 'gapReview.js') continue;
        const text = fs.readFileSync(f, 'utf8');
        // an IMPORT, not a mention in prose
        for (const m of text.matchAll(/^\s*import\s[^;]*?from\s*'([^']+)'/gm)) {
          if (REVIEW.test(m[1])) offenders.push(`${dir}/${base} -> ${m[1]}`);
        }
        if (/roster_gap_reviews/.test(text)) offenders.push(`${dir}/${base} queries the table`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the review modules import nothing from Evidence, matching or outreach', () => {
    const forbidden = /evidence|matching|outreach|campaign|email|philosophy/i;
    const bad = [];
    for (const f of ['shared/roster/gapReview.js', 'server/lib/rosterGapReview.js']) {
      const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
      for (const m of text.matchAll(/^\s*import\s[^;]*?from\s*'([^']+)'/gm)) {
        if (forbidden.test(m[1])) bad.push(`${f} -> ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the pipeline cannot reach the table at all', () => {
    // Physical separation, not a promise: the acquisition pipeline is Python
    // over CSV and JSON and holds no database connection, so `--reset-state`
    // has no path to a review.
    const py = fs.readdirSync(path.join(ROOT, 'tools/roster_pipeline'))
      .filter((f) => f.endsWith('.py'));
    const offenders = py.filter((f) => /roster_gap_reviews|recruitmatch\.sqlite|sqlite3/
      .test(fs.readFileSync(path.join(ROOT, 'tools/roster_pipeline', f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
