"""Resolve the 11 schools where neither the audit nor earlier checks found evidence.

The question is not "what was their 2025 record" — those sites render schedules in JS, which
is why record-hunting stalled. The question is narrower and structural: DOES THIS SCHOOL
FIELD MEN'S SOCCER AT ALL? A school's athletics site advertises its sports in navigation and
serves a section per sport, and both are server-rendered even when the schedule inside is not.

So each site is asked three things:
  1. does the sport navigation link to a men's soccer section?
  2. does a men's soccer roster/schedule page exist (200, and titled for this school)?
  3. does the WOMEN'S equivalent exist? — the control. A site where women's soccer resolves
     and men's 404s is evidence of absence; a site where NEITHER resolves proves only that
     the URL pattern is wrong, and must not be read as absence.

That control is the whole point. The audit being re-checked concluded "inactive" from a
failed lookup, and repeating that mistake with a different lookup would be worthless.
"""
import re, json, sys, collections
import concurrent.futures as cf
import requests

HDR = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"}

TARGETS = {
    "Inter American (PR)":    ["deportes.inter.edu"],
    "Cascade":                ["cascadeconference.org"],
    "Lewis-Clark State":      ["lcwarriors.com"],
    "Montana State Northern": ["msunlights.com", "gomsunlights.com"],
    "Montana Western":        ["umwbulldogs.com"],
    "Multnomah":              ["gomulions.com", "multnomahlions.com"],
    "Peru State":             ["pscbobcats.com"],
    "Trinity International":  ["tiutrojans.com"],
    "Kentucky State":         ["ksuthorobreds.com"],
    "Langston":               ["langstonsports.com", "golangston.com"],
    "Valley City State":      ["vcsuvikings.com", "govcsu.com"],
}
MEN = ["/sports/mens-soccer/roster", "/sports/msoc/roster", "/sports/mens-soccer"]
WOMEN = ["/sports/womens-soccer/roster", "/sports/wsoc/roster", "/sports/womens-soccer"]


def get(url):
    try:
        r = requests.get(url, headers=HDR, timeout=20, allow_redirects=True)
    except Exception as e:
        return None, f"err:{type(e).__name__}"
    return r, f"{r.status_code}/{len(r.text)}"


def title_of(r):
    return re.sub(r"\s+", " ", (re.search(r"(?is)<title[^>]*>(.*?)</title>", r.text)
                                or [None, ""])[1]).strip()


def section_ok(host, paths, school):
    """Does a sport section exist AND belong to this school?"""
    for p in paths:
        r, note = get(f"https://{host}{p}")
        if r is None or r.status_code != 200 or len(r.text) < 6000:
            continue
        t = title_of(r).lower()
        toks = [w for w in re.sub(r"[^a-z0-9 ]", " ", school.lower()).split() if len(w) > 2]
        if toks and not all(w in t for w in toks):
            continue                       # someone else's page
        return True, p, title_of(r)
    return False, None, None


def nav_links(host):
    r, _ = get(f"https://{host}")
    if r is None or r.status_code != 200:
        return None
    hrefs = set(re.findall(r'href="([^"]+)"', r.text))
    m = any(re.search(r"(mens?[-_]soccer|/msoc)", h, re.I) for h in hrefs)
    w = any(re.search(r"(womens?[-_]soccer|/wsoc)", h, re.I) for h in hrefs)
    return {"mens_link": m, "womens_link": w, "n_links": len(hrefs)}


def run(item):
    school, hosts = item
    out = {"school": school, "hosts": hosts}
    for host in hosts:
        nav = nav_links(host)
        if nav is None:
            out.setdefault("dead", []).append(host)
            continue
        mo, mp, mt = section_ok(host, MEN, school)
        wo, wp, wt = section_ok(host, WOMEN, school)
        out.update({"host_used": host, "nav": nav, "mens_section": mo, "mens_path": mp,
                    "mens_title": mt, "womens_section": wo, "womens_path": wp})
        break
    return out


with cf.ThreadPoolExecutor(max_workers=4) as ex:
    res = list(ex.map(run, TARGETS.items()))

print(f"{'school':24} {'host':26} {'nav M/W':9} {'men sect':9} {'women sect':10} verdict")
tally = collections.Counter()
for r in res:
    if "host_used" not in r:
        v = "unreachable — no verdict"
    else:
        nav = r["nav"]
        if r["mens_section"]:
            v = "HAS MEN'S SOCCER"
        elif r["womens_section"] or nav["womens_link"]:
            v = "no men's section (women's resolves) — supports removal"
        else:
            v = "neither resolves — URL pattern wrong, NO verdict"
    tally[v] += 1
    r["verdict"] = v
    print(f"  {r['school'][:22]:22} {r.get('host_used','-')[:24]:26} "
          f"{str(r.get('nav',{}).get('mens_link'))[0] if r.get('nav') else '-'}/"
          f"{str(r.get('nav',{}).get('womens_link'))[0] if r.get('nav') else '-':7} "
          f"{str(r.get('mens_section')):9} {str(r.get('womens_section')):10} {v}")
json.dump(res, open("/Users/rhysdavies/Documents/Recruitmatch/individualisation/unknown11.json", "w"), indent=1)
print()
for k, v in tally.most_common():
    print(f"  {v:3}  {k}")
