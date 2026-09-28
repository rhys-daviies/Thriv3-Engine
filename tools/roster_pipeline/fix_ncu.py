# -*- coding: utf-8 -*-
"""North Central University was given North Central College's roster.

Both stores pointed at northcentralcardinals.com, which is North Central College
(Naperville, IL). North Central University is a different school in Minneapolis
whose athletics site is ncurams.com. Replace the mis-attributed roster in both
seasons with the real one.
"""
import sys, os, csv, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, state, run

SCHOOL = 'North Central University'
KEY = f'{SCHOOL}||womens-soccer'
D25 = os.path.expanduser('~/Documents/Thriv3/2025 Roster Sheets')
F25 = f'{D25}/ncaa_d3_womens_soccer_2025_rosters.csv'
HDR = ['School','Conference','Player Name','Class/Year','Total Minutes Played','Games Played',
       'Games Started','Nationality','Hometown','Country','Source Stats URL','Source Roster URL',
       'Data Confidence','Notes','Estimated Graduation','Position']
NOTE = ('roster re-acquired from ncurams.com: both stores previously pointed at '
        'northcentralcardinals.com, which is North Central College, a different school')

# ---- 2024: fix the state entry so write_out rebuilds the file -----------------
ncu = json.load(open('ncu.json', encoding='utf-8'))
tg = {state.key(r): r for r in state.targets()}
st = state.load()
r24 = ncu.get('2024') or ncu.get(2024)
rows24 = run.build(r24['rows'], tg[KEY], r24['url'], 'High',
                   NOTE + '; direct read of the official 2024 roster page')
st[KEY] = {'status':'done','stage':'ncu-refix','url':r24['url'],'parser':'table',
           'n':len(rows24),'rows':rows24,'title':r24['title']}
state.save(st)
print(f'2024: North Central University -> {len(rows24)} real players (was 30 belonging to the College)')

# ---- 2025: replace the mis-attributed rows in place --------------------------
names25 = json.load(open('ncu2025_names.json', encoding='utf-8'))
rows = list(csv.DictReader(open(F25, encoding='utf-8')))
conf = next((r['Conference'] for r in rows if r['School'] == SCHOOL), '')
old = [r for r in rows if r['School'] == SCHOOL]
out, inserted = [], False
for r in rows:
    if r['School'] == SCHOOL:
        if not inserted:
            inserted = True
            for n in names25:
                nm = lib.clean_name(n)
                if not nm: continue
                out.append({'School':SCHOOL,'Conference':conf,'Player Name':nm,'Class/Year':'',
                    'Total Minutes Played':'','Games Played':'','Games Started':'',
                    'Nationality':'','Hometown':'','Country':'','Source Stats URL':'',
                    'Source Roster URL':'https://ncurams.com/sports/womens-soccer/roster/2025',
                    'Data Confidence':'Low',
                    'Notes':NOTE + '; names only - the 2025 page renders its roster client-side',
                    'Estimated Graduation':'','Position':''})
        continue
    out.append(r)
with open(F25,'w',newline='',encoding='utf-8') as fh:
    w = csv.DictWriter(fh, fieldnames=HDR, lineterminator='\r\n'); w.writeheader()
    for r in out: w.writerow({k: r.get(k,'') for k in HDR})
new = [r for r in out if r['School'] == SCHOOL]
print(f'2025: North Central University -> {len(new)} real players (was {len(old)} belonging to the College)')
print(f'2025 file: {len(rows)} -> {len(out)} rows')
