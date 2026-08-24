from __future__ import annotations
"""
soccer_score_v6.py
==================
Cross-division college soccer program rating, v6.

WHAT CHANGED FROM v5
--------------------
1. Four seasons (2022-25). 2021 was dropped from the data: gappiest year, lowest
   weight, COVID-distorted. The `--w2021` flag is gone -- in v5 it silently shifted
   every other season's weight by one position.

2. Division is applied ONCE. v5 multiplied `div_mult` into the numerator only (so it
   already acted as a division penalty) and then multiplied `prestige` on top. The
   product spanned 32x from D1 to NJCAA, which swamped every difference in actual
   record: a perfect 18-0-0 D3 season scored the same as a D1 team going 2.9-15.1.

   v6 replaces both with an explicit BAND per division -- a floor and a ceiling on the
   shared 0-100 scale. Within-division quality decides where in its band a program
   sits; the bands decide how much divisions overlap.

   The band values are an EDITORIAL judgement, not a fitted quantity. Cross-division
   fixtures in this sport are almost entirely spring and exhibition games, which are
   not competitive-equivalent, so there is no honest way to measure the offsets from
   results. They belong to whoever owns the product. Edit BANDS and re-run.

3. Rate is league points per game, (3W + D) / 3G, on 0..1. v5 used
   1.0W + 0.4D - 0.1L, where the loss term double-counted (losses are already in
   games played) and let heavily-beaten teams go negative and clamp to a shared zero.

4. Small samples shrink toward their division mean (SHRINK_GAMES pseudo-games), so a
   program with one partial season is not ranked as confidently as one with four.

5. Postseason is wired but inert until the data exists -- see POSTSEASON below.

Usage:
    python soccer_score_v6.py --sex men
    python soccer_score_v6.py --sex women --out rankings_women.csv
    python soccer_score_v6.py --sex men --report      # band/overlap diagnostics only
"""

import csv, math, argparse, collections, statistics
from pathlib import Path

FILES = {
    "men":   "/Users/rhysdavies/Documents/Thriv3/Soccer Records/soccer_records.csv",
    "women": "/Users/rhysdavies/Documents/Thriv3/Soccer Records/soccer_records_women.csv",
}

SEASONS = [2022, 2023, 2024, 2025]
WEIGHTS = [40, 60, 75, 100]          # recency; relative, so no rescaling needed

# ---------------------------------------------------------------------------
# THE EDITORIAL DIAL
# ---------------------------------------------------------------------------
# floor and ceiling of each division's score band on the 0-100 scale.
# Overlap between consecutive bands is deliberate and is the whole point: it is what
# lets an elite lower-division program out-rate a poor higher-division one, without
# collapsing the divisions into each other.
#
# Read a row as: "the weakest program in this division scores <floor>, the strongest
# scores <ceiling>".
BANDS = {
    "D1":    (55.0, 100.0),
    "D2":    (38.0,  74.0),
    "NAIA":  (32.0,  66.0),
    "D3":    (25.0,  58.0),
    "NJCAA": (15.0,  45.0),
}

# conference tier, as a RELATIVE adjustment inside its own division (the mean tier in
# each division is normalised to 1.0, so tier moves a program within its band and
# never shifts the band itself)
CONF_TIER = {
    "d1t1": 1.22, "d1t2": 1.06, "d1t3": 0.88, "d1t4": 0.74,
    "d2t1": 1.18, "d2t2": 1.00,
    "d3t1": 1.20, "d3t2": 1.00,
    "naiat1": 1.16, "naiat2": 1.00,
    "njcaat1": 1.00, "njcaat2": 1.00,
}

SHRINK_GAMES = 10.0     # pseudo-games pulling a program toward its division mean

# Band edges. These were 2nd/98th percentile to stop a freak season defining the band,
# but that CLIPPED the top and bottom 2% to identical scores -- five D1 programs tied on
# exactly 100.0. Shrinkage toward the division mean already damps outliers, so the true
# min and max are safe here and preserve the ordering at both ends.
LO_PCT, HI_PCT = 0.0, 100.0

# ---------------------------------------------------------------------------
# POSTSEASON (retired -- see below)
# ---------------------------------------------------------------------------
# v5 defined a flat 1.35x postseason bonus that never fired -- it read a `{year}_ps`
# column that did not exist at the time. v6 wired up a graduated bonus keyed off round
# reached, expecting `{year}_ps` to be populated later.
#
# It has since been confirmed (2026-08-24) that the W/L/D columns already include
# postseason games -- e.g. a team's recorded season total matches its own site's
# "overall including the postseason run" figure, not a regular-season-only total.
# That means postseason performance was already fully reflected in `rate` below, so
# adding a further bonus from `{year}_ps` double-counted it: a deep tournament run
# inflated both the win total AND the bonus on top of that same win total. That
# double-count shifted rank for roughly half the dataset and flipped the #1 overall
# program. The `{year}_ps` column is left in the CSVs (it may still be useful as a
# labelled signal some day) but is no longer read here.
POSTSEASON_BONUS = {}  # retired -- postseason is already baked into W/L/D, do not reintroduce


# ---------------------------------------------------------------------------
def season_rates(row):
    """[(weight, games, rate)] for every season this program has a record for."""
    out = []
    for w, yr in zip(WEIGHTS, SEASONS):
        ws, ls, ds = row.get(f"{yr}_W", ""), row.get(f"{yr}_L", ""), row.get(f"{yr}_D", "")
        if ws == "" or ls == "":
            continue
        W, L = int(ws), int(ls)
        D = int(ds) if ds not in ("", None) else 0
        G = W + L + D
        if G == 0:
            continue
        rate = (3 * W + D) / (3 * G)                      # league points per game, 0..1 -- already includes postseason
        out.append((w, G, rate))
    return out


def weighted_rate(row):
    """Recency-weighted, games-weighted mean rate, and the games behind it."""
    rs = season_rates(row)
    if not rs:
        return None, 0.0
    num = sum(w * G * r for w, G, r in rs)
    den = sum(w * G for w, G, _ in rs)
    return (num / den if den else None), sum(G for _, G, _ in rs)


def tier_factor(row, div_mean_tier):
    """Conference tier as a relative move WITHIN the division."""
    t = CONF_TIER.get(row.get("conf_tier", ""), 1.0)
    m = div_mean_tier.get(row.get("division", ""), 1.0) or 1.0
    return t / m


def pct(sorted_vals, p):
    if not sorted_vals:
        return 0.0
    i = (p / 100.0) * (len(sorted_vals) - 1)
    lo, hi = int(math.floor(i)), int(math.ceil(i))
    if lo == hi:
        return sorted_vals[lo]
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (i - lo)


def score_all(rows, shrink=SHRINK_GAMES):
    """Returns list of (row, score, detail) plus per-division diagnostics."""
    # mean tier per division, so tier is relative and never shifts a band
    tiers = collections.defaultdict(list)
    for r in rows:
        tiers[r["division"]].append(CONF_TIER.get(r.get("conf_tier", ""), 1.0))
    div_mean_tier = {d: (sum(v) / len(v) if v else 1.0) for d, v in tiers.items()}

    # pass 1: raw weighted rates
    raw = {}
    for r in rows:
        wr, games = weighted_rate(r)
        raw[id(r)] = (wr, games)

    # division mean rate, for shrinkage
    div_rates = collections.defaultdict(list)
    for r in rows:
        wr, _ = raw[id(r)]
        if wr is not None:
            div_rates[r["division"]].append(wr)
    div_mean = {d: (sum(v) / len(v)) for d, v in div_rates.items() if v}

    # pass 2: shrink, apply tier
    adj = {}
    for r in rows:
        wr, games = raw[id(r)]
        if wr is None:
            adj[id(r)] = None
            continue
        prior = div_mean.get(r["division"], wr)
        shrunk = (wr * games + prior * shrink) / (games + shrink)
        adj[id(r)] = shrunk * tier_factor(r, div_mean_tier)

    # pass 3: robust within-division scaling, then map into the band
    by_div = collections.defaultdict(list)
    for r in rows:
        if adj[id(r)] is not None:
            by_div[r["division"]].append(adj[id(r)])
    edges = {}
    for d, v in by_div.items():
        v = sorted(v)
        lo, hi = pct(v, LO_PCT), pct(v, HI_PCT)
        edges[d] = (lo, hi if hi > lo else lo + 1e-9)

    out = []
    for r in rows:
        a = adj[id(r)]
        if a is None:
            out.append((r, None, {}))
            continue
        d = r["division"]
        lo, hi = edges.get(d, (0.0, 1.0))
        strength = min(1.0, max(0.0, (a - lo) / (hi - lo)))
        floor, ceil = BANDS.get(d, (0.0, 100.0))
        score = floor + (ceil - floor) * strength
        wr, games = raw[id(r)]
        out.append((r, score, {"rate": wr, "adj": a, "strength": strength, "games": games}))
    return out, edges, div_mean


def overlap_report(out):
    """How much do the divisions actually interleave? This is the dial's read-out."""
    scored = [(r, s) for r, s, _ in out if s is not None]
    by = collections.defaultdict(list)
    for r, s in scored:
        by[r["division"]].append(s)
    order = [d for d in ("D1", "D2", "NAIA", "D3", "NJCAA") if d in by]
    print(f"\n{'division':8}{'n':>5}{'floor':>8}{'p25':>8}{'median':>8}{'p75':>8}{'top':>8}")
    for d in order:
        v = sorted(by[d])
        print(f"{d:8}{len(v):5}{v[0]:8.1f}{pct(v,25):8.1f}{statistics.median(v):8.1f}"
              f"{pct(v,75):8.1f}{v[-1]:8.1f}")
    ref = by.get("D1", [])
    if ref:
        ref_sorted = sorted(ref)
        print("\nwhere each division's best programs land inside D1:")
        for d in order:
            if d == "D1":
                continue
            v = sorted(by[d])
            for label, p in (("top program", 100.0), ("top 10%", 90.0)):
                val = pct(v, p)
                below = sum(1 for x in ref_sorted if x < val)
                print(f"   {d:6} {label:12} scores {val:5.1f}  ->  above "
                      f"{below:3}/{len(ref_sorted)} D1 programs "
                      f"({100*below/len(ref_sorted):4.1f}th pct of D1)")


def main():
    ap = argparse.ArgumentParser(description="Cross-division soccer rating v6")
    ap.add_argument("--sex", choices=["men", "women"], default="men")
    ap.add_argument("--input")
    ap.add_argument("--out")
    ap.add_argument("--report", action="store_true", help="diagnostics only, no file written")
    ap.add_argument("--shrink", type=float, default=SHRINK_GAMES)
    args = ap.parse_args()

    path = args.input or FILES[args.sex]
    if not Path(path).exists():
        print(f"ERROR: {path} not found"); return

    rows = list(csv.DictReader(open(path, newline="", encoding="utf-8")))
    out, edges, div_mean = score_all(rows, shrink=args.shrink)
    ranked = [(r, s, d) for r, s, d in out if s is not None]
    ranked.sort(key=lambda x: -x[1])

    print(f"{args.sex}: {len(rows)} programs, {len(ranked)} scored, "
          f"{len(rows)-len(ranked)} with no record data")
    print(f"shrinkage: {args.shrink:.0f} pseudo-games toward the division mean")
    has_ps = any(str(r.get(f"{y}_ps", "")).strip() for r in rows for y in SEASONS)
    print(f"postseason column present: {'yes' if has_ps else 'no — bonus inert'}")
    overlap_report(out)

    print("\ntop 15 overall:")
    for i, (r, s, d) in enumerate(ranked[:15], 1):
        print(f"  {i:>3}. {s:5.1f}  {r['name'][:30]:30} {r['division']:5} {r['conference'][:18]:18}"
              f" rate {d['rate']:.3f}")
    print("\nbest program in each division below D1:")
    seen = set()
    for i, (r, s, d) in enumerate(ranked, 1):
        dv = r["division"]
        if dv != "D1" and dv not in seen:
            seen.add(dv)
            print(f"  overall rank {i:>4}: {r['name'][:28]:28} {dv:5} {s:5.1f}")

    if args.report:
        return
    outp = args.out or f"rankings_v6_{args.sex}.csv"
    fields = ["rank", "name", "division", "conference", "conf_tier", "score",
              "within_div_strength", "weighted_rate", "games"]
    for y in SEASONS:
        fields += [f"{y}_W", f"{y}_L", f"{y}_D"]
    with open(outp, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for i, (r, s, d) in enumerate(ranked, 1):
            w.writerow({**r, "rank": i, "score": f"{s:.2f}",
                        "within_div_strength": f"{d['strength']:.4f}",
                        "weighted_rate": f"{d['rate']:.4f}", "games": d["games"]})
        for r, s, d in out:
            if s is None:
                w.writerow({**r, "rank": "", "score": "", "within_div_strength": "",
                            "weighted_rate": "", "games": ""})
    print(f"\nwrote {outp}")


if __name__ == "__main__":
    main()
