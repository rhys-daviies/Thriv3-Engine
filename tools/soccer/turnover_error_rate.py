#!/usr/bin/env python3
"""
Measures how much of the observed roster turnover is an artefact of names.

Turnover is a diff: a 2024 player counts as departed when no 2025 row at the
same programme carries their name. That makes the metric only as good as the
name matching underneath it, and both seasons were scraped independently from
pages that spell people differently — accents dropped one year and kept the
next, "Alex" against "Alexander", a hyphen gained, first and last swapped.

Every one of those reads as a departure AND as an arrival, so the error does
not cancel: it inflates turnover from both ends.

This does not fix anything. It measures, by asking of each apparent departure
whether somebody plausibly the same person is on the 2025 roster of the same
programme, through progressively looser tiers. A departure matched at a loose
tier is not proven to be a spelling artefact — it is a candidate, and the tiers
are reported separately so the confident ones are not mixed with the guesses.

    python3 tools/soccer/turnover_error_rate.py
    python3 tools/soccer/turnover_error_rate.py --samples 40

Read-only. Touches nothing.
"""
import argparse
import re
import sqlite3
import unicodedata
from collections import Counter, defaultdict

DB = "file:server/data/recruitmatch.sqlite?mode=ro"
IN_SCOPE = ("NCAA D1", "NCAA D2", "NCAA D3")

SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}

# Not every loose match is the same person, and reporting one number would hide
# that. A reordering is a spelling of one name. A shared surname and initial is
# usually two people: "Connor Smith" against "Carter Smith", "Jake Provenzano"
# against "Luke Provenzano" — teammates and brothers, not variants.
CONFIDENT = {"reordered or repunctuated"}
# Classes that are supposed to leave. Used as an independent sanity signal, not
# as part of the matching.
OUTGOING = re.compile(r"^(sr|gr|grad|senior|graduate|5th|6th|r-sr|rs-sr|fifth|sixth)", re.I)


def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def norm(name):
    """Lowercase, unaccented, punctuation-free, suffixes dropped."""
    s = strip_accents(str(name or "")).lower()
    s = re.sub(r"[^a-z\s]", " ", s)
    parts = [p for p in s.split() if p and p not in SUFFIXES]
    return parts


def key_exact(parts):
    return " ".join(parts)


def key_sorted(parts):
    """Order-independent: catches "Last First" against "First Last"."""
    return " ".join(sorted(parts))


def key_initial(parts):
    """Last name plus first initial — the loosest tier, and the least certain."""
    if len(parts) < 2:
        return None
    return f"{parts[-1]}|{parts[0][0]}"


def edit_distance(a, b, cap=2):
    """Levenshtein, abandoned once it cannot come in under the cap."""
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        if min(cur) > cap:
            return cap + 1
        prev = cur
    return prev[-1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", type=int, default=25, help="examples to print per tier")
    args = ap.parse_args()

    db = sqlite3.connect(DB, uri=True)
    q = ("SELECT college_name, sport, season, player_name, class_year_label "
         "FROM roster_players WHERE division IN (?, ?, ?)")
    rosters = defaultdict(lambda: {"2024": [], "2025": []})
    for school, sport, season, name, cls in db.execute(q, IN_SCOPE):
        if season in ("2024", "2025"):
            rosters[(school, sport)][season].append((name, cls or ""))
    db.close()

    both = {k: v for k, v in rosters.items() if v["2024"] and v["2025"]}
    print(f"{len(both)} in-scope school-sports with both seasons\n")

    tally = Counter()
    examples = defaultdict(list)

    for (school, sport), seasons in both.items():
        y25 = [(n, norm(n)) for n, _ in seasons["2025"]]
        exact = {key_exact(p) for _, p in y25}
        sorted_keys = defaultdict(list)
        initial_keys = defaultdict(list)
        for n, p in y25:
            sorted_keys[key_sorted(p)].append(n)
            ki = key_initial(p)
            if ki:
                initial_keys[ki].append(n)

        for name, cls in seasons["2024"]:
            parts = norm(name)
            k = key_exact(parts)
            tally["2024 players"] += 1
            if k in exact:
                tally["stayed (exact name)"] += 1
                continue

            outgoing = bool(OUTGOING.match(cls.strip()))
            tier = None
            other = None

            ks = key_sorted(parts)
            ki = key_initial(parts)
            if ks in sorted_keys:
                tier, other = "reordered or repunctuated", sorted_keys[ks][0]
            elif ki and ki in initial_keys:
                tier, other = "same surname + first initial", initial_keys[ki][0]
            else:
                for n2, p2 in y25:
                    if edit_distance(k, key_exact(p2)) <= 2:
                        tier, other = "within 2 edits", n2
                        break

            if tier:
                tally[f"{'CONFIDENT' if tier in CONFIDENT else 'SPECULATIVE'} — {tier}"] += 1
                if len(examples[tier]) < args.samples:
                    examples[tier].append((school, sport.replace("-soccer", ""), name, other, cls))
            else:
                tally["departed — outgoing class" if outgoing else "departed — returning class"] += 1

    total = tally["2024 players"]
    stayed = tally["stayed (exact name)"]
    confident = sum(v for k, v in tally.items() if k.startswith("CONFIDENT"))
    speculative = sum(v for k, v in tally.items() if k.startswith("SPECULATIVE"))
    departed = total - stayed - confident

    print(f"{'2024 players in scope':44} {total:7}")
    print(f"{'  matched 2025 exactly':44} {stayed:7}")
    print(f"{'  no exact match':44} {total - stayed:7}")
    print()
    for k in sorted(k for k in tally if k.startswith(("CONFIDENT", "SPECULATIVE"))):
        print(f"  {k:52} {tally[k]:6}")
    print(f"  {'departed — outgoing class (Sr./Gr./5th)':52} {tally['departed — outgoing class']:6}")
    print(f"  {'departed — returning class':52} {tally['departed — returning class']:6}")
    print()

    raw = (total - stayed) / total * 100
    corrected = departed / total * 100
    upper = (total - stayed - confident - speculative) / total * 100
    apparent = total - stayed
    print(f"raw turnover          {raw:5.1f}%   every non-exact name counted as a departure")
    print(f"corrected turnover    {corrected:5.1f}%   confident artefacts removed")
    print(f"lower bound           {upper:5.1f}%   if every speculative match were also the same person")
    print()
    print(f"NAME-MISMATCH ERROR   {raw - corrected:5.1f} points confidently "
          f"({confident / apparent * 100:.1f}% of apparent departures), "
          f"at most {raw - upper:.1f} points ({(confident + speculative) / apparent * 100:.1f}%)")
    print()
    outgoing = tally["departed — outgoing class"]
    returning = tally["departed — returning class"]
    print(f"Of {outgoing + returning} real departures, {returning} "
          f"({returning / (outgoing + returning) * 100:.0f}%) are from classes that should have "
          f"returned.\nThat is the number to explain before turnover is used as a signal — it is "
          f"transfers and\nattrition, not a measurement error, and it dwarfs anything the name "
          f"matching contributes.")

    for tier, rows in examples.items():
        print(f"\n--- {tier} ---")
        for school, sport, was, now, cls in rows[:args.samples]:
            print(f"  {school[:22]:22} {sport:6} {cls[:6]:6} {was[:30]:30} -> {now[:30]}")


if __name__ == "__main__":
    main()
