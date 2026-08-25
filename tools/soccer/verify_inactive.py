"""Re-verify the 24 schools removed as "inactive" by the Aug-20 audit.

That audit's evidence was an ABSENCE — "absent from the NCAA men's-soccer team list" — which
is the weakest signal available: it fails whenever the registry spells a school differently,
and it failed at least twice (Concordia Irvine played 8-7-1, Emmanuel (GA) 7-8-3). The likely
mechanism is a stale division field sending the check at the wrong association's registry.

This looks for POSITIVE evidence instead: does the school's own athletics site serve a 2025
men's soccer season? A page that names the school AND shows a season record or a roster is
proof of activity that no spelling mismatch can fake.

TWO THINGS THIS DELIBERATELY DOES NOT DO:

It does not trust the host list. known_domains.json carries misattributed hosts for several
of these — godeacs.com (Wake Forest) filed under Wells, gojacks.com (South Dakota State)
under Dakota State, lindenwoodlions.com under Cardinal Stritch. So every fetched page must
NAME THE SCHOOL in its title before its content counts for anything.

And it does not treat silence as proof of closure. A dead host, a 404 or an unnamed page
means "no evidence found", never "confirmed inactive" — which is the exact error being
investigated. Only a positive hit is a verdict here.
"""
import json, re, sys, time, collections
import concurrent.futures as cf
import requests

BASE = "/Users/rhysdavies/Documents/Recruitmatch/individualisation"
HDR = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
       "Accept-Language": "en-US,en;q=0.9"}
STOP = {"the", "of", "at", "and", "university", "college", "state", "institute", "school"}


def words(n):
    n = re.sub(r"\([^)]*\)", " ", str(n))
    return [w for w in re.sub(r"[^a-z0-9 ]", " ", n.lower()).split() if len(w) > 2]


def distinctive(name):
    ws = [w for w in words(name) if w not in STOP]
    return ws or words(name)


def names_school(text, school):
    """Every distinctive word of the school name must appear."""
    if not text:
        return False
    t = text.lower()
    return all(w in t for w in distinctive(school))


def candidates(school, known):
    """Hosts to try: the ones on file, then conventional constructions."""
    out = list(known)
    base = re.sub(r"\([^)]*\)", "", school).strip().lower()
    slug = re.sub(r"[^a-z0-9]", "", base)
    short = re.sub(r"[^a-z0-9]", "", base.split()[0]) if base.split() else ""
    for s in (slug, short):
        if len(s) >= 4:
            out += [f"{s}athletics.com", f"go{s}.com", f"{s}sports.com"]
    seen, uniq = set(), []
    for h in out:
        h = h.replace("https://", "").replace("http://", "").split("/")[0]
        if h and h not in seen:
            seen.add(h); uniq.append(h)
    return uniq[:6]


PATHS = ["/sports/mens-soccer/schedule/2025", "/sports/mens-soccer/roster/2025",
         "/sports/msoc/2025-26/schedule", "/sports/mens-soccer/schedule"]
REC = re.compile(r"(?i)(?:season record|overall)\D{0,22}(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})")


def probe(school, hosts):
    tried = []
    for h in hosts:
        for p in PATHS:
            url = f"https://{h}{p}"
            try:
                r = requests.get(url, headers=HDR, timeout=18, allow_redirects=True)
            except Exception as e:
                tried.append(f"{h}{p}: {type(e).__name__}")
                break                       # host itself is dead; skip its other paths
            if r.status_code != 200 or len(r.text) < 8000:
                tried.append(f"{h}{p}: {r.status_code}/{len(r.text)}")
                continue
            title = (re.search(r"(?is)<title[^>]*>(.*?)</title>", r.text) or [None, ""])[1]
            title = re.sub(r"\s+", " ", title).strip()
            if not names_school(title, school):
                tried.append(f"{h}{p}: title does not name school ({title[:40]!r})")
                continue
            txt = re.sub(r"\s+", " ", re.sub(r"(?s)<[^>]+>", " ", r.text))
            m = REC.search(txt)
            # a roster page with player rows also proves a season exists
            roster_hits = len(re.findall(r"(?i)\b(?:Fr\.|So\.|Jr\.|Sr\.|Freshman|Sophomore|Junior|Senior)\b", txt))
            if m:
                return {"verdict": "ACTIVE", "how": "season record on its own site",
                        "detail": m.group(0), "url": r.url, "title": title, "tried": tried}
            if "2025" in title and roster_hits >= 8:
                return {"verdict": "ACTIVE", "how": "2025 roster on its own site",
                        "detail": f"{roster_hits} class-year markers", "url": r.url,
                        "title": title, "tried": tried}
            tried.append(f"{h}{p}: named school but no record/roster signal")
    return {"verdict": "no evidence found", "how": None, "detail": None,
            "url": None, "title": None, "tried": tried}


def main():
    audit = json.load(open("/Users/rhysdavies/Documents/Thriv3/Soccer Records/removed_inactive_2025.json"))
    known = json.load(open(f"{BASE}/known_domains.json"))
    kn = {}
    for k, v in known.items():
        kn[" ".join(sorted(words(k)))] = [x for x in v if not x.endswith(".edu")]
    jobs = []
    for e in audit:
        key = " ".join(sorted(words(e["name"])))
        jobs.append((e, candidates(e["name"], kn.get(key, []))))

    print(f"probing {len(jobs)} schools\n", flush=True)
    out = []
    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        for e, res in zip([j[0] for j in jobs],
                          ex.map(lambda j: probe(j[0]["name"], j[1]), jobs)):
            out.append({**{k: e[k] for k in ("name", "division", "conference")}, **res})
            mark = "ACTIVE " if res["verdict"] == "ACTIVE" else "       "
            print(f"{mark} {e['name'][:28]:28} {e['division']:5} "
                  f"{res['how'] or 'no evidence'} {res['detail'] or ''}", flush=True)
    json.dump(out, open(f"{BASE}/inactive_reverify.json", "w"), indent=1)
    t = collections.Counter(o["verdict"] for o in out)
    print(f"\n{dict(t)}")


if __name__ == "__main__":
    main()
