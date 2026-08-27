# -*- coding: utf-8 -*-
"""Resolve the head coach at every in-scope school-sport, 2022-2025.

  python3 coaches_run.py            # resume, then write the CSV
  python3 coaches_run.py --write    # write the CSV from state, fetch nothing

State is a JSON file keyed School||Sport, saved atomically every 50
completions, so a kill loses at most the tail. It lives beside the deliverable
rather than in a session scratchpad -- a restart once took this pipeline, an
11,000-page cache and 1,475 resolved programmes with it.

Coverage is reported FROM THE CSV, never from this script's log. Piping a long
run through `tail -N` keeps only the last N lines, and that has already caused
nine schools to be silently missed on a previous build.
"""
import csv
import glob
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import coaches_lib as C

SEASONS = (2022, 2023, 2024, 2025)
OUTDIR = os.path.expanduser('~/Documents/Thriv3/Coach Tenure')
STATEDIR = os.path.join(OUTDIR, '_state')
STATE = os.path.join(STATEDIR, 'coaches.json')
CSVOUT = os.path.join(OUTDIR, 'coach_by_season.csv')
WORKERS = int(os.environ.get('CR_WORKERS', '8'))

HDR = ['school', 'sport', 'division', 'season', 'coach_name', 'coach_title',
       'method', 'confidence', 'source_url', 'reason']

_lock = threading.Lock()


def universe():
    """Every in-scope school-sport with its per-season roster URL.

    Built from the roster files of all four seasons rather than from a
    previous worklist -- inheriting one is how a 2024 build acquired an
    18-programme blind spot that no retry could ever have found.
    """
    progs = {}
    for season in SEASONS:
        d = os.path.expanduser(f'~/Documents/Thriv3/{season} Roster Sheets')
        for f in sorted(glob.glob(f'{d}/ncaa_*_{season}_rosters.csv')):
            b = os.path.basename(f)
            div = 'NCAA ' + b.split('_')[1].upper()
            sport = 'mens-soccer' if '_mens_' in b else 'womens-soccer'
            for r in csv.DictReader(open(f, encoding='utf-8')):
                e = progs.setdefault((r['School'], sport),
                                     {'division': div, 'urls': {}})
                u = (r.get('Source Roster URL') or '').strip()
                # First NON-EMPTY, not the first row's: some rows carry no URL,
                # and accepting one left 54 school-sports with no candidate at
                # all, which then read as unattempted rather than failed.
                if u and str(season) not in e['urls']:
                    e['urls'][str(season)] = u
    return progs


def load_state():
    os.makedirs(STATEDIR, exist_ok=True)
    if os.path.exists(STATE):
        try:
            return json.load(open(STATE, encoding='utf-8'))
        except Exception:
            pass
    return {}


def save_state(st):
    """Atomic, with a PID+thread-unique temp name.

    A shared .tmp raced across processes in an earlier pipeline and corrupted
    the file it was supposed to protect.
    """
    tmp = f'{STATE}.{os.getpid()}.{threading.get_ident()}.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(st, fh)
    os.replace(tmp, STATE)


def resolve(key, info):
    """One school-sport, all four seasons. Never raises."""
    school, sport = key
    out = {}
    for season in SEASONS:
        url = info['urls'].get(str(season), '')
        rec = {'coach_name': '', 'coach_title': '', 'method': '',
               'confidence': '', 'source_url': url, 'reason': ''}
        try:
            html, method, conf, why = C.fetch_season_page(url, season, school, sport)
            rec['method'] = method
            if html is None:
                rec['reason'] = why or 'no-page'
            else:
                name, title, how = C.head_coach(html)
                if name:
                    rec.update(coach_name=name, coach_title=title or '',
                               confidence=conf, reason='')
                else:
                    # A blank with no reason reads as coverage.
                    rec['reason'] = how
        except Exception as exc:
            rec['reason'] = f'error:{type(exc).__name__}'
        out[str(season)] = rec
    return out


def write_csv(st, progs):
    os.makedirs(OUTDIR, exist_ok=True)
    rows = 0
    with open(CSVOUT, 'w', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, fieldnames=HDR)
        w.writeheader()
        for k in sorted(st):
            school, sport = k.split('||')
            div = progs.get((school, sport), {}).get('division', '')
            for season in SEASONS:
                rec = st[k].get(str(season)) or {}
                w.writerow({'school': school, 'sport': sport, 'division': div,
                            'season': season, **{c: rec.get(c, '') for c in HDR[4:]}})
                rows += 1
    return rows


def main():
    progs = universe()
    st = load_state()

    if '--write' in sys.argv:
        print(f'wrote {write_csv(st, progs)} rows to {CSVOUT}')
        return

    todo = [k for k in sorted(progs) if f'{k[0]}||{k[1]}' not in st]
    print(f'{len(progs)} school-sports; {len(st)} already done; {len(todo)} to fetch',
          flush=True)

    done = 0
    started = time.time()
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futs = {pool.submit(resolve, k, progs[k]): k for k in todo}
        for fut in as_completed(futs):
            k = futs[fut]
            try:
                res = fut.result()
            except Exception as exc:
                res = {str(s): {'coach_name': '', 'coach_title': '', 'method': '',
                                'confidence': '', 'source_url': '',
                                'reason': f'error:{type(exc).__name__}'} for s in SEASONS}
            with _lock:
                st[f'{k[0]}||{k[1]}'] = res
                done += 1
                if done % 50 == 0:
                    save_state(st)
                    rate = done / max(1e-9, time.time() - started)
                    print(f'  {done}/{len(todo)}  {rate:.1f}/s  '
                          f'eta {int((len(todo)-done)/max(rate,1e-9)/60)}m', flush=True)
    save_state(st)
    print(f'wrote {write_csv(st, progs)} rows to {CSVOUT}', flush=True)


if __name__ == '__main__':
    main()
