import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * L7Z — what was observed when the page was accepted.
 *
 * L7W spent a stage discovering it could not answer "was this really a 2025
 * page?" for rows filed under season=2025, because nothing recorded what the
 * page said. The facts were all in hand at the moment of acceptance and were
 * thrown away one frame later: `variants.work` holds the parser and the title,
 * the cache sidecar holds the fetch time, and `run.build` received none of them.
 *
 * These tests pin the three facts to their SOURCES, not to their plausibility.
 * The failure mode they exist to catch is not a wrong value but a manufactured
 * one -- a page season copied from the season being requested, a fetch time
 * taken from the clock of the process reading the cache, a parser guessed from
 * the URL. Each of those would look right and mean nothing.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const python = (() => {
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); return 'python3'; }
  catch { return null; }
})();
const d = python ? describe : describe.skip;

/** Build rows through the real `run.build`, with a real cache entry on disk. */
function build({ html, url, season = '2026', ref = '2025', current = '1',
  cacheAgeSeconds = null, writeSidecar = true }) {
  const code = `
import sys, os, json, re, time, warnings, tempfile
warnings.filterwarnings('ignore')
sys.path.insert(0, ${JSON.stringify(HERE)})
a = json.loads(sys.stdin.read())
os.environ['RB_SEASON'] = a['season']; os.environ['RB_REF'] = a['ref']
if a['current']: os.environ['RB_CURRENT'] = a['current']
# A cache directory of our own: nothing here may see or touch the real one.
import lib
lib.CACHE = tempfile.mkdtemp(prefix='l7z-')
os.makedirs(lib.CACHE, exist_ok=True)
import run
run.N25 = {}; run.CLS25 = {}
if a['writeSidecar']:
    body_p, meta_p = lib._cache_paths(a['url'])
    open(body_p, 'w', encoding='utf-8').write(a['html'])
    t = time.time() - (a['cacheAgeSeconds'] or 0)
    json.dump({'url': a['url'], 'fetched_at': t}, open(meta_p, 'w', encoding='utf-8'))
recs, title, parser = lib.parse_any(a['html'])
row = {'School': 'Test School', 'Conference': 'Test Conf'}
rows = run.build(recs, row, a['url'], 'High', 'note', parser=parser, title=title)
print(json.dumps({
    'n': len(rows),
    'parser': parser,
    'title': title,
    'season_ok': lib.season_ok(title),
    'fetched_at_helper': lib.fetched_at(a['url']),
    'row': rows[0] if rows else None,
}))
`;
  return JSON.parse(execFileSync(python, ['-c', code], {
    input: JSON.stringify({ html, url, season, ref, current, cacheAgeSeconds, writeSidecar }),
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  }));
}

const NAMES = ['Ada Lovelace', 'Grace Hopper', 'Radia Perlman', 'Barbara Liskov',
  'Sophie Wilson', 'Jean Bartik', 'Kathleen Booth', 'Mary Keller'];
const POS = ['Forward', 'Midfielder', 'Defender', 'Goalkeeper'];

const page = (title, names = NAMES) =>
  `<!doctype html><html><head><title>${title}</title></head><body><table>`
  + '<thead><tr><th>#</th><th>Name</th><th>Pos.</th><th>Academic Year</th><th>Hometown</th></tr></thead><tbody>'
  + names.map((n, i) => `<tr><td>${i + 1}</td><td>${n}</td><td>${POS[i % 4]}</td>`
    + '<td>Jr.</td><td>Somewhere, ST</td></tr>').join('')
  + '</tbody></table></body></html>';

const URL_2026 = 'https://l7z.test/sports/womens-soccer/roster/2026';

/* -------------------------------------------------------------------------- */

d('L7Z — the page season is what the PAGE said', () => {
  it('1. an explicit 2026 page records 2026', () => {
    const r = build({ html: page('2026 Women\'s Soccer Roster'), url: URL_2026 });
    expect(r.season_ok).toBe(true);
    expect(r.row['Source Page Season']).toBe('2026');
  });

  it('2. a 2026-27 academic-year page is the Fall 2026 squad', () => {
    const r = build({ html: page('Women\'s Soccer 2026-27'), url: URL_2026 });
    expect(r.season_ok).toBe(true);
    expect(r.row['Source Page Season']).toBe('2026');
  });

  it('3. a 2025-26 page records 2025 when 2025 is what was asked for', () => {
    const r = build({ html: page('Women\'s Soccer 2025-26'), url: 'https://l7z.test/r/2025',
      season: '2025', ref: '2026', current: '' });
    expect(r.season_ok).toBe(true);
    expect(r.row['Source Page Season']).toBe('2025');
  });

  it('13. a page that names no season records NOTHING, not the season requested', () => {
    /*
     * THE CENTRAL TEST. A live current-season page is usually titled just
     * "Roster", and it is accepted on turnover rather than on a title. The
     * season being requested is right there in the environment, and writing it
     * here would be the exact inference -- database season as page season --
     * that L7W had to spend a stage undoing.
     */
    const r = build({ html: page('Roster | Test Athletics'), url: URL_2026 });
    expect(r.season_ok).toBe(null);          // the page established nothing
    expect(r.row['Source Page Season']).toBe('');
    expect(r.n).toBeGreaterThan(5);          // and the roster still built
  });

  it('14. a page naming a different season records that, and is refused upstream', () => {
    const r = build({ html: page('2024 Women\'s Soccer Roster'), url: URL_2026 });
    expect(r.season_ok).toBe(false);         // positively the wrong season
    expect(r.row['Source Page Season']).toBe('');
  });

  it('and the value never comes from the requested season', () => {
    // Same untitled page, three different requested seasons: always empty.
    for (const season of ['2024', '2025', '2026']) {
      const r = build({ html: page('Roster'), url: URL_2026, season, ref: String(Number(season) + 1) });
      expect(r.row['Source Page Season']).toBe('');
    }
  });
});

d('L7Z — the fetch time is the cache\'s, not the clock\'s', () => {
  it('4. a fresh cache hit keeps the ORIGINAL fetch time', () => {
    /*
     * The whole point. A body fetched an hour ago and served from cache now
     * must record when it was FETCHED, not when it was read -- otherwise every
     * reuse quietly refreshes the provenance of a body nobody re-requested.
     */
    const r = build({ html: page('2026 Roster'), url: URL_2026, cacheAgeSeconds: 3600 });
    const at = Date.parse(r.row['Source Fetched At']);
    const ageMinutes = (Date.now() - at) / 60000;
    expect(ageMinutes).toBeGreaterThan(50);
    expect(ageMinutes).toBeLessThan(70);
  });

  it('5 + 6. a refetch or a miss records the time the body was written', () => {
    const r = build({ html: page('2026 Roster'), url: URL_2026, cacheAgeSeconds: 0 });
    const ageSeconds = (Date.now() - Date.parse(r.row['Source Fetched At'])) / 1000;
    expect(ageSeconds).toBeLessThan(120);
  });

  it('2b. an entry with no sidecar records nothing rather than now', () => {
    const r = build({ html: page('2026 Roster'), url: URL_2026, writeSidecar: false });
    expect(r.fetched_at_helper).toBe(null);
    expect(r.row['Source Fetched At']).toBe('');
  });

  it('is ISO-8601 UTC', () => {
    const r = build({ html: page('2026 Roster'), url: URL_2026, cacheAgeSeconds: 10 });
    expect(r.row['Source Fetched At']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

d('L7Z — the parser is transported, not guessed', () => {
  it('7. the reader that accepted the page is the one recorded', () => {
    const r = build({ html: page('2026 Roster'), url: URL_2026 });
    expect(r.parser).toBe('table');
    expect(r.row['Source Parser']).toBe('table');
  });

  it('and is not inferred from the URL', () => {
    // A sidearm-shaped URL serving a plain table still records `table`.
    const r = build({ html: page('2026 Roster'),
      url: 'https://l7z.test/sports/womens-soccer/roster/2026' });
    expect(r.row['Source Parser']).toBe('table');
  });

  it('a caller that does not know the parser records nothing', () => {
    const code = `
import sys, os, json, warnings, tempfile
warnings.filterwarnings('ignore')
sys.path.insert(0, ${JSON.stringify(HERE)})
os.environ['RB_SEASON'] = '2026'; os.environ['RB_REF'] = '2025'; os.environ['RB_CURRENT'] = '1'
import lib
lib.CACHE = tempfile.mkdtemp(prefix='l7z-')
import run
run.N25 = {}; run.CLS25 = {}
recs, title, parser = lib.parse_any(json.loads(sys.stdin.read())['html'])
rows = run.build(recs, {'School': 'S', 'Conference': 'C'}, 'https://l7z.test/x', 'High', 'n')
print(json.dumps(rows[0]))
`;
    const row = JSON.parse(execFileSync(python, ['-c', code], {
      input: JSON.stringify({ html: page('2026 Roster') }), encoding: 'utf8' }));
    expect(row['Source Parser']).toBe('');
    expect(row['Source Page Season']).toBe('');
    expect(row['Source Fetched At']).toBe('');
  });
});

d('L7Z — source URL and archive captures', () => {
  it('8. the source URL is transported unchanged', () => {
    const r = build({ html: page('2026 Roster'), url: URL_2026 });
    expect(r.row['Source Roster URL']).toBe(URL_2026);
  });

  it('12. an archive capture keeps its capture stamp in the URL and its fetch time separately', () => {
    /*
     * Two different facts, and only one needs a column. The capture timestamp
     * is already inside the Wayback URL -- it IS the source identity -- while
     * `Source Fetched At` answers when Thriv3 read that copy. Conflating them
     * would lose whichever one the single field did not mean.
     */
    const wb = 'https://web.archive.org/web/20250908070127id_/https://l7z.test/sports/wsoc/roster';
    const r = build({ html: page('Women\'s Soccer 2025-26'), url: wb,
      season: '2025', ref: '2026', current: '', cacheAgeSeconds: 0 });
    expect(r.row['Source Roster URL']).toContain('20250908070127');   // capture time
    expect(r.row['Source Page Season']).toBe('2025');                 // page said so
    const fetchedThisYear = new Date(r.row['Source Fetched At']).getUTCFullYear();
    expect(fetchedThisYear).toBe(new Date().getUTCFullYear());        // fetched now, not 2025
  });
});
