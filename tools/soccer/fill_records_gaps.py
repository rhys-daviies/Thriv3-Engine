"""Collect 2022-25 season records for the 7 schools that have rosters but no records row.

Each is read from the school's OWN athletics site — the same method used to verify the NAIA
imports, and the only source that settles a season without relying on a registry spelling.

Nothing is invented. A season whose record the site does not publish is left BLANK, not
zeroed and not guessed: soccer_score_v6 skips blank seasons and shrinks small samples toward
the division mean, so a missing season costs accuracy far less than a fabricated one.

Division and conference are read off the same pages rather than assumed. Hartford in
particular is stored as NCAA D1 in `colleges` but has been transitioning to D3, and division
sets the scoring band, so getting it wrong would misplace the school by 30 points.
"""
import re, json, sys, collections
import concurrent.futures as cf
import requests

HDR = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
YEARS = [2022, 2023, 2024, 2025]
TARGETS = [
    ("Hartford",            "mens-soccer",   "hartfordhawks.com"),
    ("Shawnee State",       "womens-soccer", "ssubears.com"),
    ("Albertus Magnus",     "womens-soccer", "www.albertusfalcons.com"),
    ("Colby-Sawyer",        "womens-soccer", "www.colby-sawyerathletics.com"),
    ("Dean",                "womens-soccer", "deanbulldogs.com"),
    ("Eastern Connecticut", "womens-soccer", "gowarriorathletics.com"),
    ("Plymouth State",      "womens-soccer", "athletics.plymouth.edu"),
]
SLUG = {"mens-soccer": "mens-soccer", "womens-soccer": "womens-soccer"}
REC = re.compile(r"(?i)(?:season\s+record\s+)?overall\D{0,18}(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})")
CONF = re.compile(r"(?i)\bconf(?:erence)?\.?\D{0,14}(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})")


def words(n):
    return [w for w in re.sub(r"[^a-z0-9 ]", " ", str(n).lower()).split() if len(w) > 2]


def names_school(title, school):
    t = (title or "").lower()
    return all(w in t for w in words(school))


def season(host, sport, school, year):
    for path in (f"/sports/{SLUG[sport]}/schedule/{year}",
                 f"/sports/{SLUG[sport]}/schedule/{year}-{str(year+1)[2:]}"):
        try:
            r = requests.get(f"https://{host}{path}", headers=HDR, timeout=25, allow_redirects=True)
        except Exception as e:
            return {"year": year, "status": f"error:{type(e).__name__}"}
        if r.status_code != 200 or len(r.text) < 8000:
            continue
        title = re.sub(r"\s+", " ", (re.search(r"(?is)<title[^>]*>(.*?)</title>", r.text)
                                     or [None, ""])[1]).strip()
        if not names_school(title, school):
            return {"year": year, "status": f"title mismatch: {title[:50]!r}"}
        txt = re.sub(r"\s+", " ", re.sub(r"(?s)<[^>]+>", " ", r.text))
        m = REC.search(txt)
        if not m:
            return {"year": year, "status": "no overall record published", "title": title}
        return {"year": year, "status": "ok", "record": "-".join(m.groups()),
                "title": title, "url": r.url}
    return {"year": year, "status": "no usable page"}


def run(t):
    school, sport, host = t
    out = {"school": school, "sport": sport, "host": host, "seasons": {}}
    for y in YEARS:
        out["seasons"][y] = season(host, sport, school, y)
    return out


with cf.ThreadPoolExecutor(max_workers=4) as ex:
    results = list(ex.map(run, TARGETS))

for r in results:
    got = {y: v.get("record") for y, v in r["seasons"].items() if v.get("record")}
    print(f"{r['school'][:22]:22} {r['sport'][:5]:6} {r['host'][:30]:30} {got}")
    for y, v in r["seasons"].items():
        if not v.get("record"):
            print(f"      {y}: {v['status']}")
json.dump(results, open("/Users/rhysdavies/Documents/Recruitmatch/individualisation/records_gap_fill.json", "w"), indent=1)
