"""Check each stored nickname against the school's OWN athletics domain. Offline.

WHY NOT THE WEBSITE COMPARISON. The first verification compared the Wikipedia article's
infobox `website` against domains we hold. It barely works: 1597 of 2167 articles state no
website at all, and most of the 31 "mismatches" were false, because the article publishes
the ACADEMIC domain while we hold the ATHLETICS one -- fontbonne.edu vs
fontbonnegriffins.com is the same school, not a contradiction.

THE BETTER SIGNAL. College athletics domains are usually built out of the nickname itself:
hlgtrojans.com, fontbonnegriffins.com, oterorattlers.com, ntcceagles.com, pimaaztecs.com,
dsubluehawks.com. That makes the domain an independent witness to the exact field that
matters for outreach -- and it is data we already hold, so this check costs no requests.

It is also self-diagnosing. LaGrange had been given Hannibal-LaGrange's "Trojans", and its
domain is lagrangepanthers.com: the check both rejects Trojans AND names Panthers.

Verdicts:
  confirms      a word of the stored nickname appears in the domain
  contradicts   the domain carries a DIFFERENT nickname-shaped word and none of ours
  silent        the domain is generic (govikings.com, athletics.x.edu) -- no evidence
"""
import csv, json, re, sys, collections

BASE = "/Users/rhysdavies/Documents/Recruitmatch/individualisation"

# words that appear in athletics hostnames but never name a team
CHROME = {"go", "sports", "sport", "athletics", "athletic", "official", "the", "com", "net",
          "org", "edu", "www", "gov", "us", "site", "team", "teams", "club", "online",
          "college", "university", "univ", "state", "community", "junior", "tech", "cc",
          "archive", "gmail", "google", "wordpress", "sidearmsports", "prestosports"}


def host_tokens(host):
    h = re.sub(r"^https?://", "", str(host or "").lower()).split("/")[0]
    h = re.sub(r"^www\d?\.", "", h)
    parts = re.split(r"[.\-_]", h)
    return [p for p in parts if p and not p.isdigit()]


def words_of(text):
    return [w for w in re.sub(r"[^a-z ]", " ", str(text or "").lower()).split() if len(w) > 2]


def school_fragments(name):
    """Tokens and plausible abbreviations of the school name, to subtract from a hostname."""
    toks = words_of(name) + [w for w in re.sub(r"[^a-z ]", " ", name.lower()).split()]
    frags = set(t for t in toks if t)
    initials = "".join(w[0] for w in re.sub(r"[^A-Za-z ]", " ", name).split() if w)
    if len(initials) >= 2:
        frags.add(initials.lower())
    for n in (2, 3, 4, 5):
        for w in toks:
            if len(w) > n:
                frags.add(w[:n])
    return frags


def leftover(host, school):
    """What a hostname says once the school's own name and site-chrome are removed."""
    frags = school_fragments(school)
    out = []
    for tok in host_tokens(host):
        if tok in CHROME:
            continue
        t = tok
        # peel school fragments off the front and back ("hlgtrojans" -> "trojans")
        changed = True
        while changed and len(t) > 3:
            changed = False
            for f in sorted(frags, key=len, reverse=True):
                if len(f) < 2:
                    continue
                if t.startswith(f) and len(t) - len(f) >= 4:
                    t = t[len(f):]; changed = True; break
                if t.endswith(f) and len(t) - len(f) >= 4:
                    t = t[:-len(f)]; changed = True; break
        for c in CHROME:
            if t.startswith(c) and len(t) - len(c) >= 4:
                t = t[len(c):]
            if t.endswith(c) and len(t) - len(c) >= 4:
                t = t[:-len(c)]
        if len(t) >= 4 and t not in CHROME and t not in frags:
            out.append(t)
    return out


def build_vocab(rows):
    """Nickname words as they occur across the whole table.

    Needed to tell a real contradiction from noise. A leftover hostname token is only
    evidence of a DIFFERENT team name if it is a team name at all: "friars", "leopards" and
    "toreros" are, while "deacs", "terps", "cuse" and "mgoblue" are the same school
    abbreviated, and "ports" is this script's own peeling eating the word "sports". The
    table's own 1200+ nicknames are a ready-made vocabulary of what a team name looks
    like.
    """
    v = collections.Counter()
    for r in rows:
        for w in words_of(r["nickname"]):
            v[w] += 1
    return {w for w, n in v.items() if len(w) >= 4}


def confirmed_by(nick, joined, lefts=()):
    """Does the host corroborate this nickname, allowing for clipped forms?

    Athletics hosts abbreviate constantly -- gocards.com for the Cardinals, godeacs for the
    Demon Deacons, smcgaels for the Gaels. A strict substring test calls all of those
    contradictions, so a nickname word also counts as present when the host carries its
    first five (or four) characters.
    """
    for w in words_of(nick):
        if w in joined:
            return True
        for n in (6, 5, 4):
            if len(w) >= n and w[:n] in joined:
                return True
        # the host may carry the TAIL of a compound name instead of its head --
        # gopack.com for the Wolfpack, godogs for the Bulldogs, goyotes for the Coyotes,
        # gojackets for the Yellowjackets. A leftover contained in our own nickname is the
        # same name clipped, not a different one.
        for x in lefts:
            if len(x) >= 4 and (x in w or w in x):
                return True
            # Consonant-clipped forms: godbucs for the Buccaneers, gomacs for the Maccabees.
            # These are not substrings of the full word, so the containment test above misses
            # them. Compare stems with the plural 's' removed and accept a prefix relation --
            # "buc" prefixes "buccaneer", "mac" prefixes "maccabee". Deliberately NOT enough
            # to make "cardinal" and "ram" agree, or "friar" and "argonaut", which is what
            # keeps the genuinely contradicting hosts flagged.
            a, b = x.rstrip('s'), w.rstrip('s')
            if len(x) >= 4 and len(a) >= 3 and len(b) >= 3 and (b.startswith(a) or a.startswith(b)):
                return True
    return False


def main():
    known = json.load(open(f"{BASE}/known_domains.json"))
    rows = list(csv.DictReader(open(f"{BASE}/db_identity.csv", newline=""),
                fieldnames=["name", "sport", "division", "nickname", "mascot",
                            "primary_color", "secondary_color", "logo_url", "identity_source"]))
    global VOCAB
    VOCAB = build_vocab(rows)
    print(f"nickname vocabulary: {len(VOCAB)} words")
    tally = collections.Counter()
    results = []
    for r in rows:
        nick = r["nickname"]
        if not nick:
            continue
        hosts = known.get(r["name"], [])
        # only athletics-style hosts carry a nickname; skip .edu academic hosts
        hosts = [h for h in hosts if not re.search(r"\.edu$", h.split("/")[0])]
        if not hosts:
            tally["no_athletics_host"] += 1
            continue
        lefts = []
        for h in hosts:
            lefts += leftover(h, r["name"])
        # keep only leftovers that are actually team names somewhere in the table, and are
        # not chrome residue
        lefts = [x for x in dict.fromkeys(lefts)
                 if x in VOCAB and not re.search(r"athletic|sport|ports$", x)]
        joined = " ".join(host_tokens(" ".join(hosts)))
        if confirmed_by(nick, joined, lefts):
            v = "confirms"
        elif lefts:
            v = "contradicts"
        else:
            v = "silent"
        tally[v] += 1
        results.append({**r, "hosts": hosts, "domain_says": lefts, "verdict": v})

    json.dump(results, open(f"{BASE}/nickname_domain_check.json", "w"), indent=1)
    print(dict(tally))
    bad = [x for x in results if x["verdict"] == "contradicts"]
    seen, uniq = set(), []
    for b in bad:
        if b["name"] in seen:
            continue
        seen.add(b["name"]); uniq.append(b)
    print(f"\n--- {len(bad)} rows contradicted ({len(uniq)} schools); first 45 ---")
    for b in uniq[:45]:
        print(f"  {b['division']:8} {b['name'][:24]:24} stored={b['nickname'][:20]:20} "
              f"domain_says={b['domain_says'][:3]}  ({b['identity_source'][10:][:30]})")


if __name__ == "__main__":
    main()
