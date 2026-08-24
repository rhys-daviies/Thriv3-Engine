"""Pair the same institution ACROSS the two sports even when the files spell it differently.

The men's and women's source files use different naming conventions for the same school --
"Franklin" / "Franklin College", "LaGrange" / "LaGrange College", "Centenary (LA)" /
"Centenary College of Louisiana", "Washington (MO)" / "Washington University in St Louis".
Two consequences, both real:

  * cross_sport_check.py, which pairs on the exact normalised name, could only compare 417
    of ~1200 schools -- everything spelled differently went unchecked;
  * repair_identity.js matched rows by `name`, so a repair reached one sport's row and left
    the counterpart untouched. That is how "Franklin College" (women's) kept Franklin &
    Marshall's "Diplomats" after "Franklin" (men's) was corrected to "Grizzlies".

Pairing here is looser than the identity-borrowing rule elsewhere in this project, and that
is deliberate: the output is a REVIEW LIST, not a write. A false pair costs a line to read.
It is emphatically NOT safe to merge on -- "Pacific" (University of the Pacific, Tigers) and
"Pacific University" (Oregon, Boxers) reduce to the same core token and are different
schools, which is exactly why the borrow rule elsewhere demands exact equality.
"""
import csv, json, re, collections

BASE = "/Users/rhysdavies/Documents/Recruitmatch/individualisation"
GENERIC = {"university", "college", "the", "of", "at", "and", "institute", "school", "univ"}
STATE = {"al": "alabama", "ak": "alaska", "az": "arizona", "ar": "arkansas", "ca": "california",
         "co": "colorado", "ct": "connecticut", "de": "delaware", "fl": "florida", "ga": "georgia",
         "hi": "hawaii", "id": "idaho", "il": "illinois", "in": "indiana", "ia": "iowa",
         "ks": "kansas", "ky": "kentucky", "la": "louisiana", "me": "maine", "md": "maryland",
         "ma": "massachusetts", "mi": "michigan", "mn": "minnesota", "ms": "mississippi",
         "mo": "missouri", "mt": "montana", "ne": "nebraska", "nv": "nevada", "nh": "hampshire",
         "nj": "jersey", "nm": "mexico", "ny": "york", "nc": "carolina", "nd": "dakota",
         "oh": "ohio", "ok": "oklahoma", "or": "oregon", "pa": "pennsylvania", "ri": "island",
         "sc": "carolina", "sd": "dakota", "tn": "tennessee", "tx": "texas", "ut": "utah",
         "vt": "vermont", "va": "virginia", "wa": "washington", "wv": "virginia",
         "wi": "wisconsin", "wy": "wyoming"}


def core(name):
    n = re.sub(r"\(([A-Za-z]{2})\)", lambda m: STATE.get(m.group(1).lower(), m.group(1)), str(name))
    n = re.sub(r"\bst\b\.?", "saint", n, flags=re.I)
    toks = re.sub(r"[^a-z0-9 ]", " ", n.lower()).split()
    return frozenset(t for t in toks if t not in GENERIC)


def main():
    rows = list(csv.DictReader(open(f"{BASE}/db_full.csv", newline="")))
    men = {}
    women = {}
    for r in rows:
        (men if r["sport"] == "mens-soccer" else women)[r["name"]] = r
    mby, wby = collections.defaultdict(list), collections.defaultdict(list)
    for n, r in men.items():
        mby[core(n)].append(r)
    for n, r in women.items():
        wby[core(n)].append(r)

    agree = disagree = blank = 0
    issues = []
    for k, ms in mby.items():
        ws = wby.get(k)
        if not ws or len(ms) != 1 or len(ws) != 1:
            continue
        m, w = ms[0], ws[0]
        if m["name"] == w["name"]:
            continue                     # already covered by the exact-name check
        mv, wv = (m["nickname"] or "").strip(), (w["nickname"] or "").strip()
        if not mv or not wv:
            blank += 1
            issues.append(("one side blank", m, w, mv, wv))
            continue
        if mv.lower() == wv.lower():
            agree += 1
            continue
        disagree += 1
        issues.append(("differs", m, w, mv, wv))

    print(f"paired across sports on core name: {agree} agree, {disagree} differ, {blank} one side blank\n")
    for kind, m, w, mv, wv in sorted(issues, key=lambda x: (x[0], x[1]["name"])):
        print(f"  [{kind:14}] {m['name'][:26]:26} M={mv[:18]:18} | {w['name'][:30]:30} W={wv[:18]:18}")
        print(f"                   M src={m['identity_source'][:46]:46}")
        print(f"                   W src={w['identity_source'][:46]}")
    json.dump([{ "kind": k, "men": m["name"], "women": w["name"], "m_nick": mv, "w_nick": wv,
                 "m_src": m["identity_source"], "w_src": w["identity_source"],
                 "m_id": m["id"], "w_id": w["id"] }
               for k, m, w, mv, wv in issues],
              open(f"{BASE}/cross_sport_name_issues.json", "w"), indent=1)


if __name__ == "__main__":
    main()
