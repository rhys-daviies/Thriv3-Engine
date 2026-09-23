# -*- coding: utf-8 -*-
"""What a run WOULD attempt. Reads the worklist and state; touches no network.

Exists because the alternative is finding out afterwards. L6D was stopped by
discovering, only once the stages were traced, that the runner would have
attempted 255 programmes including 75 in associations the stage forbade. A run
should be able to state its own scope before it makes a request.

  RB_SEASON=2026 RB_REF=2025 RB_CURRENT=1 \\
  RB_KEYS=/path/keys.txt RB_DIVISIONS='NCAA D2,NCAA D3' python3 plan.py
"""
import os
import sys
import collections

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import state  # noqa: E402


def main():
    universe = state.targets()
    scoped = state.attempt_targets()
    st = state.load()
    done = {k for k, v in st.items() if v.get('status') == 'done'}
    failed = {k for k, v in st.items() if v.get('status') not in (None, 'done')}

    eligible = [r for r in universe if state.key(r) not in done]
    attempt = [r for r in scoped if state.key(r) not in done]
    excluded = [r for r in eligible if state.key(r) not in {state.key(x) for x in attempt}]

    print(f'  target universe        {len(universe)}   (membership — unchanged by scope)')
    print(f'  already done           {len(done)}')
    print(f'  eligible this season   {len(eligible)}')
    print(f'  RB_KEYS                {os.environ.get("RB_KEYS", "(none)")}')
    print(f'  RB_DIVISIONS           {os.environ.get("RB_DIVISIONS", "(none)")}')
    print(f'  TO ATTEMPT             {len(attempt)}')
    print(f'  excluded by scope      {len(excluded)}  (left eligible for a future run)')
    print()
    by = collections.Counter((r['Division'], r['Sport']) for r in attempt)
    print('  attempt set by division x sport:')
    for k, n in sorted(by.items()):
        print(f'    {n:5}  {k[0]}  {k[1]}')
    exc = collections.Counter(r['Division'] for r in excluded)
    if exc:
        print('  excluded by division:')
        for k, n in sorted(exc.items()):
            print(f'    {n:5}  {k}')
    print()
    retryable = [r for r in attempt if state.key(r) in failed]
    print(f'  of the attempt set, previously failed and being retried: {len(retryable)}')
    print(f'  never attempted before: {len(attempt) - len(retryable)}')


if __name__ == '__main__':
    main()
