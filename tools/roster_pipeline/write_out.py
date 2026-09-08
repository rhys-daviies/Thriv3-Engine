# -*- coding: utf-8 -*-
"""Write one CSV per division x sport and mark up _targets.csv."""
import sys, os, csv, json, collections, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import state

SEASON = int(os.environ.get('RB_SEASON', '2024'))
OUT = os.path.expanduser(f'~/Documents/Thriv3/{SEASON} Roster Sheets')
HDR = ['School','Conference','Player Name','Class/Year','Total Minutes Played','Games Played',
       'Games Started','Nationality','Hometown','Country','Source Stats URL','Source Roster URL',
       'Data Confidence','Notes','Estimated Graduation','Position']
FILES = {('NCAA D1','mens-soccer'):f'ncaa_d1_mens_soccer_{SEASON}_rosters.csv',
         ('NCAA D1','womens-soccer'):f'ncaa_d1_womens_soccer_{SEASON}_rosters.csv',
         ('NCAA D2','mens-soccer'):f'ncaa_d2_mens_soccer_{SEASON}_rosters.csv',
         ('NCAA D2','womens-soccer'):f'ncaa_d2_womens_soccer_{SEASON}_rosters.csv',
         ('NCAA D3','mens-soccer'):f'ncaa_d3_mens_soccer_{SEASON}_rosters.csv',
         ('NCAA D3','womens-soccer'):f'ncaa_d3_womens_soccer_{SEASON}_rosters.csv',
         ('NAIA','mens-soccer'):f'naia_mens_soccer_{SEASON}_rosters.csv',
         ('NAIA','womens-soccer'):f'naia_womens_soccer_{SEASON}_rosters.csv',
         ('USCAA','mens-soccer'):f'uscaa_mens_soccer_{SEASON}_rosters.csv',
         ('USCAA','womens-soccer'):f'uscaa_womens_soccer_{SEASON}_rosters.csv'}

def main():
    st = state.load()
    rows = state.targets()
    buckets = collections.defaultdict(list)
    stats = collections.Counter()
    per_file_schools = collections.defaultdict(set)
    failed = []
    # keep the target order so the files are stable and diff-friendly
    for r in rows:
        k = state.key(r)
        e = st.get(k) or {}
        f = FILES[(r['Division'], r['Sport'])]
        if e.get('status') == 'done' and e.get('rows'):
            buckets[f].extend(e['rows'])
            per_file_schools[f].add(r['School'])
            stats['schools_done'] += 1
            stats['players'] += len(e['rows'])
            stats['conf_' + (e['rows'][0]['Data Confidence'] or '?')] += 1
        else:
            stats['schools_failed'] += 1
            failed.append((r, e))
    os.makedirs(OUT, exist_ok=True)
    for (div, sp), f in FILES.items():
        p = os.path.join(OUT, f)
        with open(p, 'w', newline='', encoding='utf-8') as fh:
            w = csv.DictWriter(fh, fieldnames=HDR, lineterminator='\r\n')
            w.writeheader()
            for row in buckets[f]: w.writerow(row)
        print('%-42s %6d players  %4d schools' % (f, len(buckets[f]), len(per_file_schools[f])))
    # mark up _targets.csv
    T = state.T24
    src = list(csv.DictReader(open(T, encoding='utf-8')))
    fn = list(src[0].keys())
    with open(T, 'w', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, fieldnames=fn, lineterminator='\r\n')
        w.writeheader()
        for r in src:
            k = r['School'] + '||' + r['Sport']
            e = st.get(k) or {}
            if e.get('status') == 'done':
                r['Status'] = 'done'
                r['Notes'] = '%s via %s; %d players; parser=%s; url=%s' % (
                    e['rows'][0]['Data Confidence'], e.get('stage','?'), e.get('n',0),
                    e.get('parser','?'), e.get('url',''))
            else:
                r['Status'] = 'failed'
                tried = e.get('tried') or ([e['err']] if e.get('err') else [])
                r['Notes'] = 'unresolved. tried: ' + (' | '.join(str(t) for t in tried) or 'no attempt recorded')
            w.writerow(r)
    print()
    print('schools done   :', stats['schools_done'])
    print('schools failed :', stats['schools_failed'])
    print('player rows    :', stats['players'])
    print('confidence     :', {k[5:]: v for k, v in stats.items() if k.startswith('conf_')})
    if failed:
        print('\nFAILED (%d):' % len(failed))
        for r, e in failed:
            print('  %-30s %-14s %-8s %s' % (r['School'][:30], r['Sport'], r['Division'],
                  (e.get('err') or 'not attempted')))
    return stats, failed

if __name__ == '__main__': main()
