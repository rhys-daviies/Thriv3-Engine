# -*- coding: utf-8 -*-
"""Pull the head coach off a /coaches page, live or from a Wayback snapshot.

Why this exists: a programme's freshman usage can change sharply mid-window,
and without knowing who was in charge each season there is no way to tell a
change of philosophy from one large intake ageing through the squad. Capturing
the coach at each season and DERIVING tenure from the sequence is more honest
than scraping "in his 12th season" prose -- which, measured on a sample of 12
live pages, appears on 1. A /coaches page is a staff directory; that sentence
lives on the individual bio page.

Everything about fetching, caching and Wayback comes from lib.py. This module
is only the parse and the identity check.
"""
import html as _html
import re
import lib

# ---------------------------------------------------------------- roles
# A faithful port of shared/coachRoles.js. Order matters for the same reason
# it does there: "Associate Head Coach" contains "Head ... Coach" and would
# otherwise read as the head.
HARD_EXCLUDED = [
    (re.compile(r'team\s*email|general\s*inquir', re.I), 'team-email'),
    (re.compile(r'volunteer', re.I), 'volunteer'),
    (re.compile(r'graduate\s*(assistant|manager)|^\s*ga\b', re.I), 'graduate-assistant'),
    (re.compile(r'student\s*(assistant|manager)', re.I), 'support-staff'),
]
INCLUDED = [
    (re.compile(r'associate\s*head', re.I), 'associate-head'),
    # "head ... coach" inside one role phrase. A slash may sit between them
    # ("Head Men's/Women's Soccer Coach"); a pipe or bracket separates two
    # jobs, and "Assistant Coach | Head of Goalkeeper Development" is not a
    # head coach.
    (re.compile(r'\bhead\b[^|(]*coach|director of soccer', re.I), 'head'),
    (re.compile(r'assistant', re.I), 'assistant'),
    (re.compile(r'goalkeep|keeper\s*coach', re.I), 'goalkeeper'),
]


def classify_role(title):
    t = re.sub(r'\s+', ' ', (title or '')).strip()
    if not t:
        return 'unknown'
    for pat, role in HARD_EXCLUDED:
        if pat.search(t):
            return role
    for pat, role in INCLUDED:
        if pat.search(t):
            return role
    return 'other'


# ---------------------------------------------------------------- identity
SPORT_WORDS = {
    'mens-soccer': (r"men'?s\s+soccer", r'\bmsoc\b', r'\bmens?[-_]soccer\b'),
    'womens-soccer': (r"women'?s\s+soccer", r'\bwsoc\b', r'\bwomens?[-_]soccer\b'),
}
# Words that identify nothing -- a page titled "Athletics" shares them with
# every other school and must not be allowed to satisfy the school check.
STOP = set("""university college the of and state saint st school athletics official
site sports soccer men mens women womens community technical institute""".split())


def school_tokens(school):
    """The distinctive words in a school name, parentheticals kept.

    The parenthetical is the whole point for Union (KY) vs Union (TN): the
    app's own matchSchoolName strips it and has silently merged those two.
    """
    quals = re.findall(r'\(([^)]*)\)', school or '')
    base = re.sub(r'\([^)]*\)', ' ', school or '')
    words = [w for w in re.findall(r"[A-Za-z']+", base.lower()) if w not in STOP and len(w) > 2]
    return words, [q.strip().lower() for q in quals if q.strip()]


def _flat(markup, limit=40000):
    """Tags stripped, entities decoded, whitespace collapsed.

    Decoding is not cosmetic: Akron's live page titles itself
    "2026 Men&#x27;s Soccer Coaches", and a sport check that does not decode
    rejects the very page it was meant to accept.
    """
    text = re.sub(r'<[^>]*>', ' ', markup[:limit])
    return re.sub(r'\s+', ' ', _html.unescape(text)).lower()


def identity_ok(html, school, sport):
    """Does this page belong to this school AND this sport?

    Mandatory, not defensive. athletics_domains.json maps distinct schools onto
    a single athletics domain, and a rebuild that trusted it once wrote one
    school's record onto every colliding row -- caught only because 117 of 118
    cells came back byte-identical.

    Returns (ok, reason).
    """
    hay = _flat(html)

    if not any(re.search(p, hay) for p in SPORT_WORDS[sport]):
        return False, 'sport-not-on-page'

    words, quals = school_tokens(school)
    if words and not any(w in hay for w in words):
        return False, 'school-not-on-page'
    # A qualifier that exists must be honoured, or Union (KY) accepts Union (TN).
    if quals and not any(q in hay for q in quals):
        return False, 'school-qualifier-mismatch'
    return True, ''


# ---------------------------------------------------------------- parse
NAMEY = re.compile(r"^[A-Z][\w'’.-]*(?:\s+[A-Z][\w'’.-]*){1,3}$")
TITLEY = re.compile(r'coach|director of soccer', re.I)


# A vacancy is not a person. South Carolina State listed "TBA" as its head
# coach for two straight seasons -- and that is the most informative fact
# about the programme in the window, so it must be recorded as a vacancy
# rather than parsed as a coach named Mr T. B. A.
PLACEHOLDER = re.compile(r"""^(tba|tbd|tbn|n/?a|vacant|vacancy|staff|open|pending
                              |to\s+be\s+(announced|named|determined|hired)
                              |position\s+open|head\s+coach|interim)
                              (\s+\1)*$""", re.I | re.X)


def is_placeholder(s):
    t = re.sub(r'\s+', ' ', (s or '')).strip().strip('.')
    if not t:
        return True
    # "TBA TBA" arrives as first+last from a two-column staff table.
    words = t.lower().split()
    if words and len(set(words)) == 1 and PLACEHOLDER.match(words[0]):
        return True
    return bool(PLACEHOLDER.match(t))


# A section heading is not a person. Rejecting "TBA TBA" as a placeholder
# made the parser fall through to whatever came next, and what came next was
# "Men's Soccer Coaching Staff" -- so South Carolina State, a programme that
# genuinely had nobody in the job, acquired a coach named after the heading
# above the empty table. 142 rows across 53 programmes read that way.
# Link text sitting beside a staff entry. "Full Bio" reached 38 programmes
# before this existed, and it passes every other test: two capitalised words,
# no digits, no job title in it. The tell is frequency -- no person coaches
# 38 programmes -- so anything appearing across more than a couple of
# programmes is a label, not a name.
UILABEL = re.compile(r"""^(full\s+bio|bio|biography|additional\s+links?|related\s+links?
                        |quick\s+links?|view\s+(full\s+)?(bio|profile)|read\s+more
                        |more\s+info(rmation)?|profile|email|e-?mail|contact
                        |phone|twitter|instagram|facebook|photo|headshot
                        |learn\s+more|details?|see\s+all|show\s+more)$""", re.I | re.X)

HEADINGY = re.compile(r"""\b(coach|coaches|coaching|soccer|staff|roster|directory
                          |department|athletics?|club|contact|team|personnel
                          |administration|support)\b""", re.I | re.X)


def _plausible_name(s):
    s = re.sub(r'\s+', ' ', (s or '')).strip()
    if not (3 < len(s) < 46):
        return False
    if re.search(r'\d|@|http', s):
        return False
    if is_placeholder(s):
        return False
    if HEADINGY.search(s) or UILABEL.match(s):
        return False
    return bool(NAMEY.match(s))


def _pairs_from_tables(html):
    """(name, title) out of a staff directory rendered as a table."""
    out = []
    for tbl in re.findall(r'<table[\s\S]*?</table>', html, re.I):
        for tr in re.findall(r'<tr[\s\S]*?</tr>', tbl, re.I):
            cells = [re.sub(r'\s+', ' ', re.sub(r'<[^>]*>', ' ', c)).strip()
                     for c in re.findall(r'<t[dh][\s\S]*?</t[dh]>', tr, re.I)]
            cells = [c for c in cells if c]
            if len(cells) < 2:
                continue
            for i, c in enumerate(cells):
                if _plausible_name(c):
                    for t in cells[i + 1:i + 3]:
                        if TITLEY.search(t):
                            out.append((c, t))
                            break
                    break
    return out


def _pairs_from_text(html):
    """(name, title) where the markup is cards or free prose.

    Works on the flattened text because staff blocks put the name immediately
    before or after the title in every template seen. Both orders are tried.
    """
    txt = re.sub(r'\s+', ' ', re.sub(r'<[^>]*>', '\n', html))
    txt = re.sub(r'\n\s*', '\n', re.sub(r'<[^>]*>', '\n', html))
    lines = [re.sub(r'\s+', ' ', l).strip() for l in txt.split('\n')]
    lines = [l for l in lines if l]
    out = []
    for i, l in enumerate(lines):
        if not TITLEY.search(l) or len(l) > 70:
            continue
        for j in (i - 1, i + 1, i - 2, i + 2):
            if 0 <= j < len(lines) and _plausible_name(lines[j]):
                out.append((lines[j], l))
                break
    return out


def head_coach(html):
    """The head coach on this page, as (name, title, how).

    Walks the same ladder the app's pickBestContact does -- head, then
    associate head -- and never returns a volunteer or graduate assistant,
    who are not who decides. Returns (None, None, reason) when nothing
    qualifies, because a blank with no reason reads as coverage.
    """
    for how, pairs in (('table', _pairs_from_tables(html)), ('text', _pairs_from_text(html))):
        by_role = {}
        for name, title in pairs:
            role = classify_role(title)
            if role in ('head', 'associate-head') and role not in by_role:
                by_role[role] = (lib.clean_name(name), re.sub(r'\s+', ' ', title).strip())
        for role in ('head', 'associate-head'):
            if role in by_role:
                name, title = by_role[role]
                if _plausible_name(name):
                    return name, title, f'{how}:{role}'
    if re.search(r'\b(TBA|TBD|Vacant|To Be Announced)\b', _flat(html), re.I):
        return None, None, 'vacant-or-tba'
    return None, None, 'no-head-coach-found'


# ---------------------------------------------------------------- urls
def coaches_url(roster_url):
    """The staff page for whatever sport this roster URL belongs to.

    Derived from the sport path rather than hardcoded, which is what let the
    original coaching-contacts scrape work across templates that disagree
    about everything else.
    """
    if not roster_url:
        return None
    m = re.search(r'(https?://[^/]+)(/sports?/[a-z0-9-]+)', roster_url, re.I)
    if not m:
        return None
    return m.group(1) + m.group(2) + '/coaches'


def season_window(season):
    """August of the season through February after it.

    A snapshot has to fall inside the season it is being used to describe. A
    July capture is the previous staff; a March one may already show the next.
    """
    return f'{season}0801', f'{season + 1}0228'


def season_addressed(url, season):
    """True when the URL names the season it is supposed to describe.

    This is the whole safety property of the roster-page route. A bare
    /roster URL serves TODAY's squad no matter which season's file it was
    read from, so accepting one would stamp the current coach onto all four
    years and read as four years of continuity that never happened. Measured
    across the files: 2022 and 2023 are 100% year-addressed, 2024 98%, 2025
    79% -- so the undated remainder takes the Wayback route instead.
    """
    return bool(re.search(r'(?:/|=|-)' + str(season) + r'(?:\b|/|$)', url or ''))


def fetch_season_page(roster_url, season, school, sport):
    """The best page describing this programme in this season.

    Roster page first, and not as a fallback: the staff block is rendered in
    the same markup as the players (which is why lib.is_staff exists), the URL
    is year-addressed so it is a LIVE page for a past season, and the roster
    pipeline has already verified and cached it. A live page is High
    confidence where a snapshot is only Medium.

    Returns (html, method, confidence, reason).
    """
    if roster_url and season_addressed(roster_url, season):
        st, h = lib.fetch(roster_url, tries=2, timeout=30)
        if st == 200 and h:
            ok, why = identity_ok(h, school, sport)
            if ok:
                return h, 'roster-live', 'High', ''
            return None, 'roster-live', '', why

    # No dated roster URL, or it failed identity: go to the archive, windowed
    # so the snapshot falls inside the season it is being used to describe.
    for base in filter(None, (coaches_url(roster_url), roster_url)):
        frm, to = season_window(season)
        for ts in lib.cdx(base, frm=frm, to=to, limit=6):
            st, h = lib.fetch(lib.wb_url(ts, base), tries=2, timeout=45)
            if st == 200 and h:
                ok, why = identity_ok(h, school, sport)
                if ok:
                    return h, f'wayback:{ts}', 'Medium', ''
    return None, 'none', '', 'no-usable-page'


def fetch_for_season(url, season, live_season):
    """(status, html, method). Live for the current season, Wayback before it.

    Live is preferred wherever it is valid because a live page is High
    confidence and a snapshot only Medium -- the same rule variants.py applies
    to rosters.
    """
    if season == live_season:
        st, html = lib.fetch(url, tries=2, timeout=30)
        return st, html, 'live'
    frm, to = season_window(season)
    stamps = lib.cdx(url, frm=frm, to=to, limit=8)
    if not stamps:
        return 'no-snapshot', '', 'wayback'
    for ts in stamps:
        st, html = lib.fetch(lib.wb_url(ts, url), tries=2, timeout=45)
        if st == 200 and html:
            return 200, html, f'wayback:{ts}'
    return st, '', 'wayback'
