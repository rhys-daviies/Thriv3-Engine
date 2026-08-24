"""Two fixes to colleges.soccer_score, at the user's direction.

1. TWO STALE ROWS. Saint Francis (PA) and Dean College hold scores that disagree with a
   fresh v6 run despite having complete four-season records. Saint Francis (PA) survived two
   resyncs from another session, so it is likely falling out of that script's division filter
   or name join rather than being a fresh miss; rather than debug someone else's script, this
   writes the two values directly.

2. NO-DATA ROWS GET NULL, NOT 0. A school with no W/L/D in any season was being stored as
   soccer_score = 0, and 0 is a meaningful value on a 0-100 scale: it reads as "worst
   programme in the country" and sorts that way. v6 itself emits nothing for these rows — the
   0 is introduced at the resync step.

   NULL is what the app already expects. Every consumer guards on it:
     GraduatingDatabase.jsx  `soccer_score != null ? .toFixed(1) : '—'`, and filters nulls
                             out of its sorted list entirely
     Colleges.jsx            `(b.soccer_score ?? -1) - (a.soccer_score ?? -1)` — nulls last
     playerAnalysis.js       `c.soccer_score != null && c.soccer_score >= target - 20 ...`
   That last one is the reason this matters beyond display: with 0 stored, a no-data school
   matches any player whose target is under 20, and gets a program_quality_rating of 0.0
   rather than being excluded.

   national_ranking is cleared on the same rows — a rank without a score is meaningless.

The no-data set is recomputed here from the records files rather than trusted from an earlier
count, since another session has been writing those files throughout.

Usage: python3 fix_scores.py [--apply]
"""
import csv, sqlite3, sys

DB = "/Users/rhysdavies/Documents/Recruitmatch/app/server/data/recruitmatch.sqlite"
RECORDS = {"mens-soccer": "soccer_records.csv", "womens-soccer": "soccer_records_women.csv"}
FRESH = {"mens-soccer": "rank_men.csv", "womens-soccer": "rank_women.csv"}
BASE = "/Users/rhysdavies/Documents/Recruitmatch/individualisation"
YEARS = [2022, 2023, 2024, 2025]
APPLY = "--apply" in sys.argv

con = sqlite3.connect(DB)
con.row_factory = sqlite3.Row

# --- which school-sports have any season data at all, per the records files ---
has_data = {}
for sport, f in RECORDS.items():
    for r in csv.DictReader(open(f"/Users/rhysdavies/Documents/Thriv3/Soccer Records/{f}",
                                 newline="", encoding="utf-8")):
        has_data[(r["name"], sport)] = any((r.get(f"{y}_W") or "").strip() for y in YEARS)

# --- fresh v6 scores ---
fresh = {}
for sport, f in FRESH.items():
    for r in csv.DictReader(open(f"{BASE}/{f}", newline="", encoding="utf-8")):
        if (r.get("score") or "").strip():
            fresh[(r["name"], sport)] = float(r["score"])

rows = [dict(r) for r in con.execute("SELECT * FROM colleges")]

stale, tonull, skipped = [], [], []
for r in rows:
    k = (r["name"], r["sport"])
    cur = r["soccer_score"]
    f = fresh.get(k)
    if f is not None:
        if cur is None or abs(float(cur) - f) >= 0.02:
            stale.append((r["id"], r["name"], r["sport"], cur, f))
        continue
    # no fresh score: NULL it only if the records genuinely hold no season for this school
    if cur is not None:
        if has_data.get(k) is False:
            tonull.append((r["id"], r["name"], r["sport"], cur, r["national_ranking"]))
        elif has_data.get(k) is True:
            # has records but v6 produced nothing -- do NOT null this, it needs explaining
            skipped.append((r["name"], r["sport"], cur))

print(f"stale scores to correct : {len(stale)}")
for i, n, s, a, b in stale:
    print(f"   {n[:34]:34} {s[:5]:5} {a} -> {b}")
print(f"\nno-data rows to set NULL: {len(tonull)}")
print(f"   sample: {[t[1] for t in tonull[:8]]}")
print(f"   of which also carry a national_ranking: {sum(1 for t in tonull if t[4] is not None)}")
if skipped:
    print(f"\nNOT nulled -- has records but no v6 score, needs a look: {len(skipped)}")
    for n, s, c in skipped[:10]:
        print(f"   {n[:34]:34} {s[:5]:5} score={c}")

if not APPLY:
    print("\nDry run -- re-run with --apply to write.")
else:
    cur = con.cursor()
    for i, n, s, a, b in stale:
        cur.execute("UPDATE colleges SET soccer_score=?, updated_date=datetime('now') WHERE id=?", (b, i))
    for i, n, s, a, nr in tonull:
        cur.execute("UPDATE colleges SET soccer_score=NULL, national_ranking=NULL, "
                    "updated_date=datetime('now') WHERE id=?", (i,))
    con.commit()
    print(f"\napplied: {len(stale)} scores corrected, {len(tonull)} rows set to NULL")
con.close()
