import fs from 'node:fs';
import path from 'node:path';
import db from '../db/client.js';
import { suppressedSet } from './suppressions.js';

import { Player } from '../db/entities/player.js';
import { checkRequiredCore, REQUIRED_CORE_LABELS } from '../export/renderProfile.js';
import { OUTPUT_DIR } from '../export/exportProfiles.js';
import { isOutlookAvailable } from './outlook.js';
import {
  EDGE_BASE_URL, SYNC_SECRET, PUBLIC_BASE_URL, isPubliclyReachable, OUTLOOK_FROM_ADDRESS, complianceGaps, SENDER_POSTAL_ADDRESS, SYNC_INTERVAL_MINUTES } from './config.js';

/**
 * Everything that has to be true before ROADMAP §1.1 — the first real tracked
 * send — is worth attempting. Read-only: it sends nothing, publishes nothing,
 * and writes nothing anywhere.
 *
 * The reason this exists rather than a checklist in a document: on 2026-08-24
 * the roadmap said Pillar 3 was feature-complete and fully tested, and it was
 * — every test passed while every tracked link in the wild served the neutral
 * page, because the edge had been emptied four days earlier and nothing ever
 * asked it. A trial run against that state would have produced zero events and
 * looked exactly like a coach who ignored the email.
 */

const PASS = 'pass';
const FAIL = 'fail';
const WARN = 'warn';

const check = (status, name, detail) => ({ status, name, detail });

/** Distinguishes the real profile from the same-status neutral page. */
const NEUTRAL_MARKER = 'Profile unavailable';

async function edgeHealth(fetchImpl) {
  const res = await fetchImpl(`${EDGE_BASE_URL}/api/health`, {
    headers: { Authorization: `Bearer ${SYNC_SECRET}` },
  });
  if (!res.ok) throw new Error(`health responded ${res.status}`);
  return res.json();
}

/**
 * Picks the athlete the trial would use: the one explicitly named, else the
 * only published one. Ambiguity is a failure rather than a guess — sending
 * as the wrong athlete is not a mistake you can take back.
 */
export function resolveAthlete(slugOrId = null) {
  const published = db
    .prepare('SELECT id FROM players WHERE published_at IS NOT NULL AND archived_at IS NULL')
    .all()
    .map((r) => Player.get(r.id));

  if (slugOrId) {
    const match = published.find((a) => a.public_slug === slugOrId || a.id === slugOrId);
    return { athlete: match ?? null, published };
  }
  return { athlete: published.length === 1 ? published[0] : null, published };
}

function localChecks(athlete, published) {
  const out = [];

  out.push(EDGE_BASE_URL && SYNC_SECRET
    ? check(PASS, 'Edge configured', EDGE_BASE_URL)
    : check(FAIL, 'Edge configured', 'THRIV3_EDGE_URL and THRIV3_SYNC_SECRET must both be set'));

  out.push(isPubliclyReachable()
    ? check(PASS, 'Public base URL is reachable', PUBLIC_BASE_URL)
    : check(FAIL, 'Public base URL is reachable',
      `${PUBLIC_BASE_URL} — a coach cannot open localhost`));

  out.push(isOutlookAvailable()
    ? check(PASS, 'Outlook automation available', `sending as ${OUTLOOK_FROM_ADDRESS}`)
    : check(FAIL, 'Outlook automation available', `${process.platform} — sendOutreach requires macOS`));

  // Blocking, not advisory. Every commercial email needs a sender identity, a
  // real postal address and a working opt-out, and discovering that halfway
  // through a run means the first half already broke the law.
  const gaps = complianceGaps();
  out.push(gaps.length
    ? check(FAIL, 'Compliance footer configured', `missing ${gaps.join(', ')}`)
    : check(PASS, 'Compliance footer configured', SENDER_POSTAL_ADDRESS));

  // Not blocking: an empty list is the normal state before a first send. It is
  // here so the number is in front of you when you read the results, because
  // a suppressed coach who looks "cold" is a different thing from a cold one.
  const suppressed = suppressedSet().size;
  out.push(check(PASS, 'Opt-out list', suppressed === 0
    ? 'no suppressions yet'
    : `${suppressed} address(es) will be skipped`));

  // The opt-out is a reply, not a link, so nothing records it automatically.
  // That obligation is a person's, and CAN-SPAM gives that person ten
  // business days. Stated on every run rather than checked, because there is
  // nothing here a machine can verify — which is exactly why it is the part
  // most likely to be forgotten.
  out.push(check(WARN, 'Opt-outs arrive by reply',
    `watch ${OUTLOOK_FROM_ADDRESS} and run \`npm run suppress -- <address>\` within 10 business days`));

  // Not blocking a first send — you can sync by hand — but a trial whose
  // results only arrive when somebody remembers to pull them is how the
  // August allowlist failure stayed invisible for four days.
  // Reports the configuration, not this process's timer. The preflight runs
  // as a CLI, and the scheduler only ever starts inside the server — asking
  // syncStatus() here would answer "not running" however the server is set up.
  out.push(check(SYNC_INTERVAL_MINUTES > 0 ? PASS : WARN, 'Engagement sync scheduled',
    SYNC_INTERVAL_MINUTES > 0
      ? `every ${SYNC_INTERVAL_MINUTES} minute(s) while the server is running`
      : 'not scheduled — set THRIV3_SYNC_INTERVAL_MINUTES, or run npm run sync yourself after the trial'));

  if (!athlete) {
    out.push(check(FAIL, 'Trial athlete', published.length === 0
      ? 'no published athlete — publish one first'
      : `${published.length} published athletes; name one explicitly`));
    return out;
  }

  out.push(check(PASS, 'Trial athlete', `${athlete.full_name} (${athlete.public_slug})`));

  const missing = checkRequiredCore(athlete);
  out.push(missing.length === 0
    // Derived, not restated: this list was hardcoded and had already drifted
    // from what the export actually checks.
    ? check(PASS, 'Profile has every required field', REQUIRED_CORE_LABELS.join(', '))
    : check(FAIL, 'Profile has every required field', `missing ${missing.join(', ')}`));

  const file = path.join(OUTPUT_DIR, 'p', `${athlete.public_slug}.html`);
  out.push(fs.existsSync(file)
    ? check(PASS, 'Profile exported locally', file)
    : check(WARN, 'Profile exported locally', 'not built yet — npm run publish generates it'));

  return out;
}

async function edgeChecks(athlete, fetchImpl) {
  const out = [];

  let health;
  try {
    health = await edgeHealth(fetchImpl);
  } catch (err) {
    out.push(check(FAIL, 'Edge reachable', err.message));
    return out;
  }
  out.push(check(PASS, 'Edge reachable', `${EDGE_BASE_URL}/api/health`));

  // A worker predating the detailed health endpoint answers {ok:true} and
  // nothing else. Unknown is not the same as broken.
  if (health.liveTokens === undefined) {
    out.push(check(WARN, 'Edge reports its state',
      'deployed worker predates the detailed health endpoint — npm run publish'));
    return out;
  }

  const localLive = db
    .prepare('SELECT count(*) AS n FROM outreach WHERE revoked_at IS NULL')
    .get().n;
  out.push(health.liveTokens === localLive
    ? check(PASS, 'Token allowlist in sync', `${health.liveTokens} live at the edge`)
    : check(FAIL, 'Token allowlist in sync',
      `${localLive} live locally, ${health.liveTokens} at the edge — run npm run sync`));

  out.push(health.deletesLocked
    ? check(PASS, 'Delete guard locked', 'edge_guard holds no unlock window')
    : check(FAIL, 'Delete guard locked', `unlocked until ${health.guardUnlockedUntil}`));

  // The failure this cannot afford: a cursor above the edge's high-water mark
  // means pullEvents never asks for the trial's first events at all.
  const cursor = Number(db.prepare("SELECT value FROM sync_state WHERE key = 'edge_events_cursor'").get()?.value || 0);
  out.push(cursor <= health.eventSequence
    ? check(PASS, 'Event cursor behind the edge', `cursor ${cursor}, edge sequence ${health.eventSequence}`)
    : check(FAIL, 'Event cursor behind the edge',
      `cursor ${cursor} exceeds edge sequence ${health.eventSequence} — the first `
      + `${cursor - health.eventSequence} event(s) of the trial would never be pulled`));

  if (!athlete) return out;

  const token = db
    .prepare('SELECT token FROM outreach WHERE athlete_id = ? AND revoked_at IS NULL LIMIT 1')
    .get(athlete.id)?.token;

  if (!token) {
    out.push(check(WARN, 'Tracked link resolves',
      'no outreach row for this athlete yet — the trial send creates the first'));
    return out;
  }

  const url = `${PUBLIC_BASE_URL}/p/${athlete.public_slug}?ref=${token}`;
  const live = await fetchImpl(url).then((r) => r.text()).catch((e) => `error: ${e.message}`);
  out.push(live.includes(NEUTRAL_MARKER)
    ? check(FAIL, 'Tracked link resolves', 'a live token serves the neutral page — the allowlist is stale')
    : check(PASS, 'Tracked link resolves', `${live.length} bytes of profile`));

  // Gating has to fail closed as well as open, or the "it works" above proves
  // only that the page is being served to everyone.
  const bogus = await fetchImpl(`${PUBLIC_BASE_URL}/p/${athlete.public_slug}?ref=not-a-real-token`)
    .then((r) => r.text()).catch((e) => `error: ${e.message}`);
  out.push(bogus.includes(NEUTRAL_MARKER)
    ? check(PASS, 'Unknown token refused', 'neutral page, as designed')
    : check(FAIL, 'Unknown token refused', 'an unknown token was served the profile'));

  out.push(live.includes('/api/track')
    ? check(PASS, 'Tracker wired into the page', 'posts same-origin to /api/track')
    : check(FAIL, 'Tracker wired into the page', 'no /api/track in the served page'));

  return out;
}

/** Runs every check. Never sends, publishes, or writes. */
export async function runPreflight({ slugOrId = null, fetchImpl = fetch } = {}) {
  const { athlete, published } = resolveAthlete(slugOrId);
  const checks = localChecks(athlete, published);

  if (EDGE_BASE_URL && SYNC_SECRET) {
    checks.push(...await edgeChecks(athlete, fetchImpl));
  }

  return {
    athlete,
    checks,
    failures: checks.filter((c) => c.status === FAIL).length,
    warnings: checks.filter((c) => c.status === WARN).length,
    ready: checks.every((c) => c.status !== FAIL),
  };
}
