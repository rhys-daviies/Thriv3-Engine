#!/usr/bin/env python3
"""Joins our schools to their federal UNITID, via US News name/city/state.

Three sources have to agree on which institution is which:

  the rebuild sheet   our school names, as the coach files spell them
  US News             a rank, a category, and the city/state of the campus
  College Scorecard   the academic metrics, keyed on UNITID

The join is the dangerous step and this file exists because we know how it
fails. A first pass here matched "Alabama A&M" (Normal) to "The University of
Alabama" (Tuscaloosa), "Arizona State" (Tempe) to "University of Arizona"
(Tucson), and "Virginia Tech" (Blacksburg) to "University of Virginia"
(Charlottesville) — the same failure that put Cal State Dominguez Hills' rank
on Cal State Bakersfield.

The cause is worth stating because it is subtle. Dropping generic words makes
"Alabama A&M" into {alabama, a, m} and "University of Alabama" into {alabama},
and a plain subset test then says one contains the other. Containment is only
safe when the EXTRA words are also generic, and "state", "a&m" and "tech" are
the whole point of a name — the rule server/lib/schoolMatch.js already spells
out after this exact bug corrupted three columns.

So the rule here is: the state must agree, and the CITY decides. A candidate
whose city does not match is only accepted when nothing else in the state
matches the city, and even then only if the names are token-identical.
Anything still ambiguous is written out for a human rather than guessed.

    python3 tools/academic/build_crosswalk.py
"""
import csv
import re
import sys
from collections import defaultdict
from pathlib import Path

INDIV = Path.home()/"Documents"/"Thriv3"/"University individualisation"
RAW = INDIV/"_raw"
SHEET = INDIV/"academic_ratings_rebuild.csv"
USNEWS = RAW/"academic_raw_usnews.csv"
SCORECARD = RAW/"academic_raw_scorecard.csv"
OUT = RAW/"academic_crosswalk.csv"
UNMATCHED = RAW/"academic_unmatched.csv"

# Words that never distinguish two institutions. Note what is NOT here:
# "state", "tech", "a", "m", "northern", "southern" and every direction word.
GENERIC = {"university", "college", "the", "of", "at", "and", "campus", "main"}


# Slug -> UNITID, for the schools no rule resolves. Every one was looked up
# by hand and confirmed against the campus city; the comment is the check.
#
# They are here rather than fixed by loosening the matcher because the thing
# that makes them hard is exactly the thing that makes a loose rule dangerous:
# "Alfred State" and "Alfred University" are two different schools in Alfred,
# NY, so any rule permissive enough to join "SUNY Cortland" to "State
# University of New York at Cortland" would also join those two.
ALIAS_UNITID = {
    "byu-3670":                                   "230038",  # Brigham Young, Provo UT
    "colorado-state-university-1350":             "126818",  # CSU Fort Collins, not Pueblo
    "columbia-university-2707":                   "190150",  # Columbia in the City of New York
    "fiu-9635":                                   "133951",  # Florida International, Miami
    "university-of-illinois-urbanachampaign-1775":"145637",  # Illinois Urbana-Champaign
    "iupui-1813":                                 "151111",  # Indiana University-Indianapolis
    "university-of-missouri-2516":                "178396",  # Missouri-Columbia
    "the-university-of-oklahoma-3184":            "207500",  # Oklahoma-Norman, not Health Sciences
    "rutgers-new-brunswick-6964":                 "186380",  # Rutgers-New Brunswick
    "tennessee-tech-3523":                        "221847",  # Tennessee Technological, Cookeville
    "virginia-tech-3754":                         "233921",  # Virginia Polytechnic, Blacksburg
    "university-of-washington-3798":              "236948",  # UW Seattle, not Bothell/Tacoma
    "cal-poly-humboldt-1149":                     "115755",  # Cal Poly Humboldt, Arcata
    "concordia-university-st-paul-2347":          "173328",  # Concordia-Saint Paul
    "jessup-university-1281":                     "122728",  # William Jessup, Rocklin
    "oklahoma-christian-3165":                    "207324",  # Oklahoma Christian, Edmond
    "st-cloud-state-university-2377":             "174783",  # Saint Cloud State
    "st-edwards-university-3621":                 "227845",  # Saint Edward's, Austin
    "alfred-state-college-suny-2854":             "196006",  # SUNY Tech at Alfred, NOT Alfred University
    "philadelphia-biblical-3351":                 "215114",  # Cairn University-Langhorne
    "elms-college-2140":                          "167394",  # College of Our Lady of the Elms, Chicopee
    "suny-plattsburgh-2849":                      "196246",  # SUNY Plattsburgh
    "the-college-of-st-scholastica-2343":         "174899",  # College of Saint Scholastica, Duluth
    "suny-cobleskill-2856":                       "196033",  # SUNY Cobleskill
    "suny-cortland-2843":                         "196149",  # SUNY Cortland
    "suny-new-paltz-2846":                        "196176",  # SUNY New Paltz
    "suny-oswego-2848":                           "196194",  # SUNY Oswego
    "wheaton-college-2227":                       "168281",  # Wheaton College (Massachusetts), Norton
}


def norm(name):
    s = (name or "").lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(t for t in s.split() if t and t not in GENERIC)


def tokens(name):
    return set(norm(name).split())


def norm_city(city):
    """St. Louis and Saint Louis are one place; so are West Point and West  Point."""
    s = (city or "").lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\bst\b", "saint", s)
    s = re.sub(r"\bmt\b", "mount", s)
    s = re.sub(r"\bft\b", "fort", s)
    return " ".join(s.split())


def same_city(a, b):
    a, b = norm_city(a), norm_city(b)
    if not a or not b:
        return False
    return a == b or a.startswith(b) or b.startswith(a)


def jaccard(a, b):
    return len(a & b) / len(a | b) if (a or b) else 0.0


def name_variants(row, slug):
    """Every spelling we hold for one school, because none is reliable alone.

    The sheet's "US News Name" column holds a SLUG rather than a name for the
    ~150 rows written in an earlier session, so it cannot be trusted on its
    own. The slug is a usable name once the trailing id is stripped, and our
    own short name is a third opinion. Matching against the best of the three
    beats picking one and hoping.
    """
    out = []
    listed = (row.get("US News Name") or "").strip()
    if listed and not re.fullmatch(r"[a-z0-9-]+-\d{3,7}", listed):
        out.append(listed)
    if slug:
        out.append(re.sub(r"-\d{3,7}$", "", slug).replace("-", " "))
    if row.get("School"):
        out.append(row["School"])
    return [v for v in out if norm(v)]


def resolve(names, un_city, pool):
    """The one institution in this state that is this school, or None.

    Returns (row, why). Every acceptance has to be explainable, because a
    silent wrong match here is invisible downstream — it just looks like a
    school with someone else's academics.
    """
    targets = [tokens(n) for n in names]
    targets = [t for t in targets if t]
    if not targets:
        return None, "no usable name"

    scored = []
    for s in pool:
        st = tokens(s["name"])
        j = max(jaccard(t, st) for t in targets)
        if j == 0:
            continue
        scored.append((same_city(un_city, s["city"]), j, s))
    if not scored:
        return None, "no name overlap in state"

    city_hits = [x for x in scored if x[0]]
    if city_hits:
        city_hits.sort(key=lambda x: -x[1])
        best = city_hits[0]
        if best[1] >= 0.6:
            return best[2], f"city+name (j={best[1]:.2f})"
        return None, f"city matched but name did not (best j={best[1]:.2f}: {best[2]['name']})"

    # Nothing in the state sits in the right city. Only an exact name match
    # survives that, and only if it is unique — this is where Fordham (New
    # York vs Bronx) and Rutgers (Piscataway vs New Brunswick) belong, and
    # where Alabama A&M vs University of Alabama must not.
    exact = [x for x in scored if x[1] == 1.0]
    if len(exact) == 1:
        return exact[0][2], "exact name, city differs"
    if len(exact) > 1:
        return None, f"{len(exact)} exact-name candidates, none in the right city"
    return None, f"no city match; best is {max(scored, key=lambda x: x[1])[2]['name']}"


def main():
    for p, what in ((USNEWS, "US News raw collection"), (SCORECARD, "extract_scorecard.py")):
        if not p.exists():
            sys.exit(f"missing {p}\n(run {what} first)")

    usnews = {r["slug"]: r for r in csv.DictReader(USNEWS.open(encoding="utf-8"))}
    score = list(csv.DictReader(SCORECARD.open(encoding="utf-8")))

    by_state = defaultdict(list)
    for s in score:
        by_state[s["state"].upper()].append(s)

    rows, unmatched, cache = [], [], {}
    for r in csv.DictReader(SHEET.open(encoding="utf-8")):
        slug = r["US News URL"].rsplit("/", 1)[-1] if r["US News URL"] else ""
        un = usnews.get(slug)
        if not un or not un.get("state"):
            unmatched.append({"school": r["School"], "slug": slug,
                              "reason": "no US News location", "candidates": ""})
            continue

        names = name_variants(r, slug)
        name = names[0] if names else r["School"]
        if slug not in cache:
            if slug in ALIAS_UNITID:
                want = ALIAS_UNITID[slug]
                hit = next((x for x in score if x["unitid"] == want), None)
                cache[slug] = (hit, "hand-verified alias") if hit else (None, f"alias UNITID {want} not in Scorecard")
            else:
                cache[slug] = resolve(names, un["city"], by_state[un["state"].upper()])
        hit, why = cache[slug]

        if not hit:
            pool = by_state[un["state"].upper()]
            near = sorted(pool, key=lambda s: -max(jaccard(tokens(n), tokens(s["name"])) for n in names))[:3]
            unmatched.append({"school": r["School"], "slug": slug, "reason": why,
                              "candidates": " | ".join(f'{s["name"]} ({s["city"]})' for s in near)})
            continue

        rows.append({
            "school": r["School"], "divisions": r["Divisions"], "sport": r["Sports"],
            "usnews_slug": slug, "usnews_name": name,
            "usnews_rank": un["rank"], "usnews_category": un["category"],
            "city": un["city"], "state": un["state"],
            "unitid": hit["unitid"], "scorecard_name": hit["name"],
            "scorecard_city": hit["city"], "match_basis": why,
        })

    with OUT.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
        w.writeheader(); w.writerows(rows)
    with UNMATCHED.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["school", "slug", "reason", "candidates"])
        w.writeheader(); w.writerows(unmatched)

    print(f"{len(rows)} of {len(rows)+len(unmatched)} rows matched to a UNITID")
    print(f"{len(set(r['unitid'] for r in rows))} distinct institutions")
    print(f"{len(unmatched)} unmatched -> {UNMATCHED.name}\n")

    basis = defaultdict(int)
    for r in rows:
        basis[r["match_basis"].split(" (")[0]] += 1
    for k, v in sorted(basis.items(), key=lambda kv: -kv[1]):
        print(f"  {v:5}  {k}")

    odd = [r for r in rows if r["match_basis"] == "exact name, city differs"]
    print(f"\n{len(odd)} accepted on an exact name with a different city:")
    for r in sorted(odd, key=lambda r: r["school"]):
        print(f'  {r["school"][:26]:26} {r["city"]:20} -> {r["scorecard_city"]:20} {r["scorecard_name"][:36]}')


if __name__ == "__main__":
    main()
