# -*- coding: utf-8 -*-
"""Find a trustworthy season-specific historical roster reference, or say why not.

  RB_SEASON=2025 RB_REF=2026 python3 discover_reference.py \
      --keys cohort.txt --hosts hosts.json --out refs.json

READ-ONLY. It fetches and it writes one report. No state, no stage file, no
roster sheet, no database row.

It owns no policy. The candidate ladder is `variants.ladder`, run with
RB_CURRENT unset so the bare "now" URL is never offered -- a backfill has always
demanded that a page name its season, and a bare URL cannot. Acceptance is
`reference_quality.accept`. Archive discovery is `lib.cdx`, whose default window
is already the target season's own Aug-Feb. What this script adds is the order:
every first-party live candidate before any capture, because a live season-pinned
page is the institution publishing its own history and a capture is a copy of it.
"""
import argparse
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib                    # noqa: E402
import reference_quality as Q  # noqa: E402
import run                     # noqa: E402
import state                   # noqa: E402
import variants as V           # noqa: E402

ALGORITHM = 'L7W/reference-discovery/v1'

# How many captures of one URL to open. The window is one season and `lib.cdx`
# collapses to six digits of timestamp, so this is several distinct days, not
# several copies of one day.
ARCHIVE_TRIES = 6


def squad_url(u):
    """The squad page a stored reference was read from, bio segment removed.

    `variants.ladder` strips the same segment with the same pattern; doing it
    here too means the ladder is handed a roster path whichever kind of URL the
    programme happens to have stored.
    """
    u = re.sub(r'^https?://web\.archive\.org/web/\d+(?:id_)?/', '', u or '').rstrip('/')
    return re.sub(r'(/roster)/[a-z0-9][a-z0-9\-\.]+(?:/\d+)?$', r'\1', u, flags=re.I)


def probe(url, key, sport, season, hosts, recorded):
    try:
        code, html = lib.fetch(url, tries=2, timeout=40)
    except Exception as exc:                            # noqa: BLE001
        return {'url': url, 'result': 'FETCH:%s' % type(exc).__name__}
    if code != 200 or not html:
        return {'url': url, 'result': 'http:%s' % code}
    recs, title, parser = lib.parse_any(html)
    ok, primary, reasons = Q.accept(html, title, recs, url, sport, season, hosts, recorded)
    return {'url': url, 'result': 'OK' if ok else primary, 'ok': ok, 'parser': parser,
            'n': len(recs or []), 'title': re.sub(r'\s+', ' ', title or '')[:90],
            'primary': primary, 'reasons': [c for c, _ in reasons],
            'why': [w for _, w in reasons],
            'pinned': Q.season_pinned(url), 'archived': lib.immutable_source(url),
            'recs': recs if ok else None}


def discover(key, row, hosts, season):
    sport = key.split('||')[-1]
    stored = row.get(f'Roster URL {season} (known good)') or ''
    base = squad_url(stored or row.get('_cand') or '')
    recorded = 0
    try:
        recorded = int((row.get(f'{season} Player Count') or '0').strip() or 0)
    except ValueError:
        pass
    out = {'key': key, 'school': row['School'], 'sport': sport, 'season': season,
           'base': base, 'attempts': [], 'found': False}

    # A. official, season-pinned, live. `ladder` with RB_CURRENT unset.
    for u in V.ladder(base, ''):
        if lib.immutable_source(u): continue
        a = probe(u, key, sport, season, hosts, recorded)
        a['source'] = 'OFFICIAL_LIVE'
        out['attempts'].append({k: v for k, v in a.items() if k != 'recs'})
        if a.get('ok'):
            out.update(found=True, type='TRUSTED_SEASON_PINNED', url=u, parser=a['parser'],
                       n=a['n'], title=a['title'], recs=a['recs'])
            return out

    # C. a capture of the official roster page, the PAGE still having to name the
    #    season. A capture date inside the season proves when the copy was taken
    #    and nothing about which squad the page listed.
    for target in [base] + [u for u in V.ladder(base, '') if not lib.immutable_source(u)][:1]:
        stamps = lib.cdx(target)
        # An index that answers with nothing is not the same fact as an index
        # that has nothing, and `lib.cdx` returns [] for both -- it swallows a
        # 429 or a timeout after three tries. Recorded so a programme is never
        # reported UNAVAILABLE on the strength of a failed lookup: Iowa came
        # back UNAVAILABLE on one run and TRUSTED_ARCHIVED on the next, with
        # three captures that were there the whole time.
        out['attempts'].append({'url': target, 'source': 'ARCHIVE_INDEX',
                                'result': 'captures:%d' % len(stamps)})
        if not stamps:
            out['archive_index_empty'] = True
        for ts in stamps[:ARCHIVE_TRIES]:
            u = lib.wb_url(ts, target)
            a = probe(u, key, sport, season, hosts, recorded)
            a['source'] = 'ARCHIVE'
            a['capture'] = ts
            out['attempts'].append({k: v for k, v in a.items() if k != 'recs'})
            if a.get('ok'):
                out.update(found=True, type='TRUSTED_ARCHIVED', url=u, parser=a['parser'],
                           n=a['n'], title=a['title'], capture=ts, recs=a['recs'])
                return out

    reached = [a for a in out['attempts'] if 'primary' in a]
    if out.get('archive_index_empty') and not reached:
        out['type'] = 'ARCHIVE_INDEX_UNANSWERED'
        return out
    if not reached:
        out['type'] = 'UNAVAILABLE'
    else:
        # The best statement available about a programme with no trustworthy
        # reference: the most specific classification any reachable page earned.
        order = ['AMBIGUOUS', 'UNTRUSTED_MIXED_SEASONS', 'UNTRUSTED_BIO_CAPTURE',
                 'UNTRUSTED_BARE_CURRENT', 'UNAVAILABLE']
        seen = [a['primary'] for a in reached]
        out['type'] = next((c for c in order if c in seen), 'UNAVAILABLE')
    return out


def worklist(path):
    """`School||Sport` -> row, from an explicit worklist CSV.

    `state.targets()` reads the worklist of `RB_SEASON`, and RB_SEASON here is
    the closed season under repair. Same key function and the same `fix_url`
    repair, so a row read here is the row the pipeline would read.
    """
    import csv
    out = {}
    for r in csv.DictReader(open(path, encoding='utf-8')):
        r['_cand'] = state.fix_url((r.get(f'Roster URL {lib.SEASON} (candidate)') or '').strip())
        out[state.key(r)] = r
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--keys', required=True)
    ap.add_argument('--hosts', required=True, help='JSON: school -> {hosts:[{host}]}')
    ap.add_argument('--targets', required=True,
                    help='the worklist CSV carrying `Roster URL <season> (known good)`. '
                         'Named explicitly because the reference being repaired belongs to a '
                         'CLOSED season, whose own directory has no worklist: the record of what '
                         'served it lives in the following season\'s targets file.')
    ap.add_argument('--out', required=True)
    ap.add_argument('--workers', type=int, default=4)
    a = ap.parse_args()

    lib.reset_cache_stats()
    season = lib.SEASON
    rows = worklist(a.targets)
    ledger = json.load(open(a.hosts, encoding='utf-8'))
    with open(a.keys, encoding='utf-8') as fh:
        keys = [ln.strip() for ln in fh if ln.strip()]

    def hosts_for(k, row):
        h = {Q.underlying(row.get(f'Roster URL {season} (known good)') or ''),
             Q.underlying(row.get('_cand') or '')}
        for e in ledger.get(row['School'], {}).get('hosts', []):
            h.add(Q.canonical_host(e['host']))
        return {x for x in h if x}

    def one(k):
        r = rows[k]
        return discover(k, r, hosts_for(k, r), season)

    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        res = list(ex.map(one, keys))
    res.sort(key=lambda r: r['key'])
    json.dump({'algorithm': ALGORITHM, 'contract': Q.CONTRACT, 'season': season,
               'results': res, 'cache': dict(lib.CACHE_STATS)},
              open(a.out, 'w', encoding='utf-8'), indent=1)

    print('%d probed  (%s / %s)' % (len(res), ALGORITHM, Q.CONTRACT))
    for r in res:
        print('  %-40s %-24s %s' % (r['key'][:40], r.get('type'),
                                    (r.get('url') or '')[:70]))
    print('  found %d / %d' % (sum(1 for r in res if r['found']), len(res)))
    print('  cache', dict(lib.CACHE_STATS))


if __name__ == '__main__':
    main()
