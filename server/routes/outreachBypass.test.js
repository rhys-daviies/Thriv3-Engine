import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * There must be exactly one way to put mail in front of a coach.
 *
 * `sendOutreach` is where suppression, the per-inbox send cap, evidence
 * derivation, evidence logging and the tracking token all live. A second route
 * to a coach's inbox does not merely skip a feature — it silently corrupts the
 * things the other paths guarantee: an opted-out coach can be written to again,
 * the engagement data shows a contacted coach as never contacted, and the
 * personalisation measurement is wrong about its own denominator.
 *
 * Two such surfaces existed and were removed on 2026-08-28: a live
 * `/api/send-email` stub with no callers, and a raw `mailto:` beside every
 * coach address on the match card. This test is what stops either coming back
 * in a form nobody notices, because both were invisible in review — one was
 * dead code, the other looked like a convenience.
 *
 * Scanned as source text rather than by importing, because the failure mode is
 * a new file nobody thought to wire into a test.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SEARCH_DIRS = ['src', 'server', 'shared', 'worker'];
const SKIP = new Set(['node_modules', 'dist', 'build', '.git', 'uploads', 'data']);

function sourceFiles(dir, out = []) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return out;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(rel, out);
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

const FILES = sourceFiles('src').concat(
  sourceFiles('server'), sourceFiles('shared'), sourceFiles('worker'),
);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

/**
 * Files allowed to match, each for a stated reason.
 *
 * An allowlist rather than a cleverer pattern: when a new file trips this
 * test, somebody has to decide whether it is a bypass or a legitimate use and
 * write down which. A regex tuned until it passes decides that silently.
 */
const ALLOWED = new Map([
  ['src/components/CoachEmail.jsx', 'describes the mailto it replaced'],
  ['server/routes/outreachBypass.test.js', 'this file names the patterns it forbids'],
  // Thriv3's OWN address on the privacy notice. CAN-SPAM 7704(a)(3) requires a
  // working opt-out facility; removing it would break compliance, not a bypass.
  ['shared/compliancePages.js', 'our own opt-out contact address'],
  // A regex that PARSES markdown links, including mailto: ones. It sends
  // nothing and creates no link of its own.
  ['shared/emailHtml.js', 'markdown link parser, not a link'],
  // Local fixtures: 24 fake outreach rows so the engagement screens have
  // something to render. No send primitive exists anywhere under server/seed/,
  // which the test below asserts rather than assumes.
  ['server/seed/seedEngagement.js', 'local engagement fixtures'],
  ['server/seed/simulateEngagement.js', 'local engagement fixtures'],
]);

const allowed = (f) => ALLOWED.has(f);

describe('there is exactly one coach-contact path', () => {
  it('found source files to scan', () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  it('has no /api/send-email route or client stub anywhere', () => {
    const offenders = FILES.filter((f) => !allowed(f) && /send-email|sendEmailStub/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  /**
   * A coach address in a `mailto:` is the bypass. The athlete's own contacts —
   * their email, their guardian's, their club coach's — are legitimately
   * mail links on their own profile and are not coach outreach, so those
   * fields are named as the permitted exceptions rather than the whole
   * pattern being waved through.
   */
  it('has no mailto: built from a coach address', () => {
    const ATHLETE_CONTACT = /(athlete|player|guardian|club_coach)/i;
    const offenders = [];
    for (const f of FILES) {
      if (allowed(f)) continue;
      for (const line of read(f).split('\n')) {
        if (!line.includes('mailto:')) continue;
        if (ATHLETE_CONTACT.test(line)) continue;   // the athlete's own people
        offenders.push(`${f}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('routes every Outlook compose through sendOutreach', () => {
    const callers = FILES.filter((f) => (
      /composeInOutlook\s*\(/.test(read(f))
      && !f.endsWith('lib/outlook.js')      // the primitive itself
      && !f.endsWith('.test.js')            // the mock
    ));
    expect(callers).toEqual(['server/routes/sendOutreach.js']);
  });

  it('creates outreach records in exactly one place', () => {
    const callers = FILES.filter((f) => (
      /createOutreach\s*\(/.test(read(f))
      && !f.endsWith('lib/outreach.js')
      && !f.endsWith('.test.js')
      && !allowed(f)
    ));
    expect(callers).toEqual(['server/routes/sendOutreach.js']);
  });

  /**
   * The seed fixtures are allowed to create outreach rows because they cannot
   * mail anybody. Asserted rather than assumed — the allowance above is only
   * safe while it stays true.
   */
  it('keeps every send primitive out of the seed fixtures', () => {
    const seeds = FILES.filter((f) => f.startsWith('server/seed/'));
    expect(seeds.length).toBeGreaterThan(0);
    const offenders = seeds.filter((f) => /composeInOutlook|sendOutreach|nodemailer|smtp/i.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('logs evidence only from the send path', () => {
    const callers = FILES.filter((f) => (
      /\blogEvidence\s*\(/.test(read(f))
      && !f.endsWith('lib/evidenceLog.js')
      && !f.endsWith('.test.js')
    ));
    expect(callers).toEqual(['server/routes/sendOutreach.js']);
  });
});
