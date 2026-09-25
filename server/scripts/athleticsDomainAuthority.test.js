import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * L7 — what `athletics_domains` may be trusted for, pinned.
 *
 * No script in this repository writes this table. It arrived in one batch and
 * is read by `sourceVerification` through `verifiedDomains()`, and fingerprinted
 * by the dataset manifest. That combination — no owner, several readers, and a
 * behavioural surface downstream — is exactly where a quiet widening of the
 * trust filter would go unnoticed, so the filter and the reasons it exists are
 * asserted here rather than left as a comment on a query.
 *
 * L7 measured the table against an independent signal: the host each
 * institution's OWN 2026 rosters were actually fetched from, 1,221 programmes
 * where both are known. 1,211 agreed. Every one of the ten disagreements traced
 * to `identity_strength = 'BASE_ONLY'` — a host matched on a short base name,
 * which is how `uconnhuskies.com` came to be assigned to Connecticut College and
 * `gocobbers.com` to The Citadel. There are only eight BASE_ONLY rows in the
 * trusted set and seven are wrong; the 934 WHOLE_NAME rows produced no observed
 * error at all.
 *
 * Counts move when the registry is re-scraped, so what is pinned is the shape:
 * the filter's four conditions, that BASE_ONLY stays a rounding error rather
 * than a population, and that a WRONG_INSTITUTION row still names the true
 * owner in its own `unitid` — the property that makes those 57 rows a
 * recoverable status question rather than lost data.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DB = path.join(ROOT, 'server/data/recruitmatch.sqlite');
const HAVE_DB = fs.existsSync(DB) && fs.statSync(DB).size > 1_000_000;
const d = HAVE_DB ? describe : describe.skip;
if (!HAVE_DB) console.warn(`\n  athleticsDomainAuthority.test.js SKIPPED — no database at ${DB}\n`);

const inDb = (expr) => JSON.parse(execFileSync('node', ['--input-type=module', '-e', `
  import db from '${path.join(ROOT, 'server/db/client.js')}';
  import { verifiedDomains, registryIntegrity, auditRosterSources } from '${path.join(ROOT, 'server/scripts/rosterSourceAudit.js')}';
  void verifiedDomains; void registryIntegrity; void auditRosterSources; void db;
  process.stdout.write(JSON.stringify(${expr}));
`], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: DB }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));

const sql = (q) => inDb(`db.prepare(\`${q}\`).all()`);

d('the trust filter is the trust model', () => {
  it('follows only VERIFIED athletics hosts with an institution id', () => {
    const [{ trusted }] = sql(`SELECT COUNT(*) trusted FROM athletics_domains
      WHERE status IN ('VERIFIED','VERIFIED_ALIAS') AND role = 'ATHLETICS_SITE'
        AND confidence IN ('CERTAIN','CORROBORATED') AND unitid IS NOT NULL`);
    expect(inDb('verifiedDomains().size')).toBeLessThanOrEqual(trusted);
    // www. collapses, so the map may be smaller than the row count; never larger.
    expect(inDb('verifiedDomains().size')).toBeGreaterThan(500);
  });

  /*
   * `verifiedDomains` is keyed by canonical host, which collapses `www.`. Ten
   * excluded rows therefore share a key with a trusted twin — nine of them
   * because the crawler identified one spelling and not the other, leaving
   * `unitid` null on the excluded side. That collapse is deliberate and right;
   * what must never happen is a collapse that changes WHO a host belongs to.
   */
  it('never lets a www. spelling change which institution a host belongs to', () => {
    const rows = sql(`SELECT domain, unitid FROM athletics_domains WHERE unitid IS NOT NULL`);
    const byHost = new Map();
    for (const r of rows) {
      const h = r.domain.replace(/^www\./, '').toLowerCase();
      if (!byHost.has(h)) byHost.set(h, new Set());
      byHost.get(h).add(r.unitid);
    }
    const contested = [...byHost].filter(([, ids]) => ids.size > 1).map(([h]) => h);
    expect(contested).toEqual([]);
  });

  it.each([
    ['a guessed host', `status = 'INSUFFICIENT_EVIDENCE'`],
    ['the university\'s own site rather than its athletics site', `role = 'INSTITUTION_SITE'`],
    ['a host whose identity is contested', `status = 'AMBIGUOUS'`],
    ['a host that never answered', `status = 'UNREACHABLE'`],
  ])('does not follow %s on its own evidence', (_label, where) => {
    // Excluded on its own row. A twin spelling may still be followed, which the
    // test above proves cannot move the institution.
    const rows = sql(`SELECT domain FROM athletics_domains a WHERE ${where}
      AND NOT EXISTS (SELECT 1 FROM athletics_domains b
        WHERE replace(lower(b.domain),'www.','') = replace(lower(a.domain),'www.','')
          AND b.domain <> a.domain AND b.status IN ('VERIFIED','VERIFIED_ALIAS')
          AND b.role = 'ATHLETICS_SITE' AND b.confidence IN ('CERTAIN','CORROBORATED')
          AND b.unitid IS NOT NULL)`);
    expect(rows.length).toBeGreaterThan(0);   // the case exists to be excluded
    const followed = inDb(`(() => { const m = verifiedDomains();
      return ${JSON.stringify(rows.map((r) => r.domain))}.filter((h) => m.has(h.replace(/^www\./, ''))).length; })()`);
    expect(followed).toBe(0);
  });
});

d('identity strength is what separates the good rows from the bad', () => {
  it('matches whole names, not short bases', () => {
    const [{ whole, base }] = sql(`SELECT
        SUM(identity_strength = 'WHOLE_NAME') whole, SUM(identity_strength = 'BASE_ONLY') base
      FROM athletics_domains WHERE status IN ('VERIFIED','VERIFIED_ALIAS') AND role = 'ATHLETICS_SITE'
        AND confidence IN ('CERTAIN','CORROBORATED') AND unitid IS NOT NULL`);
    expect(whole).toBeGreaterThan(800);
    // Seven of the eight L7 measured were wrong. This is the guard against a
    // future import deciding a short base name is good enough at scale.
    expect(base).toBeLessThan(25);
  });

  it('refuses a base-name assignment as a source for the programme claiming it', () => {
    /*
     * Two checks stand between these hosts and an operator link, and which one
     * fires depends on the case: `registryIntegrity` refuses an assignment the
     * assigned institution's own rosters never corroborate, and the unitid
     * comparison in `verifyRosterSource` refuses the rest. What matters to the
     * product is only that none is ever offered, so the assertion is made on
     * the audit's own output: each must appear in the quarantine with a reason,
     * for both sports.
     */
    const bad = ['uconnhuskies.com', 'gocobbers.com', 'umassathletics.com',
      'tommiesports.com', 'redstormsports.com', 'westminstergriffins.com'];
    const q = ['mens-soccer', 'womens-soccer'].flatMap((sport) =>
      inDb(`auditRosterSources({ season: '2026', sport: '${sport}' }).quarantine`));
    const refused = new Map(q.map((x) => [x.host, x.reason]));
    for (const host of bad) {
      expect(refused.get(host), `${host} must be quarantined with a reason`)
        .toBe('INSTITUTION_MISMATCH');
    }
  });
});

d('a wrong mapping is not a wrong host', () => {
  it('still names the true owner in unitid', () => {
    // WRONG_INSTITUTION records that some school CLAIMED this host and was
    // wrong. The row's own unitid is who the page said it was, established the
    // same way a VERIFIED row's is. No row lists its own unitid among the bad
    // claimants — which is why these 57 are a status question and not a data
    // gap, and why the audit could recover uwlathletics.com for La Crosse.
    const [{ selfBlamed }] = sql(`SELECT COUNT(*) selfBlamed FROM athletics_domains a
      WHERE a.status = 'WRONG_INSTITUTION' AND a.unitid IS NOT NULL
        AND EXISTS (SELECT 1 FROM json_each(a.wrong_mappings) w
                    WHERE json_extract(w.value, '$.claimantUnitid') = a.unitid)`);
    expect(selfBlamed).toBe(0);
  });

  it('is nonetheless excluded from the trusted set today', () => {
    const rows = sql(`SELECT domain FROM athletics_domains a WHERE a.status = 'WRONG_INSTITUTION'
      AND NOT EXISTS (SELECT 1 FROM athletics_domains b
        WHERE replace(lower(b.domain),'www.','') = replace(lower(a.domain),'www.','')
          AND b.domain <> a.domain AND b.status IN ('VERIFIED','VERIFIED_ALIAS'))`);
    expect(rows.length).toBeGreaterThan(0);
    const followed = inDb(`(() => { const m = verifiedDomains();
      return ${JSON.stringify(rows.map((r) => r.domain))}.filter((h) => m.has(h.replace(/^www\\./, ''))).length; })()`);
    expect(followed).toBe(0);
  });
});
