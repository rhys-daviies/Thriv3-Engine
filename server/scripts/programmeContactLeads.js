#!/usr/bin/env node
/**
 * PROGRAMME CONTACT LEADS — Phase 1B. Read-only. The re-acquisition queue for programme inboxes.
 *
 * The 169 legacy `coaches` rows with email_status='generic' (nameless "Team Email" rows from the
 * graduating_seniors import) are LEADS, never evidence. None of them was ever observed on a page
 * (email_seen_on_source_at is empty on every one), their email_source_url is the staff page the
 * import assumed rather than one anybody read, and 15 carry the other sex's title. Nothing here
 * promotes, repairs or moves them: this lists WHERE to look, and what already stands in the way.
 *
 * Per lead: the programme it belongs to (canonical row, athletics entity), the page to re-fetch
 * (only when its host is owned by that entity), and the checks a fresh observation must still
 * pass — mail-domain ownership, a named coach already holding the address (Step 1G), a
 * department inbox, a sex conflict, a duplicate address, an inactive programme. Priority is
 * FALLBACK_NEEDED when no named coach at the programme passes the coach floor's own conditions
 * (computed here read-only, for ordering only — it never decides anything).
 *
 *   node server/scripts/programmeContactLeads.js --db <path> [--out-dir <dir>] [--json]
 *
 * Default --out-dir is <project root>/integrity_artifacts/phase1b (outside git: the queue
 * carries addresses). Deterministic: the queue digest depends only on database content.
 * Opens the database READ-ONLY with query_only, and never imports server/db/client.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { hostOf } from '../lib/athleticsEntity.js';
import { stableJson } from '../lib/refresh/staging.js';
import { programmeContactLabel } from '../lib/refresh/changeClassifier.js';
import { buildProgrammeContactContext, addressDomainVerdict, isDomainProven, isCampOrAcademy, isProgrammeSpecific, sexSignalOfAddress, isDepartmentInbox, programmeContactId } from '../lib/programmeContactEligibility.js';
import { projectPath } from '../lib/projectRoot.js';

const lc = (s) => String(s ?? '').trim().toLowerCase();
const otherSexTitle = (title, sport) => (sport === 'mens-soccer' ? /\bwomen'?s\b/i : /(^|[^o])\bmen'?s\b/i).test(String(title || ''));

/** The lead definition, stated once: a legacy coach row whose address was classed generic. */
export const LEAD_SQL = "SELECT * FROM coaches WHERE email_status = 'generic' ORDER BY id";

export const QUEUE = Object.freeze({
  REACQUIRE: 'REACQUIRE',                                   // fetch the official page and stage it
  REACQUIRE_DISCOVER_PAGE: 'REACQUIRE_DISCOVER_PAGE',       // the legacy URL is not on an owned host: find the official page first
  BLOCKED_PROGRAMME_ABSENT: 'BLOCKED_PROGRAMME_ABSENT',
  BLOCKED_PROGRAMME_INACTIVE: 'BLOCKED_PROGRAMME_INACTIVE',
  BLOCKED_DEPARTMENT_INBOX: 'BLOCKED_DEPARTMENT_INBOX',     // athletics@ / sports@: not a programme endpoint
  BLOCKED_NAMED_COACH_ADDRESS: 'BLOCKED_NAMED_COACH_ADDRESS', // a named coach row holds this address (Step 1G)
  BLOCKED_ADDRESS_DOMAIN: 'BLOCKED_ADDRESS_DOMAIN',         // the mail domain is not owned by the programme's entity
  BLOCKED_CAMP_OR_ACADEMY: 'BLOCKED_CAMP_OR_ACADEMY',       // Phase 1G-B: a camp / academy / clinic line, not the programme
  BLOCKED_NOT_PROGRAMME_SPECIFIC: 'BLOCKED_NOT_PROGRAMME_SPECIFIC', // Phase 1G-B: the address does not name the sport
  ALREADY_PROMOTED: 'ALREADY_PROMOTED',
});

export function buildLeadQueue(db) {
  const ctx = buildProgrammeContactContext(db);
  const colleges = [...ctx.collegeById.values()];
  const byNS = new Map(colleges.map((c) => [`${c.name}|${c.sport}`, c]));
  const links = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='programme_row_links'").get()
    ? db.prepare('SELECT college_id, canonical_college_id FROM programme_row_links').all() : [];
  const canonOf = new Map(links.map((l) => [l.college_id, l.canonical_college_id]));
  const promoted = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='programme_contacts'").get()
    ? db.prepare('SELECT contact_id FROM programme_contacts').pluck().all() : []);
  // named coaches per programme that meet the coach floor's own conditions — PRIORITY ONLY
  const floorNamed = new Map();
  for (const c of db.prepare("SELECT school, sport FROM coaches WHERE trim(coalesce(full_name,'')) != '' AND email_status = 'verified' AND coalesce(currentness_status,'') != 'PROVEN_STALE' AND email LIKE '%@%'").all()) {
    const row = byNS.get(`${c.school}|${c.sport}`); if (!row) continue;
    const k = `${row.athletics_entity_id}|${row.sport}`; floorNamed.set(k, (floorNamed.get(k) || 0) + 1);
  }
  const raw = db.prepare(LEAD_SQL).all();
  const byEmail = new Map();
  for (const r of raw) (byEmail.get(lc(r.email)) || byEmail.set(lc(r.email), []).get(lc(r.email))).push(r);

  const leads = raw.map((r) => {
    const email = lc(r.email);
    const own = byNS.get(`${r.school}|${r.sport}`) || null;
    const canonical = own ? (ctx.collegeById.get(canonOf.get(own.id) || own.id) || own) : null;
    const entity = canonical?.athletics_entity_id || null;
    const legacyHost = hostOf(r.email_source_url);
    const pageOwned = !!(entity && legacyHost && ctx.resolver.hostOwnedBy(legacyHost, entity));
    const domain = entity ? addressDomainVerdict(email, entity, ctx.resolver, ctx.federal) : 'NO_PROGRAMME';
    const sex = sexSignalOfAddress(email);
    const checks = {
      legacy_source_host_owned: pageOwned,
      address_domain: domain,
      address_sex_signal: !sex ? 'NEUTRAL' : sex === r.sport ? 'AGREES' : 'CONFLICTS',
      legacy_title_names_other_sex: otherSexTitle(r.position_title, r.sport),
      department_inbox: isDepartmentInbox(email),
      named_coach_holds_address: ctx.namedAddresses.has(email),
      duplicate_lead_rows: (byEmail.get(email) || []).length - 1,
      ever_observed_on_source: !!r.email_seen_on_source_at,
    };
    const contactId = entity ? programmeContactId(entity, canonical.sport, email) : null;
    let status;
    if (!canonical) status = QUEUE.BLOCKED_PROGRAMME_ABSENT;
    else if (contactId && promoted.has(contactId)) status = QUEUE.ALREADY_PROMOTED;
    else if (canonical.active !== 1) status = QUEUE.BLOCKED_PROGRAMME_INACTIVE;
    else if (checks.department_inbox) status = QUEUE.BLOCKED_DEPARTMENT_INBOX;
    else if (checks.named_coach_holds_address) status = QUEUE.BLOCKED_NAMED_COACH_ADDRESS;
    else if (isCampOrAcademy(email)) status = QUEUE.BLOCKED_CAMP_OR_ACADEMY;
    else if (!isProgrammeSpecific(email)) status = QUEUE.BLOCKED_NOT_PROGRAMME_SPECIFIC;
    else if (!isDomainProven(domain)) status = QUEUE.BLOCKED_ADDRESS_DOMAIN;
    else status = pageOwned ? QUEUE.REACQUIRE : QUEUE.REACQUIRE_DISCOVER_PAGE;
    return {
      lead_id: `LEAD-${crypto.createHash('sha256').update(String(r.id)).digest('hex').slice(0, 16)}`,
      evidence_status: 'LEAD_ONLY',
      promotable: false,
      queue_status: status,
      priority: canonical && (floorNamed.get(`${entity}|${canonical.sport}`) || 0) === 0 ? 'FALLBACK_NEEDED' : 'SUPPLEMENTARY',
      programme: canonical ? { college_id: canonical.id, name: canonical.name, sport: canonical.sport, division: canonical.division, athletics_entity_id: entity, active: canonical.active, label: programmeContactLabel(canonical.name, canonical.sport) } : null,
      legacy: { coach_id: r.id, school: r.school, sport: r.sport, email, position_title: r.position_title, email_status: r.email_status, email_source_url: r.email_source_url, source: r.source },
      target: { page_to_fetch: pageOwned ? r.email_source_url : null, expected_contact_id: contactId, sport: canonical?.sport ?? r.sport },
      checks,
    };
  }).sort((a, b) => (a.programme?.athletics_entity_id || '~').localeCompare(b.programme?.athletics_entity_id || '~') || a.legacy.sport.localeCompare(b.legacy.sport) || a.legacy.email.localeCompare(b.legacy.email) || a.lead_id.localeCompare(b.lead_id));

  const count = (f) => leads.reduce((m, l) => { const k = f(l); m[k] = (m[k] || 0) + 1; return m; }, {});
  const programmes = new Set(leads.filter((l) => l.programme).map((l) => `${l.programme.athletics_entity_id}|${l.programme.sport}`));
  const summary = {
    lead_rows: leads.length,
    distinct_addresses: byEmail.size,
    programmes: programmes.size,
    by_queue_status: count((l) => l.queue_status),
    by_priority: count((l) => l.priority),
    reacquire_by_priority: count((l) => (l.queue_status.startsWith('REACQUIRE') ? `${l.queue_status}/${l.priority}` : 'not-reacquirable')),
    legacy_title_names_other_sex: leads.filter((l) => l.checks.legacy_title_names_other_sex).length,
    address_sex_signal: count((l) => l.checks.address_sex_signal),
    address_domain: count((l) => l.checks.address_domain),
    ever_observed_on_source: leads.filter((l) => l.checks.ever_observed_on_source).length,
    promotable: 0,
  };
  const digest = crypto.createHash('sha256').update(stableJson({ leads, summary })).digest('hex');
  return { leads, summary, digest };
}

function markdown(q, { dbPath, generatedAt }) {
  const out = [`# Programme contact re-acquisition queue — Phase 1B`, '',
    `Generated ${generatedAt} from \`${dbPath}\` (read-only). Queue digest \`${q.digest.slice(0, 16)}\`.`, '',
    '**Every lead is LEAD_ONLY and not promotable.** A programme contact enters canonical data only when an',
    'official page is freshly fetched, staged as a PROGRAMME_CONTACT observation and promoted by integrity:promote.', '',
    '## Summary', '', '```json', JSON.stringify(q.summary, null, 2), '```', '',
    '## Queue', '', '| status | priority | programme | legacy address | page to fetch | domain | sex signal | legacy title other sex |', '|---|---|---|---|---|---|---|---|'];
  for (const l of q.leads) out.push(`| ${l.queue_status} | ${l.priority} | ${l.programme?.label ?? `${l.legacy.school} [${l.legacy.sport}]`} | ${l.legacy.email} | ${l.target.page_to_fetch ?? '—'} | ${l.checks.address_domain} | ${l.checks.address_sex_signal} | ${l.checks.legacy_title_names_other_sex ? 'yes' : ''} |`);
  return `${out.join('\n')}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : null; };
  const dbPath = arg('db');
  if (!dbPath) { console.error('usage: programmeContactLeads --db <path> [--out-dir <dir>] [--json]'); process.exit(2); }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  let q;
  try { q = buildLeadQueue(db); } finally { db.close(); }
  const outDir = path.resolve(arg('out-dir') || projectPath('integrity_artifacts', 'phase1b'));
  fs.mkdirSync(outDir, { recursive: true });
  const generatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(outDir, 'programme_contact_leads.json'), `${JSON.stringify({ generated_at: generatedAt, db: path.resolve(dbPath), digest: q.digest, summary: q.summary, leads: q.leads }, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, 'programme_contact_leads.md'), markdown(q, { dbPath: path.resolve(dbPath), generatedAt }));
  if (argv.includes('--json')) console.log(JSON.stringify(q.summary, null, 2));
  else console.log(`LEADS ${q.summary.lead_rows} rows · ${q.summary.programmes} programmes · digest ${q.digest.slice(0, 16)}\n${JSON.stringify(q.summary.by_queue_status)}\n${JSON.stringify(q.summary.reacquire_by_priority)}\n  written to ${outDir}`);
}
