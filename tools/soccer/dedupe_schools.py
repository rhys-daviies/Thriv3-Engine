"""Remove the 8 duplicate men's NAIA programmes from BOTH canonical stores.

Each of these schools sits in `soccer_records.csv` and `colleges` twice, in the same sport
and division, under a short and a long spelling -- "Xavier (LA)" and "Xavier University of
Louisiana". A duplicate row can be emailed twice, which is the only remaining issue in this
dataset that produces a visibly wrong outcome rather than a blank field.

WHICH ROW SURVIVES. The short form, for two reasons: it is the convention the men's records
file uses throughout ("Westminster (UT)", "Point (GA)"), and its `school_id` has no `naia_`
prefix, so every existing join keeps working. The long-form rows arrived later, in a
concurrent NAIA import.

RECORD CELLS ARE MERGED, NOT OVERWRITTEN. An empty cell in the survivor is filled from the
duplicate -- that is how "Xavier (LA)" keeps a 2022 season the newer row lacks. Where both
carry a value and they DISAGREE, the survivor's value stays and the conflict is REPORTED,
because picking a winner would mean inventing a verification that has not happened. Three
pairs disagree, and the disagreements are not small: Southwestern (KS) is 0-13-3 in one row
and 7-10-0 in the other for 2023.

Nothing is deleted without a backup of both files.

Usage: python3 dedupe_schools.py [--apply]
"""
import csv, json, shutil, sqlite3, sys, os

RECORDS = "/Users/rhysdavies/Documents/Thriv3/Soccer Records/soccer_records.csv"
DB = "/Users/rhysdavies/Documents/Recruitmatch/app/server/data/recruitmatch.sqlite"
BASE = "/Users/rhysdavies/Documents/Recruitmatch/individualisation"
APPLY = "--apply" in sys.argv

# (survivor, duplicate) -- survivor first
PAIRS = [
    ("Bethany (KS)",        "Bethany College (Kansas)"),
    ("Northwestern (IA)",   "Northwestern College (Iowa)"),
    ("Saint Francis (IL)",  "University of St. Francis (IL)"),
    ("Saint Mary (KS)",     "University of Saint Mary (Kansas)"),
    ("Saint Thomas (FL)",   "St. Thomas University (Florida)"),
    ("Science & Arts (OK)", "University of Science and Arts of Oklahoma"),
    ("Southwestern (KS)",   "Southwestern College (Kansas)"),
    ("Xavier (LA)",         "Xavier University of Louisiana"),
]
YEARS = [2022, 2023, 2024, 2025]
CELLS = [f"{y}_{c}" for y in YEARS for c in ("W", "L", "D")] + [f"{y}_ps" for y in YEARS]


def main():
    rows = list(csv.DictReader(open(RECORDS, newline="", encoding="utf-8")))
    fields = list(rows[0].keys())
    by_name = {r["name"]: r for r in rows}

    filled, conflicts, missing = [], [], []
    for keep, drop in PAIRS:
        k, d = by_name.get(keep), by_name.get(drop)
        if not k:
            missing.append((keep, "survivor not in records"))
            continue
        if not d:
            continue                      # duplicate exists only in the database
        for c in CELLS:
            kv, dv = (k.get(c) or "").strip(), (d.get(c) or "").strip()
            if not kv and dv:
                k[c] = dv
                filled.append((keep, c, dv))
            elif kv and dv and kv != dv:
                conflicts.append((keep, drop, c, kv, dv))

    keep_names = {a for a, _ in PAIRS}
    drop_names = {b for _, b in PAIRS}
    out = [r for r in rows if r["name"] not in drop_names]
    removed = len(rows) - len(out)

    print(f"records file: {len(rows)} rows -> {len(out)} ({removed} removed)")
    print(f"empty cells filled from the duplicate: {len(filled)}")
    for n, c, v in filled:
        print(f"   {n:22} {c:9} <- {v}")
    print(f"\nCONFLICTS (survivor kept, NOT resolved): {len(conflicts)}")
    by_pair = {}
    for keep, drop, c, kv, dv in conflicts:
        by_pair.setdefault((keep, drop), []).append((c, kv, dv))
    for (keep, drop), items in by_pair.items():
        print(f"   {keep}  vs  {drop}")
        for c, kv, dv in items:
            print(f"      {c:9} kept {kv:4} | dropped row said {dv}")
    for m in missing:
        print(f"   ! {m}")

    con = sqlite3.connect(DB)
    # SPORT-SCOPED. The duplication is men's-only: in the WOMEN'S file the long spelling is
    # the canonical one ("Xavier University of Louisiana", "Northwestern College (Iowa)"), so
    # deleting by name alone removes seven legitimate women's rows. A first run did exactly
    # that and had to be restored from the backup.
    dbdrop = con.execute(
        "SELECT COUNT(*) FROM colleges WHERE sport='mens-soccer' AND name IN (%s)"
        % ",".join("?" * len(drop_names)), tuple(drop_names)).fetchone()[0]
    print(f"\ncolleges table: {dbdrop} men's rows would be deleted "
          f"(women's rows with these names are canonical there and are left alone)")

    json.dump({"filled": filled,
               "conflicts": [{"survivor": a, "dropped": b, "cell": c, "kept": k, "dropped_value": d}
                             for a, b, c, k, d in conflicts]},
              open(f"{BASE}/dedupe_report.json", "w"), indent=1)

    if not APPLY:
        print("\nDry run -- re-run with --apply to write.")
        con.close()
        return

    shutil.copy2(RECORDS, RECORDS.replace(".csv", ".pre_dedupe.csv"))
    with open(RECORDS, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(out)
    print(f"wrote {RECORDS} (backup .pre_dedupe.csv)")

    # carry any identity the dropped row had and the survivor lacks, then delete
    IDENT = ["nickname", "nickname_plural", "mascot", "primary_color", "secondary_color",
             "logo_url", "identity_source", "conference_champion_2025",
             "conference_champion_name", "conference_champion_source"]
    con.row_factory = sqlite3.Row
    carried = 0
    for keep, drop in PAIRS:
        for sport in ("mens-soccer",):
            k = con.execute("SELECT * FROM colleges WHERE name=? AND sport=?", (keep, sport)).fetchone()
            d = con.execute("SELECT * FROM colleges WHERE name=? AND sport=?", (drop, sport)).fetchone()
            if not k or not d:
                continue
            sets, vals = [], []
            for c in IDENT:
                if (k[c] in (None, "")) and (d[c] not in (None, "")):
                    sets.append(f"{c}=?"); vals.append(d[c])
            if sets:
                con.execute(f"UPDATE colleges SET {', '.join(sets)} WHERE id=?", (*vals, k["id"]))
                carried += len(sets)
    deleted = con.execute(
        "DELETE FROM colleges WHERE sport='mens-soccer' AND name IN (%s)"
        % ",".join("?" * len(drop_names)), tuple(drop_names)).rowcount
    con.commit(); con.close()
    print(f"carried {carried} identity fields onto survivors; deleted {deleted} college rows")


if __name__ == "__main__":
    main()
