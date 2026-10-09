/**
 * `main` published 1,947 real head-coach email addresses and 2,033 names for
 * years, in two generated CSVs that no code reads. They were copied into git
 * once and never looked at again.
 *
 * These tests hold the rule that replaces looking: no real person's contact
 * details in any tracked file, enforced by shape rather than by a list of the
 * files that were already wrong. The cases below are mostly about the rule's
 * EDGES, because a privacy check that only proves the happy path is a check
 * that will be quietly weakened later.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  scanText, scanRepo, trackedFiles, isAlwaysAllowed, allowsFixtures,
  ALLOWED_FIXTURE_ADDRESSES, OWNED_DOMAINS, EMAIL_RX,
} from './committedPiiScan.js';
import { parseCsv } from './redactUniversityCoachPii.js';

const REPO = path.resolve(import.meta.dirname, '../..');

describe('protocol identifiers are not mailboxes', () => {
  it('allows OpenSSH key-type names, never a person at openssh.com', () => {
    expect(isAlwaysAllowed('sk-ssh-ed25519@openssh.com')).toBe(true);
    expect(isAlwaysAllowed('ssh-ed25519-cert-v01@openssh.com')).toBe(true);
    // built at run time so this file does not itself commit a mailbox-shaped string
    expect(isAlwaysAllowed(['damien', 'openssh.com'].join('@'))).toBe(false);
    expect(isAlwaysAllowed(['ssh', 'openssh.com'].join('@'))).toBe(false);
  });
});

describe('the repository as it stands', () => {
  it('is actually scanning something', () => {
    // Guards against a broken glob turning every assertion below vacuous.
    expect(trackedFiles(REPO).length).toBeGreaterThan(500);
  });

  it('contains no unapproved contact addresses anywhere', () => {
    const findings = scanRepo(REPO).map((f) => `${f.file} (${f.domains.join(', ')})`);
    expect(findings).toEqual([]);
  });

  it('keeps the head-coach PII columns empty in the university CSVs', () => {
    // Named here as a REGRESSION case, not as the rule — the rule is above.
    for (const s of ['mens', 'womens']) {
      const p = path.join(REPO, `data/university-individualisation/${s}_soccer_universities.csv`);
      if (!fs.existsSync(p)) continue;
      const text = fs.readFileSync(p, 'utf8');
      expect((text.match(EMAIL_RX) || []).filter((a) => !isAlwaysAllowed(a)), s).toEqual([]);
      // A real CSV parse, not split(','): these rows carry quoted commas, and a
      // naive split shifts the column index and reports a name that is not there.
      const rows = parseCsv(text);
      const header = rows[0];
      const nameCol = header.indexOf('head_coach');
      expect(nameCol, `${s}: head_coach column`).toBeGreaterThan(-1);
      const body = rows.slice(1).filter((r) => r.length === header.length);
      expect(body.length, `${s}: rows`).toBeGreaterThan(1000);
      const filledNames = body.filter((r) => (r[nameCol] || '').trim() !== '').length;
      expect(filledNames, `${s}: head_coach values`).toBe(0);
    }
  });
});

describe('what the rule allows', () => {
  it('allows reserved and placeholder domains', () => {
    for (const a of ['x@example.com', 'a@thing.test', 'b@foo.invalid', 'c@x.edu', 'd@school.edu', 'e@alpha.edu']) {
      expect(isAlwaysAllowed(a), a).toBe(true);
    }
  });

  it('allows the redaction tokens, so redacted evidence is not re-flagged', () => {
    expect(isAlwaysAllowed('coach-abc-123@redacted.invalid')).toBe(true);
    expect(isAlwaysAllowed('[withheld]@csulb.edu')).toBe(true);
  });

  it('allows domains we own', () => {
    for (const d of OWNED_DOMAINS) expect(isAlwaysAllowed(`someone@${d}`), d).toBe(true);
  });
});

describe('what the rule refuses', () => {
  /**
   * Built from parts, never written out.
   *
   * This file has to feed the scanner addresses it must reject — and the
   * scanner reads every tracked file, including this one. Writing the literals
   * here would make the suite fail on its own fixtures, and the tempting fix
   * (an exception for this path) is exactly the hole the register is designed
   * not to have. Assembling them at runtime keeps the rule absolute.
   */
  const addr = (local, domain) => `${local}@${domain}`;

  it('flags a real-looking address in a source file that is not registered', () => {
    const f = scanText('server/lib/thing.js', `const c = "${addr('jane.doe', 'stanford.edu')}";`);
    expect(f).toHaveLength(1);
    expect(f[0].domain).toBe('stanford.edu');
  });

  it('gives data/ and docs/ NO fixture exception, even for a registered address', () => {
    const registered = [...ALLOWED_FIXTURE_ADDRESSES][0];
    expect(scanText('server/lib/x.test.js', registered)).toEqual([]);
    for (const p of ['data/whatever.csv', 'docs/notes.md']) {
      expect(scanText(p, registered), p).toHaveLength(1);
    }
  });

  it('gives generated artifact directories no exception either, wherever they sit', () => {
    const registered = [...ALLOWED_FIXTURE_ADDRESSES][0];
    for (const p of ['server/generated/out.json', 'tools/x/__baselines__/b.json', 'a/fixtures/c.json']) {
      expect(allowsFixtures(p), p).toBe(false);
      expect(scanText(p, registered), p).toHaveLength(1);
    }
  });

  it('reports every distinct address in a file, and counts a repeat once', () => {
    const many = [addr('a', 'real-one.edu'), addr('b', 'real-two.edu'),
      addr('c', 'real-one.edu'), addr('a', 'real-one.edu')].join('\n');
    // Three distinct mailboxes; the duplicate of the first is not counted twice.
    expect(scanText('server/x.js', many)).toHaveLength(3);
  });

  it('never returns the address itself, only the domain', () => {
    const local = 'verysecret.person';
    const f = scanText('data/x.csv', addr(local, 'realschool.edu'));
    expect(JSON.stringify(f)).not.toContain(local);
    expect(f[0].domain).toBe('realschool.edu');
  });
});

describe('the fixture register cannot become a hiding place', () => {
  it('every entry is a synthetic local part, not a person', () => {
    // A register entry is a claim that the mailbox is invented. `first.last@`
    // is what a real address looks like, so it may not appear here.
    const personish = [...ALLOWED_FIXTURE_ADDRESSES]
      .map((a) => a.split('@')[0])
      .filter((l) => /^[a-z]{3,}\.[a-z]{3,}$/.test(l) && !l.startsWith('john.smith'));
    expect(personish).toEqual([]);
  });

  it('stays small enough to review by eye', () => {
    expect(ALLOWED_FIXTURE_ADDRESSES.size).toBeLessThan(120);
  });
});
