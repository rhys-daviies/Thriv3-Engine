# -*- coding: utf-8 -*-
"""Re-parse the seasons that were rejected on identity, from cache only.

Wayback is rate-limiting hard right now — a CDX query for a URL known to have
four snapshots returns zero after 25 seconds, and an empty body is
indistinguishable from "no snapshot", which is exactly how a throttled run
writes false negatives. So this pass touches the network for nothing.

Everything it needs is already on disk. These rows failed because the identity
check read only the rendered text: Austin College serves its women at
/sports/wsoc/ under a page that says just "Soccer", and Kentucky's page calls
itself the Wildcats. Both URLs came from the season's own roster CSV, where
the roster pipeline had already proved the school and the season — so the
check now trusts that and reads the URL as evidence too.

  python3 coaches_reparse.py           # report only
  python3 coaster_reparse.py --apply   # write state and the CSV
"""
import json
import sys

import coaches_lib as C
import coaches_run as R
import lib

# Only these. A row that failed to FETCH cannot be helped without the network,
# and re-deciding a row that already resolved is not recovery.
IDENTITY_REASONS = {'sport-not-on-page', 'school-not-on-page', 'school-qualifier-mismatch'}
APPLY = '--apply' in sys.argv


def main():
    progs = R.universe()
    st = R.load_state()

    considered = recovered = 0
    still = {}

    for key in sorted(progs):
        k = f'{key[0]}||{key[1]}'
        cur = st.get(k)
        if not cur:
            continue
        school, sport = key
        for season in R.SEASONS:
            rec = cur.get(str(season)) or {}
            if (rec.get('coach_name') or '').strip():
                continue
            if rec.get('reason') not in IDENTITY_REASONS:
                continue
            considered += 1

            url = progs[key]['urls'].get(str(season), '')
            if not url or not C.season_addressed(url, season):
                still['no-dated-url'] = still.get('no-dated-url', 0) + 1
                continue

            # use_cache means this is a disk read, not a request.
            status, html = lib.fetch(url, tries=1, timeout=10)
            if status != 200 or not html:
                still['not-in-cache'] = still.get('not-in-cache', 0) + 1
                continue

            ok, why = C.identity_ok(html, school, sport, url=url, school_verified=True)
            if not ok:
                still[why] = still.get(why, 0) + 1
                continue

            name, title, how = C.head_coach(html)
            if not name:
                still[how] = still.get(how, 0) + 1
                continue

            recovered += 1
            if APPLY:
                cur[str(season)] = {'coach_name': name, 'coach_title': title or '',
                                    'method': 'roster-live', 'confidence': 'High',
                                    'source_url': url, 'reason': ''}

    print(f'{considered} seasons were rejected on identity')
    print(f'{recovered} of them resolve once the URL counts as evidence')
    if still:
        print('\nstill unresolved:')
        for why, n in sorted(still.items(), key=lambda x: -x[1]):
            print(f'  {why:28} {n}')

    if not APPLY:
        print('\nreport only — re-run with --apply to write.\n')
        return
    R.save_state(st)
    print(f'\nwrote {R.write_csv(st, progs)} rows to {R.CSVOUT}\n')


if __name__ == '__main__':
    main()
