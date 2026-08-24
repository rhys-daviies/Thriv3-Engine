#!/usr/bin/env python3
"""
Repairs the athletics_domain column of the university individualisation CSVs.

athletics_domains.json holds 727 entries and lacks most short names — no
"Belmont", no "Cornell", no "Michigan" — and build.py resolved it with the
bidirectional-subset matcher it uses for the coach files. That matcher is right
there, where two spellings mean one school. Here the other rows are OTHER
SCHOOLS, so a missing short name reached the nearest longer one: Belmont Abbey's
domain for Belmont, Northern Michigan's for Michigan.

The obvious fix is to take the host of a URL a roster was actually loaded from.
That is wrong too, and the first version of this script proved it by writing 53
regressions: Mississippi College became hugedomains.com, Dickinson became
Fairleigh Dickinson's, Franklin and Franklin & Marshall swapped domains, and New
Jersey City became The College of New Jersey — the very error being fixed.
roster_players.source_roster_url carries the same wrong-school matches, because
it was built by name matching too.

So no single source settles it. Two independent ones do:

  roster URL      the host a roster was actually fetched from
  known_domains   the standing evidence file the identity checks already read

Agreement is trusted. Contradiction is recorded as a conflict and left alone,
never resolved by preferring whichever source this script happens to like. A
single source is written but labelled as such. The column feeds
verify_db_identity.js as evidence that an identity is correct, so a confident
wrong value does not merely mislead — it certifies.

    python3 tools/soccer/repair_athletics_domain.py            # report only
    python3 tools/soccer/repair_athletics_domain.py --apply    # write

Writes only the two CSVs, and backs them up first. Never touches the database.
"""
import argparse
import csv
import json
import shutil
import sqlite3
from collections import Counter
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

INDIV = Path.home() / "Documents" / "Thriv3" / "University individualisation"
KNOWN = Path.home() / "Documents" / "Recruitmatch" / "individualisation" / "known_domains.json"
FILES = ["mens_soccer_universities.csv", "womens_soccer_universities.csv"]
DB = "file:server/data/recruitmatch.sqlite?mode=ro"

SOURCE_COL = "athletics_domain_source"

# Hosts that name a platform or a parking page rather than a school.
JUNK = {"hugedomains.com", "sidearmsports.com", "prestosports.com", "wordpress.com",
        "wixsite.com", "godaddy.com", "squarespace.com"}


def host_of(url):
    if not url:
        return ""
    netloc = urlparse(url).netloc.lower().replace("www.", "")
    if "web.archive.org" in netloc or netloc in JUNK:
        return ""
    return netloc


def same_host(a, b):
    a, b = a.lower().replace("www.", ""), b.lower().replace("www.", "")
    if not a or not b:
        return False
    return a == b or a.endswith("." + b) or b.endswith("." + a)


def known_domains():
    """school -> hosts already established for it."""
    out = {}
    for school, v in json.loads(KNOWN.read_text(encoding="utf-8")).items():
        hosts = v if isinstance(v, list) else [v]
        clean = [str(h).lower().replace("www.", "").strip() for h in hosts if h]
        keep = [h for h in clean if h and "archive.org" not in h and h not in JUNK]
        if keep:
            out[school.lower().strip()] = keep
    return out


def athletics_pick(hosts):
    """
    The athletics host among a school's known domains.

    Every school has an institutional .edu; it is the athletics site that
    identifies the programme, so it wins when both are present.
    """
    non_edu = [h for h in hosts if not h.endswith(".edu")]
    for h in non_edu:
        if any(w in h for w in ("go", "sports", "athletics")):
            return h
    return (non_edu or hosts or [""])[0]


def roster_hosts():
    """Exact (sport, school) -> host, from rosters we actually loaded."""
    out = {}
    db = sqlite3.connect(DB, uri=True)
    for name, sport, url in db.execute(
            "SELECT college_name, sport, source_roster_url FROM roster_players "
            "WHERE source_roster_url LIKE 'http%' GROUP BY college_name, sport"):
        h = host_of(url)
        if h:
            out.setdefault(f"{sport}|{name.lower().strip()}", h)
    db.close()
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write the files (default is a report)")
    args = ap.parse_args()

    hosts, kn = roster_hosts(), known_domains()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    tally, conflicts, changes = Counter(), [], []

    # A domain belongs to the university, not one of its teams, so roster
    # evidence from either sport applies to both. Exact school names only.
    by_school = {}
    for fname in FILES:
        for r in csv.DictReader((INDIV / fname).open(encoding="utf-8")):
            ev = host_of(r.get("roster_url_2025", "")) or \
                hosts.get(f"{r['sport']}|{r['school'].lower().strip()}", "")
            if ev:
                by_school.setdefault(r["school"].lower().strip(), ev)

    for fname in FILES:
        path = INDIV / fname
        rows = list(csv.DictReader(path.open(encoding="utf-8")))
        fields = list(rows[0].keys())
        if SOURCE_COL not in fields:
            fields.insert(fields.index("athletics_domain") + 1, SOURCE_COL)

        for r in rows:
            current = (r.get("athletics_domain") or "").strip().lower().replace("www.", "")
            school_key = r["school"].lower().strip()

            roster = (host_of(r.get("roster_url_2025", ""))
                      or hosts.get(f"{r['sport']}|{school_key}", "")
                      or by_school.get(school_key, ""))
            established = kn.get(school_key, [])

            if roster and established:
                if any(same_host(roster, k) for k in established):
                    value, source, bucket = roster, "agreed", "agreed — two sources"
                else:
                    # Two sources, two answers. Naming a winner here would be
                    # guessing, and guessing is what caused this in the first
                    # place. The established value stays and the disagreement
                    # is written into the column, so it cannot pass as verified.
                    value = athletics_pick(established)
                    source = f"conflict(roster={roster})"
                    bucket = "CONFLICT — left for review"
                    conflicts.append((r["school"], r["sport"], roster, established[:3]))
            elif roster:
                value, source, bucket = roster, "roster-url-only", "single source: roster URL"
            elif established:
                value, source, bucket = (athletics_pick(established), "known-domains-only",
                                         "single source: known_domains")
            elif current:
                value, source, bucket = current, "unverified-name-match", "unverified, kept"
            else:
                value, source, bucket = "", "", "still empty"

            if current and value and not same_host(current, value):
                changes.append((r["school"], r["sport"], current, value))
            r["athletics_domain"], r[SOURCE_COL] = value, source
            tally[bucket] += 1

        if args.apply:
            backup = path.with_name(f"{path.stem}.pre-domain-repair-{stamp}.csv")
            shutil.copy2(path, backup)
            with path.open("w", newline="", encoding="utf-8") as fh:
                w = csv.DictWriter(fh, fieldnames=fields)
                w.writeheader()
                w.writerows(rows)
            print(f"wrote {fname} (backup: {backup.name})")

    print(f"\n{sum(tally.values())} rows")
    for k, v in tally.most_common():
        print(f"  {v:5}  {k}")

    print(f"\n{len(conflicts)} source conflicts, left unresolved. First 10:")
    for school, sport, roster, est in conflicts[:10]:
        print(f"  {school:26} {sport.replace('-soccer',''):7} roster {roster:30} known {est}")

    print(f"\n{len(changes)} values changed. First 15:")
    for school, sport, was, now in changes[:15]:
        print(f"  {school:26} {sport.replace('-soccer',''):7} {was:30} -> {now}")

    if not args.apply:
        print("\nReport only. Re-run with --apply to write.")


if __name__ == "__main__":
    main()
