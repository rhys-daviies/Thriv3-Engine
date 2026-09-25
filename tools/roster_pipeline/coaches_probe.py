# -*- coding: utf-8 -*-
"""Feasibility gate: does this route actually resolve four seasons of coaches?

Run before the full pass, not after. The plan's stop condition is here: if a
season resolves for fewer than ~70% of a representative sample, the four-year
window is not supported and the scope narrows rather than 7,000 lookups being
spent proving it.

  python3 coaches_probe.py [n]
"""
import collections
import csv
import glob
import os
import random
import sys

import coaches_lib as C

SEASONS = (2022, 2023, 2024, 2025)
N = int(sys.argv[1]) if len(sys.argv) > 1 else 40


def universe():
    """Every in-scope school-sport, with its per-season roster URL."""
    progs = {}
    for season in SEASONS:
        d = os.path.expanduser(f'~/Documents/Thriv3/{season} Roster Sheets')
        for f in glob.glob(f'{d}/ncaa_*_{season}_rosters.csv'):
            b = os.path.basename(f)
            div = 'NCAA ' + b.split('_')[1].upper()
            sport = 'mens-soccer' if '_mens_' in b else 'womens-soccer'
            for r in csv.DictReader(open(f, encoding='utf-8')):
                key = (r['School'], sport)
                e = progs.setdefault(key, {'division': div, 'urls': {}})
                u = (r.get('Source Roster URL') or '').strip()
                # First NON-EMPTY wins. Taking the first row's silently left 54
                # school-sports with no candidate in the roster build.
                if u and season not in e['urls']:
                    e['urls'][season] = u
    return progs


def main():
    progs = universe()
    keys = sorted(progs)
    random.seed(11)

    # Stratify, so a thin division cannot hide behind a thick one.
    by_stratum = collections.defaultdict(list)
    for k in keys:
        by_stratum[(progs[k]['division'], k[1])].append(k)
    per = max(1, N // max(1, len(by_stratum)))
    sample = []
    for stratum in sorted(by_stratum):
        pool = by_stratum[stratum]
        sample += random.sample(pool, min(per, len(pool)))

    print(f'universe {len(keys)} school-sports; sampling {len(sample)} '
          f'across {len(by_stratum)} strata\n')

    hits = collections.Counter()
    methods = collections.Counter()
    reasons = collections.Counter()
    rows = []

    for school, sport in sample:
        info = progs[(school, sport)]
        line = {}
        for season in SEASONS:
            url = info['urls'].get(season)
            html, method, conf, reason = C.fetch_season_page(url, season, school, sport)
            if html is None:
                reasons[reason or 'no-page'] += 1
                line[season] = None
                continue
            name, title, how = C.head_coach(html)
            if not name:
                reasons[how] += 1
                line[season] = None
                continue
            hits[season] += 1
            methods[method.split(':')[0]] += 1
            line[season] = name
        rows.append((school, sport, info['division'], line))
        got = sum(1 for v in line.values() if v)
        names = {v for v in line.values() if v}
        print(f'  {got}/4  {school[:26]:26} {sport[:1]}  '
              + ' | '.join((line[s] or '—')[:20].ljust(20) for s in SEASONS))

    n = len(sample)
    print('\n── resolution by season ──')
    for s in SEASONS:
        pct = round(100 * hits[s] / n)
        flag = '' if pct >= 70 else '   ← BELOW THE 70% GATE'
        print(f'  {s}  {hits[s]:3}/{n}  {pct:3}%{flag}')
    print('\n── method ──')
    for m, c in methods.most_common():
        print(f'  {m:14} {c}')
    if reasons:
        print('\n── why a season did not resolve ──')
        for r, c in reasons.most_common():
            print(f'  {r:26} {c}')

    changed = sum(1 for _, _, _, l in rows
                  if len({v for v in l.values() if v}) > 1)
    full = [l for _, _, _, l in rows if all(l.values())]
    print(f'\n  programmes resolving all four seasons : {len(full)}/{n}')
    print(f'  programmes showing a coach change     : {changed}/{n}')


if __name__ == '__main__':
    main()
