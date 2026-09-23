# -*- coding: utf-8 -*-
"""Second pass for the 144 stats pages a plain table read could not get:
WMT-iframe sites via the API, WAF-challenged sites via a rendered browser."""
import sys, os, csv, glob, re, json, collections, argparse, time
from concurrent.futures import ThreadPoolExecutor, as_completed
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, stats, wmt

D24 = os.path.expanduser('~/Documents/Thriv3/2024 Roster Sheets')
D25 = os.path.expanduser('~/Documents/Thriv3/2025 Roster Sheets')
def nk(n): return re.sub(r'[^a-z]', '', lib.clean_name(n).lower())

def load():
    ros, su, rurl = collections.defaultdict(set), {}, {}
    for f in sorted(glob.glob(f'{D24}/ncaa_*2024_rosters.csv')):
        sp = 'mens' if '_mens_' in os.path.basename(f) else 'womens'
        for r in csv.DictReader(open(f, encoding='utf-8')):
            ros[(r['School'], sp)].add(nk(r['Player Name']))
            rurl.setdefault((r['School'], sp), r['Source Roster URL'])
    for f in sorted(glob.glob(f'{D25}/ncaa_*2025_rosters.csv')):
        sp = 'mens' if '_mens_' in os.path.basename(f) else 'womens'
        for r in csv.DictReader(open(f, encoding='utf-8')):
            if r['Source Stats URL']: su.setdefault((r['School'], sp), r['Source Stats URL'])
    return ros, su, rurl

def urls(key, su, rurl):
    out = []
    def add(u):
        u = re.sub(r'^https?://web\.archive\.org/web/\d+(?:id_)?/', '', u or '')
        if u and u not in out: out.append(u)
    if key in su:
        s = su[key]
        add(re.sub(r'/20\d\d(?=/|$)', '/2024', s))
        add(re.sub(r'/20\d\d(?=/|$)', '', s).rstrip('/') + '/season/2024')
    m = re.match(r'^(https?://[^/]+)(/sports/[^/]+)', rurl.get(key, ''))
    if m:
        host, stem = m.group(1), m.group(2)
        for t in ('/stats/season/2024', '/stats/2024', '/2024-25/stats', '/stats'):
            add(host + stem + t)
    return out[:6]

def work(args):
    kk, cands, rk = args
    tried = []
    for u in cands:
        st, h = lib.fetch(u, tries=2, timeout=45)
        if st != 200 or not h:
            tried.append(f'fetch {st}'); continue
        # a) statistics behind a WMT iframe
        for sid in wmt.season_ids(h)[:2]:
            d, err = wmt.fetch_players(sid)
            if d and len(set(d) & rk) >= 3:
                return kk, {'url': u, 'via': f'wmt api season {sid}', 'players': d,
                            'matched': len(set(d) & rk), 'roster': len(rk)}, None
            if err: tried.append(f'wmt {sid}: {err}')
        # b) a plain table, dated by its own schedule
        ys = stats.season_years(h)
        d = stats.parse_stats(h)
        if d and len(set(d) & rk) >= 3 and ys and ys.get('2024', 0) >= max(ys.values()):
            return kk, {'url': u, 'via': 'stats table', 'players': d,
                        'matched': len(set(d) & rk), 'roster': len(rk)}, None
        tried.append(f'{u.rsplit("/",2)[-1]}: table={len(d) if d else 0} sched2024={bool(ys and ys.get("2024"))}')
    return kk, None, '; '.join(tried[-3:]) or 'no candidate'

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--keys', default='min_fail_keys.txt'); ap.add_argument('--workers', type=int, default=8)
    a = ap.parse_args()
    ros, su, rurl = load()
    want = [l.strip() for l in open(a.keys) if l.strip()]
    todo = []
    for kk in want:
        school, sp = kk.split('||')
        todo.append((kk, urls((school, sp), su, rurl), ros[(school, sp)]))
    print(f'residue pass over {len(todo)} school-sports'); sys.stdout.flush()
    got, fails = {}, {}
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        for f in as_completed([ex.submit(work, t) for t in todo]):
            kk, res, err = f.result()
            if res:
                got[kk] = res
                print(f"  OK   {kk[:36]:36} {res['matched']:3}/{res['roster']:3} [{res['via']}]")
            else:
                fails[kk] = err
                print(f"  MISS {kk[:36]:36} {str(err)[:64]}")
            sys.stdout.flush()
    json.dump(got, open('minutes24_residue.json', 'w'), ensure_ascii=False)
    json.dump(fails, open('minutes24_residue_fails.json', 'w'), ensure_ascii=False)
    print(f'\nresolved {len(got)}/{len(todo)}')

if __name__ == '__main__': main()
