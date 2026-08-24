#!/usr/bin/env python3
"""
Folds the B3 gap harvests into the per-division 2025 roster sheets.

They cannot simply be imported alongside. importRosterSheets.js wipes and
reinserts each (sport, division, season) slice, so anything not in the
division sheet at import time is silently dropped — the harvests would vanish
on the next run and nobody would see it happen.

The two gap types need opposite treatment, and getting that backwards would
quietly destroy good data:

  no-class-years  the sheet already has these players WITH minutes and games
                  from the stats scrape, and is missing only the class. So the
                  class year is written onto the existing row. Replacing the
                  row wholesale would trade a season of minutes for a class
                  label, and minutes are what identify a starter.

  no-roster       the sheet has nothing for these schools, so rows are
                  appended. They carry no minutes, because a roster page does
                  not publish them — recorded in Notes rather than left to be
                  discovered later as a mysterious absence.

Estimated Graduation is derived here with the same rules the importer applies,
so a merged row is indistinguishable from a scraped one.

    python3 tools/soccer/merge_harvested_rosters.py           # report
    python3 tools/soccer/merge_harvested_rosters.py --apply   # write

Writes only the roster sheets, and backs them up first.
"""
import argparse
import csv
import glob
import re
import shutil
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

SHEETS = Path.home() / "Documents" / "Thriv3" / "2025 Roster Sheets"
HARVEST = SHEETS / "_gaps_harvested"
SEASON = 2025
DB = "file:server/data/recruitmatch.sqlite?mode=ro"

DIVISION_FILE = {
    ("mens-soccer", "NCAA D1"): "ncaa_d1_mens_soccer_2025_rosters.csv",
    ("mens-soccer", "NCAA D2"): "ncaa_d2_mens_soccer_2025_rosters.csv",
    ("mens-soccer", "NCAA D3"): "ncaa_d3_mens_soccer_2025_rosters.csv",
    ("womens-soccer", "NCAA D1"): "ncaa_d1_womens_soccer_2025_rosters.csv",
    ("womens-soccer", "NCAA D2"): "ncaa_d2_womens_soccer_2025_rosters.csv",
    ("womens-soccer", "NCAA D3"): "ncaa_d3_womens_soccer_2025_rosters.csv",
}

# Mirrors server/lib/classYear.js. Kept deliberately small: this only has to
# read labels a roster page actually printed, and the importer's own validator
# remains the authority on what reaches the database.
YEARS = {"FRESHMAN": 5, "SOPHOMORE": 4, "JUNIOR": 3, "SENIOR": 2, "GRADUATE": 1}
PATTERNS = [
    (r"^(fy|first[-\s]?year|freshman|fresh|fr|f)(?![a-z])", "FRESHMAN"),
    (r"^(sophomore|sophmore|soph|second[-\s]?year|so)(?![a-z])", "SOPHOMORE"),
    (r"^(junior|third[-\s]?year|jr)(?![a-z])", "JUNIOR"),
    (r"^(senior|fourth[-\s]?year|sr)(?![a-z])", "SENIOR"),
    (r"^(graduate\s?student|graduate|grad|gs|grd|gr|masters?|phd)(?![a-z])", "GRADUATE"),
    (r"^1(st)?(?![a-z])", "FRESHMAN"), (r"^2(nd)?(?![a-z])", "SOPHOMORE"),
    (r"^3(rd)?(?![a-z])", "JUNIOR"), (r"^4(th)?(?![a-z])", "SENIOR"),
    (r"^([56](th)?|fifth|sixth)(?![a-z])", "GRADUATE"),
]
REDSHIRT = re.compile(r"^(medical\s+redshirt|redshirt|red|rs|r)(?=[-\s]|fr|so|jr|sr|f(?![a-z])|$)[-\s]*")
FIELD_LABEL = re.compile(r"^(cl|yr|class|year)\s*[.:]+\s*")


def grad_year(label, season=SEASON):
    raw = (label or "").strip()
    if not raw:
        return ""
    text = FIELD_LABEL.sub("", raw.lower()).strip()
    explicit = re.match(r"^'?(\d{4})\b", text) or re.match(r"^'(\d{2})\b", text)
    if explicit:
        n = int(explicit.group(1))
        return str(n if n > 100 else 2000 + n)
    text = re.sub(r"\.", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = REDSHIRT.sub("", text).strip()
    text = re.split(r"[/,]", text)[0].strip()
    for pattern, klass in PATTERNS:
        if re.match(pattern, text):
            return str(season + YEARS[klass])
    return ""


def norm_name(n):
    return re.sub(r"[^a-z]", "", (n or "").lower())


def conferences():
    out = {}
    db = sqlite3.connect(DB, uri=True)
    for name, sport, conf in db.execute(
            "SELECT name, sport, conference FROM colleges WHERE conference IS NOT NULL"):
        out[f"{sport}|{name.lower().strip()}"] = conf
    db.close()
    return out


def load_harvests():
    """school-sport -> list of harvested players."""
    out = defaultdict(list)
    for path in sorted(glob.glob(str(HARVEST / "*.csv"))):
        for r in csv.DictReader(open(path, encoding="utf-8")):
            if r.get("Player Name"):
                out[(r["School"], r["Sport"], r["Division"])].append(r)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    harvests = load_harvests()
    confs = conferences()
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    tally = Counter()
    notes = []

    # Only schools the worklist marked done. A harvest the guards rejected is
    # sitting in the same directory and must not be merged.
    ok = set()
    for r in csv.DictReader((SHEETS / "_gaps_worklist.csv").open(encoding="utf-8")):
        if r["Status"] == "done":
            ok.add((r["School"], r["Sport"], r["Division"]))

    for (sport, division), fname in DIVISION_FILE.items():
        path = SHEETS / fname
        rows = list(csv.DictReader(path.open(encoding="utf-8")))
        fields = list(rows[0].keys())
        by_school = defaultdict(list)
        for r in rows:
            by_school[r["School"]].append(r)

        appended = []
        for key, players in harvests.items():
            school, hsport, hdiv = key
            if hsport != sport or hdiv != division or key not in ok:
                continue

            existing = by_school.get(school, [])
            if existing:
                # no-class-years: write the class onto the row that already
                # holds this player's minutes.
                index = {norm_name(r["Player Name"]): r for r in existing}
                filled = missed = 0
                for p in players:
                    row = index.get(norm_name(p["Player Name"]))
                    if not row:
                        missed += 1
                        continue
                    cls = (p.get("Class/Year") or "").strip()
                    if not cls:
                        continue
                    row["Class/Year"] = cls
                    row["Estimated Graduation"] = grad_year(cls)
                    row["Notes"] = "; ".join(x for x in [row.get("Notes", ""), "class year re-harvested"] if x)
                    filled += 1
                # Zero matches against a roster that already exists means the
                # harvest is of a different team. That is how Simon Fraser's
                # men picked up Saint Francis University — sfuathletics.com is
                # not sfu.ca — and it must stop the merge rather than read as
                # a quiet "filled 0".
                if filled == 0 and players:
                    raise SystemExit(
                        f"REFUSING TO MERGE {school} [{sport}]: none of the {len(players)} "
                        f"harvested players appear on the existing sheet. The harvest is "
                        f"almost certainly a different school. Delete its CSV and re-harvest.")
                tally["class years filled on existing rows"] += filled
                notes.append(f"  {school} [{sport.replace('-soccer','')}]: filled {filled}, "
                             f"{missed} harvested player(s) not on the sheet")
            else:
                # no-roster: nothing on the sheet, so append.
                for p in players:
                    cls = (p.get("Class/Year") or "").strip()
                    new = {f: "" for f in fields}
                    new.update({
                        "School": school,
                        "Conference": confs.get(f"{sport}|{school.lower().strip()}", ""),
                        "Player Name": p["Player Name"],
                        "Class/Year": cls,
                        "Estimated Graduation": grad_year(cls),
                        "Position": p.get("Position", ""),
                        "Hometown": p.get("Hometown", ""),
                        "Source Roster URL": p.get("Source Roster URL", ""),
                        "Total Minutes Played": "",
                        "Data Confidence": "medium",
                        # Stated, not left to be rediscovered: these rows come
                        # from a roster page, which publishes no minutes, so
                        # starter detection cannot use them.
                        "Notes": "harvested from roster page; no minutes or games data available",
                    })
                    appended.append(new)
                tally["players appended for missing rosters"] += len(players)
                notes.append(f"  {school} [{sport.replace('-soccer','')}]: appended {len(players)}")

        if appended:
            rows.extend(appended)
        tally[f"{fname}"] = len(rows)

        if args.apply and (appended or any(True for _ in [1])):
            backup = path.with_name(f"{path.stem}.pre-merge-{stamp}.csv")
            shutil.copy2(path, backup)
            with path.open("w", newline="", encoding="utf-8") as fh:
                w = csv.DictWriter(fh, fieldnames=fields)
                w.writeheader()
                w.writerows(rows)

    print("\n".join(notes))
    print()
    for k, v in sorted(tally.items()):
        print(f"  {v:6}  {k}")
    if args.apply:
        print(f"\nWrote the division sheets (backups: *.pre-merge-{stamp}.csv)")
    else:
        print("\nReport only. Re-run with --apply to write.")


if __name__ == "__main__":
    main()
