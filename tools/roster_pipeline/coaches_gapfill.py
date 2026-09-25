# -*- coding: utf-8 -*-
"""Fill the seasons that failed because the roster sheet stored an ARCHIVE url.

The 2025 coverage dip was never a sourcing problem. `Source Roster URL` in the
2025 and 2024 roster sheets holds a web.archive.org address for 306 and 34
school-sports respectively -- the roster pipeline had already fallen back to
the archive for those, and wrote the address it actually used. The coach pass
then read that address as if it were the programme's own page, tried to fetch
it, failed identity, and went looking for a Wayback snapshot OF a Wayback
snapshot. Every one of those came back `no-usable-page`, which reads as "this
programme has no staff page" when it means "we asked the wrong question".

Unwrapping the archive url to the page it wraps fixes it. Two routes are then
tried, live first:

  1. `<...>/roster/<season>` -- the year-addressed page, a LIVE page for a past
     season, so High confidence. Only attempted where the unwrapped url ends in
     /roster, which is the shape the archive ones take.
  2. the unwrapped url through the normal ladder, which windows Wayback to the
     season. Medium confidence, and labelled as such.

A season already carrying a name is never re-decided -- that would be a second
first pass with no baseline to compare against.

  python3 coaches_gapfill.py           # report only
  python3 coaches_gapfill.py --apply   # write state and the CSV
"""
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import coaches_lib as C
import coaches_run as R
import lib

WB = re.compile(r'^https?://web\.archive\.org/web/\d{8,14}(?:id_|if_|im_)?/(https?://.+)$', re.I)
APPLY = '--apply' in sys.argv
WORKERS = int(os.environ.get('CR_WORKERS', '6'))
_lock = threading.Lock()


def unwrap(url):
    """The page an archive url wraps, or the url unchanged."""
    m = WB.match(url or '')
    return m.group(1) if m else (url or '')


def resolve_gap(school, sport, season, url):
    """Returns a state record, or None if nothing better was found."""
    live = unwrap(url)
    if not live or live == url:
        return None                      # not an archive url: not this pass's job

    # 1. The year-addressed live page.
    m = re.match(r'^(https?://[^?#]*?/roster)/?$', live, re.I)
    if m:
        dated = f'{m.group(1)}/{season}'
        try:
            st, html = lib.fetch(dated, tries=2, timeout=30)
            if st == 200 and html:
                ok, _ = C.identity_ok(html, school, sport, url=dated, school_verified=True)
                if ok:
                    name, title, _ = C.head_coach(html)
                    if name:
                        return {'coach_name': name, 'coach_title': title or '',
                                'method': 'roster-live', 'confidence': 'High',
                                'source_url': dated, 'reason': ''}
        except Exception:
            pass

    # 2. The normal ladder on the unwrapped url, windowed to the season.
    try:
        html, method, conf, why = C.fetch_season_page(live, season, school, sport)
        if html is not None:
            name, title, how = C.head_coach(html)
            if name:
                return {'coach_name': name, 'coach_title': title or '',
                        'method': method, 'confidence': conf,
                        'source_url': live, 'reason': ''}
            return {'coach_name': '', 'coach_title': '', 'method': method,
                    'confidence': '', 'source_url': live, 'reason': how}
        return {'coach_name': '', 'coach_title': '', 'method': method,
                'confidence': '', 'source_url': live, 'reason': why or 'no-page'}
    except Exception as exc:
        return {'coach_name': '', 'coach_title': '', 'method': '', 'confidence': '',
                'source_url': live, 'reason': f'error:{type(exc).__name__}'}


def main():
    progs = R.universe()
    st = R.load_state()

    todo = []
    for key in sorted(progs):
        cur = st.get(f'{key[0]}||{key[1]}') or {}
        for season in R.SEASONS:
            rec = cur.get(str(season)) or {}
            if (rec.get('coach_name') or '').strip():
                continue
            url = progs[key]['urls'].get(str(season), '')
            if WB.match(url or ''):
                todo.append((key, season, url))

    print(f'{len(todo)} unresolved seasons whose roster url is an archive address',
          flush=True)
    if not todo:
        return

    done = recovered = 0
    started = time.time()
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futs = {pool.submit(resolve_gap, k[0], k[1], s, u): (k, s)
                for (k, s, u) in todo}
        for fut in as_completed(futs):
            (key, season) = futs[fut]
            try:
                rec = fut.result()
            except Exception:
                rec = None
            with _lock:
                done += 1
                if rec:
                    if rec.get('coach_name'):
                        recovered += 1
                    if APPLY:
                        st.setdefault(f'{key[0]}||{key[1]}', {})[str(season)] = rec
                if done % 25 == 0:
                    if APPLY:
                        R.save_state(st)
                    rate = done / max(1e-9, time.time() - started)
                    print(f'  {done}/{len(todo)}  {recovered} recovered  {rate:.1f}/s  '
                          f'eta {int((len(todo)-done)/max(rate,1e-9)/60)}m', flush=True)

    print(f'\n{recovered} of {len(todo)} recovered', flush=True)
    if not APPLY:
        print('report only — re-run with --apply to write.\n')
        return
    R.save_state(st)
    print(f'wrote {R.write_csv(st, progs)} rows to {R.CSVOUT}', flush=True)


if __name__ == '__main__':
    main()
