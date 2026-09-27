/**
 * PR #49 PRE-MERGE SAFETY CLOSURE — the committed coach evidence must not name
 * anybody.
 *
 * `coach_contact_ledger.csv` and `coaches_reconciled.csv` were tracked in this
 * PUBLIC repository with a name and a working email address for 6,347 real
 * people. They are now generated locally and the committed evidence is the
 * redacted pair. These tests hold both halves of that: the redactor drops what
 * it claims to drop, and the artifacts actually in the tree carry no addresses.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { redact, KEEP, parseCsv } from './redactGeneratedLedgers.js';

const REPO = path.resolve(import.meta.dirname, '../..');
const GEN = path.join(REPO, 'docs/validation/generated');
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

const sample = [
  'coach_id,coach_name,email,title,sport,legacy_school,legacy_unitid,canonical_unitid,canonical_school,'
  + 'source_url,source_domain,email_domain,classification,institution_resolution_status,coach_identity_status,'
  + 'email_verification_status,outreach_eligibility,ineligible_reason,resolution_method,evidence,reassigned,canonicalized',
  'id-1,Dana Rivers,dana.rivers@alpha.edu,Head Coach,mens-soccer,Alpha State,100,100,Alpha State,'
  + 'https://alphasports.com/staff/dana-rivers,alphasports.com,alpha.edu,KEEP,RESOLVED,VERIFIED,verified,YES,,domain,'
  + '"domain alphasports.com maps to 100",0,0',
  'id-2,Kim Oyelaran,kim@beta.edu,Assistant,mens-soccer,Beta College,200,200,Beta College,'
  + 'https://betaathletics.com/staff,betaathletics.com,beta.edu,WITHHOLD,REVIEW,UNVERIFIED,unknown,NO,no domain,name,'
  + '"filed by Kim Oyelaran on the staff page",0,0',
].join('\n') + '\n';

describe('the redactor drops exactly what it says it drops', () => {
  const { manifest, csv } = redact('coaches_reconciled.csv', sample);

  it('publishes no name, address, title or source URL', () => {
    for (const leak of ['Dana Rivers', 'dana.rivers@alpha.edu', 'Kim Oyelaran', 'kim@beta.edu',
      'Head Coach', 'Assistant', '/staff/dana-rivers']) {
      expect(csv, leak).not.toContain(leak);
    }
    expect(EMAIL.test(csv)).toBe(false);
  });

  it('keeps the row id and every decision column, so each decision stays reproducible', () => {
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual(KEEP['coaches_reconciled.csv']);
    expect(csv).toContain('id-1');
    expect(csv).toContain('id-2');
    for (const kept of ['KEEP', 'RESOLVED', 'WITHHOLD', 'alphasports.com', 'alpha.edu']) {
      expect(csv, kept).toContain(kept);
    }
  });

  it('redacts a retained free-text value that quotes a person — including one from ANOTHER row', () => {
    // Row 2's `evidence` names row 2's coach; row 1's does not. The check runs
    // every value against every identifier in the file, not just its own row's.
    expect(manifest.free_text_values_redacted_for_quoting_a_person).toBe(1);
    expect(csv).toContain('[REDACTED — quoted a person]');
    expect(csv).toContain('domain alphasports.com maps to 100');
  });

  it('records the source hash and the reason each column was dropped', () => {
    expect(manifest.source_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.source_rows).toBe(2);
    expect(Object.keys(manifest.columns_dropped).sort())
      .toEqual(['coach_name', 'email', 'source_url', 'title']);
    for (const why of Object.values(manifest.columns_dropped)) expect(why.length).toBeGreaterThan(0);
  });

  it('refuses a file that is missing a column it is supposed to publish', () => {
    expect(() => redact('coaches_reconciled.csv', 'coach_id,sport\nid-1,mens-soccer\n'))
      .toThrow(/expected columns absent/);
  });
});

describe('the artifacts actually committed to this public repository', () => {
  const committed = fs.readdirSync(GEN);

  it('do not include the raw ledgers', () => {
    expect(committed).not.toContain('coaches_reconciled.csv');
    expect(committed).not.toContain('coach_contact_ledger.csv');
  });

  it('contain no email address anywhere in docs/validation/generated', () => {
    const offenders = [];
    for (const f of committed) {
      const p = path.join(GEN, f);
      if (!fs.statSync(p).isFile()) continue;
      const text = fs.readFileSync(p, 'utf8');
      const hit = text.match(EMAIL);
      // A bare domain reference is fine; an addressable mailbox is not.
      if (hit) offenders.push(`${f}: ${hit[0].split('@')[1]}`);
    }
    expect(offenders).toEqual([]);
  });
});
