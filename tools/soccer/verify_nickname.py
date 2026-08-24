"""Decide a sex-differentiated nickname from the school's OWN women's-soccer page.

Some schools name their women's teams differently from their men's, and no rule separates
the two cases that matter:

    Penn State   women's soccer are the Nittany Lions; "Lady Lions" is basketball only
    Liberty      women's soccer really are the Lady Flames

Wikipedia lists both without saying which sport uses which, so the only honest source is
the programme's own page. The coaching-contact CSVs already hold a per-sport, per-sex URL
for nearly every school (".../sports/womens-soccer/coaches"), which is exactly the page
that refers to the team by the name it actually uses.

Counting is restricted to the candidates in play, and a verdict is only returned when one
candidate clearly outnumbers the other. Anything else stays unresolved for a human --
these strings go into live outreach.
"""
import csv, re, json, sys, collections, concurrent.futures as cf
import requests

CD = "/Users/rhysdavies/Documents/Thriv3/2025 Coaches Emails"
HDR = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                     "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
       "Accept-Language": "en-US,en;q=0.9"}


def urls_for(sex):
    """{school: url} from the coaching-contact files for one sex."""
    out = {}
    for div in ("d1", "d2", "d3", "naia"):
        try:
            f = open(f"{CD}/{div}_{sex}s_soccer_coaching_contacts.csv", newline="", encoding="utf-8")
        except FileNotFoundError:
            continue
        for r in csv.DictReader(f):
            u = (r.get("source_url") or "").strip()
            if u and r["school_name"] not in out:
                out[r["school_name"]] = u
    return out


def fetch(url):
    try:
        r = requests.get(url, headers=HDR, timeout=25)
    except Exception as e:
        return None, f"error:{type(e).__name__}"
    body = r.text or ""
    # HTTP 202 with an empty body is a CDN challenge, not a real answer -- reporting it as
    # "nickname absent" would silently turn a block into a wrong verdict.
    if r.status_code == 202 or (r.status_code == 200 and len(body) < 500):
        return None, f"blocked:{r.status_code}:{len(body)}"
    if r.status_code != 200:
        return None, f"http:{r.status_code}"
    return body, "ok"


def strip_html(h):
    h = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", h)
    h = re.sub(r"(?s)<[^>]+>", " ", h)
    return re.sub(r"\s+", " ", h)


def count_candidates(text, cands):
    """Occurrences of each candidate, longest-first so 'Lady Flames' is not also counted
    as a plain 'Flames' hit."""
    t = text.lower()
    order = sorted(cands, key=len, reverse=True)
    counts = collections.Counter()
    for c in order:
        pat = re.compile(r"(?<![a-z])" + re.escape(c.lower()) + r"(?![a-z])")
        n = len(pat.findall(t))
        counts[c] = n
        if n:
            t = pat.sub(" ", t)          # consume, so shorter candidates don't double-count
    return counts


def verify(school, cands, url):
    body, status = fetch(url)
    if not body:
        return {"school": school, "url": url, "status": status,
                "verdict": None, "counts": {}}
    counts = count_candidates(strip_html(body), cands)
    ranked = counts.most_common()
    top, n = ranked[0]
    runner = ranked[1][1] if len(ranked) > 1 else 0
    # a clear winner: present, and at least twice the next candidate
    verdict = top if n >= 3 and n >= 2 * max(runner, 1) else None
    return {"school": school, "url": url, "status": status,
            "verdict": verdict, "counts": dict(counts)}


def main(path, sex):
    urls = urls_for(sex)
    jobs = []
    for r in csv.DictReader(open(path)):
        if r["sport"] != f"{sex}s-soccer":
            continue
        cands = [c for c in json.loads(r["candidates"]) if c]
        if len(cands) < 2:
            continue
        u = urls.get(r["school"])
        if not u:
            print(f"NO URL   {r['school']}  (candidates {cands})")
            continue
        jobs.append((r["school"], cands, u))
    print(f"verifying {len(jobs)} schools against their own {sex}'s soccer pages\n")
    out = []
    with cf.ThreadPoolExecutor(max_workers=8) as ex:
        for res in ex.map(lambda a: verify(*a), jobs):
            out.append(res)
            mark = "OK " if res["verdict"] else "?? "
            print(f"{mark}{res['school'][:26]:26} {res['status']:16} "
                  f"-> {str(res['verdict']):22} {res['counts']}")
    json.dump(out, open(f"nickname_verdicts_{sex}.json", "w"), indent=1)
    got = sum(1 for r in out if r["verdict"])
    print(f"\n{got}/{len(out)} resolved from the school's own page")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "women")
