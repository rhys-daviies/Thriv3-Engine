"""Add records rows for the 7 school-sports that had a roster but no records row.

Every W/L/D below was read from the school's OWN athletics site (see records_gap_fill.json
for the URL and page title behind each). A season the site does not publish is left BLANK —
soccer_score_v6 skips blank seasons and shrinks small samples toward the division mean, so a
missing season costs far less than a fabricated one.

DIVISION AND CONFERENCE were read off those same pages, not carried over from `colleges`,
and two would have been wrong if they had been:
  * Hartford is stored as NCAA D1 in colleges. Its own site shows Conference of New England,
    i.e. D3 — it completed a transition. Division sets the scoring band (D1 floor 55.0, D3
    ceiling 58.0), so the stale value would have misplaced the school by ~30 points.
  * Shawnee State reads as NAIA in older data; its site shows Mountain East and Division II.

CONFERENCE LABELS FOLLOW EACH FILE'S OWN CONVENTION, which differ:
  * The men's file abbreviates and calls Hartford's conference "CCC" — that is the
    Commonwealth Coast Conference, which rebranded to Conference of New England in 2024. Its
    15 conference-mates (Endicott, Roger Williams, Western New England...) are all "CCC" with
    d3t2, so Hartford joins them under that label rather than introducing a second name for
    one conference.
  * The women's file spells conferences out ("Mountain East Conference") and puts every D3
    row at d3t1 — that file has no sub-D1 tier differentiation, a known open item. New rows
    match it rather than inventing a tier that nothing else in the file uses.
  * Note "GNAC" in the MEN'S file is the D2 Great NorthWEST conference. The D3 Great
    NorthEAST is a different conference sharing the abbreviation, so it is spelled out.

Usage: python3 apply_records_gaps.py [--apply]
"""
import csv, shutil, sys

BASE = "/Users/rhysdavies/Documents/Thriv3/Soccer Records"
APPLY = "--apply" in sys.argv

# name, school_id, division, conference, conf_tier, {year: "W-L-D"}
MEN = [
    ("Hartford", "hartford", "D3", "CCC", "d3t2",
     {2023: "4-8-2", 2024: "10-5-3", 2025: "10-6-2"}),
]
WOMEN = [
    ("Shawnee State", "shawnee_state", "D2", "Mountain East Conference", "d2t1",
     {2022: "11-9-1", 2023: "8-10-1", 2024: "3-9-4", 2025: "4-13-1"}),
    ("Albertus Magnus", "albertus_magnus", "D3", "Great Northeast Athletic Conference", "d3t1",
     {2025: "14-3-3"}),
    ("Colby-Sawyer", "colby_sawyer", "D3", "Great Northeast Athletic Conference", "d3t1",
     {2022: "7-10-4", 2023: "12-7-3", 2024: "9-4-8", 2025: "6-9-5"}),
    ("Dean", "dean", "D3", "Great Northeast Athletic Conference", "d3t1",
     {2022: "2-10-4", 2023: "4-10-3", 2024: "2-12-3", 2025: "2-14-2"}),
    ("Eastern Connecticut", "eastern_connecticut", "D3", "Little East Conference", "d3t1",
     {2022: "6-6-5", 2023: "4-7-4", 2024: "6-10-2", 2025: "10-5-3"}),
    ("Plymouth State", "plymouth_state", "D3", "Little East Conference", "d3t1",
     {2022: "5-8-3", 2023: "5-8-4", 2024: "6-11-1"}),
]


def add(path, entries):
    rows = list(csv.DictReader(open(path, newline="", encoding="utf-8")))
    fields = list(rows[0].keys())
    existing = {r["name"] for r in rows}
    ids = {r["school_id"] for r in rows}
    added = []
    for name, sid, div, conf, tier, recs in entries:
        if name in existing:
            print(f"  SKIP {name}: already present")
            continue
        if sid in ids:
            print(f"  SKIP {name}: school_id '{sid}' already used")
            continue
        row = {f: "" for f in fields}
        row.update({"school_id": sid, "name": name, "division": div,
                    "conference": conf, "conf_tier": tier})
        for y, rec in recs.items():
            w, l, d = rec.split("-")
            row[f"{y}_W"], row[f"{y}_L"], row[f"{y}_D"] = w, l, d
        rows.append(row)
        added.append((name, div, conf, len(recs)))
        print(f"  ADD  {name:22} {div:4} {conf[:34]:34} {len(recs)} season(s)")
    if not added:
        return 0
    rows.sort(key=lambda r: (r["division"], r["name"]))
    if APPLY:
        shutil.copy2(path, path.replace(".csv", ".pre_gapfill.csv"))
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader(); w.writerows(rows)
        print(f"  wrote {path} (backup .pre_gapfill.csv)")
    return len(added)


print("men's file:")
n1 = add(f"{BASE}/soccer_records.csv", MEN)
print("women's file:")
n2 = add(f"{BASE}/soccer_records_women.csv", WOMEN)
print(f"\n{n1 + n2} rows added{'' if APPLY else ' (dry run)'}")
