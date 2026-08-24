"""Check each resolved Wikipedia article against the school's KNOWN web domain.

The batched population resolves a school name to an article by title. For 610 of 818 names
that title came from Wikipedia's own redirect, but 208 came from titles the script
CONSTRUCTED ("<name> University", "<name> College") -- and a short athletics name plus a
guessed suffix is exactly how you land on a different institution whose name merely
contains yours. Eyeballing caught "Amherst" resolving to University of Massachusetts
Amherst (Minutemen) when our Amherst is Amherst College (Mammoths), and "Army" resolving to
Army University rather than West Point. Eyeballing does not scale to 818.

The evidence used here is independent of Wikipedia: the coaching-contact CSVs give every
school's athletics host and its coaches' email domain, and athletics_domains.json adds
more -- 1550 schools. The article's own infobox `website` has to agree with one of them.
Amherst College publishes amherst.edu and UMass publishes umass.edu, so the wrong match
cannot survive the comparison.

The website value comes from populateSchoolIdentity.js's own parseInfobox, NOT from a
regex over the page. A regex for "|website=" reads the `website` parameter of every
{{cite web}} citation in the article too, which produced a first run where East Carolina,
Kansas State and Illinois State all appeared to publish iu.edu -- 135 mismatches that were
almost entirely false. parseInfobox strips citations before parsing, which is the whole
reason to reuse it rather than re-derive it.

Verdicts:
  match      article website shares a registrable domain with something we already knew
  mismatch   both known -- and they disagree. The mapping is rejected, not written.
  unknown    we hold no domain for this school, or the article states no website.
"""
import csv, json, re, sys

BASE = "/Users/rhysdavies/Documents/Recruitmatch/individualisation"
TWO_LEVEL = {"ac.uk", "edu.au", "co.uk", "com.au", "edu.ph"}
# hosts that are a REGISTRAR of many schools' sites rather than one school's identity
GENERIC = {"sidearmsports.com", "prestosports.com", "wordpress.com", "wixsite.com",
           "archive.org", "gmail.com", "facebook.com", "twitter.com", "x.com"}


def registrable(host):
    h = re.sub(r"^https?://", "", str(host or "").strip().lower()).split("/")[0]
    h = h.split("?")[0].split(":")[0]
    h = re.sub(r"^www\d?\.", "", h)
    parts = [p for p in h.split(".") if p]
    if len(parts) < 2:
        return None
    if ".".join(parts[-2:]) in TWO_LEVEL and len(parts) >= 3:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


URL_IN = re.compile(r"(?:https?://)?(?:www\d?\.)?([a-z0-9][a-z0-9.-]*\.[a-z]{2,})", re.I)


def domains_in(value):
    out = []
    for m in URL_IN.finditer(str(value or "")):
        d = registrable(m.group(1))
        if d and d not in GENERIC:
            out.append(d)
    return list(dict.fromkeys(out))


def core(name):
    """The school's distinctive tokens, for the fallback name check."""
    n = re.sub(r"\(([^)]*)\)", r" \1 ", str(name))
    n = re.sub(r"\bst\b\.?", "saint", n, flags=re.I)
    toks = re.sub(r"[^a-z0-9 ]", " ", n.lower()).split()
    drop = {"the", "of", "at", "and", "university", "college", "institute", "school"}
    return {t for t in toks if t not in drop}


def main():
    known = {k: {d for x in v for d in domains_in(x)}
             for k, v in json.load(open(f"{BASE}/known_domains.json")).items()}
    rows = list(csv.DictReader(open(f"{BASE}/identity_mappings.csv")))

    out, tally = [], {"match": 0, "mismatch": 0, "unknown_school": 0, "unknown_article": 0}
    for r in rows:
        arts = domains_in(r.get("article_website"))
        mine = known.get(r["school"], set())
        if not mine:
            v = "unknown_school"
        elif not arts:
            v = "unknown_article"
        elif mine & set(arts):
            v = "match"
        else:
            v = "mismatch"
        tally[v] += 1
        out.append({**r, "article_domains": arts, "known_domains": sorted(mine), "verdict": v})

    json.dump(out, open(f"{BASE}/mapping_verdicts.json", "w"), indent=1)
    print(json.dumps(tally, indent=None))

    bad = [o for o in out if o["verdict"] == "mismatch"]
    print(f"\n--- {len(bad)} MISMATCHES: article is a different institution ---")
    for o in sorted(bad, key=lambda x: (x["round"], x["school"])):
        print(f"  r{o['round']} {o['school'][:26]:26} -> {o['resolved_title'][:36]:36} "
              f"nick={(o['nickname'] or '-')[:18]:18} "
              f"article={o['article_domains'][:2]} ours={o['known_domains'][:2]}")

    # A constructed title we cannot corroborate is the risky combination: no domain either
    # side, AND the article title carries tokens our school name never had.
    risky = [o for o in out
             if o["verdict"].startswith("unknown") and o["round"] != "1"
             and (core(o["resolved_title"]) - core(o["school"]))]
    print(f"\n--- {len(risky)} UNCORROBORATED constructed titles (round>1, no domain check possible) ---")
    for o in risky[:40]:
        extra = sorted(core(o["resolved_title"]) - core(o["school"]))
        print(f"  r{o['round']} {o['school'][:24]:24} -> {o['resolved_title'][:34]:34} "
              f"nick={(o['nickname'] or '-')[:16]:16} extra_tokens={extra[:4]}")


if __name__ == "__main__":
    main()
