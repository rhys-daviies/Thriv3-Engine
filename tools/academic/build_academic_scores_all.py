#!/usr/bin/env python3
"""Scores NAIA and NJCAA on the same three legs, where the legs exist.

Run after tools/academic/build_academic_scores.py, which fits the percentile
scales on the NCAA population. This reuses those scales so a 6.0 means the
same thing in both files, and adds nothing to them: an NAIA school is placed
against the NCAA distribution, not against other NAIA schools.

TWO HONEST LIMITS, both visible in the output rather than smoothed over.

  NAIA four-year schools lose the intake leg more often. Scorecard publishes
  an SAT average for 50% of them against 82% of the NCAA set, because they
  are less selective and more often test-optional. The leg re-weights, which
  the `legs_used` column records.

  NJCAA schools are two-year, and the substitution is real. They have no SAT
  and no admission rate at all — 0% of them — so there is no intake leg to
  drop. Their completion figure is also a DIFFERENT QUANTITY: C150_L4, the
  share finishing an associate degree in three years, against C150_4, the
  share finishing a bachelor's in six. Those are not the same measurement and
  a rating built on one is not strictly comparable to a rating built on the
  other.

  They are scored anyway, because leaving them null removes them from
  matching entirely, and marked `scorecard-njcaa-v1` so the substitution is
  never invisible. Read a junior-college rating as "resources and completion,
  on a two-year basis" — not as the same quantity as a university's.

    python3 tools/academic/build_academic_scores_all.py
"""
import csv
import math
import statistics as st
from pathlib import Path

RAW = Path.home()/"Documents"/"Thriv3"/"University individualisation"/"_raw"
OUT = RAW.parent/"academic_ratings_naia_njcaa.csv"

WEIGHTS = {"intake": 0.40, "resources": 0.35, "outcome": 0.25}
RESOURCE_WEIGHTS = {"spend": 0.40, "faculty_ft": 0.25, "endowment": 0.20, "class_size": 0.15}


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def percentile_map(values):
    ordered = sorted(values)
    n = len(ordered)
    def rank(v):
        lo, hi = 0, n
        while lo < hi:
            mid = (lo + hi)//2
            if ordered[mid] < v: lo = mid + 1
            else: hi = mid
        return (lo + 0.5)/n
    return rank


def main():
    sc = {r["unitid"]: r for r in csv.DictReader((RAW/"academic_raw_scorecard.csv").open(encoding="utf-8"))}
    ncaa = list(csv.DictReader((RAW/"academic_inputs.csv").open(encoding="utf-8")))
    cross = list(csv.DictReader((RAW/"academic_crosswalk_naia_njcaa.csv").open(encoding="utf-8")))

    # Scales fitted on the NCAA population, so the two files share a meaning.
    scales = {}
    for f, tf in (("sat", lambda v: v), ("grad_rate_6yr", lambda v: v),
                  ("instructional_spend_per_fte", math.log),
                  ("full_time_faculty_rate", lambda v: v),
                  ("endowment_per_undergrad", lambda v: math.log(max(v, 1))),
                  ("student_faculty_ratio", lambda v: -v)):
        vals = [tf(num(r[f])) for r in ncaa if num(r[f]) and num(r[f]) > 0]
        scales[f] = (percentile_map(vals), tf)

    def pct(f, v):
        if v is None or v <= 0:
            return None
        fn, tf = scales[f]
        return fn(tf(v))

    rows = []
    for c in cross:
        s = sc.get(c["unitid"])
        if not s:
            continue
        two_year = s["highest_degree"] == "2"
        ug = num(s["undergrads"])
        endow = num(s["endowment"])

        legs, used = {}, []
        p = pct("sat", num(s["sat_avg"]))
        if p is not None:
            legs["intake"] = p; used.append("sat")

        # The substitution. C150_L4 is placed on the C150_4 scale, which is
        # the compromise the docstring warns about.
        grad = num(s["grad_rate_6yr"]) or (num(s["grad_rate_2yr"]) if two_year else None)
        p = pct("grad_rate_6yr", grad)
        if p is not None:
            legs["outcome"] = p
            used.append("grad2yr" if (two_year and not num(s["grad_rate_6yr"])) else "grad6")

        parts, wts = [], []
        for f, key, val in (
            ("instructional_spend_per_fte", "spend", num(s["instructional_spend_per_fte"])),
            ("full_time_faculty_rate", "faculty_ft", num(s["full_time_faculty_rate"])),
            ("endowment_per_undergrad", "endowment", (endow/ug) if (endow and ug) else None),
        ):
            p = pct(f, val)
            if p is not None:
                parts.append(p); wts.append(RESOURCE_WEIGHTS[key]); used.append(key)
        if parts:
            legs["resources"] = sum(x*w for x, w in zip(parts, wts))/sum(wts)

        if not legs:
            continue
        tw = sum(WEIGHTS[k] for k in legs)
        rating = round(1 + 9*sum(legs[k]*WEIGHTS[k] for k in legs)/tw, 1)
        rows.append({
            "School": c["school"], "division": c["division"], "unitid": c["unitid"],
            "institution": s["name"], "city": s["city"], "state": s["state"],
            "highest_degree": s["highest_degree"],
            "academic_rating": rating,
            "source": "scorecard-njcaa-v1" if two_year else "scorecard-v1",
            "legs_used": "+".join(sorted(legs)), "inputs_used": ",".join(used),
            "sat": s["sat_avg"], "grad_rate_6yr": s["grad_rate_6yr"],
            "grad_rate_2yr": s["grad_rate_2yr"],
            "instructional_spend_per_fte": s["instructional_spend_per_fte"],
        })

    with OUT.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    print(f"{len(rows)} of {len(cross)} scored -> {OUT.name}\n")

    for div in ("NAIA", "NJCAA"):
        g = [r for r in rows if r["division"] == div]
        if not g:
            continue
        v = sorted(r["academic_rating"] for r in g)
        print(f"{div}: n={len(g)}  median {st.median(v):.1f}  "
              f"p10 {v[len(v)//10]:.1f}  p90 {v[-max(1,len(v)//10)]:.1f}  range {v[0]}-{v[-1]}")
        legs = {}
        for r in g:
            legs[r["legs_used"]] = legs.get(r["legs_used"], 0) + 1
        print(f"   legs: {legs}")

    ncaa_v = sorted(num(r["academic_rating"]) for r in ncaa if r["academic_rating"])
    print(f"\nNCAA for comparison: n={len(ncaa_v)}  median {st.median(ncaa_v):.1f}  "
          f"p10 {ncaa_v[len(ncaa_v)//10]:.1f}  p90 {ncaa_v[-len(ncaa_v)//10]:.1f}")

    print("\nNAIA top 8")
    for r in sorted([r for r in rows if r["division"] == "NAIA"], key=lambda r: -r["academic_rating"])[:8]:
        print(f'  {r["academic_rating"]:4.1f}  {r["School"][:30]:30} {r["institution"][:34]:34} SAT {r["sat"][:6] or "-":>6}')
    print("\nNJCAA top 5 and bottom 5")
    nj = sorted([r for r in rows if r["division"] == "NJCAA"], key=lambda r: -r["academic_rating"])
    for r in nj[:5] + nj[-5:]:
        print(f'  {r["academic_rating"]:4.1f}  {r["School"][:30]:30} grad2yr {r["grad_rate_2yr"][:5] or "-":>5}  spend {r["instructional_spend_per_fte"][:7]:>7}')


if __name__ == "__main__":
    main()
