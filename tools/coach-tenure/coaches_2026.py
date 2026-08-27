# -*- coding: utf-8 -*-
"""Fill the 2026 slot: who is actually in the job for the season being recruited into.

The four seasons of minutes describe 2022-2025. The recruit arrives in 2026.
Those are different questions, and until this pass existed the engine answered
the second with the first -- Bellarmine men's carried the most confident
verdict in the taxonomy ("one coach, every season counts") for a programme
whose coach is not on the 2026 staff page.

No projection is made from 2026: the season has not been played, so it holds
no minutes. The only thing read here is WHO, so a historical read can say
whose programme it describes and whether that person is still there.

Live pages only. 2026 is the current season, so its year-addressed roster page
is the authoritative source; there is no archive to fall back to, and asking
Wayback for a window that has barely closed is how a run spends hours writing
false negatives (see coaches_reparse.py).

  python3 coaches_2026.py            # resume; fills only the 2026 slot
  python3 coaches_2026.py --write    # rewrite the CSV from state, fetch nothing
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

SEASON = 2026
WORKERS = int(os.environ.get('CR_WORKERS', '8'))
_lock = threading.Lock()

WB = re.compile(r'^https?://web\.archive\.org/web/\d{8,14}(?:id_|if_|im_)?/(https?://.+)$', re.I)


def candidate_url(info):
    """The 2026 roster page, derived from an earlier season where the 2026
    sheet has no url of its own.

    193 school-sports carry no `Source Roster URL` for 2026 -- including 11 of
    the 19 programmes in the live pilot, which is how a coverage figure of 83%
    became 42% on the list that actually mattered. The address is not missing,
    it is just not in that column: these pages are year-addressed, so the 2025
    url with the year swapped IS the 2026 page. Any archive wrapper comes off
    first, because a snapshot url with 2026 pasted into it addresses nothing.
    """
    direct = info['urls'].get(str(SEASON), '')
    if direct:
        return direct, 'sheet'
    for season in (2025, 2024, 2023, 2022):
        u = info['urls'].get(str(season), '')
        if not u:
            continue
        m = WB.match(u)
        if m:
            u = m.group(1)
        swapped = re.sub(rf'/{season}(/?$)', rf'/{SEASON}\1', u)
        if swapped != u:
            return swapped, f'derived-from-{season}'
        # An undated url (".../roster") is the current season's page already;
        # appending the year makes it the one we want.
        if re.match(r'^https?://[^?#]*?/roster/?$', u, re.I):
            return f"{u.rstrip('/')}/{SEASON}", f'derived-from-{season}'
    return '', ''


def resolve_2026(key, info):
    """One school-sport's 2026 head coach. Never raises, never leaves a blank
    reason -- a blank reads as coverage."""
    school, sport = key
    url, how = candidate_url(info)
    rec = {'coach_name': '', 'coach_title': '', 'method': 'roster-live',
           'confidence': '', 'source_url': url, 'reason': ''}
    if not url:
        rec['reason'] = 'no-2026-roster-url'
        return rec
    if not C.season_addressed(url, SEASON):
        rec['reason'] = 'url-not-season-addressed'
        return rec
    try:
        st, html = lib.fetch(url, tries=2, timeout=30)
        if st != 200 or not html:
            rec['reason'] = f'fetch-{st}'
            return rec
        ok, why = C.identity_ok(html, school, sport, url=url, school_verified=True)
        if not ok:
            rec['reason'] = why
            return rec
        name, title, how = C.head_coach(html)
        if not name:
            rec['reason'] = how
            return rec
        rec.update(coach_name=name, coach_title=title or '', confidence='High')
    except Exception as exc:
        rec['reason'] = f'error:{type(exc).__name__}'
    return rec


def main():
    progs = R.universe()
    st = R.load_state()

    if '--write' in sys.argv:
        print(f'wrote {R.write_csv(st, progs)} rows to {R.CSVOUT}')
        return

    todo = [k for k in sorted(progs)
            if not ((st.get(f'{k[0]}||{k[1]}', {}).get(str(SEASON)) or {}).get('coach_name'))]
    print(f'{len(progs)} school-sports; {len(todo)} need a 2026 coach', flush=True)

    done = resolved = 0
    started = time.time()
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futs = {pool.submit(resolve_2026, k, progs[k]): k for k in todo}
        for fut in as_completed(futs):
            k = futs[fut]
            try:
                rec = fut.result()
            except Exception as exc:
                rec = {'coach_name': '', 'coach_title': '', 'method': 'roster-live',
                       'confidence': '', 'source_url': '',
                       'reason': f'error:{type(exc).__name__}'}
            with _lock:
                st.setdefault(f'{k[0]}||{k[1]}', {})[str(SEASON)] = rec
                done += 1
                if rec.get('coach_name'):
                    resolved += 1
                if done % 50 == 0:
                    R.save_state(st)
                    rate = done / max(1e-9, time.time() - started)
                    print(f'  {done}/{len(todo)}  {resolved} resolved  {rate:.1f}/s  '
                          f'eta {int((len(todo)-done)/max(rate,1e-9)/60)}m', flush=True)
    R.save_state(st)
    print(f'\n{resolved} of {len(todo)} resolved', flush=True)
    print(f'wrote {R.write_csv(st, progs)} rows to {R.CSVOUT}', flush=True)


if __name__ == '__main__':
    main()
