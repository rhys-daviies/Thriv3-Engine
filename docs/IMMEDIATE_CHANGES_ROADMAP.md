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

Status: implemented on `feat/representative-contact` (PR open, not merged). A representative is recommended for every athlete, not enforced: making it a publish requirement would block all outreach for unassigned athletes, because sending refuses links to ungeneratable pages. With none assigned, emails keep the long-standing sign-off and the coach page shows no personal contact.

**Sending and replies (unchanged by Phase 2).** Outreach is still sent from the athlete's own connected mailbox under the athlete's OAuth grant. The message sets `From` to that mailbox and sets no `Reply-To`, `Cc` or `Bcc` (`server/lib/rfc822.js`). **A coach who replies is therefore writing to the athlete's mailbox, not to the representative.** The representative is reached through the details in the email signature and on the coach-facing page. Every outreach review surface says this in its signature notice, and warns, without blocking, when the long-standing consultant signature will be used. Routing replies to representatives would be a separate design decision, not part of Phase 2.

## Phase 3 — Player Navigation & Conference Preferences

Reorganize the player workspace into:

1. Profile
2. Analysis & Matching
3. Coach Engagement
4. Campaign
5. Reports

- Remove Program Philosophy, Evidence and Decision Evidence from the primary navigation, while preserving their engines, data and functionality.
- Expose the existing preferred-conference picker and verify how matchmaking actually consumes it. Do not silently change ranking weights.

Status: implemented on `feat/phase3-navigation-conferences` (PR open, not merged).
- Primary tabs are exactly the five above. Program Philosophy, Evidence and Decision Evidence sit under a secondary **More views** menu, with their routes and deep links unchanged. Each V2 match card has **View full evidence**, which opens Decision Evidence for that programme (`?college=<name>&source=v2`), even one the previous engine's list never held.
- Conference consumption, verified: **Matcher V2 does not rank or filter on preferred conferences.** Each match card checks the programme against them ("checked, not ranked"). Only the previous engine (`?matching=v1`) filters on them. A test proves V2 rankings are byte-identical with and without conference preferences, while the per-card check updates.
- Fixed: the edit form erased saved conferences (it pruned them before the reference list had loaded). Saved conferences now survive loading, a failed load, and names missing from the current list; they are removed only when the operator removes them or unticks their division. The picker now sits directly beneath divisions on step 1.

## Phase 4 — Unified Programme Database

Replace the separate College Database and Graduating Database interfaces with one Programme Database.

Required filters: Sport · Recruiting Class · Division · Conference · School.

Programme workspace sections: Overview · Roster & Openings · Recruiting Intelligence · Coaches & Contacts · Programme Intelligence.

Reuse existing datasets, APIs and intelligence, and avoid parallel sources of truth.

Status: not started.

## Phase 5 — End-to-End Integration

Validate Player → Match → Programme → Contact → Campaign → Engagement → Report, including cross-workflow checks for athlete positions, representative details, programme contacts, conference preferences, historical records and data integrity.

Status: not started.
