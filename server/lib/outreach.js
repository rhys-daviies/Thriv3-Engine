import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { utcNow } from './time.js';
import { generateToken, generateUnique } from './tokens.js';

const tokenTaken = (candidate) => !!db.prepare('SELECT 1 FROM outreach WHERE token = ?').get(candidate);

/**
 * One row per athlete-coach pair, carrying the opaque token that makes
 * attribution possible. Idempotent: asking twice for the same pair returns the
 * existing row rather than minting a second token.
 *
 * `matchId` links back to the Tab 2 recommendation that produced this outreach.
 * Nothing reads it yet — Phase 5 uses it to ask whether the matching algorithm
 * actually produces engagement — so populate it whenever the caller knows it.
 */
export function createOutreach({ athleteId, coachId, matchId = null }) {
  const existing = db
    .prepare('SELECT * FROM outreach WHERE athlete_id = ? AND coach_id = ?')
    .get(athleteId, coachId);
  if (existing) return existing;

  const row = {
    id: randomUUID(),
    athlete_id: athleteId,
    coach_id: coachId,
    token: generateUnique(generateToken, tokenTaken),
    match_id: matchId,
    drafted_at: null,
    sent_at: null,
    revoked_at: null,
    created_at: utcNow(),
  };
  db.prepare(`
    INSERT INTO outreach (id, athlete_id, coach_id, token, match_id, drafted_at, sent_at, revoked_at, created_at)
    VALUES (@id, @athlete_id, @coach_id, @token, @match_id, @drafted_at, @sent_at, @revoked_at, @created_at)
  `).run(row);
  return row;
}

/**
 * Resolves a ?ref= token to its outreach row. Returns null for unknown,
 * revoked, or archived-athlete tokens alike — callers must not be able to
 * tell those cases apart from the outside.
 */
export function resolveToken(token) {
  if (typeof token !== 'string' || !token) return null;
  const row = db
    .prepare(`
      SELECT o.* FROM outreach o
      JOIN players p ON p.id = o.athlete_id
      WHERE o.token = ? AND o.revoked_at IS NULL AND p.archived_at IS NULL
    `)
    .get(token);
  return row || null;
}

/**
 * A message was handed to Outlook as a draft.
 *
 * This is what `markOutreachSent` used to be called for, and calling it "sent"
 * is what let a draft nobody sent into every reply-rate denominator in the
 * system. Drafting is a real event worth recording — it is when the tracking
 * token went into a body — it is simply not a send.
 */
export function markOutreachDrafted(id, at = utcNow()) {
  // Overwrites, unlike `markOutreachSent` below, and the asymmetry is
  // deliberate. `sent_at` dates a delivery and must not move out of an
  // engagement window. `drafted_at` dates the message CURRENTLY sitting in
  // Outlook, and `outreach` carries one row per athlete-coach pair — so a
  // programme re-drafted today would otherwise keep last week's timestamp and
  // be grouped into last week's batch by `confirmSends.js`, where confirming
  // this week's run would silently skip it.
  db.prepare('UPDATE outreach SET drafted_at = ? WHERE id = ?').run(at, id);
}

/**
 * The coach was written to, and we have explicit confirmation of it.
 *
 * TWO callers, and no third may be added without a decision: the send path
 * when the AppleScript itself issued Send, and `confirmSends.js` when a human
 * confirms a batch they sent by hand. Opening a draft must never reach here —
 * see the schema comment on `outreach`.
 *
 * `AND sent_at IS NULL` keeps the FIRST confirmation, so re-confirming a batch
 * cannot move a send forward in time and out of an engagement window.
 */
export function markOutreachSent(id, at = utcNow()) {
  db.prepare('UPDATE outreach SET sent_at = ? WHERE id = ? AND sent_at IS NULL').run(at, id);
}

export function revokeOutreach(id, at = utcNow()) {
  db.prepare('UPDATE outreach SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(at, id);
}

export function listOutreachForAthlete(athleteId) {
  return db.prepare('SELECT * FROM outreach WHERE athlete_id = ? ORDER BY created_at').all(athleteId);
}
