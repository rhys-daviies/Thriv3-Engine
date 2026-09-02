# Thriv3 (local)

Self-hosted rebuild of Thriv3 (formerly RecruitMatch) — no Base44, one or a few
internal operators, run locally or on one hosted instance.

## Setup

```bash
npm install
cp .env.example .env   # add ANTHROPIC_API_KEY if you want evaluateSoccerProgram / CSV agent chat
npm run seed            # populates SQLite from the real bundled data in server/seed/data
THRIV3_OPERATOR_PASSWORD='a-long-enough-local-password' \
  npm run operator -- you@example.com   # your sign-in; there is no default password
npm run dev              # Vite (5183) + Express API (8787), proxied
```

Open http://localhost:5183 and sign in.

## What's real vs. stubbed

- **College database** (soccer_score, academic_rating, division) — real, seeded from `server/seed/data/*.json` (converted from the user's own RPI rankings + academic-score sheets).
- **Graduating senior rosters** — real 2025 season data for men's soccer D1–D3/NAIA, imported from the bundled CSVs via the same `importGraduatingCSV` pipeline used at runtime.
- **buildGraduatingDatabase** (roster research for schools/sports without pre-scraped data) — **stubbed**: returns mock names tagged `data_confidence: "low"`. The real Section 9 prompt is preserved as `ROSTER_RESEARCH_PROMPT` in `server/routes/buildGraduatingDatabase.js` for later wiring.
- **evaluateSoccerProgram** — real, calls the Anthropic API with the `web_search` tool.
- **SendEmail** — stubbed: logs server-side and returns a `mailto:` link. No real SMTP.
- **Auth** — real, since Phase 13K. Email and password, scrypt-hashed, with
  server-side sessions; every `/api` route requires one. Accounts are created
  from the shell with `npm run operator`, never over HTTP, and there is no
  default password. The API still binds `127.0.0.1` unless `API_HOST` says
  otherwise. See `docs/hosting.md`.
