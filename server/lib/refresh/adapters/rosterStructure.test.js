import { describe, it, expect } from 'vitest';
import { parseRosterTableStrict, validateRecords, headerRole, implausibleName, decodeEntities, STRUCTURE } from './rosterStructure.js';
import { parseRosterTable } from './presto.js';
import { parseSidearmRosterStrict, countSidearmRoster } from './sidearm.js';
import { rosterAdapter } from './gatherers.js';
import { capturedPage } from './fetchPage.js';
import { refusePage, REFUSAL } from './adapterSafety.js';

/**
 * PHASE 8B.1 — roster parsers fail closed. Fixtures are synthetic (fake names) but reproduce the
 * markup variations measured on live Presto / Sidearm / custom rosters. A layout the parser cannot
 * validate must become PARSER_STRUCTURE_UNKNOWN, never a set of fabricated observations.
 */
const lbl = (t) => `<span class="label font-weight-bold fw-bold d-md-none">${t}</span>`;
const head = (cols) => `<thead class="thead-dark"><tr>${cols.map((c) => `<th scope="col">${c}</th>`).join('')}</tr></thead>`;
const table = (cols, rows) => `<table>${head(cols)}<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const DESKTOP = table(['No.', 'Name', 'Pos.', 'Cl.', 'Hometown/High School'], [['1', 'Alex Keeper', 'GK', 'Fr.', 'Town, ST'], ['7', 'Sam Winger', 'F', 'So.', 'City, ST']]);
const responsiveRow = (no, name, pos, cl, town) => `<tr><td class="text-nowrap jersey-number d-md-none"><span class="badge">${no}</span></td><td class="jersey-number d-none d-md-table-cell">${lbl('No.:')} ${no}</td><th scope="row"><a href="/bios/x">${name}</a><div class="social-links-inline"><ul></ul></div></th><td>${lbl('Pos.:')} ${pos}</td><td>${lbl('Cl.:')} ${cl}</td><td>${lbl('Hometown/High School:')} ${town}</td></tr>`;
const RESPONSIVE = `<table>${head(['No.', 'Name', 'Pos.', 'Cl.', 'Hometown/High School'])}<tbody>${responsiveRow('00', 'Alex Keeper', 'GK', 'Fr.', 'Town, ST /')}${responsiveRow('7', 'Sam Winger', 'F', 'So.', 'City, ST /')}</tbody></table>`;

describe('semantic header mapping (no positional parsing)', () => {
  it('maps headers by meaning', () => {
    expect(['No.', '#', 'Name', 'Pos.', 'Position', 'Cl.', 'Yr.', 'Academic Year', 'Ht.', 'Hometown/High School', 'Nationality', 'Coach Notes'].map(headerRole))
      .toEqual(['number', 'number', 'name', 'position', 'position', 'class', 'class', 'class', 'height', 'hometown', 'nationality', null]);
  });
  it('desktop table', () => {
    const r = parseRosterTableStrict(DESKTOP);
    expect(r.structure.code).toBe(STRUCTURE.OK);
    expect(r.records).toEqual([
      { player_name: 'Alex Keeper', position: 'GK', class_year_label: 'Fr.', hometown: 'Town, ST', nationality: null },
      { player_name: 'Sam Winger', position: 'F', class_year_label: 'So.', hometown: 'City, ST', nationality: null },
    ]);
  });
  it('mobile-only duplicate cells and hidden labels (the Phase 8A defect) never shift the columns', () => {
    const r = parseRosterTableStrict(RESPONSIVE);
    expect(r.structure.code).toBe(STRUCTURE.OK);
    expect(r.records.map((x) => [x.player_name, x.position, x.class_year_label])).toEqual([['Alex Keeper', 'GK', 'Fr.'], ['Sam Winger', 'F', 'So.']]);
  });
  it('reordered columns follow the headers, not the positions', () => {
    const r = parseRosterTableStrict(table(['Pos.', 'Cl.', 'Name', 'No.'], [['GK', 'Jr.', 'Alex Keeper', '1']]));
    expect(r.records[0]).toMatchObject({ player_name: 'Alex Keeper', position: 'GK', class_year_label: 'Jr.' });
  });
  it('a missing number or class column is fine; the value is null', () => {
    const r = parseRosterTableStrict(table(['Name', 'Pos.'], [['Alex Keeper', 'GK']]));
    expect(r.structure.code).toBe(STRUCTURE.OK);
    expect(r.records[0]).toMatchObject({ player_name: 'Alex Keeper', class_year_label: null });
  });
  it('grouped header rows use the last header row', () => {
    const t = `<table><thead><tr><th colspan="2">Player</th><th colspan="2">Info</th></tr><tr><th>No.</th><th>Name</th><th>Pos.</th><th>Cl.</th></tr></thead><tbody><tr><td>3</td><td>Alex Keeper</td><td>D</td><td>Fr.</td></tr></tbody></table>`;
    expect(parseRosterTableStrict(t).records[0]).toMatchObject({ player_name: 'Alex Keeper', position: 'D' });
  });
});

describe('names survive intact', () => {
  it('suffixes, apostrophes, hyphens and accents (named and numeric entities)', () => {
    const r = parseRosterTableStrict(table(['Name', 'Pos.'], [['Quill Testwood Jr.', 'D'], ['Sean O&#39;Neil', 'M'], ['Ana Garc&iacute;a-L&oacute;pez', 'F'], ['Jos&#233; Nu&#x00F1;ez III', 'GK'], ['Zo&euml; M&uuml;ller', 'M']]));
    expect(r.structure.code).toBe(STRUCTURE.OK);
    expect(r.records.map((x) => x.player_name)).toEqual(['Quill Testwood Jr.', "Sean O'Neil", 'Ana García-López', 'José Nuñez III', 'Zoë Müller']);
  });
  it('decodes entities without inventing characters', () => {
    expect(decodeEntities('Fran&ccedil;ois &amp; &unknown;')).toBe('François & &unknown;');
  });
  it('a label, a number, a blank or a staff title is never a name', () => {
    expect(['No.:', 'Pos.', '23', '', 'Head Coach Pat Lead', 'Alex Keeper'].map(implausibleName)).toEqual(['label', 'label', 'no letters', 'blank', 'staff title', null]);
  });
});

describe('fail closed', () => {
  it('a row wider than the header (without a mobile-only marker) makes the whole page unknown', () => {
    const t = `<table>${head(['No.', 'Name', 'Pos.'])}<tbody><tr><td>1</td><td>Alex Keeper</td><td>GK</td><td>extra</td></tr></tbody></table>`;
    const r = parseRosterTableStrict(t);
    expect(r.structure.code).toBe(STRUCTURE.UNKNOWN); expect(r.records).toEqual([]);
  });
  it('a label read as a name makes the whole page unknown — no partial observations', () => {
    const t = table(['No.', 'Name', 'Pos.'], [['1', 'Alex Keeper', 'GK'], ['2', 'No.:', 'D']]);
    const r = parseRosterTableStrict(t);
    expect(r.structure.code).toBe(STRUCTURE.UNKNOWN); expect(r.records).toEqual([]);
    expect(parseRosterTable(t)).toEqual([]);
  });
  it('a table with a name column but no supporting roster column is not a roster', () => {
    expect(parseRosterTableStrict(table(['Name', 'Title'], [['Pat Lead', 'Head Coach']])).structure.code).toBe(STRUCTURE.UNKNOWN);
  });
  it('a card layout the parser does not read is unknown, not "zero players"', () => {
    const cards = '<div class="roster-card"><div class="name">Alex Keeper</div></div><div class="roster-card"><div class="name">Sam Winger</div></div>';
    expect(parseRosterTableStrict(cards).structure.code).toBe(STRUCTURE.UNKNOWN);
  });
  it('an empty roster table is EMPTY (a zero refusal later), never a disappearance', () => {
    expect(parseRosterTableStrict(table(['No.', 'Name', 'Pos.'], [])).structure.code).toBe(STRUCTURE.EMPTY);
  });
  it('a page with no roster markup at all is NONE', () => {
    expect(parseRosterTableStrict('<p>Welcome to athletics</p>').structure.code).toBe(STRUCTURE.NONE);
  });
});

describe('Sidearm and custom structure validation', () => {
  const li = (n, pos) => `<li class="sidearm-roster-player"><div class="sidearm-roster-player-name"><a href="/x">${n}</a></div><span class="sidearm-roster-player-position">${pos}</span></li>`;
  it('classic Sidearm list', () => {
    const r = parseSidearmRosterStrict(`<ul>${li('Alex Keeper', 'GK')}${li('Ren&eacute; Dubois', 'D')}</ul>`);
    expect(r.structure.code).toBe(STRUCTURE.OK); expect(r.records.map((x) => x.player_name)).toEqual(['Alex Keeper', 'René Dubois']);
  });
  it('Sidearm roster markup that yields no readable player is unknown', () => {
    const r = parseSidearmRosterStrict('<li class="sidearm-roster-player"><span>?</span></li>');
    expect(r.structure.code).toBe(STRUCTURE.UNKNOWN); expect(countSidearmRoster('<li class="sidearm-roster-player"><span>?</span></li>')).toBe(0);
  });
  it('Sidearm table view goes through the semantic table parser', () => {
    expect(parseSidearmRosterStrict(`<div class="sidearm-table">${DESKTOP}</div>`).records).toHaveLength(2);
  });
  it('custom records with implausible names are refused as a set', () => {
    expect(validateRecords([{ player_name: 'Alex Keeper' }, { player_name: 'No.:' }], { markupSeen: true }).code).toBe(STRUCTURE.UNKNOWN);
  });
});

describe('the roster adapter refuses what the parser cannot validate', () => {
  const target = { athletics_entity_id: 'AE-U240000', institution_label: 'Casper College', sport: 'mens-soccer', host: 'casper.example', platform: 'PRESTO', season: 2026 };
  const ownsHost = (h, e) => h === 'casper.example' && e === 'AE-U240000';
  const fetchOf = (body) => async (url) => capturedPage({ url, fetched_at: '2026-10-01T00:00:00Z', body: `<title>2026-27 Men's Soccer Roster - Casper College</title>${body}${'x'.repeat(900)} prestosports` });
  it('responsive markup stages the right names', async () => {
    const { page } = await rosterAdapter(target, { ownsHost, fetch: fetchOf(RESPONSIVE.replace(/Alex Keeper|Sam Winger/g, (m) => m)) });
    expect(page.players.map((p) => p.player_name)).toEqual(['Alex Keeper', 'Sam Winger']);
  });
  it('an unknown structure is PARSER_STRUCTURE_UNKNOWN — nothing is staged', async () => {
    const bad = table(['No.', 'Name', 'Pos.'], [['1', 'No.:', 'GK'], ['2', 'Pos.:', 'D']]);
    const r = await rosterAdapter(target, { ownsHost, fetch: fetchOf(bad) });
    expect(r.page).toBeUndefined(); expect(r.refusal.code).toBe(REFUSAL.STRUCTURE);
  });
  it('an empty roster is a ZERO refusal; a prior-season page is OLD_SEASON; embedded staff are refused', async () => {
    expect((await rosterAdapter(target, { ownsHost, fetch: fetchOf(table(['No.', 'Name', 'Pos.'], [])) })).refusal.code).toBe(REFUSAL.ZERO);
    const old = async (url) => capturedPage({ url, fetched_at: '2026-10-01T00:00:00Z', body: `<title>2025-26 Men's Soccer Roster</title>${DESKTOP}${'x'.repeat(900)}` });
    // Phase 8C.3C: the target URL carries a 2026-27 season token, so a 2025-26 title DISAGREES with it — a contradiction
    // held for a person, not silently read as "old"; the same title at a seasonless URL is OLD_SEASON
    expect((await rosterAdapter(target, { ownsHost, fetch: old })).refusal.code).toBe(REFUSAL.SEASON_CONTRADICTION);
    expect((await rosterAdapter({ ...target, platform: 'SIDEARM' }, { ownsHost, fetch: old, url: `https://${target.host}/sports/mens-soccer/roster` })).refusal.code).toBe(REFUSAL.OLD_SEASON);
    const withStaff = [{ player_name: 'Alex Keeper', position: 'GK' }, { player_name: 'Pat Lead', position: 'Head Coach' }, { player_name: 'Bo Help', position: 'Assistant Coach' }];
    expect(refusePage(capturedPage({ url: 'https://casper.example/r', fetched_at: 'x', body: `<title>2026-27 Men's Soccer Roster</title>${'x'.repeat(900)}` }), { kind: 'ROSTER', sport: 'mens-soccer', season: 2026 }, withStaff).code).toBe(REFUSAL.STAFF_IN_ROSTER);
  });
});

describe('Presto player-card theme (Part J adapter): the declared list view, cross-checked', () => {
  const card = (first, last) => `<div class="player-card-wrapper position-relative"><div class="player-card card"><a href="/bios/x"><span class="name"><span class="firstname d-block">${first}</span> <span class="lastname d-block">${last}</span></span></a><span class="number">7</span><div class="bio-attr-short"><span class="text-muted">Defender</span><span class="text-muted">FR</span></div></div></div>`;
  const cardsPage = (people) => `<title>2026-27 Men's Soccer Roster - Casper College</title><a class="roster-view btn" data-view="list" href="/sports/msoc/2026-27/roster?view=list">List</a><div class="player-cards">${people.map(([f, l]) => card(f, l)).join('')}</div>${'x'.repeat(900)} prestosports`;
  const nameCell = (n) => `<th scope="row"><div class="player-name-social-row"><a href="/bios/x">${n}</a></div><div class="d-none d-print-block" inert><a href="/bios/x" aria-hidden="true">${n}</a></div></th>`;
  const listPage = (people) => `<title>2026-27 Men's Soccer Roster - Casper College</title><table><thead><tr><th>#</th><th>Name</th><th>Pos.</th><th>Cl.</th></tr></thead><tbody>${people.map(([f, l], i) => `<tr><td>${i}</td>${nameCell(`${f} ${l}`)}<td>${lbl('Pos.:')} D</td><td>${lbl('Cl.:')} FR</td></tr>`).join('')}</tbody></table>${'x'.repeat(900)} prestosports`;
  const P = [['Alex', 'Keeper'], ['Sam', 'Winger'], ['Jordan', 'Lee']];
  const target = { athletics_entity_id: 'AE-U240000', institution_label: 'Casper College', sport: 'mens-soccer', host: 'casper.example', platform: 'PRESTO', season: 2026 };
  const ownsHost = (h, e) => h === 'casper.example' && e === 'AE-U240000';
  const fetchPair = (cards, list, listHost = 'casper.example') => async (url) => (/view=list/.test(url) ? capturedPage({ url, final_url: url.replace('casper.example', listHost), fetched_at: 't', body: list }) : capturedPage({ url, fetched_at: 't', body: cards }));
  it('print-only duplicate name copies are not cell text', () => {
    expect(parseRosterTableStrict(listPage(P)).records.map((r) => r.player_name)).toEqual(['Alex Keeper', 'Sam Winger', 'Jordan Lee']);
  });
  it('a repeated multi-word name is refused, a two-word same-first-and-last name is not', () => {
    expect(implausibleName('Alex Keeper Alex Keeper')).toBe('duplicated'); expect(implausibleName('Kim Kim')).toBeNull();
  });
  it('the card view alone is unknown; the adapter follows the declared list view and stages the right names', async () => {
    expect(parseRosterTableStrict(cardsPage(P)).structure.code).toBe(STRUCTURE.UNKNOWN);
    const { page } = await rosterAdapter(target, { ownsHost, url: 'https://casper.example/sports/msoc/2026-27/roster', fetch: fetchPair(cardsPage(P), listPage(P)) });
    expect(page.players.map((p) => p.player_name)).toEqual(['Alex Keeper', 'Sam Winger', 'Jordan Lee']);
    expect(page.parser_version).toBe('presto-cards-listview-1'); expect(page.adapter_evidence.list_view.url).toMatch(/view=list/);
  });
  it('a list printing "Last, First" still cross-checks against cards printing "First Last"', async () => {
    const lastFirst = listPage(P).replace(/(Alex) (Keeper)|(Sam) (Winger)|(Jordan) (Lee)/g, (m, a, b, c, d, e, f) => `${b || d || f}, ${a || c || e}`);
    const { page } = await rosterAdapter(target, { ownsHost, url: 'https://casper.example/sports/msoc/2026-27/roster', fetch: fetchPair(cardsPage(P), lastFirst) });
    expect(page.players.map((p) => p.player_name)).toEqual(['Keeper, Alex', 'Winger, Sam', 'Lee, Jordan']);
  });
  it('a list that disagrees with the cards is PARSER_STRUCTURE_UNKNOWN', async () => {
    const r = await rosterAdapter(target, { ownsHost, url: 'https://casper.example/sports/msoc/2026-27/roster', fetch: fetchPair(cardsPage(P), listPage(P.slice(0, 2))) });
    expect(r.refusal.code).toBe(REFUSAL.STRUCTURE);
  });
  it('a list view served from another host is never followed', async () => {
    const r = await rosterAdapter(target, { ownsHost, url: 'https://casper.example/sports/msoc/2026-27/roster', fetch: fetchPair(cardsPage(P), listPage(P), 'elsewhere.example') });
    expect(r.refusal.code).toBe(REFUSAL.STRUCTURE);
  });
});
