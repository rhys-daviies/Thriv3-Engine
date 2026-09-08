# Stage I1 — can we measure whether Evidence works?

Audit only. No code, schema or behaviour changed.

## The short answer

**No, not yet — and not for the reason we expected.**

The blocker is not that the pipeline is unsound. Send confirmation is honest,
the rendered prose is snapshotted, and the analytics query already exists. The
blocker is that there are **14 real evidence-logged sends, zero real replies,
and every one of those 14 was written under a retired selection policy.**

Four stop conditions from the I1 brief are met. They are findings, not
failures, and none is patched here.

## 1. Reply attribution is not deterministic — there is no reply capture

`outreach` stores `id`, `athlete_id`, `coach_id`, `token`, `match_id`,
`sent_at`, `drafted_at`, `revoked_at`, `created_at`. There is **no message id,
no thread id, no conversation id** anywhere in the schema or the code, and
`server/lib/outlook.js` exposes exactly two functions — `isOutlookAvailable`
and `composeInOutlook`. Nothing reads an inbox.

The only reply signal is `engagement_rollup.responded_at`, set by
`markResponded`, which is called from one operator button
(`server/index.js:415`) and from the demo seeder. Its own docstring says it:
*"Responded overrides the score and is never auto-detected in v1."*

So reply detection is **operator-entered only**, and today it holds one row —
on a simulated coach at `demo.thriv3.invalid`.

Consequence: `evidencePerformance` and `evidenceLog.evidencePerformance` both
compute `replies` from `responded_at`. That column is a manual flag, not a
detected reply, and no bounce or auto-reply can be distinguished from a genuine
one because none of them is captured at all.

## 2. The send denominator IS trustworthy — and it is small

This part is right, and deliberately so. `markOutreachSent` fires only when the
AppleScript issued Outlook's own Send; a `--apply` draft records `drafted_at`
and nothing more until `npm run confirm-sends -- --apply` confirms the batch.
The comment records the bug this fixed: *"Drafting twenty and sending fifteen
therefore recorded twenty sends."*

    outreach rows                         96
      of which simulated (demo domain)    14
      real                                82
    real with sent_at                     27
    real, sent, with an evidence row      14   <- the analysable population
    distinct programmes                   14
    athletes                               2   (Rhys Davies, Ryan Billings)
    send dates              2026-08-24 (8), 2026-08-27 (19)

13 of the 27 real sends predate `logEvidence` and carry no evidence row at all.

## 3. Historical evidence state is snapshotted — but in a dead vocabulary

Good news first: `outreach_evidence` snapshots more than expected —
`rendered_paragraph`, `selected_kinds`, `rendered_count`, `structure`,
`structure_source`, `template_variant`, `body_source`, `roster_freshness`,
`roster_age_days`, and a `payload` JSON carrying `sentences` **with their
text**. Analytics does not need to recompute, and must not: today's copy says
*"three defenders are listed to graduate in 2027 — …"* where the stored
sentence says *"you've got three defenders graduating in 2027 (…)"*. Re-rendering
would silently fabricate an email nobody received.

The bad news is what those 14 rows say:

    primary_kind ∈ { POSITION_GRADUATION, ACADEMIC_FIT, CONFERENCE_TITLE,
                     POSTSEASON_RESULT, PROGRAM_MOMENTUM, HISTORICAL_SAME_COUNTRY }
    selected_kinds contains INTERNATIONAL_ROSTER, PROGRAM_MOMENTUM
    body_source = TEMPLATE for all 14
    payload keys include ranked / suppressed / belowThreshold / rejected

`INTERNATIONAL_ROSTER` and `PROGRAM_MOMENTUM` are **not OUTREACH-licensed
today**. `CONFERENCE_TITLE` as `primary_kind` is a state H18 proved impossible
(recognition is never primary). `ranked`/`suppressed`/`belowThreshold` are the
legacy selector's fields, deleted at H7. And **`body_source = TEMPLATE` on every
row means the structured composer has never sent an email** — every logged send
used the flat template.

So the 14 rows are a faithful record of a system that no longer exists. They
cannot be pooled with future sends, and no comparison across the boundary is
meaningful.

## 4. Initial sends and follow-ups cannot be distinguished

`outreach` carries `UNIQUE (athlete_id, coach_id)` and `createOutreach` returns
the existing row rather than inserting. `outreach_evidence.outreach_id` is a
PRIMARY KEY and `logEvidence` upserts.

So a second email to the same coach **overwrites the evidence snapshot and
leaves `sent_at` at the first send** (`markOutreachSent` is guarded by
`AND sent_at IS NULL`). There is one row per athlete-coach pair for all time.
Today that is invisible — nobody has followed up — but the model cannot record
a follow-up, cannot separate it from the initial send, and would destroy the
initial email's evidence record if one happened.

## What is already right

- **Send confirmation.** The most commonly botched denominator, and it is sound.
- **Copy snapshot.** The prose as sent is stored; analytics never re-renders.
- **The freshness snapshot.** `roster_freshness` and `roster_age_days` record
  how old the roster was *at send time* — a question re-scraped data cannot
  answer.
- **Suppression list.** `unsubscribed | bounced | complained | manual` exists
  and is keyed on email, ready to receive bounce data when there is any.
- **The honest small-sample warning.** `evidencePerformance.js` already refuses
  to rank: *"Seven sends of one evidence kind can show a 43% reply rate."*

## Field classification

| field | status |
|---|---|
| rendered sentences and their text | **SNAPSHOTTED** (`payload.sentences`) |
| rendered paragraph | **SNAPSHOTTED** |
| structure, structure_source, template_variant, body_source | **SNAPSHOTTED** |
| selected_kinds, rendered_count, evidence_count | **SNAPSHOTTED** |
| roster freshness and age at send | **SNAPSHOTTED** |
| dispositions, held alternatives, prefer state | **SNAPSHOTTED** (in `payload`) |
| `hook_kind`, `primary_role`, `has_personalisation` | **LOST** — produced by `evidenceLogPayload`, written to no column and absent from `payload` |
| athlete/programme attributes at send time | **RECOMPUTED** — read live from `players`/`colleges` |
| match rank at send time | **RECOMPUTED** — `match_id` stores a school name, not a rank |
| reply, reply time, reply content, classification | **MISSING** |
| message id, thread id | **MISSING** |
| initial-vs-follow-up, send sequence | **MISSING** |
| bounce, auto-reply, out-of-office | **MISSING** |

Three fields H17 and H18 established as the outbound decision's own answer —
`hook_kind`, `primary_role`, `has_personalisation` — are computed at send time
and then thrown away. They are the exact grouping columns Stage I needs.

## What I2 should be

Smallest useful step, in dependency order:

1. **Persist the three lost fields** (`hook_kind`, `primary_role`,
   `has_personalisation`) plus a `policy_version` stamp, so rows written under
   different selection policies can never be silently pooled.
2. **Make outreach an event log, not a state row.** A `outreach_send` table
   keyed by `(outreach_id, sequence)` with its own `sent_at` and evidence
   snapshot, so a follow-up neither overwrites the first email's record nor
   inherits its timestamp.
3. **Capture reply state deterministically.** Either an Outlook thread/message
   id recorded at send and matched on read, or — cheaper and honest — an
   operator classification (`human | auto | bounce | not-interested | meeting`)
   with a timestamp, replacing the single boolean `responded_at`.
4. **Then** the report, and not before.

## Whether current data supports changing selection

**No.** 14 sends, 0 real replies, all under a retired policy, all
`body_source = TEMPLATE`. The hook specificity ladder, the qualification set,
the role plan and the structure choice are all still bets, and Stage I exists to
turn them into questions — not yet into answers. Nothing in Stage I may move the
hook ladder, the licensing set or the structures until the measurement above
exists and has accumulated a real sample.
