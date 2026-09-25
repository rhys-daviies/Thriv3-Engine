# -*- coding: utf-8 -*-
"""Wayback fallback for the residue. Serialised with real backoff: the CDX API
rate-limits hard and returns an empty body (not an error) when it throttles,
which is indistinguishable from "no snapshot" unless you slow down."""
import sys, os, re, json, time, argparse, random
import requests
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, state, run
S = lib.SEASON
SPAN = f'{S}-{(S+1)%100:02d}'
REFCOL = f'Roster URL {state.REF} (known good)'
CNTCOL = f'{state.REF} Player Count'

S = requests.Session()
S.headers.update({'User-Agent': lib.UAS[0], 'Accept': 'application/json,*/*'})

class Down(Exception): pass

def cdx(url, frm=None, to=None, tries=5):
    frm = frm or f'{S}0801'; to = to or f'{S+1}0228'
    q = ('https://web.archive.org/cdx/search/cdx?url=' + requests.utils.quote(url, safe='')
         + f'&from={frm}&to={to}&output=json&fl=timestamp,statuscode'
         + '&filter=statuscode:200&collapse=timestamp:6&limit=60')
    for i in range(tries):
        try:
            r = S.get(q, timeout=70)
            body = r.text.strip()
            if r.status_code == 200:
                if not body: return []                      # genuinely no snapshot
                if body.startswith('['):
                    return [x[0] for x in json.loads(body)[1:]]
                raise Down('non-json body')                 # "Temporarily Offline" page
            if r.status_code in (429, 503, 502, 504): raise Down('http %s' % r.status_code)
            return []
        except Down:
            if i == tries - 1: raise
            time.sleep(min(60, 8 * (2 ** i)) + random.random() * 3)
        except Exception:
            if i == tries - 1: return []
            time.sleep(5 * (i + 1))
    return []

def targets_for(r):
    """Archived URL forms worth asking CDX about, most specific first."""
    out = []
    def add(u):
        u = re.sub(r'^https?://web\.archive\.org/web/\d+(?:id_)?/', '', u or '').rstrip('/')
        if u and u not in out: out.append(u)
    for src in (r['_cand'], r[REFCOL]):
        if not src: continue
        u = re.sub(r'^https?://web\.archive\.org/web/\d+(?:id_)?/', '', src).rstrip('/')
        add(u)
        # normalise any season in the path to the 2024 season
        add(re.sub(r'/20\d\d-\d\d(?=/|$)', f'/{SPAN}', u))
        add(re.sub(r'/20\d\d(?=/|$)', f'/{S}', u))
        # the year-less form: a late-2024 snapshot of it *is* the 2024 roster
        add(re.sub(r'/(?:season/)?20\d\d(-\d\d)?(?=/|$)', '', u))
        # only append a season to a clean path - never to a query string
        if '?' not in u and not re.search(r'/20\d\d(-\d\d)?$', u):
            add(u + f'/{S}')
    return [u for u in out if u][:6]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--keys', default='remaining.txt')
    ap.add_argument('--out', default=f'state_wayback2_{lib.SEASON}.json')
    ap.add_argument('--sleep', type=float, default=1.5)
    a = ap.parse_args()
    run.N25 = state.names25()
    shared = state.load()
    st = json.load(open(a.out, encoding='utf-8')) if os.path.exists(a.out) else {}
    keys = set(x.strip() for x in open(a.keys) if x.strip()) if os.path.exists(a.keys) else None
    rows = [r for r in state.targets()
            if (keys is None or state.key(r) in keys)
            and shared.get(state.key(r), {}).get('status') != 'done'
            and st.get(state.key(r), {}).get('status') != 'done']
    print('wayback2: %d rows' % len(rows)); sys.stdout.flush()
    ok = fail = 0
    for i, r in enumerate(rows, 1):
        k = state.key(r)
        cnt25 = int(r[CNTCOL] or 0)
        tried, got = [], None
        for u in targets_for(r):
            try:
                ts = cdx(u)
            except Down as e:
                print('  ARCHIVE UNAVAILABLE (%s) - stopping so it can be retried later' % e)
                json.dump(st, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False)
                return
            time.sleep(a.sleep)
            if not ts:
                tried.append('%s -> no snapshot in the 2024 window' % u); continue
            ts.sort(key=lambda t: abs(int(t[:8]) - 20241015))
            for t in ts[:5]:
                wu = lib.wb_url(t, u)
                s_, html = lib.fetch(wu, tries=2, timeout=70)
                if s_ != 200 or not html:
                    tried.append('%s -> fetch %s' % (t, s_)); continue
                recs, title, parser = lib.parse_any(html)
                okk, why = run.evaluate(recs, title, k, cnt25, wu)
                if okk and lib.season_ok(title) is False: okk, why = False, f'snapshot is not the {S} season'
                if not okk:
                    tried.append('%s -> %s' % (t, why)); continue
                rws = run.build(recs, r, wu, 'Medium',
                                'Wayback snapshot %s of %s (site no longer serves 2024); %s' % (t, u, why))
                if len(rws) < 5:
                    tried.append('%s -> only %d rows' % (t, len(rws))); continue
                got = {'status': 'done', 'stage': 'wayback', 'url': wu, 'parser': parser,
                       'n': len(rws), 'rows': rws, 'title': title}
                break
            if got: break
        if got:
            st[k] = got; ok += 1
            print('  OK   %-40s n=%-3d %s' % (k[:40], got['n'], got['url'][:70]))
        else:
            st[k] = {'status': 'failed', 'stage': 'wayback',
                     'err': tried[-1] if tried else 'no archived URL form',
                     'tried': ['wayback: ' + ('; '.join(tried[-4:]) or 'none')]}
            fail += 1
            print('  FAIL %-40s %s' % (k[:40], (tried[-1] if tried else '')[:70]))
        sys.stdout.flush()
        if i % 5 == 0: json.dump(st, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False)
    json.dump(st, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False)
    print('wayback2 done: ok=%d fail=%d' % (ok, fail))

if __name__ == '__main__': main()
