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

## Phase 3 — Player Navigation & Conference Preferences

Reorganize the player workspace into:

1. Profile
2. Analysis & Matching
3. Coach Engagement
4. Campaign
5. Reports

- Remove Program Philosophy, Evidence and Decision Evidence from the primary navigation, while preserving their engines, data and functionality.
- Expose the existing preferred-conference picker and verify how matchmaking actually consumes it. Do not silently change ranking weights.

Status: not started. Note from PR #68: V2 ranking does not filter or score on preferred conferences. Each match card checks the programme against them ("checked, not ranked").

## Phase 4 — Unified Programme Database

Replace the separate College Database and Graduating Database interfaces with one Programme Database.

Required filters: Sport · Recruiting Class · Division · Conference · School.

Programme workspace sections: Overview · Roster & Openings · Recruiting Intelligence · Coaches & Contacts · Programme Intelligence.

Reuse existing datasets, APIs and intelligence, and avoid parallel sources of truth.

Status: not started.

## Phase 5 — End-to-End Integration

Validate Player → Match → Programme → Contact → Campaign → Engagement → Report, including cross-workflow checks for athlete positions, representative details, programme contacts, conference preferences, historical records and data integrity.

Status: not started.
