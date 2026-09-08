/**
 * The collector's parsers, on the shapes the three platforms actually publish.
 *
 * Everything here is a bug that reached the data once: a record column read in
 * the wrong order, a points column read as matches played, a bot check read as
 * a missing conference, and a pod heading read as a school.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseStandingsTable, parseNextPayload, seasonIds, readInventory } from './collectConferenceStandings.js';

const table = (rows) => `<table>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;

describe('a standings table', () => {
  const CONFERENCE_FIRST = table([
    ['', 'Team', 'Conference', 'PCT', 'Overall', 'PCT'],
    ['', 'Mercyhurst', '10-0', '1.000', '19-1-1', '.929'],
    ['', 'Gannon', '5-5', '.500', '9-8-2', '.526'],
  ]);
  const OVERALL_FIRST = table([
    ['', 'Team', 'Overall', 'PCT', 'Conference', 'PCT'],
    ['', 'Ursuline', '7-7-2', '.500', '5-7-2', '.429'],
  ]);

  it('reads the school, the conference record and the overall record', () => {
    const rows = parseStandingsTable(CONFERENCE_FIRST);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ school: 'Mercyhurst', confRecord: '10-0', overallRecord: '19-1-1', recordColumnOrder: 'CONFERENCE_FIRST' });
  });

  it('reads the header to find which record column is the conference one', () => {
    // Taking the first record put the OVERALL record into the conference
    // column for the GMAC and 22 other conference-seasons.
    const rows = parseStandingsTable(OVERALL_FIRST);
    expect(rows[0]).toMatchObject({ school: 'Ursuline', confRecord: '5-7-2', overallRecord: '7-7-2', recordColumnOrder: 'OVERALL_FIRST' });
  });

  it('reads matches played only where the table declares a GP column', () => {
    const withGp = table([
      ['', 'Team', 'Pts', 'GP', 'W-L', 'PCT', 'GP', 'W-L', 'PCT', 'Conference', 'Overall'],
      ['', 'Framingham St.', '19', '7', '6-0-1', '.929', '19', '11-6-2', '.632'],
    ]);
    expect(parseStandingsTable(withGp)[0].conferenceMatches).toBe(7);
    // Without one, the integer before the record is points, and reading it
    // refused 795 records that were perfectly good.
    expect(parseStandingsTable(CONFERENCE_FIRST)[0].conferenceMatches).toBeNull();
  });

  it('captures a pod heading rather than reading it as a school', () => {
    const podded = table([
      ['', 'Team', 'Conference', 'PCT', 'Overall', 'PCT'],
      ['East'],
      ['', 'Slippery Rock', '8-2', '.800', '14-5-1', '.725'],
      ['West'],
      ['', 'Mercyhurst', '10-0', '1.000', '19-1-1', '.929'],
    ]);
    const rows = parseStandingsTable(podded);
    expect(rows.map((r) => r.school)).toEqual(['Slippery Rock', 'Mercyhurst']);
    // Row order is not a finish: Mercyhurst is first in the West and second by
    // row, and the pod is what makes that visible.
    expect(rows.map((r) => r.group)).toEqual(['East', 'West']);
  });

  it('keeps a seed and a champion marker as the conference’s own notation', () => {
    const marked = table([
      ['', 'Team', 'Conference', 'PCT', 'Overall', 'PCT'],
      ['', 'Messiah &^1', '8-0', '1.000', '20-0-2', '.955'],
    ]);
    expect(parseStandingsTable(marked)[0]).toMatchObject({ school: 'Messiah', seed: 1, champion: true });
  });

  it('prints each school once, though the table prints it twice', () => {
    const doubled = table([
      ['', 'Team', 'Conference', 'PCT', 'Overall', 'PCT'],
      ['Mercyhurst', 'Mercyhurst', '10-0', '1.000', '19-1-1', '.929'],
    ]);
    expect(parseStandingsTable(doubled)).toHaveLength(1);
  });
});

describe('the season selector', () => {
  it('reads the opaque standings id the year selector posts', () => {
    // `?year=2022` is accepted and silently ignored — it returns the CURRENT
    // table — so the id has to come off the live page.
    const html = '<select><option value="238">2022-23</option><option value="264">2023</option></select>';
    expect(seasonIds(html)).toEqual({ 2022: '238', 2023: '264' });
  });
});

describe('a Next.js payload', () => {
  it('reads the table out of the page’s own data', () => {
    const payload = {
      props: { pageProps: { fallback: {
        '@"engage-api","/sport/{sport}/standings/table"': {
          available_seasons: [{ season_year: 2022 }, { season_year: 2023 }],
          data: [{ alias: 'MD', market: 'Maryland', data: [{ points: '16' }, { conf_record: '4-0-4' }, { ovr_record: '11-4-5' }] }],
        },
      } } },
    };
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script>`;
    const parsed = parseNextPayload(html);
    expect(parsed.teams[0]).toMatchObject({ school: 'Maryland', confRecord: '4-0-4', overallRecord: '11-4-5' });
    // The payload says which seasons the conference published, so a season it
    // never had is distinguishable from one we failed to fetch.
    expect(parsed.availableSeasons).toEqual(['2022', '2023']);
  });

  it('returns nothing rather than guessing when the payload is absent', () => {
    expect(parseNextPayload('<html><body>no payload here</body></html>')).toBeNull();
    expect(parseNextPayload('<script id="__NEXT_DATA__" type="application/json">not json</script>')).toBeNull();
  });
});

describe('the inventory fails closed', () => {
  it('refuses an absent or empty file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-'));
    expect(() => readInventory(dir)).toThrow(/not found/);
    fs.writeFileSync(path.join(dir, 'conference-inventory.json'), JSON.stringify({ conferences: [] }));
    expect(() => readInventory(dir)).toThrow(/empty/);
  });
});
