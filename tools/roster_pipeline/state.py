import csv, glob, json, os, re, threading, collections
HERE=os.path.dirname(os.path.abspath(__file__))
import sys
sys.path.insert(0, HERE)
from paths import season_dir
SEASON=int(os.environ.get('RB_SEASON','2024'))
# The verified season we compare against. For a backfill that is the season
# AFTER the target (2024 checks itself against 2025). For the CURRENT season
# there is no later season to hold, so RB_REF points at the one before.
REF=int(os.environ.get('RB_REF', SEASON+1))
T24=os.path.join(season_dir(SEASON), '_targets.csv')
D25=season_dir(REF)
# NOT in the scratchpad: a session restart wipes that directory, and this file
# is the only record of work already done.
DURABLE=os.path.join(season_dir(SEASON), '_state')
os.makedirs(DURABLE,exist_ok=True)
STATE=os.path.join(DURABLE,f'state{SEASON}.json')
_lock=threading.Lock()

def key(r): return r['School']+'||'+r['Sport']

def fix_url(u):
    """Repair the year-swap generator's YYYY-26 span bug -> YYYY-25."""
    if not u: return u
    return re.sub(r'/(20\d\d)-26/', lambda m: f'/{m.group(1)}-{str(int(m.group(1))+1)[-2:]}/', u)

def targets():
    rows=list(csv.DictReader(open(T24,encoding='utf-8')))
    for r in rows:
        r['_cand']=fix_url(r[f'Roster URL {SEASON} (candidate)'].strip())
    return rows


def _scope_keys():
    """Keys this RUN may attempt, or None for no key restriction."""
    path = os.environ.get('RB_KEYS', '').strip()
    if not path:
        return None
    with open(path, encoding='utf-8') as fh:
        return {ln.strip() for ln in fh if ln.strip()}


def _scope_divisions():
    """Divisions this RUN may attempt, or None for no division restriction."""
    raw = os.environ.get('RB_DIVISIONS', '').strip()
    if not raw:
        return None
    return {d.strip() for d in raw.split(',') if d.strip()}


def attempt_targets():
    """The targets THIS RUN may attempt. Membership is unchanged.

    `targets()` is the universe: every programme the registry says exists, which
    is what makes a failure retryable next season. This is the run scope, and
    the two must never be confused -- L6B's whole point is that what we managed
    to fetch does not decide who is considered.

    So a target excluded here is simply NOT ATTEMPTED. It is not marked done,
    not marked failed, not written to state, and not removed from _targets.csv.
    Next run, with no filter, it is eligible again exactly as before.

    Set by RB_KEYS (a file of 'School||Sport' lines) and RB_DIVISIONS (a comma
    list matching the Division column verbatim). Both empty means the full
    universe, which is the previous behaviour. Both set means the INTERSECTION.

    Read from the environment rather than passed as arguments because the
    runner drives half a dozen stages as separate processes; an exported
    variable reaches all of them and cannot be dropped by a stage that forgot
    to forward a flag.
    """
    keys = _scope_keys()
    divisions = _scope_divisions()
    rows = targets()
    if keys is not None:
        rows = [r for r in rows if key(r) in keys]
    if divisions is not None:
        rows = [r for r in rows if r['Division'] in divisions]
    return rows

def load():
    if os.path.exists(STATE):
        return json.load(open(STATE,encoding='utf-8'))
    return {}

def save(st):
    # The tmp name must be unique per writer. A shared '.tmp' is safe against
    # threads (the lock covers them) but not against PROCESSES: the runner's
    # absorb step and a stage's last write raced, one replaced the file the
    # other was about to replace, and the loser died on FileNotFoundError.
    with _lock:
        tmp='%s.%d.%d.tmp'%(STATE,os.getpid(),threading.get_ident())
        json.dump(st,open(tmp,'w',encoding='utf-8'),ensure_ascii=False)
        os.replace(tmp,STATE)

# ---------------------------------------------------------------------------
# MERGING AN ATTEMPT INTO DURABLE STATE
#
# One owner, because there were two and they disagreed.
#
# `run.py::_drive` writes in-process and always overwrites, accumulating a
# `tried` line per attempt. The runner's `absorb` step merged the stage files
# written by the separate `variants.py`, `selector.py` and `browse.py`
# processes, and it was a four-line heredoc inside `run_season_current.sh`:
#
#     if v['status']=='done' and main.get(k,{}).get('status')!='done': main[k]=v
#     elif v['status']!='done' and k not in main:                      main[k]=v
#
# Read those two conditions as a table and three of the four cases are wrong:
#
#   failed -> failed   `k not in main` is false, so the merge is SKIPPED. The
#                      FIRST failure a programme ever recorded wins forever.
#                      Every one of the ten remaining NCAA gaps still reports
#                      `stage: variants / no candidate` from L6D, including
#                      Wisconsin-Oshkosh, which L7H proved is a 2027 programme,
#                      and Southwest Minnesota State, which L7G proved serves a
#                      women's bio at a men's-soccer path. Three stages have had
#                      to re-derive residual classifications live because of it.
#
#   done   -> done     `main[k].status != 'done'` is false, so a newer
#                      successful acquisition is DISCARDED. A deliberate refresh
#                      silently does nothing.
#
#   done   -> failed   skipped, which is the one case the old shape got right,
#                      and by accident rather than intent.
#
# So the rules are written down here, once, and both writers use them.
# ---------------------------------------------------------------------------

# How many attempt lines a key keeps. Bounded because the fix makes `tried`
# grow where it previously could not: before it, a failure never merged into an
# existing key at all, and the longest `tried` in 2,138 live entries is 2. A
# current-season run has four acquiring stages, so twelve is three full runs of
# history -- enough to see what a programme has been refusing to do, and a
# ceiling rather than a place for a log to accumulate.
TRIED_MAX = 12

# Why an attempt failed, normalised from the reason the stage already wrote.
#
# DERIVED, NEVER AUTHORITATIVE. The raw `err` string stays exactly as the stage
# produced it and is the evidence; this is an index over it, so a residual can
# be counted without re-running an acquisition. 96 distinct reason strings in
# live state collapse into these six.
#
# These are ACQUISITION-ENGINE outcomes. They are deliberately NOT the residual
# vocabulary an operator reports -- SOURCE_NOT_AVAILABLE, PROGRAMME_STATUS_
# QUESTION, SITE_TEMPORARILY_UNAVAILABLE, MANUAL_REVIEW, NO_HOST. Those are
# product judgements made by a person who looked at a site: "Soccer (Coming in
# 2027)" in a navigation menu is what makes Wisconsin-Oshkosh a programme-status
# question, and no engine said that. The engine can say the page named the wrong
# season; only a person can say the programme does not exist yet. Collapsing the
# two would let the pipeline manufacture a diagnosis it never established.
NO_CANDIDATE = 'NO_CANDIDATE'            # nothing to try: no URL, no host
ROUTE_FAILURE = 'ROUTE_FAILURE'          # the request itself did not land
SEASON_MISMATCH = 'SEASON_MISMATCH'      # the page names a different season
TURNOVER_REFUSED = 'TURNOVER_REFUSED'    # last season's squad served back
PARSER_FLOOR = 'PARSER_FLOOR'            # a page, too few usable rows
CONTENT_UNREADABLE = 'CONTENT_UNREADABLE'  # reached it, could not read a squad
UNCLASSIFIED = 'UNCLASSIFIED'

_CLASSES = (
    (re.compile(r'no candidate|no trusted host|not attempted', re.I), NO_CANDIDATE),
    (re.compile(r'->\s*fetch\b|^fetch \d|unreachable', re.I), ROUTE_FAILURE),
    (re.compile(r'page season is not|season \d{4}, not', re.I), SEASON_MISMATCH),
    (re.compile(r'roster repeats \d+% of the', re.I), TURNOVER_REFUSED),
    (re.compile(r'too few players parsed|only \d+ usable rows|implausible player count', re.I), PARSER_FLOOR),
    (re.compile(r'renders client-side|nothing parsed|no roster markup', re.I), CONTENT_UNREADABLE),
)


def classify_failure(err):
    """One of the classes above, from the reason string a stage wrote."""
    text = str(err or '')
    if not text.strip():
        return UNCLASSIFIED
    for pat, klass in _CLASSES:
        if pat.search(text):
            return klass
    return UNCLASSIFIED


def _tried(entry, attempt):
    """The attempt history, oldest first, bounded."""
    prior = list(entry.get('tried') or [])
    line = '%s: %s' % (attempt.get('stage') or '?', attempt.get('err') or 'failed')
    return (prior + [line])[-TRIED_MAX:]


def merge_attempt(main, k, attempt):
    """Fold one attempt into durable state. Returns what it did, for counting.

    PRECEDENCE, and every case is deliberate:

      absent  -> anything   record it
      failed  -> failed     REPLACE: the newest diagnosis is the truthful one
      failed  -> done       REPLACE: an acquisition supersedes a refusal
      done    -> done       REPLACE: a newer successful read is a better one
      done    -> failed     KEEP the success, and record the failure in `tried`

    The last is the asymmetry that matters. A stage file is a cache, and a
    failure in one is not evidence that a roster we hold is bad -- it is
    evidence that one attempt did not land. Demoting a good roster on that is
    how a season's work disappears.

    Demotion is a real operation and it belongs to whoever can actually judge
    it: `verify_gate.py` re-measures shipped rows against the gate in force now
    and writes `failed` DIRECTLY, then purges the stage files so the next absorb
    cannot resurrect what it demoted. That path is untouched by this function
    and must stay that way.
    """
    prev = main.get(k)
    incoming = dict(attempt)
    if incoming.get('status') == 'done':
        main[k] = incoming
        return 'resolved' if not prev or prev.get('status') != 'done' else 'refreshed'
    incoming['failure_class'] = classify_failure(incoming.get('err'))
    if prev is None:
        incoming['tried'] = _tried({}, incoming)
        main[k] = incoming
        return 'recorded'
    if prev.get('status') == 'done':
        # The success stands. The attempt is still worth keeping as history.
        prev['tried'] = _tried(prev, incoming)
        main[k] = prev
        return 'kept-success'
    incoming['tried'] = _tried(prev, incoming)
    main[k] = incoming
    return 'rediagnosed'


def absorb(pattern):
    """Merge every stage file matching `pattern` into durable state.

    Sorted so a run is reproducible, and the whole merge policy is
    `merge_attempt` -- this function chooses only what to feed it.
    """
    main = load()
    counts = collections.Counter()
    for f in sorted(glob.glob(pattern)):
        for k, v in json.load(open(f, encoding='utf-8')).items():
            counts[merge_attempt(main, k, v)] += 1
    save(main)
    return counts


FILEMAP={('NCAA D1','mens-soccer'):f'ncaa_d1_mens_soccer_{REF}_rosters.csv',
         ('NCAA D1','womens-soccer'):f'ncaa_d1_womens_soccer_{REF}_rosters.csv',
         ('NCAA D2','mens-soccer'):f'ncaa_d2_mens_soccer_{REF}_rosters.csv',
         ('NCAA D2','womens-soccer'):f'ncaa_d2_womens_soccer_{REF}_rosters.csv',
         ('NCAA D3','mens-soccer'):f'ncaa_d3_mens_soccer_{REF}_rosters.csv',
         ('NCAA D3','womens-soccer'):f'ncaa_d3_womens_soccer_{REF}_rosters.csv',
         # NAIA joined the worklist for 2026. names25() keys on School||Sport
         # with no division, so this is only safe because no NAIA school shares
         # a name with an NCAA one in the same sport -- checked, 0 collisions.
         ('NAIA','mens-soccer'):f'naia_mens_soccer_{REF}_rosters.csv',
         ('NAIA','womens-soccer'):f'naia_womens_soccer_{REF}_rosters.csv',
         ('USCAA','mens-soccer'):f'uscaa_mens_soccer_{REF}_rosters.csv',
         ('USCAA','womens-soccer'):f'uscaa_womens_soccer_{REF}_rosters.csv'}

def names25():
    """(school,sport) -> set of lowercased 2025 player names."""
    out=collections.defaultdict(set)
    for (div,sp),f in FILEMAP.items():
        p=os.path.join(D25,f)
        if not os.path.exists(p): continue
        for r in csv.DictReader(open(p,encoding='utf-8')):
            out[r['School']+'||'+sp].add(re.sub(r'[^a-z]','',r['Player Name'].lower()))
    return out


def classes25():
    """(school,sport) -> {lowercased 2025 player name: class label}.

    The same rows `names25()` reads, keeping the one column it discards. The
    turnover gate asks whether a page repeats last season's NAMES; L7Q found
    that question cannot separate "last season served back" from "a real page
    whose squad mostly returned", and that the answer is in this column.

    A returning player is one year older, so a genuine page shows Jr. where
    this one showed So. -- and the graduation year the two labels imply is the
    SAME year. A page served back shows So. again, and its implied graduation
    year has slipped a season. See `run.returners_aged`.
    """
    out=collections.defaultdict(dict)
    for (div,sp),f in FILEMAP.items():
        p=os.path.join(D25,f)
        if not os.path.exists(p): continue
        for r in csv.DictReader(open(p,encoding='utf-8')):
            n=re.sub(r'[^a-z]','',r['Player Name'].lower())
            if n: out[r['School']+'||'+sp][n]=(r.get('Class/Year') or '').strip()
    return out
