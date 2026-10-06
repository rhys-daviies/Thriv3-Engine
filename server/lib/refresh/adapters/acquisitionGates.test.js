// Phase 8C.3C — acquisition gate safety: sport evidence, season evidence, gate order, challenge semantics,
// and the staging / promotion back-stops. Fixtures reproduce saved Phase 8C.3A / 8B.2 evidence (URL + title).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { sportEvidence, seasonEvidence, seasonsInText, SPORT_STATUS, SEASON_STATUS, SEASON_CLASS, AUTHORITATIVE_URL_SEASON } from './sourceEvidence.js';
import { refusePage, REFUSAL, DISPOSITION } from './adapterSafety.js';
import { judgeRosterPage, SOURCE_STATUS } from './sourceDiscovery.js';
import { rosterAdapter } from './gatherers.js';
import { blockReason, capturedPage } from './fetchPage.js';
import { rosterPageProof, classifyPage } from '../changeClassifier.js';
import { planPromotion } from '../promotion.js';
import { buildRegressionWorld, rosterPage } from '../regressionWorld.js';
import { loadRefreshContext } from '../context.js';

const PAD = 'x'.repeat(900);
const tableOf = (n) => `<table><thead><tr><th>No.</th><th>Name</th><th>Pos.</th><th>Cl.</th></tr></thead><tbody>${Array.from({ length: n }, (_, i) => `<tr><td>${i}</td><td><a href="#">Alex Keeper${String.fromCharCode(65 + i)}</a></td><td>MF</td><td>Fr.</td></tr>`).join('')}</tbody></table>`;
const html = (title, body = tableOf(12)) => `<html><head><title>${title}</title></head><body>${body}${PAD} prestosports</body></html>`;
const page = (url, title, body) => capturedPage({ url, fetched_at: '2026-10-06T00:00:00Z', body: html(title, body) });
const owned = (h) => h === 'athletics.pensacolastate.edu' || h === 'team.example' || h === 'angelinaathletics.com';
const intent = (sport, over = {}) => ({ kind: 'ROSTER', sport, season: 2026, entityOwnsHost: owned, ...over });
const players = Array.from({ length: 12 }, (_, i) => ({ player_name: `Player ${i}`, position: 'MF' }));
const sp = (url, title, sport, h = null) => sportEvidence({ url, title, html: h, sport });
const se = (url, title, h = null) => seasonEvidence({ url, title, html: h });

describe('A. sport evidence — a page must positively name the requested sport', () => {
  it("men's soccer Sidearm URL proves the sport even when the title is generic", () => {
    const e = sp('https://grccraiders.com/sports/mens-soccer/roster', 'Roster - GRCC Athletics', 'mens-soccer');
    expect(e.status).toBe(SPORT_STATUS.CONFIRMED); expect(e.signals[0]).toMatchObject({ kind: 'URL_SPORT_SLOT', value: 'mens-soccer' });
  });
  it("women's soccer Sidearm URL", () => {
    expect(sp('https://athletics.parkland.edu/sports/womens-soccer/roster', "2026 Women's Soccer Roster - Parkland College Athletics", 'womens-soccer').status).toBe(SPORT_STATUS.CONFIRMED);
  });
  it('soccer Presto path (msoc/wsoc) — and the sex is part of the sport', () => {
    expect(sp('https://hcccougars.com/sports/msoc/2026-27/roster', "2026 Men's Soccer Roster", 'mens-soccer').status).toBe(SPORT_STATUS.CONFIRMED);
    expect(sp('https://hcccougars.com/sports/msoc/2026-27/roster', "2026 Men's Soccer Roster", 'womens-soccer').status).toBe(SPORT_STATUS.CONTRADICTED);
  });
  it('Pensacola: the discovered /sports/bsb/ "Pirate Baseball Roster" is CONTRADICTED (the old check returned null for both signals)', () => {
    const e = sp('https://athletics.pensacolastate.edu/sports/bsb/2026-27/roster', '2026-27 Pirate Baseball Roster - Pensacola State College', 'womens-soccer');
    expect(e.status).toBe(SPORT_STATUS.CONTRADICTED); expect(e.detail).toMatch(/bsb/); expect(e.detail).toMatch(/baseball/);
  });
  it('a slot no list knows is still another sport: the slot is positive identification, not a blacklist', () => {
    expect(sp('https://x.example/sports/quidditch/2026-27/roster', 'Roster', 'womens-soccer').status).toBe(SPORT_STATUS.CONTRADICTED);
  });
  it('basketball and volleyball (Sidearm slugs, Presto codes, titles)', () => {
    expect(sp('https://x.example/sports/mens-basketball/roster', "2026-27 Men's Basketball Roster", 'mens-soccer').status).toBe(SPORT_STATUS.CONTRADICTED);
    expect(sp('https://x.example/sports/wvball/2026-27/roster', "2026 Women's Volleyball Roster", 'womens-soccer').status).toBe(SPORT_STATUS.CONTRADICTED);
    expect(sp('https://x.example/athletics/roster', "2026 Women's Volleyball Roster", 'womens-soccer').status).toBe(SPORT_STATUS.CONTRADICTED);
  });
  it('an ambiguous generic /roster with a generic title is UNRESOLVED — absence of another sport is not soccer', () => {
    const e = sp('https://x.example/roster', 'Roster - Example College', 'womens-soccer');
    expect(e.status).toBe(SPORT_STATUS.UNRESOLVED); expect(e.detail).toMatch(/no sport evidence/);
  });
  it('a generic URL whose title proves the sport is CONFIRMED by the title', () => {
    const e = sp('https://x.example/athletics/roster', "2026 Women's Soccer Roster - Example College", 'womens-soccer');
    expect(e.status).toBe(SPORT_STATUS.CONFIRMED); expect(e.signals.map((s) => s.kind)).toEqual(['TITLE']);
  });
  it('a soccer URL with a generic title is CONFIRMED by the URL (Minnesota West, "Roster - ...")', () => {
    expect(sp('https://mnwestathletics.com/sports/msoc/2026-27/roster', 'Roster - Minnesota West Community & Technical College', 'mens-soccer').status).toBe(SPORT_STATUS.CONFIRMED);
  });
  it('conflicting URL / title evidence is CONTRADICTED, whichever way round', () => {
    expect(sp('https://x.example/sports/wsoc/2026-27/roster', '2026-27 Baseball Roster', 'womens-soccer').status).toBe(SPORT_STATUS.CONTRADICTED);
    expect(sp('https://x.example/sports/msoc/2026-27/roster', "2026 Women's Soccer Roster", 'mens-soccer').status).toBe(SPORT_STATUS.CONTRADICTED);
  });
  it('sex-neutral "Soccer" confirms nothing alone, and contradicts nothing beside a sexed slot', () => {
    expect(sp('https://x.example/athletics/roster', '2026-27 Pirate Soccer Roster', 'womens-soccer').status).toBe(SPORT_STATUS.UNRESOLVED);
    expect(sp('https://athletics.pensacolastate.edu/sports/wsoc/2026-27/roster', '2026-27 Pirate Soccer Roster - Pensacola State College', 'womens-soccer').status).toBe(SPORT_STATUS.CONFIRMED);
    expect(sp('https://www.uscunionathletics.com/sports/wsoc/2026-27/roster', '2026-27 Lady Bantam Soccer Roster - USC Union', 'womens-soccer').status).toBe(SPORT_STATUS.CONFIRMED);
  });
  it('the page heading counts as evidence when the HTML is read; a site-logo heading does not', () => {
    const body = '<h1 class="site-title">Titans</h1><h1>Titans Women\'s Soccer Roster</h1>';
    expect(sp('https://x.example/athletics/roster', 'Titans - Example', 'womens-soccer', html('Titans - Example', body)).status).toBe(SPORT_STATUS.CONFIRMED);
  });
});

describe('A. the gate and discovery use sport evidence', () => {
  const bsb = page('https://athletics.pensacolastate.edu/sports/bsb/2026-27/roster', '2026-27 Pirate Baseball Roster - Pensacola State College');
  it('Pensacola baseball page: discovery judges it WRONG_SPORT_PAGE (it was CURRENT_ROSTER_FOUND in 8C.3A)', () => {
    expect(judgeRosterPage(bsb, 'womens-soccer').status).toBe('WRONG_SPORT_PAGE');
  });
  it('Pensacola baseball page: the gather gate REFUSES it as WRONG_SPORT', () => {
    const r = refusePage(bsb, intent('womens-soccer'), players);
    expect(r).toMatchObject({ code: REFUSAL.WRONG_SPORT, disposition: DISPOSITION.REFUSED }); expect(r.evidence.sport.status).toBe(SPORT_STATUS.CONTRADICTED);
  });
  it("Pensacola's real soccer page passes sport and season and reaches its parser classification (structure unknown)", async () => {
    const cards = '<div class="roster-card"><span>#7</span><b>Somebody</b></div>'.repeat(14);
    const real = async (url) => capturedPage({ url, fetched_at: '2026-10-06T00:00:00Z', body: html('2026-27 Pirate Soccer Roster - Pensacola State College', cards) });
    const t = { athletics_entity_id: 'AE-U136473', institution_label: 'Pensacola State College', sport: 'womens-soccer', host: 'athletics.pensacolastate.edu', platform: 'PRESTO', season: 2026 };
    const { refusal } = await rosterAdapter(t, { ownsHost: (h) => owned(h), fetch: real });
    expect(refusal.code).toBe(REFUSAL.STRUCTURE);
    expect(judgeRosterPage(await real(`https://${t.host}/sports/wsoc/2026-27/roster`), 'womens-soccer').status).toBe(SOURCE_STATUS.UNPARSED);
  });
  it('a readable roster at a generic URL with a generic title is SPORT_UNRESOLVED in discovery and HELD at the gate — never CURRENT', () => {
    const g = page('https://x.example/roster', '2026 Roster - Example College');
    expect(judgeRosterPage(g, 'womens-soccer')).toMatchObject({ status: SOURCE_STATUS.SPORT_UNRESOLVED, players: 12 });
    expect(refusePage(g, intent('womens-soccer', { entityOwnsHost: () => true }), players)).toMatchObject({ code: REFUSAL.SPORT_UNRESOLVED, disposition: DISPOSITION.HELD });
  });
});

describe('B. season evidence — the requested season is never evidence', () => {
  it('explicit 2026 title (single year and both range spellings)', () => {
    expect(se('https://x.example/sports/mens-soccer/roster', "2026 Men's Soccer Roster")).toMatchObject({ status: SEASON_STATUS.CONFIRMED, season: 2026, evidence_class: SEASON_CLASS.TITLE });
    expect(se('https://x.example/sports/wsoc/2026-27/roster', "2026-2027 Season Women's Soccer Roster").season).toBe(2026);
    expect(se('https://x.example/sports/wsoc/2026-27/roster', "2026-27 Women's Soccer Roster").season).toBe(2026);
  });
  it('an explicit 2026 URL token alone does NOT confirm: no URL architecture is authoritative (measured: hosts serve another season at the path)', () => {
    expect(AUTHORITATIVE_URL_SEASON.size).toBe(0);
    const e = se('https://northeasthawks.com/sports/msoc/2026-27/roster', "Northeast Men's Soccer Roster - Northeast Community College");
    expect(e.status).toBe(SEASON_STATUS.UNRESOLVED); expect(e.detail).toMatch(/non-authoritative URL season token/);
    expect(se('https://x.example/sports/mens-soccer/roster/2026', 'Roster').status).toBe(SEASON_STATUS.UNRESOLVED);
    expect(se('https://ntcceagles.com/mens-soccer/roster?season=fall_2026', "Men's Soccer Roster | Northeast Texas Community College").status).toBe(SEASON_STATUS.UNRESOLVED);
  });
  it('provider metadata: the Presto season selector\'s SELECTED option confirms (PROVIDER_METADATA); an unselected list does not', () => {
    const sel = (opts) => `<select id="season-selector" class="form-control season-filter">${opts}</select>`;
    const withSel = html('Titans Women\'s Soccer Roster', sel('<option value="/sports/wsoc/2026-27/roster" selected="selected">2026-27</option><option value="/sports/wsoc/2025-26/roster">2025-26</option>'));
    expect(se('https://x.example/sports/wsoc/2026-27/roster', null, withSel)).toMatchObject({ status: SEASON_STATUS.CONFIRMED, season: 2026, evidence_class: SEASON_CLASS.PROVIDER });
    const noneSelected = html('Titans Women\'s Soccer Roster', sel('<option value="/sports/wsoc/2025-26/roster">2025-26</option><option value="/sports/wsoc/2024-25/roster">2024-25</option>'));
    expect(se('https://x.example/sports/wsoc/2026-27/roster', null, noneSelected).status).toBe(SEASON_STATUS.UNRESOLVED);
  });
  it('page content: an <h1> naming the season (PAGE_CONTENT_EXPLICIT); title + provider together are MULTI_SIGNAL', () => {
    expect(se('https://x.example/athletics/roster', 'Roster', html('Roster', "<h1 class=\"page-heading\">2026 Richland Women's Soccer Roster</h1>"))).toMatchObject({ season: 2026, evidence_class: SEASON_CLASS.CONTENT });
    const both = html("2026 Richland Women's Soccer Roster", '<select id="season-selector"><option value="/sports/wsoc/2026-27/roster" selected="selected">2026-27</option></select>');
    expect(se('https://www.rlcsports.com/sports/wsoc/2026-27/roster', null, both)).toMatchObject({ status: SEASON_STATUS.CONFIRMED, evidence_class: SEASON_CLASS.MULTI });
  });
  it('a generic yearless title is UNRESOLVED', () => {
    expect(se('https://www.swic.edu/students/services/student-life/athletics/womens-soccer/roster/', "Women's Soccer Roster - Southwestern Illinois College").status).toBe(SEASON_STATUS.UNRESOLVED);
  });
  it('requested 2026 + no source evidence: HELD as SEASON_UNRESOLVED; the adapter stages nothing (was page_season ?? target.season)', async () => {
    expect(seasonEvidence({ url: 'https://x.example/sports/womens-soccer/roster', title: "Women's Soccer Roster", season: 2026 }).status).toBe(SEASON_STATUS.UNRESOLVED);
    const p = page('https://team.example/sports/womens-soccer/roster', "Women's Soccer Roster - Team College");
    expect(refusePage(p, intent('womens-soccer'), players)).toMatchObject({ code: REFUSAL.SEASON_UNRESOLVED, disposition: DISPOSITION.HELD });
    const r = await rosterAdapter({ athletics_entity_id: 'AE-1', institution_label: 'Team College', sport: 'womens-soccer', host: 'team.example', platform: 'SIDEARM', season: 2026 }, { ownsHost: (h) => owned(h), fetch: async (url) => capturedPage({ url, fetched_at: 't', body: p.body }), url: 'https://team.example/sports/womens-soccer/roster' });
    expect(r.page).toBeUndefined(); expect(r.refusal.code).toBe(REFUSAL.SEASON_UNRESOLVED);
  });
  it('URL 2026 + generic title: UNRESOLVED (the URL token corroborates only)', () => {
    expect(se('https://cgtctitans.com/sports/wsoc/2026-27/roster', "Titans Women's Soccer Roster - Central Georgia Tech Athletics").status).toBe(SEASON_STATUS.UNRESOLVED);
  });
  it('URL 2026 + title 2027 (Angelina, saved 8B.2 evidence): SEASON_CONTRADICTION, held — never silently resolved', () => {
    const e = se('https://angelinaathletics.com/sports/msoc/2026-27/roster', 'Roadrunner Soccer Roster 2027 - Angelina College');
    expect(e.status).toBe(SEASON_STATUS.CONTRADICTION); expect(e.season).toBeNull();
    const p = page('https://angelinaathletics.com/sports/msoc/2026-27/roster', 'Roadrunner Soccer Roster 2027 - Angelina College');
    expect(refusePage(p, intent('mens-soccer'), players)).toMatchObject({ code: REFUSAL.SEASON_CONTRADICTION, disposition: DISPOSITION.HELD });
  });
  it('title 2026 + URL 2025: SEASON_CONTRADICTION', () => {
    expect(se('https://x.example/sports/wsoc/2025-26/roster', "2026 Women's Soccer Roster").status).toBe(SEASON_STATUS.CONTRADICTION);
  });
  it('a malformed year contributes nothing', () => {
    expect(seasonsInText('2026-28 Roster')).toEqual({ found: [], malformed: ['2026-28'] });
    const e = se('https://x.example/athletics/roster', "2026-28 Women's Soccer Roster"); expect(e.status).toBe(SEASON_STATUS.UNRESOLVED); expect(e.detail).toMatch(/malformed/);
    expect(seasonsInText('Roster 20266').found).toEqual([]);
  });
  it('a historical roster requested as current is OLD_SEASON (refused); a later season than requested is a contradiction (held)', () => {
    expect(refusePage(page('https://team.example/sports/womens-soccer/roster', "2025 Women's Soccer Roster"), intent('womens-soccer'), players)).toMatchObject({ code: REFUSAL.OLD_SEASON, disposition: DISPOSITION.REFUSED });
    expect(refusePage(page('https://team.example/sports/womens-soccer/roster', "2027 Women's Soccer Roster"), intent('womens-soccer'), players)).toMatchObject({ code: REFUSAL.SEASON_CONTRADICTION, disposition: DISPOSITION.HELD });
  });
  it('a staged page carries the season the page proved, with its evidence', async () => {
    const body = html("2026 Men's Soccer Roster - Parkland College Athletics");
    const { page: p } = await rosterAdapter({ athletics_entity_id: 'AE-1', institution_label: 'Team', sport: 'mens-soccer', host: 'team.example', platform: 'PRESTO', season: 2026 }, { ownsHost: (h) => owned(h), fetch: async (url) => capturedPage({ url, fetched_at: 't', body }), url: 'https://team.example/sports/mens-soccer/roster' });
    expect(p.page_season).toBe(2026);
    expect(p.adapter_evidence.season_evidence).toMatchObject({ status: SEASON_STATUS.CONFIRMED, season: 2026, evidence_class: SEASON_CLASS.TITLE });
    expect(p.adapter_evidence.sport_evidence.status).toBe(SPORT_STATUS.CONFIRMED);
  });
});

describe('C. challenge semantics (production fetchPage.blockReason — unchanged)', () => {
  const ordinary = (extra = '') => `<html><head><title>2026 Men's Soccer Roster</title></head><body>${tableOf(20)}${extra}${PAD}</body></html>`;
  it('a normal HTTP 200 page that says "captcha" (a newsletter reCAPTCHA) is readable', () => {
    expect(blockReason({ status: 200, body: ordinary('<form><div class="g-recaptcha" data-sitekey="k"></div><p>Protected by reCAPTCHA. Captcha required.</p></form>') })).toBeNull();
  });
  it("an ordinary page with Cloudflare's end-of-body bot beacon (/cdn-cgi/challenge-platform/) is readable", () => {
    expect(blockReason({ status: 200, body: `${ordinary('x'.repeat(5000))}<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>` })).toBeNull();
  });
  it('a genuine Cloudflare challenge and a genuine AWS WAF response are BOT_CHALLENGE', () => {
    expect(blockReason({ status: 200, body: `<html><head><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></head>${PAD}</html>` })).toBe('BOT_CHALLENGE');
    expect(blockReason({ status: 200, body: `<html><head><title></title><script src="https://x.token.awswaf.com/challenge.js"></script><script>window.gokuProps={}</script></head>${PAD}</html>` })).toBe('BOT_CHALLENGE');
  });
  it('HTTP 403, 429 and 202 (AWS WAF challenge status) block; an ordinary roster page does not', () => {
    expect(blockReason({ status: 403, body: ordinary() })).toBe('HTTP_403');
    expect(blockReason({ status: 429, body: ordinary() })).toBe('HTTP_429');
    expect(blockReason({ status: 202, body: '' })).toBe('BOT_CHALLENGE');
    expect(blockReason({ status: 200, body: ordinary() })).toBeNull();
  });
});

describe('D. gate order: ownership -> sport -> season -> parser', () => {
  const yearlessBaseball = page('https://stranger.example/sports/bsb/roster', 'Baseball Roster');
  it('ownership is decided before sport', () => {
    expect(refusePage(yearlessBaseball, intent('womens-soccer'), players).code).toBe(REFUSAL.INSTITUTION_MISMATCH);
  });
  it('sport is decided before season', () => {
    expect(refusePage(page('https://team.example/sports/bsb/roster', 'Baseball Roster'), intent('womens-soccer'), players).code).toBe(REFUSAL.WRONG_SPORT);
  });
  it('season is decided before the parser (zero records / unreadable layout)', async () => {
    expect(refusePage(page('https://team.example/sports/womens-soccer/roster', "Women's Soccer Roster"), intent('womens-soccer'), []).code).toBe(REFUSAL.SEASON_UNRESOLVED);
    const unreadable = async (url) => capturedPage({ url, fetched_at: 't', body: html("Women's Soccer Roster", '<div class="mystery">?</div>'.repeat(20)) });
    const r = await rosterAdapter({ athletics_entity_id: 'AE-1', institution_label: 'T', sport: 'womens-soccer', host: 'team.example', platform: 'PRESTO', season: 2026 }, { ownsHost: (h) => owned(h), fetch: unreadable, url: 'https://team.example/sports/womens-soccer/roster' });
    expect(r.refusal.code).toBe(REFUSAL.SEASON_UNRESOLVED);
  });
});

describe('back-stops: staging and promotion refuse what the page did not prove', () => {
  let dir; let db; let ctx;
  const opts = { season: 2027, now: new Date('2027-08-20T00:00:00Z'), frozen: new Set([2025]) };
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p8c3c-')); const p = path.join(dir, 'w.sqlite'); buildRegressionWorld(p);
    db = new Database(p, { readonly: true }); ctx = { ...loadRefreshContext(db), coaches: db.prepare('SELECT * FROM coaches').all(), roster: db.prepare('SELECT * FROM roster_players').all() };
  });
  afterAll(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const pl = [{ player_name: 'Brand New', class_year_label: 'Fr.' }];
  it('a proven page stages NEW_RECORD with source_page_season from the page', () => {
    const out = classifyPage(rosterPage({ players: pl }), ctx, opts);
    expect(out[0].classification).toBe('NEW_RECORD'); expect(JSON.parse(JSON.stringify(out[0].proposed_json)).source_page_season ?? out[0].proposed_json.source_page_season).toBe(2027);
  });
  it('page_season null (a gatherer that proved no season) never stages a row — the requested season is not used', () => {
    const out = classifyPage(rosterPage({ page_season: null, players: pl }), ctx, opts);
    expect(out[0].classification).toBe('SOURCE_UNTRUSTED'); expect(JSON.stringify(out[0].evidence_json)).toMatch(/not evidence/);
  });
  it('page_season claimed without proof (generic title, URL token only, nothing recorded) is not staged', () => {
    const p = rosterPage({ players: pl }); p.adapter_evidence = { title: "Men's Soccer Roster - Concordia University Texas" };
    expect(rosterPageProof(p).cls).toBe('SOURCE_UNTRUSTED');
    p.adapter_evidence.season_evidence = { status: SEASON_STATUS.CONFIRMED, season: 2027, evidence_class: SEASON_CLASS.PROVIDER };
    expect(rosterPageProof(p)).toBeNull();
  });
  it('a wrong-sport title at staging is a CONTRADICTION; an unproven sport is not staged', () => {
    const p = rosterPage({ players: pl }); p.adapter_evidence = { title: '2027 Baseball Roster' };
    expect(classifyPage(p, ctx, opts)[0].classification).toBe('CONTRADICTION');
    const q = rosterPage({ source_url: 'https://concordiatx.example/roster', players: pl }); q.adapter_evidence = { title: '2027 Roster - Concordia University Texas' };
    expect(rosterPageProof(q)).toMatchObject({ cls: 'SOURCE_UNTRUSTED' });
  });
  it('promotion refuses an INSERT_ROSTER_ROW whose page season is missing or differs from the row season', () => {
    const obs = (id, p) => ({ observation_id: id, dataset: 'ROSTER', classification: 'NEW_RECORD', proposed_action: 'INSERT_ROSTER_ROW', requires_review: 0, proposed_json: JSON.stringify(p), expected_old_json: '{}', observed_season: 2026, target_key: id });
    const plan = planPromotion({ batch: { batch_id: 'B' }, observations: [obs('a', { season: '2026', source_page_season: null }), obs('b', { season: '2026', source_page_season: '2025' }), obs('c', { season: '2026', source_page_season: '2026' })] });
    expect(plan.ops.map((o) => o.observation_id)).toEqual(['c']); expect(plan.refused.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
