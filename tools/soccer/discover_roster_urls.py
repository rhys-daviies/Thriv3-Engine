#!/usr/bin/env python3
"""
Finds the roster URL for the schools the worklist has none for, and proves it
belongs to the right school before writing it down.

Candidates come from two places, neither trustworthy on its own:

  counterpart  the host of a known-good roster URL at a school whose
               normalised name matches — cheap and usually right, but the
               normalisation that makes it work also stripped "College of"
               and matched New Jersey City University to The College of
               New Jersey.

  domain       athletics_domain from the individualisation CSVs, where 126 of
               514 rows point at a different institution entirely: Belmont to
               Belmont Abbey, Indiana to Indiana Tech, Colby-Sawyer to Colby.

So a candidate is a guess. What makes it usable is the check: load the page and
require the title to name the season, the sport, AND every distinctive word of
the school we were looking for. Anything short of that is written down as
needing review rather than quietly accepted — a roster harvested from the wrong
school is far worse than a gap, because nothing downstream would ever question it.

    python3 tools/soccer/discover_roster_urls.py --limit 5
    python3 tools/soccer/discover_roster_urls.py

Writes only the worklist CSV. Nothing here touches the database.
"""
import argparse
import csv
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import requests

THRIV3 = Path.home() / "Documents" / "Thriv3"
WORKLIST = THRIV3 / "2025 Roster Sheets" / "_gaps_worklist.csv"
INDIV = THRIV3 / "University individualisation"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

SPORT_PATHS = {
    "mens-soccer": ["mens-soccer", "m-soccer", "msoc", "msoccer", "mens_soccer"],
    "womens-soccer": ["womens-soccer", "w-soccer", "wsoc", "wsoccer", "womens_soccer"],
}
URL_SHAPES = [
    "https://{host}/sports/{path}/roster/{season}",
    "https://{host}/sports/{path}/roster/season/{season}",
    "https://{host}/sports/{path}/{season}-{yy}/roster",
    "https://{host}/sports/{path}/roster",
]

# Words that identify nobody. "Wheaton College" and "Wheaton" are the same
# claim; it is "wheaton" that has to appear.
STOPWORDS = {"university", "college", "the", "of", "at", "state", "saint", "st",
             "school", "institute", "academy"}


def tokens(name):
    """Distinctive lowercase words of a school name, parentheses dropped."""
    bare = re.sub(r"\([^)]*\)", " ", name)
    words = re.findall(r"[a-z0-9]+", bare.lower())
    keep = [w for w in words if w not in STOPWORDS]
    return keep or words


def norm(name):
    return "".join(tokens(name))


def title_school(title):
    """The school half of '2025 Women's Soccer Roster - Somewhere College'."""
    parts = re.split(r"\s+[-|–]\s+", title)
    return parts[-1].strip() if len(parts) > 1 else title


STATES = {
    "al": "alabama", "ak": "alaska", "az": "arizona", "ar": "arkansas", "ca": "california",
    "co": "colorado", "ct": "connecticut", "de": "delaware", "fl": "florida", "ga": "georgia",
    "hi": "hawaii", "ia": "iowa", "id": "idaho", "il": "illinois", "in": "indiana",
    "ks": "kansas", "ky": "kentucky", "la": "louisiana", "ma": "massachusetts", "md": "maryland",
    "me": "maine", "mi": "michigan", "mn": "minnesota", "mo": "missouri", "ms": "mississippi",
    "mt": "montana", "nc": "north carolina", "nd": "north dakota", "ne": "nebraska",
    "nh": "new hampshire", "nj": "new jersey", "nm": "new mexico", "nv": "nevada",
    "ny": "new york", "oh": "ohio", "ok": "oklahoma", "or": "oregon", "pa": "pennsylvania",
    "ri": "rhode island", "sc": "south carolina", "sd": "south dakota", "tn": "tennessee",
    "tx": "texas", "ut": "utah", "va": "virginia", "vt": "vermont", "wa": "washington",
    "wi": "wisconsin", "wv": "west virginia", "wy": "wyoming",
}


def qualifier(school):
    """
    The bracketed part of a name, which is the whole point of the name.

    "Wesleyan (GA)" and "Wesleyan University" are different institutions, and
    dropping the bracket matched the Georgia school to Connecticut's. Same for
    Wilmington (DE) against UNC Wilmington, and St. Joseph's (Brooklyn) against
    St. Joseph's of Philadelphia. If a name carries a qualifier, the page has
    to corroborate it.
    """
    m = re.search(r"\(([^)]+)\)", school)
    if not m:
        return None
    raw = m.group(1).strip().lower()
    return STATES.get(raw, raw)


def verify(title, school, sport, season, page_text=""):
    """
    Returns (ok, reason). Every clause has to hold; a near miss is a miss.
    """
    low = title.lower()
    if str(season) not in title:
        return False, f"season {season} not in title {title!r}"
    if "soccer" not in low:
        return False, f"not a soccer page: {title!r}"
    wants_women = sport == "womens-soccer"
    is_women = bool(re.search(r"\bwomen|\bwomen's|\bw\.? soccer", low))
    is_men = bool(re.search(r"\bmen(?!\w)|\bmen's|\bm\.? soccer", low))
    # "women" contains "men", so women is decided first.
    if wants_women and not is_women:
        return False, f"wanted women's, title says {title!r}"
    if not wants_women and (is_women or not is_men):
        return False, f"wanted men's, title says {title!r}"

    got = title_school(title)
    missing = [t for t in tokens(school) if t not in norm(got) and t not in got.lower()]
    if missing:
        return False, f"school mismatch: wanted {school!r}, page says {got!r} (missing {missing})"

    q = qualifier(school)
    if q and q not in page_text.lower() and q not in title.lower():
        return False, (f"qualifier unconfirmed: {school!r} needs {q!r} on the page, "
                       f"but it says {got!r} — likely a different institution of the same name")
    return True, f"verified against {title!r}"


def candidates(host, sport, season):
    seen = set()
    for path in SPORT_PATHS[sport]:
        for shape in URL_SHAPES:
            url = shape.format(host=host, path=path, season=season, yy=str(season + 1)[-2:])
            if url not in seen:
                seen.add(url)
                yield url


def load_hosts():
    """Known-good hosts by normalised school name, from roster URLs only."""
    import json
    import sqlite3
    hosts = {}
    db = sqlite3.connect("file:server/data/recruitmatch.sqlite?mode=ro", uri=True)
    for name, url in db.execute(
            "SELECT DISTINCT college_name, source_roster_url FROM roster_players "
            "WHERE source_roster_url LIKE 'http%' AND source_roster_url NOT LIKE '%web.archive%'"):
        host = urlparse(url).netloc
        if host:
            hosts.setdefault(norm(name), host)
    db.close()
    for f in ("mens_soccer_universities.csv", "womens_soccer_universities.csv"):
        for row in csv.DictReader((INDIV / f).open(encoding="utf-8")):
            if row.get("roster_url_2025"):
                host = urlparse(row["roster_url_2025"]).netloc
                if host:
                    hosts.setdefault(norm(row["school"]), host)
    return hosts


def domains():
    out = {}
    for f in ("mens_soccer_universities.csv", "womens_soccer_universities.csv"):
        for row in csv.DictReader((INDIV / f).open(encoding="utf-8")):
            if row.get("athletics_domain"):
                out[f"{row['sport']}|{row['school'].lower().strip()}"] = row["athletics_domain"]
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--season", type=int, default=2025)
    args = ap.parse_args()

    rows = list(csv.DictReader(WORKLIST.open(encoding="utf-8")))
    fields = list(rows[0].keys())
    hosts, doms = load_hosts(), domains()

    todo = [r for r in rows if not r["Roster URL"] and r["Status"] not in ("done", "no-class-data")]
    if args.limit:
        todo = todo[:args.limit]
    print(f"{len(todo)} school-sport(s) needing a URL")

    sess = requests.Session()
    sess.headers["User-Agent"] = UA
    found = review = nothing = 0

    for i, row in enumerate(todo, 1):
        school, sport = row["School"], row["Sport"]
        leads = []
        cp = hosts.get(norm(school))
        if cp:
            leads.append((cp, "counterpart"))
        dm = doms.get(f"{sport}|{school.lower().strip()}")
        if dm and dm.rstrip("/") != (cp or ""):
            leads.append((dm.replace("https://", "").replace("http://", "").strip("/"), "athletics_domain"))

        hit = None
        near = []
        challenged = None
        for host, source in leads:
            for url in candidates(host, sport, args.season):
                try:
                    resp = sess.get(url, timeout=20, allow_redirects=True)
                except Exception:
                    continue
                # 202/403/503 is bot protection, not absence — Albertus Magnus
                # answers 202 to everything. A browser gets through, so keep the
                # first such URL as a candidate for the harvester to verify
                # rather than discarding the school.
                if resp.status_code in (202, 403, 503) and challenged is None:
                    challenged = (url, source)
                if resp.status_code != 200:
                    continue
                m = re.search(r"<title[^>]*>(.*?)</title>", resp.text, re.S | re.I)
                if not m:
                    continue
                title = re.sub(r"\s+", " ", m.group(1)).strip()
                ok, why = verify(title, school, sport, args.season, resp.text)
                if ok:
                    hit = (resp.url, source, why)
                    break
                near.append(f"{url} -> {why}")
            if hit:
                break

        label = f"{school} [{sport.replace('-soccer','')}]"
        if hit:
            row["Roster URL"], row["URL Source"] = hit[0], f"discovered/{hit[1]}"
            row["Notes"] = hit[2][:180]
            found += 1
            print(f"  [{i}/{len(todo)}] {label}: {hit[0]}")
        elif challenged:
            row["Roster URL"], row["URL Source"] = challenged[0], f"unverified/{challenged[1]}"
            row["Notes"] = "site returns a bot challenge to plain HTTP; harvester must verify school and season"
            found += 1
            print(f"  [{i}/{len(todo)}] {label}: {challenged[0]} (unverified — bot challenge)")
        elif near:
            row["Status"] = "needs-review"
            row["Notes"] = ("candidates all failed verification: " + " | ".join(near[:2]))[:300]
            review += 1
            print(f"  [{i}/{len(todo)}] {label}: NEEDS REVIEW — {near[0][:120]}", file=sys.stderr)
        else:
            # Distinct from needs-review: there either was no host to try, or
            # the host answered nothing at any known URL shape. Conflating the
            # two hides which schools need a search and which need a new shape.
            row["Status"] = "needs-url"
            row["Notes"] = ("no candidate host at all" if not leads
                            else f"host(s) {[h for h, _ in leads]} answered no known roster URL shape")
            nothing += 1
            print(f"  [{i}/{len(todo)}] {label}: {row['Notes']}", file=sys.stderr)

        with WORKLIST.open("w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=fields)
            w.writeheader()
            w.writerows(rows)

    print(f"\nFound {found}, needs review {review}, no lead {nothing}.")


if __name__ == "__main__":
    main()
