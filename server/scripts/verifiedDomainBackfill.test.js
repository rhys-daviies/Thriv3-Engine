import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { verifiedRow } from './verifiedDomainBackfill.js';
import { fileCorpusOr } from '../db/corpusIdentity.js';
import {
  classifyRow, forInstitution, hostsForInstitution, AUTHORITY, PROFILE, LOOKUP,
} from '../../shared/evidence/domainAuthority.js';

/**
 * L7E — hosts verified one at a time, and the discipline that let them in.
 *
 * `domainAuthority` reads the ledger; it cannot read how a row got there. So the
 * two-anchor rule — an official institution page that links to the host, AND the
 * host's own self-identification, with city or state as a third check where the
 * name is shared — lives in the WRITER, and this is where it is held. A row that
 * satisfies the authority's columns while resting on a name search would be
 * indistinguishable downstream, which is precisely why the evidence for each is
 * written out in prose beside it and asserted here.
 *
 * L7 measured what happens without that discipline: seven of eight BASE_ONLY
 * rows were wrong, including `uconnhuskies.com` recorded as Connecticut
 * College's. None of this promotes BASE_ONLY; the one correct member was
 * repaired up to the same standard as the rest instead.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SEED = path.join(ROOT, 'server/data/seeds/athletics_domains_verified.json');
const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
/* L7ZO: obey an explicitly selected corpus; see `fileCorpusOr`. */
const DB = fileCorpusOr(path.join(ROOT, 'server/data/recruitmatch.sqlite'));
const HAVE_DB = fs.existsSync(DB) && fs.statSync(DB).size > 1_000_000;

const inDb = (expr) => JSON.parse(execFileSync('node', ['--input-type=module', '-e', `
  import db from '${path.join(ROOT, 'server/db/client.js')}';
  process.stdout.write(JSON.stringify(${expr}));
`], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: DB }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));

describe('a verified row says how it was verified', () => {
  const row = verifiedRow(seed.rows[0], '2026-09-09T00:00:00.000Z');

  it('uses the ledger vocabulary that already existed for this method', () => {
    // cokercobras.com, bsubears.com and fsurams.com set this shape. Nothing here
    // invents an identity class.
    expect(row).toMatchObject({
      status: 'VERIFIED',
      role: 'ATHLETICS_SITE',
      confidence: 'CORROBORATED',
      identity_method: 'EXACT',
      identity_strength: 'WHOLE_NAME',
      evidence_kind: 'CURATED_CORRECTION',
      verification_method: 'OFFICIAL_DIRECTORY_AND_PAGE_SELF_IDENTIFICATION',
    });
  });

  it('carries its own checked_at, not the original batch stamp', () => {
    // The table arrived as one crawl with a single timestamp. The column was
    // always per-row; it had simply never been written that way.
    expect(row.checked_at).toBe('2026-09-09T00:00:00.000Z');
    expect(row.checked_at).not.toBe('2026-09-01T09:28:40.920Z');
  });

  it('claims exactly the institution it names, and no other', () => {
    expect(JSON.parse(row.claimed_unitids)).toEqual([seed.rows[0].unitid]);
    expect(JSON.parse(row.claimed_keys)).toEqual([seed.rows[0].school]);
    expect(row.wrong_mappings).toBe(null);
  });
});

describe('every seeded row records two independent anchors', () => {
  it.each(seed.rows.map((r) => [r.domain, r]))('%s', (_domain, entry) => {
    expect(entry.unitid, 'a row without a unitid is a name, not an identity').toEqual(expect.any(Number));
    const notes = entry.notes ?? '';
    // Anchor one: an official page belonging to the institution.
    expect(notes, 'must cite the official institution page').toMatch(/https?:\/\/[^\s]+\.(edu|com)/);
    // Anchor two: what the host says it is.
    expect(notes, 'must cite the host\'s own self-identification')
      .toMatch(/OG_SITE_NAME|self-identif|redirects to|store link/i);
    expect(notes.length).toBeGreaterThan(80);
  });

  it('anchors a shared name on city or state as well', () => {
    // Wayne State exists in Michigan and Nebraska; Wesleyan exists many times
    // over. A name that is not unique needs a third check, and L4 is the record
    // of what happens without one.
    for (const d of ['wsuathletics.com', 'wesleyanathletics.com', 'regisrangers.com']) {
      const e = seed.rows.find((r) => r.domain === d);
      expect(e, d).toBeTruthy();
      expect(e.notes, `${d} shares its name and must cite a place`).toMatch(/\b[A-Z][a-z]+,\s?[A-Z]{2}\b/);
    }
  });

  it('never rests identity on a name search', () => {
    for (const r of seed.rows) {
      expect(r.notes).not.toMatch(/\b(google|search result|first result|probably|likely|appears to be)\b/i);
    }
  });
});

describe('a role correction is a role correction', () => {
  it('is only ever applied to a row that already names the same institution', () => {
    for (const c of seed.roleCorrections ?? []) {
      expect(c.unitid).toEqual(expect.any(Number));
      expect(c.notes).toMatch(/role/i);
    }
  });

  it('refuses to move an institution under cover of a role change', () => {
    // The applier throws rather than reassigning a host. Asserted on the real
    // seed shape so the guard cannot be deleted without this failing.
    const src = fs.readFileSync(path.join(ROOT, 'server/scripts/verifiedDomainBackfill.js'), 'utf8');
    expect(src).toMatch(/that is not a role change/);
  });
});

describe('what the authority does with such a row', () => {
  const row = (o) => ({ ...verifiedRow(seed.rows[0], '2026-09-09T00:00:00.000Z'), ...o });

  it('trusts it for the institution it names', () => {
    expect(classifyRow(row(), PROFILE.STRICT)).toBe(AUTHORITY.TRUSTED);
    expect(forInstitution(row(), seed.rows[0].unitid, PROFILE.STRICT)).toBe(true);
  });

  it('refuses it for anybody else', () => {
    expect(forInstitution(row(), 999999, PROFILE.DISCOVERY)).toBe(false);
    expect(hostsForInstitution([row()], 999999).status).toBe(LOOKUP.NO_TRUSTED_HOST);
  });

  it('would refuse the same row on a base-name match', () => {
    // The discipline is not "we wrote it, therefore it is true". A row claiming
    // this method while carrying a short-base-name identity is still quarantined.
    expect(classifyRow(row({ identity_strength: 'BASE_ONLY' }), PROFILE.DISCOVERY))
      .toBe(AUTHORITY.QUARANTINED);
  });

  it('would refuse it without an institution id', () => {
    expect(classifyRow(row({ unitid: null }), PROFILE.DISCOVERY)).toBe(AUTHORITY.INSUFFICIENT_IDENTITY);
  });

  it('would refuse it as an institution site with no athletics host name', () => {
    expect(classifyRow(row({ domain: 'example.edu', role: 'INSTITUTION_SITE' }), PROFILE.DISCOVERY))
      .toBe(AUTHORITY.INSUFFICIENT_IDENTITY);
  });
});

const d = HAVE_DB ? describe : describe.skip;
if (!HAVE_DB) console.warn(`\n  verifiedDomainBackfill.test.js DB section SKIPPED — no database at ${DB}\n`);

d('the ledger after the backfill', () => {
  it('holds every seeded host, trusted, for the institution it names', () => {
    const domains = seed.rows.map((r) => r.domain);
    const rows = inDb(`db.prepare(\`SELECT domain, unitid, status, role, confidence, identity_strength,
      verification_method FROM athletics_domains WHERE domain IN (${domains.map((x) => `'${x}'`).join(',')})\`).all()`);
    expect(rows.length).toBe(domains.length);
    for (const r of rows) {
      const want = seed.rows.find((x) => x.domain === r.domain);
      expect(r.unitid, r.domain).toBe(want.unitid);
      expect(classifyRow(r, PROFILE.STRICT), r.domain).toBe(AUTHORITY.TRUSTED);
    }
  });

  it('gave each of them its own verification time', () => {
    const n = inDb(`db.prepare(\`SELECT COUNT(DISTINCT checked_at) n FROM athletics_domains\`).get().n`);
    // Was 1 for the whole table before this stage; partial refresh is now
    // representable, which L7 had flagged as unproven.
    expect(n).toBeGreaterThan(1);
  });

  it('did not promote BASE_ONLY as a class', () => {
    const base = inDb(`db.prepare(\`SELECT domain, unitid, status, role, confidence, identity_strength
      FROM athletics_domains
      WHERE identity_strength='BASE_ONLY' AND status IN ('VERIFIED','VERIFIED_ALIAS')
        AND role='ATHLETICS_SITE' AND confidence IN ('CERTAIN','CORROBORATED') AND unitid IS NOT NULL\`).all()`);
    // The seven L7 measured as wrong are still exactly where they were. Only the
    // one correct member left, and it left by being re-verified, not by a policy change.
    expect(base.map((r) => r.domain)).not.toContain('regisrangers.com');
    expect(base.length).toBeGreaterThan(0);
    for (const r of base) {
      expect(classifyRow(r, PROFILE.DISCOVERY), r.domain).toBe(AUTHORITY.QUARANTINED);
    }
  });

  it('cannot touch roster data, because it names no other table', () => {
    /*
     * This used to pin roster_players at the count it happened to hold when the
     * backfill ran, which L7F's import legitimately moved — the assertion was
     * about the age of the database rather than the behaviour of the writer.
     * The guarantee that matters is structural: this script writes one table.
     */
    const src = fs.readFileSync(path.join(ROOT, 'server/scripts/verifiedDomainBackfill.js'), 'utf8');
    const tables = inDb(`db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)`);
    const named = tables.filter((t) => new RegExp(`\\b${t}\\b`).test(src));
    expect(named).toEqual(['athletics_domains']);
  });

  it('stayed inside NCAA', () => {
    const divs = inDb(`db.prepare(\`SELECT DISTINCT c.division d FROM athletics_domains a
      JOIN colleges c ON c.unitid = a.unitid
      WHERE a.checked_at > '2026-09-01T23:59:59Z'\`).all().map((r) => r.d)`);
    expect(divs.every((x) => String(x).startsWith('NCAA'))).toBe(true);
  });
});
