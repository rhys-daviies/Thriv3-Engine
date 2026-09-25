# -*- coding: utf-8 -*-
"""Browser pass for the stats pages a plain fetch could not reach: sites behind
a WAF challenge (HTTP 202) and sites that render their stats client-side."""
import sys, os, csv, glob, re, json, collections, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, stats
from playwright.sync_api import sync_playwright
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36')
D24 = os.path.expanduser('~/Documents/Thriv3/2024 Roster Sheets')
D25 = os.path.expanduser('~/Documents/Thriv3/2025 Roster Sheets')
def nk(n): return re.sub(r'[^a-z]', '', lib.clean_name(n).lower())

def load():
    ros, su, rurl = collections.defaultdict(list), {}, {}
    for f in sorted(glob.glob(f'{D24}/ncaa_*2024_rosters.csv')):
        sp = 'mens' if '_mens_' in os.path.basename(f) else 'womens'
        for r in csv.DictReader(open(f, encoding='utf-8')):
            ros[(r['School'], sp)].append(r); rurl.setdefault((r['School'], sp), r['Source Roster URL'])
    for f in sorted(glob.glob(f'{D25}/ncaa_*2025_rosters.csv')):
        sp = 'mens' if '_mens_' in os.path.basename(f) else 'womens'
        for r in csv.DictReader(open(f, encoding='utf-8')):
            if r['Source Stats URL']: su.setdefault((r['School'], sp), r['Source Stats URL'])
    return ros, su, rurl

def variants(key, su, rurl):
    out = []
    def add(u):
        u = re.sub(r'^https?://web\.archive\.org/web/\d+(?:id_)?/', '', u or '')
        if u and u not in out: out.append(u)
    if key in su:
        s = su[key]
        add(re.sub(r'/20\d\d(?=/|$)', '/2024', s))
        add(re.sub(r'/stats(/|$)', '/stats/season/2024', re.sub(r'/20\d\d(?=/|$)', '', s)))
    r = rurl.get(key, '')
    m = re.match(r'^(https?://[^/]+)(/sports/[^/]+)', r)
    if m:
        host, stem = m.group(1), m.group(2)
        for t in ('/stats/season/2024', '/stats/2024', '/2024-25/stats', '/stats'):
            add(host + stem + t)
    return out[:6]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--keys', required=True); ap.add_argument('--out', required=True)
    a = ap.parse_args()
    ros, su, rurl = load()
    want = [l.strip() for l in open(a.keys) if l.strip()]
    got = {}
    with sync_playwright() as pw:
        br = pw.chromium.launch(headless=True)
        pg = br.new_context(user_agent=UA, viewport={'width': 1500, 'height': 1200}).new_page()
        for kk in want:
            school, sp = kk.split('||')
            key = (school, sp)
            rk = {nk(r['Player Name']) for r in ros.get(key, [])}
            done = False
            for u in variants(key, su, rurl):
                try:
                    pg.goto(u, timeout=35000, wait_until='domcontentloaded')
                    pg.wait_for_timeout(6500)
                    h = pg.content()
                except Exception:
                    continue
                ys = stats.season_years(h)
                if ys and ys.get('2024', 0) < max(ys.values()): continue
                d = stats.parse_stats(h)
                if not d: continue
                hit = len(set(d) & rk)
                if hit < 3 or not ys: continue
                got[kk] = {'url': pg.url, 'players': d, 'matched': hit, 'roster': len(rk)}
                print(f"  OK   {kk[:38]:38} stats={len(d):3} matched={hit:3}/{len(rk):3}")
                done = True; break
            if not done: print(f"  MISS {kk[:38]:38}")
            sys.stdout.flush()
        br.close()
    json.dump(got, open(a.out, 'w'), ensure_ascii=False)
    print(f'resolved {len(got)}/{len(want)}')

if __name__ == '__main__': main()
