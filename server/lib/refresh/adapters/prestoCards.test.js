// Phase 8C.3D — Presto card-theme and split-name table capabilities. Fixtures reproduce the markup measured on
// NJCAA/USCAA hosts (names are invented). Every capability: positive, malformed, zero-player, staff, season, wrong sport.
import { describe, it, expect } from 'vitest';
import { parsePrestoCardsStrict, prestoCardNames, crossCheckCards, parseRosterTableStrict, STRUCTURE } from './rosterStructure.js';
import { rosterAdapter } from './gatherers.js';
import { capturedPage } from './fetchPage.js';
import { REFUSAL } from './adapterSafety.js';

const PAD = 'x'.repeat(900);
// card markup as measured: class printed inside the FRONT lastname span; clean name in aria-label and on the card back
const card = ({ first, last, cls = 'Fr', pos = 'MF', aria = true, back = true, frontSuffix = ` - ${cls}`, n = 1 }) => `<div class="player-card-wrapper"><div class="player-card">
  <div ${aria ? `aria-label="${first} ${last}: jersey number ${n}: full bio" ` : ''}class="card-front card-data"><div class="player-card-footer">
  <a href="/sports/wsoc/2026-27/bios/x"><span class="name"><span class="firstname">${first}</span> <span class="lastname">${last}${frontSuffix}</span></span></a><span class="number">${n}</span></div></div>
  <div class="player-short-bio card-back card-data"><div class="bio-content">${back ? `<div class="pl-name-wrap"><span class="number">#${n}</span><div class="pl-name"> <span class="firstname">${first}</span> <span class="lastname">${last}</span> </div></div>` : ''}
  <div class="bio-data"><ul><li><span>Class:</span> ${cls}</li><li><span>Position:</span> ${pos}</li></ul></div></div></div></div></div>`;
const roster = (cards, { title = "2026-27 Women's Soccer Roster - Example College", listView = false } = {}) => `<html><head><title>${title}</title></head><body class="prestosports">
  ${listView ? '<a class="roster-view" data-view="list" href="?view=list">List</a>' : ''}<div class="player-cards">${cards}</div>${PAD}</body></html>`;
const people = (k, over = {}) => Array.from({ length: k }, (_, i) => card({ first: `Alex${String.fromCharCode(65 + i)}`, last: `Keeper${String.fromCharCode(65 + i)}`, n: i + 1, ...over }));
const target = { athletics_entity_id: 'AE-1', institution_label: 'Example College', sport: 'womens-soccer', host: 'team.example', platform: 'PRESTO', season: 2026 };
const ownsHost = (h) => h === 'team.example';
const run = (body, url = 'https://team.example/sports/wsoc/2026-27/roster', t = target) => rosterAdapter(t, { ownsHost, url, fetch: async (u) => capturedPage({ url: u, fetched_at: '2026-10-06T00:00:00Z', body }) });

describe('Presto card names for the list-view cross-check', () => {
  it('read the clean label / card-back name, not the front span that carries the class', () => {
    expect(prestoCardNames(roster(people(2).join('')))).toEqual(['AlexA KeeperA', 'AlexB KeeperB']);
    expect(prestoCardNames(roster(card({ first: 'Sam', last: 'Lee', aria: false })))).toEqual(['Sam Lee']);           // card back
    expect(prestoCardNames(roster(card({ first: 'Sam', last: 'Lee', aria: false, back: false, frontSuffix: '' })))).toEqual(['Sam Lee']); // front only, clean theme
  });
  it('a list view that matches the cards passes; one that does not is still refused', () => {
    const list = (names) => `<table><thead><tr><th>No.</th><th>Name</th><th>Cl.</th></tr></thead><tbody>${names.map((nm, i) => `<tr><td>${i}</td><td>${nm}</td><td>Fr.</td></tr>`).join('')}</tbody></table>`;
    const cards = prestoCardNames(roster(people(3).join('')));
    expect(crossCheckCards(parseRosterTableStrict(list(['AlexA KeeperA', 'AlexB KeeperB', 'AlexC KeeperC'])), cards).structure.code).toBe(STRUCTURE.OK);
    expect(crossCheckCards(parseRosterTableStrict(list(['AlexA KeeperA', 'AlexB KeeperB', 'Someone Else'])), cards).structure.code).toBe(STRUCTURE.UNKNOWN);
  });
});

describe('Presto card theme with no list view (parsePrestoCardsStrict)', () => {
  it('positive: names from label/card back, fields only from the labelled bio list; "N/A" is no value', () => {
    const r = parsePrestoCardsStrict(roster([card({ first: 'Jo', last: 'Kicker', cls: 'So', pos: 'N/A' }), card({ first: 'Ri', last: 'Back', cls: 'Fr', pos: 'D' })].join('')));
    expect(r.structure.code).toBe(STRUCTURE.OK);
    expect(r.records).toEqual([{ player_name: 'Jo Kicker', position: null, class_year_label: 'So', hometown: null, nationality: null }, { player_name: 'Ri Back', position: 'D', class_year_label: 'Fr', hometown: null, nationality: null }]);
  });
  it('malformed: a card whose label and card-back names disagree, or that has neither, fails the WHOLE page', () => {
    const bad = card({ first: 'Jo', last: 'Kicker' }).replace('<span class="lastname">Kicker</span> </div>', '<span class="lastname">Someone</span> </div>');
    expect(parsePrestoCardsStrict(roster([...people(5), bad].join(''))).structure.code).toBe(STRUCTURE.UNKNOWN);
    const anon = card({ first: 'Jo', last: 'Kicker', aria: false, back: false });
    const r = parsePrestoCardsStrict(roster([...people(5), anon].join('')));
    expect(r.structure.code).toBe(STRUCTURE.UNKNOWN); expect(r.records).toEqual([]); expect(r.structure.detail).toMatch(/no label or card-back name/);
  });
  it('blank-name cards never create players', () => {
    const blank = card({ first: '', last: '', aria: false });
    expect(parsePrestoCardsStrict(roster([...people(5), blank].join(''))).records).toEqual([]);
  });
  it('zero players: no cards is NO markup, and the adapter refuses the page (never an empty roster)', async () => {
    expect(parsePrestoCardsStrict(roster('')).structure.code).toBe(STRUCTURE.NONE);
    const { refusal } = await run(roster('<div class="player-card">placeholder</div>'));
    expect([REFUSAL.STRUCTURE, REFUSAL.ZERO]).toContain(refusal.code);
  });
  it('staff cards are read with their role and refused by the adapter when they dominate the page', async () => {
    const staff = people(6, { pos: 'Assistant Coach' });
    expect(parsePrestoCardsStrict(roster(staff.join(''))).records[0].position).toBe('Assistant Coach');
    expect((await run(roster(staff.join('')))).refusal.code).toBe(REFUSAL.STAFF_IN_ROSTER);
  });
  it('the adapter stages a current-season card page as presto-cards-1 and refuses a prior-season one', async () => {
    const { page } = await run(roster(people(12).join('')));
    expect(page).toMatchObject({ page_season: 2026, parser_version: 'presto-cards-1' }); expect(page.players).toHaveLength(12);
    const old = await run(roster(people(12).join(''), { title: "2025-26 Women's Soccer Roster" }), 'https://team.example/sports/wsoc/roster');
    expect(old.refusal.code).toBe(REFUSAL.OLD_SEASON);
  });
  it('a yearless card page is held for season, whatever the cards say', async () => {
    expect((await run(roster(people(12).join(''), { title: "Titans Women's Soccer Roster" }))).refusal.code).toBe(REFUSAL.SEASON_UNRESOLVED);
  });
  it('wrong sport: a card page under another sport slot is refused before the cards are trusted', async () => {
    expect((await run(roster(people(12).join(''), { title: '2026-27 Baseball Roster' }), 'https://team.example/sports/bsb/2026-27/roster')).refusal.code).toBe(REFUSAL.WRONG_SPORT);
  });
  it('a page that DECLARES a list view never falls back to its cards', async () => {
    const body = roster(people(12).join(''), { listView: true });
    const fetch = async (u) => capturedPage({ url: u, fetched_at: 't', body: /view=list/.test(u) ? `<html><head><title>x</title></head><body>${PAD}</body></html>` : body });
    const r = await rosterAdapter(target, { ownsHost, fetch, url: 'https://team.example/sports/wsoc/2026-27/roster' });
    expect(r.page).toBeUndefined(); expect([REFUSAL.STRUCTURE, REFUSAL.ZERO]).toContain(r.refusal.code);
  });
});

describe('split First Name / Last Name roster tables', () => {
  const tbl = (rows, head = '<th>Number</th><th>First Name</th><th>Last Name</th><th>Position</th><th>Hometown</th>') => `<table><thead><tr>${head}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  it('positive: both halves make the name; other columns by meaning', () => {
    const r = parseRosterTableStrict(tbl([['1', 'Jo', 'Kicker', 'F', 'Town, ST'], ['2', 'Ri', 'Back', 'D', 'City, ST']]));
    expect(r.structure.code).toBe(STRUCTURE.OK); expect(r.records[0]).toMatchObject({ player_name: 'Jo Kicker', position: 'F', hometown: 'Town, ST' });
  });
  it('malformed: a missing half is a blank name — the whole page fails, nothing is completed', () => {
    expect(parseRosterTableStrict(tbl([['1', 'Jo', 'Kicker', 'F', 'T'], ['2', '', 'Back', 'D', 'T']])).structure.code).toBe(STRUCTURE.UNKNOWN);
    expect(parseRosterTableStrict(tbl([['1', 'Jo', '', 'F', 'T']])).records).toEqual([]);
  });
  it('ambiguous: a full Name column beside First/Last is refused', () => {
    expect(parseRosterTableStrict(tbl([['1', 'Jo Kicker', 'Jo', 'Kicker']], '<th>No.</th><th>Name</th><th>First Name</th><th>Last Name</th>')).structure.code).toBe(STRUCTURE.UNKNOWN);
  });
  it('zero players: a recognised split table with no rows is EMPTY', () => {
    expect(parseRosterTableStrict(tbl([])).structure.code).toBe(STRUCTURE.EMPTY);
  });
  it('staff rows are read as written; the adapter refuses a staff-dominated page', async () => {
    const page = `<html><head><title>2026-27 Women's Soccer Roster</title></head><body class="prestosports">${tbl(Array.from({ length: 6 }, (_, i) => [String(i), `Pat${i}`, `Coach${i}`, 'Head Coach', 'T']))}${PAD}</body></html>`;
    expect((await run(page)).refusal.code).toBe(REFUSAL.STAFF_IN_ROSTER);
  });
  it('season and sport gates still apply to split tables', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => [String(i), `Jo${i}`, `Kicker${i}`, 'MF', 'T']);
    const ok = await run(`<html><head><title>2026-27 Women's Soccer Roster</title></head><body class="prestosports">${tbl(rows)}${PAD}</body></html>`);
    expect(ok.page.players[0].player_name).toBe('Jo0 Kicker0');
    expect((await run(`<html><head><title>Roster</title></head><body class="prestosports">${tbl(rows)}${PAD}</body></html>`)).refusal.code).toBe(REFUSAL.SEASON_UNRESOLVED);
    expect((await run(`<html><head><title>2026-27 Volleyball Roster</title></head><body class="prestosports">${tbl(rows)}${PAD}</body></html>`, 'https://team.example/sports/wvball/2026-27/roster')).refusal.code).toBe(REFUSAL.WRONG_SPORT);
  });
});
