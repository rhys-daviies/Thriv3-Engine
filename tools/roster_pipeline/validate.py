# -*- coding: utf-8 -*-
import csv, os, re, sys, glob, collections
D24 = os.path.expanduser('~/Documents/Thriv3/2024 Roster Sheets')
D25 = os.path.expanduser('~/Documents/Thriv3/2025 Roster Sheets')
HDR = ['School','Conference','Player Name','Class/Year','Total Minutes Played','Games Played',
       'Games Started','Nationality','Hometown','Country','Source Stats URL','Source Roster URL',
       'Data Confidence','Notes','Estimated Graduation','Position']
GRAD24 = {'FR':'2029','SO':'2028','JR':'2027','SR':'2026','GR':'2025'}
fail = []
def chk(cond, msg):
    print(('  PASS  ' if cond else '  FAIL  ') + msg)
    if not cond: fail.append(msg)

print('== structure ==')
allrows = []
for f in sorted(glob.glob(D24 + '/ncaa_*2024_rosters.csv')):
    with open(f, encoding='utf-8', newline='') as fh:
        rd = csv.reader(fh); h = next(rd)
        chk(h == HDR, 'header exact: ' + os.path.basename(f))
        rows = [r for r in rd]
    chk(all(len(r) == 16 for r in rows), '16 fields every row: ' + os.path.basename(f))
    raw = open(f, 'rb').read()
    chk(raw.count(b'\r\n') > 10, 'CRLF line endings: ' + os.path.basename(f))
    for r in rows: allrows.append(dict(zip(HDR, r)))
print('  total player rows:', len(allrows))

print('\n== field contents ==')
chk(all(r['Player Name'].strip() for r in allrows), 'every row has a player name')
chk(all(r['School'].strip() for r in allrows), 'every row has a school')
chk(all(r['Data Confidence'] in ('High','Medium','Low') for r in allrows), 'confidence is High/Medium/Low')
chk(all(r['Position'] in ('','Forward','Midfielder','Defender','Goalkeeper') for r in allrows),
    'Position uses only the 2025 vocabulary')
chk(all(r['Nationality'] in ('','USA','International') for r in allrows), 'Nationality is USA/International')
chk(all((r['Country'] == '') == (r['Nationality'] != 'International') for r in allrows),
    'Country is set exactly when Nationality is International')
chk(all(re.fullmatch(r'20\d\d', r['Estimated Graduation'] or '2024') for r in allrows),
    'Estimated Graduation is a 4-digit year or empty')
chk(all(r['Source Roster URL'].startswith('http') for r in allrows), 'every row cites a source URL')

print('\n== graduation convention (2024 season: Fr->2029 ... Gr->2025) ==')
bad = 0
for r in allrows:
    c = (r['Class/Year'] or '').strip().lower()
    g = r['Estimated Graduation']
    m = {'fr.':'FR','so.':'SO','jr.':'JR','sr.':'SR','gr.':'GR'}.get(c)
    if m and g and g != GRAD24[m]: bad += 1
chk(bad == 0, 'plain Fr./So./Jr./Sr./Gr. map to the 2024-season offsets (%d wrong)' % bad)

print('\n== no leaked columns in Class/Year ==')
CLUB = re.compile(r'\b(fc|sc|academy|united|club|elite|rush|surf|thorns|revolution|impact|ecnl)\b', re.I)
chk(not any(CLUB.search(r['Class/Year'] or '') for r in allrows), 'no club names in Class/Year')
chk(not any(re.fullmatch(r'\d{1,2}', r['Class/Year'] or '') for r in allrows), 'no squad numbers in Class/Year')
chk(not any(re.search(r',\s*[A-Z]{2}$', r['Class/Year'] or '') for r in allrows), 'no hometowns in Class/Year')
chk(not any(re.match(r'(pos|ht|wt|no)\s*[.:]', r['Class/Year'] or '', re.I) for r in allrows),
    'no Pos./Ht./Wt. labels in Class/Year')

print('\n== joins against 2025 ==')
for stem in ['ncaa_d1_mens','ncaa_d1_womens','ncaa_d2_mens','ncaa_d2_womens','ncaa_d3_mens','ncaa_d3_womens']:
    a = {r['School'] for r in csv.DictReader(open(f'{D24}/{stem}_soccer_2024_rosters.csv', encoding='utf-8'))}
    b = {r['School'] for r in csv.DictReader(open(f'{D25}/{stem}_soccer_2025_rosters.csv', encoding='utf-8'))}
    chk(a <= b, '%s: every 2024 school name exists in 2025 (%d orphans)' % (stem, len(a - b)))

print('\n== duplicate players within a school-sport ==')
# the diff joins on (School, Sport), so uniqueness only has to hold per file;
# the same name in the men's and women's file is two different people
tot = 0
for f in sorted(glob.glob(D24 + '/ncaa_*2024_rosters.csv')):
    rows = list(csv.DictReader(open(f, encoding='utf-8')))
    d = collections.Counter((r['School'], r['Player Name']) for r in rows)
    tot += sum(v - 1 for v in d.values() if v > 1)
chk(tot == 0, 'no duplicate player rows within any school-sport (%d dupes)' % tot)

print('\n== completeness ==')
for f in ('Position','Class/Year','Hometown','Estimated Graduation'):
    e = sum(1 for r in allrows if not r[f])
    print('  %-22s empty %6d (%.1f%%)' % (f, e, 100*e/len(allrows)))
print('\n%s (%d checks failed)' % ('ALL CHECKS PASSED' if not fail else 'FAILURES PRESENT', len(fail)))
