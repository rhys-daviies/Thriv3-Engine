# -*- coding: utf-8 -*-
"""Driver: acquire 2024 rosters. Stages are idempotent and resumable."""
import sys, os, re, json, time, argparse, threading, collections
from concurrent.futures import ThreadPoolExecutor, as_completed
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, state

# Acquiring the CURRENT season is not the same problem as backfilling a past
# one. A backfill can insist the page name its season, because it is asking for
# an archived view that a site labels. The live page usually carries no year at
# all -- it is the only roster the site has -- so the season has to be proved a
# different way: the squad must have turned over. Measured on 2022->23, 23->24
# and 24->25 (~1,700 programmes each), 99% of genuine rosters repeat under 85%
# of the previous season's names; a stale page served back to us scores ~100%.
CURRENT = os.environ.get('RB_CURRENT') == '1'
TURNOVER_MAX = 0.85

# WHAT THE NAME GATE CANNOT SEE.
#
# The gate above asks one question -- how many of these names are last
# season's -- and its own refusal message admits it cannot answer the next one:
# "either last season served back, or a 2026 page listing only returners". L7Q
# measured twenty programmes it had refused and found both kinds in the same
# bucket. Bentley's 2026 page repeats 87% of the 2025 squad, names 2026, and
# every one of its 26 returners is exactly one year older. Frostburg State's
# also names 2026, repeats 97%, and not one of its 30 returners has moved.
#
# So the second question is asked of the column the gate was discarding. A
# returning player's GRADUATION year is the same fact in both seasons, while
# the LABEL that implies it has to change: So. in 2025 and Jr. in 2026 both
# mean 2029. A page served back keeps the label, and the implied year slips.
#
# Measured over the 1,872 accepted 2026 rosters that have four or more
# comparable returners, the fraction one year older has median 1.00 and mean
# 0.95, and 95.8% sit at or above 0.75; the served-back page scores 0.00. The
# threshold is in that empty middle rather than near either cluster.
#
# This can only ADMIT a page the name gate refuses. Nothing that passes today
# reaches it, so no accepted roster can change.
RETURNER_AGED_MIN = 0.75
RETURNER_AGED_COUNT = 3
RETURNER_COMPARABLE_MIN = 4

N25 = None
CLS25 = None
_pl = threading.Lock()
done = collections.Counter()


def returners_aged(pairs, k, season=None):
    """Of the returning players, how many got a year older, and how many did not.

    `pairs` is (name, class label). A returner counts as AGED when the label
    changed and the graduation year it implies did not, and as MOVED when the
    implied year changed -- which a real player's cannot. Players whose class
    cannot be resolved on either side, or whose label states an explicit year
    and therefore cannot age, are counted in neither: they carry no evidence.
    """
    global CLS25
    if CLS25 is None: CLS25 = state.classes25()
    base = CLS25.get(k)
    if not base: return 0, 0
    s = int(season or lib.SEASON)
    aged = moved = 0
    for name, cls in pairs:
        n = re.sub(r'[^a-z]', '', (name or '').lower())
        old = base.get(n)
        if n not in base: continue
        a = lib.grad_for_season(old, s - 1)
        b = lib.grad_for_season(cls, s)
        if not a or not b: continue
        if a == b:
            # An unchanged label that implies the same year is an explicit
            # class-of value ("'29"), which is invariant by construction and
            # says nothing about which season the page is for.
            if re.sub(r'[^a-z]', '', (old or '').lower()) != re.sub(r'[^a-z]', '', (cls or '').lower()):
                aged += 1
        else:
            moved += 1
    return aged, moved


def aged_into_season(pairs, k, season=None):
    """Does the class data positively say this page is the LATER season?

    Deliberately unanimous-ish and deliberately blind to how many names repeat:
    it is the independent second opinion, so it must not be a restatement of
    the first. Returns (ok, note).
    """
    aged, moved = returners_aged(pairs, k, season)
    total = aged + moved
    if total < RETURNER_COMPARABLE_MIN:
        return False, 'too few comparable returners (%d)' % total
    if aged < RETURNER_AGED_COUNT:
        return False, '%d of %d returners are a year older' % (aged, total)
    if aged / total < RETURNER_AGED_MIN:
        return False, '%d of %d returners are a year older' % (aged, total)
    return True, '%d of %d returners are exactly one year older' % (aged, total)

def _players(recs):
    """The parsed records that are really players, with their fields cleaned.

    SINGLE SOURCE OF TRUTH. This filter used to live inside build() while
    evaluate() measured the raw parse, so the turnover gate was computed on rows
    that were about to be thrown away: coaches, trainers and bare names all
    counted as "new" names because they never appear in the reference PLAYER
    list. That ran the gate low by up to 33 points and let stale rosters through
    -- La Roche measured 70% turned over while shipping 100% of last year's
    squad. Anything that decides "is this a player" belongs here, not in a caller.
    """
    out = []
    for p in recs or []:
        nm = lib.clean_name(p.get('name'))
        if not nm: continue
        # roster pages often render coaches and support staff in the same markup
        if lib.is_staff(p.get('pos'), p.get('home')): continue
        if lib.name_is_staff(nm): continue
        out.append({'name': nm, 'cls': lib.clean_cls(p.get('cls')),
                    'home': lib.clean_home(p.get('home')), 'pos': lib.position(p.get('pos'))})
    # Some sites encode the class as a bare 1..5. Decide that per PAGE, not per
    # row: a jersey column would run past 5 and be unique per player, so "every
    # value is a repeated digit in 1..5" is unambiguous where one row is not.
    vals = [x['cls'].strip() for x in out if x['cls'].strip()]
    if vals and all(v in ('1', '2', '3', '4', '5') for v in vals) and len(set(vals)) > 1:
        NUM = {'1': 'Fr.', '2': 'So.', '3': 'Jr.', '4': 'Sr.', '5': 'Gr.'}
        for x in out:
            if x['cls'].strip() in NUM: x['cls'] = NUM[x['cls'].strip()]
    # A row with no class, no position and no hometown is a bare name. When the
    # rest of the page does expose those fields, such a row is the staff block
    # bleeding into the same markup -- but only drop them once the page has
    # proved it publishes the fields at all.
    hf = [x for x in out if x['cls'] or x['pos'] or x['home']]
    if hf and len(hf) >= 5: out = hf
    seen, ded = set(), []
    for x in out:
        kk = x['name'].lower()
        if kk in seen: continue
        seen.add(kk); ded.append(x)
    return ded

def overlap(recs, k):
    """Fraction of shipped PLAYER names that appear in the reference roster."""
    if not N25: return None
    s = N25.get(k)
    if not s or not recs: return None
    got = [re.sub(r'[^a-z]', '', x['name'].lower()) for x in _players(recs)]
    got = [g for g in got if g]
    if not got: return None
    return sum(1 for g in got if g in s) / len(got)

def evaluate(recs, title, k, cnt25, url, strict_season=True):
    """Return (ok, note). Rejects pages that are really the 2025 roster."""
    if not recs or len(recs) < 5: return False, 'too few players parsed (%d)' % (len(recs) if recs else 0)
    ok_season = lib.season_ok(title)
    ov = overlap(recs, k)
    admitted = None
    if ok_season is False:
        return False, 'page season is not %d (title=%r)' % (lib.SEASON, (title or '')[:60])
    # WHOSE ROSTER IS THIS, before anything about turnover.
    #
    # The key carries the sport, so no signature changes. Asked first because
    # turnover is a statement ABOUT a squad and is meaningless until we know the
    # squad is this programme's: Oklahoma State's equestrian page passed the
    # turnover gate precisely because its athletes are unrelated to the soccer
    # roster. See `lib.sport_contradicted`.
    said = lib.sport_contradicted(title, k.split('||')[-1])
    if said:
        return False, 'page is not this programme\'s roster (title=%r)' % said
    # In CURRENT mode the gate applies even when the title names the season. A
    # site can flip its season label and URL before it swaps the roster content,
    # and 40 of 46 stale 2026 pages passed on exactly that: the page said 2026
    # while serving the 2025 squad. Self-declared metadata is not evidence that
    # the underlying data changed.
    gate = TURNOVER_MAX if CURRENT else 0.93
    if ov is not None and ov >= gate and (CURRENT or ok_season is not True):
        # The page must say which season it is AND its returners must have aged.
        # Either alone is self-declared metadata or a coincidence; together they
        # are two independent readings of the same page agreeing.
        aged_ok, why = (aged_into_season(
            [(x['name'], x['cls']) for x in _players(recs)], k) if ok_season is True else (False, 'title does not name the season'))
        if not aged_ok:
            return False, ('roster repeats %.0f%% of the %d squad (gate %.0f%%)%s - either last '
                           'season served back, or a %d page listing only returners; %s'
                           % (ov * 100, state.REF, gate * 100,
                              '' if ok_season is not True else ', despite the page naming %d' % lib.SEASON,
                              lib.SEASON, why))
        # Admitted, but not yet accepted: the checks below still apply. They
        # cannot in fact both fire -- a page repeating 85% of an N-player squad
        # cannot also be 2.6N long -- and the point is that nothing has to
        # reason about that. An admission removes one refusal, not the rest.
        admitted = why
    # only an upper bound, and only against a credible baseline: a few 2025
    # rosters are themselves short (Purdue 10, LSU 13, Auburn 14), so a small
    # 2025 count says nothing about a plausible 2024 count
    if cnt25 >= 15 and len(recs) > 2.6 * cnt25:
        return False, 'implausible player count %d vs %d %d' % (len(recs), state.REF, cnt25)
    n = []
    if ov is not None: n.append('%d name overlap %.0f%%' % (state.REF, ov * 100))
    if admitted: n.append('admitted because the page names %d and %s' % (lib.SEASON, admitted))
    return True, '; '.join(n)

def build(recs, r, src_url, conf, note, stats_url=''):
    out = []
    for p in _players(recs):
        nat, ctry = lib.geo(p['home'])
        out.append({'School': r['School'], 'Conference': r['Conference'], 'Player Name': p['name'],
                    'Class/Year': p['cls'], 'Total Minutes Played': '', 'Games Played': '',
                    'Games Started': '', 'Nationality': nat, 'Hometown': p['home'], 'Country': ctry,
                    'Source Stats URL': stats_url, 'Source Roster URL': src_url,
                    'Data Confidence': conf, 'Notes': note,
                    'Estimated Graduation': lib.grad_for_season(p['cls'], lib.SEASON),
                    'Position': p['pos']})
    return out

def try_url(url, r, k, conf, note_prefix, wb=False):
    st, html = lib.fetch(url)
    if st != 200 or not html: return None, 'fetch %s' % st
    recs, title, parser = lib.parse_any(html)
    cnt25 = int(r[f'{state.REF} Player Count'] or 0)
    ok, why = evaluate(recs, title, k, cnt25, url)
    if not ok: return None, why
    note = (note_prefix + ('; ' if note_prefix and why else '') + why).strip('; ')
    rows = build(recs, r, url, conf, note)
    if len(rows) < 5: return None, 'only %d usable rows' % len(rows)
    return {'rows': rows, 'parser': parser, 'title': title, 'url': url, 'n': len(rows)}, None

# ------------------------------------------------------------------ stages
def stage_direct(rows, st, workers=10):
    todo = [r for r in rows if st.get(state.key(r), {}).get('status') != 'done'
            and r['Method'].startswith('year-swap') and r['_cand']]
    print('stage_direct: %d rows' % len(todo)); sys.stdout.flush()
    def work(r):
        k = state.key(r)
        res, err = try_url(r['_cand'], r, k, 'High', f'direct read of official {lib.SEASON} roster page')
        return r, k, res, err
    _drive(todo, work, st, 'direct', workers)

def stage_wayback(rows, st, workers=6, only=None):
    todo = [r for r in rows if st.get(state.key(r), {}).get('status') != 'done'
            and (only is None or state.key(r) in only)]
    if only is None:
        todo = [r for r in todo if r['Method'].startswith('wayback')]
    print('stage_wayback: %d rows' % len(todo)); sys.stdout.flush()
    def work(r):
        k = state.key(r)
        base = r['_cand'] or r[f'Roster URL {state.REF} (known good)']
        base = re.sub(r'^https?://web\.archive\.org/web/\d+(?:id_)?/', '', base)
        cands = [base]
        # also try the year-less form and the 2024 form
        b2 = re.sub(r'/20\d\d(-\d\d)?/?$', '', base)
        if b2 and b2 != base: cands.append(b2)
        if not re.search(r'/20\d\d', base):
            cands.append(base.rstrip('/') + f'/{lib.SEASON}')
        err = 'no snapshot'
        for c in cands:
            ts = lib.cdx(c)
            if not ts: continue
            # prefer snapshots in the heart of the season
            ts.sort(key=lambda t: abs(int(t[:8]) - int(f'{lib.SEASON}1015')))
            for t in ts[:4]:
                res, e = try_url(lib.wb_url(t, c), r, k, 'Medium',
                                 'Wayback snapshot %s of %s' % (t, c))
                if res: return r, k, res, None
                err = e or err
        return r, k, None, err
    _drive(todo, work, st, 'wayback', workers)

def _drive(todo, work, st, label, workers):
    if not todo: return
    t0 = time.time(); n = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(work, r) for r in todo]
        for f in as_completed(futs):
            n += 1
            try: r, k, res, err = f.result()
            except Exception as e:
                print('  ERR', type(e).__name__, e); continue
            # Same merge policy as the runner's absorb step, because they are the
            # same question asked by two processes. `_drive` used to overwrite a
            # `done` with a `failed` outright; only the `todo` filter upstream
            # kept that from demoting a good roster.
            if res:
                state.merge_attempt(st, k, {
                    'status': 'done', 'stage': label, 'url': res['url'], 'parser': res['parser'],
                    'n': res['n'], 'rows': res['rows'], 'title': res.get('title', '')})
                done['ok'] += 1
            else:
                state.merge_attempt(st, k, {'status': 'failed', 'stage': label, 'err': err})
                done['fail'] += 1
            if n % 50 == 0:
                state.save(st)
                el = time.time() - t0
                print('  [%s] %d/%d ok=%d fail=%d %.0fs (%.1f/s)' % (label, n, len(todo), done['ok'], done['fail'], el, n / max(el, 1)))
                sys.stdout.flush()
    state.save(st)
    print('  [%s] complete: %d processed' % (label, n)); sys.stdout.flush()

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('stage')
    ap.add_argument('--workers', type=int, default=10)
    ap.add_argument('--limit', type=int, default=0)
    a = ap.parse_args()
    N25 = state.names25()
    rows = state.attempt_targets()
    if a.limit: rows = rows[:a.limit]
    st = state.load()
    if a.stage == 'direct': stage_direct(rows, st, a.workers)
    elif a.stage == 'wayback': stage_wayback(rows, st, a.workers)
    print(dict(done))
