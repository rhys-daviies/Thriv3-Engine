---
name: feature
description: Start a Thriv3 feature or fix the outcome-driven way. Writes the outcome brief, classifies the risk tier, gets the right approval, then plans, builds and verifies. Use at the start of any feature, fix or change request.
---

# /feature — outcome brief to verified PR

Request: $ARGUMENTS

## 1. Outcome brief (always, before any code)

Write this in under 15 lines and show it to the user:

- **Outcome:** what the operator or athlete can do afterwards that they can't now.
- **Pilot fit:** how it serves the NCAA D1–D3 soccer pilot. If it doesn't, say
  so; it may still be worth doing, but the user decides.
- **Success check:** a command, test or observable result that proves it works.
- **Acceptance tests:** the tests that will be added or changed.
- **Risk tier:** T0–T3 per `CLAUDE.md` §3, with one line of reasoning. Routine
  matching UI or explanation wording is T1. Eligibility, scoring weights, or a
  change in who is matched or contacted is T2.
- **Out of scope:** what this deliberately doesn't do.

Use `scout` to find the files involved instead of reading broadly.

## 2. Approval

- T0: proceed.
- T1: ask once to approve the workstream. After that, commit, push the branch
  and open or update the PR without asking again.
- T2: present a plan (files, approach, tests, backtest if matching is
  affected) and wait for approval before writing code. If the design is
  genuinely hard, recommend the `architect` (Fable 5.1) subagent and say why.
  Ask before running it.
- T3 steps (merge, deploy, live DB write, real send, coach activation, hold
  release, secrets, GitHub configuration) are never part of this flow. Name
  them and stop for an explicit yes on each one.

## 3. Build

Branch from `main` (`feat/…`, `fix/…`, `chore/…`). Write the tests with the
code. For a contained T1 task, hand it to `implementer` and review its diff.
Iterate with targeted `npx vitest run <files>`.

## 4. Verify and ship

Run `/ship-check`. Then confirm the brief's success check passes. Report that
check as evidence, not "tests pass".
