# -*- coding: utf-8 -*-
"""Back-fill 2024 minutes, games and starts from each programme's stats page.

The 2024 acquisition collected rosters only -- minutes were explicitly optional
-- so the season carries no playing time at all. This fills it from
/sports/<slug>/stats/2024 and its variants.

Season validation uses the schedule table on the same page rather than the
title, which reads "Cumulative Statistics" with no year: if the fixture dates
are 2024, the statistics are 2024. A page that cannot prove its season is
rejected rather than assumed, because a stats page that silently serves the
current year would attach 2025 minutes to 2024 players.
"""
import sys, os, csv, glob, re, json, collections, argparse, time
from concurrent.futures import ThreadPoolExecutor, as_completed
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, stats

D24 = os.path.expanduser('~/Documents/Thriv3/2024 Roster Sheets')
D25 = os.path.expanduser('~/Documents/Thriv3/2025 Roster Sheets')
OUT = 'minutes24.json'
def nk(n): return re.sub(r'[^a-z]', '', lib.clean_name(n).lower())

def load():
    ros, su, rurl = collections.defaultdict(list), {}, {}
    for f in sorted(glob.glob(f'{D24}/ncaa_*2024_rosters.csv')):
        sp = 'mens' if '_mens_' in os.path.basename(f) else 'womens'
        for r in csv.DictReader(open(f, encoding='utf-8')):
            ros[(r['School'], sp)].append(r)
            rurl.setdefault((r['School'], sp), r['Source Roster URL'])
    for f in sorted(glob.glob(f'{D25}/ncaa_*2025_rosters.csv')):
        sp = 'mens' if '_mens_' in os.path.basename(f) else 'womens'
        for r in csv.DictReader(open(f, encoding='utf-8')):
            if r['Source Stats URL']: su.setdefault((r['School'], sp), r['Source Stats URL'])
    return ros, su, rurl

def candidates(key, su, rurl):
    out = []
    def add(u):
        u = re.sub(r'^https?://web\.archive\.org/web/\d+(?:id_)?/', '', u or '')
        if u and u not in out: out.append(u)
    if key in su:
        s = su[key]
        add(re.sub(r'/20\d\d(?=/|$)', '/2024', s))
        add(re.sub(r'/20\d\d-\d\d(?=/|$)', '/2024-25', s))
    r = rurl.get(key, '')
    m = re.match(r'^(https?://[^/]+)(/sports/[^/]+)', r)
    if m:
        host, stem = m.group(1), m.group(2)
        for tail in ('/stats/2024', '/stats/season/2024'):
            add(host + stem + tail)
        add(host + stem + '/2024-25/stats')
    return out[:5]

def season_ok(html):
    ys = stats.season_years(html)
    if not ys: return None                      # no schedule table to judge by
    y24 = ys.get('2024', 0)
    if y24 == 0: return False
    return y24 >= max(v for k, v in ys.items())

def work(args):
    key, cands, roster = args
    rk = {nk(r['Player Name']) for r in roster}
    tried = []
    for u in cands:
        st, h = lib.fetch(u, tries=2, timeout=45)
        if st != 200 or not h:
            tried.append(f'{u} -> fetch {st}'); continue
        ok = season_ok(h)
        if ok is False:
            tried.append(f'{u} -> schedule is not 2024'); continue
        d = stats.parse_stats(h)
        if not d:
            tried.append(f'{u} -> no stats table'); continue
        hit = len(set(d) & rk)
        if hit < 3:
            tried.append(f'{u} -> only {hit} of {len(rk)} roster names in the table'); continue
        if ok is None:
            tried.append(f'{u} -> season unprovable (no schedule table)'); continue
        return key, {'url': u, 'players': {k: v for k, v in d.items()}, 'matched': hit,
                     'roster': len(rk)}, None
    return key, None, (tried[-1] if tried else 'no candidate URL')

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--workers', type=int, default=10)
    a = ap.parse_args()
    ros, su, rurl = load()
    have = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}
    todo = [(k, candidates(k, su, rurl), ros[k]) for k in ros if f'{k[0]}||{k[1]}' not in have]
    todo = [t for t in todo if t[1]]
    print(f'{len(ros)} school-sports; {len(have)} already done; {len(todo)} to fetch')
    ok = fail = 0; t0 = time.time(); fails = {}
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        futs = [ex.submit(work, t) for t in todo]
        for i, f in enumerate(as_completed(futs), 1):
            try: key, res, err = f.result()
            except Exception as e:
                fail += 1; continue
            kk = f'{key[0]}||{key[1]}'
            if res: have[kk] = res; ok += 1
            else: fails[kk] = err; fail += 1
            if i % 100 == 0:
                json.dump(have, open(OUT, 'w'), ensure_ascii=False)
                print(f'  {i}/{len(todo)} ok={ok} fail={fail} {time.time()-t0:.0f}s')
                sys.stdout.flush()
    json.dump(have, open(OUT, 'w'), ensure_ascii=False)
    json.dump(fails, open('minutes24_fails.json', 'w'), ensure_ascii=False)
    print(f'done: ok={ok} fail={fail}')
    c = collections.Counter(re.sub(r'https?://\S+', 'URL', v)[:60] for v in fails.values())
    for k, v in c.most_common(8): print(f'   {v:5} {k}')

if __name__ == '__main__': main()
