import { Player } from '../db/entities/player.js';
import { checkRequiredCore } from '../export/renderProfile.js';
import { exportAthlete } from '../export/exportProfiles.js';
import { PUBLIC_BASE_URL, isPubliclyReachable } from '../lib/config.js';
import { publishSite, publisherReadiness } from '../lib/sitePublisher.js';
import { utcNow } from '../lib/time.js';

/** Where a coach would land, before their own ?ref= token is appended. */
function publicUrl(athlete) {
  return `${PUBLIC_BASE_URL}/p/${athlete.public_slug}.html`;
}

/** The same page, served from this machine — no deploy needed to look at it. */
function previewUrl(athlete, req) {
  const host = req ? `${req.protocol}://${req.get('host')}` : 'http://localhost:8787';
  return `${host}/p/${athlete.public_slug}.html`;
}

/**
 * What the Profile tab needs to describe the athlete's public page: whether it
 * can be generated at all, where to look at it, and whether it is live.
 */
export function publishStatus(athleteId, req) {
  const athlete = Player.get(athleteId);
  if (!athlete) throw new Error('Unknown athlete');

  const missing = checkRequiredCore(athlete);
  // Whether the athlete is ready and whether the machine can publish at all
  // are different questions, and an operator needs both before pressing
  // anything. A complete profile on a host with no wrangler is still a button
  // that cannot work, and saying so up front beats a failure after the click.
  const readiness = publisherReadiness();
  return {
    canPublish: missing.length === 0 && !athlete.archived_at,
    missing,
    archived: Boolean(athlete.archived_at),
    publishedAt: athlete.published_at || null,
    url: athlete.public_slug ? publicUrl(athlete) : null,
    previewUrl: athlete.public_slug ? previewUrl(athlete, req) : null,
    reachable: isPubliclyReachable(),
    baseUrl: PUBLIC_BASE_URL,
    publisherReady: readiness.ready,
    publisherProblems: readiness.problems,
  };
}

/**
 * Regenerates this athlete's page locally so it can be previewed before
 * anything is published. No network, no deploy.
 */
export function regenerate(athleteId, req) {
  const athlete = Player.get(athleteId);
  if (!athlete) throw new Error('Unknown athlete');

  const missing = checkRequiredCore(athlete);
  if (missing.length) throw new Error(`Cannot generate a page yet — missing ${missing.join(', ')}`);
  if (athlete.archived_at) throw new Error('This athlete is archived; their links are revoked');

  exportAthlete(athlete);
  return { ...publishStatus(athleteId, req), generated: true };
}

/**
 * Publishes to Cloudflare Pages.
 *
 * Deploys the whole site rather than one page, because that is how Pages
 * works — a deployment is a snapshot of the directory. Every athlete who
 * passes the gate is regenerated first so the live site cannot end up mixing
 * a fresh page with stale ones.
 *
 * `deploy` is injectable purely so this boundary can be tested without a
 * Cloudflare account. Nothing in production passes it.
 */
export async function publish(athleteId, req, { deploy = publishSite } = {}) {
  const athlete = Player.get(athleteId);
  if (!athlete) throw new Error('Unknown athlete');

  const missing = checkRequiredCore(athlete);
  if (missing.length) throw new Error(`Cannot publish yet — missing ${missing.join(', ')}`);
  if (athlete.archived_at) throw new Error('This athlete is archived; their links are revoked');

  const result = await deploy();

  const publishedAt = utcNow();
  Player.update(athleteId, { published_at: publishedAt });

  return {
    ...publishStatus(athleteId, req),
    publishedAt,
    deploymentUrl: result.deploymentUrl,
    published: result.written?.length ?? 0,
    skipped: result.skipped?.length ?? 0,
  };
}
