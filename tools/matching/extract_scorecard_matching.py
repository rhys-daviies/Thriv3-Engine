#!/usr/bin/env python3
"""Extracts the geography and cost fields the matching model needs.

Separate from extract_scorecard.py on purpose. That one pulls the inputs to
the academic rating and should not grow columns every time another criterion
wants something; this one pulls what affordability and location need. Both
read the same dump and key on the same UNITID, so they join cleanly.

Raw only, same rule as the academic extract: no score is computed here. The
weighting for affordability has not been tuned yet and will move, and
re-collecting because a weight moved would be indefensible.

Net price is the number that matters, not tuition. Sticker tuition tells a
family nothing — the published price at a well-endowed private school is
routinely double what anyone actually pays. NPT4 is what students paid after
all grant aid, which is the honest basis for "can this family afford it".
The by-income brackets (NPT41..NPT45) are collected too: the form asks for a
budget rather than an income today, but the moment it asks for income the
better column is already here.

    python3 tools/matching/extract_scorecard_matching.py

Reads the 95MB dump, writes a ~400KB CSV. Nothing else is touched.
"""
import csv
import sys
from pathlib import Path

RAW = Path.home() / "Documents" / "Thriv3" / "University individualisation" / "_raw"
SRC = RAW / "Most-Recent-Cohorts-Institution.csv"
OUT = RAW / "matching_raw_scorecard.csv"

FIELDS = [
    # identity — UNITID is the join key to both crosswalks
    ("UNITID", "unitid"), ("INSTNM", "name"),
    # geography
    ("CITY", "city"), ("STABBR", "state"), ("ZIP", "zip"),
    ("LATITUDE", "latitude"), ("LONGITUDE", "longitude"),
    ("LOCALE", "locale"),
    # public/private decides which net-price column is populated
    ("CONTROL", "control"),
    # cost — average net price, then the same by family income band
    ("NPT4_PUB", "net_price_pub"), ("NPT4_PRIV", "net_price_priv"),
    ("NPT41_PUB", "net_price_pub_0_30k"), ("NPT42_PUB", "net_price_pub_30_48k"),
    ("NPT43_PUB", "net_price_pub_48_75k"), ("NPT44_PUB", "net_price_pub_75_110k"),
    ("NPT45_PUB", "net_price_pub_110k_plus"),
    ("NPT41_PRIV", "net_price_priv_0_30k"), ("NPT42_PRIV", "net_price_priv_30_48k"),
    ("NPT43_PRIV", "net_price_priv_48_75k"), ("NPT44_PRIV", "net_price_priv_75_110k"),
    ("NPT45_PRIV", "net_price_priv_110k_plus"),
    # sticker prices, kept for context and for the in-state/out-of-state gap
    ("TUITIONFEE_IN", "tuition_in_state"), ("TUITIONFEE_OUT", "tuition_out_state"),
    ("COSTT4_A", "cost_of_attendance_academic_yr"), ("COSTT4_P", "cost_of_attendance_program_yr"),
    # admissions — affordability is not the only criterion that joins on UNITID;
    # academic fit needs these two and they are cheap to carry here as well.
    ("SAT_AVG", "sat_avg"), ("ADM_RATE", "admit_rate"),
]


def main():
    if not SRC.exists():
        sys.exit(f"missing {SRC}\nDownload the Most-Recent-Cohorts-Institution zip first.")
    csv.field_size_limit(10 ** 7)

    kept = 0
    with SRC.open(encoding="utf-8-sig", newline="") as fh, \
         OUT.open("w", newline="", encoding="utf-8") as out:
        reader = csv.DictReader(fh)
        writer = csv.DictWriter(out, fieldnames=[o for _, o in FIELDS])
        writer.writeheader()
        for row in reader:
            if row.get("CURROPER") != "1":
                continue
            if row.get("HIGHDEG") not in ("2", "3", "4"):
                continue
            rec = {}
            for src, dst in FIELDS:
                v = (row.get(src) or "").strip()
                rec[dst] = "" if v in ("NA", "NULL", "PrivacySuppressed", "") else v
            writer.writerow(rec)
            kept += 1

    print(f"{kept} institutions -> {OUT}")

    rows = list(csv.DictReader(OUT.open(encoding="utf-8")))
    print(f"\n{'field':34} {'coverage':>9}")
    for _, dst in FIELDS:
        n = sum(1 for r in rows if r[dst])
        print(f"  {dst:32} {100 * n // len(rows):7}%")


if __name__ == "__main__":
    main()
