#!/usr/bin/env python3
"""
Harvests 2025 rosters for the schools the original scrape missed or misread.

Two gaps, one crawl (ROADMAP Phase 0, job B3):
  no-roster       — 56 programmes with no 2025 roster rows at all
  no-class-years  — 16 whose rows imported with the class column empty or wrong

Both are the same failure. Every one of these sites renders its roster in the
browser rather than in the HTML, which is exactly why a plain fetch produced
either nothing or the wrong column: Texas Tech's Club column arrived where the
class should have been, and "Solar" became a graduation year of 2029.

So this drives a real browser. It reads the worklist, writes one CSV per
school-sport under the output directory, and marks the worklist up as it goes
so an interrupted run resumes where it stopped.

    python3 tools/soccer/harvest_rosters.py --limit 5          # try a few
    python3 tools/soccer/harvest_rosters.py --kind no-class-years
    python3 tools/soccer/harvest_rosters.py                    # everything todo

It only ever writes CSVs. Nothing here touches the database.
"""
import argparse
import csv
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

THRIV3 = Path.home() / "Documents" / "Thriv3" / "2025 Roster Sheets"
WORKLIST = THRIV3 / "_gaps_worklist.csv"
OUTPUT = THRIV3 / "_gaps_harvested"

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

# Sidearm powers most of these sites, so its markup is tried first and by name.
# The generic fallbacks below catch the handful that use something else. Reading
# a named field beats reading the nth cell of a table: column ORDER is precisely
# what went wrong last time.
EXTRACT = r"""
() => {
  const txt = (n) => (n && n.innerText ? n.innerText.trim() : '');
  const pick = (el, sels) => { for (const s of sels) { const v = txt(el.querySelector(s)); if (v) return v; } return ''; };

  let items = [...document.querySelectorAll('li.sidearm-roster-player')];
  let mode = 'sidearm-list';
  if (!items.length) { items = [...document.querySelectorAll('.sidearm-roster-player')]; mode = 'sidearm-any'; }

  if (items.length) {
    return { mode, players: items.map((el) => ({
      name: pick(el, ['.sidearm-roster-player-name a', '.sidearm-roster-player-name', 'h3 a', 'h3', 'a[href*="roster"]']),
      class_year: pick(el, ['.sidearm-roster-player-academic-year', '[class*="academic-year"]', '[class*="class-year"]']),
      position: pick(el, ['.sidearm-roster-player-position-long-short', '[class*="position"]']),
      hometown: pick(el, ['.sidearm-roster-player-hometown', '[class*="hometown"]']),
      jersey: pick(el, ['.sidearm-roster-player-jersey-number', '[class*="jersey"]']),
    })) };
  }

  // A real <table>, read by matching the HEADER text rather than by position,
  // so a Club column cannot be mistaken for a class column. Tried BEFORE the
  // generic selector below: '[class*="roster"] [class*="player"]' matched 199
  // "players" at Penn State, where the true roster is 28.
  const table = [...document.querySelectorAll('table')]
    .find((t) => t.querySelectorAll('tbody tr').length > 4);
  if (!table) {
    const loose = [...document.querySelectorAll('[class*="roster"] [class*="player"]')];
    if (!loose.length) return { mode: 'none', players: [] };
    return { mode: 'generic', players: loose.map((el) => ({
      name: pick(el, ['a[href*="roster"]', 'h3', '[class*="name"]']),
      class_year: pick(el, ['[class*="academic-year"]', '[class*="class"]']),
      position: pick(el, ['[class*="position"]']),
      hometown: pick(el, ['[class*="hometown"]']), jersey: '',
    })) };
  }
  const heads = [...table.querySelectorAll('thead th, tr:first-child th')].map((t) => txt(t).toLowerCase());
  const col = (...names) => heads.findIndex((h) => names.some((n) => h.includes(n)));
  const idx = {
    name: col('name', 'player'),
    class_year: col('cl.', 'class', 'yr', 'year', 'academic'),
    position: col('pos'),
    hometown: col('hometown', 'home town'),
  };
  const rows = [...table.querySelectorAll('tbody tr')].filter((r) => r.cells.length > 1);
  return { mode: 'table', heads, players: rows.map((r) => {
    const cell = (i) => (i >= 0 && r.cells[i] ? txt(r.cells[i]) : '');
    return { name: cell(idx.name), class_year: cell(idx.class_year),
             position: cell(idx.position), hometown: cell(idx.hometown), jersey: '' };
  }) };
}
"""

# Deliberately narrow: this is a sanity check on the harvest, not the importer's
# validator. server/lib/classYear.js remains the authority at import time.
CLASS_HINT = re.compile(
    r"^(fr|so|jr|sr|gr|fy|r-|rs|red|first|second|third|fourth|fifth|sixth|soph|"
    r"junior|senior|fresh|grad|\d|'|cl|yr)", re.I)


def looks_like_class(value):
    return bool(value) and bool(CLASS_HINT.match(value.strip()))


def slug(school, sport):
    base = re.sub(r"[^a-z0-9]+", "-", f"{school}-{sport}".lower()).strip("-")
    return base


# Anywhere in the path, not just at the end: Carson-Newman writes the season
# mid-path as /sports/w-soccer/2025-26/roster, and an end-anchored test
# cheerfully appended a second year to it.
YEAR_IN_URL = re.compile(r"/(19|20)\d\d")


def season_url(url, season):
    """
    Pins the URL to the season we actually want.

    A Sidearm roster URL with no year serves the CURRENT season. Left alone,
    this harvest would have written American International's and Bentley's
    2026 rosters into a file labelled 2025 — the same silent-wrong-data
    failure the class-year guard exists to prevent, one level up.
    """
    if YEAR_IN_URL.search(url):
        return url
    return url.rstrip("/") + f"/{season}"


STOPWORDS = {"university", "college", "the", "of", "at", "state", "saint", "st",
             "school", "institute", "academy"}


def name_tokens(name):
    bare = re.sub(r"\([^)]*\)", " ", name)
    words = re.findall(r"[a-z0-9]+", bare.lower())
    return [w for w in words if w not in STOPWORDS] or words


KNOWN_PATH = Path.home() / "Documents" / "Recruitmatch" / "individualisation" / "known_domains.json"


def load_known():
    try:
        raw = json.loads(KNOWN_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    out = {}
    for name, v in raw.items():
        hosts = v if isinstance(v, list) else [v]
        out[name.lower().strip()] = [str(h).lower().replace("www.", "").strip() for h in hosts if h]
    return out


KNOWN = load_known()


def verify_school(page, school):
    """
    Confirms the page belongs to the school we asked for.

    Discovery hands over some URLs it could not check itself, because the site
    answers a bot challenge to plain HTTP. Those candidates come from an
    athletics_domain column where 126 of 514 rows name a different institution,
    and from a name-normalising counterpart lookup that matched New Jersey City
    University to The College of New Jersey. A roster harvested from the wrong
    school would look entirely healthy downstream, so it is checked here too.
    """
    title = (page.title() or "")
    tail = re.split(r"\s+[-|\u2013]\s+", title)[-1].strip() or title
    missing = [t for t in name_tokens(school) if t not in tail.lower().replace(" ", "")
               and t not in tail.lower()]
    if not missing:
        return None

    # A title is not the only way a page names its school, and insisting on it
    # rejected two correct pages: Kentucky's says "UK Athletics" and UCSB's
    # says "University of California, Santa Barbara", neither of which contains
    # the tokens we were looking for. So fall back to the host, checked against
    # the same evidence file the identity checks use. This stays strict where
    # it counts — sfuathletics.com is Saint Francis University, and it is not
    # among Simon Fraser's known domains, so that harvest is still refused.
    host = urlparse(page.url).netloc.lower().replace("www.", "")
    for known in KNOWN.get(school.lower().strip(), []):
        if host == known or host.endswith("." + known) or known.endswith("." + host):
            return None

    return (f"wrong school — wanted {school!r}, page says {tail!r} (missing {missing}); "
            f"host {host!r} is not among its known domains either")


def verify_season(page, season):
    """
    Confirms the page served the season that was asked for.

    Some sites ignore an unknown year and quietly fall back to the current
    roster, so appending /2025 is necessary but not sufficient.
    """
    title = (page.title() or "")
    if str(season) in title:
        return None
    years = re.findall(r"\b(20\d\d)\b", title)
    if years and str(season) not in years:
        return f"page is {years[0]}, asked for {season} (title: {title!r})"
    return None


def harvest(page, url, season, school=None):
    page.goto(season_url(url, season), wait_until="domcontentloaded", timeout=45_000)
    # The roster arrives after the document does; give it a beat, then settle.
    try:
        page.wait_for_selector(
            "li.sidearm-roster-player, .sidearm-roster-player, table tbody tr",
            timeout=20_000)
    except Exception:
        pass
    page.wait_for_timeout(1_200)

    wrong = verify_season(page, season)
    if wrong:
        raise RuntimeError(f"wrong season — {wrong}")

    if school:
        wrong = verify_school(page, school)
        if wrong:
            raise RuntimeError(wrong)

    return page.evaluate(EXTRACT)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="stop after N schools")
    ap.add_argument("--kind", choices=["no-roster", "no-class-years"], help="only this gap type")
    ap.add_argument("--headed", action="store_true", help="watch it work")
    ap.add_argument("--retry-failed", action="store_true", help="also retry rows already marked failed")
    ap.add_argument("--season", type=int, default=2025, help="season to harvest (default 2025)")
    args = ap.parse_args()

    rows = list(csv.DictReader(WORKLIST.open(encoding="utf-8")))
    fields = list(rows[0].keys())
    OUTPUT.mkdir(parents=True, exist_ok=True)

    wanted = "todo" if not args.retry_failed else ("todo", "failed")
    todo = [r for r in rows
            if r["Status"] in wanted
            and r["Roster URL"]
            and (not args.kind or r["Gap Type"] == args.kind)]
    if args.limit:
        todo = todo[:args.limit]

    print(f"{len(todo)} school-sport(s) to harvest "
          f"({sum(1 for r in rows if r['Status'] == 'done')} already done, "
          f"{sum(1 for r in rows if not r['Roster URL'])} still need a URL)")

    done = failed = 0
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not args.headed)
        ctx = browser.new_context(user_agent=UA, viewport={"width": 1440, "height": 2200})
        page = ctx.new_page()

        for i, row in enumerate(todo, 1):
            label = f"{row['School']} [{row['Sport'].replace('-soccer','')}]"
            try:
                result = harvest(page, row["Roster URL"], args.season, row["School"])
                players = [p for p in result["players"] if p.get("name")]
                with_class = [p for p in players if looks_like_class(p.get("class_year"))]

                if not players:
                    raise RuntimeError(f"no players found (mode={result['mode']})")

                # For a no-class-years school we already know the roster size,
                # so a wildly different count means the selector matched the
                # wrong thing — 199 "players" at Penn State, where it is 28.
                expected = int(row["Existing Rows"] or 0)
                if expected and not (0.6 * expected <= len(players) <= 1.6 * expected):
                    raise RuntimeError(
                        f"count implausible: {len(players)} players against {expected} "
                        f"already on record (mode={result['mode']})")

                # For a school with no roster on record there is nothing to
                # compare against, so bound it absolutely instead. A college
                # soccer squad is roughly 15-60; 125 "players" at Goucher and
                # 81 at Carlow were the page's whole athletics directory.
                if not expected and not (12 <= len(players) <= 62):
                    raise RuntimeError(
                        f"count implausible for a soccer roster: {len(players)} players "
                        f"(mode={result['mode']})")

                # A harvest with no class years at all is either a school that
                # publishes none — which is a real finding worth recording as
                # such — or a selector that missed the field. Never silently
                # the latter.
                if not with_class:
                    raise RuntimeError(
                        f"{len(players)} players but not one class year (mode={result['mode']}) "
                        f"— confirm the school publishes none before accepting")

                out = OUTPUT / f"{slug(row['School'], row['Sport'])}.csv"
                with out.open("w", newline="", encoding="utf-8") as fh:
                    w = csv.writer(fh)
                    w.writerow(["School", "Sport", "Division", "Player Name", "Class/Year",
                                "Position", "Hometown", "Jersey", "Source Roster URL"])
                    for p in players:
                        cls = p.get("class_year", "").strip()
                        # Anything that is not plausibly a class is dropped rather
                        # than carried through — the whole point of this rerun.
                        w.writerow([row["School"], row["Sport"], row["Division"],
                                    p["name"], cls if looks_like_class(cls) else "",
                                    p.get("position", ""), p.get("hometown", ""),
                                    p.get("jersey", ""), row["Roster URL"]])

                row["Status"] = "done"
                row["Notes"] = (f"{len(players)} players, {len(with_class)} with a class year "
                                f"(mode={result['mode']}, {args.season})")
                done += 1
                flag = "" if with_class else "   <-- NO CLASS YEARS, check this one"
                print(f"  [{i}/{len(todo)}] {label}: {len(players)} players, "
                      f"{len(with_class)} with class{flag}")
            except Exception as err:
                row["Status"] = "failed"
                row["Notes"] = str(err)[:180].replace("\n", " ")
                failed += 1
                print(f"  [{i}/{len(todo)}] {label}: FAILED — {row['Notes']}", file=sys.stderr)

            # Written every iteration so a crash or a Ctrl-C loses nothing.
            with WORKLIST.open("w", newline="", encoding="utf-8") as fh:
                w = csv.DictWriter(fh, fieldnames=fields)
                w.writeheader()
                w.writerows(rows)

        browser.close()

    print(f"\nHarvested {done}, failed {failed}. CSVs in {OUTPUT}")
    if failed:
        print("Re-run with --retry-failed once you have looked at the reasons above.")


if __name__ == "__main__":
    main()
