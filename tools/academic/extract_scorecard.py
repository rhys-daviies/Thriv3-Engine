#!/usr/bin/env python3
"""Extracts the academic fields we care about from the College Scorecard dump.

Scorecard is the federal IPEDS release that US News, Niche and everyone else
is built on top of. Two reasons it is the base here rather than a ranking:

  it is keyed on UNITID, a stable federal id, so the failure that put Cal
  State Dominguez Hills' rank on Cal State Bakersfield — US News routes on a
  numeric id the slug does not have to agree with — has no analogue; and

  it carries the INPUTS a ranking is computed from, so the weighting can be
  chosen for what this product means by academic strength rather than
  inherited from US News's view, which folds in alumni giving and social
  mobility.

Raw only. No score is computed here and none should be: the weighting has
already changed twice, and re-collecting because a weight moved would be
indefensible. The numbers outlive any formula built on them.

    python3 tools/academic/extract_scorecard.py

Reads the 95MB dump, writes a ~1MB CSV. Nothing else is touched.
"""
import csv
import sys
from pathlib import Path

RAW = Path.home() / "Documents" / "Thriv3" / "University individualisation" / "_raw"
SRC = RAW / "Most-Recent-Cohorts-Institution.csv"
OUT = RAW / "academic_raw_scorecard.csv"

# Field, output name, and what it is for. Grouped by the three legs of
# academic strength so the scoring step can weight a leg, not a column.
FIELDS = [
    # identity
    ("UNITID", "unitid"), ("INSTNM", "name"), ("CITY", "city"), ("STABBR", "state"),
    ("CONTROL", "control"), ("CCBASIC", "carnegie_basic"), ("CCUGPROF", "carnegie_ugrad"),
    ("PREDDEG", "predominant_degree"), ("HIGHDEG", "highest_degree"),
    ("ICLEVEL", "level"), ("CURROPER", "operating"), ("UGDS", "undergrads"),
    # leg 1 — calibre of intake
    ("SAT_AVG", "sat_avg"), ("ACTCMMID", "act_mid"),
    ("SATVR25", "sat_read_25"), ("SATMT25", "sat_math_25"),
    ("ADM_RATE", "admit_rate"),
    # leg 2 — academic resources
    ("INEXPFTE", "instructional_spend_per_fte"), ("AVGFACSAL", "avg_faculty_salary"),
    ("PFTFAC", "full_time_faculty_rate"), ("ENDOWBEGIN", "endowment"),
    ("TUITFTE", "tuition_revenue_per_fte"),
    # leg 3 — outcome
    ("C150_4", "grad_rate_6yr"), ("C150_L4", "grad_rate_4yr_inst"),
    ("RET_FT4", "retention_ft"),
    # kept but NOT for the academic score: earnings track major mix, not
    # academic strength (Rose-Hulman $101k vs Williams $88k is "engineering",
    # not "stronger"). Recorded because a later dimension may want them.
    ("MD_EARN_WNE_P10", "median_earnings_10yr"), ("MD_EARN_WNE_P6", "median_earnings_6yr"),
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
            # Bachelor's-granting and still open. Community colleges and
            # closed institutions cannot host an NCAA soccer programme.
            if row.get("CURROPER") != "1":
                continue
            if row.get("HIGHDEG") not in ("3", "4"):
                continue
            rec = {}
            for src, dst in FIELDS:
                v = (row.get(src) or "").strip()
                # Scorecard writes "NA" for a missing value and
                # "PrivacySuppressed" where a cell would identify individuals.
                # Both are absences and must not survive as literal strings.
                rec[dst] = "" if v in ("NA", "NULL", "PrivacySuppressed", "") else v
            writer.writerow(rec)
            kept += 1

    print(f"{kept} institutions -> {OUT}")

    rows = list(csv.DictReader(OUT.open(encoding="utf-8")))
    print(f"\n{'field':32} {'coverage':>9}")
    for _, dst in FIELDS:
        n = sum(1 for r in rows if r[dst])
        print(f"  {dst:30} {100 * n // len(rows):7}%")


if __name__ == "__main__":
    main()
