# -*- coding: utf-8 -*-
"""Ladder step 2: read the site's own season selector and follow it to 2024.

Guessing URLs fails on sites that number seasons by academic year, use a
non-standard sport slug, or drive the whole roster from JavaScript. Every one
of those sites still ships a season picker, so ask it instead of guessing.
"""
import sys, os, re, json, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, state, run
S = lib.SEASON
SPAN = f'{S}-{(S+1)%100:02d}'
REFCOL = f'Roster URL {state.REF} (known good)'
CNTCOL = f'{state.REF} Player Count'
from playwright.sync_api import sync_playwright

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36')

# a target-season label: "2024", "2024-25", "2024-2025" -- and its opposite.
# Both were hardcoded to 2024, which made LBL_BAD reject the 2026 season itself.
def _span(y): return rf'{y}\s*[-/]\s*(?:{(y+1)%100:02d}|{y+1})'
LBL24 = re.compile(rf'\b{_span(S)}\b|\b{S}\b(?!\s*[-/]\s*\d)')
_OTHER = [y for y in range(S - 4, S + 4) if y != S]
LBL_BAD = re.compile(r'\b(' + '|'.join([_span(y) for y in _OTHER] + [str(y) for y in _OTHER]) + r')\b')

OPTIONS_JS = r"""
() => {
  const out = [];
  document.querySelectorAll('select').forEach(s => {
    const nm = (s.name || s.id || '') + ' ' + (s.className || '');
    [...s.options].forEach(o => out.push({kind:'option', sel:nm,
      value:o.value, label:(o.textContent||'').replace(/\s+/g,' ').trim()}));
  });
  document.querySelectorAll('a').forEach(a => {
    const t = (a.textContent||'').replace(/\s+/g,' ').trim();
    if (t && t.length <= 24 && /20\d\d/.test(t) && /season|roster|year/i.test(a.href + ' ' + (a.className||'')))
      out.push({kind:'link', sel:'a', value:a.href, label:t});
  });
  return out;
}
"""

def roster_root(u):
    u = re.sub(r'^https?://web\.archive\.org/web/\d+(?:id_)?/', '', u or '').rstrip('/')
    u = re.sub(r'(/roster)/[a-z0-9][a-z0-9\-\.]+(?:/\d+)?$', r'\1', u, flags=re.I)
    u = re.sub(r'/roster/(?:season/)?20\d\d(-\d\d)?$', '/roster', u)
    u = re.sub(r'/sports/([^/]+)/20\d\d-\d\d/roster$', r'/sports/\1/roster', u)
    return u

def load(page, url, wait=4000):
    page.goto(url, timeout=25000, wait_until='domcontentloaded')
    try: page.wait_for_selector('select, table tbody tr, li.sidearm-roster-player, '
                                '[class*="person-card"]', timeout=wait, state='attached')
    except Exception: pass
    page.wait_for_timeout(900)

def candidates_from_options(page, root):
    """Turn 2024-labelled selector entries into URLs to try."""
    try: opts = page.evaluate(OPTIONS_JS)
    except Exception: return []
    out = []
    for o in opts:
        lab, val = o.get('label') or '', str(o.get('value') or '')
        if not LBL24.search(lab) or LBL_BAD.search(lab): continue
        if o['kind'] == 'link':
            if val.startswith('http'): out.append(val)
            continue
        if val.startswith('http'): out.append(val); continue
        if val.startswith('/'):
            m = re.match(r'^(https?://[^/]+)', root)
            if m: out.append(m.group(1) + val)
            continue
        v = val.strip()
        if re.fullmatch(r'\d{4}(-\d\d)?', v):
            out.append(root.rstrip('/') + '/' + v)
            out.append(root.rstrip('/') + '/season/' + v)
            m2 = re.match(r'^(.*/sports/[^/]+)/roster$', root)
            if m2 and '-' in v: out.append(m2.group(1) + '/' + v + '/roster')
    seen, res = set(), []
    for u in out:
        for cand in (u, u + ('&' if '?' in u else '?') + 'view=table'):
            if cand not in seen: seen.add(cand); res.append(cand)
    return res[:8]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--keys', default='remaining.txt')
    ap.add_argument('--out', default=f'state_selector_{lib.SEASON}.json')
    ap.add_argument('--redo', action='store_true', help='re-read rows already done')
    a = ap.parse_args()
    run.N25 = state.names25()
    shared = state.load()
    st = json.load(open(a.out, encoding='utf-8')) if os.path.exists(a.out) else {}
    keys = set(x.strip() for x in open(a.keys) if x.strip())
    rows = [r for r in state.targets() if state.key(r) in keys
            and st.get(state.key(r), {}).get('status') != 'done'
            and (a.redo or shared.get(state.key(r), {}).get('status') != 'done')]
    print('selector stage: %d rows' % len(rows)); sys.stdout.flush()
    ok = fail = 0
    with sync_playwright() as pw:
        br = pw.chromium.launch(headless=True, args=['--disable-blink-features=AutomationControlled'])
        ctx = br.new_context(user_agent=UA, viewport={'width': 1400, 'height': 1000},
                             locale='en-US', ignore_https_errors=True)
        ctx.set_default_timeout(25000)
        page = ctx.new_page()
        for i, r in enumerate(rows, 1):
            k = state.key(r)
            cnt25 = int(r[CNTCOL] or 0)
            root = roster_root(r['_cand'] or r[REFCOL])
            tried, got = [], None
            try:
                load(page, root)
                cands = candidates_from_options(page, root)
            except Exception as e:
                cands = []; tried.append('%s -> %s' % (root, type(e).__name__))
            if not cands: tried.append('%s -> no %d entry in the season selector' % (root, S))
            for u in cands:
                try:
                    load(page, u)
                    html = page.content()
                    try:
                        p = os.path.join(lib.CACHE, lib.ckey(page.url) + '.html')
                        if not os.path.exists(p): open(p, 'w', encoding='utf-8').write(html)
                    except Exception: pass
                    recs, title, parser = lib.parse_any(html)
                except Exception as e:
                    tried.append('%s -> %s' % (u, type(e).__name__)); continue
                okk, why = run.evaluate(recs, title, k, cnt25, u)
                if okk and lib.season_ok(title) is not True:
                    okk, why = False, f'title does not confirm {S} (%r)' % (title or '')[:44]
                if not okk: tried.append('%s -> %s' % (u, why)); continue
                rws = run.build(recs, r, u, 'High',
                                f"the {S} season reached through the site's own season selector; " + why)
                if len(rws) < 5: tried.append('%s -> only %d rows' % (u, len(rws))); continue
                got = {'status': 'done', 'stage': 'selector', 'url': u, 'parser': parser,
                       'n': len(rws), 'rows': rws, 'title': title}
                break
            if got:
                st[k] = got; ok += 1
                print('  OK   %-38s n=%-3d %s' % (k[:38], got['n'], got['url'][:66]))
            else:
                st[k] = {'status': 'failed', 'stage': 'selector',
                         'err': tried[-1] if tried else 'no candidate',
                         'tried': ['selector: ' + '; '.join(tried[-3:])]}
                fail += 1
                print('  FAIL %-38s %s' % (k[:38], (tried[-1] if tried else '')[:80]))
            sys.stdout.flush()
            if i % 5 == 0: json.dump(st, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False)
        br.close()
    json.dump(st, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False)
    print('selector done: ok=%d fail=%d' % (ok, fail))

if __name__ == '__main__': main()
