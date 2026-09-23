# -*- coding: utf-8 -*-
"""Three schools whose roster widget exposes no structured markup, only player
bio links. The href tells players and staff apart: staff sit under
/roster/coaches/ or /roster/staff/, players directly under /roster/<slug>/<id>.
Names only - but honest names, with the staff block excluded."""
import sys, os, re, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, state, run
from playwright.sync_api import sync_playwright
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36')

TARGETS = {
 'Bradley||mens-soccer':      'https://bradleybraves.com/sports/mens-soccer/roster/2024',
 'George Mason||mens-soccer': 'https://gomason.com/sports/mens-soccer/roster/2024',
}

JS = r"""
() => {
  const seen = new Map();
  document.querySelectorAll('a[href*="/roster/"]').forEach(a => {
    const t = (a.textContent || '').replace(/\s+/g, ' ').trim();
    const h = a.getAttribute('href') || '';
    if (!t || t.length > 40 || !/^[A-Z]/.test(t)) return;
    if (/full bio|print|roster|schedule|stats/i.test(t)) return;
    if (/\/roster\/(coaches|staff|support)\//i.test(h)) return;   // staff block
    if (!/\/roster\/[a-z0-9][a-z0-9\-\.]*\/\d+/i.test(h)) return; // player bio
    if (!seen.has(h)) seen.set(h, t);
  });
  return [...seen.values()];
}
"""

def main():
    run.N25 = state.names25()
    st = state.load()
    tg = {state.key(r): r for r in state.targets()}
    out = {}
    with sync_playwright() as pw:
        br = pw.chromium.launch(headless=True)
        pg = br.new_context(user_agent=UA, viewport={'width':1500,'height':1400}).new_page()
        for k, u in TARGETS.items():
            r = tg[k]
            old = len(st.get(k, {}).get('rows', []))
            try:
                pg.goto(u, timeout=45000, wait_until='domcontentloaded'); pg.wait_for_timeout(7000)
                for _ in range(5): pg.mouse.wheel(0, 1200); pg.wait_for_timeout(700)
                pg.wait_for_timeout(2500)
                names = pg.evaluate(JS)
                title = pg.title()
            except Exception as e:
                print(f"  {k[:34]:34} ERR {type(e).__name__}"); continue
            if lib.season_ok(title) is not True:
                print(f"  {k[:34]:34} title does not confirm 2024: {title[:40]!r}"); continue
            names = [n for n in names if not lib.name_is_staff(n)]
            if len(names) < 12:
                print(f"  {k[:34]:34} only {len(names)} player bio links - not a usable roster")
                out[k] = {'status': 'failed', 'stage': 'biolinks',
                          'err': ('the 2024 roster widget renders no player entries; only %d player '
                                  'bio links present (staff only)' % len(names)),
                          'tried': ['biolinks: %s -> %d player links' % (u, len(names))]}
                continue
            recs = [{'name': n, 'cls': '', 'pos': '', 'home': ''} for n in names]
            rows = run.build(recs, r, u, 'Low',
                             'names only: the 2024 roster widget exposes player bio links but no '
                             'class/position/hometown markup; coaches and staff excluded by bio-link path')
            out[k] = {'status': 'done', 'stage': 'biolinks', 'url': u, 'parser': 'bio-links',
                      'n': len(rows), 'rows': rows, 'title': title}
            print(f"  {k[:34]:34} {old:3} -> {len(rows):3} players (staff excluded)")
        br.close()
    json.dump(out, open('state_biolinks2.json','w'), ensure_ascii=False)

if __name__ == '__main__': main()
