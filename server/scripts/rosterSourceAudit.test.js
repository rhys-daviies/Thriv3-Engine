import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

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
const DB = path.join(ROOT, 'server/data/recruitmatch.sqlite');
const HAVE_DB = fs.existsSync(DB) && fs.statSync(DB).size > 1_000_000;
const d = HAVE_DB ? describe : describe.skip;
if (!HAVE_DB) console.warn(`\n  rosterSourceAudit.test.js SKIPPED — no database at ${DB}\n`);

const inDb = (expr) => JSON.parse(execFileSync('node', ['--input-type=module', '-e', `
  import { auditRosterSources, institutionsWithSeveralSites } from '${path.join(ROOT, 'server/scripts/rosterSourceAudit.js')}';
  void auditRosterSources; void institutionsWithSeveralSites;
  process.stdout.write(JSON.stringify(${expr}));
`], { cwd: ROOT, env: { ...process.env, RECRUITMATCH_DB: DB }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));

const audit = (season = '2026') => inDb(`auditRosterSources({ season: '${season}' })`);
const institutionsWithSeveralSites = () => inDb('institutionsWithSeveralSites()');

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

  it('still finds the institution-id disagreements, with both ids', () => {
    /**
     * Ten of them, and six name the right school while carrying a different
     * `unitid` — uconnhuskies.com claims "UConn" and 128902 against the college
     * row's 129020. The repair is an id, not a URL, and the report has to say
     * so or somebody will go looking for a bad link.
     */
    const mismatch = r.quarantine.filter((q) => q.reason === 'INSTITUTION_MISMATCH');
    expect(mismatch.length).toBeGreaterThan(0);
    expect(mismatch.length).toBeLessThan(40);
    for (const q of mismatch) {
      expect(q.hostBelongsTo, q.programme).toBeTruthy();
      expect(q.expectedUnitid, q.programme).toBeTruthy();
      expect(q.hostBelongsTo, q.programme).not.toBe(q.expectedUnitid);
    }
    expect(mismatch.map((q) => q.programme)).toContain('UConn');
  });

  it('keeps the unverified hosts the largest group, and them alone', () => {
    // The bulk of the queue is domains nobody has checked — an absence, not a
    // defect. If a different reason ever overtakes it, something broke.
    const biggest = Object.entries(r.counts)
      .filter(([k]) => k !== 'VERIFIED_DIRECT')
      .sort((a, b) => b[1] - a[1])[0];
    expect(biggest[0]).toBe('UNVERIFIED_HOST');
  });

  it('finds the registry defect behind the id disagreements', () => {
    /**
     * H15 traced all ten institution-id disagreements to one cause: the
     * verification pipeline matched each site's own title to a
     * similarly-named institution. The Citadel is recorded as owning
     * Concordia Moorhead's and Suffolk's athletics sites; Connecticut College
     * owns UConn's; Saint John Fisher owns St. John's.
     *
     * Asserted as a floor rather than a list, because a merged institution
     * legitimately holds several and the count will move as the registry is
     * repaired. What must not happen is the check silently finding nothing.
     */
    const several = institutionsWithSeveralSites();
    expect(several.length).toBeGreaterThan(0);
    expect(several.length).toBeLessThan(80);
    for (const s of several) {
      expect(s.hosts.length, String(s.unitid)).toBeGreaterThan(1);
      expect(new Set(s.hosts).size, String(s.unitid)).toBe(s.hosts.length);
    }
    // The Citadel case, which is the one with no innocent explanation.
    const citadel = several.find((s) => s.unitid === 217864);
    expect(citadel, 'The Citadel must still be flagged').toBeTruthy();
    expect(citadel.hosts).toEqual(expect.arrayContaining(['gocobbers.com', 'gosuffolkrams.com']));
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
