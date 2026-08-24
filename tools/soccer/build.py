"""Build one individualisation CSV per sport.

ONE ROW PER UNIVERSITY-SPORT, holding everything the product uses to individualise a
school -- identity, achievement, program strength, staff, roster pointers -- and nothing
that is an individual player statistic. Those stay in the roster/graduating tables; only
the school-level AGGREGATE (how many seniors graduate) crosses over.

SOURCES, joined on school name because no single id spans them:

  1. Soccer Records CSV      the spine: school_id, division, conference, conf_tier,
                             W/L/D 2022-25, {year}_ps. Its `conference` is AUTHORITATIVE
                             -- it is the column the sport-specific conference audit
                             corrected (179 men's fixes), and the app DB never received
                             those edits, so the DB's conference is knowingly stale.
  2. rankings_v6_*.csv       soccer_score_v6 + rank + within-division strength, freshly
                             regenerated so it includes the postseason ladder. The DB's
                             own soccer_score matches for women but is ~1 point off for
                             men (a pre-postseason run) and its national_ranking is stale
                             outright (Clemson stored 37, actual v6 rank 1), so neither DB
                             column is exported -- one rank, from one source.
  3. app DB `colleges`       visual identity (nickname/mascot/colours/logo), the 2025
                             conference-champion fields, academic_rating.
  4. coaching contact CSVs   head coach name + email, per division per sex.
  5. graduating_seniors + athletics_domains.json
                             roster URL, senior COUNT (never names), athletics domain.

MATCHING. Every source writes school names in its own vocabulary, and it varies in BOTH
directions: the coach files spell out "Adrian College" where the records file says
"Adrian", but the records file says "Colorado College" where another source says
"Colorado". So resolution is bidirectional-subset with the fewest extra tokens winning,
and a tie is REFUSED and reported -- a wrong mascot or a wrong coach's name in an
outreach email is worse than a blank field.

"University" and "College" are deliberately KEPT as tokens. Stripping them collapses
Boston College onto Boston University and Colorado College onto Colorado. Parenthesised
state qualifiers are kept as tokens too, so Marian (IN) cannot take Marian (WI).
"""
import csv, json, re, sqlite3, collections, os, urllib.parse

BASE   = "/Users/rhysdavies/Documents/Recruitmatch"
OUTDIR = "/Users/rhysdavies/Documents/Thriv3/University individualisation"
DB     = f"{BASE}/app/server/data/recruitmatch.sqlite"
REC    = {"men":   "/Users/rhysdavies/Documents/Thriv3/Soccer Records/soccer_records.csv",
          "women": "/Users/rhysdavies/Documents/Thriv3/Soccer Records/soccer_records_women.csv"}
RANK   = {"men": f"{BASE}/individualisation/rank_men.csv",
          "women": f"{BASE}/individualisation/rank_women.csv"}
SPORT  = {"men": "mens-soccer", "women": "womens-soccer"}
COACHDIR = "/Users/rhysdavies/Documents/Thriv3/2025 Coaches Emails"
YEARS  = [2022, 2023, 2024, 2025]
DIVS   = {"d1": "D1", "d2": "D2", "d3": "D3", "naia": "NAIA"}

# the DB writes division as "NCAA D1", the records CSV as "D1"
DIVMAP = {"NCAA D1": "D1", "NCAA D2": "D2", "NCAA D3": "D3", "NAIA": "NAIA", "NJCAA": "NJCAA"}

# short forms the coach files use that no token rule can reach
ALIAS = {
    "aum": "Montevallo",                      # resolved below only if unique; see note
    "csu pueblo": "Colorado State Pueblo",
    "cal state la": "Cal State Los Angeles",
    "uc san diego": "UC San Diego",
    "siue": "SIU Edwardsville",
    "wvu tech": "West Virginia Tech",
    "scad": "Savannah College of Art and Design",
    "army west point": "Army",
    "cal baptist": "California Baptist",
    "point loma": "Point Loma Nazarene",
}
# AUM is Auburn University at Montgomery -- an alias that guesses wrong is worse than a
# blank, so it is spelled out rather than pattern-matched.
ALIAS["aum"] = "Auburn Montgomery"


def norm(n):
    n = re.sub(r"\[[^]]*\]", "", str(n))
    n = re.sub(r"\(([^)]*)\)", r" \1 ", n)          # keep the state qualifier as a token
    n = re.sub(r"[–—&/]", " ", n)
    n = re.sub(r"\bst\b\.?", "saint", n, flags=re.I)
    toks = re.sub(r"[^a-z0-9 ]", " ", n.lower()).split()
    return [t for t in toks if t not in ("the", "of", "at", "and")]


def key(n):
    return " ".join(sorted(norm(n)))


class Index:
    """Resolve a school name onto one row of another source, or refuse.

    Exact normalised key first. Failing that, bidirectional subset: the query's tokens
    contained in a candidate's, OR a candidate's contained in the query's. Both are
    needed because the vocabularies differ in both directions ("Adrian" vs "Adrian
    College", "Colorado College" vs "Colorado"). Fewest extra tokens wins; a tie is
    refused, because a confident wrong answer here lands in an email.
    """

    def __init__(self, rows, namefield):
        self.rows, self.nf = rows, namefield
        self.exact = collections.defaultdict(list)
        self.toks = []
        for r in rows:
            self.exact[key(r[namefield])].append(r)
            self.toks.append((set(norm(r[namefield])), r))
        self.unresolved = []

    def get(self, name):
        return self._resolve(name)[0]

    def has_candidate(self, name):
        """True if ANY row plausibly names this school, even ambiguously.

        Separate from get() because the two answers are used for different decisions:
        get() decides whether to COPY a value across (ambiguity must yield nothing), while
        this decides whether the name is a program we do not hold at all (ambiguity means
        we DO hold it, we just cannot tell which row). Conflating them invented phantom
        universities -- "Azusa Pacific" from the coach file became a second row alongside
        the "Azusa Pacific University" already in the records file.
        """
        return self._resolve(name)[1] > 0

    def same_university(self, name):
        """Resolve onto a row for THE SAME UNIVERSITY, by exact normalised name only.

        Used solely to borrow identity across the two sports. Every looser rule tried here
        was wrong in practice, because the counterpart school is often simply ABSENT from
        the other sport, which leaves a same-named neighbour as the best fuzzy candidate:

          subset            "Florida State" (no men's programme) took Eastern Florida
                            State's identity -- Titans in green, not Seminoles in garnet.
          generic suffixes  allowing "College"/"University" as extras then handed Colorado
                            the identity of Colorado College, Idaho that of College of
                            Idaho, and Illinois that of Illinois College. Uniqueness does
                            not rescue it: the real counterpart is not there to compete.
                            "Miami" vs "Miami University" are different schools too.

        Requiring exact equality gives up some true fills ("Concordia Irvine" will not
        reach "Concordia University Irvine"). That trade is deliberate: the cost of
        refusing is a blank field, and the cost of guessing is the wrong school's mascot
        in an outreach email.
        """
        hit = self.exact.get(key(name))
        return hit[0] if hit and len(hit) == 1 else None

    def _resolve(self, name):
        """(row_or_None, n_candidates)."""
        for cand in (name, ALIAS.get(" ".join(norm(name)))):
            if not cand:
                continue
            hit = self.exact.get(key(cand))
            if hit and len(hit) == 1:
                return hit[0], 1
            if hit:
                self.unresolved.append((name, "ambiguous exact"))
                return None, len(hit)
        alias = ALIAS.get(" ".join(norm(name)))
        want = set(norm(alias)) if alias else set(norm(name))
        if not want:
            return None, 0
        # FORWARD first: the query's tokens contained in a candidate's. The reverse
        # direction is the lossy one -- it throws away words the query supplied -- so it
        # is only consulted when nothing matches forward. Mixing the two at equal weight
        # made the bare school "Pacific" tie with "Azusa Pacific University" for the query
        # "Azusa Pacific", and the tie-refusal then dropped a coach we actually hold.
        for direction in ("forward", "reverse"):
            cands = []
            for have, r in self.toks:
                if direction == "forward" and want <= have:
                    cands.append((len(have - want), r))
                elif direction == "reverse" and have <= want:
                    cands.append((len(want - have), r))
            if not cands:
                continue
            cands.sort(key=lambda x: x[0])
            if len(cands) > 1 and cands[0][0] == cands[1][0]:
                self.unresolved.append((name, f"ambiguous {direction}"))
                return None, len(cands)
            return cands[0][1], len(cands)
        return None, 0


# Title ranking. "Associate Head Coach" and "Assistant Head Coach" both contain "head",
# so a substring test on "head" picks up 95 associates in the D1 men's file alone -- and
# because they can be listed above the head coach, first-match-wins put the WRONG name
# on the school. Titles are therefore scored, and the best-scoring row per school wins.
def title_rank(t):
    t = (t or "").lower()
    if "assistant" in t or "associate" in t or "graduate" in t or "volunteer" in t:
        return None                      # never the outreach addressee
    if "team email" in t:
        return None                      # a shared inbox, not a person
    if re.fullmatch(r"\s*head\s+coach\s*", t):
        return 0
    if "head" in t and "coach" in t:
        return 1                         # "Head Men's Soccer Coach", "Head Coach/..."
    if "director" in t:
        return 3
    return None


def load_coaches(sex):
    """{division: Index over the best head-coach row per school}."""
    out = {}
    for div, label in DIVS.items():
        p = f"{COACHDIR}/{div}_{sex}s_soccer_coaching_contacts.csv"
        if not os.path.exists(p):
            continue
        best = {}
        for r in csv.DictReader(open(p, newline="", encoding="utf-8")):
            rk = title_rank(r.get("coach_title"))
            if rk is None:
                continue
            k = key(r["school_name"])
            # prefer the better title; then prefer a row that actually carries an email
            score = (rk, 0 if (r.get("email") or "").strip() else 1)
            if k not in best or score < best[k][0]:
                best[k] = (score, r)
        rows = [v[1] for v in best.values()]
        out[label] = Index(rows, "school_name")
    return out


COLS = (
    # --- who they are -------------------------------------------------------
    ["school_id", "school", "sport", "division", "conference", "conf_tier"]
    # --- visual identity, straight into the email template ------------------
    + ["nickname", "nickname_plural", "mascot", "primary_color", "secondary_color",
       "logo_url", "athletics_domain", "athletics_domain_source"]
    # --- achievement --------------------------------------------------------
    + ["conference_champion_2025", "conference_champion_name"]
    # --- program strength ---------------------------------------------------
    + ["soccer_score_v6", "soccer_score_rank", "within_div_strength", "academic_rating"]
    # --- four-season record -------------------------------------------------
    + [f"{y}_{c}" for y in YEARS for c in ("W", "L", "D")]
    + [f"{y}_ps" for y in YEARS]
    # --- staff and roster pointers -----------------------------------------
    + ["head_coach", "head_coach_title", "head_coach_email", "head_coach_email_type",
       "roster_url_2025", "graduating_seniors_2025"]
    # --- provenance ---------------------------------------------------------
    + ["data_sources", "identity_source", "identity_notes",
       "conference_champion_source", "conference_champion_notes", "coach_source_url"]
)


def initialism_aliases(db_rows, spine_names):
    """Map a spelled-out school name onto the ABBREVIATED name the database stores it under.

    The records and coaching files spell schools out -- "Florida International", "Long Island
    University", "East Tennessee State University" -- while the colleges table holds them as
    "FIU", "LIU", "ETSU". The subset matcher cannot bridge that: the two share no token, so
    those rows came out of this build with NO identity at all even though the database had it.
    Eight D1 programmes were blank for this reason alone.

    The rule is deliberately narrow: the abbreviation must be all-caps, and it must equal the
    initials of the long name exactly (ignoring generic words). "FIU" == initials of
    "Florida International University"; anything looser would start matching unrelated
    schools that happen to share initials.
    """
    generic = {"university", "college", "of", "the", "at", "and", "state", "institute"}
    abbrevs = {}
    for r in db_rows:
        n = (r.get("name") or "").strip()
        if 2 <= len(n) <= 5 and n.isupper() and n.isalpha():
            abbrevs.setdefault(n, r["name"])
    out = {}
    for long_name in spine_names:
        words = [w for w in re.sub(r"[^A-Za-z ]", " ", long_name).split()]
        if len(words) < 2:
            continue
        for drop_generic in (False, True):
            ws = [w for w in words if not (drop_generic and w.lower() in generic)]
            ini = "".join(w[0] for w in ws).upper()
            # "Florida International" yields FI, but the database calls it FIU -- the
            # abbreviation carries a "University" the spelled-out name omits. Only a trailing
            # U or C is allowed, so this cannot invent an unrelated initialism.
            for cand in (ini, ini + "U", ini + "C"):
                if cand in abbrevs:
                    out[key(long_name)] = abbrevs[cand]
                    break
            if key(long_name) in out:
                break
    return out


def build(sex):
    sport = SPORT[sex]
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    db_rows = [dict(r) for r in con.execute("SELECT * FROM colleges WHERE sport=?", (sport,))]
    other = [dict(r) for r in con.execute("SELECT * FROM colleges WHERE sport<>?", (sport,))]
    grads = [dict(r) for r in con.execute(
        "SELECT college_name, total_graduating_seniors, official_roster_url "
        "FROM graduating_seniors WHERE sport=?", (sport,))]
    con.close()

    rec_rows  = list(csv.DictReader(open(REC[sex], newline="", encoding="utf-8")))
    rank_rows = list(csv.DictReader(open(RANK[sex], newline="", encoding="utf-8")))
    domains   = [{"name": k, "domain": v} for k, v in
                 json.load(open(f"{BASE}/athletics_domains.json")).items()]
    coaches   = load_coaches(sex)

    dbi   = Index(db_rows,   "name")
    spine_names = ([r["name"] for r in rec_rows]
                   + [r["school_name"] for idx in coaches.values() for r in idx.rows])
    ini_alias = initialism_aliases(db_rows, spine_names)
    db_by_name = {r["name"]: r for r in db_rows}
    ranki = Index(rank_rows, "name")
    gradi = Index(grads,     "college_name")
    domi  = Index(domains,   "name")
    otheri = Index(other, "name")

    # THE SPINE IS A UNION of every source that names a program, because the question the
    # file answers is "every university we collect". The records file is not a superset:
    # it carries 85 NAIA men's programs where the coach file carries 184, so a
    # records-only spine would silently drop ~100 programs we hold real contact data for.
    spine, seen = [], {}
    for r in rec_rows:
        k = key(r["name"])
        spine.append(["records", r, r["division"]])
        seen[k] = True
    for r in db_rows:
        k = key(r["name"])
        if k not in seen:
            spine.append(["db", r, DIVMAP.get(r.get("division") or "", r.get("division") or "")])
            seen[k] = True
    coach_only, coach_ambiguous = 0, []
    probe = Index([{"name": s[1]["name"]} for s in spine], "name")
    for label, idx in coaches.items():
        for r in idx.rows:
            if key(r["school_name"]) in seen:
                continue
            if probe.has_candidate(r["school_name"]):
                # we hold this program; the name just cannot be pinned to one row
                coach_ambiguous.append(r["school_name"])
                continue
            spine.append(["coach", r, label])
            seen[key(r["school_name"])] = True
            probe.toks.append((set(norm(r["school_name"])), {"name": r["school_name"]}))
            probe.exact[key(r["school_name"])].append({"name": r["school_name"]})
            coach_only += 1

    out, stats = [], collections.Counter()
    for src, r, div in spine:
        name = r["school_name"] if src == "coach" else r["name"]
        srcs = [src]
        row = {c: "" for c in COLS}
        row.update({"school": name, "sport": sport, "division": div})

        if src == "records":
            row["school_id"] = r["school_id"]
            row["conference"] = r["conference"]
            row["conf_tier"] = r["conf_tier"]
            for y in YEARS:
                for c in ("W", "L", "D"):
                    row[f"{y}_{c}"] = r.get(f"{y}_{c}", "")
                row[f"{y}_ps"] = r.get(f"{y}_ps", "")
        elif src == "db":
            row["conference"] = r.get("conference") or ""

        d = r if src == "db" else dbi.get(name)
        if d is None and src != "db":
            # last resort: the database may hold this school under its initials
            alt_name = ini_alias.get(key(name))
            if alt_name:
                d = db_by_name.get(alt_name)
                if d:
                    stats["matched_by_initialism"] += 1
        if d:
            if src != "db":
                srcs.append("db")
        # Visual identity is a property of the UNIVERSITY, not of one of its teams:
        # Duke's teams are both the Blue Devils, off the same Wikipedia infobox field.
        # The women's rows were populated far more thinly than the men's (29% vs 74%
        # nicknames), and a plain SQL name join finds nothing to carry across because the
        # two sports spell schools differently ("Azusa Pacific" vs "Azusa Pacific
        # University"), so the same fuzzy resolver is used. Anything filled this way is
        # marked in identity_source, so a borrowed value never passes for a direct one.
        alt = otheri.same_university(name)
        ident = {}
        for f in ("nickname", "nickname_plural", "mascot", "primary_color",
                  "secondary_color", "logo_url"):
            v = (d or {}).get(f)
            if v not in (None, ""):
                ident[f] = v
            elif alt and alt.get(f) not in (None, ""):
                ident[f] = alt[f]
                ident.setdefault("_borrowed", []).append(f)
        borrowed = ident.pop("_borrowed", None)

        if d or ident:
            row.update({
                "nickname": ident.get("nickname") or "",
                "nickname_plural": "" if ident.get("nickname_plural") is None else ident.get("nickname_plural", ""),
                "mascot": ident.get("mascot") or "",
                "primary_color": ident.get("primary_color") or "",
                "secondary_color": ident.get("secondary_color") or "",
                "logo_url": ident.get("logo_url") or "",
                "academic_rating": "" if (d or {}).get("academic_rating") is None else d["academic_rating"],
                "conference_champion_2025": "" if (d or {}).get("conference_champion_2025") is None else d["conference_champion_2025"],
                "conference_champion_name": (d or {}).get("conference_champion_name") or "",
                "conference_champion_source": (d or {}).get("conference_champion_source") or "",
                "conference_champion_notes": (d or {}).get("conference_champion_notes") or "",
                "identity_source": (d or {}).get("identity_source") or (alt or {}).get("identity_source") or "",
                "identity_notes": (d or {}).get("identity_notes") or "",
            })
            if borrowed:
                row["identity_source"] = ((row["identity_source"] + " | ") if row["identity_source"] else "") \
                    + f"borrowed from the {'womens' if sex=='men' else 'mens'}-soccer row: " + ",".join(borrowed)
                srcs.append("xsport")
                stats["borrowed_identity"] += 1
            for f, k in (("nickname", "nickname"), ("mascot", "mascot"),
                         ("primary_color", "colors"), ("logo_url", "logo")):
                if row[f]:
                    stats[k] += 1
            if str((d or {}).get("conference_champion_2025") or "") == "1":
                stats["champion_2025"] += 1
        if not row["conference"] and d:
            row["conference"] = d.get("conference") or ""

        rk = ranki.get(name)
        if rk and rk.get("score"):
            row["soccer_score_v6"] = rk["score"]
            row["soccer_score_rank"] = rk["rank"]
            row["within_div_strength"] = rk.get("within_div_strength", "")
            srcs.append("v6")
            stats["score"] += 1

        # ATHLETICS DOMAIN. Evidence first, and no subset matching at all.
        #
        # The Index's bidirectional subset is right for the coach files, where
        # the same school is spelled differently ("Adrian" / "Adrian College").
        # It is wrong here, because the other rows of athletics_domains.json are
        # OTHER SCHOOLS. That file holds 727 entries and has no "Belmont", no
        # "Cornell", no "Michigan" — so the subset rule reached for the nearest
        # longer name and published Belmont Abbey's domain for Belmont, Cornell
        # College's for Cornell, and Northern Michigan's for Michigan. 210 of
        # the rows this script writes named the wrong institution.
        #
        # Note that no rule over names could have saved it: "Adrian" + "College"
        # is the same school and "Cornell" + "College" is a different one. So the
        # domain is taken from a URL we actually loaded a roster from, and the
        # name-keyed file is consulted only on an EXACT match. Blank beats wrong:
        # verify_db_identity.js treats this column as evidence that an identity
        # is correct, so a bad value does not merely mislead, it certifies.
        g = gradi.get(name)
        roster_url = (g or {}).get("official_roster_url") or ""
        row["athletics_domain"] = ""
        row["athletics_domain_source"] = ""
        if roster_url:
            host = urllib.parse.urlparse(roster_url).netloc.replace("www.", "")
            if host and "web.archive.org" not in host:
                row["athletics_domain"], row["athletics_domain_source"] = host, "roster-url"
        if not row["athletics_domain"]:
            exact = domi.exact.get(key(name)) or []
            if len(exact) == 1 and exact[0].get("domain"):
                row["athletics_domain"] = exact[0]["domain"]
                row["athletics_domain_source"] = "exact-name-match"
        if row["athletics_domain"]:
            stats["domain"] += 1

        c = r if src == "coach" else (coaches.get(div).get(name) if div in coaches else None)
        if c:
            row["head_coach"] = c.get("coach_name") or ""
            row["head_coach_title"] = c.get("coach_title") or ""
            row["head_coach_email"] = c.get("email") or ""
            row["head_coach_email_type"] = c.get("email_type") or ""
            row["coach_source_url"] = c.get("source_url") or ""
            if src != "coach":
                srcs.append("coach")
            if row["head_coach"]:
                stats["coach"] += 1
            if row["head_coach_email"]:
                stats["coach_email"] += 1

        if g:
            row["roster_url_2025"] = g.get("official_roster_url") or ""
            v = g.get("total_graduating_seniors")
            row["graduating_seniors_2025"] = "" if v is None else v
            srcs.append("grads")
            if v is not None:
                stats["grads"] += 1

        row["data_sources"] = "+".join(dict.fromkeys(srcs))
        out.append({c: row.get(c, "") for c in COLS})

    order = {"D1": 0, "D2": 1, "D3": 2, "NAIA": 3, "NJCAA": 4}
    out.sort(key=lambda r: (order.get(r["division"], 9), r["school"]))
    os.makedirs(OUTDIR, exist_ok=True)
    path = f"{OUTDIR}/{sex}s_soccer_universities.csv"
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        w.writerows(out)

    n = len(out)
    print(f"\n{sex}s soccer -> {os.path.basename(path)}   {n} universities, {len(COLS)} columns")
    print(f"  spine: {len(rec_rows)} records + "
          f"{sum(1 for s in spine if s[0]=='db')} db-only + {coach_only} coach-only")
    for label, k in [("nickname", "nickname"), ("mascot", "mascot"), ("colours", "colors"),
                     ("logo", "logo"), ("athletics domain", "domain"),
                     ("2025 conf champion", "champion_2025"), ("v6 score", "score"),
                     ("head coach", "coach"), ("coach email", "coach_email"),
                     ("graduating count", "grads"),
                     ("identity borrowed x-sport", "borrowed_identity"),
                     ("matched via initialism", "matched_by_initialism")]:
        print(f"    {label:20} {stats[k]:5} ({100*stats[k]/n:5.1f}%)")
    if coach_ambiguous:
        print(f"    coach rows held back, school name matches >1 row: {len(coach_ambiguous)}")
        print("       " + ", ".join(sorted(coach_ambiguous)[:10]))
    unres = dbi.unresolved + ranki.unresolved + gradi.unresolved + domi.unresolved
    for idx in coaches.values():
        unres += idx.unresolved
    if unres:
        u = collections.Counter(x[0] for x in unres)
        print(f"    refused as ambiguous (left blank, never guessed): {len(u)} names")
        for name, cnt in u.most_common(8):
            print(f"       {name[:40]:40} x{cnt}")
    return path


if __name__ == "__main__":
    for sex in ("men", "women"):
        build(sex)
