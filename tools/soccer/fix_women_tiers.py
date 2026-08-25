"""Give the women's file the sub-D1 conference tiers it has never had.

Every women's D2 row is `d2t1`, every D3 row `d3t1`, every NAIA row `naiat1` — 862 rows on a
single tier each. That is not merely undifferentiated, it is INERT: v6's tier_factor is
`tier / division_mean_tier`, so when a division shares one tier the factor is exactly 1.0 for
every school in it. The men's file has always had two tiers per division and its tiers track
performance (D3 t1 mean strength 0.645 vs t2 0.470), so the women's side has been missing a
signal the men's side uses.

HOW THE TIERS ARE DERIVED. From the women's own measured results, not copied from the men's
file — conference strength genuinely differs by sex, and six conferences already carry
different tiers per sport for that reason. Because the women's tiers are currently inert, the
`within_div_strength` in a v6 run is TIER-FREE, so deriving tiers from it is not circular. The
men's equivalent could not be used this way: its strengths were computed with tiers already
active, so its strong conferences look strong partly because they were marked strong.

THE RULE, applied per division:
  t1  conference mean strength >= (mean of conference means) + 0.75 x SD of conference means
  t2  everything else
  and a conference must have >= 6 schools to qualify for t1. A 4-school mean is too noisy to
  justify an 18% relative boost.
  "Independent" is never t1 — it is not a conference, just the absence of one.

THE THRESHOLD IS A JUDGEMENT, exactly like BANDS. 0.75 SD yields 22% / 18% / 13% of schools
in t1 for D2 / D3 / NAIA, against 20% and 27% for men's D3 and NAIA. Men's D2 is not a model
here: 85% of its schools are t1, which inverts the meaning so that t2 marks out a weak
minority. Edit the constant and re-run to move the line.

Usage: python3 fix_women_tiers.py [--apply]
"""
import csv, collections, statistics, shutil, sys

RANK = "/Users/rhysdavies/Documents/Recruitmatch/individualisation/rank_women.csv"
RECORDS = "/Users/rhysdavies/Documents/Thriv3/Soccer Records/soccer_records_women.csv"
SD_MULT = 0.75
MIN_SCHOOLS = 6
APPLY = "--apply" in sys.argv

strength = collections.defaultdict(list)
for r in csv.DictReader(open(RANK, newline="", encoding="utf-8")):
    if r.get("within_div_strength"):
        strength[(r["division"], r["conference"])].append(float(r["within_div_strength"]))

tier_of = {}
for div in ("D2", "D3", "NAIA"):
    per = {c: v for (d, c), v in strength.items() if d == div}
    eligible = {c: statistics.mean(v) for c, v in per.items()
                if len(v) >= MIN_SCHOOLS and "ndependent" not in c}
    if not eligible:
        continue
    mu = statistics.mean(eligible.values())
    sd = statistics.pstdev(list(eligible.values()))
    thr = mu + SD_MULT * sd
    lvl = div.lower()
    n1 = 0
    print(f"{div}: {len(eligible)} eligible conferences, mean {mu:.3f} sd {sd:.3f}, threshold {thr:.3f}")
    for c, m in sorted(eligible.items(), key=lambda x: -x[1]):
        if m >= thr:
            tier_of[(div, c)] = f"{lvl}t1"
            n1 += len(per[c])
            print(f"   t1  {c[:46]:46} n={len(per[c]):3} {m:.3f}")
    tot = sum(len(v) for v in per.values())
    print(f"   -> {n1}/{tot} schools t1 ({100*n1/tot:.0f}%)\n")

rows = list(csv.DictReader(open(RECORDS, newline="", encoding="utf-8")))
fields = list(rows[0].keys())
changed = collections.Counter()
for r in rows:
    div = r["division"]
    if div not in ("D2", "D3", "NAIA"):
        continue
    want = tier_of.get((div, r["conference"]), f"{div.lower()}t2")
    if r["conf_tier"] != want:
        changed[(r["conf_tier"], want)] += 1
        r["conf_tier"] = want

print("changes:", {f"{a} -> {b}": n for (a, b), n in changed.items()})
print(f"total rows changed: {sum(changed.values())}")
if APPLY:
    shutil.copy2(RECORDS, RECORDS.replace(".csv", ".pre_tiers.csv"))
    with open(RECORDS, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader(); w.writerows(rows)
    print(f"wrote {RECORDS} (backup .pre_tiers.csv)")
else:
    print("Dry run -- re-run with --apply to write.")
