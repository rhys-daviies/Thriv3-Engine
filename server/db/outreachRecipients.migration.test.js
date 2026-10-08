import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import db from './client.js';
import { migrate, extendOutreachRecipients, recipientTableSql, RECIPIENT_TABLES } from './migrate.js';
import { materialiseNextContactAttempt } from '../lib/pursuitPolicy.js';
import { generateProgrammeMessage } from '../lib/programmeMessageGeneration.js';
import { createOutreach } from '../lib/outreach.js';
import { recordDraft } from '../lib/outreachSend.js';
import { confirmSent } from '../lib/confirmSends.js';
import { findOrCreateCoach } from '../lib/coaches.js';
import { corroborateFixtureCoaches } from '../testCanonicalCoaches.js';

/**
 * PHASE 1D — THE FIVE-TABLE TYPED-RECIPIENT REBUILD, ON A DATABASE SHAPED LIKE THE REAL ONE.
 *
 * Filled through the product's own write paths — a campaign, attempts, a generated message, a first-touch
 * approval, drafted and confirmed sends with their append-only events and outbound attempts, a
 * nameless legacy team-inbox coach relationship — the five recipient tables are then put back
 * to their EXACT pre-1D definitions (pre1dRecipientTables.fixture.json, captured from the
 * working database's sqlite_master) with every row and rowid intact, and migrated. Everything that existed
 * must come through identical; the schema must gain exactly the typed recipient and nothing
 * else; and a second boot must change nothing.
 */
const SCHEMA = fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
const PRE_1D = JSON.parse(fs.readFileSync(new URL('./pre1dRecipientTables.fixture.json', import.meta.url), 'utf8'));
const NEW_INDEXES = new Set(['idx_outreach_athlete_programme_contact', 'idx_contact_attempts_campaign_programme_contact', 'idx_first_touch_campaign_programme_contact', 'idx_outreach_send_programme_contact', 'idx_programme_messages_programme_contact']);
// Phase 1E: the recipient-agreement triggers ensureRecipientConstraints adds beside the indexes.
const AGREEMENT_TRIGGERS = ['trg_recipient_send_outreach_insert', 'trg_recipient_send_outreach_update', 'trg_recipient_send_message_insert',
  'trg_recipient_send_message_update', 'trg_recipient_attempt_outreach_insert', 'trg_recipient_attempt_outreach_update',
  'trg_recipient_message_attempt_insert', 'trg_recipient_message_attempt_update', 'trg_recipient_outreach_fixed', 'trg_recipient_attempt_fixed'];
const T = '2026-09-01T00:00:00.000Z';
const ATHLETE = 'mig-athlete';

/** Put the five tables back to their exact pre-1D shape (rows and indexes intact). */
function downgradeToPre1d(d) {
  d.pragma('foreign_keys = OFF');
  d.transaction(() => {
    // A pre-1D database has none of the Phase 1E recipient-agreement triggers either.
    for (const n of d.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_recipient_%'").pluck().all()) d.exec(`DROP TRIGGER "${n}"`);
    for (const t of RECIPIENT_TABLES) {
      const idx = d.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(t).filter((i) => !NEW_INDEXES.has(i.name));
      const cols = d.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name).filter((c) => c !== 'programme_contact_id');
      d.exec(PRE_1D[t].replace(/^CREATE TABLE \w+/, `CREATE TABLE ${t}__pre`));
      d.exec(`INSERT INTO ${t}__pre (rowid, ${cols.join(',')}) SELECT rowid, ${cols.join(',')} FROM ${t}`);
      d.exec(`DROP TABLE ${t}`); d.exec(`ALTER TABLE ${t}__pre RENAME TO ${t}`);
      for (const i of idx) d.exec(i.sql);
    }
    for (const n of NEW_INDEXES) d.exec(`DROP INDEX IF EXISTS ${n}`);
  })();
  d.pragma('foreign_keys = ON');
}

const digestRows = (d, t, cols) => crypto.createHash('sha256').update(JSON.stringify(d.prepare(`SELECT rowid, ${cols.map((c) => `"${c}"`).join(',')} FROM ${t} ORDER BY rowid`).raw().all())).digest('hex');
const tables = (d) => d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").pluck().all();
const colsOf = (d, t) => d.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
const schemaObjects = (d) => Object.fromEntries(d.prepare("SELECT type || ':' || name AS k, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY k").all().map((r) => [r.k, r.sql]));
function snapshot(d) {
  const rows = {}; for (const t of tables(d)) rows[t] = { count: d.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, digest: digestRows(d, t, colsOf(d, t).filter((c) => c !== 'programme_contact_id')) };
  return { rows, objects: schemaObjects(d), fkCheck: JSON.stringify(d.pragma('foreign_key_check')), fks: Object.fromEntries(tables(d).map((t) => [t, JSON.stringify(d.prepare(`PRAGMA foreign_key_list(${t})`).all())])) };
}

let before; let rebuilt;
beforeAll(() => {
  // with a public_slug: migrate() assigns one to any player without, which would move `players` on every boot
  db.prepare("INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug) VALUES (?, ?, ?, 'Mig Athlete', 'MF', 'mens-soccer', 'mig-slug')").run(ATHLETE, T, T);
  db.prepare("INSERT INTO operator_users (id, email, password_hash, active, created_at) VALUES ('op-1', 'op@test.example', 'x', 1, ?)").run(T);
  // a campaign, through the product's write paths (which read the current schema) ...
  db.prepare("INSERT INTO campaigns (id, athlete_id, sport, state, starts_on, created_at, updated_at, snapshot_taken_at, programme_count) VALUES ('mig-camp', ?, 'mens-soccer', 'active', '2020-01-01', ?, ?, ?, 0)").run(ATHLETE, T, T, T);
  db.prepare("INSERT INTO programme_campaigns (id, campaign_id, college_name, sport, rank, match_score, tier, tier_source, state, created_at, updated_at) VALUES ('mig-pc', 'mig-camp', 'Alpha', 'mens-soccer', 1, 82, 'A', 'AUTO', 'queued', ?, ?)").run(T, T);
  const coaches = [0, 1].map((i) => findOrCreateCoach({ full_name: `${'AB'[i]} Coach`, email: `c${i}@alpha.edu`, school: 'Alpha', sport: 'mens-soccer', division: 'NCAA D1', position_title: i ? 'Assistant Coach' : 'Head Coach' }));
  // verified addresses, so the Phase 8A floor pursues them through the real planner — and the
  // corroboration the canonical send floor requires (PR #64), or no attempt is prepared for them
  db.prepare("UPDATE coaches SET email_status = 'verified', currentness_status = 'CURRENT' WHERE school = 'Alpha'").run();
  corroborateFixtureCoaches(db, { ids: coaches.map((c) => c.id) });
  materialiseNextContactAttempt({ programmeCampaignId: 'mig-pc' });
  generateProgrammeMessage({ programmeCampaignId: 'mig-pc', coachId: coaches[0].id });
  db.prepare("INSERT INTO campaign_first_touch_approvals (id, programme_campaign_id, coach_id, approved_by_operator_id, approved_at, reviewed_confirmed_send_count) VALUES ('mig-fta', 'mig-pc', ?, 'op-1', ?, 0)").run(coaches[1].id, T);
  // a drafted + confirmed manual send (events and an outbound attempt follow), and a nameless legacy team-inbox coach
  const team = db.prepare("INSERT INTO coaches (id, created_at, full_name, email, school, division, sport, position_title, email_status) VALUES ('mig-team', ?, NULL, 'msoccer@alpha.edu', 'Alpha', 'NCAA D1', 'mens-soccer', 'Men''s Soccer (Team Email)', 'generic') RETURNING *").get(T);
  for (const coach of [coaches[1], team]) {
    const o = createOutreach({ athleteId: ATHLETE, coachId: coach.id });
    recordDraft({ outreachId: o.id, athleteId: ATHLETE, coachId: coach.id, collegeName: 'Alpha', sport: 'mens-soccer', evidence: null, body: `body ${coach.id}`, subject: 's' });
    confirmSent([o.id], { at: '2026-09-02T00:00:00.000Z' });
  }
  db.prepare("INSERT INTO engagement_rollup (outreach_id, qualified_visits, engagement_score, tier, updated_at) SELECT id, 2, 40, 'warm', ? FROM outreach LIMIT 1").run(T);
  // the append-only children of the rebuilt tables, with rows in them (a trigger on an empty table proves nothing)
  const send = db.prepare('SELECT id, outreach_id, athlete_id FROM outreach_send ORDER BY rowid LIMIT 1').get();
  db.prepare("INSERT INTO outreach_send_event (id, outreach_send_id, type, source, observed_at, created_at) VALUES ('mig-ev', ?, 'REPLY', 'operator', ?, ?)").run(send.id, T, T);
  db.prepare("INSERT INTO outbound_send_attempt (id, outreach_id, athlete_id, sending_identity, transport, attempted_at, created_at, outreach_send_id) VALUES ('mig-att', ?, ?, 'test@thriv3.test', 'manual', ?, ?, ?)").run(send.outreach_id, send.athlete_id, T, T, send.id);
  // ... then the five tables are put back to their exact pre-1D shape, rows and rowids intact
  downgradeToPre1d(db);
  for (const t of RECIPIENT_TABLES) expect(colsOf(db, t)).not.toContain('programme_contact_id');
  before = snapshot(db);
  rebuilt = extendOutreachRecipients(db);
});

describe('migrating a database shaped exactly like the working one', () => {
  it('rebuilds the five tables, and only those', () => {
    expect(rebuilt).toEqual(RECIPIENT_TABLES);
    for (const t of ['outreach', 'outreach_send', 'programme_contact_attempts', 'campaign_first_touch_approvals', 'programme_messages', 'outreach_send_event', 'outbound_send_attempt']) {
      expect(before.rows[t].count, t).toBeGreaterThan(0);  // the fixture exercised every table that matters
    }
  });

  it('1–5. every row of every table is unchanged — ids, rowids, coach_id, timestamps, state, tokens — and every new recipient column is NULL', () => {
    const after = snapshot(db);
    expect(after.rows).toEqual(before.rows);
    for (const t of RECIPIENT_TABLES) expect(db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE programme_contact_id IS NOT NULL`).get().n, t).toBe(0);
    expect(db.prepare("SELECT coach_id FROM outreach WHERE coach_id = 'mig-team'").get()).toBeTruthy(); // the legacy team-inbox send stays a COACH relationship
  });

  it('6/7. foreign keys are back ON, foreign_key_check is as before, integrity_check is ok', () => {
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(JSON.stringify(db.pragma('foreign_key_check'))).toBe(before.fkCheck);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  });

  it('8/9. every index and trigger is recreated exactly; the only additions are the typed recipient', () => {
    const after = schemaObjects(db);
    const changed = Object.keys(after).filter((k) => before.objects[k] !== undefined && before.objects[k] !== after[k]).sort();
    expect(changed).toEqual(RECIPIENT_TABLES.map((t) => `table:${t}`).sort());
    expect(Object.keys(before.objects).filter((k) => !(k in after))).toEqual([]);
    expect(Object.keys(after).filter((k) => !(k in before.objects)).sort())
      .toEqual([...[...NEW_INDEXES].map((n) => `index:${n}`), ...AGREEMENT_TRIGGERS.map((n) => `trigger:${n}`)].sort());
    // the rebuilt definitions are the pre-1D ones plus exactly the column and the CHECK
    // (SQLite stores a renamed table's name quoted: CREATE TABLE "outreach")
    for (const t of RECIPIENT_TABLES) expect(after[`table:${t}`].replace(`CREATE TABLE "${t}"`, `CREATE TABLE ${t}`)).toBe(recipientTableSql(PRE_1D[t], t));
  });

  it('every OTHER table keeps its foreign keys, and the five keep theirs plus programme_contact_id', () => {
    const after = snapshot(db);
    for (const t of tables(db)) {
      if (RECIPIENT_TABLES.includes(t)) {
        const fks = db.prepare(`PRAGMA foreign_key_list(${t})`).all();
        expect(fks.filter((f) => f.from !== 'programme_contact_id').map((f) => [f.from, f.table, f.to, f.on_delete]).sort(), t)
          .toEqual(JSON.parse(before.fks[t]).map((f) => [f.from, f.table, f.to, f.on_delete]).sort());
        expect(fks.find((f) => f.from === 'programme_contact_id'), t).toMatchObject({ table: 'programme_contacts', to: 'contact_id' });
      } else expect(after.fks[t], t).toBe(before.fks[t]);
    }
  });

  it('10. append-only protections still hold, and cascades still run through the rebuilt tables', () => {
    // (the working database also carries trg_outbound_send_attempt_no_delete, from another branch;
    // this schema does not define it — the object comparison above proves no trigger is lost either way)
    expect(db.prepare('SELECT COUNT(*) n FROM outreach_send_event').get().n).toBeGreaterThan(0);
    expect(db.prepare('SELECT COUNT(*) n FROM outbound_send_attempt').get().n).toBeGreaterThan(0);
    expect(() => db.prepare("UPDATE outreach_send_event SET type = type").run()).toThrow(/append-only/);
    expect(() => db.prepare("UPDATE outbound_send_attempt SET transport = transport").run()).toThrow(/append-only/);
    // coach_id still refuses a missing coach, and the owned chain still cascades
    expect(() => db.prepare("INSERT INTO outreach (id, athlete_id, coach_id, token, created_at) VALUES ('x', ?, 'no-coach', 'tok-x', ?)").run(ATHLETE, T)).toThrow(/FOREIGN KEY/);
    const attempts = db.prepare("SELECT COUNT(*) n FROM programme_contact_attempts WHERE programme_campaign_id = 'mig-pc'").get().n;
    expect(attempts).toBeGreaterThan(0);
    db.prepare("UPDATE outreach_send SET programme_campaign_id = NULL WHERE programme_campaign_id = 'mig-pc'").run();
    db.prepare("UPDATE outreach SET programme_campaign_id = NULL WHERE programme_campaign_id = 'mig-pc'").run();
    db.prepare("DELETE FROM programme_campaigns WHERE id = 'mig-pc'").run();
    expect(db.prepare("SELECT COUNT(*) n FROM programme_contact_attempts WHERE programme_campaign_id = 'mig-pc'").get().n).toBe(0);
    expect(db.prepare("SELECT COUNT(*) n FROM programme_messages").get().n).toBe(0);
    expect(db.prepare("SELECT COUNT(*) n FROM campaign_first_touch_approvals").get().n).toBe(0);
  });

  it('a second boot changes nothing (schema.sql + migrate are idempotent over the migrated database)', () => {
    const s1 = snapshot(db);
    db.exec(SCHEMA); migrate(db);
    expect(extendOutreachRecipients(db)).toEqual([]);
    expect(snapshot(db)).toEqual(s1);
  });
});

describe('fresh databases, refusals and rollback', () => {
  const fresh = () => { const d = new Database(':memory:'); d.pragma('foreign_keys = ON'); d.exec(SCHEMA); migrate(d); return d; };

  it('a fresh database is born in the same model a migrated one ends in (columns, keys, checks, indexes)', () => {
    const d = fresh();
    expect(extendOutreachRecipients(d)).toEqual([]);
    // LIVE DRIFT: the working database's outreach_send carries three columns that other branches'
    // migrations added while worktrees shared it; this repository never creates them. The rebuild
    // carries them across untouched (it copies the live definition), so they are excluded here.
    const DRIFT = new Set(['recipient_email', 'authorised_by_operator_id', 'authorisation_kind']);
    for (const t of RECIPIENT_TABLES) {
      const shape = (x) => x.prepare(`PRAGMA table_info(${t})`).all().filter((c) => !(t === 'outreach_send' && DRIFT.has(c.name))).map((c) => [c.name, c.type, c.notnull, c.pk]).sort();
      expect(shape(d), t).toEqual(shape(db));
      const fks = (x) => x.prepare(`PRAGMA foreign_key_list(${t})`).all().filter((f) => !(t === 'outreach_send' && DRIFT.has(f.from))).map((f) => [f.from, f.table, f.to, f.on_delete]).sort();
      expect(fks(d), t).toEqual(fks(db));
      expect(d.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(t).sql, t).toContain('CHECK ((coach_id IS NULL) <> (programme_contact_id IS NULL))');
      const idx = (x) => x.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL ORDER BY name").all(t);
      expect(idx(d), t).toEqual(idx(db));
    }
    d.close();
  });

  it('refuses to run inside a transaction (foreign keys cannot be switched off there)', () => {
    const d = fresh(); downgradeToPre1d(d);
    d.exec('BEGIN');
    expect(() => extendOutreachRecipients(d)).toThrow(/outside a transaction/);
    d.exec('ROLLBACK'); d.close();
  });

  it('a failure part-way rolls the whole rebuild back and restores foreign keys', () => {
    const d = fresh(); downgradeToPre1d(d);
    const s0 = schemaObjects(d);
    d.exec('CREATE TABLE outreach_send__1d (x)');             // the second table's scratch name is taken: its CREATE fails
    expect(() => extendOutreachRecipients(d)).toThrow();
    d.exec('DROP TABLE outreach_send__1d');
    expect(schemaObjects(d)).toEqual(s0);                    // outreach (rebuilt first) is back to pre-1D too
    expect(colsOf(d, 'outreach')).not.toContain('programme_contact_id');
    expect(d.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(extendOutreachRecipients(d)).toEqual(RECIPIENT_TABLES); // and a clean retry succeeds
    d.close();
  });

  it('the DDL rewrite refuses a definition it does not recognise rather than guessing', () => {
    expect(() => recipientTableSql('CREATE TABLE t (id TEXT, coach_id TEXT)', 't2')).toThrow(/exactly one coach_id/);
    expect(() => recipientTableSql('CREATE TABLE t (coach_id TEXT NOT NULL REFERENCES coaches(id), UNIQUE (id), extra TEXT)', 't2')).toThrow(/column follows a table constraint/);
  });
});
