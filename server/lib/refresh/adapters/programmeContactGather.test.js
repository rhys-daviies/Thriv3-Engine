import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from '../../../db/migrate.js';
import { programmeContactAdapter } from './gatherers.js';
import { capturedPage } from './fetchPage.js';
import { REFUSAL } from './adapterSafety.js';
import { SLOT } from './programmeContactSlots.js';
import { buildProgrammeContactPlan, SKIP } from '../../../scripts/programmeContactPlan.js';

/**
 * PHASE 1G-B (B2) — gathering programme-contact evidence. The gatherer reads a staff page the
 * programme's entity owns BY HOST and emits a PROGRAMME_CONTACT page; the plan builder turns a
 * legacy lead into a URL to read and nothing more. Hosts, people and addresses are invented.
 */
const SCHEMA = fs.readFileSync(path.resolve(import.meta.dirname, '../../../db/schema.sql'), 'utf8');
const mail = (e) => (e ? `<a href="mailto:${e}">${e}</a>` : '');
const staffPage = (rows, title = "Men's Soccer Coaches - Example College Athletics") => `<html><head><title>${title}</title></head><body class="sidearm">
  <table><caption>Coaching Staff</caption><thead><tr><th>Name</th><th>Title</th><th>Email Address</th></tr></thead><tbody>
  ${rows.map(([n, t, e]) => `<tr class="sidearm-coaches-coach"><th scope="row">${n}</th><td>${t}</td><td>${mail(e)}</td></tr>`).join('')}</tbody></table>
  ${'<p>padding</p>'.repeat(80)}</body></html>`;
const fetchOf = (html, finalUrl) => async (url) => capturedPage({ url, final_url: finalUrl || url, fetched_at: '2026-10-08T12:00:00.000Z', body: html });
const owns = (h, e) => e === 'AE-X' && h === 'exampleathletics.com';
const target = { athletics_entity_id: 'AE-X', institution_label: 'Example College', sport: 'mens-soccer', host: 'exampleathletics.com', platform: 'SIDEARM', season: 2026 };
const ROWS = [['Avery Dale', 'Head Coach', 'msoccer@example.edu'], ['Blake Ford', 'Assistant Coach', 'msoccer@example.edu'], ['Casey Hunt', 'Assistant Coach', 'chunt@example.edu'], ['Dana Ives', 'Goalkeeper Coach', 'soccerrecruiting@example.edu']];

describe('programmeContactAdapter', () => {
  it('emits one PROGRAMME_CONTACT page: shared and programme-looking addresses with their slots; personal addresses are not staged', async () => {
    const { page, refusal } = await programmeContactAdapter(target, { ownsHost: owns, fetch: fetchOf(staffPage(ROWS)) });
    expect(refusal).toBeUndefined();
    expect(page).toMatchObject({ dataset: 'PROGRAMME_CONTACT', source_kind: 'OFFICIAL_STAFF_DIRECTORY', sport: 'mens-soccer', athletics_entity_id: 'AE-X', source_complete: true, parser_version: 'pc-slots-1', observed_season: 2026 });
    expect(page.contacts.map((c) => [c.email, c.slot, c.person_count, c.attached_to_person])).toEqual([
      ['msoccer@example.edu', SLOT.SHARED, 2, null],
      ['soccerrecruiting@example.edu', SLOT.PERSON, 1, true],     // staged so its refusal is visible
    ]);
    expect(page.contacts.every((c) => c.email_origin === 'PUBLISHED_ON_SOURCE')).toBe(true);
    expect(page.adapter_evidence).toMatchObject({ addresses: 3, staged: 2, staff_rows: 4 });
  });
  it('is HOST-ONLY: a page on a host the entity does not own is refused, even if a path scope would own it', async () => {
    const { refusal } = await programmeContactAdapter({ ...target, host: 'institution.edu' }, { ownsHost: owns, fetch: fetchOf(staffPage(ROWS)), url: 'https://institution.edu/athletics/msoc/coaches' });
    expect(refusal.code).toBe(REFUSAL.INSTITUTION_MISMATCH);
  });
  it('refuses a redirect to another host, a shared platform root, a blocked page, a wrong-sport page and a page with no programme address', async () => {
    expect((await programmeContactAdapter(target, { ownsHost: owns, fetch: fetchOf(staffPage(ROWS), 'https://elsewhere.example/coaches') })).refusal.code).toBe(REFUSAL.FOREIGN_REDIRECT);
    expect((await programmeContactAdapter({ ...target, host: 'x.sidearmsports.com' }, { ownsHost: owns, fetch: fetchOf(staffPage(ROWS)) })).refusal.code).toBe(REFUSAL.SHARED_ROOT);
    expect((await programmeContactAdapter(target, { ownsHost: owns, fetch: fetchOf('<html><head><title>Just a moment...</title></head></html>') })).refusal.code).toBe(REFUSAL.BLOCKED);
    expect((await programmeContactAdapter(target, { ownsHost: owns, fetch: fetchOf(staffPage(ROWS, "Women's Soccer Coaches - Example College")) })).refusal.code).toBe(REFUSAL.WRONG_SPORT);
    expect((await programmeContactAdapter(target, { ownsHost: owns, fetch: fetchOf(staffPage([['Eli Fox', 'Head Coach', 'efox@example.edu']])) })).refusal.code).toBe(REFUSAL.ZERO);
  });
});

describe('buildProgrammeContactPlan: a lead is where to look, never evidence', () => {
  const T = '2026-10-01T00:00:00.000Z';
  function world() {
    const db = new Database(':memory:'); db.exec(SCHEMA); migrate(db);
    const ent = db.prepare("INSERT INTO athletics_entities (athletics_entity_id, display_name, federal_unitid, entity_kind, provenance, created_at) VALUES (?,?,?,'SINGLE','t',?)");
    const col = db.prepare("INSERT INTO colleges (id, created_date, updated_date, name, sport, division, active, unitid, athletics_entity_id) VALUES (?,?,?,?,?,'NCAA D3',1,?,?)");
    const dom = db.prepare("INSERT INTO athletics_domains (domain, unitid, status, role, claimed_keys, claimed_unitids, verification_method, confidence, checked_at) VALUES (?, ?, 'VERIFIED', 'ATHLETICS_SITE', '[]', '[]', 'TEST', 'CERTAIN', ?)");
    const lead = db.prepare("INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status, email_source_url, source) VALUES (?, ?, NULL, ?, ?, 'NCAA D3', ?, 'Team Email', 'generic', ?, 'graduating_seniors.coaching_staff')");
    ent.run('AE-U900001', 'Alpha College', 900001, T); col.run('c-a', T, T, 'Alpha College', 'mens-soccer', 900001, 'AE-U900001'); dom.run('alphaathletics.example', 900001, T); dom.run('alpha.example', 900001, T);
    lead.run('lead-a', T, 'msoccer@alpha.example', 'Alpha College', 'mens-soccer', 'https://alphaathletics.example/sports/mens-soccer/coaches');
    ent.run('AE-U900002', 'Beta College', 900002, T); col.run('c-b', T, T, 'Beta College', 'mens-soccer', 900002, 'AE-U900002'); dom.run('beta.example', 900002, T);
    lead.run('lead-b', T, 'msoccer@beta.example', 'Beta College', 'mens-soccer', 'https://unowned.example/beta/coaches');   // page hint on a host Beta does not own
    return db;
  }
  it('plans only pages on a host the entity owns now; the plan carries the URL, never the lead\'s address', () => {
    const plan = buildProgrammeContactPlan(world(), { season: 2026, programmes: [{ athletics_entity_id: 'AE-U900001', sport: 'mens-soccer' }, { athletics_entity_id: 'AE-U900002', sport: 'mens-soccer' }, { athletics_entity_id: 'AE-U900003', sport: 'mens-soccer' }] });
    expect(plan.targets).toEqual([expect.objectContaining({ athletics_entity_id: 'AE-U900001', staff_url: 'https://alphaathletics.example/sports/mens-soccer/coaches', kinds: ['PROGRAMME_CONTACT'], host: 'alphaathletics.example' })]);
    expect(JSON.stringify(plan.targets)).not.toMatch(/@/);
    expect(plan.skipped).toEqual([{ athletics_entity_id: 'AE-U900002', sport: 'mens-soccer', reason: SKIP.NO_OWNED_PAGE }, { athletics_entity_id: 'AE-U900003', sport: 'mens-soccer', reason: SKIP.NO_LEAD }]);
  });
  it('is deterministic and writes nothing', () => {
    const db = world(); const before = db.prepare('SELECT total_changes() n').get().n;
    const a = buildProgrammeContactPlan(db, { season: 2026 }); const b = buildProgrammeContactPlan(db, { season: 2026 });
    expect(a.plan_hash).toBe(b.plan_hash);
    expect(db.prepare('SELECT total_changes() n').get().n).toBe(before);
  });
});
