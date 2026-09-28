# -*- coding: utf-8 -*-
"""Parse a season statistics page for per-player minutes, games and starts.

Season validation cannot use the page title -- these pages are titled
"Cumulative Statistics" with no year -- so it uses the schedule table that sits
on the same page: if the fixture dates are mostly 2024, the stats are 2024.
"""
import os, re, sys, collections
from bs4 import BeautifulSoup
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib

NAME_H = ('player', 'name', 'full name', 'athlete')
GP_H   = ('gp', 'g p', 'games', 'games played', 'gp-gs')
GS_H   = ('gs', 'starts', 'games started')
MIN_H  = ('min', 'mins', 'minutes', 'min.', 'minutes played')
SKIP   = re.compile(r'^\s*(total|totals|opponent|opponents|team|tm|opp)\b', re.I)

def _n(s): return re.sub(r'\s+', ' ', (s or '').strip()).lower().rstrip('.')

def _num(s):
    s = re.sub(r'[,\s]', '', str(s or ''))
    if not s or s in ('-', '--', '/'): return None
    m = re.match(r'^(\d+):(\d+)$', s)                 # 45:00 -> 45
    if m: return int(m.group(1))
    m = re.match(r'^(\d+)(?:\.\d+)?$', s)
    return int(m.group(1)) if m else None

def season_years(html):
    """Years appearing in the schedule table, most common first."""
    soup = BeautifulSoup(html, 'lxml')
    yrs = collections.Counter()
    for tb in soup.find_all('table'):
        hr = (tb.find('thead') or tb).find('tr')
        if not hr: continue
        heads = [_n(x.get_text(' ', strip=True)) for x in hr.find_all(('th', 'td'))]
        if 'date' not in heads: continue
        body = tb.find('tbody') or tb
        for tr in body.find_all('tr'):
            t = tr.get_text(' ', strip=True)
            for y in re.findall(r'\b(20\d\d)\b', t): yrs[y] += 1
            m = re.search(r'\b\d{1,2}/\d{1,2}/(\d{2})\b', t)
            if m: yrs['20' + m.group(1)] += 1
    return yrs

def parse_stats(html):
    """Return {normalised name: {'gp','gs','min'}} for the biggest stats table."""
    soup = BeautifulSoup(html, 'lxml')
    best = None
    for tb in soup.find_all('table'):
        hr = (tb.find('thead') or tb).find('tr')
        if not hr: continue
        heads = [_n(x.get_text(' ', strip=True)) for x in hr.find_all(('th', 'td'))]
        iN = next((i for i, h in enumerate(heads) if h in NAME_H), None)
        if iN is None: continue
        iGP = next((i for i, h in enumerate(heads) if h in GP_H), None)
        iGS = next((i for i, h in enumerate(heads) if h in GS_H), None)
        iM  = next((i for i, h in enumerate(heads) if h in MIN_H), None)
        if iM is None and iGP is None: continue
        body = tb.find('tbody') or tb
        out = {}
        for tr in body.find_all('tr'):
            if tr is hr: continue
            tds = tr.find_all(('td', 'th'))
            if len(tds) <= iN: continue
            def cell(i):
                if i is None or i >= len(tds): return ''
                return re.sub(r'\s+', ' ', tds[i].get_text(' ', strip=True)).strip()
            nm = re.sub(r'^\s*#?\d+\s+', '', cell(iN)).strip()
            # responsive tables repeat the cell: "Greene, Alex 19 Greene, Alex"
            nm = re.split(r'\s+\d', nm)[0].strip()
            if not nm or SKIP.match(nm) or not re.search(r'[A-Za-z]{2}', nm): continue
            gp, gs, mn = _num(cell(iGP)), _num(cell(iGS)), _num(cell(iM))
            # a 'gp-gs' combined column
            if gp is None and iGP is not None and '-' in cell(iGP):
                p = cell(iGP).split('-')
                gp, gs = _num(p[0]), _num(p[1]) if len(p) > 1 else None
            if gp is None and gs is None and mn is None: continue
            # stats tables print "Lastname, Firstname"; key on the same
            # normalised form the roster files use, or nothing will join
            clean = lib.clean_name(nm)
            key = re.sub(r'[^a-z]', '', clean.lower())
            if not key: continue
            out[key] = {'name': clean, 'raw': nm, 'gp': gp, 'gs': gs, 'min': mn}
        if out and (best is None or len(out) > len(best)): best = out
    return best or {}


def schedule_says(html, season):
    """True/False/None for whether the schedule on the page dates the season."""
    ys = season_years(html)
    if not ys: return None
    n = ys.get(str(season), 0)
    if n == 0: return False
    return n >= max(ys.values())
