import { describe, it, expect } from 'vitest';
import { blockStatus, isSportLink, isRosterLink, athleticsScopes, platformRosterUrls, judgeRosterPage, SOURCE_STATUS, STATUS_RANK } from './sourceDiscovery.js';
import { capturedPage } from './fetchPage.js';

/** PHASE 8B.1 Part I — source recovery helpers (synthetic pages; no network). */
const table = (rows) => `<table><thead><tr><th>No.</th><th>Name</th><th>Pos.</th></tr></thead><tbody>${rows.map((n, i) => `<tr><td>${i}</td><td>${n}</td><td>M</td></tr>`).join('')}</tbody></table>`;
const five = ['Alex Keeper', 'Sam Winger', 'Jordan Lee', 'Riley Chen', 'Casey Back'];
const page = (title, body, over = {}) => capturedPage({ url: 'https://x.edu/athletics/sports/msoc/2026-27/roster', fetched_at: 't', body: `<title>${title}</title>${body}${'x'.repeat(900)}`, ...over });

describe('status mapping', () => {
  it('a 404 is NOT_FOUND, a bot challenge / 403 is BLOCKED, unreachable is SOURCE_UNAVAILABLE', () => {
    expect(['HTTP_404', 'ERROR_PAGE', 'BOT_CHALLENGE', 'HTTP_403', 'HTTP_429', 'UNREACHABLE', 'HTTP_503'].map(blockStatus))
      .toEqual(['NOT_FOUND', 'NOT_FOUND', 'BLOCKED', 'BLOCKED', 'BLOCKED', 'SOURCE_UNAVAILABLE', 'SOURCE_UNAVAILABLE']);
  });
  it('ranks a current roster above everything, and a search that never ran below a real NOT_FOUND', () => {
    expect(STATUS_RANK.CURRENT_ROSTER_FOUND).toBeGreaterThan(STATUS_RANK.ROSTER_PAGE_UNPARSED);
    expect(STATUS_RANK.NOT_SEARCHED).toBeLessThan(STATUS_RANK.NOT_FOUND);
  });
});

describe('navigation', () => {
  it("men's and women's links never cross ('women' contains 'men')", () => {
    expect(isSportLink({ href: '/sports/msoc/index', text: "Men's Soccer" }, 'mens-soccer')).toBe(true);
    expect(isSportLink({ href: '/sports/wsoc/index', text: "Women's Soccer" }, 'mens-soccer')).toBe(false);
    expect(isSportLink({ href: '/sports/womens-soccer/roster', text: 'Roster' }, 'womens-soccer')).toBe(true);
    expect(isSportLink({ href: '/sports/mbkb/index', text: "Men's Basketball" }, 'mens-soccer')).toBe(false);
  });
  it('a general all-sports roster or a coaches page is not a sport roster link', () => {
    expect(isRosterLink({ href: '/roster.aspx?path=general' })).toBe(false);
    expect(isRosterLink({ href: '/sports/msoc/coaches' })).toBe(false);
    expect(isRosterLink({ href: '/sports/msoc/2026-27/roster' })).toBe(true);
  });
  it('athletics path scopes come only from the institution\'s own host', () => {
    const links = [{ href: 'https://inst.edu/athletics/index', text: 'Athletics' }, { href: 'https://www.inst.edu/sports', text: 'Sports' }, { href: 'https://inst.edu/recreation/intramurals', text: 'Intramural sports' }, { href: 'https://instathletics.com/', text: 'Athletics' }];
    expect(athleticsScopes(links, 'inst.edu').sort()).toEqual(['/athletics', '/sports']);
  });
  it('platform URL families', () => {
    expect(platformRosterUrls('https://h', 'SIDEARM', 'mens-soccer')).toEqual(['https://h/sports/mens-soccer/roster', 'https://h/roster.aspx?path=msoc']);
    expect(platformRosterUrls('https://h', 'PRESTO', 'womens-soccer')).toEqual(['https://h/sports/wsoc/2026-27/roster']);
    expect(platformRosterUrls('https://h/athletics', 'CUSTOM', 'mens-soccer', { institutionPath: true })).toEqual([]);
  });
});

describe('judging a roster page (structure-validated)', () => {
  it('a current, readable roster', () => {
    expect(judgeRosterPage(page("2026-27 Men's Soccer Roster", table(five)), 'mens-soccer')).toMatchObject({ status: SOURCE_STATUS.CURRENT, players: 5 });
  });
  it('a prior-season roster is PRIOR_ROSTER_ONLY; a wrong-sport page is refused', () => {
    expect(judgeRosterPage(page("2025-26 Men's Soccer Roster", table(five)), 'mens-soccer').status).toBe(SOURCE_STATUS.PRIOR);
    expect(judgeRosterPage(page("2026-27 Women's Soccer Roster", table(five)), 'mens-soccer').status).toBe('WRONG_SPORT_PAGE');
  });
  it('a roster page whose layout the parser cannot validate is ROSTER_PAGE_UNPARSED — an adapter gap, not "no roster"', () => {
    const cards = five.map((n) => `<div class="roster-card"><span>${n}</span></div>`).join('');
    expect(judgeRosterPage(page("2026-27 Men's Soccer Roster", cards), 'mens-soccer').status).toBe(SOURCE_STATUS.UNPARSED);
  });
  it('a blocked page keeps its block status', () => {
    expect(judgeRosterPage({ block: 'HTTP_403', status: 403 }, 'mens-soccer').status).toBe(SOURCE_STATUS.BLOCKED);
  });
});
