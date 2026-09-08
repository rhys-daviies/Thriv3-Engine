# -*- coding: utf-8 -*-
"""Live-URL ladder for every row the plain year-swap did not resolve.

Tries the season-bearing forms of the candidate URL before falling back to
Wayback, because a live 2024 page is a High-confidence read and a snapshot
is only Medium.
"""
import sys, os, re, json, time, argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, state, run
S = lib.SEASON
# A backfill can always demand that the page name its season. The CURRENT
# season cannot: most live roster pages are titled "Men's Soccer Roster" with
# no year at all, because the site has only one. So when RB_CURRENT is set we
# accept a silent title on the year-less URL, but only against positive
# evidence that the squad actually turned over. Measured on three known-good
# season pairs, 99% of genuine rosters share under 0.85 of their names with the
# season before; the 2025 page served back to us would score ~1.00.
CURRENT = run.CURRENT
TURNOVER_MAX = run.TURNOVER_MAX
SPAN = f'{S}-{(S+1)%100:02d}'
REFCOL = f'Roster URL {state.REF} (known good)'
CNTCOL = f'{state.REF} Player Count'

def strip_wb(u):
    return re.sub(r'^https?://web\.archive\.org/web/\d+(?:id_)?/', '', u or '')

def ladder(cand, url25):
    """Ordered live-URL candidates for the 2024 season."""
    out = []
    def add(u):
        if u and u not in out: out.append(u)
    for src in (cand, strip_wb(url25)):
        if not src: continue
        u = src.rstrip('/')
        # drop a trailing player-bio segment: .../roster/firstname-lastname[/id]
        u = re.sub(r'(/roster)/[a-z0-9][a-z0-9\-\.]+(?:/\d+)?$', r'\1', u, flags=re.I)
        # a) already season-bearing: normalise the year to 2024
        if re.search(r'/20\d\d(-\d\d)?(/|$)', u):
            add(re.sub(r'/20\d\d-\d\d(?=/|$)', f'/{SPAN}', u))
            add(re.sub(r'/20\d\d(?=/|$)', f'/{S}', u))
        # b) append the season to a year-less roster path
        m = re.match(r'^(.*?/roster)(?:/.*)?$', u)
        base = m.group(1) if m else u
        add(base + f'/{S}')
        add(base + f'/season/{S}')
        add(base + f'/{SPAN}')
        # the bare roster path serves whatever the site calls "now"
        if CURRENT: add(base)
        # c) presto-style /sports/<slug>/<span>/roster
        m2 = re.match(r'^(.*/sports/[^/]+)/(?:20\d\d-\d\d|roster).*$', u)
        if m2:
            add(m2.group(1) + f'/{SPAN}/roster')
            add(m2.group(1) + f'/roster/{S}')
            add(m2.group(1) + f'/roster/season/{S}')
    return out[:8]

def work(r):
    k = state.key(r)
    cnt25 = int(r[CNTCOL] or 0)
    tried = []
    for u in ladder(r['_cand'], r[REFCOL]):
        st_, html = lib.fetch(u, tries=2, timeout=40)
        if st_ != 200 or not html:
            tried.append('%s -> fetch %s' % (u, st_)); continue
        recs, title, parser = lib.parse_any(html)
        ok, why = run.evaluate(recs, title, k, cnt25, u)
        # the ladder guesses URLs, so require the page to positively confirm the season
        if ok and lib.season_ok(title) is not True:
            # In CURRENT mode run.evaluate() has already applied the turnover gate,
            # which is the stronger test; an untitled live page is expected. But a
            # guessed URL with neither a title nor a baseline proves nothing at all.
            if not CURRENT:
                ok, why = False, f'title does not confirm {S} (%r)' % (title or '')[:50]
            elif run.overlap(recs, k) is None:
                ok, why = False, f'untitled page and no {state.REF} baseline to test turnover against'
        if not ok:
            tried.append('%s -> %s' % (u, why)); continue
        rows = run.build(recs, r, u, 'High', f'direct read of the official {S} roster page; ' + why)
        if len(rows) < 5:
            tried.append('%s -> only %d rows' % (u, len(rows))); continue
        return r, k, {'status': 'done', 'stage': 'variants', 'url': u, 'parser': parser,
                      'n': len(rows), 'rows': rows, 'title': title}, tried
    return r, k, None, tried

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--workers', type=int, default=10)
    ap.add_argument('--out', default=f'state_variants_{lib.SEASON}.json')
    ap.add_argument('--reset-wayback', action='store_true')
    a = ap.parse_args()
    run.N25 = state.names25()
    shared = state.load()
    st = json.load(open(a.out, encoding='utf-8')) if os.path.exists(a.out) else {}
    sel = []
    for r in state.attempt_targets():
        k = state.key(r)
        s = shared.get(k, {})
        if s.get('status') == 'done' and not (a.reset_wayback and s.get('stage') == 'wayback'):
            continue
        if st.get(k, {}).get('status') == 'done': continue
        sel.append(r)
    print('variants stage: %d rows' % len(sel)); sys.stdout.flush()
    ok = fail = 0; t0 = time.time()
    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        futs = [ex.submit(work, r) for r in sel]
        for i, f in enumerate(as_completed(futs), 1):
            try: r, k, res, tried = f.result()
            except Exception as e:
                print('  ERR', type(e).__name__, e); continue
            if res: st[k] = res; ok += 1
            else:
                st[k] = {'status': 'failed', 'stage': 'variants',
                         'err': (tried[-1] if tried else 'no candidate'),
                         'tried': ['variants: ' + ('; '.join(tried[-4:]) or 'none')]}
                fail += 1
            if i % 25 == 0:
                json.dump(st, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False)
                print('  %d/%d ok=%d fail=%d %.0fs' % (i, len(sel), ok, fail, time.time()-t0))
                sys.stdout.flush()
    json.dump(st, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False)
    print('variants done: ok=%d fail=%d' % (ok, fail))

if __name__ == '__main__': main()
