"""Resolve men's/women's nickname splits from Wikipedia's ATHLETICS article.

The university infobox lists a school's nicknames without saying which team uses which,
which is why seven schools came out of the resolver unresolved -- "Bears & Sugar Bears"
gives no clue which is the women's name, and taking the first would put a men's name on a
women's team.

The athletics article settles it by convention: where a school names its teams separately,
the article is titled "<School> <men's name> and <women's name>" -- "Central Arkansas Bears
and Sugar Bears", "Kentucky State Thorobreds and Thorobrettes". Men's first, women's
second. The lead sentence usually spells the same thing out longhand, so it is used as a
second, independent confirmation rather than trusting the title alone.

Anything where title and lead disagree, or where neither names both teams, is reported
unresolved for a human. These strings go into live outreach.
"""
import re, json, sys, time
import requests

API = "https://en.wikipedia.org/w/api.php"
HDR = {"User-Agent": "RecruitmatchIdentityCheck/1.0 (contact: rhys.davies@cardaxia.ai)"}


def api(params, attempt=1):
    p = {"format": "json", **params}
    r = requests.get(API, params=p, headers=HDR, timeout=30)
    if r.status_code in (429,) or r.status_code >= 500:
        if attempt > 6:
            raise RuntimeError(f"HTTP {r.status_code}")
        time.sleep(min(60, 3 * 2 ** attempt))
        return api(params, attempt + 1)
    r.raise_for_status()
    return r.json()


def search(q, n=6):
    d = api({"action": "query", "list": "search", "srsearch": q, "srlimit": str(n)})
    return [h["title"] for h in d["query"]["search"]]


def lead(title):
    d = api({"action": "query", "prop": "extracts", "exintro": "1",
             "explaintext": "1", "titles": title})
    pg = list(d["query"]["pages"].values())[0]
    return pg.get("extract") or ""


def from_title(title, school_tokens):
    """('Bears', 'Sugar Bears') out of 'Central Arkansas Bears and Sugar Bears'."""
    if " and " not in title:
        return None
    head, tail = title.rsplit(" and ", 1)
    words = head.split()
    # drop the leading school-name words
    while words and words[0].lower().strip(".,") in school_tokens:
        words.pop(0)
    mens = " ".join(words).strip()
    womens = tail.strip()
    if not mens or not womens:
        return None
    return mens, womens


LEAD_PAT = [
    re.compile(r"men'?s?\s+teams?\s+(?:are\s+)?(?:known\s+as|called|nicknamed)\s+(?:the\s+)?"
               r"([A-Z][\w' ]{2,28}?)[,.;]?\s+(?:and|while)\s+(?:the\s+)?women'?s?\s+"
               r"(?:teams?\s+)?(?:are\s+)?(?:known\s+as|called|nicknamed)?\s*(?:the\s+)?"
               r"([A-Z][\w' ]{2,28})", re.I),
    re.compile(r"nicknamed\s+the\s+([A-Z][\w' ]{2,28}?)\s+\(men'?s?\)\s+and\s+the\s+"
               r"([A-Z][\w' ]{2,28}?)\s+\(women'?s?\)", re.I),
]


def from_lead(text):
    for p in LEAD_PAT:
        m = p.search(text)
        if m:
            return m.group(1).strip(" .,"), m.group(2).strip(" .,")
    return None


def resolve(school, hint_names):
    toks = {w.lower().strip(".,()") for w in re.sub(r"[()]", " ", school).split()}
    toks |= {"university", "college", "the", "of", "state", "saint", "st"}
    queries = [f"{school} {' and '.join(hint_names)} athletics",
               f"{school} athletics",
               f"{school} {hint_names[0]}"]
    seen = []
    for q in queries:
        try:
            hits = search(q)
        except Exception as e:
            return {"school": school, "verdict": None, "note": f"search failed: {e}"}
        for t in hits:
            if t in seen:
                continue
            seen.append(t)
            pair = from_title(t, toks)
            if not pair:
                continue
            # both halves must be nicknames we actually saw in the infobox
            low = [h.lower() for h in hint_names]
            if pair[0].lower() not in low or pair[1].lower() not in low:
                continue
            try:
                lp = from_lead(lead(t))
            except Exception:
                lp = None
            agree = lp and lp[0].lower() == pair[0].lower() and lp[1].lower() == pair[1].lower()
            return {"school": school, "article": t, "mens": pair[0], "womens": pair[1],
                    "verdict": "confirmed" if agree else "title-only",
                    "lead_pair": lp, "note": "title convention: men's first, women's second"}
    return {"school": school, "verdict": None,
            "note": f"no athletics article naming both of {hint_names}; titles seen: {seen[:5]}"}


CASES = {
    "Central Arkansas": ["Bears", "Sugar Bears"],
    "Kentucky State": ["Thorobreds", "Thorobrettes"],
    "Xavier (LA)": ["Gold Rush", "Gold Nuggets"],
    "Xavier University of Louisiana": ["Gold Rush", "Gold Nuggets"],
}

if __name__ == "__main__":
    out = []
    for school, hints in CASES.items():
        r = resolve(school, hints)
        out.append(r)
        v = r.get("verdict")
        print(f"{school:20} {str(v):12} "
              f"men={r.get('mens')!r} women={r.get('womens')!r}  {r.get('article') or r.get('note','')[:70]}")
        time.sleep(1.0)
    json.dump(out, open("split_name_verdicts.json", "w"), indent=1)
