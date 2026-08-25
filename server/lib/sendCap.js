/**
 * How often one inbox may be written to, across every athlete and both sports.
 *
 * The failure this prevents: five athletes at a similar level produce five
 * overlapping match lists, and the head coach at a programme all five like
 * receives five cold emails inside a fortnight — three times over, once per
 * sequence step. That is fifteen messages from one sender to one recipient,
 * which is how a domain gets filtered and how a coach who might have replied
 * stops reading.
 *
 * Keyed on the **email address**, not on the coach row. `coaches` is keyed on
 * (email, school, sport), so one human staffing both the men's and women's
 * programme is two rows and would otherwise get two full campaigns. A shared
 * inbox like msoccer@school.edu is not one person at all, but it is one
 * inbox, and the inbox is what the cap is protecting.
 *
 * WHAT IT ACTUALLY COUNTS, which is not quite what the name suggests.
 * `outreach` carries `UNIQUE (athlete_id, coach_id)`, so there is exactly one
 * row per athlete-coach pair and no record anywhere of individual messages —
 * a three-step sequence reuses one row and one token. So this counts
 * **distinct athletes who have written to that inbox** inside the window, not
 * messages.
 *
 * That is the right cap for the stated hazard, which is several athletes
 * converging on the same popular programme. It does not cap sequence steps,
 * because sequencing (§2.3) does not exist yet and there is nothing to count.
 * **When it lands, each step has to be recorded** — otherwise this silently
 * keeps measuring campaigns while the thing filling the coach's inbox is
 * steps.
 *
 * Only sent rows count: a drafted-but-never-sent message has reached nobody,
 * and holding a dry run against the cap would quietly shrink a real campaign.
 */
import db from '../db/client.js';
import { PER_COACH_WINDOW_DAYS, PER_COACH_MAX_SENDS } from './config.js';

const norm = (email) => (email || '').trim().toLowerCase();

function windowStart(days = PER_COACH_WINDOW_DAYS, now = Date.now()) {
  return new Date(now - days * 86_400_000).toISOString();
}

/** Distinct athletes who have sent to this address inside the window. */
export function recentSendCount(email, { days = PER_COACH_WINDOW_DAYS, now = Date.now() } = {}) {
  const address = norm(email);
  if (!address) return 0;
  const row = db.prepare(`
    SELECT COUNT(*) AS n
    FROM outreach o
    JOIN coaches c ON c.id = o.coach_id
    WHERE lower(c.email) = ? AND o.sent_at IS NOT NULL AND o.sent_at >= ?
  `).get(address, windowStart(days, now));
  return row?.n || 0;
}

/** Whether one more message to this address would exceed the cap. */
export function isSendCapped(email, opts = {}) {
  const max = opts.max ?? PER_COACH_MAX_SENDS;
  if (!max || max < 0) return false;
  return recentSendCount(email, opts) >= max;
}

/**
 * Which addresses on a proposed list are already at or near the cap.
 *
 * For looking *before* drafting a hundred messages rather than discovering it
 * one skipped result at a time. `remaining` is what is left in the window, so
 * a partially-capped address is visible as such rather than reading as fine.
 */
export function capReport(emails, opts = {}) {
  const max = opts.max ?? PER_COACH_MAX_SENDS;
  const seen = new Map();
  for (const email of emails) {
    const address = norm(email);
    if (!address || seen.has(address)) continue;
    const sent = recentSendCount(address, opts);
    seen.set(address, { email: address, sent, remaining: Math.max(0, max - sent), capped: sent >= max });
  }
  const rows = [...seen.values()];
  return {
    windowDays: opts.days ?? PER_COACH_WINDOW_DAYS,
    max,
    total: rows.length,
    capped: rows.filter((r) => r.capped),
    nearLimit: rows.filter((r) => !r.capped && r.remaining <= 1),
  };
}

/**
 * Addresses that appear on more than one athlete's list.
 *
 * Overlap is not itself a problem — it is the expected result of two athletes
 * being a good fit for the same programme — but it is the thing that turns
 * into a cap breach two sequence steps later, and it is invisible while each
 * athlete is looked at on their own.
 */
export function overlapAcrossAthletes(listsByAthlete) {
  const byEmail = new Map();
  for (const [athlete, emails] of Object.entries(listsByAthlete)) {
    for (const email of new Set(emails.map(norm).filter(Boolean))) {
      if (!byEmail.has(email)) byEmail.set(email, []);
      byEmail.get(email).push(athlete);
    }
  }
  return [...byEmail.entries()]
    .filter(([, athletes]) => athletes.length > 1)
    .map(([email, athletes]) => ({ email, athletes, count: athletes.length }))
    .sort((a, b) => b.count - a.count);
}
