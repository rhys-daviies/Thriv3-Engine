"""Compare men's and women's identity for the SAME university.

The brief: the two should generally agree, because identity is a property of the
institution -- but always double-check, because a real subset of schools name their
women's teams differently, and those differences must survive rather than be flattened.

So this reports three things, and treats only the third as a defect:
  agree      same value on both rows
  known-split  they differ, and the difference is one this pipeline deliberately made
               (Kingsmen/Regals, Yeomen/Yeowomen, Statesmen/Lady Statesmen, Bears/Sugar
               Bears) -- correct, and listed so it can be eyeballed
  DISAGREE   they differ for no reason the pipeline can account for, which means one of
             the two rows resolved to a different institution
"""
import csv, json, re, sys, collections

BASE = "/Users/rhysdavies/Documents/Recruitmatch/individualisation"


def norm(n):
    n = re.sub(r"\(([^)]*)\)", r" \1 ", str(n))
    n = re.sub(r"\bst\b\.?", "saint", n, flags=re.I)
    toks = re.sub(r"[^a-z0-9 ]", " ", n.lower()).split()
    return [t for t in toks if t not in ("the", "of", "at", "and")]


def key(n):
    return " ".join(sorted(norm(n)))


DECOR = re.compile(r"^(the\s+)?(lady|ladies|runnin'?|fightin'?|flying|sugar)\s+", re.I)
FEM = re.compile(r"women|lassies|queens|skylights|wahine|wāhine|ettes$|belles|regals|herons", re.I)
MASC = re.compile(r"men$|boys$|lords$|gentlemen$|brothers$|breds$", re.I)


def explains(m, w):
    """Is the men's/women's difference one the pipeline made on purpose?"""
    if not m or not w:
        return "one side blank"
    ml, wl = m.lower(), w.lower()
    if DECOR.search(w) and DECOR.sub("", wl).strip() in ml:
        return "women's decorated form of the men's name"
    if FEM.search(w) or MASC.search(m):
        return "gendered pair"
    return None


def main():
    rows = list(csv.DictReader(open(f"{BASE}/db_identity_current.csv", newline=""),
                fieldnames=["name", "sport", "division", "nickname", "mascot",
                            "primary_color", "logo_url", "identity_source"]))
    by = collections.defaultdict(dict)
    for r in rows:
        by[key(r["name"])][r["sport"]] = r

    tally = collections.Counter()
    splits, bad = [], []
    for k, d in by.items():
        m, w = d.get("mens-soccer"), d.get("womens-soccer")
        if not m or not w:
            tally["one sport only"] += 1
            continue
        for field in ("nickname", "mascot", "primary_color"):
            mv, wv = (m[field] or "").strip(), (w[field] or "").strip()
            if mv == wv:
                tally[f"{field} agree"] += 1
                continue
            if not mv or not wv:
                tally[f"{field} one side blank"] += 1
                continue
            if field == "nickname":
                why = explains(mv, wv)
                if why:
                    tally["nickname known-split"] += 1
                    splits.append((m["name"], w["name"], mv, wv, why))
                    continue
            tally[f"{field} DISAGREE"] += 1
            bad.append((field, m["name"], w["name"], mv, wv))

    print(json.dumps(dict(sorted(tally.items())), indent=1))
    print(f"\n--- {len(splits)} deliberate men's/women's splits ---")
    for a, b, mv, wv, why in sorted(splits):
        print(f"  {a[:24]:24} M={mv[:18]:18} W={wv[:18]:18} ({why})")
    print(f"\n--- {len(bad)} unexplained disagreements ---")
    for f, a, b, mv, wv in sorted(bad)[:40]:
        print(f"  {f:14} {a[:24]:24} M={mv[:20]:20} | {b[:24]:24} W={wv[:20]:20}")


if __name__ == "__main__":
    main()
