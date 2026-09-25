# -*- coding: utf-8 -*-
"""Season-parameterised validation. Usage: RB_SEASON=2026 RB_REF=2025 python3 validate_season.py

validate.py was hardcoded to 2024. Everything here is the same battery, driven
by the season, plus three checks that only apply to a season not yet played:
the playing-time columns must be EMPTY, and the roster must demonstrably not be
the previous season's squad.
"""
import csv, os, re, sys, glob, collections
S = int(os.environ.get('RB_SEASON', '2026'))
R = int(os.environ.get('RB_REF', S - 1))
UNPLAYED = os.environ.get('RB_CURRENT') == '1'
DS = os.path.expanduser(f'~/Documents/Thriv3/{S} Roster Sheets')
DR = os.path.expanduser(f'~/Documents/Thriv3/{R} Roster Sheets')
HDR = ['School','Conference','Player Name','Class/Year','Total Minutes Played','Games Played',
       'Games Started','Nationality','Hometown','Country','Source Stats URL','Source Roster URL',
       'Data Confidence','Notes','Estimated Graduation','Position']
# the convention deliberately runs a year "late"; anchored on 2024: Fr->2029
GRAD = {k: str(int(v) + (S - 2024)) for k, v in
        {'FR':'2029','SO':'2028','JR':'2027','SR':'2026','GR':'2025'}.items()}
fail = []
def chk(cond, msg):
    print(('  PASS  ' if cond else '  FAIL  ') + msg)
    if not cond: fail.append(msg)

print(f'== structure ({S}, reference {R}) ==')
allrows = []
# Derived from the REFERENCE season rather than a literal 6: the moment NAIA
# joined the worklist a hardcoded count would have passed while silently
# validating none of it.
STEMS = sorted(os.path.basename(f)[:-len(f'_{R}_rosters.csv')]
               for f in glob.glob(DR + f'/*_{R}_rosters.csv'))
files = sorted(glob.glob(DS + f'/*_{S}_rosters.csv'))
chk(len(files) == len(STEMS),
    f'one file per division x sport held in {R} (want {len(STEMS)}, found {len(files)})')
for f in files:
    with open(f, encoding='utf-8', newline='') as fh:
        rd = csv.reader(fh); h = next(rd); rows = list(rd)
    chk(h == HDR, 'header exact: ' + os.path.basename(f))
    chk(all(len(r) == 16 for r in rows), '16 fields every row: ' + os.path.basename(f))
    chk(open(f, 'rb').read().count(b'\r\n') > 10, 'CRLF line endings: ' + os.path.basename(f))
    allrows += [dict(zip(HDR, r)) for r in rows]
print('  total player rows:', len(allrows))

print('\n== field contents ==')
chk(all(r['Player Name'].strip() for r in allrows), 'every row has a player name')
chk(all(r['School'].strip() for r in allrows), 'every row has a school')
chk(all(r['Data Confidence'] in ('High','Medium','Low') for r in allrows), 'confidence is High/Medium/Low')
chk(all(r['Position'] in ('','Forward','Midfielder','Defender','Goalkeeper') for r in allrows),
    'Position uses only the established vocabulary')
chk(all(r['Nationality'] in ('','USA','International') for r in allrows), 'Nationality is USA/International')
chk(all((r['Country'] == '') == (r['Nationality'] != 'International') for r in allrows),
    'Country is set exactly when Nationality is International')
chk(all(re.fullmatch(r'20\d\d', r['Estimated Graduation'] or '2024') for r in allrows),
    'Estimated Graduation is a 4-digit year or empty')
chk(all(r['Source Roster URL'].startswith('http') for r in allrows), 'every row cites a source URL')

if UNPLAYED:
    print(f'\n== {S} is unplayed: playing time must be absent, not zero ==')
    for c in ('Total Minutes Played','Games Played','Games Started'):
        n = sum(1 for r in allrows if r[c].strip())
        chk(n == 0, f'{c} empty in every row ({n} populated)')
    n = sum(1 for r in allrows if r['Source Stats URL'].strip())
    chk(n == 0, f'Source Stats URL empty in every row ({n} populated)')

# 5-year eligibility: the class label says how many years remain, so the
# graduation year is season + that. A redshirt SENIOR is in their final year and
# so sits with the graduates at +1, NOT with the seniors at +2 -- this is what
# aligns the column with the recruiting-class year on a registered player.
# A redshirt sits ONE CLASS UP: the redshirt year is one of the five, so it is
# spent whether or not the season was played. shared/classYear.js is
# authoritative; this table ran a year long for r-Fr./r-So./r-Jr. and so
# reported 1,239 correct rows as wrong while the one label it had right
# (r-Sr.) hid among them.
OFFS = {'fr.': 5, 'fy.': 5, 'r-fr.': 4, 'so.': 4, 'r-so.': 3, 'jr.': 3, 'r-jr.': 2,
        'sr.': 2, 'gr.': 1, 'r-sr.': 1, 'redshirt senior': 1, '5th': 1, 'fifth year': 1,
        'graduate student': 1, 'g-sr.': 1}
print(f'\n== graduation convention ({S}: Fr->{S+5}, So->{S+4}, Jr->{S+3}, Sr->{S+2}, Gr/R-Sr->{S+1}) ==')
bad = collections.Counter()
for r in allrows:
    c = re.sub(r'\s+', ' ', (r['Class/Year'] or '').strip()).lower()
    o = OFFS.get(c)
    g = r['Estimated Graduation'].strip()
    if o and g and g != str(S + o): bad[(c, g, str(S + o))] += 1
chk(not bad, 'every recognised class label maps to season+offset (%d wrong: %s)'
    % (sum(bad.values()), '; '.join(f'{c} said {g} want {w}' for (c, g, w), _ in bad.most_common(3))))
chk(all(re.fullmatch(r'20\d\d', r['Estimated Graduation']) or not r['Estimated Graduation'].strip()
        for r in allrows), 'graduation is a 4-digit year or blank')
_rsr = [r for r in allrows if re.fullmatch(r'r-?sr\.?|redshirt senior', (r['Class/Year'] or '').strip(), re.I)]
chk(all(r['Estimated Graduation'] == str(S + 1) for r in _rsr if r['Estimated Graduation']),
    f'redshirt seniors graduate at {S+1}, with the graduates ({len(_rsr)} rows)')

print('\n== no leaked columns in Class/Year ==')
CLUB = re.compile(r'\b(fc|sc|academy|united|club|elite|rush|surf|thorns|revolution|impact|ecnl)\b', re.I)
chk(not any(CLUB.search(r['Class/Year'] or '') for r in allrows), 'no club names in Class/Year')
chk(not any(re.fullmatch(r'\d{1,2}', r['Class/Year'] or '') for r in allrows), 'no squad numbers in Class/Year')
chk(not any(re.search(r',\s*[A-Z]{2}$', r['Class/Year'] or '') for r in allrows), 'no hometowns in Class/Year')
chk(not any(re.match(r'(pos|ht|wt|no)\s*[.:]', r['Class/Year'] or '', re.I) for r in allrows),
    'no Pos./Ht./Wt. labels in Class/Year')
# A title word only means staff when it LEADS the name ("Manager Anton Olsson")
# or when the row carries no player fields at all. Upper Iowa has a midfielder
# surnamed Coach; matching the word anywhere flags him and hides real leaks.
STAFF = re.compile(r'^(manager|managers|coach|assistant|trainer|director|operations|volunteer)\b', re.I)
leak = [r for r in allrows if STAFF.match(r['Player Name'])
        or (re.search(r'\b(head coach|assistant coach|athletic trainer)\b', r['Player Name'], re.I))]
chk(not leak, 'no staff rows in Player Name (%d found: %s)'
    % (len(leak), ', '.join(r['Player Name'][:24] for r in leak[:3])))

print(f'\n== joins against {R} ==')
for stem in STEMS:
    a = {r['School'] for r in csv.DictReader(open(f'{DS}/{stem}_{S}_rosters.csv', encoding='utf-8'))}
    b = {r['School'] for r in csv.DictReader(open(f'{DR}/{stem}_{R}_rosters.csv', encoding='utf-8'))}
    chk(a <= b, f'{stem}: every {S} school name exists in {R} ({len(a - b)} orphans)')

print('\n== duplicate players within a school-sport ==')
tot = 0
for f in files:
    rows = list(csv.DictReader(open(f, encoding='utf-8')))
    d = collections.Counter((r['School'], r['Player Name']) for r in rows)
    tot += sum(v - 1 for v in d.values() if v > 1)
chk(tot == 0, f'no duplicate player rows within any school-sport ({tot} dupes)')

print(f'\n== the squad actually turned over (this is what proves it is {S}, not {R}) ==')
def names(d, y):
    out = collections.defaultdict(set)
    for f in glob.glob(f'{d}/*_{y}_rosters.csv'):
        sp = 'mens' if '_mens_' in f else 'womens'
        for r in csv.DictReader(open(f, encoding='utf-8')):
            n = re.sub(r'[^a-z]', '', r['Player Name'].lower())
            if n: out[r['School'] + '||' + sp].add(n)
    return out
A, B = names(DR, R), names(DS, S)
ov = sorted((len(v & A[k]) / len(v), k) for k, v in B.items() if k in A and len(v) >= 5)
chk(ov and ov[-1][0] < 0.93, 'no roster repeats >=93%% of the %d squad (worst %.0f%% at %s)'
    % (R, ov[-1][0] * 100, ov[-1][1]) if ov else 'overlap computable')
over = [x for x in ov if x[0] >= 0.85]
print(f'  overlap p50 {ov[len(ov)//2][0]:.2f}  p90 {ov[int(.9*len(ov))][0]:.2f}  '
      f'p99 {ov[int(.99*len(ov))][0]:.2f}  |  {len(over)} programmes at or above the 0.85 gate')
for o, k in over[-8:]: print(f'    REVIEW {o*100:5.0f}%  {k}')

print('\n== completeness ==')
for f in ('Position','Class/Year','Hometown','Estimated Graduation','Nationality'):
    e = sum(1 for r in allrows if not r[f])
    print('  %-22s empty %6d (%.1f%%)' % (f, e, 100 * e / len(allrows)))
print('\n  Class/Year mix (a real new season carries a freshman intake):')
cm = collections.Counter((r['Class/Year'] or '(blank)').strip() for r in allrows)
for c, n in cm.most_common(8): print(f'    {n:6} ({100*n/len(allrows):4.1f}%)  {c}')
print('\n%s (%d checks failed)' % ('ALL CHECKS PASSED' if not fail else 'FAILURES PRESENT', len(fail)))
