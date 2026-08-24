"""Harvest postseason results 2022-25, both sexes, all divisions.

Feeds the `{year}_ps` column that v5 defined but never populated.

TWO SOURCES, because the coverage genuinely differs by division:

  D1 -- the per-year tournament article carries every participant (automatic + at-large
        bid tables) AND a table per match. Counting the matches a team appears in gives
        its depth directly, so D1 gets the full ladder from `appearance` to `champion`.
        Depth is measured RELATIVE to the deepest run in that tournament rather than
        assuming a bracket size: the men's field is 48 with byes, the women's 64, so a
        fixed games-to-round map would be wrong for one of them.

  D2 / D3 / NAIA -- no per-year articles exist for recent seasons. The umbrella
        championship article gives champion, runner-up and (for some) semifinalists per
        year. So these divisions get the top of the ladder only.

That asymmetry is safe HERE but would not be in v5: v6 scales each program's rate
against its OWN division's range, so postseason information can only move a team within
its own band. A division with richer postseason data gets a better internal ordering; it
does not gain ground on any other division.
"""
import requests, pandas as pd, io, re, json, time, collections

HDR = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                     "AppleWebKit/537.36 Chrome/126.0 Safari/537.36"}
YEARS = [2022, 2023, 2024, 2025]

D1_ART = "{y}_NCAA_Division_I_{sex}%27s_soccer_tournament"
UMBRELLA = {
    ("men", "D2"):   "NCAA_Division_II_men%27s_soccer_tournament",
    ("women", "D2"): "NCAA_Division_II_women%27s_soccer_tournament",
    ("men", "D3"):   "NCAA_Division_III_men%27s_soccer_tournament",
    ("women", "D3"): "NCAA_Division_III_women%27s_soccer_tournament",
    ("men", "NAIA"): "NAIA_men%27s_soccer_championship",
    ("women", "NAIA"): "NAIA_women%27s_soccer_championship",
}

def get(title):
    r = requests.get("https://en.wikipedia.org/wiki/" + title, timeout=35, headers=HDR)
    return r.text if r.status_code == 200 else None

def clean_team(x):
    x = re.sub(r"\[[^]]*\]", "", str(x))
    x = re.sub(r"^#\d+\s*", "", x)          # drop the seed prefix
    x = re.sub(r"\((\d+)\)", "", x)          # drop "(4)" seed suffix
    x = re.sub(r"\s+", " ", x).strip()
    return x

def d1_year(sex, y):
    """{team: label} for one D1 tournament."""
    html = get(D1_ART.format(y=y, sex=sex))
    if not html:
        return {}, f"article missing"
    try:
        tabs = pd.read_html(io.StringIO(html))
    except Exception:
        return {}, "no tables"
    field = set()
    for tb in tabs:
        flat = " ".join(str(c) for c in tb.columns)
        if "bid" not in flat.lower():
            continue
        col = next((c for c in tb.columns if str(c).endswith("'Team')") or str(c) == "Team"), None)
        if col is None:
            continue
        for v in tb[col].tolist():
            t = clean_team(v)
            if t and t.lower() != "nan":
                field.add(t)
    # matches: two-row, five-column tables holding [date, teamA, score, teamB, venue]
    games = collections.Counter()
    finals = []
    for tb in tabs:
        if tb.shape[1] != 5 or tb.shape[0] < 1:
            continue
        try:
            a, sc, b = clean_team(tb.iloc[0, 1]), str(tb.iloc[0, 2]), clean_team(tb.iloc[0, 3])
        except Exception:
            continue
        if not a or not b or a.lower() == "nan" or b.lower() == "nan":
            continue
        if not re.match(r"^\s*\d+\s*[–-]\s*\d+", sc):
            continue
        games[a] += 1; games[b] += 1
        finals.append((a, b, sc))
    if not games:
        return {}, "no match tables"
    deepest = max(games.values())
    # champion = winner of the last match played by a team with the deepest run
    champ = None
    top2 = {t for t, _ in games.most_common(2)}
    for a, b, sc in reversed(finals):
        # the final is the last match between the two deepest-running teams; with byes in
        # a 48-team field those two need NOT have equal game counts
        if {a, b} == top2 or (games[a] == deepest and games[b] == deepest):
            m = re.match(r"^\s*(\d+)\s*[\u2013-]\s*(\d+)", sc)
            if m and m.group(1) != m.group(2):
                champ = a if int(m.group(1)) > int(m.group(2)) else b
            break
    ladder = ["final", "semi", "quarter", "r16", "r32", "appearance"]
    out = {}
    for t in field | set(games):
        g = games.get(t, 0)
        if g == 0:
            out[t] = "appearance"        # in the field but no match table found
            continue
        back = deepest - g               # 0 = reached the final
        out[t] = ladder[min(back, len(ladder) - 1)]
    if champ:
        out[champ] = "champion"
    return out, f"{len(field)} in field, {len(games)} played, deepest {deepest}"

def umbrella(sex, div):
    """{year: {team: label}} from a championship-history table.

    Columns are located by CONTENT, not by header. These tables carry a flag/icon column
    that pandas labels 'Unnamed', and the data lands shifted one place left of the header
    row -- the D2 men's table put the champion under 'Unnamed' and the SCORE under
    'Champion', which silently produced a champion called "3-2". So: find the column whose
    values look like scores, and read the champion immediately left of it and the
    runner-up immediately right.
    """
    html = get(UMBRELLA[(sex, div)])
    if not html:
        return {}, "article missing"
    try:
        tabs = pd.read_html(io.StringIO(html))
    except Exception:
        return {}, "no tables"
    SCORE = re.compile(r"^\s*\d+\s*[\u2013\u2212\u2014-]\s*\d+")
    res = collections.defaultdict(dict)
    note = "no usable table"
    for tb in tabs:
        flat = " ".join(str(c) for c in tb.columns)
        if not re.search(r"Champion", flat, re.I) or not re.search(r"Year", flat, re.I):
            continue
        YEAR = re.compile(r"^\s*(19|20)\d{2}")
        ycol = None
        for c in tb.columns:
            hits = sum(1 for v in tb[c].tolist() if YEAR.match(str(v).strip()))
            if hits >= 10:                      # a real year column, not a stray number
                ycol = c
                break
        if ycol is None:
            continue
        rows = [r for _, r in tb.iterrows()
                if YEAR.match(str(r[ycol]).strip())
                and int(YEAR.match(str(r[ycol]).strip()).group(0)) in YEARS]
        if not rows:
            continue
        cols = list(tb.columns)
        # the score column is whichever one actually holds scores in these rows
        sidx = None
        for i, c in enumerate(cols):
            hits = sum(1 for r in rows if SCORE.match(str(r[c])))
            if hits >= max(1, len(rows) // 2):
                sidx = i
                break
        if sidx is None or sidx == 0:
            continue
        cidx, ridx = sidx - 1, (sidx + 1 if sidx + 1 < len(cols) else None)
        # Semifinalists are DELIBERATELY not parsed from these tables. The same column
        # shift that hid the champion also means the trailing columns cannot be located
        # reliably, and a "take any later non-score column" heuristic pulled in the Host
        # city instead -- the NAIA men's rows produced semifinalists called "Wichita" and
        # "Kansas" from "Wichita, Kansas". Champion and runner-up come from columns fixed
        # relative to the score column and are trustworthy; semifinalists are not, so
        # these divisions get the top two places only.
        sfidx = []
        for r in rows:
            y = int(re.match(r"\s*(\d{4})", str(r[ycol])).group(1))
            ch = clean_team(r[cols[cidx]])
            if ch and ch.lower() != "nan":
                res[y][ch] = "champion"
            if ridx is not None:
                ru = clean_team(r[cols[ridx]])
                if ru and ru.lower() != "nan":
                    res[y].setdefault(ru, "final")
            for i in sfidx:
                for part in re.split(r"\s+and\s+|,|/", str(r[cols[i]])):
                    t = clean_team(part)
                    if t and t.lower() != "nan" and len(t) > 2 and not SCORE.match(t):
                        res[y].setdefault(t, "semi")
        note = f"score col {sidx}, champion col {cidx}; years {sorted(res)}"
        break
    return dict(res), note

if __name__ == "__main__":
    out = {}
    for sex in ("men", "women"):
        for y in YEARS:
            d, note = d1_year(sex, y)
            out[f"{sex}|D1|{y}"] = d
            print(f"D1 {sex:5} {y}: {len(d):3} teams  ({note})", flush=True)
            time.sleep(0.4)
    for (sex, div), _ in UMBRELLA.items():
        res, note = umbrella(sex, div)
        for y in YEARS:
            out[f"{sex}|{div}|{y}"] = res.get(y, {})
        got = {y: len(res.get(y, {})) for y in YEARS}
        print(f"{div:5} {sex:5}: {got}  ({note})", flush=True)
        time.sleep(0.4)
    json.dump(out, open("postseason.json", "w"), indent=1)
    tot = sum(len(v) for v in out.values())
    print(f"\nwrote postseason.json — {tot} team-seasons with a postseason result")
