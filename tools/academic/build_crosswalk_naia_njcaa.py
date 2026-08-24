#!/usr/bin/env python3
"""Joins the NAIA and NJCAA schools to their federal UNITID.

Harder than the NCAA crosswalk, because these rows carry no location: the
`colleges` table has name and conference and nothing else for them. So the
evidence available is the name itself, and the name has to carry the weight.

Three things make that workable:

  the parenthetical IS the disambiguator.  "Bethany (KS)", "Aquinas College
  (Michigan)", "Benedictine (KS)" — our own naming already encodes the state
  precisely because these names collide nationally. Parsing it turns the
  hardest cases into the easiest.

  exact beats normalised.  "Benedictine College" matches Scorecard's
  "Benedictine College" (Atchison KS) exactly and "Benedictine University"
  (Lisle IL) only after normalisation. Trying the exact string first resolves
  a collision that normalising creates.

  "Community" is a suffix, not an identity.  Half the NJCAA names are the
  short form: "Anne Arundel" for "Anne Arundel Community College". That is
  the one extra word worth tolerating, and only when what remains is unique.

Uniqueness is the acceptance test throughout. A name that matches two
institutions is written out for review rather than resolved by preference —
the rule that stopped Cal State Bakersfield taking Dominguez Hills' rank.

    python3 tools/academic/build_crosswalk_naia_njcaa.py
"""
import csv
import re
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

RAW = Path.home()/"Documents"/"Thriv3"/"University individualisation"/"_raw"
SCORECARD = RAW/"academic_raw_scorecard.csv"
OUT = RAW/"academic_crosswalk_naia_njcaa.csv"
UNMATCHED = RAW/"academic_unmatched_naia_njcaa.csv"
DB = "file:" + str(Path(__file__).resolve().parents[2]/"server"/"data"/"recruitmatch.sqlite") + "?mode=ro"

GENERIC = {"university", "college", "the", "of", "at", "and", "campus", "main"}
# Tolerated as an extra word on the Scorecard side only, and only when what
# is left still resolves uniquely.
SUFFIX_OK = {"community", "junior", "technical", "area", "county"}

STATES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
    "colorado": "CO", "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA",
    "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA",
    "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV", "ohio": "OH",
    "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA", "tennessee": "TN", "texas": "TX",
    "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA", "wisconsin": "WI",
    "wyoming": "WY", "new york": "NY", "new jersey": "NJ", "new mexico": "NM",
    "new hampshire": "NH", "north carolina": "NC", "north dakota": "ND",
    "south carolina": "SC", "south dakota": "SD", "west virginia": "WV",
    "rhode island": "RI", "puerto rico": "PR", "district of columbia": "DC",
}
ABBR = set(STATES.values())


# Names no rule resolves, looked up by hand and confirmed against the campus
# city and the conference the row sits in. The conference is what decides the
# genuinely ambiguous ones: "Baker" in the KCAC is Baker University in Baldwin
# City KS, not Baker College in Owosso MI.
ALIAS_UNITID = {
    "Baker": "154688", "Baker University": "154688",              # KCAC -> Baldwin City KS
    "Bryan": "219790", "Bryan College": "219790",                  # Appalachian -> Dayton TN
    "Central Christian": "154855",                                 # KCAC -> McPherson KS
    "Central Methodist": "176947", "Central Methodist University": "176947",  # Heart -> Fayette MO
    "College of Idaho": "142294",                                  # Caldwell ID, not College of Eastern Idaho
    "Grace": "150677", "Grace College": "150677",                   # Winona Lake IN
    "Indiana Wesleyan": "151801", "Indiana Wesleyan University": "151801",    # Marion IN
    "Midland": "181330",                                           # GPAC -> Fremont NE
    "Ottawa": "155627", "Ottawa University": "155627",              # KCAC -> Ottawa KS
    "Ottawa University Arizona": "464226",                          # Surprise AZ campus
    "Sterling": "155937",                                          # KCAC -> Sterling KS, not Craftsbury VT
    "Taylor": "152530",                                            # Upland IN
    "Saint Thomas (FL)": "137476",                                 # Miami Gardens FL
    "Calumet College of St. Joseph": "150172",                     # Whiting IN
    "LSU Alexandria": "159382", "LSU Shreveport": "159416",
    "Indiana University Columbus": "151111",                       # IU Indianapolis absorbed IU Columbus
    "Benedictine University at Mesa": "",                          # closed 2024
    "Iowa Wesleyan": "",                                           # closed 2023
    "Stanton University": "",                                      # not in Scorecard
    "Park University Gilbert": "",                                 # branch campus; parent is in MO
    "Lincoln Trail": "",                                           # part of the Illinois Eastern district
    "George C. Wallace": "",                                       # three Wallace colleges in the ACCC
    "Jefferson Davis": "101161",                                   # merged into Coastal Alabama
    "Riverside": "121901",                                         # CCCAA -> Riverside City College
    "Highland": "155186",                                          # KJCCC -> Highland KS
    "Meridian": "175935",                                          # MACJC -> Meridian MS
    "Wallace State": "101295",                                     # ACCC -> Hanceville AL
    "Middlesex County": "185536", "Union County": "187198",
    "Northern Idaho": "142443",                                    # NWAACC -> North Idaho College
    "Nebraska Central": "180902",                                  # ICCAC -> Central Community College NE
    "Lord Fairfax": "232575",                                      # renamed Laurel Ridge 2022
    "Ancilla": "497833", "Buffalo-Erie": "191083",
    "Gloucester County": "184791", "Queensborough": "190673",
    "Harper": "149842", "El Camino": "113980", "Blinn": "223427",
    "Allegany": "161688", "Collin College": "247834",
    "Mount San Antonio": "119164", "Northeast Oklahoma A&M": "207290",
    "Penn State Hazleton": "214768", "Central Georgia Tech": "483045",
    "City Colleges Chicago-Richard Daley": "144193",
    # One Scorecard entry covers the district; all three campuses map to it.
    "St. Louis Community-Florissant Valley": "179308",
    "St. Louis Community-Forest Park": "179308",
    "St. Louis Community-Meramec": "179308",
}

def state_hint(name):
    """The state our own name already encodes, if it encodes one."""
    for inside in re.findall(r"\(([^)]+)\)", name or ""):
        t = inside.strip()
        if t.upper() in ABBR:
            return t.upper()
        if t.lower() in STATES:
            return STATES[t.lower()]
    return None


def strip_qualifier(name):
    return re.sub(r"\s*\([^)]*\)", " ", name or "").strip()


def norm(name, drop_suffix=False):
    s = (name or "").lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    drop = GENERIC | (SUFFIX_OK if drop_suffix else set())
    return " ".join(t for t in s.split() if t and t not in drop)


def main():
    if not SCORECARD.exists():
        sys.exit(f"missing {SCORECARD} — run extract_scorecard.py first")
    sc = list(csv.DictReader(SCORECARD.open(encoding="utf-8")))

    exact = defaultdict(list)
    plain = defaultdict(list)
    loose = defaultdict(list)
    for r in sc:
        exact[(r["name"] or "").strip().lower()].append(r)
        plain[norm(r["name"])].append(r)
        loose[norm(r["name"], drop_suffix=True)].append(r)

    db = sqlite3.connect(DB, uri=True)
    rows = db.execute(
        "SELECT DISTINCT name, division FROM colleges WHERE division IN ('NAIA','NJCAA')"
    ).fetchall()
    db.close()

    matched, unmatched = [], []
    for name, division in sorted(rows):
        hint = state_hint(name)
        bare = strip_qualifier(name)

        def pick(bucket, key):
            cands = bucket.get(key, [])
            if hint:
                # The hint is authoritative, not a preference. Falling back to
                # the unfiltered list when nothing matches the state is how
                # "Lewis & Clark (ID)" reached Lewis & Clark College in
                # Portland OR — our own name said Idaho and the code ignored
                # it because Idaho had no candidate. No candidate in the named
                # state is a failure, not a licence to look elsewhere.
                cands = [c for c in cands if c["state"].upper() == hint]
            return cands

        hit, why = None, ""
        prefix_cands = None
        if name in ALIAS_UNITID:
            want = ALIAS_UNITID[name]
            if not want:
                unmatched.append({"school": name, "division": division,
                                  "reason": "no Scorecard entry (checked by hand)", "candidates": ""})
                continue
            hit = next((r for r in sc if r["unitid"] == want), None)
            why = "hand-verified alias"
            if not hit:
                unmatched.append({"school": name, "division": division,
                                  "reason": f"alias UNITID {want} not in Scorecard", "candidates": ""})
                continue
        for label, bucket, key in ([] if hit else (
            ("exact name", exact, bare.lower()),
            ("normalised name", plain, norm(bare)),
            ("normalised, suffix tolerated", loose, norm(bare, drop_suffix=True)),
        )):
            cands = pick(bucket, key)
            if len(cands) == 1:
                hit, why = cands[0], label + (" + state from our own name" if hint else "")
                break
            if len(cands) > 1:
                why = f"{len(cands)} candidates on {label}"
                break

        if not hit:
            # Leading-token containment: ours is the start of theirs. This
            # cannot promote "Alabama A&M" to "University of Alabama" the way
            # a subset test can, because the extra words are only ever a
            # trailing campus or district.
            mine = norm(bare).split()
            prefix_cands = [
                r for r in sc
                if mine and norm(r["name"]).split()[:len(mine)] == mine
                and (not hint or r["state"].upper() == hint)
            ]
            if len(prefix_cands) == 1:
                hit = prefix_cands[0]
                why = "our name is a prefix of theirs" + (" + state from our own name" if hint else "")
            elif len(prefix_cands) > 1:
                why = f"{len(prefix_cands)} candidates on name prefix"

        if hit:
            matched.append({
                "school": name, "division": division, "unitid": hit["unitid"],
                "scorecard_name": hit["name"], "city": hit["city"], "state": hit["state"],
                "highest_degree": hit["highest_degree"], "match_basis": why,
            })
        else:
            near = sorted(sc, key=lambda r: -len(set(norm(bare).split()) & set(norm(r["name"]).split())))[:3]
            unmatched.append({
                "school": name, "division": division,
                "reason": why or "no name match",
                "candidates": " | ".join(f'{r["name"]} ({r["city"]}, {r["state"]})' for r in near),
            })

    with OUT.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(matched[0].keys())); w.writeheader(); w.writerows(matched)
    with UNMATCHED.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["school", "division", "reason", "candidates"])
        w.writeheader(); w.writerows(unmatched)

    print(f"{len(matched)} of {len(rows)} names matched")
    print(f"{len(unmatched)} unmatched -> {UNMATCHED.name}\n")
    basis = defaultdict(int)
    for m in matched:
        basis[m["match_basis"]] += 1
    for k, v in sorted(basis.items(), key=lambda kv: -kv[1]):
        print(f"  {v:5}  {k}")
    deg = defaultdict(int)
    for m in matched:
        deg[m["highest_degree"]] += 1
    print(f"\n  highest degree of the matched: {dict(sorted(deg.items()))}  (2=associate, 3=bachelor, 4=graduate)")


if __name__ == "__main__":
    main()
