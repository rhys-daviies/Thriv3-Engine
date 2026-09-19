# -*- coding: utf-8 -*-
"""Why each programme in a cohort is still missing its current-season roster.

  RB_SEASON=2026 RB_REF=2025 RB_CURRENT=1 python3 diagnose_cohort.py \
      --keys /path/cohort.txt --out /path/diagnosis.json

READ-ONLY. It writes one JSON report and nothing else: no durable state, no
stage file, no roster sheet, no database row. It makes network requests through
`lib.fetch`, which caches, so a second run over the same cohort is cheap.

---------------------------------------------------------------------------
WHY THIS IS A SCRIPT AND NOT PROSE IN A DOCUMENT.

L7R classified 124 programmes by hand-run analysis and wrote the counts into a
stage document. L7T then has to select a cohort from that classification, and a
cohort selected from names in a document is a hand-picked cohort wearing a
number. So the classification is code: same ladder, same parsers, same gate the
production run will use, and a digest over the result so the selection can be
reproduced and disputed.

WHAT EACH ANSWER MEANS. The walk asks the pipeline's own question of every rung
the ladder offers, in order, and stops at the first rung `run.evaluate` accepts.

  WOULD_RESOLVE_NOW   a rung passes every production gate today. Nothing is
                      broken for this programme; it simply has not been re-run.
  PAGE_PRIOR_SEASON   the best page names an earlier season. A publication and
                      candidate question, not a parsing one.
  SEASON_IDENTITY_UNPROVEN
                      the page names NO season and there is no reference roster
                      to measure turnover against, so nothing established which
                      season it is. Distinct from the two above on purpose:
                      neither "it is an older season" nor "the squad repeated"
                      has been shown. L7ZH made this a refusal; before it, such
                      a page was accepted under the requested season.
  TURNOVER_REFUSED    the page is reached and read, and the turnover gate refuses
                      it -- either last season served back, or a reference too
                      poor to measure against.
  THIN_PARSE          a page is read but yields 1-4 players, under the floor.
  PARSE_ZERO          a page is reached and yields nothing at all.
  SITE_UNREACHABLE    no rung could be fetched.
  IMPLAUSIBLE_COUNT   the count is too large to be this squad.
  OTHER               a refusal none of the above describes. Deliberately not
                      folded into a neighbour: an unnamed case should look
                      unnamed.

These names are analysis. Nothing persists them, and they are not the operator
disposition vocabulary -- see shared/roster/gapReview.js for that.
"""
import argparse
import hashlib
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib          # noqa: E402
import run          # noqa: E402
import state        # noqa: E402
import variants as V  # noqa: E402

ALGORITHM = 'L7U/ladder-walk-evaluate/v2'

# v1 -> v2, and why the version had to move.
#
# v1 asked one question of each rung -- does `run.evaluate` accept it -- and
# reported the first acceptance. L7T found two programmes where that produced a
# confident wrong answer, and both are now separate classes rather than folded
# into a neighbour:
#
#   WRONG_ROSTER_CONTEXT  the page the ladder accepted is somebody else's squad.
#                         Oklahoma State's rung served a Cowgirl Equestrian
#                         roster: 90 athletes, no positions, 1% overlap. It
#                         passed BECAUSE the athletes are unrelated -- an
#                         unrelated roster reads as total turnover.
#   AMBIGUOUS_ROSTER      the payload declares more than one non-empty roster
#                         and nothing in it says which is the programme's.
#                         Drexel's two containers of 24 read as one squad of 48.
#
# Neither is fixed here by a rule of the diagnostic's own. `run.evaluate` now
# asks whose roster a page is, and `parse_nuxt` now refuses an ambiguous payload
# exactly as `parse_nuxt_roster` already did, so the diagnostic inherits both
# from the acquisition path it is supposed to be predicting. What v2 adds is the
# ability to SAY which of the two happened, instead of reporting PARSE_ZERO.
#
# WOULD_RESOLVE_NOW therefore means what the name claims: the production
# pipeline would accept this programme now. It never meant "a parser returned
# enough names", and after L7T it cannot be read that way by accident.


def targets_by_key():
    """The worklist, keyed. Via `state.targets()` so `_cand` carries the same
    URL repair the acquiring stages see -- reading the CSV directly here gave a
    row without it, which is a different candidate from the one that will be
    fetched."""
    return {state.key(r): r for r in state.targets()}


def prior_players(row):
    """The reference season's player count, as `evaluate` is given it."""
    try:
        return int((row.get(f'{state.REF} Player Count') or '0').strip() or 0)
    except ValueError:
        return 0


def classify(note, fetched_any, parsed, ambiguous=False):
    """Name the refusal, in the words the production gate used.

    Order matters. A wrong-programme page and an ambiguous payload are asked
    about before the generic "nothing parsed", because both of them PRESENT as
    nothing parsed once the gates that L7U added have done their job -- and
    reporting them as PARSE_ZERO is how L7T came to believe the parser was at
    fault for two pages that parsed perfectly well.
    """
    s = note or ''
    if 'page is not this programme' in s:
        return 'WRONG_ROSTER_CONTEXT'
    # L7ZH. Asked before the season and turnover classes below, because it is
    # the statement that NEITHER of them was established -- and folding it into
    # either would report a fact nobody measured. PAGE_PRIOR_SEASON means the
    # page named an earlier season; TURNOVER_REFUSED means the squad repeated.
    # This means the page named no season and there was no squad to compare.
    if s.startswith('season unproven:'):
        return 'SEASON_IDENTITY_UNPROVEN'
    if re.search(r'repeats \d+% of the', s):
        return 'TURNOVER_REFUSED'
    if 'page season is not' in s:
        return 'PAGE_PRIOR_SEASON'
    if 'implausible' in s:
        return 'IMPLAUSIBLE_COUNT'
    if re.search(r'too few players parsed \([1-4]\)', s):
        return 'THIN_PARSE'
    if 'too few players parsed (0)' in s:
        if not fetched_any:
            return 'SITE_UNREACHABLE'
        return 'AMBIGUOUS_ROSTER' if ambiguous else 'PARSE_ZERO'
    return 'OTHER'


# Season routes a SIDEARM-style roster page offers about ITSELF.
#
# L7ZF. PAGE_PRIOR_SEASON says the best page we reached names an earlier
# season. It does not say whether the season we asked for EXISTS, and those are
# different findings: "the site has not published 2026 yet" and "the site
# published 2026 somewhere we did not look" both arrive here as the same class.
#
# Seven programmes sat in it, and every one served the SAME page for
# `/roster/2026`, `/roster/2026-27` and the bare `/roster` -- a platform
# fallback for an unknown season, which reads exactly like a stale page. What
# separated the two readings was the page's own season menu: an enumeration,
# published by the site, of the seasons it holds. All seven topped out below
# the season asked for, which is the site saying the roster does not exist
# rather than us failing to find it.
#
# Recorded, not acted on. Nothing selects a candidate from this, and the class
# is unchanged by it -- it is the evidence a reader needs to tell C from B.
SEASON_ROUTE = re.compile(r'/roster/(20\d\d(?:-\d\d)?)\b')
SEASON_OPTION = re.compile(r'<option[^>]*value="[^"]*?(20\d\d(?:-\d\d)?)"', re.I)


def seasons_offered(html):
    """Sorted seasons the page's own navigation links to, or []."""
    if not html:
        return []
    return sorted({m.group(1) for m in SEASON_ROUTE.finditer(html)}
                  | {m.group(1) for m in SEASON_OPTION.finditer(html)})


def diagnose(key, row):
    out = {'key': key, 'school': row['School'], 'sport': row['Sport'],
           'division': row['Division'], 'gender': 'M' if row['Sport'] == 'mens-soccer' else 'W'}
    ladder = V.ladder(row['_cand'], row[f'Roster URL {state.REF} (known good)'])
    cnt = prior_players(row)
    best = None
    fetched_any = False
    ambiguous = False
    rungs = []
    for ordinal, url in enumerate(ladder):
        try:
            code, html = lib.fetch(url)
        except Exception as exc:                       # noqa: BLE001 - recorded, not raised
            rungs.append({'ordinal': ordinal, 'url': url, 'result': f'FETCH:{type(exc).__name__}'})
            continue
        if not html:
            rungs.append({'ordinal': ordinal, 'url': url, 'result': f'http:{code}'})
            continue
        fetched_any = True
        recs, title, parser = lib.parse_any(html)
        ok, note = run.evaluate(recs, title, key, cnt, url)
        n = len(recs or [])
        # Asked of the parser's own helper rather than re-derived: the number of
        # roster containers a Nuxt payload declares is the same fact
        # `parse_nuxt` and `parse_nuxt_roster` refuse on.
        containers = len(lib._nuxt_player_lists(lib._nuxt(html) or []))
        if containers > 1: ambiguous = True
        rungs.append({'ordinal': ordinal, 'url': url, 'parser': parser, 'n': n,
                      'containers': containers, 'title': re.sub(r'\s+', ' ', title or '')[:90],
                      'result': 'OK' if ok else note[:120]})
        if ok:
            aged, moved = run.returners_aged(
                [(x['name'], x['cls']) for x in run._players(recs)], key)
            out.update(mechanism='WOULD_RESOLVE_NOW', url=url, ordinal=ordinal, parser=parser,
                       n=n, overlap=run.overlap(recs, key), aged=aged, moved=moved,
                       note=note, rungs=rungs)
            return out
        if best is None or n > best['n']:
            best = {'url': url, 'ordinal': ordinal, 'parser': parser, 'n': n, 'note': note,
                    'seasons': seasons_offered(html)}
    if best is None:
        out.update(mechanism='SITE_UNREACHABLE' if not fetched_any
                   else ('AMBIGUOUS_ROSTER' if ambiguous else 'PARSE_ZERO'), rungs=rungs, n=0)
        return out
    out.update(mechanism=classify(best['note'], fetched_any, best['n'], ambiguous),
               url=best['url'], ordinal=best['ordinal'], parser=best['parser'],
               n=best['n'], note=best['note'], rungs=rungs)
    # Only where it answers something. Everywhere else it is noise in a report
    # whose job is to name one refusal per programme.
    if out['mechanism'] == 'PAGE_PRIOR_SEASON':
        offered = best.get('seasons') or []
        out['seasonsOffered'] = offered
        out['seasonsMaxOffered'] = offered[-1] if offered else None
        # The season asked for, as the site would have to spell it. Both forms,
        # because a site may publish either and neither is the pipeline's to
        # choose.
        out['seasonAskedPublished'] = (
            str(lib.SEASON) in offered
            or f'{lib.SEASON}-{str(lib.SEASON + 1)[-2:]}' in offered)
    return out


def digest(keys):
    payload = f'{ALGORITHM}\n' + '\n'.join(sorted(keys))
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--keys', required=True, help="file of 'School||Sport' lines")
    ap.add_argument('--out', required=True)
    ap.add_argument('--workers', type=int, default=6)
    a = ap.parse_args()

    lib.reset_cache_stats()
    run.N25 = state.names25()
    rows = targets_by_key()
    with open(a.keys, encoding='utf-8') as fh:
        keys = [ln.strip() for ln in fh if ln.strip()]
    missing = [k for k in keys if k not in rows]
    if missing:
        raise SystemExit(f'{len(missing)} cohort key(s) absent from the worklist: {missing[:5]}')

    with ThreadPoolExecutor(max_workers=a.workers) as ex:
        res = list(ex.map(lambda k: diagnose(k, rows[k]), keys))
    res.sort(key=lambda r: r['key'])

    by = {}
    for r in res:
        by[r['mechanism']] = by.get(r['mechanism'], 0) + 1
    payload = {'algorithm': ALGORITHM, 'cohort': len(res), 'by_mechanism': by, 'rows': res,
               'cache': dict(lib.CACHE_STATS),
               'digests': {m: digest([r['key'] for r in res if r['mechanism'] == m]) for m in by}}
    json.dump(payload, open(a.out, 'w', encoding='utf-8'), indent=1)
    print(f'{len(res)} diagnosed  ({ALGORITHM})')
    for m, n in sorted(by.items(), key=lambda x: -x[1]):
        print(f'  {n:4}  {m:22} digest {payload["digests"][m]}')
    # Freshness is auditable rather than assumed: a diagnosis that leaned on old
    # responses is exactly what L7T shipped.
    print(f'  cache  {dict(lib.CACHE_STATS)}')


if __name__ == '__main__':
    main()
