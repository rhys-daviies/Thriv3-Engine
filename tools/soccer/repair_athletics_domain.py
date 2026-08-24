#!/usr/bin/env python3
"""
Repairs the athletics_domain column of the university individualisation CSVs.

athletics_domains.json holds 727 entries and is missing plenty of the schools
it is asked about — no "Belmont", no "Cornell", no "Michigan". build.py resolved
it with the same bidirectional-subset matcher it uses for the coach files, but
the other rows of that file are OTHER SCHOOLS, so a missing short name reached
the nearest longer one: Belmont Abbey's domain published for Belmont, Cornell
College's for Cornell, Northern Michigan's for Michigan.

No rule over names could have prevented it. "Adrian" plus "College" is the same
school; "Cornell" plus "College" is a different one.

So the domain is rebuilt from evidence instead — the host of a URL a roster was
actually loaded from, matched on the exact school and sport, never fuzzily. What
cannot be evidenced keeps its old value but is labelled unverified, because the
consumer matters: verify_db_identity.js reads this column as proof that a school
identity is right, so a wrong value does not merely mislead, it certifies.

    python3 tools/soccer/repair_athletics_domain.py            # report only
    python3 tools/soccer/repair_athletics_domain.py --apply    # write

Writes only the two CSVs, and backs them up first. Never touches the database.
"""
import argparse
import csv
import shutil
import sqlite3
from collections import Counter
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

INDIV = Path.home() / "Documents" / "Thriv3" / "University individualisation"
FILES = ["mens_soccer_universities.csv", "womens_soccer_universities.csv"]
DB = "file:server/data/recruitmatch.sqlite?mode=ro"

SOURCE_COL = "athletics_domain_source"


def host_of(url):
    if not url:
        return ""
    netloc = urlparse(url).netloc.lower().replace("www.", "")
    return "" if "web.archive.org" in netloc else netloc


def same_host(a, b):
    a, b = a.lower().replace("www.", ""), b.lower().replace("www.", "")
    return a == b or a.endswith("." + b) or b.endswith("." + a)


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

    hosts = roster_hosts()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    tally = Counter()
    changes = []

    # An athletics domain belongs to the university, not to one of its teams,
    # so evidence from either sport settles both. This matters most for exactly
    # the rows that are wrong: Michigan's men had mgoblue.com from a roster URL
    # while Michigan's women still carried Northern Michigan's, inherited from
    # the same bad name match. Exact school names only — the fuzzy matching is
    # what caused all of this.
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
            current = (r.get("athletics_domain") or "").strip()
            # Evidence, in order: this row's own roster URL, then a roster we
            # loaded for this exact school and sport. Exact keys only — fuzzy
            # matching is the thing that broke it.
            evidence = host_of(r.get("roster_url_2025", "")) or \
                hosts.get(f"{r['sport']}|{r['school'].lower().strip()}", "")

            if evidence and current and not same_host(evidence, current):
                changes.append((r["school"], r["sport"], current, evidence))
                r["athletics_domain"], r[SOURCE_COL] = evidence, "roster-url"
                tally["repaired"] += 1
            elif evidence and current:
                r["athletics_domain"], r[SOURCE_COL] = evidence, "roster-url"
                tally["confirmed"] += 1
            elif evidence:
                r["athletics_domain"], r[SOURCE_COL] = evidence, "roster-url"
                tally["filled"] += 1
            else:
                counterpart = by_school.get(r["school"].lower().strip(), "")
                if counterpart:
                    if current and not same_host(counterpart, current):
                        changes.append((r["school"], r["sport"], current, counterpart))
                        tally["repaired via counterpart"] += 1
                    else:
                        tally["filled via counterpart"] += 1
                    r["athletics_domain"], r[SOURCE_COL] = counterpart, "roster-url-counterpart"
                elif current:
                    # Kept, because it may well be right — but labelled, because
                    # roughly a fifth of the checkable ones were not.
                    r[SOURCE_COL] = "unverified-name-match"
                    tally["unverified"] += 1
                else:
                    r[SOURCE_COL] = ""
                    tally["still empty"] += 1

        if args.apply:
            backup = path.with_name(f"{path.stem}.pre-domain-repair-{stamp}.csv")
            shutil.copy2(path, backup)
            with path.open("w", newline="", encoding="utf-8") as fh:
                w = csv.DictWriter(fh, fieldnames=fields)
                w.writeheader()
                w.writerows(rows)
            print(f"wrote {fname} (backup: {backup.name})")

    total = sum(tally.values())
    print(f"\n{total} rows")
    for k, v in tally.most_common():
        print(f"  {v:5}  {k}")

    print(f"\n{len(changes)} domains named the wrong institution. First 20:")
    for school, sport, was, now in changes[:20]:
        print(f"  {school:34} {sport.replace('-soccer',''):7} {was:30} -> {now}")

    if not args.apply:
        print("\nReport only. Re-run with --apply to write.")


if __name__ == "__main__":
    main()
