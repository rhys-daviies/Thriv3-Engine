"""Find team records that cannot be right, using roster_players as the witness.

If a player logged MORE games than the team supposedly played, the team record is wrong.
This needs no scraping, which matters because roughly half of athletics season pages do not
publish an overall record in server-rendered HTML -- so this catches exactly the cells
site-verification cannot reach.

JOINS ON EXACT college_name ONLY. A first pass allowed a prefix fallback and produced 139
"impossible" rows that were mostly artifacts of it: "Penn" matched Penn State, "Charleston"
matched Charleston Southern, "Washington (MO)" matched Washington. Every one of them was
2025, which is what gave the game away -- a real data defect would not confine itself to one
season. Exact matching gives up the schools whose two stores spell them differently, and
that is the right trade for a list handed to another session to act on.

Direction matters: max(games_played) is a LOWER bound on team games, since no player has to
appear in every match. Only player > team is impossible; team > player is normal.
"""
import csv, sqlite3, collections

DB = "/Users/rhysdavies/Documents/Recruitmatch/app/server/data/recruitmatch.sqlite"
FILES = {"men": ("mens-soccer", "soccer_records.csv"),
         "women": ("womens-soccer", "soccer_records_women.csv")}
YEARS = [2022, 2023, 2024, 2025]

con = sqlite3.connect(DB)
# one pass over roster_players instead of a query per school-season
maxgp = {}
for sport, season, name, gp in con.execute(
        "SELECT sport, season, college_name, MAX(games_played) FROM roster_players "
        "WHERE games_played IS NOT NULL GROUP BY sport, season, college_name"):
    for y in YEARS:
        if str(season or "").startswith(str(y)):
            k = (sport, y, name)
            maxgp[k] = max(maxgp.get(k, 0), gp or 0)

out, tally = [], collections.Counter()
for sex, (sport, f) in FILES.items():
    for r in csv.DictReader(open(f"/Users/rhysdavies/Documents/Thriv3/Soccer Records/{f}",
                                 newline="", encoding="utf-8")):
        for y in YEARS:
            v = [r.get(f"{y}_{c}") or "" for c in ("W", "L", "D")]
            if not all(v):
                continue
            team = sum(int(x) for x in v)
            mx = maxgp.get((sport, y, r["name"]))
            if mx is None:
                tally["no exact-name roster match"] += 1
                continue
            if mx > team:
                tally["IMPOSSIBLE (player > team)"] += 1
                out.append((sex, r["division"], r["name"], y, team, mx, mx - team))
            elif mx == team:
                tally["exact"] += 1
            else:
                tally["team >= player (normal)"] += 1

print(dict(tally))
print(f"\n{len(out)} impossible season-cells, exact-name matched\n")
print(f"{'':6} {'div':6} {'school':32} {'yr':5} {'team':>5} {'max_gp':>7} {'short':>6}")
for o in sorted(out, key=lambda x: -x[6]):
    print(f"{o[0][:5]:6} {o[1]:6} {o[2][:32]:32} {o[3]:5} {o[4]:>5} {o[5]:>7} {o[6]:>6}")
print(f"\nby season: {dict(collections.Counter(o[3] for o in out))}")
print(f"by division: {dict(collections.Counter(o[1] for o in out))}")
