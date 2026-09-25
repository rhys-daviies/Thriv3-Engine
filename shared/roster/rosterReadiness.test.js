import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  classifyReadiness, READINESS, rosterEntries, pageTitle, titleSeason, MIN_ROSTER_ENTRIES,
} from './rosterReadiness.js';

/**
 * L7I — the advisory verifier, against the pages that actually misled it.
 *
 * Every fixture is trimmed from the real response, head and roster markup kept,
 * so no test here touches the network and none of them is a page I invented to
 * agree with me.
 */
const FIX = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const page = (f) => readFileSync(join(FIX, f), 'utf8');

const NORTHWOOD = {
  html: page('northwood_wsoc_www_2026.html'),
  finalUrl: 'https://www.gonorthwood.com/sports/wsoc/2026-27/roster',
  slug: 'wsoc', sport: 'womens-soccer', season: 2026, identityHost: 'gonorthwood.com',
};

describe('the pages that were called ready and were not', () => {
  it('1. Northwood\'s real roster is READY', () => {
    const r = classifyReadiness(NORTHWOOD);
    expect(r.readiness).toBe(READINESS.READY);
    expect(r.title).toContain("Women's Soccer");
    expect(r.entries).toBeGreaterThanOrEqual(MIN_ROSTER_ENTRIES);
  });

  it('2. Northwood\'s apex, which answers with the site home page, is not READY', () => {
    const r = classifyReadiness({
      ...NORTHWOOD,
      html: page('northwood_apex_landing.html'),
      finalUrl: 'https://www.gonorthwood.com/landing/index',
    });
    expect(r.readiness).toBe(READINESS.REFUSED);
    expect(r.reason).toMatch(/redirected off the programme/);
  });

  it('3. SMSU\'s women\'s bio at a men\'s-soccer path is REFUSED', () => {
    const r = classifyReadiness({
      html: page('smsu_msoc_womens_bio.html'),
      finalUrl: 'https://smsumustangs.com/sports/msoc/roster/season/2026',
      slug: 'msoc', sport: 'mens-soccer', season: 2026, identityHost: 'smsumustangs.com',
    });
    expect(r.readiness).toBe(READINESS.REFUSED);
    expect(r.reason).toMatch(/names another programme/);
  });

  it('4. Wisconsin-Oshkosh\'s 2027 roster is REFUSED for a 2026 acquisition', () => {
    const r = classifyReadiness({
      html: page('uwoshkosh_msoc_2027_shell.html'),
      finalUrl: 'https://uwoshkoshtitans.com/sports/mens-soccer/roster',
      slug: 'mens-soccer', sport: 'mens-soccer', season: 2026, identityHost: 'uwoshkoshtitans.com',
    });
    expect(r.readiness).toBe(READINESS.REFUSED);
    expect(r.reason).toMatch(/season 2027, not 2026/);
  });

  it('5. an empty Sidearm shell carries no squad, whatever season it claims', () => {
    // The same page asked for the season it actually states: now the only thing
    // left against it is that it has no players, which is UNKNOWN, not READY.
    const r = classifyReadiness({
      html: page('uwoshkosh_msoc_2027_shell.html'),
      finalUrl: 'https://uwoshkoshtitans.com/sports/mens-soccer/roster',
      slug: 'mens-soccer', sport: 'mens-soccer', season: 2027, identityHost: 'uwoshkoshtitans.com',
    });
    expect(r.readiness).toBe(READINESS.UNKNOWN);
    expect(r.entries).toBe(0);
    expect(r.readiness).not.toBe(READINESS.READY);
  });

  it('6. navigation markers alone never reach READY', () => {
    const nav = '<html><head><title>Titans Athletics</title></head><body>'
      + '<div class="roster-card"><a href="/sports/mens-soccer/roster">Roster</a></div>'
      + '<table><tr><td>Statistic</td></tr><tr><td>Statistic</td></tr></table></body></html>';
    const r = classifyReadiness({
      html: nav, finalUrl: 'https://one.test/sports/mens-soccer/roster',
      slug: 'mens-soccer', sport: 'mens-soccer', season: 2026, identityHost: 'one.test',
    });
    expect(r.readiness).toBe(READINESS.UNKNOWN);
    expect(rosterEntries(nav)).toBe(0);
  });

  it('7. institution, sport and squad together are READY', () => {
    const r = classifyReadiness({
      html: page('adrian_wsoc_2026.html'),
      finalUrl: 'https://adrianbulldogs.com/sports/womens-soccer/roster/2026',
      slug: 'womens-soccer', sport: 'womens-soccer', season: 2026, identityHost: 'adrianbulldogs.com',
    });
    expect(r.readiness).toBe(READINESS.READY);
    expect(r.entries).toBeGreaterThanOrEqual(MIN_ROSTER_ENTRIES);
  });
});

describe('the contract itself', () => {
  it('refuses a redirect that leaves the institution', () => {
    const r = classifyReadiness({
      ...NORTHWOOD, finalUrl: 'https://someoneelse.test/sports/wsoc/2026-27/roster',
    });
    expect(r.readiness).toBe(READINESS.REFUSED);
    expect(r.reason).toMatch(/another institution/);
  });

  it('refuses a 404 and holds a 403 open', () => {
    expect(classifyReadiness({ status: 404 }).readiness).toBe(READINESS.REFUSED);
    expect(classifyReadiness({ status: 403 }).readiness).toBe(READINESS.UNKNOWN);
  });

  it('holds a page open when it states no season rather than refusing it', () => {
    const html = '<html><head><title>Women\'s Soccer Roster</title></head><body>'
      + `${'<a href="/sports/womens-soccer/roster/jane-doe/1">p</a>'.repeat(9)}</body></html>`;
    const r = classifyReadiness({
      html, finalUrl: 'https://one.test/sports/womens-soccer/roster',
      slug: 'womens-soccer', sport: 'womens-soccer', season: 2026, identityHost: 'one.test',
    });
    expect(r.readiness).toBe(READINESS.UNKNOWN);
    expect(r.reason).toMatch(/states no season/);
  });

  it('holds a page open when it does not name the sport', () => {
    const html = '<html><head><title>2026 Roster</title></head><body></body></html>';
    const r = classifyReadiness({
      html, finalUrl: 'https://one.test/sports/womens-soccer/roster',
      slug: 'womens-soccer', sport: 'womens-soccer', season: 2026, identityHost: 'one.test',
    });
    expect(r.readiness).toBe(READINESS.UNKNOWN);
    expect(r.reason).toMatch(/does not name the sport/);
  });

  it('reads a season from a span the way the catalogue writes one', () => {
    expect(titleSeason('2026-27 Women\'s Soccer Roster', 2026).matches).toBe(true);
    expect(titleSeason('2025-26 Women\'s Soccer Roster', 2026).matches).toBe(false);
    expect(titleSeason('Women\'s Soccer Roster', 2026).stated).toBe(false);
  });

  it('refuses a prior season, which is how a stale page passes every other check', () => {
    // Bryn Athyn: the parser reads its 19 players perfectly. The page is 2024.
    const html = '<html><head><title>2024 Men\'s Soccer Roster - Bryn Athyn</title></head><body>'
      + `${'<a href="/sports/mens-soccer/roster/jane-doe/1">p</a>'.repeat(19)}</body></html>`;
    const r = classifyReadiness({
      html, finalUrl: 'https://one.test/sports/mens-soccer/roster',
      slug: 'mens-soccer', sport: 'mens-soccer', season: 2026, identityHost: 'one.test',
    });
    expect(r.readiness).toBe(READINESS.REFUSED);
    expect(r.reason).toMatch(/season 2024, not 2026/);
  });

  it('prefers og:title, which is the page\'s claim about itself', () => {
    expect(pageTitle('<meta property="og:title" content="2026 Men&#39;s Soccer Roster">'
      + '<title>Something Else</title>')).toBe("2026 Men's Soccer Roster");
  });

  it('counts a player row and not a one-cell navigation row', () => {
    const player = '<tr><td>9</td><td>Jane Doe</td><td>GK</td><td>Sr.</td><td>Ohio</td></tr>';
    expect(rosterEntries(player.repeat(6))).toBe(6);
    expect(rosterEntries('<tr><td>Statistic</td></tr>'.repeat(9))).toBe(0);
  });
});
