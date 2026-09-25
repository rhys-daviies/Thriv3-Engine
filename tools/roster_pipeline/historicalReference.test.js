import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * L7W — what makes a HISTORICAL roster reference trustworthy.
 *
 * The turnover gate measures a current-season page against last season's
 * accepted squad, and L7V found that for the eleven programmes it still refuses
 * not one of those references is season-pinned. Every one came from a URL that
 * serves whatever the site calls "now", four of them from a player bio. The
 * gate is refusing a comparison it cannot trust, so the contract under test
 * here is about the reference and touches no gate.
 *
 * THE INFERENCE THESE TESTS FORBID. Rows stored under season=2025 are not
 * evidence that the page they were read from represented 2025. In the autumn of
 * 2025 a bare roster URL did serve the 2025 squad, so the pipeline recorded the
 * bare URL and the season label together and the two became
 * indistinguishable — and a year later the same URL serves 2026. Every test
 * below asks the PAGE, and test 3 is the one that fails if anything starts
 * asking the database instead.
 *
 * NETWORK-FREE. Every page is synthetic. Live pages move — Oklahoma State's
 * 2025 roster URL exists today and may not next season — and a contract
 * demonstrated against the live web stops being demonstrable the moment a site
 * edits a page.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const python = (() => {
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); return 'python3'; }
  catch { return null; }
})();
const d = python ? describe : describe.skip;

const OWN = ['okstate.com'];

/** Put one page through `reference_quality.accept`, as a 2025 reference. */
function accept({ html, url, sport = 'womens-soccer', hosts = OWN, recorded = 30, season = 2025,
  sources = 1 }) {
  const code = `
import sys, os, json, warnings
warnings.filterwarnings('ignore')
sys.path.insert(0, ${JSON.stringify(HERE)})
os.environ['RB_SEASON'] = '2025'; os.environ['RB_REF'] = '2026'
import lib, reference_quality as Q
a = json.loads(sys.stdin.read())
recs, title, parser = lib.parse_any(a['html'])
ok, primary, reasons = Q.accept(a['html'], title, recs, a['url'], a['sport'],
                                a['season'], a['hosts'], a['recorded'], a['sources'])
print(json.dumps({'ok': ok, 'primary': primary, 'codes': [c for c, _ in reasons],
                  'why': [w for _, w in reasons], 'n': len(recs or []), 'title': title,
                  'parser': parser, 'pinned': Q.season_pinned(a['url']),
                  'archived': lib.immutable_source(a['url']),
                  'dialects': sorted(Q.dialects([r.get('cls') for r in (recs or [])])),
                  'mixedDialects': Q.mixed_dialects([r.get('cls') for r in (recs or [])])}))
`;
  return JSON.parse(execFileSync(python, ['-c', code], {
    input: JSON.stringify({ html, url, sport, hosts, recorded, season, sources }),
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  }));
}

/* -------------------------------------------------------------------------- */

const NAMES = ['Ada Lovelace', 'Grace Hopper', 'Radia Perlman', 'Barbara Liskov', 'Sophie Wilson',
  'Jean Bartik', 'Kathleen Booth', 'Mary Keller', 'Evelyn Boyd', 'Thelma Estrin',
  'Adele Goldberg', 'Frances Allen'];
const POS = ['Forward', 'Midfielder', 'Defender', 'Goalkeeper'];

/** A Sidearm-style table roster. `cls` may be a string or a per-row array. */
const page = (title, names, cls = 'Sophomore') =>
  `<!doctype html><html><head><title>${title}</title></head><body><table>`
  + '<thead><tr><th>#</th><th>Name</th><th>Pos.</th><th>Academic Year</th><th>Hometown</th></tr></thead><tbody>'
  + names.map((n, i) => `<tr><td>${i + 1}</td><td>${n}</td><td>${POS[i % 4]}</td>`
    + `<td>${Array.isArray(cls) ? cls[i % cls.length] : cls}</td><td>Somewhere, ST</td></tr>`).join('')
  + '</tbody></table></body></html>';

const ROSTER_2025 = page('2025 Cowgirl Soccer Roster', NAMES);
const ROSTER_SPAN = page('2025-26 Women\'s Soccer Roster', NAMES);
const ROSTER_2026 = page('2026 Cowgirl Soccer Roster', NAMES);
const UNTITLED = page('Women\'s Soccer Roster', NAMES);

const PINNED = 'https://okstate.com/sports/womens-soccer/roster/2025';
const BARE = 'https://okstate.com/sports/womens-soccer/roster';

/* -------------------------------------------------------------------------- */

d('a trustworthy 2025 reference', () => {
  it('1. the institution\'s own /roster/2025, naming the season, is accepted', () => {
    const r = accept({ html: ROSTER_2025, url: PINNED });
    expect(r.ok).toBe(true);
    expect(r.primary).toBe('TRUSTED_SEASON_PINNED');
    expect(r.codes).toEqual([]);
  });

  it('2. a page naming the 2025-26 academic year is the Fall 2025 squad, and is accepted', () => {
    /*
     * The span's FIRST year is the Fall. An institution that labels its Fall
     * 2025 squad "2025-26" is naming the same season as one that labels it
     * "2025", and `lib.season_ok` has always read both — so this is not a new
     * allowance, it is a statement that the contract inherits the rule rather
     * than inventing a stricter one. `2024-25` is the counterpart, asserted in
     * test 9's neighbourhood: its Fall is 2024.
     */
    const r = accept({ html: ROSTER_SPAN, url: `${BARE}/2025-26` });
    expect(r.ok).toBe(true);
    expect(r.pinned).toBe(true);
  });

  it('3. a bare "now" URL is refused as historical authority, whatever it serves', () => {
    /*
     * THE CENTRAL TEST. The page here is a perfectly good roster; what it does
     * not do is say which season it is, and the URL cannot say either. This is
     * the exact shape of seven of the eleven stored references, and the reason
     * they are unusable a year after capture.
     */
    const r = accept({ html: UNTITLED, url: BARE });
    expect(r.ok).toBe(false);
    expect(r.primary).toBe('UNTRUSTED_BARE_CURRENT');
    expect(r.codes).toContain('SEASON');
    expect(r.n).toBeGreaterThanOrEqual(12);            // the squad parsed fine
  });

  it('9. a current 2026 roster is refused as a 2025 reference', () => {
    const r = accept({ html: ROSTER_2026, url: `${BARE}/2026` });
    expect(r.ok).toBe(false);
    expect(r.codes).toContain('SEASON');
    expect(r.why.join(' ')).toMatch(/does not name 2025/);
  });
});

d('what is not a roster reference', () => {
  it('4. a player bio is refused, even served from the right host', () => {
    const BIO = 'https://okstate.com/sports/womens-soccer/roster/xcaret-pineda/13760';
    const r = accept({ html: ROSTER_2025, url: BIO });
    expect(r.ok).toBe(false);
    expect(r.primary).toBe('UNTRUSTED_BIO_CAPTURE');
    expect(r.codes).toContain('BIO');
  });

  it('5. another sport\'s roster is refused', () => {
    const r = accept({ html: page('2025 Cowgirl Equestrian Roster', NAMES), url: PINNED });
    expect(r.ok).toBe(false);
    expect(r.codes).toContain('SPORT');
  });

  it('6. another institution\'s host is refused', () => {
    const r = accept({ html: ROSTER_2025, url: 'https://gohuskies.com/sports/womens-soccer/roster/2025' });
    expect(r.ok).toBe(false);
    expect(r.codes).toContain('INSTITUTION');
  });

  it('7. the other gender\'s roster is refused', () => {
    const r = accept({ html: page('2025 Cowboy Men\'s Soccer Roster', NAMES), url: PINNED });
    expect(r.ok).toBe(false);
    expect(r.codes).toContain('SPORT');
    expect(r.why.join(' ')).toMatch(/another programme/);
  });

  it('8. a schedule is refused', () => {
    const r = accept({ html: ROSTER_2025, url: 'https://okstate.com/sports/womens-soccer/schedule/2025' });
    expect(r.ok).toBe(false);
    expect(r.codes).toContain('PROVENANCE');
  });

  it('13. a third-party roster aggregator is refused however good its page', () => {
    const r = accept({ html: ROSTER_2025, url: 'https://www.soccer-aggregator.example/okstate/2025/roster' });
    expect(r.ok).toBe(false);
    expect(r.codes).toContain('INSTITUTION');
  });

  it('10. rows assembled from several pages are refused as more than one page state', () => {
    /*
     * The four bio-capture references carry ten to twenty-two distinct source
     * URLs each — a season's worth of captures, taken between September and
     * February, filed together under one season label. A set assembled across
     * page states cannot be attributed to one squad however the rows are
     * labelled, and the count of pages is what says so.
     */
    const r = accept({ html: ROSTER_2025, url: PINNED, sources: 15 });
    expect(r.ok).toBe(false);
    expect(r.primary).toBe('UNTRUSTED_MIXED_SEASONS');
    expect(r.why.join(' ')).toMatch(/from 15 different pages/);
  });

  it('10b. and two class dialects on ONE page are not evidence of anything', () => {
    /*
     * L7V read mixed class dialects as rows assembled across seasons, and that
     * is right about the four bio captures and wrong about Iowa: its single
     * archived 2025-26 page renders `So.`, `Jr.` and `RS Fr.` beside
     * `Graduate Student` and `Redshirt Freshman`, because the site publishes a
     * short form for some class levels and only a long form for others.
     *
     * Refusing that page would refuse a good reference for being transcribed
     * faithfully — so the vocabulary is reported and never decisive, and
     * clause 8 asks how many pages the rows came from instead.
     */
    const IOWA = page('2025-26 Women\'s Soccer Roster', NAMES,
      ['So.', 'Graduate Student', 'Jr.', 'RS Fr.', 'Redshirt Freshman', 'Sr.']);
    const r = accept({ html: IOWA, url: PINNED });
    expect(r.dialects).toEqual(['ABBREV', 'SPELLED']);
    expect(r.mixedDialects).toBe(true);
    expect(r.codes).not.toContain('MIXED');
    expect(r.ok).toBe(true);
  });

  it('10c. nor are a page\'s own ordinal labels', () => {
    /*
     * New Mexico's single read carries "1st year" beside "Freshman" — one
     * page's own variation for its international players.
     */
    const ORD = page('2025 Lobo Soccer Roster', NAMES, ['Freshman', '1st year', 'Junior', '4th year']);
    const r = accept({ html: ORD, url: PINNED });
    expect(r.dialects).toEqual(['ORDINAL', 'SPELLED']);
    expect(r.mixedDialects).toBe(false);
    expect(r.ok).toBe(true);
  });
});

d('archive captures', () => {
  const wb = (ts, u) => `https://web.archive.org/web/${ts}id_/${u}`;

  it('11. a capture of the official page is accepted when the PAGE names 2025', () => {
    const r = accept({ html: ROSTER_2025, url: wb('20251001185702', BARE) });
    expect(r.ok).toBe(true);
    expect(r.archived).toBe(true);
    expect(r.primary).toBe('TRUSTED_ARCHIVED');
  });

  it('12. a capture taken during 2025 is NOT sufficient on its date alone', () => {
    /*
     * The date proves when the copy was taken, never which squad the page
     * listed. A site that had already flipped to 2026 by October 2025 — L7U
     * found forty of those — serves a 2026 roster from a 2025-dated capture.
     */
    const r = accept({ html: ROSTER_2026, url: wb('20251001185702', BARE) });
    expect(r.archived).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.codes).toContain('SEASON');
  });

  it('12b. and an untitled capture is refused too, for saying nothing', () => {
    const r = accept({ html: UNTITLED, url: wb('20251001185702', BARE) });
    expect(r.ok).toBe(false);
    expect(r.codes).toContain('SEASON');
  });

  it('11b. provenance sees through the wrapper to the host that served the bytes', () => {
    /*
     * A Wayback copy of the institution's own page is first-party evidence
     * served by a third party, which is not the same thing as a third-party
     * roster. A capture of somebody else's host is still somebody else's.
     */
    const r = accept({ html: ROSTER_2025, url: wb('20251001185702', 'https://gohuskies.com/sports/womens-soccer/roster') });
    expect(r.ok).toBe(false);
    expect(r.codes).toContain('INSTITUTION');
  });
});

d('what the contract keeps from the gates it does not touch', () => {
  it('14. the player floor is the pipeline\'s own, not a second opinion', () => {
    const r = accept({ html: page('2025 Cowgirl Soccer Roster', NAMES.slice(0, 3)), url: PINNED });
    expect(r.ok).toBe(false);
    expect(r.codes).toContain('FLOOR');
    const ok = accept({ html: page('2025 Cowgirl Soccer Roster', NAMES.slice(0, 6)), url: PINNED });
    expect(ok.ok).toBe(true);
  });

  it('14b. and so is the upper bound, against the count the record already claims', () => {
    const many = Array.from({ length: 90 }, (_, i) => `Player Number${i}`);
    const r = accept({ html: page('2025 Cowgirl Soccer Roster', many), url: PINNED, recorded: 30 });
    expect(r.ok).toBe(false);
    expect(r.codes).toContain('FLOOR');
    expect(r.why.join(' ')).toMatch(/implausible/);
  });

  it('15. season-specific provenance is what is recorded — the URL, not the label', () => {
    /*
     * The repaired reference's value is its URL. Test 3 already refuses the
     * bare form; this asserts the positive: an accepted reference carries a URL
     * that names the season, so a later stage reading the provenance can tell
     * which squad the rows describe without trusting the season column.
     */
    for (const u of [PINNED, `${BARE}/season/2025`, `${BARE}/2025-26`]) {
      const r = accept({ html: ROSTER_2025, url: u });
      expect(r.pinned).toBe(true);
      expect(r.ok).toBe(true);
    }
    expect(accept({ html: ROSTER_2025, url: BARE }).pinned).toBe(false);
  });

  it('16. parser identity is retained, and the contract does not choose the parser', () => {
    const r = accept({ html: ROSTER_2025, url: PINNED });
    expect(r.parser).toBeTruthy();
    expect(r.parser).toMatch(/table|sidearm/);
    expect(r.n).toBe(NAMES.length);
  });
});
