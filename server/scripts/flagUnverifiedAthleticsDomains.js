#!/usr/bin/env node
/**
 * PHASE 6C.4 PREVENTION — read-only. Surface the exact failure mode that left Phase-6C.3
 * acquisitions ineligible: an authoritative athletics domain used by a coach's email_source_url
 * that either (a) is not VERIFIED in athletics_domains (absent/INSUFFICIENT/WRONG/AMBIGUOUS),
 * or (b) is VERIFIED but was never scraped by coach_seasons (so it cannot corroborate).
 *
 *   node server/scripts/flagUnverifiedAthleticsDomains.js --db <path> [--source <src>] [--json]
 *
 * It NEVER mutates anything and NEVER creates a mapping — it only reports, so an acquisition
 * can flag an unknown/unverified/uncorroborating domain for explicit human verification
 * instead of silently producing ineligible coach rows. `--source` narrows to one coaches.source.
 */
import path from 'node:path';
import Database from 'better-sqlite3';

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : null; };
const dbArg = arg('db');
if (!dbArg) { console.error('Give --db.'); process.exit(2); }
const sourceFilter = arg('source');
const asJson = process.argv.includes('--json');
const db = new Database(path.resolve(dbArg), { readonly: true, fileMustExist: true });

const reg = (u) => { try { const h = new URL(u).hostname.replace(/^www\./, ''); const p = h.split('.'); return p.length > 2 ? p.slice(-2).join('.') : h; } catch { return null; } };
const csTrusted = new Set();
for (const r of db.prepare("SELECT source_url FROM coach_seasons WHERE source_url LIKE 'http%'").all()) { const d = reg(r.source_url); if (d) csTrusted.add(d); }
const domStatus = new Map(db.prepare('SELECT domain, unitid, status FROM athletics_domains').all().map((r) => [r.domain, r]));

const coaches = db.prepare(`SELECT c.id, c.school, c.sport, c.email_source_url, c.email_status,
  (SELECT unitid FROM colleges cg WHERE cg.name=c.school AND cg.sport=c.sport) AS unitid
  FROM coaches c WHERE c.email_source_url LIKE 'http%'${sourceFilter ? ' AND c.source=?' : ''}`).all(...(sourceFilter ? [sourceFilter] : []));

const flagged = new Map();
for (const c of coaches) {
  if (String(c.email_status).toLowerCase() !== 'verified') continue; // only real-email rows can ever be eligible
  const d = reg(c.email_source_url); if (!d) continue;
  const dom = domStatus.get(d);
  const verified = dom && ['VERIFIED', 'VERIFIED_ALIAS'].includes(dom.status) && dom.unitid != null;
  const unitidMatch = verified && Number(dom.unitid) === Number(c.unitid);
  const scraped = csTrusted.has(d);
  let reason = null;
  if (!dom) reason = 'DOMAIN_MISSING';
  else if (dom.status === 'WRONG_INSTITUTION') reason = 'DOMAIN_WRONG_INSTITUTION';
  else if (['INSUFFICIENT_EVIDENCE', 'AMBIGUOUS', 'UNREACHABLE'].includes(dom.status)) reason = `DOMAIN_${dom.status}`;
  else if (verified && !unitidMatch) reason = 'DOMAIN_WRONG_UNITID';
  else if (verified && unitidMatch && !scraped) reason = 'ATHLETICS_DOMAIN_NOT_SCRAPED';
  if (!reason) continue; // VERIFIED + matching + scraped -> corroborates fine
  if (!flagged.has(d)) flagged.set(d, { domain: d, reason, current_status: dom ? dom.status : 'ABSENT', csTrusted: scraped, unitid_expected: c.unitid, coaches: 0, programmes: new Set() });
  const f = flagged.get(d); f.coaches++; f.programmes.add(`${c.school}|${c.sport}`);
}
const out = [...flagged.values()].map((f) => ({ ...f, programmes: f.programmes.size })).sort((a, b) => b.coaches - a.coaches);
if (asJson) { process.stdout.write(JSON.stringify(out, null, 2)); }
else {
  console.log(`Unverified/uncorroborating athletics domains blocking verified-email coaches${sourceFilter ? ` (source=${sourceFilter})` : ''}: ${out.length}`);
  for (const f of out) console.log(`  ${f.domain.padEnd(28)} ${f.reason.padEnd(28)} status=${f.current_status} csTrusted=${f.csTrusted} coaches=${f.coaches} programmes=${f.programmes}`);
}
db.close();
