"""Verify the newly-imported NAIA men's records against each school's own athletics site.

107 NAIA men's programmes arrived in soccer_records.csv from a concurrent import during this
session, closing a real gap (85 -> 185 rows with records). They have not been verified by
this work -- and one of them, Southwestern (KS), was WRONG in a way that mattered: the row
said 9-3-2 for 2022 and 3-13-3 for 2024 where buildersports.com publishes 5-7-5 and 6-9-2.
That is reason enough to check the rest rather than assume.

METHOD. Each school's athletics host comes from the NAIA coaching-contact CSV, whose
source_url is already per-sport. The season schedule page carries a server-rendered
"Overall W-L-T" line; that is compared cell-for-cell with the records file.

Athletics sites are JS-rendered, so only what the server sends is usable -- roughly half of
season pages expose the overall record in HTML, and the rest yield nothing. A season this
cannot read is reported as `no_data`, never as agreement. Silence is not confirmation.
"""
import csv, json, re, sys, collections, concurrent.futures as cf
import requests

RECORDS = "/Users/rhysdavies/Documents/Thriv3/Soccer Records/soccer_records.csv"
CD = "/Users/rhysdavies/Documents/Thriv3/2025 Coaches Emails/naia_mens_soccer_coaching_contacts.csv"
BASE = "/Users/rhysdavies/Documents/Recruitmatch/individualisation"
YEARS = [2022, 2023, 2024, 2025]
HDR = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
       "Accept-Language": "en-US,en;q=0.9"}
OVERALL = re.compile(r"(?i)\boverall\b\D{0,16}(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})")


def norm(n):
    n = re.sub(r"\(([^)]*)\)", r" \1 ", str(n))
    n = re.sub(r"\bst\b\.?", "saint", n, flags=re.I)
    return frozenset(t for t in re.sub(r"[^a-z0-9 ]", " ", n.lower()).split()
                     if t not in ("the", "of", "at", "and"))


def hosts_from_coaches():
    out = {}
    for r in csv.DictReader(open(CD, newline="", encoding="utf-8")):
        u = (r.get("source_url") or "").strip()
        m = re.match(r"https?://([^/]+)", u)
        if m and r["school_name"] not in out:
            h = m.group(1).lower()
            if "web.archive.org" in h:
                continue
            out[r["school_name"]] = h
    return out


def match_host(name, hosts):
    """Resolve our school name onto a coach-file host, forward-subset then reverse."""
    want = norm(name)
    if not want:
        return None
    for direction in ("fwd", "rev"):
        cands = []
        for k, h in hosts.items():
            have = norm(k)
            if direction == "fwd" and want <= have:
                cands.append((len(have - want), h))
            elif direction == "rev" and have <= want:
                cands.append((len(want - have), h))
        if not cands:
            continue
        cands.sort(key=lambda x: x[0])
        if len(cands) > 1 and cands[0][0] == cands[1][0]:
            return None                      # ambiguous: no verdict rather than a wrong one
        return cands[0][1]
    return None


def season(host, year):
    for path in (f"/sports/mens-soccer/schedule/{year}",
                 f"/sports/msoc/{year}-{str(year + 1)[2:]}/schedule"):
        try:
            r = requests.get(f"https://{host}{path}", headers=HDR, timeout=25,
                             allow_redirects=True)
        except Exception:
            continue
        if r.status_code != 200 or len(r.text) < 15000:
            continue
        txt = re.sub(r"\s+", " ", re.sub(r"(?s)<[^>]+>", " ", r.text))
        m = OVERALL.search(txt)
        if m:
            return tuple(int(x) for x in m.groups())
        return "no_record_on_page"
    return None


def check(row, host):
    out = {"name": row["name"], "host": host, "seasons": {}}
    for y in YEARS:
        ours = tuple(row.get(f"{y}_{c}") or "" for c in ("W", "L", "D"))
        if not all(ours):
            out["seasons"][y] = {"verdict": "we_have_none"}
            continue
        got = season(host, y)
        if got is None or got == "no_record_on_page":
            out["seasons"][y] = {"verdict": "no_data", "ours": "-".join(ours)}
            continue
        theirs = "-".join(str(x) for x in got)
        out["seasons"][y] = {"verdict": "agree" if theirs == "-".join(ours) else "DISAGREE",
                             "ours": "-".join(ours), "site": theirs}
    return out


def main():
    rows = [r for r in csv.DictReader(open(RECORDS, newline="", encoding="utf-8"))
            if r["division"] == "NAIA" and r["school_id"].startswith("naia_")]
    hosts = hosts_from_coaches()
    jobs = []
    nohost = []
    for r in rows:
        h = match_host(r["name"], hosts)
        (jobs.append((r, h)) if h else nohost.append(r["name"]))
    print(f"{len(rows)} newly-imported NAIA rows; {len(jobs)} matched to a host, "
          f"{len(nohost)} without one\n", flush=True)

    results = []
    with cf.ThreadPoolExecutor(max_workers=10) as ex:
        for res in ex.map(lambda a: check(*a), jobs):
            results.append(res)
            bad = [f"{y}: ours {v['ours']} vs site {v['site']}"
                   for y, v in res["seasons"].items() if v["verdict"] == "DISAGREE"]
            ok = sum(1 for v in res["seasons"].values() if v["verdict"] == "agree")
            if bad:
                print(f"DISAGREE {res['name'][:34]:34} {res['host'][:26]:26} {'; '.join(bad)}", flush=True)
            elif ok:
                print(f"ok       {res['name'][:34]:34} {res['host'][:26]:26} {ok}/4 seasons confirmed", flush=True)

    tally = collections.Counter()
    for r in results:
        for v in r["seasons"].values():
            tally[v["verdict"]] += 1
    json.dump({"results": results, "no_host": nohost}, open(f"{BASE}/naia_record_check.json", "w"), indent=1)
    print(f"\nseason-cells: {dict(tally)}")
    schools_bad = [r["name"] for r in results
                   if any(v["verdict"] == "DISAGREE" for v in r["seasons"].values())]
    schools_ok = [r["name"] for r in results
                  if any(v["verdict"] == "agree" for v in r["seasons"].values())
                  and not any(v["verdict"] == "DISAGREE" for v in r["seasons"].values())]
    print(f"schools with at least one disagreement: {len(schools_bad)}")
    print(f"schools confirmed on every readable season: {len(schools_ok)}")
    print(f"schools with no readable season at all: "
          f"{len(results) - len(schools_bad) - len(schools_ok)}")


if __name__ == "__main__":
    main()
