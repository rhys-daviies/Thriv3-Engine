/**
 * Which roster pages could be offered as a source, and why the rest cannot.
 *
 * The link an operator sees is only as good as this: every page we cite has
 * passed `verifyRosterSource`, and every page we do not cite has a recorded
 * reason. This report is the second half — a data-repair queue rather than a
 * dashboard, because most of the reasons are fixable upstream.
 *
 * Read-only. It touches nothing.
 *
 *   npm run roster-sources                 the 2026 roster, which is what the
 *                                          panel can link today
 *   npm run roster-sources -- --season 2024
 *   npm run roster-sources -- --list       every non-linkable programme-season
 */
import 'dotenv/config';
import db from '../db/client.js';
import {
  verifyRosterSource, SOURCE_STATUS, canonicalHost, safeUrl,
} from '../../shared/evidence/sourceVerification.js';
import { classifyRegistry, integrityRefuses, INTEGRITY } from '../../shared/evidence/registryIntegrity.js';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const SEASON = arg('season', '2026');
const SPORT = arg('sport', 'mens-soccer');
const LIST = argv.includes('--list');

/**
 * Hosts we would follow, and the institution each belongs to.
 *
 * The filter IS the trust model: a domain the registry only guessed at, or one
 * that is the university's main site rather than its athletics site, buys
 * nothing here.
 */
export function verifiedDomains() {
  const out = new Map();
  for (const d of db.prepare(`
    SELECT domain, unitid FROM athletics_domains
    WHERE status IN ('VERIFIED','VERIFIED_ALIAS') AND role = 'ATHLETICS_SITE'
      AND confidence IN ('CERTAIN','CORROBORATED') AND unitid IS NOT NULL
  `).all()) out.set(canonicalHost(d.domain), d.unitid);
  return out;
}

/**
 * Institutions the registry says own more than one athletics site.
 *
 * A list for a person to read, not a rule: holding several is not by itself
 * wrong. A merged institution legitimately carries one site per predecessor
 * campus, and Commonwealth University-Bloomsburg carries Bloomsburg's, Lock
 * Haven's and Mansfield's — all three used by its own rosters.
 *
 * What decides each host is `registryIntegrity`, which asks whether the
 * institution's own rosters use it. This function only gathers the candidates
 * so the audit can show them together, and it repairs nothing: where an
 * assignment is refused, the honest output is that nobody owns it, not a
 * guess at who does.
 *
 * `www.` and a port are the same host and are collapsed; a subdomain is not.
 */
export function institutionsWithSeveralSites() {
  const canon = (h) => canonicalHost(h).replace(/:\d+$/, '');
  const byUnit = new Map();
  for (const d of db.prepare(`
    SELECT domain, unitid FROM athletics_domains
    WHERE role = 'ATHLETICS_SITE' AND status IN ('VERIFIED','VERIFIED_ALIAS')
      AND confidence IN ('CERTAIN','CORROBORATED') AND unitid IS NOT NULL
  `).all()) {
    if (!byUnit.has(d.unitid)) byUnit.set(d.unitid, new Set());
    byUnit.get(d.unitid).add(canon(d.domain));
  }
  const name = db.prepare('SELECT name FROM colleges WHERE unitid = ? LIMIT 1');
  return [...byUnit]
    .filter(([, hosts]) => hosts.size > 1)
    .map(([unitid, hosts]) => ({ unitid, name: name.get(unitid)?.name ?? null, hosts: [...hosts].sort() }))
    .sort((a, b) => b.hosts.length - a.hosts.length || String(a.name).localeCompare(String(b.name)));
}

/**
 * Which host each institution's OWN rosters point at, across every sport and
 * season. The corroboration signal — see `registryIntegrity`.
 */
export function rosterUsage() {
  const unit = new Map(db.prepare('SELECT name, sport, unitid FROM colleges').all()
    .map((c) => [`${c.name}|${c.sport}`, c.unitid]));
  const out = [];
  for (const r of db.prepare(`
    SELECT DISTINCT college_name, sport, source_roster_url AS url
    FROM roster_players WHERE source_roster_url IS NOT NULL
  `).all()) {
    let host; try { host = canonicalHost(new URL(r.url).hostname); } catch { continue; }
    const unitid = unit.get(`${r.college_name}|${r.sport}`);
    if (unitid != null) out.push({ unitid, host });
  }
  return out;
}

/** The registry's own account of itself, computed once. */
export function registryIntegrity() {
  const trusted = [...verifiedDomains()].map(([domain, unitid]) => ({ domain, unitid }));
  return classifyRegistry(trusted, rosterUsage());
}

export function auditRosterSources({ season = '2026', sport = 'mens-soccer' } = {}) {
  const domains = verifiedDomains();
  const integrity = registryIntegrity();
  const unitid = new Map(db.prepare('SELECT name, unitid FROM colleges WHERE sport = ?')
    .all(sport).map((c) => [c.name, c.unitid]));

  const rows = db.prepare(`
    SELECT DISTINCT college_name, season, source_roster_url AS url
    FROM roster_players WHERE sport = ? AND season = ?
  `).all(sport, season);

  const counts = Object.fromEntries(Object.values(SOURCE_STATUS).map((s) => [s, 0]));
  const quarantine = [];
  for (const r of rows) {
    const result = verifyRosterSource({
      url: r.url, unitid: unitid.get(r.college_name) ?? null,
      season, urlSeason: r.season, verifiedDomains: domains, registryIntegrity: integrity,
    });
    counts[result.status] += 1;
    if (result.status !== SOURCE_STATUS.VERIFIED_DIRECT) {
      quarantine.push({
        programme: r.college_name,
        season: r.season,
        url: r.url ?? null,
        host: result.host ?? (safeUrl(r.url)?.hostname ?? null),
        reason: result.status,
        // What the host WOULD have to belong to for this link to be offered.
        expectedUnitid: unitid.get(r.college_name) ?? null,
        hostBelongsTo: result.host ? domains.get(result.host) ?? null : null,
        integrity: result.host ? integrity.get(result.host)?.state ?? null : null,
        alsoAssigned: result.host ? integrity.get(result.host)?.siblings ?? [] : [],
      });
    }
  }
  quarantine.sort((a, b) => a.reason.localeCompare(b.reason) || a.programme.localeCompare(b.programme));
  return { season, sport, total: rows.length, counts, quarantine };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = auditRosterSources({ season: SEASON, sport: SPORT });
  console.log(`\nROSTER SOURCES — ${r.sport}, ${r.season}\n`);
  console.log(`  ${r.total} programme-seasons with a roster on file\n`);
  for (const [reason, n] of Object.entries(r.counts)) {
    if (!n) continue;
    console.log(`    ${reason.padEnd(22)} ${String(n).padStart(5)}   ${(100 * n / r.total).toFixed(1)}%`);
  }
  const linkable = r.counts[SOURCE_STATUS.VERIFIED_DIRECT];
  console.log(`\n  linkable: ${linkable} of ${r.total} (${(100 * linkable / r.total).toFixed(1)}%)`);
  console.log(`  to repair: ${r.quarantine.length}\n`);

  if (LIST) {
    console.log('  NOT LINKABLE\n');
    for (const q of r.quarantine) {
      console.log(`    ${q.reason.padEnd(22)} ${q.programme.padEnd(34)} ${q.host ?? '—'}`);
      if (q.reason === SOURCE_STATUS.REGISTRY_CONFLICT) {
        console.log(`      ${q.url}`);
        console.log(`      assigned to institution ${q.hostBelongsTo}, which uses ${q.alsoAssigned.join(', ')} instead`);
      }
      if (q.reason === SOURCE_STATUS.INSTITUTION_MISMATCH) {
        console.log(`      ${q.url}`);
        console.log(`      that host belongs to institution ${q.hostBelongsTo}, this programme is ${q.expectedUnitid}`);
      }
    }
    console.log();
  } else {
    const worst = r.quarantine.filter((q) => q.reason === SOURCE_STATUS.INSTITUTION_MISMATCH);
    if (worst.length) {
      // The registry names the right school and carries a different institution
      // id for most of these, so the repair is an id rather than a URL. Printed
      // first because it is the only reason that is a defect rather than an
      // absence — an unverified host is simply a domain nobody has checked.
      console.log('  INSTITUTION ID DISAGREES — repair these first\n');
      for (const q of worst) {
        console.log(`    ${q.programme.padEnd(34)} ${q.host}`);
        console.log(`      registry says institution ${q.hostBelongsTo}, the college row says ${q.expectedUnitid}`);
      }
      console.log();
    }
    console.log('  Re-run with --list for every non-linkable programme-season.\n');
  }
  /**
   * Why the institution-id disagreements cannot be repaired from here.
   *
   * H15 traced all ten to one defect: the verification pipeline read each
   * site's own title — "University of Connecticut Athletics" — and matched
   * that NAME to a similarly-named institution, landing on Connecticut
   * College. `institution_aliases` shows the collision in every case.
   *
   * Repairing them means asserting which of two similarly-named schools a
   * domain belongs to, and every internal route to that assertion is a name
   * comparison — the thing the verification contract forbids, and the thing
   * that caused the defect. It needs an authoritative institution-to-domain
   * source, which this repository does not have.
   */
  // Seeded from the enum so a category with no rows prints a zero rather than
  // vanishing — an absent conflict class should be visibly absent.
  const states = Object.fromEntries(Object.values(INTEGRITY).map((k) => [k, 0]));
  for (const v of registryIntegrity().values()) states[v.state] = (states[v.state] ?? 0) + 1;
  console.log('  REGISTRY INTEGRITY\n');
  for (const [k, n] of Object.entries(states)) console.log(`    ${k.padEnd(26)} ${String(n).padStart(5)}`);
  console.log();

  const integ = registryIntegrity();
  const several = institutionsWithSeveralSites();
  if (several.length) {
    console.log(`    ${several.length} institutions hold more than one athletics site. Counting hosts`);
    console.log('    proves nothing — a merged institution legitimately carries one per');
    console.log('    predecessor campus. What separates them is whether the institution\'s');
    console.log('    OWN rosters use each host; the uncorroborated ones are refused.\n');
    const shown = LIST ? several : several.slice(0, 8);
    for (const s of shown) {
      const marks = s.hosts.map((h) => (integrityRefuses(integ.get(h)?.state) ? `${h} ✗` : h));
      console.log(`    ${String(s.unitid).padEnd(8)} ${String(s.name ?? '—').padEnd(34)} ${marks.join(', ')}`);
    }
    if (several.length > shown.length) console.log(`    …and ${several.length - shown.length} more — see --list`);
    console.log('\n    ✗ marks an assignment its own institution never uses: refused as a');
    console.log('      source, and not thereby claimed for anybody else.\n');
  }
  console.log('Read-only. Nothing was changed.\n');
}
