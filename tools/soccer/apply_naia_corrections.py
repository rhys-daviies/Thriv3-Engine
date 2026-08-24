"""Correct the newly-imported NAIA men's records against each school's own athletics site.

107 NAIA men's programmes arrived from a concurrent import. Checking them against the
schools' own season pages (`verify_naia_records.py`) found 199 season-cells agreeing and 32
disagreeing -- and in 29 of the 32 OUR game count was LOWER, never higher. That 86%
agreement rate is what settles the interpretation: the dataset's convention already IS the
sites' full-season "Overall", so a shortfall is an undercount to fix, not a different
counting rule to respect. Deltas cluster at one or two games, consistent with matches the
import failed to parse.

Confirmed by hand, not just by regex, before writing:
  Cumberland 2023   page "2023 Men's Soccer Schedule - Cumberland University" -> Overall 12-5-3 (we had 9-4-3)
  Columbia Intl 2022 page "2022 ... Columbia International University"        -> Overall 15-4-5 (we had 10-3-3)
  WVU Tech          all four seasons on goldenbearathletics.com              -> 14-3-3 / 14-5-2 / 10-8-2 / 20-1-2

ONE DISAGREEMENT IS REJECTED. Huston-Tillotson 2022 read as "0-0-1" from
htramsathletics.com -- an unpopulated page, not a record. Overwriting a real 8-7-0 with that
would be worse than leaving it. (The similarly-named htathletics.com is a domain-for-sale
parking page, which is how this got noticed.)

Usage: python3 apply_naia_corrections.py [--apply]
"""
import csv, json, shutil, sys

RECORDS = "/Users/rhysdavies/Documents/Thriv3/Soccer Records/soccer_records.csv"
BASE = "/Users/rhysdavies/Documents/Recruitmatch/individualisation"
APPLY = "--apply" in sys.argv

# a site record this implausible is a broken page, not a season
REJECT = {("Huston-Tillotson University", "2022"): "site page reads 0-0-1 -- unpopulated"}


def main():
    check = json.load(open(f"{BASE}/naia_record_check.json"))
    fixes = {}
    for r in check["results"]:
        for y, v in r["seasons"].items():
            if v.get("verdict") != "DISAGREE":
                continue
            key = (r["name"], str(y))
            if key in REJECT:
                print(f"REJECT {r['name'][:34]:34} {y}  {REJECT[key]}")
                continue
            w, l, d = v["site"].split("-")
            fixes[key] = (w, l, d, v["ours"], r["host"])

    rows = list(csv.DictReader(open(RECORDS, newline="", encoding="utf-8")))
    fields = list(rows[0].keys())
    applied = 0
    for row in rows:
        for (name, y), (w, l, d, was, host) in fixes.items():
            if row["name"] != name:
                continue
            row[f"{y}_W"], row[f"{y}_L"], row[f"{y}_D"] = w, l, d
            applied += 1
            print(f"FIX    {name[:34]:34} {y}  {was:9} -> {w}-{l}-{d:2}  ({host})")

    print(f"\n{applied} season cells corrected across "
          f"{len({k[0] for k in fixes})} schools")
    if not APPLY:
        print("Dry run -- re-run with --apply to write.")
        return
    shutil.copy2(RECORDS, RECORDS.replace(".csv", ".pre_naiafix.csv"))
    with open(RECORDS, "w", newline="", encoding="utf-8") as f:
        wr = csv.DictWriter(f, fieldnames=fields)
        wr.writeheader(); wr.writerows(rows)
    print(f"wrote {RECORDS} (backup .pre_naiafix.csv)")


if __name__ == "__main__":
    main()
