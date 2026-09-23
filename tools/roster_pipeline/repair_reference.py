# -*- coding: utf-8 -*-
"""Replace a programme's historical roster reference with a season-specific one.

  RB_SEASON=2025 RB_REF=2026 python3 repair_reference.py \
      --refs refs.json --targets '<next season>/_targets.csv' [--apply]

Without `--apply` it reports and writes nothing.

WHAT IT REPAIRS, AND WHERE. The historical roster record already owns
programme, sport, season, source URL and parser: it is the season's roster
sheet, one row per player, and it is what `state.names25()` and
`state.classes25()` read when the turnover gate asks what last season's squad
was. So the repair goes there, and nothing is bolted onto the gate.

WHAT IT WILL NOT DO. It rewrites only the programmes named in the discovery
report, and only by splicing their own lines: every other line of every sheet
stays byte-identical, which is checked rather than asserted. Performance columns
-- minutes, games played, games started and the stats URL -- are carried forward
by player name, because they come from a different pipeline and a provenance
repair has no business discarding them.

WHAT IT DOES NOT TOUCH. The database. A closed season's `roster_players` rows
serve matching and Evidence, the importer has no key scoping, and re-importing
2025 to follow this would rewrite two thousand programmes to fix five. The
divergence is real and is reported as debt rather than resolved here.
"""
import argparse
import collections
import csv
import io
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib          # noqa: E402
import run          # noqa: E402
import state        # noqa: E402
from paths import season_dir  # noqa: E402

# A live season-pinned page read directly is the institution publishing its own
# history; a capture is a copy of it. `variants.py` draws the same distinction
# in the same words, and the confidence column carries it forward.
CONFIDENCE = {'TRUSTED_SEASON_PINNED': 'High', 'TRUSTED_ARCHIVED': 'Medium'}

CARRY = ('Total Minutes Played', 'Games Played', 'Games Started', 'Source Stats URL')

norm = lambda s: re.sub(r'[^a-z]', '', (s or '').lower())     # noqa: E731


def sheet_path(division, sport, season):
    import write_out
    return os.path.join(season_dir(season), write_out.FILES[(division, sport)])


def splice(raw, school, new_lines, where='<text>'):
    """Replace exactly one school's lines, leaving every other byte alone.

    A full rewrite through `csv.writer` is not byte-stable -- it re-quotes
    fields the original left bare -- so a rewritten sheet would report every
    programme as changed and make "what did this stage touch?" unanswerable.
    One line per row holds for every sheet, and each line begins with its own
    School field, so the splice is exact.
    """
    lines = raw.splitlines(keepends=True)
    rows = list(csv.reader(io.StringIO(raw)))
    assert len(lines) == len(rows), '%s: %d lines vs %d rows' % (where, len(lines), len(rows))
    out, replaced, at = [lines[0]], 0, None
    for i in range(1, len(lines)):
        if rows[i][0] == school:
            if at is None:
                at = len(out)
                out.extend(new_lines)
            replaced += 1
            continue
        out.append(lines[i])
    if at is None:                       # the programme had no rows at all
        out.extend(new_lines)
    return ''.join(out), replaced


def as_lines(rows, header):
    buf = io.StringIO(newline='')
    w = csv.writer(buf, lineterminator='\n')
    for r in rows:
        w.writerow([r.get(h, '') for h in header])
    return buf.getvalue().splitlines(keepends=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--refs', required=True)
    ap.add_argument('--targets', required=True)
    ap.add_argument('--apply', action='store_true')
    a = ap.parse_args()

    season = lib.SEASON
    refs = {r['key']: r for r in json.load(open(a.refs, encoding='utf-8'))['results']}
    found = {k: r for k, r in refs.items() if r.get('found')}

    traw = open(a.targets, encoding='utf-8', newline='').read()
    theader = list(csv.reader(io.StringIO(traw)))[0]
    trows = list(csv.DictReader(io.StringIO(traw)))
    targets = {r['School'] + '||' + r['Sport']: r for r in trows}

    # The existing rows, for carry-forward and for the comparison.
    #
    # Keyed off `write_out.FILES` and not `state.FILEMAP`: FILEMAP names the
    # REFERENCE season's files, which for a repair of 2025 are 2026's, and
    # joining those names to the 2025 directory silently found nothing and
    # reported every programme as having no prior rows to carry forward.
    import write_out
    existing = collections.defaultdict(dict)
    for (div, sp), f in write_out.FILES.items():
        p = os.path.join(season_dir(season), f)
        if not os.path.exists(p): continue
        for r in csv.DictReader(open(p, encoding='utf-8')):
            existing[r['School'] + '||' + sp][norm(r['Player Name'])] = r

    report = {}
    by_sheet = collections.defaultdict(list)
    for k, r in sorted(found.items()):
        t = targets[k]
        conf = CONFIDENCE[r['type']]
        note = ('season-specific %d reference: %s read of %s'
                % (season, r['parser'], r['url']))
        built = run.build(r['recs'], t, r['url'], conf, note)
        built = [b for b in built if norm(b['Player Name'])]
        old = existing.get(k, {})
        carried = 0
        for b in built:
            o = old.get(norm(b['Player Name']))
            if not o: continue
            if any((o.get(c) or '').strip() for c in CARRY): carried += 1
            for c in CARRY:
                b[c] = o.get(c, '')
        report[k] = dict(type=r['type'], url=r['url'], parser=r['parser'], confidence=conf,
                         old_rows=len(old), new_rows=len(built), carried=carried,
                         lost=len([n for n in old
                                   if n not in {norm(b['Player Name']) for b in built}
                                   and any((old[n].get(c) or '').strip() for c in CARRY)]))
        by_sheet[(t['Division'], t['Sport'])].append((t['School'], built))

    print('REPAIR — season %d, %d programme(s)%s' % (season, len(found),
                                                     '' if a.apply else '   [dry run]'))
    for k, v in sorted(report.items()):
        print('  %-34s %-22s %3d -> %3d rows   %s carried, %s stats rows dropped'
              % (k, v['type'], v['old_rows'], v['new_rows'], v['carried'], v['lost']))
        print('      %s  (%s, %s)' % (v['url'], v['parser'], v['confidence']))

    touched = []
    for (div, sp), items in sorted(by_sheet.items()):
        path = sheet_path(div, sp, season)
        original = open(path, encoding='utf-8', newline='').read()
        header = list(csv.reader(io.StringIO(original)))[0]
        text = original
        for school, built in items:
            text, n = splice(text, school, as_lines(built, header), os.path.basename(path))
            print('    %-46s %-26s replaced %d line(s)' % (os.path.basename(path), school, n))
        # Every line belonging to a programme this run did not name must survive
        # unchanged. Checked, because a byte-stable splice is the whole claim.
        schools = {s for s, _ in items}
        keep = lambda t: [ln for ln, row in zip(t.splitlines(keepends=True),
                                                csv.reader(io.StringIO(t)))
                          if row and row[0] not in schools]
        assert keep(original) == keep(text), '%s: untouched lines moved' % path
        print('    %-46s %d untouched line(s) byte-identical' % ('', len(keep(text))))
        touched.append((path, text))

    if not a.apply:
        print('\n  nothing written.')
        json.dump(report, open('/dev/stdout', 'w'), indent=1) if False else None
        return report

    for path, text in touched:
        before = open(path, encoding='utf-8', newline='').read()
        open(path, 'w', encoding='utf-8', newline='').write(text)
        print('    wrote %s  %d -> %d bytes' % (os.path.basename(path), len(before), len(text)))

    # the worklist's summary view of the same fact
    for k, v in report.items():
        targets[k][f'Roster URL {season} (known good)'] = v['url']
        targets[k][f'{season} Player Count'] = str(v['new_rows'])
    buf = io.StringIO(newline='')
    w = csv.writer(buf, lineterminator='\n')
    w.writerow(theader)
    for r in trows: w.writerow([r.get(h, '') for h in theader])
    open(a.targets, 'w', encoding='utf-8', newline='').write(buf.getvalue())
    print('    wrote %s' % os.path.basename(a.targets))
    return report


if __name__ == '__main__':
    main()
