"""Write the {year}_ps column into the canonical files.

Adds four columns per file (2022_ps … 2025_ps) holding a round-reached key that
soccer_score_v6.py already reads. Matching is deliberately strict: an unmatched
tournament team is REPORTED, never guessed onto a similar name, because a misplaced
"champion" label is a far worse error than a missing one.

canonical.save() refuses column drift by design, so this writes the files directly and
records what it did — a schema change is a different kind of edit from a value change.
"""
import csv, json, re, difflib, collections, shutil, sys

FILES = {
    "men":   "/Users/rhysdavies/Documents/Thriv3/Soccer Records/soccer_records.csv",
    "women": "/Users/rhysdavies/Documents/Thriv3/Soccer Records/soccer_records_women.csv",
}
YEARS = [2022, 2023, 2024, 2025]
STOP = {"university", "college", "the", "of", "at", "and", "state"}   # 'state' kept in key, see below

def norm(n):
    n = re.sub(r"\[[^]]*\]", "", str(n))
    n = re.sub(r"\(([^)]*)\)", r" \1 ", n)          # keep the state qualifier as a token
    n = re.sub(r"[–—&]", " ", n)
    n = re.sub(r"\bst\b\.?", "saint", n, flags=re.I)
    toks = re.sub(r"[^a-z0-9 ]", " ", n.lower()).split()
    # 'University' and 'College' are KEPT. Stripping them collapses Colorado / Colorado
    # College and Boston University / Boston College onto one key, and the ambiguity guard
    # then refuses both -- which is how the 2024 women's Colorado run went unmatched.
    return [t for t in toks if t not in ("the", "of", "at", "and")]

def key(n):
    return " ".join(sorted(norm(n)))

# tournament articles use short names; a few need spelling out
# tournament articles use short forms the roster spells out. Keyed on the normalised
# tournament name, valued with a string that normalises to the roster's own name.
ALIAS = {
    "cal baptist": "California Baptist",
    "army west point": "Army",
    "cumberlands ky": "Cumberlands",
    "scad": "Savannah College of Art and Design",
    "point loma": "Point Loma Nazarene",
    "cal lutheran": "Cal Lutheran",
    "william smith": "Hobart and William Smith Colleges",
    "mobile": "University of Mobile",
    "milligan": "Milligan University",
    "wvu tech": "West Virginia University Institute of Technology",
    "washington saint louis": "Washington University in St. Louis",
    "csu pueblo": "Colorado State-Pueblo",
    "grambling": "Grambling State",
    "siu edwardsville": "SIU Edwardsville",
    "minnesota state": "Minnesota State Mankato",
    "seattle u": "Seattle",
    "siu edwardsville": ["SIUE", "SIU Edwardsville"],
    "chicago": ["Chicago", "University of Chicago"],
}

def build_index(rows, division):
    idx = {}
    for r in rows:
        if r["division"] != division:
            continue
        idx.setdefault(key(r["name"]), []).append(r)
    return idx

def state_of(n):
    m = re.search(r"\(([A-Za-z .]{2,20})\)", str(n))
    if not m:
        return None
    v = re.sub(r"[^A-Za-z]", "", m.group(1)).upper()
    return v if len(v) == 2 else None

def resolve(team, rows_by_div, division):
    """Match a tournament team onto one roster row, or refuse.

    SUBSET matching with fewest extra tokens, because the two vocabularies differ in
    both directions: the tournament articles write short forms the roster spells out
    ("Keiser" vs "Keiser University"), while the roster sometimes carries the shorter
    name ("Colorado" alongside "Colorado College"). Requiring the tournament's tokens to
    be contained in the roster name, then preferring the candidate with the fewest extra
    words, settles both -- "Colorado" takes Colorado over Colorado College, and "Keiser"
    still reaches Keiser University.

    A state qualifier present on both sides must agree, which keeps Marian (IN) off
    Marian (WI). Ties are refused: a misplaced "champion" is worse than a missing one.
    """
    idx = rows_by_div[division]
    nt = " ".join(norm(team))
    alias = ALIAS.get(nt) or ALIAS.get(" ".join(sorted(norm(team))))
    tries = (alias if isinstance(alias, list) else [alias]) if alias else []
    tries.append(team)
    for src in tries:
        hit = _try(src, team, idx)
        if hit is not None:
            return hit
    return None

def _try(src, team, idx):
    want = set(norm(src))
    st = state_of(src) or state_of(team)
    if not want:
        return None
    cands = []
    for k, rows in idx.items():
        for r in rows:
            have = set(norm(r["name"]))
            if not want <= have:
                continue
            rs = state_of(r["name"])
            if st and rs and st != rs:
                continue
            # count EVERY extra word, including University/College. Excluding them made
            # "Colorado College" tie with "Colorado" at zero extras, and the tie-refusal
            # then dropped a real tournament run.
            extras = len(have - want)
            cands.append((extras, r))
    if not cands:
        return None
    cands.sort(key=lambda x: x[0])
    if len(cands) > 1 and cands[0][0] == cands[1][0]:
        return None                     # genuinely ambiguous
    return cands[0][1]

def main(apply=False):
    ps = json.load(open("postseason.json"))
    for sex, path in FILES.items():
        rows = list(csv.DictReader(open(path, newline="", encoding="utf-8")))
        fields = list(rows[0].keys())
        divisions = sorted({r["division"] for r in rows})
        by_div = {d: build_index(rows, d) for d in divisions}
        for r in rows:
            for y in YEARS:
                r.setdefault(f"{y}_ps", "")
                r[f"{y}_ps"] = r.get(f"{y}_ps") or ""
        filled = collections.Counter()
        unmatched = []
        for k, teams in ps.items():
            s, div, y = k.split("|")
            if s != sex or div not in by_div:
                continue
            for team, label in teams.items():
                if re.match(r"^\d+(st|nd|rd|th)$", team.strip(), re.I):
                    continue          # an ordinal from the bid table's Appearance column
                row = resolve(team, by_div, div)
                if row is None:
                    unmatched.append((div, y, team, label))
                    continue
                row[f"{y}_ps"] = label
                filled[label] += 1
        newfields = fields[:]
        for y in YEARS:
            if f"{y}_ps" not in newfields:
                newfields.append(f"{y}_ps")
        print(f"{sex}: filled {sum(filled.values())} cells {dict(filled)}")
        print(f"   unmatched tournament teams: {len(unmatched)}")
        for u in unmatched[:14]:
            print(f"      {u[0]:5} {u[1]} {u[2][:30]:30} ({u[3]})")
        if apply:
            shutil.copy2(path, path.replace(".csv", ".pre_ps.csv"))
            with open(path, "w", newline="", encoding="utf-8") as f:
                w = csv.DictWriter(f, fieldnames=newfields, extrasaction="ignore")
                w.writeheader()
                w.writerows(rows)
            print(f"   wrote {path} (+{len(newfields)-len(fields)} columns; "
                  f"backup .pre_ps.csv)")
        print()

if __name__ == "__main__":
    main("--apply" in sys.argv)
