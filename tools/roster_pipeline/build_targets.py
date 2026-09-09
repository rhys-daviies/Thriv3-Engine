# -*- coding: utf-8 -*-
"""Build a season's worklist from the roster files of every later season held.

Two lessons are baked in. The universe comes from the roster files rather than
the previous worklist -- the 2024 list inherited a blind spot of 18 programmes
that no retry could ever have found. And candidate URLs come from the NEAREST
verified season, because a URL confirmed last week beats one confirmed a year
ago when both are being year-swapped.
"""
import csv, glob, os, re, sys, collections

from paths import season_dir

SEASON = int(sys.argv[1])
def _held(years):
    return [y for y in years if os.path.isdir(season_dir(y))]

# For a backfill the reference is the season AFTER the target. For the CURRENT
# season there is nothing after it, so fall back to the seasons before -- the
# nearest one still supplies the freshest verified URL to year-swap.
LATER = _held((SEASON + 1, SEASON + 2, SEASON + 3)) or _held((SEASON - 1, SEASON - 2, SEASON - 3))
assert LATER, f'no held season adjacent to {SEASON}'
OUT = os.path.join(season_dir(SEASON), '_targets.csv')
REF = LATER[0]
HDR = ['School','Sport','Division','Conference',f'Roster URL {SEASON} (candidate)','Method',
       f'Roster URL {REF} (known good)', f'{REF} Player Count','Status','Notes']

GENERATED_METHODS = {
    'no later URL on record — discover from scratch',
    'archive in the later season — expect it again',
    'season-span swap',
    'year-swap (direct)',
    'no year in the later URL — append the season, else selector or archive',
    # L7B's. Omitting it made `repairs()` read a generated candidate as a HUMAN
    # repair and carry it forward, so a corrected generator could not replace
    # what a previous run had written -- L7C spent a rebuild finding that out.
    # A method this file writes belongs in this set, always.
    'generated from a verified athletics host',
}

def repairs(path, season):
    """Candidate URLs a previous run REPAIRED, which a rebuild must not undo.

    Rebuilding the worklist regenerates the candidate column from the roster
    files, which silently reverted 12 hand-repaired URLs -- among them Notre
    Dame, whose site serves a soft 404 with HTTP 200 at the year-swapped path,
    so the reverted URL fails by parsing an empty roster rather than by erroring.
    A repair is any Method this file did not write.
    """
    if not os.path.exists(path): return {}
    out = {}
    for r in csv.DictReader(open(path, encoding='utf-8')):
        m = (r.get('Method') or '').strip()
        if m and m not in GENERATED_METHODS:
            out[(r['School'], r['Sport'])] = (r[f'Roster URL {season} (candidate)'].strip(), m)
    return out

def division_of(basename):
    """'ncaa_d2_mens_soccer_2025_rosters.csv' -> 'NCAA D2'; 'naia_...' -> 'NAIA'."""
    m = re.match(r'(ncaa_(d\d)|naia|uscaa)_', basename)
    if not m: raise ValueError(f'unrecognised roster file: {basename}')
    if m.group(1) == 'naia': return 'NAIA'
    if m.group(1) == 'uscaa': return 'USCAA'
    return 'NCAA ' + m.group(2).upper()

def scan(yr):
    out = {}
    d = season_dir(yr)
    # Every division held, not just the NCAA six. NAIA's 2025 files sat beside
    # them all along and this glob was the only reason 386 programmes were never
    # even a target -- they read as a coverage gap and were a worklist one.
    for f in sorted(glob.glob(f'{d}/*_{yr}_rosters.csv')):
        b = os.path.basename(f)
        div = division_of(b)
        sport = 'mens-soccer' if '_mens_' in b else 'womens-soccer'
        for r in csv.DictReader(open(f, encoding='utf-8')):
            e = out.setdefault((r['School'], sport),
                               {'div': div, 'conf': r['Conference'], 'n': 0, 'roster': ''})
            e['n'] += 1
            # take the first NON-EMPTY url, not the first row's. Some rows carry
            # no source url, and accepting one silently left 54 school-sports with
            # no candidate -- so every stage had nothing to try and skipped them
            # without recording a reason. They looked unattempted, not failed.
            if not e['roster'] and (r['Source Roster URL'] or '').strip():
                e['roster'] = r['Source Roster URL'].strip()
            if not e['conf'] and r['Conference']: e['conf'] = r['Conference']
    return out

def swap(u, season):
    if not u: return ''
    u = re.sub(r'^https?://web\.archive\.org/web/\d+(?:id_)?/', '', u)
    u = re.sub(r'\?view=table$', '', u)
    if re.search(r'/20\d\d-\d\d(/|$)', u):
        return re.sub(r'/20\d\d-\d\d(?=/|$)', f'/{season}-{(season+1)%100:02d}', u)
    if re.search(r'/(?:season/)?20\d\d(/|$)', u):
        return re.sub(r'/20\d\d(?=/|$)', f'/{season}', u)
    return u.rstrip('/') + f'/{season}'

def method(u):
    if not u: return 'no later URL on record — discover from scratch'
    if 'web.archive.org' in u: return 'archive in the later season — expect it again'
    if re.search(r'/20\d\d-\d\d(/|$)', u): return 'season-span swap'
    if re.search(r'/(?:season/)?20\d\d(/|$)', u): return 'year-swap (direct)'
    return 'no year in the later URL — append the season, else selector or archive'

def registry_universe():
    """Programmes the REGISTRY says exist, whether or not we ever fetched one.

    The universe used to be `scan()` alone -- the roster files of adjacent
    seasons -- which makes membership depend on already having a roster. A
    programme absent once is never asked for again, never earns a known-good
    URL, and is missing forever. That is not hypothetical: the 2025 D3 women's
    file held 394 schools against 418 in the registry, and the 24-school
    shortfall was carried into 2026 untouched, because the 2026 worklist was
    built from the 2025 output.

    So membership now comes from the registry and prior success is demoted to
    what it always should have been: a hint about WHERE to look, not a rule
    about WHO counts. A programme with no history is a target with no candidate
    URL, which every downstream stage already knows how to handle -- it is the
    'discover from scratch' method.

    Written by `npm run roster-targets -- --csv --out ...` in the Thriv3-Engine
    repo, which owns the registry. Absent file means the previous behaviour,
    so this is safe to run against a season that has no export yet.
    """
    path = os.path.join(season_dir(SEASON), '_registry_universe.csv')
    if not os.path.exists(path):
        return {}
    out = {}
    for r in csv.DictReader(open(path, encoding='utf-8')):
        out[(r['School'], r['Sport'])] = {'div': r['Division'], 'conf': r.get('Conference', '')}
    return out


def registry_candidates():
    """A first URL for a programme with no history, from a VERIFIED athletics host.

    L6D attempted 34 registry-only programmes and made no request against any of
    them, because every acquiring stage transforms a URL and these had none:
    'variants: none', thirty-four times. L7 found the reason was not missing
    domains -- most of them sit on an athletics host the ledger has verified --
    but that nothing inverted institution -> host -> URL.

    Written by `node server/scripts/rosterCandidatePlan.js --csv --out ...` in
    the Thriv3-Engine repo, which owns the ledger and the shape catalogue. A
    separate file from the membership export on purpose: that one answers WHO
    counts and must stay free of URLs, this one answers WHERE TO ASK FIRST.
    Absent file means the previous behaviour.

    It is a suggestion and is used only where there is no observation. A
    known-good URL from a prior season always wins -- see the caller. And a
    generated URL is not a verified source: turnover, soft-404, parsing and
    source validation all still decide, exactly as for any other candidate.
    """
    path = os.path.join(season_dir(SEASON), '_registry_candidates.csv')
    if not os.path.exists(path):
        return {}
    out = {}
    for r in csv.DictReader(open(path, encoding='utf-8')):
        u = (r.get('Candidate') or '').strip()
        if u:
            out[(r['School'], r['Sport'])] = u
    return out

KEPT = repairs(OUT, SEASON)
per = {y: scan(y) for y in LATER}
REGISTRY = registry_universe()
CANDIDATES = registry_candidates()
# Union, not replacement. The registry decides membership; the roster files
# still supply the candidate URLs for everything they cover.
keys = sorted(set().union(*[set(p) for p in per.values()], set(REGISTRY)))
rows = []
for k in keys:
    src = next((y for y in LATER if k in per[y]), None)
    # A registry-only programme has no scanned entry and therefore no URL to
    # swap. It is a discovery job, as it always was -- but from L7B the ledger
    # can sometimes name a VERIFIED athletics host for it, and a first URL on
    # that host beats starting from nothing.
    e = per[src][k] if src else {'div': REGISTRY[k]['div'], 'conf': REGISTRY[k]['conf'],
                                 'n': 0, 'roster': ''}
    u = e['roster']
    cand, meth = swap(u, SEASON), method(u)
    # PRECEDENCE, EXPLICITLY. An observation always beats a suggestion: this
    # runs only when there was no URL to transform. `u` stays empty either way,
    # so a generated candidate never reaches the known-good column below and
    # cannot be mistaken later for a page we actually fetched.
    if not cand and k in CANDIDATES:
        # Through `swap` like every other candidate. L7C found the reason: the
        # generated URL was going in raw, so a Presto candidate kept its
        # `?view=table` and variants.ladder appended a season to the QUERY --
        # `.../roster?view=table/2026-27`, a 404 by construction. A candidate
        # that skips the normalisation everything else gets is not in the normal
        # path, whatever the diagram says.
        cand, meth = swap(CANDIDATES[k], SEASON), 'generated from a verified athletics host'
    if k in KEPT: cand, meth = KEPT[k]
    rows.append({'School': k[0], 'Sport': k[1], 'Division': e['div'], 'Conference': e['conf'],
                 f'Roster URL {SEASON} (candidate)': cand, 'Method': meth,
                 f'Roster URL {REF} (known good)': (per[REF].get(k) or {}).get('roster', u),
                 f'{REF} Player Count': str((per[REF].get(k) or {}).get('n', 0)),
                 'Status': 'todo', 'Notes': ''})
with open(OUT, 'w', newline='', encoding='utf-8') as fh:
    w = csv.DictWriter(fh, fieldnames=HDR, lineterminator='\r\n'); w.writeheader(); w.writerows(rows)
print(f'wrote {OUT}\n  {len(rows)} school-sports, candidates sourced from {LATER}'
      f'\n  {len(CANDIDATES)} registry-only programmes carry a generated candidate, '
      f'\n  {len(REGISTRY)} in the registry universe, '
      f'{sum(1 for k in keys if k in REGISTRY and not any(k in per[y] for y in LATER))} of them new to the worklist'
      f'\n  {sum(1 for r in rows if (r["School"], r["Sport"]) in KEPT)} repaired candidates carried forward')
for y in LATER: print(f'    {y}: {len(per[y])} school-sports')
print('\n  method breakdown:')
for m, n in collections.Counter(r['Method'] for r in rows).most_common(): print(f'    {n:5}  {m}')
print('\n  division x sport:')
for kk, n in sorted(collections.Counter((r['Division'], r['Sport']) for r in rows).items()):
    print(f'    {n:5}  {kk}')
