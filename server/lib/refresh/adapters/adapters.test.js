import { describe, it, expect } from 'vitest';
import { parseTeamLinks, prestoPath, divisionToken, pageSeason, outboundHosts, parseRosterTable, parseStaffTable } from './presto.js';
import { detectPlatform, parseSidearmRoster, parseSidearmStaff } from './sidearm.js';
import { blockReason, capturedPage } from './fetchPage.js';
import { nameKey, coreKey, stateHint, wordsContained } from './institutionNames.js';
import { createFederalIndex, resolveFederal } from './federalRegistry.js';
import { refusePage, REFUSAL } from './adapterSafety.js';
import { rosterAdapter, staffAdapter, programmeAdapter, labelNamesInstitution, pageNamesInstitution } from './gatherers.js';

/** PHASE 8A — governing-body parsing, federal identity, adapter safety. Synthetic HTML only. */
const teamsPage = (code, tok, teams, extra = '') => `<html><head><title>${tok} Region 9 ${code === 'msoc' ? "Men's" : "Women's"} Soccer Teams</title></head><body>
${teams.map(([slug, name, div]) => `<a href="/sports/${code}/${tok}${div ? `/${div}` : ''}/teams/${slug}">${name}</a>`).join('\n')}${extra}</body></html>`;

describe('governing-body universe parsing', () => {
  it('reads a Presto teams page for one sport and season, deduped by slug', () => {
    const h = teamsPage('wsoc', '2026-27', [['caspercollege', 'Casper College'], ['caspercollege', ''], ['lamarcc', 'Lamar Community College']]);
    expect(parseTeamLinks(h, { sportCode: 'wsoc', seasonToken: '2026-27' }).map((t) => t.name)).toEqual(['Casper College', 'Lamar Community College']);
  });
  it("keeps men's and women's apart, and ignores other seasons", () => {
    const h = teamsPage('msoc', '2026-27', [['a', 'Alpha College']]) + teamsPage('wsoc', '2026-27', [['b', 'Beta College']]) + teamsPage('wsoc', '2025-26', [['c', 'Old College']]);
    expect(parseTeamLinks(h, { sportCode: 'wsoc', seasonToken: '2026-27' }).map((t) => t.slug)).toEqual(['b']);
    expect(parseTeamLinks(h, { sportCode: 'msoc', seasonToken: '2026-27' }).map((t) => t.slug)).toEqual(['a']);
  });
  it('understands every division path style seen on region sites (div1, D1, DivII, dI)', () => {
    expect(['div1', 'D1', 'DivI', 'dI'].map(divisionToken)).toEqual(['D1', 'D1', 'D1', 'D1']);
    expect(['div3', 'DivIII', 'dIII'].map(divisionToken)).toEqual(['D3', 'D3', 'D3']);
    const h = teamsPage('wsoc', '2026-27', [['x', 'X College', 'dII']]);
    expect(parseTeamLinks(h, { sportCode: 'wsoc', seasonToken: '2026-27' })[0].division).toBe('D2');
    expect(prestoPath('https://r.example/sports/msoc/2025-26/DivII/teams')).toMatchObject({ sport: 'mens-soccer', season: 2025, division: 'D2', page: 'teams' });
  });
  it("reads the page's own season and outbound member hosts", () => {
    expect(pageSeason('<title>2026-27 Region 9 Soccer</title>')).toBe(2026);
    expect(pageSeason('<title>2025 Women\'s Soccer Standings</title>')).toBe(2025);
    const hosts = outboundHosts('<a href="https://casperathletics.example/">Casper College</a><a href="https://facebook.com/x">f</a>', 'region9.example');
    expect(hosts.map((h) => h.host)).toEqual(['casperathletics.example']);
  });
});

describe('federal identity (College Scorecard rows)', () => {
  const rows = [
    { UNITID: '153108', INSTNM: 'Central College', STABBR: 'IA', ICLEVEL: '1', CURROPER: '1' },
    { UNITID: '180902', INSTNM: 'Central Community College', STABBR: 'NE', ICLEVEL: '2', CURROPER: '1' },
    { UNITID: '154642', INSTNM: 'Allen County Community College', STABBR: 'KS', ICLEVEL: '2', CURROPER: '1' },
    { UNITID: '224615', INSTNM: 'Dallas College', STABBR: 'TX', ICLEVEL: '1', CURROPER: '1' },
    { UNITID: '14570703', INSTNM: 'Illinois Eastern Community Colleges-Lincoln Trail College', STABBR: 'IL', ICLEVEL: '2', CURROPER: '1' },
    { UNITID: '214652', INSTNM: 'Pennsylvania State University-Penn State Scranton', STABBR: 'PA', ICLEVEL: '1', CURROPER: '1' },
    { UNITID: '183938', INSTNM: 'Camden County College', STABBR: 'NJ', ICLEVEL: '2', CURROPER: '1' },
    { UNITID: '186380', INSTNM: 'Rutgers University-Camden', STABBR: 'NJ', ICLEVEL: '1', CURROPER: '1', ALIAS: 'Camden' },
  ];
  const idx = createFederalIndex(rows);
  const r = (name, states, association = 'NJCAA', overrides = {}) => resolveFederal(idx, { association, official_name: name }, { states, overrides });
  it('resolves an exact legal name and a campus part of "Institution-Campus"', () => {
    expect(r('Central Community College', ['NE', 'IA']).unitid).toBe(180902);
    expect(r('Penn State Scranton', null, 'USCAA').unitid).toBe(214652);
  });
  it('a core match must contain every listed word — "Central Community College" never becomes Central College', () => {
    expect(r('Central Community College', ['IA']).unitid).toBeUndefined();
    expect(r('Allen County', ['KS']).unitid).toBe(154642);
  });
  it('an 8-digit Scorecard id is a campus LOCATION of its 6-digit parent, never a UNITID', () => {
    const x = r('Lincoln Trail College', ['IL']);
    expect(x.unitid).toBeUndefined(); expect(x.location_code).toBe(14570703); expect(x.parent_unitid).toBe(145707);
  });
  it('a registry alias can point at the wrong institution; a reviewed override is the only way past it', () => {
    expect(r('Camden', ['NJ']).unitid).toBe(186380); // the trap: the alias names Rutgers-Camden (NCAA D3)
    expect(r('Camden', ['NJ'], 'NJCAA', { 'NJCAA|camden': { unitid: 183938, method: 'CURATED' } }).unitid).toBe(183938);
  });
  it('closed name keys: qualifiers, CC expansion, containment', () => {
    expect(stateHint('Montgomery College (MD)')).toBe('MD'); expect(stateHint('GateWay Community College - AZ')).toBe('AZ');
    expect(nameKey('Truckee Meadows CC')).toBe('truckee meadows community college');
    expect(coreKey('Cochise County Community College District')).toBe('cochise county');
    expect(wordsContained('Allen', 'Allen County Community College')).toBe(true);
    expect(wordsContained('Central Community College', 'Central College')).toBe(false);
  });
});

describe('host ownership evidence', () => {
  it('a member-link label or a page self-identification must carry the distinguishing words', () => {
    expect(labelNamesInstitution('Casper College', ['Casper College'])).toBe(true);
    expect(pageNamesInstitution('Casper College Thunderbirds Athletics', ['Casper College'])).toBe(true);
    expect(pageNamesInstitution('Central Wyoming College Rustlers', ['Casper College'])).toBe(false);
  });
});

describe('adapter safety — refusals, never empty observations', () => {
  const page = (over = {}) => ({ ...capturedPage({ url: 'https://team.example/sports/wsoc/2026-27/roster', fetched_at: '2026-09-30T00:00:00Z', body: `<title>2026-27 Women's Soccer Roster</title>${'x'.repeat(900)}` }), ...over });
  const intent = { kind: 'ROSTER', sport: 'womens-soccer', season: 2026, entityOwnsHost: (h) => h === 'team.example' };
  const players = Array.from({ length: 20 }, (_, i) => ({ player_name: `Player ${i}`, position: 'MF' }));
  it('accepts a good current page', () => { expect(refusePage(page(), intent, players)).toBeNull(); });
  it('zero parsed records is a refusal, not "everyone left"', () => { expect(refusePage(page(), intent, []).code).toBe(REFUSAL.ZERO); });
  it('old season page claimed as current', () => { expect(refusePage(page({ body: `<title>2025 Women's Soccer Roster</title>${'x'.repeat(900)}` }), intent, players).code).toBe(REFUSAL.OLD_SEASON); });
  it('wrong sport (URL or title)', () => {
    expect(refusePage(page({ final_url: 'https://team.example/sports/msoc/2026-27/roster' }), intent, players).code).toBe(REFUSAL.WRONG_SPORT);
    expect(refusePage(page({ body: `<title>2026-27 Men's Soccer Roster</title>${'x'.repeat(900)}` }), intent, players).code).toBe(REFUSAL.WRONG_SPORT);
  });
  it('staff mixed into the roster', () => {
    const mixed = [...players.slice(0, 5), ...Array.from({ length: 5 }, (_, i) => ({ player_name: `Coach ${i}`, position: 'Assistant Coach' }))];
    expect(refusePage(page(), intent, mixed).code).toBe(REFUSAL.STAFF_IN_ROSTER);
  });
  it('shared platform root, foreign redirect, institution mismatch', () => {
    expect(refusePage(page({ host: 'prestosports.com', final_host: 'prestosports.com' }), { ...intent, entityOwnsHost: () => false }, players).code).toBe(REFUSAL.SHARED_ROOT);
    expect(refusePage(page({ final_host: 'otherschool.example' }), intent, players).code).toBe(REFUSAL.FOREIGN_REDIRECT);
    expect(refusePage(page({ host: 'stranger.example', final_host: 'stranger.example' }), intent, players).code).toBe(REFUSAL.INSTITUTION_MISMATCH);
  });
  it('blocked / challenge pages (incl. AWS WAF with HTTP 200) and count collapse', () => {
    expect(blockReason({ status: 200, body: '<html><script>window.gokuProps = {}; AwsWafIntegration.saveReferrer();</script></html>' })).toBe('BOT_CHALLENGE');
    expect(refusePage(page({ block: 'BOT_CHALLENGE' }), intent, players).code).toBe(REFUSAL.BLOCKED);
    expect(refusePage(page(), intent, players.slice(0, 6), { count: 25 }).code).toBe(REFUSAL.COLLAPSE);
  });
});

describe('gatherers emit the staging contract and nothing else', () => {
  const presto = `<title>2026-27 Women's Soccer Roster - Casper College</title><div class="presto"></div><table><thead><tr><th>No.</th><th>Name</th><th>Pos.</th><th>Cl.</th><th>Hometown</th></tr></thead><tbody>${Array.from({ length: 12 }, (_, i) => `<tr><td>${i}</td><td><a href="#">Alex Keeper${String.fromCharCode(65 + i)}</a></td><td>MF</td><td>Fr.</td><td>Town, WY</td></tr>`).join('')}</tbody></table>${'x'.repeat(900)} prestosports`;
  const staff = `<title>Women's Soccer Coaches - Casper College</title><table><thead><tr><th>Name</th><th>Title</th><th>Email</th></tr></thead><tbody><tr><td>Pat Coach</td><td>Head Coach</td><td><a href="mailto:pat.coach@casper.example">Email</a></td></tr><tr><td>Sam Aide</td><td>Assistant Coach</td><td></td></tr></tbody></table>${'x'.repeat(900)} prestosports`;
  const fetch = (body) => async (url) => capturedPage({ url, fetched_at: '2026-09-30T00:00:00Z', body });
  const target = { athletics_entity_id: 'AE-U240000', institution_label: 'Casper College', sport: 'womens-soccer', host: 'casperathletics.example', platform: 'PRESTO', season: 2026 };
  const ownsHost = (h, e) => h === 'casperathletics.example' && e === 'AE-U240000';
  it('roster: a ROSTER page with provenance, parser/adapter versions and players (nationality only when printed)', async () => {
    const { page } = await rosterAdapter(target, { ownsHost, fetch: fetch(presto) });
    expect(page).toMatchObject({ dataset: 'ROSTER', source_kind: 'OFFICIAL_ROSTER', observed_season: 2026, page_season: 2026, sport: 'womens-soccer', athletics_entity_id: 'AE-U240000', adapter_version: 'p8b1-gatherers-3' });
    expect(page.players).toHaveLength(12); expect(page.players[0]).not.toHaveProperty('nationality');
  });
  it('staff: only a PRINTED address is carried; nobody gets an inferred one', async () => {
    const { page } = await staffAdapter(target, { ownsHost, fetch: fetch(staff) });
    expect(page.people).toEqual([
      { full_name: 'Pat Coach', role: 'Head Coach', email: 'pat.coach@casper.example', email_origin: 'PUBLISHED_ON_SOURCE' },
      { full_name: 'Sam Aide', role: 'Assistant Coach', email: null, email_origin: 'NONE' },
    ]);
  });
  it('a page on a host the entity does not own is refused', async () => {
    const { refusal } = await rosterAdapter({ ...target, host: 'stranger.example' }, { ownsHost, fetch: fetch(presto) });
    expect(refusal.code).toBe(REFUSAL.INSTITUTION_MISMATCH);
  });
  it('programme adapter: only current-season listings become programme observations', () => {
    const { pages, history } = programmeAdapter([{ association: 'NJCAA', sport: 'womens-soccer', official_name: 'Casper College', season: 2026, source_kind: 'CONFERENCE_SITE', evidence_urls: ['https://region9.example/sports/wsoc/2026-27/teams'], region: 9 }, { association: 'NJCAA', sport: 'mens-soccer', official_name: 'Old College', season: 2025, source_kind: 'CONFERENCE_SITE', evidence_urls: [] }], { season: 2026 });
    expect(pages).toHaveLength(1); expect(history).toHaveLength(1);
    expect(pages[0]).toMatchObject({ dataset: 'PROGRAMME', division: 'NJCAA', conference: 'NJCAA Region 9', season: 2026 });
  });
  it('sidearm parsers and platform detection', () => {
    const sr = `<ul><li class="sidearm-roster-player"><div class="sidearm-roster-player-name"><a href="/x">Jo Kicker</a></div><span class="sidearm-roster-player-position">F</span><span class="sidearm-roster-player-academic-year">So.</span></li></ul>`;
    expect(detectPlatform(`${sr} sidearmsports`)).toBe('SIDEARM');
    expect(parseSidearmRoster(sr)).toEqual([{ player_name: 'Jo Kicker', position: 'F', class_year_label: 'So.', hometown: null, nationality: null }]);
    const ss = `<li class="sidearm-roster-coach"><span class="sidearm-roster-coach-name">Lee Boss</span><span class="sidearm-roster-coach-title">Head Coach</span></li>`;
    expect(parseSidearmStaff(ss)[0]).toMatchObject({ full_name: 'Lee Boss', role: 'Head Coach', email: null, email_origin: 'NONE' });
    expect(parseRosterTable('<table><tr><th>Name</th><th>Pos</th></tr><tr><td>A B</td><td>GK</td></tr></table>')[0]).toMatchObject({ player_name: 'A B', position: 'GK' });
    expect(parseStaffTable('<table><tr><th>Name</th><th>Title</th></tr><tr><td>C D</td><td>Head Coach</td></tr></table>')[0].email).toBeNull();
  });
  it('presto card-theme coaches page (no table): name, role, and an email only from its own card', () => {
    const card = (slug, name, role, mail) => `<div class="col-12"><div class="my-3 card flex-fill"><img class="card-img-top" alt="${name} bio photo" /><div class="card-body"><h5 class="card-title"><a href="/sports/msoc/coaches/${slug}">${name}</a></h5><p class="card-text m-0">${role}</p>${mail ? `<p class="card-text mb-0 text-muted"><small><span class="fa fa-envelope-o"></span> <a href="mailto:${mail}">${mail}</a></small></p>` : ''}</div></div></div>`;
    const html = `<div class="page-content coaches-content"><h1>Men's Soccer</h1>${card('A_Lead', 'Ann Lead', 'Head Coach', 'Lead@Example.edu')}${card('B_Help', 'Bo Help', 'Assistant Coach', null)}</div><div class="card"><h5 class="card-title">Upcoming Events</h5></div>`;
    expect(parseStaffTable(html)).toEqual([
      { full_name: 'Ann Lead', role: 'Head Coach', email: 'lead@example.edu', email_origin: 'PUBLISHED_ON_SOURCE' },
      { full_name: 'Bo Help', role: 'Assistant Coach', email: null, email_origin: 'NONE' },
    ]);
  });
  it('responsive presto roster: a mobile-only cell and hidden labels never shift the columns', () => {
    // the structure measured on a live NJCAA roster in the Phase 8A pilot (names here are fake):
    // a d-md-none jersey badge cell ahead of the desktop columns, a <th scope="row"> name cell,
    // and "No.:"/"Pos.:" label spans inside cells. Before the fix every player_name read "No.:".
    const lbl = (t) => `<span class="label font-weight-bold fw-bold d-md-none">${t}</span>`;
    const row = (no, name, pos, cl, town) => `<tr><td class="text-nowrap jersey-number d-md-none"><span class="badge badge-secondary">${no}</span></td><td class="text-inherit jersey-number d-none d-md-table-cell">${lbl('No.:')} ${no}</td><th scope="row" class="text-inherit"><a href="/sports/msoc/2026-27/bios/x">${name}</a></th><td class="text-nowrap">${lbl('Pos.:')} ${pos}</td><td class="text-nowrap">${lbl('Cl.:')} ${cl}</td><td class="text-inherit">${lbl('Hometown/High School:')} ${town}</td></tr>`;
    const html = `<table><thead class="thead-dark"><tr><th>No.</th><th>Name</th><th>Pos.</th><th>Cl.</th><th>Hometown/High School</th></tr></thead><tbody>${row('00', 'Alex Keeper', 'GK', 'Fr.', 'Town, ST /')}${row('7', 'Sam Winger', 'F', 'So.', 'City, ST /')}</tbody></table>`;
    expect(parseRosterTable(html)).toEqual([
      { player_name: 'Alex Keeper', position: 'GK', class_year_label: 'Fr.', hometown: 'Town, ST /', nationality: null },
      { player_name: 'Sam Winger', position: 'F', class_year_label: 'So.', hometown: 'City, ST /', nationality: null },
    ]);
  });
});
