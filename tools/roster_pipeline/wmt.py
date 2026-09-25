# -*- coding: utf-8 -*-
"""Stats for sites that render their statistics inside a wmt.games iframe.

The iframe is a JS shell, but the season id it points at is present in the
school page's own server-rendered payload, so no browser is needed: read the id,
then call the WMT API directly.

Two details that matter. `sMinutes` is in SECONDS, not minutes -- 5,681.92 over
three games is 95 minutes, not 95 hours. And `season_academic_year` is the
calendar year plus one, so the fall-2024 season reports 2025; that is the season
check, since these pages carry no schedule table to date them by.
"""
import os, re, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib

API = 'https://api.wmt.games/api/statistics/teams/{}/players?per_page=200'

def season_ids(html):
    """WMT season ids referenced by a school stats page."""
    return sorted(set(re.findall(r'wmt\.games/[\w\-]+/stats/season/(\d+)', html or '')))

def fetch_players(season_id, want_academic_year=None):
    want_academic_year = int(want_academic_year or (lib.SEASON + 1))
    st, j = lib.fetch(API.format(season_id), tries=3, timeout=50, min_size=50)
    if st != 200 or not j: return None, f'api {st}'
    try: d = json.loads(j)
    except Exception: return None, 'api returned non-json'
    items = d.get('data') if isinstance(d, dict) else d
    if not items: return None, 'api returned no players'
    yr = items[0].get('season_academic_year')
    if yr is not None and int(yr) != want_academic_year:
        return None, f'season_academic_year {yr}, wanted {want_academic_year}'
    out = {}
    for p in items:
        nm = ' '.join(x for x in (p.get('first_name'), p.get('last_name')) if x).strip()
        nm = lib.clean_name(nm)
        if not nm: continue
        season = (((p.get('statistic') or {}).get('data') or {}).get('season') or {})
        gp, gs = season.get('gamesPlayed'), season.get('gamesStarted')
        mins = None
        for col in (season.get('columns') or []):
            sec = (col.get('statistic') or {}).get('sMinutes')
            if sec is not None:
                mins = int(round(float(sec) / 60.0)); break     # seconds -> minutes
        if gp is None and gs is None and mins is None: continue
        key = re.sub(r'[^a-z]', '', nm.lower())
        if key: out[key] = {'name': nm, 'gp': gp, 'gs': gs, 'min': mins}
    return (out or None), (None if out else 'no usable rows')
