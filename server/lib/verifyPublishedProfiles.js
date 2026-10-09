/**
 * PUBLISHED PROFILES AGAINST THE DATABASE — deployment readiness §2d, check 3.
 *
 * Read-only. Compares a COPY of the database with a copy of the generated
 * profile pages (a directory, or the backup's `profiles.tgz`).
 *
 * Pages live at `<THRIV3_BUILD_DIR>/p/<slug>.html` (exportProfiles.js), and
 * `/p/:slug` serves one only for a non-archived athlete with that slug
 * (publicProfile.js). So, for one backup:
 *
 *   MISSING   a non-archived athlete with `published_at` set has no page.
 *             A coach holding that link would be told the profile is no
 *             longer shared. Always a failure.
 *   ORPHANED  a page whose slug belongs to no non-archived athlete (an
 *             archived or deleted athlete, or a slug no row holds). Never
 *             served, but it means the pages and the rows are not from the
 *             same moment. A failure for the §2d proof.
 *   UNSTAMPED a page for a non-archived athlete without `published_at`.
 *             Normal: a publish regenerates every eligible athlete's page.
 *             Reported, not a failure.
 *
 * Output carries athlete ids and slugs only, never names or addresses.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { openCopyReadOnly } from './dbFingerprint.js';

/** The slug rule `/p/:slug` applies (server/routes/publicProfile.js). */
export const SLUG = /^[A-Za-z0-9]{1,32}$/;

const PAGE = /(?:^|\/)p\/([^/]+)\.html$/;

/** Slugs of the pages in a profiles directory or a `profiles.tgz`. */
export function pageSlugs(source) {
  if (!fs.existsSync(source)) throw new Error(`${source} does not exist.`);
  let entries;
  if (fs.statSync(source).isDirectory()) {
    const pdir = path.join(source, 'p');
    entries = fs.existsSync(pdir) ? fs.readdirSync(pdir).map((f) => `p/${f}`) : [];
  } else {
    // List the archive; nothing is extracted.
    entries = execFileSync('tar', ['-tzf', source], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
      .split('\n').filter(Boolean);
  }
  const slugs = new Set();
  for (const e of entries) {
    const m = PAGE.exec(e.replace(/^\.\//, ''));
    if (m) slugs.add(m[1]);
  }
  return slugs;
}

/** A publish interrupted mid-swap leaves these beside the live directory (sitePublisher.js). */
function leftovers(source) {
  if (!fs.statSync(source).isDirectory()) return [];
  const base = source.replace(/\/+$/, '');
  return ['.staging', '.superseded'].map((s) => `${base}${s}`).filter((p) => fs.existsSync(p));
}

export function verifyPublishedProfiles(dbFile, profiles, opts = {}) {
  const db = openCopyReadOnly(dbFile, opts);
  let athletes;
  try {
    athletes = db.prepare(`SELECT id, public_slug, published_at, archived_at FROM players`).all();
  } finally {
    db.close();
  }
  const pages = pageSlugs(profiles);
  const live = new Map();     // slug -> athlete, non-archived only
  const archived = new Map(); // slug -> athlete id
  const badSlugs = [];
  for (const a of athletes) {
    if (!a.public_slug) continue;
    if (!SLUG.test(a.public_slug)) { badSlugs.push({ athleteId: a.id, slug: a.public_slug }); continue; }
    (a.archived_at ? archived : live).set(a.public_slug, a);
  }
  const missing = []; const unstamped = []; const orphaned = [];
  for (const [slug, a] of live) {
    if (a.published_at && !pages.has(slug)) missing.push({ athleteId: a.id, slug });
  }
  for (const slug of pages) {
    const a = live.get(slug);
    if (!a) orphaned.push({ slug, why: archived.has(slug) ? 'ARCHIVED_ATHLETE' : 'NO_ATHLETE' });
    else if (!a.published_at) unstamped.push({ athleteId: a.id, slug });
  }
  const sort = (xs) => xs.sort((x, y) => x.slug.localeCompare(y.slug));
  return {
    ok: missing.length === 0 && orphaned.length === 0,
    counts: {
      athletesPublished: [...live.values()].filter((a) => a.published_at).length,
      pages: pages.size,
      missing: missing.length,
      orphaned: orphaned.length,
      unstamped: unstamped.length,
    },
    missing: sort(missing),
    orphaned: sort(orphaned),
    unstamped: sort(unstamped),
    invalidSlugs: badSlugs,
    interruptedPublish: leftovers(profiles),
  };
}
