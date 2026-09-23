# -*- coding: utf-8 -*-
"""Browser-driven acquisition for WAF-challenged and client-rendered sites."""
import sys, os, re, json, time, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, state, run
S = lib.SEASON
SPAN = f'{S}-{(S+1)%100:02d}'
REFCOL = f'Roster URL {state.REF} (known good)'
CNTCOL = f'{state.REF} Player Count'
from playwright.sync_api import sync_playwright

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36')

# extra card shape used by the newer Sidearm/WMT platform
EXTRA_JS = r"""
() => {
  const out = [];
  const seen = new Set();
  const push = (n,c,p,h) => {
    n=(n||'').replace(/\s+/g,' ').trim();
    if(!n||n.length>60||seen.has(n.toLowerCase()))return;
    seen.add(n.toLowerCase());
    out.push({name:n,cls:(c||'').trim(),pos:(p||'').trim(),home:(h||'').trim()});
  };
  const txt = e => e ? e.textContent.replace(/\s+/g,' ').trim() : '';
  // 1) definition-style person cards
  document.querySelectorAll('[class*="person-card"],[class*="roster-card"],[class*="player-card"],li[class*="roster"],div[class*="roster__player"]').forEach(c=>{
    let a=c.querySelector('a[href*="/roster/"]')||c.querySelector('h1,h2,h3,h4,h5');
    if(!a)return;
    let name=txt(a).replace(/^#?\d+\s*/,'');
    if(/^full bio$/i.test(name))return;
    const grab=(...keys)=>{
      for(const k of keys){
        const el=[...c.querySelectorAll('dt,span,div,p,li')].find(x=>new RegExp('^'+k+'\\s*:?$','i').test(txt(x)));
        if(el){const v=el.nextElementSibling; if(v)return txt(v);}
      }
      return '';
    };
    push(name, grab('class','cl','year','yr','academic year'), grab('position','pos'),
         grab('hometown','hometown/high school','hometown / high school'));
  });
  return out;
}
"""

def extract(page):
    """Return (records, title, parser) from a rendered page."""
    html = page.content()
    # persist the rendered DOM so a later re-parse can reuse it without a browser
    try:
        p = os.path.join(lib.CACHE, lib.ckey(page.url) + '.html')
        if not os.path.exists(p): open(p, 'w', encoding='utf-8').write(html)
    except Exception:
        pass
    recs, title, par = lib.parse_any(html)
    if recs and len(recs) >= 5: return recs, title, par
    try:
        alt = page.evaluate(EXTRA_JS)
    except Exception:
        alt = None
    if alt and len(alt) >= 5:
        t = title or (page.title() or '')
        return alt, t, 'dom-card'
    return recs, title, par

def load(page, url, wait_ms=9000):
    page.goto(url, timeout=30000, wait_until='domcontentloaded')
    sel = ('table tbody tr, li.sidearm-roster-player, [class*="person-card"], '
           '[class*="roster-card"], [class*="player-card"], a[href*="/roster/"]')
    try: page.wait_for_selector(sel, timeout=wait_ms, state='attached')
    except Exception: pass
    # the roster arrives from a client-side fetch after first paint
    for _ in range(12):
        n = page.evaluate("() => document.querySelectorAll('table tbody tr, "
                          "li.sidearm-roster-player, [class*=\"person-card\"]').length")
        if n >= 5: break
        page.wait_for_timeout(600)
    page.wait_for_timeout(500)

def season_urls(base):
    """2024-season URL variants, table view first because it parses cleanly.

    Season slugs follow two conventions - calendar year (2024 == fall 2024) and
    academic year end (2025 == 2024-25) - so try both and let the title decide.
    """
    m = re.search(r'^(.*/sports/[^/]+)/', base)
    stem = m.group(1) if m else None
    def tv(u): return u + ('&' if '?' in u else '?') + 'view=table'
    v = []
    if stem:
        for tail in (f'/roster/season/{S}', f'/roster/{S}', f'/roster/season/{S+1}',
                     f'/{SPAN}/roster'):
            v.append(tv(stem + tail))
        for tail in (f'/roster/season/{S}', f'/roster/{S}'):
            v.append(stem + tail)
    v += [tv(base), base]
    seen, out = set(), []
    for u in v:
        if u and u not in seen: seen.add(u); out.append(u)
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--keys', default='')          # explicit keys file
    ap.add_argument('--only-failed', action='store_true')
    ap.add_argument('--method', default='')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--variants', type=int, default=5)
    ap.add_argument('--out', default=f'state_browser_{lib.SEASON}.json')
    ap.add_argument('--strict-season', action='store_true')
    ap.add_argument('--redo', action='store_true')
    a = ap.parse_args()
    run.N25 = state.names25()
    rows = state.targets()
    shared = state.load()
    st = json.load(open(a.out,encoding='utf-8')) if os.path.exists(a.out) else {}
    sel = []
    # AN EMPTY KEY FILE MEANS NOTHING, NOT EVERYTHING.
    #
    # `keyset` used to be a plain set and the filter read `if keyset and ...`,
    # so an empty file was falsy and disabled scoping entirely. The runner
    # shards the remaining keys four ways, so any run with fewer than four
    # targets hands two or three shards an empty file -- and L7D watched two
    # browser shards walk the whole universe on a six-programme run. None was
    # absorbed and no sheet moved, because the run was stopped, but the scope
    # had already been lost. `None` is "no restriction"; a set is a restriction,
    # including when it is empty.
    keyset = None
    if a.keys and os.path.exists(a.keys):
        keyset = set(x.strip() for x in open(a.keys) if x.strip())
    for r in rows:
        k = state.key(r)
        if (not a.redo and shared.get(k, {}).get('status') == 'done') or st.get(k, {}).get('status') == 'done': continue
        if keyset is not None and k not in keyset: continue
        if a.method and not r['Method'].startswith(a.method): continue
        if a.only_failed and shared.get(k, {}).get('status') != 'failed': continue
        sel.append(r)
    if a.limit: sel = sel[:a.limit]
    print('browser stage: %d rows' % len(sel)); sys.stdout.flush()
    ok = fail = 0
    with sync_playwright() as pw:
        br = pw.chromium.launch(headless=True, args=['--disable-blink-features=AutomationControlled'])
        ctx = br.new_context(user_agent=UA, viewport={'width': 1400, 'height': 1000},
                             locale='en-US', ignore_https_errors=True)
        ctx.set_default_timeout(22000)
        page = ctx.new_page()
        for i, r in enumerate(sel, 1):
            k = state.key(r)
            base = r['_cand'] or r[REFCOL]
            base = re.sub(r'^https?://web\.archive\.org/web/\d+(?:id_)?/', '', base)
            got, note = None, ''
            tried = []
            for u in season_urls(base)[:max(1, a.variants)]:
                try:
                    load(page, u)
                    recs, title, par = extract(page)
                except Exception as e:
                    tried.append('%s -> %s' % (u, type(e).__name__)); continue
                cnt25 = int(r[CNTCOL] or 0)
                okk, why = run.evaluate(recs, title, k, cnt25, u)
                if okk and a.strict_season and lib.season_ok(title) is not True:
                    # the live page for the current season usually names no year;
                    # run.evaluate() has already required the squad to have turned over
                    if not run.CURRENT:
                        okk, why = False, f'title does not confirm the {S} season (%r)' % (title or '')[:60]
                    elif run.overlap(recs, k) is None:
                        okk, why = False, f'untitled page and no {state.REF} baseline to test turnover'
                if not okk:
                    tried.append('%s -> %s' % (u, why)); continue
                rws = run.build(recs, r, u, 'High',
                                f'browser-rendered read of the official {S} roster; ' + why,
                                parser=par, title=title)
                if len(rws) < 5:
                    tried.append('%s -> only %d rows' % (u, len(rws))); continue
                got = {'status': 'done', 'stage': 'browser', 'url': u, 'parser': par,
                       'n': len(rws), 'rows': rws, 'title': title}
                break
            if got:
                st[k] = got; ok += 1
                print('  OK   %-38s n=%-3d %s' % (k[:38], got['n'], got['url']))
            else:
                prev = shared.get(k, {})
                st[k] = {'status': 'failed', 'stage': 'browser',
                         'err': tried[-1] if tried else 'no variant worked',
                         'tried': prev.get('tried', []) + ['browser: ' + ('; '.join(tried[-3:]) or 'none')]}
                fail += 1
                print('  FAIL %-38s %s' % (k[:38], (tried[-1] if tried else '')[:90]))
            sys.stdout.flush()
            if i % 5 == 0: json.dump(st, open(a.out,'w',encoding='utf-8'), ensure_ascii=False)
        br.close()
    json.dump(st, open(a.out,'w',encoding='utf-8'), ensure_ascii=False)
    print('browser stage done: ok=%d fail=%d' % (ok, fail))

if __name__ == '__main__': main()
