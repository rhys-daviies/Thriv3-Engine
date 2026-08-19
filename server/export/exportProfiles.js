import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Player } from '../db/entities/player.js';
import { checkRequiredCore, renderProfile } from './renderProfile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const OUTPUT_DIR = path.resolve(__dirname, '../../build/public');

/** Where the generated page posts its events. Overridden per environment. */
export function trackingEndpoint() {
  return process.env.THRIV3_TRACK_ENDPOINT || 'http://localhost:8787/api/track';
}

const ROBOTS_TXT = `# Athlete profiles are shared directly with named college coaches.
# They are not for indexing.
User-agent: *
Disallow: /
`;

export function writeRobotsTxt(outputDir = OUTPUT_DIR) {
  fs.mkdirSync(outputDir, { recursive: true });
  const target = path.join(outputDir, 'robots.txt');
  fs.writeFileSync(target, ROBOTS_TXT);
  return target;
}

/**
 * Writes one athlete's page to build/public/p/<slug>.html.
 *
 * The filename is the athlete's stored public_slug — random, never derived
 * from their name, and reused on every regeneration so already-sent URLs stay
 * valid.
 */
export function exportAthlete(athlete, { outputDir = OUTPUT_DIR, endpoint = trackingEndpoint(), dryRun = false } = {}) {
  if (!athlete.public_slug) {
    throw new Error(`Athlete "${athlete.full_name}" has no public_slug — run the migration first`);
  }
  const html = renderProfile(athlete, { endpoint, dryRun });
  const dir = path.join(outputDir, 'p');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${athlete.public_slug}.html`);
  fs.writeFileSync(file, html);
  return { athleteId: athlete.id, name: athlete.full_name, slug: athlete.public_slug, file };
}

/**
 * Exports every athlete that satisfies the required core, reporting the ones
 * it skipped and why. Archived athletes are never exported — their links are
 * revoked, so a page for them would be dead weight.
 */
export function exportAll(options = {}) {
  const athletes = Player.list().filter((a) => !a.archived_at);
  const written = [];
  const skipped = [];

  for (const athlete of athletes) {
    const missing = checkRequiredCore(athlete);
    if (missing.length) {
      skipped.push({ name: athlete.full_name, id: athlete.id, missing });
      continue;
    }
    written.push(exportAthlete(athlete, options));
  }

  writeRobotsTxt(options.outputDir || OUTPUT_DIR);
  return { written, skipped };
}

/** Resolves a CLI argument that may be an athlete id or an exact full name. */
export function findAthlete(idOrName) {
  return Player.get(idOrName) || Player.filter({ full_name: idOrName })[0] || null;
}
