# -*- coding: utf-8 -*-
"""Write one CSV per division x sport and mark up _targets.csv."""
import sys, os, csv, json, collections, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import state
from paths import season_dir

SEASON = int(os.environ.get('RB_SEASON', '2024'))
OUT = season_dir(SEASON)
# L7Z appended three columns rather than inserting them: a reader that keys on
# names is unaffected either way, but a sheet diff stays legible when the
# existing sixteen keep their positions.
HDR = ['School','Conference','Player Name','Class/Year','Total Minutes Played','Games Played',
       'Games Started','Nationality','Hometown','Country','Source Stats URL','Source Roster URL',
       'Data Confidence','Notes','Estimated Graduation','Position',
       'Source Page Season','Source Fetched At','Source Parser']
FILES = {('NCAA D1','mens-soccer'):f'ncaa_d1_mens_soccer_{SEASON}_rosters.csv',
         ('NCAA D1','womens-soccer'):f'ncaa_d1_womens_soccer_{SEASON}_rosters.csv',
         ('NCAA D2','mens-soccer'):f'ncaa_d2_mens_soccer_{SEASON}_rosters.csv',
         ('NCAA D2','womens-soccer'):f'ncaa_d2_womens_soccer_{SEASON}_rosters.csv',
         ('NCAA D3','mens-soccer'):f'ncaa_d3_mens_soccer_{SEASON}_rosters.csv',
         ('NCAA D3','womens-soccer'):f'ncaa_d3_womens_soccer_{SEASON}_rosters.csv',
         ('NAIA','mens-soccer'):f'naia_mens_soccer_{SEASON}_rosters.csv',
         ('NAIA','womens-soccer'):f'naia_womens_soccer_{SEASON}_rosters.csv',
         ('USCAA','mens-soccer'):f'uscaa_mens_soccer_{SEASON}_rosters.csv',
         ('USCAA','womens-soccer'):f'uscaa_womens_soccer_{SEASON}_rosters.csv'}

def sheet_scope():
    """Which COMPLETE sheets this run may regenerate, or None for all of them.

    Scoping rows and scoping sheets are opposite things and only one of them is
    safe. This file rebuilds each sheet in full from durable state, which is
    right -- a sheet is the whole population of a division and sport, and
    writing only the current cohort into one would delete every other programme
    in it. But rebuilding sheets the run never touched is how an NCAA D2/D3
    acquisition came to rewrite the USCAA file from stale state, twice: L6D
    found it and restored the bytes, L7C did exactly the same thing again.

    So the rule is: the RUN SCOPE decides which sheets are opened, and nothing
    decides which rows go in a sheet that is opened. Sheet identity is
    (Division, Sport) -- the key `FILES` already uses -- derived from the
    attempt cohort rather than named anywhere, so it generalises to any future
    scope without a list of associations to skip.

    An unscoped run still writes everything, because a maintenance rebuild is a
    real operation and `attempt_targets()` is then the whole universe.
    """
    scoped = state.attempt_targets()
    if len(scoped) == len(state.targets()):
        return None
    return {(r['Division'], r['Sport']) for r in scoped}

def main():
    st = state.load()
    rows = state.targets()
    buckets = collections.defaultdict(list)
    stats = collections.Counter()
    per_file_schools = collections.defaultdict(set)
    failed = []
    # keep the target order so the files are stable and diff-friendly
    for r in rows:
        k = state.key(r)
        e = st.get(k) or {}
        f = FILES[(r['Division'], r['Sport'])]
        if e.get('status') == 'done' and e.get('rows'):
            buckets[f].extend(e['rows'])
            per_file_schools[f].add(r['School'])
            stats['schools_done'] += 1
            stats['players'] += len(e['rows'])
            stats['conf_' + (e['rows'][0]['Data Confidence'] or '?')] += 1
        else:
            stats['schools_failed'] += 1
            failed.append((r, e))
    os.makedirs(OUT, exist_ok=True)
    scope = sheet_scope()
    skipped = 0
    for (div, sp), f in FILES.items():
        if scope is not None and (div, sp) not in scope:
            skipped += 1
            continue
        p = os.path.join(OUT, f)
        with open(p, 'w', newline='', encoding='utf-8') as fh:
            w = csv.DictWriter(fh, fieldnames=HDR, lineterminator='\r\n')
            w.writeheader()
            # EVERY programme in this sheet, not just the ones this run attempted.
            for row in buckets[f]: w.writerow(row)
        print('%-42s %6d players  %4d schools' % (f, len(buckets[f]), len(per_file_schools[f])))
    if skipped:
        print('%-42s %d sheets outside the run scope, left untouched' % ('', skipped))
    # mark up _targets.csv
    T = state.T24
    src = list(csv.DictReader(open(T, encoding='utf-8')))
    fn = list(src[0].keys())
    with open(T, 'w', newline='', encoding='utf-8') as fh:
        w = csv.DictWriter(fh, fieldnames=fn, lineterminator='\r\n')
        w.writeheader()
        for r in src:
            k = r['School'] + '||' + r['Sport']
            e = st.get(k) or {}
            if e.get('status') == 'done':
                r['Status'] = 'done'
                r['Notes'] = '%s via %s; %d players; parser=%s; url=%s' % (
                    e['rows'][0]['Data Confidence'], e.get('stage','?'), e.get('n',0),
                    e.get('parser','?'), e.get('url',''))
            else:
                r['Status'] = 'failed'
                tried = e.get('tried') or ([e['err']] if e.get('err') else [])
                r['Notes'] = 'unresolved. tried: ' + (' | '.join(str(t) for t in tried) or 'no attempt recorded')
            w.writerow(r)
    print()
    print('schools done   :', stats['schools_done'])
    print('schools failed :', stats['schools_failed'])
    print('player rows    :', stats['players'])
    print('confidence     :', {k[5:]: v for k, v in stats.items() if k.startswith('conf_')})
    if failed:
        print('\nFAILED (%d):' % len(failed))
        for r, e in failed:
            print('  %-30s %-14s %-8s %s' % (r['School'][:30], r['Sport'], r['Division'],
                  (e.get('err') or 'not attempted')))
    return stats, failed

if __name__ == '__main__': main()
