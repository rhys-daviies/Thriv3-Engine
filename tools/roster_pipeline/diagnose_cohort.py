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

ALGORITHM = 'L7R/ladder-walk-evaluate/v1'


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


def classify(note, fetched_any, parsed):
    s = note or ''
    if re.search(r'repeats \d+% of the', s):
        return 'TURNOVER_REFUSED'
    if 'page season is not' in s:
        return 'PAGE_PRIOR_SEASON'
    if 'implausible' in s:
        return 'IMPLAUSIBLE_COUNT'
    if re.search(r'too few players parsed \([1-4]\)', s):
        return 'THIN_PARSE'
    if 'too few players parsed (0)' in s:
        return 'PARSE_ZERO' if fetched_any else 'SITE_UNREACHABLE'
    return 'OTHER'


def diagnose(key, row):
    out = {'key': key, 'school': row['School'], 'sport': row['Sport'],
           'division': row['Division'], 'gender': 'M' if row['Sport'] == 'mens-soccer' else 'W'}
    ladder = V.ladder(row['_cand'], row[f'Roster URL {state.REF} (known good)'])
    cnt = prior_players(row)
    best = None
    fetched_any = False
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
        rungs.append({'ordinal': ordinal, 'url': url, 'parser': parser, 'n': n,
                      'result': 'OK' if ok else note[:120]})
        if ok:
            aged, moved = run.returners_aged(
                [(x['name'], x['cls']) for x in run._players(recs)], key)
            out.update(mechanism='WOULD_RESOLVE_NOW', url=url, ordinal=ordinal, parser=parser,
                       n=n, overlap=run.overlap(recs, key), aged=aged, moved=moved,
                       note=note, rungs=rungs)
            return out
        if best is None or n > best['n']:
            best = {'url': url, 'ordinal': ordinal, 'parser': parser, 'n': n, 'note': note}
    if best is None:
        out.update(mechanism='SITE_UNREACHABLE', rungs=rungs, n=0)
        return out
    out.update(mechanism=classify(best['note'], fetched_any, best['n']),
               url=best['url'], ordinal=best['ordinal'], parser=best['parser'],
               n=best['n'], note=best['note'], rungs=rungs)
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
               'digests': {m: digest([r['key'] for r in res if r['mechanism'] == m]) for m in by}}
    json.dump(payload, open(a.out, 'w', encoding='utf-8'), indent=1)
    print(f'{len(res)} diagnosed  ({ALGORITHM})')
    for m, n in sorted(by.items(), key=lambda x: -x[1]):
        print(f'  {n:4}  {m:20} digest {payload["digests"][m]}')


if __name__ == '__main__':
    main()
