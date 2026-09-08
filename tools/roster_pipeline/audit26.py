# -*- coding: utf-8 -*-
"""Post-run audit for a CURRENT-season acquisition.

Two questions a backfill never has to ask. (1) Is a "failure" a page I could not
read, or a roster the school has not posted yet? Those need different answers --
the second is fixed by waiting, not by more technique. (2) Is a roster that DID
parse actually this season's squad, at a plausible size? A live page has no
season label to check against, so size-vs-last-year and turnover are the checks.
"""
import os, sys, json, csv, re, glob, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import state
S, R = state.SEASON, state.REF

st = state.load()
tg = {state.key(r): r for r in state.targets()}
done = {k: v for k, v in st.items() if v.get('status') == 'done'}
fail = {k: st.get(k, {}) for k in tg if k not in done}

print(f'== {S}: {len(done)} of {len(tg)} school-sports resolved ({100*len(done)/len(tg):.1f}%) ==\n')
print('== why the rest are not here ==')
def why(v):
    e = ' '.join(str(x) for x in ([v.get('err','')] + (v.get('tried') or [])))
    if re.search(r'season is not %d|does not confirm' % S, e) or f'title="{R}' in e:
        return f'the page still shows {R} — roster not posted yet'
    if 'repeats' in e: return f'page is last season served back (turnover gate)'
    if 'too few' in e: return 'page parsed but had no roster table'
    if re.search(r'fetch (4|5)\d\d|fetch None|Timeout|DNS', e): return 'site unreachable / blocked'
    if not e.strip(): return 'never attempted'
    return 'other'
cat = collections.Counter(why(v) for v in fail.values())
for c, n in cat.most_common(): print(f'  {n:5}  {c}')

print(f'\n== roster size vs {R} (a live page can be a half-published squad) ==')
cnt = {k: int(tg[k][f'{R} Player Count'] or 0) for k in tg}
big, small = [], []
for k, v in done.items():
    n, m = v.get('n', 0), cnt.get(k, 0)
    if m >= 12 and n > 1.8 * m: big.append((n / m, k, n, m))
    if m >= 18 and n < 0.55 * m: small.append((n / m, k, n, m))
print(f'  {len(big)} rosters more than 1.8x their {R} size (staff bleed, or two squads on one page):')
for r, k, n, m in sorted(big, reverse=True)[:12]: print(f'    {r:5.1f}x  {k[:44]:44} {S}={n:3} {R}={m:3}')
print(f'  {len(small)} rosters under 0.55x their {R} size (likely still being published):')
for r, k, n, m in sorted(small)[:12]: print(f'    {r:5.2f}x  {k[:44]:44} {S}={n:3} {R}={m:3}')

print(f'\n== turnover distribution actually observed ==')
prev = collections.defaultdict(set)
DR = os.path.expanduser(f'~/Documents/Thriv3/{R} Roster Sheets')
for f in glob.glob(f'{DR}/ncaa_*{R}_rosters.csv'):
    sp = 'mens-soccer' if '_mens_' in f else 'womens-soccer'
    for r in csv.DictReader(open(f, encoding='utf-8')):
        n = re.sub(r'[^a-z]', '', r['Player Name'].lower())
        if n: prev[r['School'] + '||' + sp].add(n)
ov = []
for k, v in done.items():
    a = prev.get(k)
    if not a or len(v.get('rows', [])) < 5: continue
    g = {re.sub(r'[^a-z]', '', x['Player Name'].lower()) for x in v['rows']}
    ov.append((len(g & a) / len(g), k))
ov.sort()
if ov:
    q = lambda p: ov[int(p * (len(ov) - 1))][0]
    print(f'  n={len(ov)}  p10 {q(.10):.2f}  p50 {q(.50):.2f}  p90 {q(.90):.2f}  p99 {q(.99):.2f}  max {ov[-1][0]:.2f}')
    print(f'  {sum(1 for x in ov if x[0] >= 0.85)} at/above the 0.85 gate (should be ~1% of a genuine field)')
    print(f'  {sum(1 for x in ov if x[0] <= 0.20)} under 0.20 — suspiciously little continuity, check these:')
    for o, k in ov[:8]: print(f'    {o*100:5.0f}%  {k}')
