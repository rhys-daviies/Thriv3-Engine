# Evidence behavioural baselines

    npm run evidence:baseline              the table
    npm run evidence:baseline -- --json    the same, for CI
    npm run evidence:baseline -- --update  rewrite the expectations, explicitly

Six fingerprints over every athlete–programme pair, plus a fingerprint of the
data they were taken over. Committed to `server/scripts/__baselines__/evidence.json`
and checked by `server/lib/evidenceBaseline.test.js`.

Stages F to H each proved their changes safe by hashing the outbound corpus
before and after, and not one of those hashes lived in the repository — the
harness was written in a scratchpad and the constant was quoted in a brief. By
H17 neither could be reproduced. This is the replacement.

## What each baseline protects

| baseline | covers | moves when |
|---|---|---|
| `OUTBOUND_DECISION` | roles, dispositions, alternatives, supersession, prefer state, personalisation flag | selection policy, qualification, the hook ladder, dedupe |
| `COACH_COMPOSITION` | structure, placement, rendered sentences, slot tokens | copy wording, flow choice, the body cap, slot assignment |
| `EMAIL_BODY` | the coach-facing text before transport | any of the above, plus the template and its blocks |
| `OPERATOR_WIRE` | the payload `/evidence` hands the panel | anything an operator reads about the decision |
| `LOG_PAYLOAD` | `primary_kind`, `hook_kind`, structure, `has_personalisation`, the ordered selected set | what we record about an email we sent |
| `OPERATOR_EVIDENCE` | the inspection payload, including `sourceUrl` | provenance and the athletics-domain registry |

They are layered, and **which subset moved localises the change before anyone
opens a diff**:

- all six — a selection or qualification change
- everything but `OUTBOUND_DECISION` — wording, placement or structure
- `EMAIL_BODY` and `OPERATOR_WIRE` only — a template block
- `OPERATOR_EVIDENCE` only — provenance; no coach-facing output moved

## The corpus

Every athlete against every programme **in that athlete's own sport** — the
union of the per-sport products, not their cross product, because an athlete is
only ever matched within their sport. 4,742 pairs today: 3 men's-soccer
athletes × 1,169 programmes, and 1 women's-soccer athlete × 1,235.

All pairs, never a sample. The rare states are the ones worth protecting —
`CURRENT_SAME_COUNTRY` renders 22 times in the whole corpus — and any sampling
rule that is not "everything" is a rule about which regressions we accept
missing.

Ordering is stated by the queries (`ORDER BY id`, `ORDER BY name`), never
inherited from the database.

## The dataset fingerprint

**A hash without a dataset identity is a number, not a baseline.** The corpus
earlier stages used was 3,498 pairs: three athletes against 1,166 programmes.
There are 1,169 now, so the same definition yields 3,507 — nine pairs of silent
drift, and every hash taken over it quietly incomparable.

So the manifest fingerprints the five tables the evidence path reads —
`players`, `colleges`, `roster_players`, `coaches`, `athletics_domains` — by row
count and by a digest of their identifying columns in a stated order. It is
checked **first**. When it has moved, the product lines are reported
`UNCOMPARABLE`, not `FAIL`:

    DATASET CHANGED — the rows moved, so the product hashes cannot be
    compared to ones taken over different rows.

A roster import is not a regression, and reporting it as six is how people learn
to repin without reading.

## What is normalised away

Exactly one thing: the **profile URL**, fixed to `https://baseline.invalid/p/FIXED`,
because it is per-send and per-environment. Everything else is content and is
hashed as it is — the compliance footer, the greeting, the signoff, every
evidence sentence. No timestamps, ids or machine paths enter any input.

## Rendered vs recorded

The command also checks, on the same walk, that **what we record is what the
coach read**. A hash cannot see this failure: the log and the body can both be
perfectly stable while describing different emails, which is what the legacy
`primary` field did for 701 of them.

All eight counts must be zero — a kind recorded as displayed with no sentence, a
sentence in no block the template carries, `has_personalisation` true with no
evidence sentence, a `primary_kind` or `hook_kind` that was not rendered, a
congratulation recorded as the reason for writing.

**A held claim is not a contradiction.** The composer caps the body at one
gathered clause; the rest are recorded `displayed: false` and counted separately
(232 today).

`has_personalisation` means *an athlete-specific sentence appeared in the
composition*. Recognition does not count: congratulating a programme on its
conference title is a courtesy any sender could pay and says nothing about
whether this athlete belongs there. `outreachEvidenceFor` owns that rule; the
baseline only checks nothing downstream disagrees with it.

## When a baseline moves

**A moved baseline is not a failing test to fix by updating the hash.**

1. **Read which subset moved.** The table above usually names the layer.
2. **Check the dataset line first.** `CHANGED` means the data moved, not the code.
3. **Get the semantic diff.** Re-run the surface that moved on a pairing it
   covers — `npm run evidence -- --athlete "…" --college "…"`, `npm run outreach-qa`,
   `npm run recruiting:evidence` — and read the actual before/after text.
4. **Say what changed and why**, in the commit message, in product terms.
5. **Then** `npm run evidence:baseline -- --update`, which prints exactly what
   it is about to repin.

Nothing else writes the expectations file. A plain run and a test run are
read-only, and that is itself asserted.

## Baselines that live elsewhere, and why

- **`npm run panel-baseline`** — the operator panel's rendered HTML, hashed as
  visible text. A genuinely different boundary from `OPERATOR_WIRE`: the wire
  can be correct and the component still render it wrongly, which is how the
  panel spent H1 offering swaps the send path would refuse. It renders React
  from fixture wire objects rather than live data, so it stays its own command.
- **`npm run test:reports`** — three report commands, hashed whole. They protect
  the CLI output an operator reads, which no product baseline covers. Not
  duplicated here.
- **`npm run backtest`** — the matching model. It consumes a different engine
  with its own tuning cycle, and coupling it would mean an evidence baseline
  failing because someone adjusted a weight. Kept separate deliberately.
