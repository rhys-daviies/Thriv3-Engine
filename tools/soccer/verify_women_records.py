"""Sample-verify the WOMEN'S records against each school's own athletics site.

The men's NAIA import was checked and 32 of 231 readable season-cells were wrong, all but
three of them undercounts. The women's file has never had the same treatment, so its error
rate is simply unknown -- and an unknown error rate on 1208 programmes is not a claim of
accuracy. This samples across all four divisions rather than auditing everything, to
establish whether there IS a systematic problem worth a full pass.
"""
import csv, json, re, random, sys, collections, concurrent.futures as cf
import requests

RECORDS = "/Users/rhysdavies/Documents/Thriv3/Soccer Records/soccer_records_women.csv"
CD = "/Users/rhysdavies/Documents/Thriv3/2025 Coaches Emails"
YEARS = [2022, 2023, 2024, 2025]
HDR = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
OVERALL = re.compile(r"(?i)\boverall\b\D{0,16}(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})")
N = int(sys.argv[1]) if len(sys.argv) > 1 else 60


def norm(n):
    n = re.sub(r"\(([^)]*)\)", r" \1 ", str(n))
    n = re.sub(r"\bst\b\.?", "saint", n, flags=re.I)
    return frozenset(t for t in re.sub(r"[^a-z0-9 ]", " ", n.lower()).split()
                     if t not in ("the", "of", "at", "and"))


def hosts():
    out = {}
    for div in ("d1", "d2", "d3", "naia"):
        try:
            f = open(f"{CD}/{div}_womens_soccer_coaching_contacts.csv", newline="", encoding="utf-8")
        except FileNotFoundError:
            continue
        for r in csv.DictReader(f):
            m = re.match(r"https?://([^/]+)", (r.get("source_url") or ""))
            if m and "web.archive.org" not in m.group(1) and r["school_name"] not in out:
                out[r["school_name"]] = m.group(1).lower()
    return out


def match_host(name, hs):
    want = norm(name)
    if not want:
        return None
    for direction in ("fwd", "rev"):
        c = []
        for k, h in hs.items():
            have = norm(k)
            if direction == "fwd" and want <= have:
                c.append((len(have - want), h))
            elif direction == "rev" and have <= want:
                c.append((len(want - have), h))
        if not c:
            continue
        c.sort(key=lambda x: x[0])
        if len(c) > 1 and c[0][0] == c[1][0]:
            return None
        return c[0][1]
    return None


def season(host, y):
    for path in (f"/sports/womens-soccer/schedule/{y}", f"/sports/wsoc/{y}-{str(y+1)[2:]}/schedule"):
        try:
            r = requests.get(f"https://{host}{path}", headers=HDR, timeout=25, allow_redirects=True)
        except Exception:
            continue
        if r.status_code != 200 or len(r.text) < 15000:
            continue
        m = OVERALL.search(re.sub(r"\s+", " ", re.sub(r"(?s)<[^>]+>", " ", r.text)))
        return tuple(int(x) for x in m.groups()) if m else None
    return None


def check(row, host):
    out = {"name": row["name"], "division": row["division"], "host": host, "seasons": {}}
    for y in YEARS:
        ours = tuple(row.get(f"{y}_{c}") or "" for c in ("W", "L", "D"))
        if not all(ours):
            out["seasons"][y] = {"verdict": "we_have_none"}
            continue
        got = season(host, y)
        if not got:
            out["seasons"][y] = {"verdict": "no_data", "ours": "-".join(ours)}
            continue
        t = "-".join(str(x) for x in got)
        out["seasons"][y] = {"verdict": "agree" if t == "-".join(ours) else "DISAGREE",
                             "ours": "-".join(ours), "site": t}
    return out


rows = list(csv.DictReader(open(RECORDS, newline="", encoding="utf-8")))
hs = hosts()
random.seed(7)                       # fixed seed so this sample is reproducible
by_div = collections.defaultdict(list)
for r in rows:
    by_div[r["division"]].append(r)
sample = []
for div, rs in by_div.items():
    random.shuffle(rs)
    per = max(6, N // len(by_div))
    for r in rs:
        h = match_host(r["name"], hs)
        if h:
            sample.append((r, h))
        if len([1 for s, _ in sample if s["division"] == div]) >= per:
            break
print(f"sampling {len(sample)} women's programmes across {len(by_div)} divisions", flush=True)

results = []
with cf.ThreadPoolExecutor(max_workers=10) as ex:
    for res in ex.map(lambda a: check(*a), sample):
        results.append(res)
        bad = [f"{y}: ours {v['ours']} vs site {v['site']}"
               for y, v in res["seasons"].items() if v["verdict"] == "DISAGREE"]
        if bad:
            print(f"DISAGREE {res['division']:8} {res['name'][:30]:30} {'; '.join(bad)}", flush=True)

t = collections.Counter()
for r in results:
    for v in r["seasons"].values():
        t[v["verdict"]] += 1
lower = higher = 0
for r in results:
    for v in r["seasons"].values():
        if v.get("verdict") == "DISAGREE":
            og = sum(int(x) for x in v["ours"].split("-")); sg = sum(int(x) for x in v["site"].split("-"))
            lower += og < sg; higher += og > sg
json.dump(results, open("/Users/rhysdavies/Documents/Recruitmatch/individualisation/women_record_sample.json", "w"), indent=1)
print(f"\ncells: {dict(t)}")
readable = t['agree'] + t['DISAGREE']
if readable:
    print(f"error rate on readable cells: {t['DISAGREE']}/{readable} = {100*t['DISAGREE']/readable:.1f}%")
print(f"of the disagreements, ours lower: {lower}, ours higher: {higher}")
