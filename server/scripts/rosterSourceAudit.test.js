import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { workingCorpusCopy } from '../testCorpus.js';

/**
 * The data-repair queue, protected.
 *
 * 74% of 2026 men's programmes can offer an operator a roster page. The other
 * 26% is not noise to be tolerated — it is 215 programme-seasons with a
 * recorded reason, and this test keeps the reasons honest so the queue stays
 * actionable rather than becoming a number nobody reads.
 *
 * Counts are asserted as RANGES, not exact values: a roster import or a
 * domain-registry check legitimately moves them, and a test that failed on
 * every scrape would be turned off within a month. What is pinned exactly is
 * the shape — every programme-season gets a reason, the reasons are the ones
 * the verifier can emit, and the known-bad cases stay classified as bad.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DB = workingCorpusCopy('rosterSourceAudit');
const HAVE_DB = fs.existsSync(DB) && fs.statSync(DB).size > 1_000_000;
const d = HAVE_DB ? describe : describe.skip;
if (!HAVE_DB) console.warn(`\n  rosterSourceAudit.test.js SKIPPED — no database at ${DB}\n`);

// DI-08: a skipped describe still runs its body; without a corpus, spawn nothing (RECRUITMATCH_DB would be the string 'null', which used to create ./null and now refuses).
const inDb = (expr) => (HAVE_DB ? inDbOnCorpus(expr) : null);
const inDbOnCorpus = (expr) => JSON.parse(execFileSync('node', ['--input-type=module', '-e', `
  import db from '${path.join(ROOT, 'server/db/client.js')}';
  import { auditRosterSources, institutionsWithSeveralSites, registryIntegrity, verifiedDomains }
    from '${path.join(ROOT, 'server/scripts/rosterSourceAudit.js')}';
  import { verifyRosterSource } from '${path.join(ROOT, 'shared/evidence/sourceVerification.js')}';
  void auditRosterSources; void institutionsWithSeveralSites; void registryIntegrity; void verifiedDomains; void verifyRosterSource; void db;
  process.stdout.write(JSON.stringify(${expr}));
`], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: DB }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));

const audit = (season = '2026') => inDb(`auditRosterSources({ season: '${season}' })`);
const institutionsWithSeveralSites = () => inDb('institutionsWithSeveralSites()');
const integrityStates = () => inDb(`(() => {
  const n = {}; for (const v of registryIntegrity().values()) n[v.state] = (n[v.state] ?? 0) + 1; return n;
})()`);
const sql = (q) => inDb(`db.prepare(\`${q}\`).all()`);

d('the roster-source audit', () => {
  const r = audit();

  it('reaches every programme-season with a roster', () => {
    expect(r.total).toBeGreaterThan(700);
    const counted = Object.values(r.counts).reduce((a, b) => a + b, 0);
    // No programme-season falls through unclassified.
    expect(counted).toBe(r.total);
    expect(r.quarantine.length).toBe(r.total - r.counts.VERIFIED_DIRECT);
  });

  it('can link roughly three programmes in four', () => {
    const pct = 100 * r.counts.VERIFIED_DIRECT / r.total;
    expect(pct).toBeGreaterThan(65);
    expect(pct).toBeLessThan(90);
  });

  it('names a reason for every programme it cannot link', () => {
    const REASONS = ['MISSING', 'MALFORMED', 'PLAYER_BIO', 'OTHER_SHAPE',
      'UNVERIFIED_HOST', 'INSTITUTION_MISMATCH', 'UNKNOWN_INSTITUTION'];
    expect(r.quarantine.length).toBeGreaterThan(0);
    for (const q of r.quarantine) {
      expect(REASONS, `${q.programme} ${q.reason}`).toContain(q.reason);
      expect(q.programme).toBeTruthy();
      expect(q.season).toBe('2026');
    }
  });

  it('has cleared the institution-id disagreements, and still names both ids if one returns', () => {
    /**
     * There were ten, six of which named the right school while carrying a
     * different `unitid` — uconnhuskies.com claimed "UConn" against 128902 while
     * the college row said 129020. Phase 2D corrected all of them against
     * external ground truth (docs/validation/integrity-audit), so the
     * INSTITUTION_MISMATCH class is empty today. The guard now pins the CLEARED
     * state: UConn resolves correctly rather than as a disagreement, and any
     * mismatch that ever returns must still carry both ids so the repair is
     * understood to be an id, not a bad link.
     */
    const mismatch = r.quarantine.filter((q) => q.reason === 'INSTITUTION_MISMATCH');
    expect(mismatch.length).toBeLessThan(40);
    for (const q of mismatch) {
      expect(q.hostBelongsTo, q.programme).toBeTruthy();
      expect(q.expectedUnitid, q.programme).toBeTruthy();
      expect(q.hostBelongsTo, q.programme).not.toBe(q.expectedUnitid);
    }
    expect(mismatch.map((q) => q.programme)).not.toContain('UConn');
  });

  it('keeps the unverified hosts the largest group, and them alone', () => {
    // The bulk of the queue is domains nobody has checked — an absence, not a
    // defect. If a different reason ever overtakes it, something broke.
    const biggest = Object.entries(r.counts)
      .filter(([k]) => k !== 'VERIFIED_DIRECT')
      .sort((a, b) => b[1] - a[1])[0];
    expect(biggest[0]).toBe('UNVERIFIED_HOST');
  });

  it('no longer flags the corrected cross-institution registry defect', () => {
    /**
     * H15 traced all ten institution-id disagreements to one cause: the
     * verification pipeline matched each site's own title to a similarly-named
     * institution. The Citadel was recorded as owning Concordia Moorhead's
     * (gocobbers.com) and Suffolk's (gosuffolkrams.com) athletics sites;
     * Connecticut College owned UConn's; Saint John Fisher owned St. John's.
     *
     * Phase 2D corrected every one against external ground truth, so the
     * institutions that still legitimately hold several hosts are merged or
     * dual-brand schools, not cross-institution contamination. Asserted as a
     * bounded floor, plus the specific proof that The Citadel's stamping is
     * gone and must not reappear.
     */
    const several = institutionsWithSeveralSites();
    expect(several.length).toBeGreaterThan(0);
    expect(several.length).toBeLessThan(80);
    for (const s of several) {
      expect(s.hosts.length, String(s.unitid)).toBeGreaterThan(1);
      expect(new Set(s.hosts).size, String(s.unitid)).toBe(s.hosts.length);
    }
    // The Citadel's cross-institution stamping (gocobbers.com + gosuffolkrams.com)
    // was the case with no innocent explanation; Phase 2D fixed it.
    expect(several.find((s) => s.unitid === 217864), 'The Citadel defect must stay fixed').toBeFalsy();
  });

  it('collapses www and a port, but never a subdomain', () => {
    // `www.kstatesports.com` and `kstatesports.com:443` are one host; a
    // subdomain like `timberwolves.gonorthwood.com` is a different one, and
    // collapsing it would hide a real second site.
    const several = institutionsWithSeveralSites();
    for (const s of several) {
      for (const h of s.hosts) {
        expect(h, h).not.toMatch(/^www\./);
        expect(h, h).not.toMatch(/:\d+$/);
      }
    }
  });

  it('refuses the known player-bio and wrong-school rows in earlier seasons', () => {
    // Stonehill 2025 -> stantonelks.com, the case H11 found: a player bio on
    // another school's site. It must never be linkable.
    const y2025 = audit('2025');
    const stonehill = y2025.quarantine.find((q) => q.programme === 'Stonehill');
    expect(stonehill, 'Stonehill 2025 must be quarantined').toBeTruthy();
    expect(['PLAYER_BIO', 'INSTITUTION_MISMATCH', 'UNVERIFIED_HOST']).toContain(stonehill.reason);
    expect(y2025.counts.PLAYER_BIO).toBeGreaterThan(0);
  });
});

/**
 * The registry's contradictions, measured against the live registry.
 *
 * The unit tests fix the RULE on fixtures. These fix what the rule currently
 * finds — so that a re-scrape which quietly changes the registry's shape
 * arrives as a failing test and a decision, rather than as a silent movement
 * in how many links an operator is offered.
 */
d('registry integrity, against the real registry', () => {
  const states = integrityStates();

  it('classifies every trusted host into exactly one state', () => {
    const total = Object.values(states).reduce((a, b) => a + b, 0);
    const hosts = sql('SELECT COUNT(*) n FROM athletics_domains'
      + " WHERE status IN ('VERIFIED','VERIFIED_ALIAS') AND role = 'ATHLETICS_SITE'"
      + " AND confidence IN ('CERTAIN','CORROBORATED') AND unitid IS NOT NULL")[0].n;
    // Hosts collapse on www/port, so classified <= rows; nothing may be dropped.
    expect(total).toBeGreaterThan(800);
    expect(total).toBeLessThanOrEqual(hosts);
  });

  it('finds the great majority clean, and a small minority refused', () => {
    const total = Object.values(states).reduce((a, b) => a + b, 0);
    expect(states.CLEAN / total).toBeGreaterThan(0.9);
    expect(states.MULTI_SITE_UNCORROBORATED ?? 0).toBeGreaterThan(0);
    expect(states.MULTI_SITE_UNCORROBORATED ?? 0).toBeLessThan(60);
  });

  it('has no host two institutions are both trusted to own', () => {
    // Zero today. Asserted rather than assumed: the classifier refuses such a
    // host, and this is the tripwire that tells us the class stopped being
    // empty instead of leaving it to be noticed in a link.
    expect(states.SHARED_HOST_CONFLICT ?? 0).toBe(0);
  });

  it('trusts a domain whose own mapping was contradicted only after a protected correction, and still refuses the claimant', () => {
    /**
     * `wrong_mappings` records a REJECTED CLAIMANT, not a doubt about the
     * row's own id — `gocolumbialions.com` carries Columbia University's
     * unitid and a refused claim from Columbia (MO). Such rows were all marked
     * WRONG_INSTITUTION, so the trust filter excluded them.
     *
     * Phase 8C.5D decided what a contradicted claim means once its row is
     * trusted: the host is authority for its own unitid and refused for every
     * claimant it lists. The only way such a row reaches trust is an approved
     * protected correction (`integrity:protected-correct`), which keeps
     * `wrong_mappings` and appends PROTECTED_CORRECTION provenance to `notes`.
     *
     * So this still fails on any contradicted row that reaches trust WITHOUT
     * that adjudication, and on any corrected row the gate would hand to a
     * refused claimant or withhold from its owner.
     */
    const rows = inDb(`(() => {
      const domains = verifiedDomains(); const integrity = registryIntegrity();
      const gate = (domain, unitid) => verifyRosterSource({ url: 'https://' + domain + '/sports/mens-soccer/roster', unitid, season: '2026', urlSeason: '2026', verifiedDomains: domains, registryIntegrity: integrity }).status;
      return db.prepare("SELECT domain, unitid, wrong_mappings, notes FROM athletics_domains"
        + " WHERE wrong_mappings IS NOT NULL AND wrong_mappings NOT IN ('','[]')"
        + " AND status IN ('VERIFIED','VERIFIED_ALIAS') AND role = 'ATHLETICS_SITE'"
        + " AND confidence IN ('CERTAIN','CORROBORATED') AND unitid IS NOT NULL").all()
        .map((r) => ({ domain: r.domain, adjudicated: /(^|\\| )PROTECTED_CORRECTION /.test(r.notes ?? ''),
          owner: gate(r.domain, r.unitid), claimants: JSON.parse(r.wrong_mappings).map((m) => gate(r.domain, m.claimantUnitid)) }));
    })()`);
    expect(rows.filter((r) => !r.adjudicated).map((r) => r.domain)).toEqual([]);
    for (const r of rows) {
      expect(r.owner).toBe('VERIFIED_DIRECT');
      expect(r.claimants.length).toBeGreaterThan(0);
      for (const c of r.claimants) expect(c).not.toBe('VERIFIED_DIRECT');
    }
  });

  it('refuses a source on a host, without moving what it can already link', () => {
    // The refused hosts are by definition ones their own institution's rosters
    // never point at, so today the gate removes nothing. It is a guard against
    // the next bad assignment, and its cost must stay zero until then.
    const r = audit();
    expect(r.counts.REGISTRY_CONFLICT ?? 0).toBe(0);
    expect(100 * r.counts.VERIFIED_DIRECT / r.total).toBeGreaterThan(70);
  });
});
