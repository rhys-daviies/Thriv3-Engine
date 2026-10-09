# Immediate-changes roadmap (Phases 2–5)

The approved product requirements for the operator workflow after Phase 1 (generic programme contacts). Restored on 2026-10-09 from the original planning conversation, which no repository file held. **This document is the source of truth for these phases.** Record progress in the status lines, not by editing the requirements.

Constraints across every phase: no new matchmaking scoring, no change to the V2 ranking engine, and no new agent architecture or unrelated infrastructure. Preserve historical records, coach eligibility, the programme-contact fallback, suppressions and send safeguards.

## Phase 2 — Athlete Positions & Representative-First Contact

Detailed primary and secondary athlete positions are done (PR #68, main `67e8964`). Do not rebuild them.

- Assign an appropriate Striv3 representative to each athlete.
- Support multiple consultants rather than assuming one global representative.
- Store representative contact information, including name, email and phone.
- Display the representative as the primary coach-facing contact on athlete profiles.
- Keep athlete personal contact information private on coach-facing pages.
- Ensure relevant communications identify the athlete's representative.
- Preserve the existing athlete-authorized mailbox sending architecture. Representative-first contact must not silently change the sender mailbox or OAuth model.
- Preserve historical records, coach eligibility, programme-contact fallback, suppressions and send safeguards.

Status: **complete** — PR #70, merged to main `dab547b` (not deployed). A representative is recommended for every athlete, not enforced: making it a publish requirement would block all outreach for unassigned athletes, because sending refuses links to ungeneratable pages. With none assigned, emails keep the long-standing sign-off and the coach page shows no personal contact.

**Sending and replies (unchanged by Phase 2; corrected wording in Phase 5).** There are two channels, and neither sets a `Reply-To`, `Cc` or `Bcc`. **Manual outreach** (the single, bulk and Specific Search composers) prepares a draft that the operator sends from their own email account: Outlook on a Mac, using the configured `THRIV3_FROM_ADDRESS` or whichever account Outlook actually uses, otherwise the operator's own mail app. A coach who replies writes to that account. **Campaign outreach** (deferred) sends from the athlete's own connected mailbox under the athlete's OAuth grant, so a reply goes to the athlete's mailbox (`server/lib/rfc822.js`). **In neither case does a reply go to the representative.** The representative is reached through the details in the email signature and on the coach-facing page. Every outreach review surface says this in its signature notice, and warns, without blocking, when the long-standing consultant signature will be used. Routing replies to representatives would be a separate design decision, not part of Phase 2.

## Phase 3 — Player Navigation & Conference Preferences

Reorganize the player workspace into:

1. Profile
2. Analysis & Matching
3. Coach Engagement
4. Campaign
5. Reports

- Remove Program Philosophy, Evidence and Decision Evidence from the primary navigation, while preserving their engines, data and functionality.
- Expose the existing preferred-conference picker and verify how matchmaking actually consumes it. Do not silently change ranking weights.

Status: **complete** — PR #71, merged to main `8427b75` (not deployed).
- Primary tabs are exactly the five above. Program Philosophy, Evidence and Decision Evidence sit under a secondary **More views** menu, with their routes and deep links unchanged. Each V2 match card has **View full evidence**, which opens Decision Evidence for that programme (`?college=<name>&source=v2`), even one the previous engine's list never held.
- Conference consumption, verified: **Matcher V2 does not rank or filter on preferred conferences.** Each match card checks the programme against them ("checked, not ranked"). Only the previous engine (`?matching=v1`) filters on them. A test proves V2 rankings are byte-identical with and without conference preferences, while the per-card check updates.
- Fixed: the edit form erased saved conferences (it pruned them before the reference list had loaded). Saved conferences now survive loading, a failed load, and names missing from the current list; they are removed only when the operator removes them or unticks their division. The picker now sits directly beneath divisions on step 1.

## Phase 4 — Unified Programme Database

Replace the separate College Database and Graduating Database interfaces with one Programme Database.

Required filters: Sport · Recruiting Class · Division · Conference · School.

Programme workspace sections: Overview · Roster & Openings · Recruiting Intelligence · Coaches & Contacts · Programme Intelligence.

Reuse existing datasets, APIs and intelligence, and avoid parallel sources of truth.

Status: implemented on `feat/phase4-programme-database` (PR open, not merged). Read only: no schema change and no writes to programme data.
- `/programmes`: one list, filtered and paginated by the server (Sport, Recruiting Class, Division, Conference, School). Replaces the College Database and Graduating Database; `/colleges` and `/graduating-db` redirect to it. The Roster gaps and Season trust queues are linked from it and keep their routes.
- `/programmes/:id`: Overview · Roster & Openings · Recruiting Intelligence · Coaches & Contacts · Programme Intelligence. The id is the `colleges` id, which is the engine's `programmeId`, so a programme is always one school in one sport. The other sport is linked only through the athletics-entity id. Each V2 match card has **Open programme**.
- **Openings are the matching engine's own projection.** They come from `programmeContext` / `positionEvidence`, and per-player standing comes from `availabilityAtEntry`. A place is open for a class when its holder's last eligible season, under the eligibility rules on file, is before that class arrives. They are projections, not confirmed graduates. The stored `estimated_graduation_year` the old Graduating Database grouped by is not used.
- **Recruiting classes run from 2027 to 2030.** That is the season after the 2026 roster through the furthest season any current player could still be eligible (`maxAttainableLastSeason`). Classes outside that window are refused. At or past a division's own ceiling, the counts are marked as set by the eligibility window. NJCAA/USCAA have no rule on file and show "Not established".
- **Conference filters by identity.** It uses the canonical conference register (`resolveConference`, scoped by sport and division), so stored spellings such as "Sooner" and "Sooner Athletic Conference" are one option. Spellings the register does not hold match exactly. **School** uses the registry search's predicate: name plus global aliases on UNITID, no fuzzy matching.
- **Removed from the UI:** the legacy mock-data "Run Batch Research" and the legacy CSV export. The underlying `graduating_seniors` data and server functions are untouched.
- **Coaches & Contacts** reads the existing per-programme routes unchanged, with their eligibility floors. It shows no email links and has no send path.

## Phase 5 — End-to-End Integration

Validate Player → Match → Programme → Contact → Campaign → Engagement → Report, including cross-workflow checks for athlete positions, representative details, programme contacts, conference preferences, historical records and data integrity.

Status: not started.
