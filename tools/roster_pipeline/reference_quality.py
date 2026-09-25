# -*- coding: utf-8 -*-
"""What makes a HISTORICAL roster reference trustworthy enough to measure against.

The turnover gate compares a current-season page against last season's accepted
squad. L7V found the eleven programmes it still refuses have one thing in
common: not one of their 2025 references is season-pinned. Every one was
captured from a URL that serves whatever the site calls "now", and four of them
from a player bio rather than a roster. The gate is right to refuse a comparison
it cannot trust -- so this module is about the reference, not the gate.

THE CLAIM THIS MODULE REFUSES TO MAKE. Rows stored under season=2025 are not
evidence that the page they were read from represented 2025. That inference is
how the eleven got their references in the first place: in the autumn of 2025 a
bare roster URL *did* serve the 2025 squad, so the pipeline recorded the bare
URL and the season label, and the two facts became indistinguishable. A year
later the same URL serves 2026 and the provenance cannot tell you which squad
the rows describe. `season_established` below therefore asks the PAGE, never the
database.

WHY THERE IS ALMOST NO NEW POLICY HERE. Seven of the eight clauses delegate to
the authority that already owns the question -- `lib.season_ok` for season
identity, `lib.sport_contradicted` for sport and gender, `lib._nuxt_player_lists`
for roster ambiguity, `variants.ladder` for season-pinned candidate discovery,
`run.evaluate`'s own floor for player rows. A backfill run has always demanded
that a page name its season (`variants.work`, the `not CURRENT` branch); that is
this contract, and it was already written. What is new is clause 8 and the
vocabulary to say which clause a stored reference fails.
"""
import html as html_mod
import re
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib          # noqa: E402

CONTRACT = 'L7W/historical-reference/v1'

# `run.evaluate`'s floor, not a second opinion about it. A reference under it is
# refused there too, and the number must not be able to drift apart.
REFERENCE_FLOOR = 5

# A reference may be no more than this multiple of the count the roster record
# already claims. Mirrors the bound in `run.evaluate`, for the same reason: a
# page 2.6x too long is a directory, an all-time list, or two squads.
PLAUSIBLE_MAX = 2.6

CLASSIFICATIONS = (
    'TRUSTED_SEASON_PINNED',    # the institution's own page, naming the season
    'TRUSTED_ARCHIVED',         # a capture of that page, the page naming the season
    'UNTRUSTED_BARE_CURRENT',   # a URL that serves "now"; season unknowable
    'UNTRUSTED_BIO_CAPTURE',    # one player's page, not a squad
    'UNTRUSTED_MIXED_SEASONS',  # rows assembled from more than one page state
    'UNAVAILABLE',              # nothing reachable establishes the season
    'AMBIGUOUS',                # reachable, and the page will not say
)


def canonical_host(h):
    """`canonicalHost` in shared/evidence/registryIntegrity.js, for URLs."""
    return re.sub(r'^www\.', '', (h or '').strip().lower())


def underlying(url):
    """The host that actually served the bytes, seeing through an archive wrapper.

    An archived capture's provenance is the ORIGINAL host: a Wayback copy of
    `goracers.com` is first-party evidence served by a third party, which is not
    the same thing as a third-party roster. `lib.immutable_source` already
    treats the wrapper this way for caching.
    """
    u = re.sub(r'^https?://web\.archive\.org/web/\d+(?:id_)?/', '', url or '')
    m = re.match(r'^https?://([^/]+)', u)
    return canonical_host(m.group(1)) if m else None


# A Sidearm/Presto player page: the roster path with one athlete's slug, and
# optionally their numeric id, hanging off it. `variants.ladder` strips exactly
# this shape to recover the squad URL, and the pattern is kept in step with it.
BIO_URL = re.compile(r'(/roster)/[a-z0-9][a-z0-9\-\.]+(?:/\d+)?/?$', re.I)

# What that shape also matches, and must not: a season-pinned roster path.
# `/roster/2025`, `/roster/2025-26` and `/roster/season/2025` all fit the bio
# pattern's slug, and `variants.ladder` only escapes the collision because it
# tests the season-bearing branch first. Here the two are asked independently,
# so the exclusion has to be stated. Missing it classified every season-pinned
# reference L7W set out to find as a player bio.
NOT_A_SLUG = re.compile(r'^(?:20\d\d(?:-(?:\d\d|20\d\d))?|season)$', re.I)

SCHEDULE_URL = re.compile(r'/(schedule|calendar|results|standings|stats)(/|$)', re.I)


def is_bio_url(url):
    u = re.sub(r'^https?://web\.archive\.org/web/\d+(?:id_)?/', '', url or '').rstrip('/')
    m = BIO_URL.search(u)
    if not m: return False
    slug = u[m.end(1):].strip('/').split('/')[0]
    return not NOT_A_SLUG.match(slug)


def is_schedule_url(url):
    return bool(SCHEDULE_URL.search(url or ''))


def season_pinned(url):
    """Does the URL itself name a season?

    The question is about the ADDRESS, not the page: a bare path is a request
    for "now" whatever it returns today, and that is what makes it unusable as
    historical provenance a year later.
    """
    u = re.sub(r'^https?://web\.archive\.org/web/\d+(?:id_)?/', '', url or '')
    u = re.sub(r'^https?://[^/]+', '', u)
    return bool(re.search(r'/20\d\d(-\d\d|-20\d\d)?(/|$)|[-/]20\d\d$|[?&]season=20\d\d', u))


# ---------------------------------------------------------------------------
# Class-label vocabulary. A DIAGNOSTIC, and deliberately not a clause.
#
# L7V observed that five of the eleven stored references mix the abbreviated
# dialect with the spelled one and read that as rows assembled across seasons.
# It is right about four of them -- the bio captures, whose rows carry ten to
# twenty-two different source URLs -- and wrong about Iowa, whose single
# archived page renders `So.`, `Jr.` and `RS Fr.` beside `Graduate Student` and
# `Redshirt Freshman` in one payload, because the site publishes a short form
# for some class levels and only a long form for others.
#
# So vocabulary mixing is evidence of nothing on its own, and refusing a
# reference for it would have refused a good page for being transcribed
# faithfully. What actually proves rows were assembled across page states is
# how many pages they came from, which clause 8 asks directly.

ABBREV = re.compile(r'^(?:r-?|rs\s*)?(?:fr|so|jr|sr|gr|grad)\.', re.I)
SPELLED = re.compile(r'^(?:redshirt\s+|r-?)?(?:freshman|sophomore|junior|senior|'
                     r'graduate(?:\s+student)?|first[- ]year)\b', re.I)
ORDINAL = re.compile(r'^\d(?:st|nd|rd|th)\s+year\b', re.I)


def dialect(label):
    """Which vocabulary a class label is written in, or None."""
    s = (label or '').strip()
    if not s: return None
    if ABBREV.match(s): return 'ABBREV'
    if SPELLED.match(s): return 'SPELLED'
    if ORDINAL.match(s): return 'ORDINAL'
    return 'OTHER'


def dialects(labels):
    return {d for d in (dialect(x) for x in labels) if d}


def mixed_dialects(labels):
    """Whether the rows speak both the abbreviated and the spelled vocabulary.

    Reported, never decisive -- see the note above. ORDINAL is not counted:
    `1st year` beside `Freshman` is one page's own variation for its
    international players.
    """
    d = dialects(labels)
    return 'ABBREV' in d and 'SPELLED' in d


# ---------------------------------------------------------------------------

def season_established(title, html, season):
    """Whether the PAGE establishes the season. True / False / None.

    `lib.season_ok` already owns this and already answers the 2025 vs 2025-26
    question; see `SEASON_SEMANTICS` in the L7W document. Only the title is
    consulted, exactly as `variants.work` consults it -- a year appearing
    somewhere in the body may belong to a schedule, a news item or a footer.
    """
    return lib.season_ok(title, season=season)


def containers(html):
    """How many non-empty roster containers the payload declares.

    Asked of the parser's own helper so an ambiguous reference is refused on the
    same fact `parse_nuxt` and `parse_nuxt_roster` refuse on.
    """
    try:
        return len(lib._nuxt_player_lists(lib._nuxt(html) or []))
    except Exception:                                  # noqa: BLE001
        return 0


def accept(html, title, recs, url, sport, season, own_hosts, recorded_count=0,
           distinct_sources=1):
    """The contract, as eight clauses. Returns (ok, primary, reasons).

    `primary` is the one classification to report; `reasons` is every clause
    that failed, because a bare bio capture fails three of them and reporting
    one reason would hide the other two.
    """
    reasons = []
    host = underlying(url)
    allowed = {canonical_host(h) for h in own_hosts if h}

    # 1. correct institution
    if not host or host not in allowed:
        reasons.append(('INSTITUTION', 'host %r is not one of this programme\'s own' % host))
    # 7. source provenance
    archived = lib.immutable_source(url)
    if is_schedule_url(url):
        reasons.append(('PROVENANCE', 'a schedule is not a roster'))
    if is_bio_url(url):
        reasons.append(('BIO', 'one player\'s page is not a squad'))
    # 2 + 3. correct sport, and gender with it
    said = lib.sport_contradicted(title, sport)
    if said:
        reasons.append(('SPORT', 'page names another programme (%r)' % said))
    # 4. season identity -- of the page, never of the row's season column
    est = season_established(title, html, season)
    if est is not True:
        reasons.append(('SEASON', 'page does not name %d (title=%r)'
                        % (season, re.sub(r'\s+', ' ', title or '')[:70])))
    # 5. roster context
    nc = containers(html)
    if nc > 1:
        reasons.append(('CONTEXT', '%d roster containers and nothing says which' % nc))
    # 6. sufficient player rows
    n = len(recs or [])
    if n < REFERENCE_FLOOR:
        reasons.append(('FLOOR', 'only %d players parsed' % n))
    if recorded_count >= 15 and n > PLAUSIBLE_MAX * recorded_count:
        reasons.append(('FLOOR', 'implausible count %d against a recorded %d' % (n, recorded_count)))
    # 8. no mixed-season ambiguity
    #
    # One page, read once, is one page state -- so a reference discovered by
    # this stage satisfies the clause by construction, and `distinct_sources`
    # defaults accordingly. It is a parameter because the audit of an EXISTING
    # reference is the case that fails: rows carrying ten to twenty-two source
    # URLs were assembled over a season of captures and cannot be attributed to
    # one squad, whatever season the rows are filed under.
    if distinct_sources > 1:
        reasons.append(('MIXED', 'rows come from %d different pages' % distinct_sources))

    if not reasons:
        return True, ('TRUSTED_ARCHIVED' if archived else 'TRUSTED_SEASON_PINNED'), []
    return False, primary_of(reasons, url), reasons


def primary_of(reasons, url):
    """One classification from many failures, most specific first.

    A bio capture read against a bare URL fails BIO, SEASON and often FLOOR. The
    most specific true statement about it is that it is a bio page, so that is
    what gets reported; the rest stay in `reasons`.
    """
    codes = {c for c, _ in reasons}
    if 'BIO' in codes: return 'UNTRUSTED_BIO_CAPTURE'
    if 'MIXED' in codes: return 'UNTRUSTED_MIXED_SEASONS'
    if 'CONTEXT' in codes: return 'AMBIGUOUS'
    if 'SPORT' in codes or 'INSTITUTION' in codes or 'PROVENANCE' in codes: return 'UNAVAILABLE'
    if 'SEASON' in codes:
        return 'UNTRUSTED_BARE_CURRENT' if not season_pinned(url) else 'AMBIGUOUS'
    return 'UNAVAILABLE'
