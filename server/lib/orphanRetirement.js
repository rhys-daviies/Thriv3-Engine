import fs from 'node:fs';
import path from 'node:path';
import db from '../db/client.js';
import { utcNow } from './time.js';

/**
 * The register of public slugs deliberately taken off the site.
 *
 * WHY THIS EXISTS. The permanence gate refuses to publish a candidate that
 * loses a slug the last deployment served, unless that slug's athlete has been
 * archived. Archive is the sanctioned way out, and it works — for athletes who
 * still exist. It cannot speak for an athlete whose row was DELETED rather
 * than archived, because there is nothing left to carry the flag. To the
 * validator such a slug is indistinguishable from the case it was built to
 * catch: a live profile about to vanish from a coach's inbox.
 *
 * So the validator refuses, correctly, and keeps refusing. The missing piece
 * is not a weaker check — it is a second, equally explicit way to say "this
 * one is meant to go", durable enough to still be true after the next deploy.
 *
 * WHAT THIS IS NOT. Not an override, not a bypass, and not a switch that
 * relaxes the rule generally. It grants permission for ONE named slug, and
 * only for a slug that no athlete record owns. It cannot be inferred: a
 * missing database row is the symptom, never the authorisation. Someone has
 * to decide, name the slug, and say why.
 *
 * WHERE IT LIVES. Beside the deployment ledger, on the same persistent volume
 * and outside the published directory — so it survives a Render restart and is
 * never itself served. The ledger records what WAS deployed; this records what
 * was deliberately retired. Neither rewrites the other, which is the point:
 * getting a publish through must never mean editing the history of what the
 * public site actually contained.
 */

/** Same shape lib/tokens.js generates; anything else is not one of our slugs. */
const SLUG = /^[A-Za-z0-9]{1,32}$/;

export function retirementRegistryPath(outputDir) {
  return `${outputDir}.retired.json`;
}

/**
 * Reads the register.
 *
 * Three outcomes, and the difference between the last two matters:
 *
 *   no file        no retirements. Normal, and the state of every machine
 *                  that has never retired anything.
 *   readable file  the retirements it lists.
 *   UNREADABLE     an error, reported to the caller.
 *
 * An unreadable register must not be read as "no retirements". That would be
 * safe — publishing would still refuse — but it would be safe by accident and
 * silent about it, and the next person would be debugging a refusal whose
 * cause is a corrupt file nothing mentions. The validator turns the error into
 * a failure of its own so the real problem is what gets printed.
 */
export function readRetirements(outputDir) {
  const file = retirementRegistryPath(outputDir);
  if (!fs.existsSync(file)) return { entries: [], error: null };

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (err) {
    return { entries: [], error: `${file} is not readable JSON (${err.message})` };
  }
  if (!Array.isArray(parsed?.retirements)) {
    return { entries: [], error: `${file} has no "retirements" array` };
  }
  const bad = parsed.retirements.find(
    (r) => !r || typeof r.slug !== 'string' || !SLUG.test(r.slug) || !r.retiredAt || !r.reason
  );
  if (bad) {
    return {
      entries: [],
      error: `${file} contains an entry without a valid slug, retiredAt and reason`,
    };
  }
  return { entries: parsed.retirements, error: null };
}

/** The slugs a candidate is permitted to have dropped. Empty on any error. */
export function retiredSlugs(result) {
  return new Set(result?.error ? [] : (result?.entries || []).map((r) => r.slug));
}

/**
 * Records that one orphaned slug is meant to disappear.
 *
 * Refuses for any slug the database still accounts for, archived or not. An
 * athlete who exists has a lifecycle, and archive is it — that path revokes
 * their outreach tokens and stops the collector too, none of which this does.
 * Reaching for this instead would take the page down while leaving every token
 * live, which looks like it worked and is not the same thing at all.
 *
 * Idempotent: retiring a slug that is already retired changes nothing and
 * keeps the original timestamp and reason, so a rerun cannot quietly rewrite
 * who decided what and when.
 */
export function retireOrphanSlug({ slug, reason, outputDir, database = db, at = utcNow() } = {}) {
  if (typeof slug !== 'string' || !SLUG.test(slug)) {
    throw new Error(`"${slug}" is not a public slug. Expected up to 32 letters and digits.`);
  }
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (!why) {
    throw new Error('A reason is required. It is the only record of why this page was taken down.');
  }
  if (!outputDir) throw new Error('outputDir is required — the register lives beside the site.');

  const owner = database
    .prepare('SELECT id, full_name, archived_at FROM players WHERE public_slug = ?')
    .get(slug);
  if (owner) {
    throw new Error(
      owner.archived_at
        ? `${slug} belongs to ${owner.full_name}, who is already archived. Archive already `
          + 'permits their page to disappear; retiring an orphan is for slugs no athlete owns.'
        : `${slug} belongs to ${owner.full_name}, who is an active athlete. Archive them through `
          + 'the normal lifecycle instead — that revokes their outreach tokens as well as taking '
          + 'the page down, which this does not.'
    );
  }

  const existing = readRetirements(outputDir);
  if (existing.error) {
    throw new Error(`Cannot retire anything while the register is unreadable: ${existing.error}`);
  }

  const already = existing.entries.find((r) => r.slug === slug);
  if (already) return { ...already, alreadyRetired: true };

  const entry = { slug, retiredAt: at, reason: why };
  writeRegistry(outputDir, [...existing.entries, entry]);
  return { ...entry, alreadyRetired: false };
}

/** Written whole, through a temporary file, so a crash cannot truncate it. */
function writeRegistry(outputDir, entries) {
  const file = retirementRegistryPath(outputDir);
  const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, `${JSON.stringify({ retirements: entries }, null, 2)}\n`);
  fs.renameSync(tmp, file);
}
