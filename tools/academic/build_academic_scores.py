#!/usr/bin/env python3
"""Turns the raw academic stores into a 1-10 rating per school.

Reads only. Writes two files: the joined inputs, so every score can be traced
back to the numbers behind it, and the scores themselves.

WHAT THE RATING IS BUILT FROM, AND WHY

The rating has to mean "how academically strong is this university", and it
has to be comparable between a National University and a Regional College.
The US News rank is not, on its own: #1 Regional Colleges South is the top of
an 84-school pool of teaching colleges, #1 National Universities the top of a
434-school pool of research universities. Ranking a school against its
Carnegie peers says nothing about where those peers sit.

So the rank is not the input. Three legs are, each measured in units that
carry no category normalisation in them at all:

  intake calibre 40%   SAT. What the admitted students actually score.
  resources      35%   instructional spend per student, share of faculty who
                       are full-time, endowment per student, class size.
                       What the institution spends on teaching.
  outcome        25%   six-year graduation rate. What comes out.

DELIBERATELY EXCLUDED, each for a measured reason:

  acceptance rate   correlates with the US News rank at +0.76 in National
                    Liberal Arts and -0.03 in Regional Universities West. It
                    measures who chose to apply. Cal Poly Pomona admits 74%
                    and is #3 in its category.
  freshman retention  US News's own label for it is "an indicator of student
                    satisfaction". That belongs in a campus-experience
                    measure, not an academic one.
  earnings          tracks the mix of majors, not academic strength.
                    Rose-Hulman $101k against Williams $88k says
                    "engineering school", not "stronger".

The rank is kept for VALIDATION instead: if the score reproduces the US News
ordering inside each category, it is measuring what US News measures, and it
extends across categories for free. That check runs at the bottom.

    python3 tools/academic/build_academic_scores.py
"""
import csv
import math
import statistics as st
from collections import defaultdict
from pathlib import Path

RAW = Path.home()/"Documents"/"Thriv3"/"University individualisation"/"_raw"
INPUTS = RAW/"academic_inputs.csv"
SCORES = RAW/"academic_scores.csv"

WEIGHTS = {"intake": 0.40, "resources": 0.35, "outcome": 0.25}
# Within resources, so one component cannot carry the leg on its own.
RESOURCE_WEIGHTS = {"spend": 0.40, "faculty_ft": 0.25, "endowment": 0.20, "class_size": 0.15}


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def percentile_map(values):
    """value -> its position in the population, 0..1. Ties share a position."""
    ordered = sorted(values)
    n = len(ordered)
    def rank(v):
        lo, hi = 0, n
        while lo < hi:
            mid = (lo + hi)//2
            if ordered[mid] < v: lo = mid + 1
            else: hi = mid
        below = lo
        same = sum(1 for x in ordered[below:below+64] if x == v) or 1
        return (below + same/2) / n
    return rank


def spearman(pairs):
    pairs = [(a, b) for a, b in pairs if a is not None and b is not None]
    if len(pairs) < 8:
        return None
    def ranked(v):
        o = sorted(range(len(v)), key=lambda i: v[i]); out = [0.0]*len(v); i = 0
        while i < len(o):
            j = i
            while j+1 < len(o) and v[o[j+1]] == v[o[i]]: j += 1
            for k in range(i, j+1): out[o[k]] = (i+j)/2 + 1
            i = j+1
        return out
    a, b = ranked([p[0] for p in pairs]), ranked([p[1] for p in pairs])
    ma, mb = st.mean(a), st.mean(b)
    num_ = sum((x-ma)*(y-mb) for x, y in zip(a, b))
    den = (sum((x-ma)**2 for x in a) * sum((y-mb)**2 for y in b))**0.5
    return num_/den if den else None


def main():
    cross = list(csv.DictReader((RAW/"academic_crosswalk.csv").open(encoding="utf-8")))
    score = {r["unitid"]: r for r in csv.DictReader((RAW/"academic_raw_scorecard.csv").open(encoding="utf-8"))}
    usn = {r["slug"]: r for r in csv.DictReader((RAW/"academic_raw_usnews.csv").open(encoding="utf-8"))}

    # One row per institution; several of our school names share one campus.
    inst = {}
    for r in cross:
        sc, un = score.get(r["unitid"]), usn.get(r["usnews_slug"])
        if not sc or r["unitid"] in inst:
            continue
        ug = num(sc["undergrads"]) or num(un["undergrads"]) or None

        # SAT: Scorecard's average where published, else the midpoint of the
        # US News quartile range. Scorecard covers 38% of institutions since
        # test-optional; US News still prints a range for 70%.
        sat = num(sc["sat_avg"])
        sat_src = "scorecard_avg"
        if sat is None and num(un["sat_25"]) and num(un["sat_75"]):
            sat = (num(un["sat_25"]) + num(un["sat_75"]))/2
            sat_src = "usnews_midpoint"
        if sat is None:
            sat_src = ""

        endow = num(sc["endowment"])
        inst[r["unitid"]] = {
            "unitid": r["unitid"], "school": r["school"], "usnews_slug": r["usnews_slug"],
            "name": sc["name"], "city": sc["city"], "state": sc["state"],
            "carnegie_basic": sc["carnegie_basic"], "control": sc["control"],
            "usnews_rank": r["usnews_rank"], "usnews_category": r["usnews_category"],
            "undergrads": ug or "",
            "sat": sat or "", "sat_source": sat_src,
            "grad_rate_6yr": num(sc["grad_rate_6yr"]) or "",
            "instructional_spend_per_fte": num(sc["instructional_spend_per_fte"]) or "",
            "full_time_faculty_rate": num(sc["full_time_faculty_rate"]) or "",
            "endowment_per_undergrad": (endow/ug) if (endow and ug) else "",
            "student_faculty_ratio": num(un["student_faculty_ratio"]) or "",
            # carried but NOT scored — see the module docstring
            "admit_rate": num(sc["admit_rate"]) or "",
            "retention_ft": num(sc["retention_ft"]) or "",
            "median_earnings_10yr": num(sc["median_earnings_10yr"]) or "",
        }

    rows = list(inst.values())
    print(f"{len(rows)} institutions\n")
    print(f"{'input':32} {'coverage':>9}")
    for f in ("sat", "grad_rate_6yr", "instructional_spend_per_fte",
              "full_time_faculty_rate", "endowment_per_undergrad", "student_faculty_ratio"):
        n = sum(1 for r in rows if r[f] != "")
        print(f"  {f:30} {100*n//len(rows):7}%")

    # Percentile scales, each fitted on the schools we actually have.
    # Money is log-scaled: the gap between $8k and $16k per student matters
    # more than the gap between $92k and $100k.
    scales = {}
    for f, tf in (("sat", lambda v: v), ("grad_rate_6yr", lambda v: v),
                  ("instructional_spend_per_fte", math.log), ("full_time_faculty_rate", lambda v: v),
                  ("endowment_per_undergrad", lambda v: math.log(max(v, 1))),
                  ("student_faculty_ratio", lambda v: -v)):
        vals = [tf(r[f]) for r in rows if r[f] != "" and r[f] > 0]
        scales[f] = (percentile_map(vals), tf)

    def pct(r, f):
        if r[f] == "" or r[f] <= 0:
            return None
        fn, tf = scales[f]
        return fn(tf(r[f]))

    for r in rows:
        legs, used = {}, []
        p = pct(r, "sat")
        if p is not None:
            legs["intake"] = p; used.append("sat")
        p = pct(r, "grad_rate_6yr")
        if p is not None:
            legs["outcome"] = p; used.append("grad6")

        parts, wts = [], []
        for f, key in (("instructional_spend_per_fte", "spend"), ("full_time_faculty_rate", "faculty_ft"),
                       ("endowment_per_undergrad", "endowment"), ("student_faculty_ratio", "class_size")):
            p = pct(r, f)
            if p is not None:
                parts.append(p); wts.append(RESOURCE_WEIGHTS[key]); used.append(key)
        if parts:
            legs["resources"] = sum(x*w for x, w in zip(parts, wts))/sum(wts)

        # A missing leg re-weights the others rather than scoring zero. A zero
        # would read as "academically weak" when it means "not reported", and
        # a null drops the school out of matching entirely.
        if legs:
            tw = sum(WEIGHTS[k] for k in legs)
            raw = sum(legs[k]*WEIGHTS[k] for k in legs)/tw
            r["academic_rating"] = round(1 + 9*raw, 1)
            r["legs_used"] = "+".join(sorted(legs))
            r["inputs_used"] = ",".join(used)
        else:
            r["academic_rating"] = ""
            r["legs_used"] = ""
            r["inputs_used"] = ""

    fields = list(rows[0].keys())
    with INPUTS.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields); w.writeheader(); w.writerows(rows)

    scored = [r for r in rows if r["academic_rating"] != ""]
    with SCORES.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["unitid", "school", "name", "state",
                                           "usnews_rank", "usnews_category",
                                           "academic_rating", "legs_used"])
        w.writeheader()
        for r in sorted(scored, key=lambda r: -r["academic_rating"]):
            w.writerow({k: r[k] for k in ("unitid", "school", "name", "state",
                                          "usnews_rank", "usnews_category",
                                          "academic_rating", "legs_used")})

    print(f"\n{len(scored)} of {len(rows)} scored -> {SCORES.name}")
    print(f"legs: {dict((k, sum(1 for r in scored if r['legs_used'] == k)) for k in sorted({r['legs_used'] for r in scored}))}")

    # Back to one row per SCHOOL NAME, which is what the rest of the system
    # keys on: several of our names share a campus (Adrian / Adrian College,
    # the three merged PennWest campuses), and each needs the rating.
    by_slug = {r["usnews_slug"]: r for r in rows}
    final, missing = [], []
    for r in cross:
        src = by_slug.get(r["usnews_slug"])
        if not src or src["academic_rating"] == "":
            missing.append(r["school"]); continue
        final.append({
            "School": r["school"], "Divisions": r["divisions"], "Sports": r["sport"],
            "academic_rating": src["academic_rating"],
            "unitid": src["unitid"], "institution": src["name"],
            "usnews_rank": src["usnews_rank"], "usnews_category": src["usnews_category"],
            "legs_used": src["legs_used"], "inputs_used": src["inputs_used"],
        })
    out = RAW.parent/"academic_ratings_final.csv"
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(final[0].keys())); w.writeheader(); w.writerows(final)
    print(f"\n{len(final)} school rows rated -> {out.name}")
    if missing:
        print(f"  {len(missing)} without a rating: {missing[:6]}")

    print("\nVALIDATION — score against the US News order, inside each category")
    print("(negative is right: a better rank is a lower number)\n")
    cats = defaultdict(list)
    for r in scored:
        if r["usnews_category"] and r["usnews_rank"]:
            parts = [int(x) for x in r["usnews_rank"].split("-")]
            cats[r["usnews_category"]].append((sum(parts)/len(parts), r["academic_rating"]))
    for c, pairs in sorted(cats.items(), key=lambda kv: -len(kv[1])):
        rho = spearman(pairs)
        if rho is not None:
            print(f"  {c:34} n={len(pairs):4}  rho {rho:+.2f}")

    print("\nTOP 15")
    for r in sorted(scored, key=lambda r: -r["academic_rating"])[:15]:
        print(f'  {r["academic_rating"]:4.1f}  {r["school"][:26]:26} {str(r["usnews_rank"] or "-"):>8} {r["usnews_category"][:30]}')
    print("\nBOTTOM 10")
    for r in sorted(scored, key=lambda r: r["academic_rating"])[:10]:
        print(f'  {r["academic_rating"]:4.1f}  {r["school"][:26]:26} {str(r["usnews_rank"] or "-"):>8} {r["usnews_category"][:30]}')


if __name__ == "__main__":
    main()
