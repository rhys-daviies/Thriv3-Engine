# -*- coding: utf-8 -*-
"""Recompute Estimated Graduation on every stored row from the CURRENT rule.

Same defect family as verify_gate.py, different column. A state entry is a
cache of rows built by whatever lib.grad_for_season said at the time. The
five-season eligibility revision landed on 2026-08-27, a day after the first
2026 acquisition, so 1,239 rows carried a redshirt's graduation a year late --
correct when written, wrong now, and invisible because they were never
re-fetched. Recomputing beats re-scraping: the class label is already stored.
"""
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import state, lib

st = state.load()
changed = collections.Counter(); n = 0
for k, v in st.items():
    for r in (v.get('rows') or []):
        want = lib.grad_for_season(r.get('Class/Year'), lib.SEASON)
        if want and want != (r.get('Estimated Graduation') or ''):
            changed[((r.get('Class/Year') or '').strip(), r.get('Estimated Graduation'), want)] += 1
            r['Estimated Graduation'] = want; n += 1
print(f'{n} rows restated')
for kk, c in changed.most_common(10): print(f'   {c:5}  {kk[0]!r} {kk[1]} -> {kk[2]}')
if n and '--apply' in sys.argv:
    state.save(st); print('saved')
elif n:
    print('(dry run -- pass --apply)')
