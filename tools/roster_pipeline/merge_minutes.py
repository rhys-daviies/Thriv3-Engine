# -*- coding: utf-8 -*-
"""Write the scraped 2024 playing time into the roster CSVs.

Only fills empty cells, and refuses values that cannot be right: minutes
beyond what the games played allow, or a games count beyond a plausible
season. A player on the roster who never appeared correctly gets nothing
rather than a zero, because absent and zero are different facts.
"""
import sys, os, csv, glob, json, re, collections, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib

D24 = os.path.expanduser('~/Documents/Thriv3/2024 Roster Sheets')
HDR = ['School','Conference','Player Name','Class/Year','Total Minutes Played','Games Played',
       'Games Started','Nationality','Hometown','Country','Source Stats URL','Source Roster URL',
       'Data Confidence','Notes','Estimated Graduation','Position']
MAX_G, MIN_PER_G = 30, 130
def nk(n): return re.sub(r'[^a-z]', '', lib.clean_name(n).lower())

def main(write=False):
    data = json.load(open('minutes24.json', encoding='utf-8'))
    st = collections.Counter()
    rejected = collections.Counter()
    for f in sorted(glob.glob(f'{D24}/ncaa_*2024_rosters.csv')):
        sp = 'mens' if '_mens_' in os.path.basename(f) else 'womens'
        rows = list(csv.DictReader(open(f, encoding='utf-8')))
        for r in rows:
            e = data.get(f"{r['School']}||{sp}")
            if not e: st['no_stats_page'] += 1; continue
            p = e['players'].get(nk(r['Player Name']))
            if not p: st['not_in_stats_table'] += 1; continue
            gp, gs, mn = p.get('gp'), p.get('gs'), p.get('min')
            if gp is not None and gp > MAX_G:
                rejected['games beyond a plausible season'] += 1; gp = None
            if mn is not None and gp is not None and mn > gp * MIN_PER_G:
                rejected['minutes beyond what the games allow'] += 1; mn = None
            if gs is not None and gp is not None and gs > gp:
                rejected['starts above games played'] += 1; gs = None
            filled = False
            if mn is not None and not r['Total Minutes Played']:
                r['Total Minutes Played'] = str(mn); filled = True
            if gp is not None and not r['Games Played']:
                r['Games Played'] = str(gp); filled = True
            if gs is not None and not r['Games Started']:
                r['Games Started'] = str(gs); filled = True
            if filled:
                st['filled'] += 1
                if not r['Source Stats URL']: r['Source Stats URL'] = e['url']
            else:
                st['matched_but_nothing_usable'] += 1
        if write:
            with open(f, 'w', newline='', encoding='utf-8') as fh:
                w = csv.DictWriter(fh, fieldnames=HDR, lineterminator='\r\n'); w.writeheader()
                for r in rows: w.writerow({c: r.get(c, '') for c in HDR})
        got = sum(1 for r in rows if r['Total Minutes Played'])
        print(f"  {os.path.basename(f):44} {got:6}/{len(rows):6} rows now carry minutes ({100*got/len(rows):.0f}%)")
    print('\n' + (str(dict(st)) if write else 'DRY RUN ' + str(dict(st))))
    if rejected: print('rejected as impossible:', dict(rejected))

if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('--write', action='store_true')
    main(ap.parse_args().write)
