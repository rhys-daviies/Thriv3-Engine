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

export function auditRosterSources({ season = '2026', sport = 'mens-soccer' } = {}) {
  const domains = verifiedDomains();
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
      season, urlSeason: r.season, verifiedDomains: domains,
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
  console.log('Read-only. Nothing was changed.\n');
}
