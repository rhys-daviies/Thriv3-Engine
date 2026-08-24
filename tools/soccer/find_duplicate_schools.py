"""Find the same university sitting in `colleges` twice under two different names.

Surfaced while repairing identity: "Washington (MO)" and "Washington University in St Louis"
are one school, as are Park/Park University, Xavier (LA)/Xavier University of Louisiana,
Centenary (LA)/Centenary College of Louisiana, Westminster (PA)/Westminster College (PA) and
Lewis & Clark/Lewis & Clark College. That matters for outreach in two ways: a fix applied by
name reaches only one of the pair, and a duplicate can be emailed twice.

Matching is deliberately conservative, because the cost of a false pair is merging two real
schools. A pair is only reported when the names are compatible AND independent evidence
agrees they are one institution:

  suffix      one name is the other plus a generic word ("Park" / "Park University"), or a
              parenthesised state matches a spelled-out one ("Xavier (LA)" / "Xavier
              University of Louisiana")
  and then at least one of:
  domain      they share an athletics or academic domain
  division    same division AND same conference

"Boston College" vs "Boston University" fails the suffix test outright -- neither name
contains the other -- which is the case that makes a blanket strip-the-suffix rule unusable.
"""
import csv, json, re, sys, collections, itertools

BASE = "/Users/rhysdavies/Documents/Recruitmatch/individualisation"
GENERIC = {"university", "college", "the", "of", "at", "and", "institute", "school",
           "universities", "campus"}
STATE = {
    "al": "alabama", "ak": "alaska", "az": "arizona", "ar": "arkansas", "ca": "california",
    "co": "colorado", "ct": "connecticut", "de": "delaware", "fl": "florida", "ga": "georgia",
    "hi": "hawaii", "id": "idaho", "il": "illinois", "in": "indiana", "ia": "iowa",
    "ks": "kansas", "ky": "kentucky", "la": "louisiana", "me": "maine", "md": "maryland",
    "ma": "massachusetts", "mi": "michigan", "mn": "minnesota", "ms": "mississippi",
    "mo": "missouri", "mt": "montana", "ne": "nebraska", "nv": "nevada", "nh": "hampshire",
    "nj": "jersey", "nm": "mexico", "ny": "york", "nc": "carolina", "nd": "dakota",
    "oh": "ohio", "ok": "oklahoma", "or": "oregon", "pa": "pennsylvania", "ri": "island",
    "sc": "carolina", "sd": "dakota", "tn": "tennessee", "tx": "texas", "ut": "utah",
    "vt": "vermont", "va": "virginia", "wa": "washington", "wv": "virginia",
    "wi": "wisconsin", "wy": "wyoming",
}


def toks(name):
    n = str(name)
    # expand a parenthesised state code, which is how our own names disambiguate
    n = re.sub(r"\(([A-Za-z]{2})\)", lambda m: STATE.get(m.group(1).lower(), m.group(1)), n)
    n = re.sub(r"\bst\b\.?", "saint", n, flags=re.I)
    n = re.sub(r"[^a-z0-9 ]", " ", n.lower())
    return [t for t in n.split() if t]


def core(name):
    return {t for t in toks(name) if t not in GENERIC}


def suffix_compatible(a, b):
    ca, cb = core(a), core(b)
    if not ca or not cb:
        return None
    if ca == cb:
        return "same core tokens"
    if ca < cb or cb < ca:
        extra = (cb - ca) if ca < cb else (ca - cb)
        # the extra tokens must be a state or a place-ish qualifier, not a different school
        if extra <= set(STATE.values()):
            return f"one adds a state ({', '.join(sorted(extra))})"
        return None
    return None


def registrable(h):
    h = re.sub(r"^https?://", "", str(h or "").lower()).split("/")[0]
    h = re.sub(r"^www\d?\.", "", h)
    p = [x for x in h.split(".") if x]
    return ".".join(p[-2:]) if len(p) >= 2 else None


def main():
    rows = list(csv.DictReader(open(f"{BASE}/db_full.csv", newline="")))
    known = json.load(open(f"{BASE}/known_domains.json"))
    dom = {k: {registrable(x) for x in v if registrable(x)} for k, v in known.items()}

    by_sport = collections.defaultdict(list)
    for r in rows:
        by_sport[r["sport"]].append(r)

    pairs = []
    for sport, rs in by_sport.items():
        buckets = collections.defaultdict(list)
        for r in rs:
            for t in core(r["name"]):
                buckets[t].append(r)
        seen = set()
        for t, group in buckets.items():
            for a, b in itertools.combinations(group, 2):
                pk = tuple(sorted([a["name"], b["name"]])) + (sport,)
                if pk in seen:
                    continue
                seen.add(pk)
                why = suffix_compatible(a["name"], b["name"])
                if not why:
                    continue
                shared = dom.get(a["name"], set()) & dom.get(b["name"], set())
                same_div = a["division"] == b["division"]
                same_conf = (a["conference"] or "?") == (b["conference"] or "?")
                if shared:
                    ev = f"shares domain {sorted(shared)[0]}"
                elif same_div and same_conf and a["conference"]:
                    ev = f"same division+conference ({a['division']}, {a['conference']})"
                elif same_div:
                    ev = f"same division ({a['division']}), conferences differ"
                else:
                    continue
                pairs.append({"sport": sport, "a": a, "b": b, "why": why, "evidence": ev,
                              "confident": bool(shared) or (same_div and same_conf and bool(a["conference"]))})

    conf = [p for p in pairs if p["confident"]]
    weak = [p for p in pairs if not p["confident"]]
    print(f"{len(conf)} confident duplicate pairs, {len(weak)} weaker candidates\n")

    def fields(r):
        filled = sum(1 for k in ("nickname", "mascot", "primary_color", "logo_url",
                                 "conference_champion_name", "soccer_score") if (r.get(k) or "").strip())
        return filled

    print("--- CONFIDENT ---")
    for p in sorted(conf, key=lambda x: x["a"]["name"]):
        a, b = p["a"], p["b"]
        print(f"  [{p['sport'][:5]}] {a['name'][:30]:30} (fields {fields(a)}, nick={a['nickname'][:14]!r:16}) "
              f"<=> {b['name'][:30]:30} (fields {fields(b)}, nick={b['nickname'][:14]!r:16})")
        print(f"           {p['why']}; {p['evidence']}")
    if weak:
        print("\n--- WEAKER (division only) ---")
        for p in sorted(weak, key=lambda x: x["a"]["name"])[:20]:
            print(f"  [{p['sport'][:5]}] {p['a']['name'][:28]:28} <=> {p['b']['name'][:28]:28}  {p['evidence']}")
    json.dump([{**{k: v for k, v in p.items() if k not in ('a', 'b')},
                "a": p["a"]["name"], "b": p["b"]["name"],
                "a_id": p["a"]["id"], "b_id": p["b"]["id"]} for p in pairs],
              open(f"{BASE}/duplicate_pairs.json", "w"), indent=1)


if __name__ == "__main__":
    main()
