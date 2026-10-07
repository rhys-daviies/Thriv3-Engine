import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildRegressionWorld, staffPage } from './regressionWorld.js';
import { stageRefresh } from './staging.js';
import { PC_EVIDENCE_RULE } from './changeClassifier.js';

/**
 * PHASE 1G-B (B3) — classification of programme-contact evidence by the SLOT it was published in,
 * on the regression world (Concordia University Texas, entity AE-U900101, athletics host
 * concordiatx.example, mail domain concordiatx.edu.example).
 */
const NOW = new Date('2027-08-21T00:00:00.000Z');
const INBOX = 'msoccer@concordiatx.edu.example';
const URL = 'https://concordiatx.example/sports/mens-soccer/coaches';
let dir; let dbPath;
const page = (contacts, over = {}) => ({ dataset: 'PROGRAMME_CONTACT', source_kind: 'OFFICIAL_STAFF_DIRECTORY', source_url: URL, fetched_at: '2027-08-20T00:00:00.000Z', observed_season: 2027,
  parser_version: 'pc-slots-1', institution_label: 'Concordia University Texas', sport: 'mens-soccer', source_complete: true,
  adapter_evidence: { sha256: 'a'.repeat(64), staff_rows: 5 }, contacts, ...over });
const c = (email, slot, extra = {}) => ({ email, email_origin: 'PUBLISHED_ON_SOURCE', slot, person_count: slot === 'SHARED' ? 3 : slot === 'PERSON' ? 1 : 0, labels: [], context_text: 'Head Coach / Assistant Coach', ...extra });
const stage = (db, pages) => stageRefresh(db, { season: 2027, scope: 'NAIA', parser_version: 'pc-slots-1', gathered_at: '2027-08-20T00:00:00Z', pages }, { now: NOW });
const one = (db, contact, over) => { const s = stage(db, [page([contact], over)]); expect(s.observations).toHaveLength(1); return s.observations[0]; };
const ev = (o) => JSON.parse(o.evidence_json || '{}');

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p1gb-b3-')); dbPath = path.join(dir, 'w.sqlite'); buildRegressionWorld(dbPath); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('qualifying slots', () => {
  it('an address shared by two or more named people is a NEW_RECORD with a deterministic slot evidence record', () => {
    const db = new Database(dbPath);
    const o = one(db, c(INBOX, 'SHARED'));
    expect(o).toMatchObject({ classification: 'NEW_RECORD', proposed_action: 'CREATE_PROGRAMME_CONTACT' });
    expect(JSON.parse(o.proposed_json).contact_role).toBe('TEAM_INBOX');
    expect(ev(o)).toMatchObject({ rule: PC_EVIDENCE_RULE, slot: 'SHARED', person_count: 3, page_sha256: 'a'.repeat(64), parser_version: 'pc-slots-1', staff_rows: 5 });
    db.close();
  });
  it('a recruiting slot is a RECRUITING_INBOX; a team slot a TEAM_INBOX; a coach\'s job title never makes it recruiting', () => {
    const db = new Database(dbPath);
    expect(JSON.parse(one(db, c(INBOX, 'RECRUITING_SLOT', { labels: ['All Recruit Emails'] })).proposed_json).contact_role).toBe('RECRUITING_INBOX');
    expect(JSON.parse(one(db, c(INBOX, 'TEAM_SLOT', { labels: ['Team Email'] })).proposed_json).contact_role).toBe('TEAM_INBOX');
    expect(JSON.parse(one(db, c(INBOX, 'SHARED', { context_text: 'Assistant Coach & Recruiting Coordinator', recruiting: false })).proposed_json).contact_role).toBe('TEAM_INBOX');
    expect(one(db, c(INBOX, 'CONTACT_BLOCK', { recruiting: true })).classification).toBe('NEW_RECORD');
    db.close();
  });
  it('the same evidence stages the same observation (deterministic)', () => {
    const db = new Database(dbPath);
    const a = stage(db, [page([c(INBOX, 'SHARED')])]); const b = stage(db, [page([c(INBOX, 'SHARED')])]);
    expect(a.batch.batch_hash).toBe(b.batch.batch_hash);
    expect(a.observations[0].evidence_json).toBe(b.observations[0].evidence_json);
    db.close();
  });
});

describe('refusals', () => {
  it('an address against ONE named person is coach intelligence: CONTRADICTION for review, never staged as a contact', () => {
    const db = new Database(dbPath);
    const o = one(db, c(INBOX, 'PERSON', { attached_to_person: true }));
    expect(o).toMatchObject({ classification: 'CONTRADICTION', proposed_action: null, requires_review: 1 });
    expect(ev(o)).toMatchObject({ slot: 'PERSON', person_count: 1 });
    db.close();
  });
  it('no slot, an unknown slot, or a SHARED slot without two people is refused', () => {
    const db = new Database(dbPath);
    expect(one(db, c(INBOX, undefined)).classification).toBe('SOURCE_UNTRUSTED');
    expect(one(db, c(INBOX, 'FOOTER')).classification).toBe('SOURCE_UNTRUSTED');
    const o = one(db, c(INBOX, 'SHARED', { person_count: 1 }));
    expect(o.classification).toBe('SOURCE_UNTRUSTED');
    expect(ev(o).why.join()).toMatch(/two or more distinct named people/);
    db.close();
  });
  it('a shared slot is necessary, not sufficient: the address must still pass the whole floor', () => {
    const db = new Database(dbPath);
    const o = one(db, c('msoccer@unowned-domain.example', 'SHARED'));
    expect(['SOURCE_UNTRUSTED', 'CONTRADICTION']).toContain(o.classification);
    expect(o.proposed_action).toBeNull();
    expect(ev(o).why.join()).toMatch(/PC_ADDRESS_DOMAIN/);
    db.close();
  });
});

describe('host-only page gate (programme contacts only)', () => {
  it('a path-scoped location does not qualify a programme-contact page, while the same URL still serves coach evidence', () => {
    const db = new Database(dbPath);
    db.prepare(`INSERT INTO athletics_source_locations (location_id, athletics_entity_id, host, path_prefix, source_type, sport, status, evidence_url, provenance, recorded_at)
      VALUES ('loc-1', 'AE-U900101', 'ctx-institution.example', '/athletics', 'INSTITUTION_ATHLETICS_PATH', NULL, 'VERIFIED', 'https://ctx-institution.example/athletics', 'test', '2027-01-01')`).run();
    const pathUrl = 'https://ctx-institution.example/athletics/sports/mens-soccer/coaches';
    const pc = one(db, c(INBOX, 'SHARED'), { source_url: pathUrl });
    expect(pc.classification).toBe('SOURCE_UNTRUSTED');
    expect(pc.source_tier).toBe('D');
    const coach = stage(db, [staffPage({ source_url: pathUrl, people: [{ full_name: 'Pat Headcoach', role: 'Head Coach', email: 'pat.headcoach@concordiatx.example', email_origin: 'PUBLISHED_ON_SOURCE' }] })]);
    expect(coach.observations.length).toBeGreaterThan(0);
    expect(coach.observations.every((o) => o.source_tier === 'A')).toBe(true);
    db.close();
  });
});
