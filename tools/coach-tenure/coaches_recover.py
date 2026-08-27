# -*- coding: utf-8 -*-
"""Second pass over the seasons the main run could not resolve.

Only touches rows with no coach name. Everything already resolved is left
exactly as it was — a recovery pass that re-decides settled rows is not a
recovery pass, it is a second first pass with no baseline to compare against.

The main run reads one source: that season's own year-addressed roster page.
That is right as a default — it is a live page for a past season and the
roster pipeline already verified it — but a roster page does not always carry
a staff block. This walks further down the ladder for the rows where it did
not:

  1. the season's /coaches page, live      (only meaningful for the current one)
  2. the season's /coaches page, archived  (windowed to the season)
  3. the roster page, archived             (a different capture of the same page)

Each source is tried only until one yields a head coach, so a programme that
resolved at step 1 costs nothing further.
"""
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import coaches_lib as C
import coaches_run as R
import lib

LIVE_SEASON = 2025
_lock = threading.Lock()


def sources(roster_url, season, school, sport):
    """Every page that might name this season's coach, best first.

    Yields (html, method, confidence).
    """
    cu = C.coaches_url(roster_url)

    # 1. The staff page as it stands, but only for the season it describes.
    #    Reading today's /coaches for 2022 would stamp the current coach on a
    #    season he may not have worked, which is the exact error this whole
    #    module exists to avoid.
    if cu and season == LIVE_SEASON:
        st, h = lib.fetch(cu, tries=2, timeout=30)
        if st == 200 and h:
            ok, _ = C.identity_ok(h, school, sport, url=cu)
            if ok:
                yield h, 'coaches-live', 'High'

    # 2 and 3. Archived captures, windowed so the snapshot falls inside the
    #    season. The roster page is tried again because a different capture of
    #    it may include a staff block the live one lazy-loads.
    frm, to = C.season_window(season)
    for base, label, verified in ((cu, 'coaches-wayback', False),
                                  (roster_url, 'roster-wayback', True)):
        if not base:
            continue
        for ts in lib.cdx(base, frm=frm, to=to, limit=4):
            st, h = lib.fetch(lib.wb_url(ts, base), tries=2, timeout=45)
            if st == 200 and h:
                ok, _ = C.identity_ok(h, school, sport, url=base, school_verified=verified)
                if ok:
                    yield h, f'{label}:{ts}', 'Medium'
                    break


def recover_one(key, info, current):
    """Retry only the unresolved seasons of one programme."""
    school, sport = key
    out = dict(current)
    for season in R.SEASONS:
        rec = dict(out.get(str(season)) or {})
        if (rec.get('coach_name') or '').strip():
            continue                                    # already settled
        url = info['urls'].get(str(season), '')

        # First: the main route again, now that identity trusts a verified URL.
        try:
            html, method, conf, why = C.fetch_season_page(url, season, school, sport)
            if html is not None:
                name, title, how = C.head_coach(html)
                if name:
                    out[str(season)] = {'coach_name': name, 'coach_title': title or '',
                                        'method': method, 'confidence': conf,
                                        'source_url': url, 'reason': ''}
                    continue
                rec['reason'] = how
            else:
                rec['reason'] = why or rec.get('reason') or 'no-page'
        except Exception as exc:
            rec['reason'] = f'error:{type(exc).__name__}'

        # Then the wider ladder.
        got = False
        try:
            for html, method, conf in sources(url, season, school, sport):
                name, title, how = C.head_coach(html)
                if name:
                    out[str(season)] = {'coach_name': name, 'coach_title': title or '',
                                        'method': method, 'confidence': conf,
                                        'source_url': url, 'reason': ''}
                    got = True
                    break
                rec['reason'] = how
        except Exception as exc:
            rec['reason'] = f'error:{type(exc).__name__}'
        if not got:
            rec.setdefault('coach_name', '')
            rec.setdefault('source_url', url)
            out[str(season)] = rec
    return out


def main():
    progs = R.universe()
    st = R.load_state()

    todo = []
    for key in sorted(progs):
        k = f'{key[0]}||{key[1]}'
        cur = st.get(k) or {}
        if any(not ((cur.get(str(s)) or {}).get('coach_name') or '').strip() for s in R.SEASONS):
            todo.append(key)

    before = sum(1 for k in st for s in R.SEASONS
                 if ((st[k].get(str(s)) or {}).get('coach_name') or '').strip())
    print(f'{len(todo)} programmes carry at least one unresolved season; '
          f'{before} seasons resolved before this pass', flush=True)

    done = 0
    started = time.time()
    workers = int(os.environ.get('CR_WORKERS', '8'))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(recover_one, k, progs[k], st.get(f'{k[0]}||{k[1]}') or {}): k
                for k in todo}
        for fut in as_completed(futs):
            k = futs[fut]
            try:
                res = fut.result()
            except Exception:
                continue
            with _lock:
                st[f'{k[0]}||{k[1]}'] = res
                done += 1
                if done % 50 == 0:
                    R.save_state(st)
                    rate = done / max(1e-9, time.time() - started)
                    print(f'  {done}/{len(todo)}  {rate:.1f}/s  '
                          f'eta {int((len(todo)-done)/max(rate,1e-9)/60)}m', flush=True)
    R.save_state(st)

    after = sum(1 for k in st for s in R.SEASONS
                if ((st[k].get(str(s)) or {}).get('coach_name') or '').strip())
    print(f'\nrecovered {after - before} seasons ({before} -> {after})', flush=True)
    print(f'wrote {R.write_csv(st, progs)} rows to {R.CSVOUT}', flush=True)


if __name__ == '__main__':
    main()
