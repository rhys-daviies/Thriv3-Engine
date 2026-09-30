import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildRegressionWorld, rosterPage } from './regressionWorld.js';
import { loadRefreshContext } from './context.js';
import { classifyPage, personKey, nameFormatKey, PROMOTABLE } from './changeClassifier.js';
import { planPromotion } from './promotion.js';

/**
 * PHASE 8B.1 Parts M/N/O — player identity. A roster row is a SEASON ROSTER OBSERVATION of a
 * programme; there is no global player identity, and a name alone must never create one.
 * These cases pin what the refresh classifier may and may not conclude from names.
 */
let dir; let db; let base;
const opts = { season: 2027, now: new Date('2027-08-20T00:00:00Z'), frozen: new Set([2025]) };
const row = (id, school, season, name, cls, extra = {}) => ({ id, college_name: school, sport: 'mens-soccer', division: 'NAIA', season: String(season), player_name: name, class_year_label: cls, position: 'MF', nationality: null, hometown: null, ...extra });
const CTX = 'Concordia University Texas'; const CUNE = 'Concordia (NE)';
const cunePage = (players) => rosterPage({ source_url: 'https://cune.example/sports/mens-soccer/roster/2027', institution_label: CUNE, players });
const ctxPage = (players, over = {}) => rosterPage({ players, ...over });
const run = (page, roster) => classifyPage(page, { ...base, roster }, opts);
const writes = (out) => out.filter((o) => PROMOTABLE.has(o.classification) && o.proposed_action);
const ev = (o) => (typeof o.evidence_json === 'string' ? JSON.parse(o.evidence_json) : o.evidence_json || {});

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p8b1-id-'));
  const p = path.join(dir, 'w.sqlite'); buildRegressionWorld(p);
  db = new Database(p, { readonly: true });
  base = { ...loadRefreshContext(db), coaches: [] };
});
afterAll(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('name keys', () => {
  it('personKey is accent/case/punctuation-insensitive; nameFormatKey also ignores order', () => {
    expect(personKey('José Núñez')).toBe(personKey('Jose Nunez'));
    expect(personKey('Smith, John')).not.toBe(personKey('John Smith'));
    expect(nameFormatKey('Smith, John')).toBe(nameFormatKey('John Smith'));
    expect(nameFormatKey("O'Neil-Brown")).toBe(nameFormatKey('ONeil Brown'));
  });
});

describe('same-name players are never merged', () => {
  it('the same name on two programmes in one season: two independent observations, the second flagged for review', () => {
    const out = run(ctxPage([{ player_name: 'Jordan Lee', class_year_label: 'Fr.' }]), [row('x1', CUNE, 2027, 'Jordan Lee', 'So.')]);
    const o = out.find((x) => x.proposed_action === 'INSERT_ROSTER_ROW');
    expect(o.classification).toBe('NEW_RECORD'); expect(o.requires_review).toBe(1);
    expect(ev(o).notes.join(' ')).toMatch(/same name on another 2027 roster: Concordia \(NE\)/);
    expect(out.some((x) => x.target_key === 'x1')).toBe(false); // the other programme's row is never a target
  });
  it('two players with the same name on ONE roster are ambiguous, not one person', () => {
    const out = run(ctxPage([{ player_name: 'Jordan Lee', class_year_label: 'Fr.' }, { player_name: 'Jordan Lee', class_year_label: 'Sr.' }]), []);
    expect(out.filter((x) => x.classification === 'IDENTITY_AMBIGUOUS')).toHaveLength(2); expect(writes(out)).toHaveLength(0);
  });
  it('siblings (same surname) are independent players', () => {
    const out = run(ctxPage([{ player_name: 'Sam Rivera', class_year_label: 'Fr.' }, { player_name: 'Alex Rivera', class_year_label: 'Jr.' }]), []);
    expect(writes(out).map((o) => o.proposed_action)).toEqual(['INSERT_ROSTER_ROW', 'INSERT_ROSTER_ROW']);
  });
});

describe('name formatting changes never create a second row for the same player-season', () => {
  it('"Smith, John" held for 2027; the page prints "John Smith" -> IDENTITY_AMBIGUOUS, nothing inserted, nothing merged', () => {
    const out = run(ctxPage([{ player_name: 'John Smith', class_year_label: 'So.' }]), [row('h1', CTX, 2027, 'Smith, John', 'So.')]);
    expect(out[0].classification).toBe('IDENTITY_AMBIGUOUS'); expect(out[0].requires_review).toBe(1);
    expect(writes(out)).toHaveLength(0);
    expect(out.some((x) => x.target_key === 'h1' && x.classification === 'DISAPPEARED_FROM_SOURCE')).toBe(false);
  });
  it('an apostrophe/hyphen variant is caught the same way', () => {
    const out = run(ctxPage([{ player_name: "Sean O'Neil", class_year_label: 'Fr.' }]), [row('h2', CTX, 2027, 'Sean ONeil', 'Fr.')]);
    expect(out[0].classification).toBe('IDENTITY_AMBIGUOUS');
  });
  it('an accent-only difference is the same player-season (fills, never duplicates)', () => {
    const out = run(ctxPage([{ player_name: 'José Núñez', class_year_label: 'Fr.', position: 'GK' }]), [row('h3', CTX, 2027, 'Jose Nunez', 'Fr.', { position: null })]);
    expect(out[0].classification).toBe('VERIFIED_UPDATE'); expect(out[0].proposed_action).toBe('FILL_ROSTER_FIELDS');
  });
});

describe('transfers (Part N): School A 2026 -> School B 2027', () => {
  const history = [row('a26', CTX, 2026, 'Riley Chen', 'Fr.')];
  it('B 2027 is a NEW observation carrying a TRANSFER CANDIDATE note; A 2026 is never touched', () => {
    const out = run(cunePage([{ player_name: 'Riley Chen', class_year_label: 'So.' }]), history);
    const o = out.find((x) => x.proposed_action === 'INSERT_ROSTER_ROW');
    expect(o.classification).toBe('NEW_RECORD');
    expect(o.proposed_json.college_name ?? JSON.parse(JSON.stringify(o.proposed_json)).college_name).toBe(CUNE);
    expect(ev(o).notes.join(' ')).toMatch(/TRANSFER CANDIDATE: same name on Concordia University Texas 2026 — not linked automatically/);
    expect(out.some((x) => x.target_key === 'a26')).toBe(false); // A's history is not a target at all
  });
  it('the transfer is never linked or merged: no observation proposes to change the 2026 row', () => {
    const out = run(cunePage([{ player_name: 'Riley Chen', class_year_label: 'So.' }]), history);
    expect(out.every((x) => !x.expected_old_json || JSON.stringify(x.expected_old_json).indexOf('a26') === -1)).toBe(true);
  });
  it('a returning player (same programme, next season) is a NEW season row, not an edit of the old one', () => {
    const out = run(ctxPage([{ player_name: 'Riley Chen', class_year_label: 'So.' }]), [row('a26x', CTX, 2026, 'Riley Chen', 'Fr.')]);
    const o = out.find((x) => x.proposed_action === 'INSERT_ROSTER_ROW');
    expect(ev(o).notes.join(' ')).toMatch(/continuation of the prior-season roster/);
    expect(out.some((x) => x.target_key === 'a26x' && x.proposed_action)).toBe(false);
  });
});

describe('missing players (Part O): on the 2026 roster, absent from 2027', () => {
  it('NOT_OBSERVED_CURRENT_SEASON — informational, never an action, never a deletion', () => {
    const out = run(ctxPage([{ player_name: 'Sam Winger', class_year_label: 'Jr.' }]), [row('m26', CTX, 2026, 'Casey Keeper', 'So.'), row('w26', CTX, 2026, 'Sam Winger', 'So.')]);
    const miss = out.find((x) => x.target_key === 'm26');
    expect(miss.classification).toBe('DISAPPEARED_FROM_SOURCE'); expect(miss.proposed_action).toBeNull(); expect(PROMOTABLE.has(miss.classification)).toBe(false);
    expect(ev(miss).status).toBe('NOT_OBSERVED_CURRENT_SEASON');
    expect(out.some((x) => x.target_key === 'w26')).toBe(false); // the returning player's old row is untouched too
  });
  it('an incomplete page never produces absence at all', () => {
    const out = run(ctxPage([{ player_name: 'Sam Winger', class_year_label: 'Jr.' }], { source_complete: false }), [row('m26', CTX, 2026, 'Casey Keeper', 'So.')]);
    expect(out.some((x) => x.target_key === 'm26')).toBe(false);
  });
});

describe('roster promotion classification (what 8B.2 could do automatically)', () => {
  it('only an unambiguous, review-free new player-season becomes a write; ambiguity / not-observed / same-name are never auto-written', () => {
    const roster = [row('amb', CTX, 2027, 'Smith, John', 'So.'), row('gone', CTX, 2026, 'Casey Keeper', 'So.'), row('elsewhere', CUNE, 2027, 'Jordan Lee', 'Jr.')];
    const out = run(ctxPage([{ player_name: 'Alex Keeper', class_year_label: 'Fr.' }, { player_name: 'John Smith', class_year_label: 'So.' }, { player_name: 'Jordan Lee', class_year_label: 'Fr.' }]), roster)
      .map((o, i) => ({ ...o, observation_id: `o${i}`, proposed_json: JSON.stringify(o.proposed_json ?? null), expected_old_json: JSON.stringify(o.expected_old_json ?? null) }));
    const plan = planPromotion({ batch: { batch_id: 'B' }, observations: out });
    expect(plan.ops.map((x) => x.proposed.player_name)).toEqual(['Alex Keeper']);
    expect(plan.refused.map((r) => r.why)).toEqual(['INSERT_ROSTER_ROW requires an APPROVED review']); // Jordan Lee: same name on another 2027 roster
    expect(plan.skipped.IDENTITY_AMBIGUOUS).toBe(1); expect(plan.skipped.DISAPPEARED_FROM_SOURCE).toBe(1);
  });
});
