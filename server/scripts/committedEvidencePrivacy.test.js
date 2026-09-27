/**
 * Nothing this repository publishes may carry a mailbox.
 *
 * The PR #49 closure found two generated ledgers naming 6,347 coaches. Sweeping
 * every blob in every commit then found the same data in fifty-one more
 * artifacts — the Phase 4/5/6/7 evidence ledgers, currency waves and applier
 * fixtures. They were never the headline; they were the same disclosure spread
 * thinner, and the only reason they were found is that somebody looked past the
 * two files that had been named.
 *
 * This test is the thing that looks every time. It is deliberately blunt: under
 * `docs/validation/`, an address-shaped string is a finding, and the only
 * accepted forms are the redaction tokens. No allow-list, because an allow-list
 * is where the next one would hide.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = path.resolve(import.meta.dirname, '../..');
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** `coach-<id>@redacted.invalid` keeps the row link; `[withheld]@domain` keeps only the domain. */
const isToken = (a) => a.endsWith('@redacted.invalid') || a.startsWith('[withheld]@');

const tracked = (dir) => execFileSync('git', ['ls-files', dir], { cwd: REPO, encoding: 'utf8' })
  .split('\n').filter(Boolean);

describe('committed evidence carries no mailboxes', () => {
  it('finds the evidence tree it is supposed to be guarding', () => {
    // If this ever empties, every assertion below passes vacuously.
    expect(tracked('docs/validation').length).toBeGreaterThan(50);
  });

  it('no tracked file under docs/validation contains an unredacted address', () => {
    const offenders = [];
    for (const rel of tracked('docs/validation')) {
      const abs = path.join(REPO, rel);
      if (!fs.existsSync(abs)) continue;
      const hits = (fs.readFileSync(abs, 'utf8').match(EMAIL) || []).filter((a) => !isToken(a));
      // Report the DOMAIN only — a failure message must not republish what it caught.
      if (hits.length) offenders.push(`${rel}: ${hits.length} at ${[...new Set(hits.map((h) => h.split('@').pop()))].slice(0, 3).join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the redaction target list matches what is actually committed', () => {
    const list = path.join(REPO, 'docs/validation/integrity-audit/redacted_artifacts.txt');
    expect(fs.existsSync(list)).toBe(true);
    const targets = fs.readFileSync(list, 'utf8').trim().split('\n').filter(Boolean);
    expect(targets.length).toBeGreaterThan(40);
    // Every listed target must still exist, or the list has rotted.
    expect(targets.filter((t) => !fs.existsSync(path.join(REPO, t)))).toEqual([]);
  });

  it('the raw originals are not tracked', () => {
    const leaked = tracked('server/data/generated');
    expect(leaked).toEqual([]);
  });
});
