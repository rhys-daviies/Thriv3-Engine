# -*- coding: utf-8 -*-
"""Re-apply the turnover gate to every roster already marked done.

Why this exists. A stage file (`state_variants_<S>.json`, `st_sel_<S>.json`,
`st_br<S>_*.json`) is a CACHE that outlives the code that filled it. `absorb`
in the runner merges every `done` entry it finds there into the main state, and
trusts it. On 2026-08-26 the turnover gate was wrong three times before it was
right; entries resolved under the broken gate stayed in the stage files after
the fixed run refused them, and a re-run two days later absorbed all of them
back in -- 14 programmes shipped 85-100% of the previous season's squad, eight
of them at exactly 100%. Nothing about the merge was detectably wrong: the
entries were well-formed, recent, and carried a confident note reading
"2025 name overlap 100%" written by the code that no longer existed.

The fix is not to reason about which cache entry came from which code. It is to
re-measure the shipped rows against the gate that is in force now. Provenance is
a story; the overlap is a number.

Runs against the state file in place, and purges demoted keys from the stage
files so the next absorb cannot resurrect them.
"""
import sys, os, re, json, glob, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import state, run

GATE = run.TURNOVER_MAX

def shipped_names(rows):
    out = [re.sub(r'[^a-z]', '', (r.get('Player Name') or '').lower()) for r in rows or []]
    return [x for x in out if x]

def main():
    ref = state.names25()
    st = state.load()
    demoted, checked, blind = [], 0, 0
    for k, v in st.items():
        if v.get('status') != 'done': continue
        names = shipped_names(v.get('rows'))
        base = ref.get(k)
        if not names or not base:
            blind += 1
            continue
        checked += 1
        ov = sum(1 for n in names if n in base) / len(names)
        if ov >= GATE:
            demoted.append((k, ov, len(names), len(base), v.get('stage')))
    print(f'{checked} done rosters re-measured, {blind} with no {state.REF} baseline to test')
    print(f'{len(demoted)} at or above the {GATE:.0%} gate:')
    for k, ov, n, m, sg in sorted(demoted, key=lambda x: -x[1]):
        # Same size means last season served back; smaller means a real page
        # listing only returners with the intake still to come. Both are wrong
        # to ship, and the second is the one that would record 100% retention.
        kind = 'previous squad served back' if n >= m - 1 else 'only returners listed, intake pending'
        print(f'   {ov*100:5.0f}%  {k:44} {n:3} vs {m:3} {state.REF}  [{sg}]  {kind}')
    if not demoted: return 0
    if '--apply' not in sys.argv:
        print('\n(dry run -- pass --apply to demote)')
        return 0
    keys = {k for k, *_ in demoted}
    for k, ov, n, m, sg in demoted:
        prev = st[k]
        st[k] = {'status': 'failed', 'stage': sg, 'err':
                 'roster repeats %.0f%% of the %d squad (gate %.0f%%), demoted by verify_gate'
                 % (ov * 100, state.REF, GATE * 100),
                 'tried': (prev.get('tried') or []) + ['verify_gate: %.0f%% overlap' % (ov * 100)]}
    state.save(st)
    # The stage files are the cache that caused this; leaving the entries there
    # would let the very next absorb undo the demotion silently.
    for f in glob.glob(f'state_variants_{state.SEASON}.json') + glob.glob(f'st_sel_{state.SEASON}.json') \
             + glob.glob(f'st_br{state.SEASON}_*.json') + glob.glob(f'st_repaired_{state.SEASON}.json'):
        d = json.load(open(f, encoding='utf-8'))
        hit = [k for k in keys if k in d]
        if not hit: continue
        for k in hit: d.pop(k)
        json.dump(d, open(f, 'w', encoding='utf-8'), ensure_ascii=False)
        print(f'  purged {len(hit)} from {f}')
    print(f'\ndemoted {len(demoted)}')
    return 0

if __name__ == '__main__': sys.exit(main())
