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
  /**
   * R2B — THE ONE LEGITIMATE mailto, AND WHY IT IS NOT THE BYPASS THIS FILE
   * WAS WRITTEN AGAINST.
   *
   * =======================================================================
   * THE 2026-08-28 BYPASS WAS A RAW LINK BESIDE A COACH ADDRESS ON A CARD.
   * It reached a coach's inbox WITHOUT passing suppression, the per-inbox
   * cap, the compliance footer, the tracking token or any record at all —
   * which is why an opted-out coach could be written to again and the
   * engagement data would show them as never contacted.
   *
   * This one is the opposite of that in every respect that matters. It is
   * built by the SERVER, at the END of `sendOutreach`, downstream of every
   * one of those guards, from a DRAFT that has already been persisted and
   * whose digest it is checked against. The recipient is refused outright if
   * it carries a character that is structural in a URI. And it carries no
   * body: the operator pastes one that came from the same row.
   *
   * SO THE ALLOWLIST IS NOT THE WHOLE PROTECTION. The test below requires
   * that the URL is CONSTRUCTED in exactly one file, so a second `mailto:`
   * appearing anywhere — including inside these allowed files — still fails.
   * =======================================================================
   */
  ['server/lib/emailHandoff.js', 'R2B: the one governed mailto, built after every guard'],
  ['server/lib/emailHandoff.test.js', 'proves what that URL may and may not carry'],
  // Receives a finished URL and navigates to it. Constructs nothing — which
  // the construction test below is what actually enforces.
  ['src/lib/emailHandoff.js', 'R2B: navigates to the server\u2019s URL, builds none'],
  ['src/components/emailHandoff.test.js', 'proves the client builds no URL of its own'],
  /**
   * R2C.1 added this file and did not add it here, so this guard has been
   * failing on main since PR #37 — which means the one test standing between
   * the product and a second coach-contact path has not been protecting
   * anything. The escape is instructive: that slice was frontend-only and
   * correctly did not re-run the backend suite, and an allowlist in a server
   * test is exactly the thing a frontend change cannot see itself break.
   *
   * The file's only `mailto:` is at line 61, inside `handoffFor()` — a test
   * double fabricating the shape the SERVER returns so the component can be
   * rendered without one. It builds no URL the product uses, and nothing
   * imports it.
   */
  ['src/components/bulkHandoff.test.js', 'fixture handoffs; the construction tests below are the guard'],
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

  /**
   * THE TEETH THE ALLOWLIST WOULD OTHERWISE REMOVE — R2B.
   *
   * `mailto:` is now permitted in four files, so the line scan above no
   * longer catches a second one appearing inside them. This asserts the
   * property that actually matters: a URL is BUILT from a coach address in
   * exactly one place, and that place is a server module running after every
   * guard.
   *
   * Same exclusions as the scan above, for the same reasons. The athlete's
   * own people are mail links on their own profile and always were; Thriv3's
   * opt-out address is a CAN-SPAM obligation. Neither is coach outreach.
   *
   * A construction anywhere else — a component, a hook, a worker, a script —
   * fails here whatever the allowlist says.
   */
  const ATHLETE_CONTACT_LINE = /(athlete|player|guardian|club_coach|contactEmail)/i;
  const BUILDS_MAILTO = /(`|'|")mailto:[^'"`]*\$\{|(`|'|")mailto:['"`]\s*\+/;

  const linesBuildingMailto = (f) => read(f).split('\n')
    .filter((line) => BUILDS_MAILTO.test(line) && !ATHLETE_CONTACT_LINE.test(line));

  it('builds a mailto: URL from a coach address in exactly one governed file', () => {
    const builders = FILES.filter((f) => (
      !f.endsWith('.test.js') && linesBuildingMailto(f).length > 0
    ));
    expect(builders).toEqual(['server/lib/emailHandoff.js']);
  });

  /**
   * And the client builds none at all. It is handed a finished URL and
   * navigates to it — the courier property, asserted as source text because
   * the failure mode is a new file nobody wired into a test.
   */
  it('builds no coach mailto: anywhere under src/', () => {
    const offenders = FILES.filter((f) => (
      f.startsWith('src/') && !f.endsWith('.test.js') && linesBuildingMailto(f).length > 0
    ));
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

  /**
   * TWO PATHS NOW OPEN A RELATIONSHIP, AND BOTH ARE GOVERNED — D4.5.
   *
   * This asserted ONE file, and the reason was never the number: it was that
   * every path to a coach must carry suppression, the per-inbox cap, the
   * tracking token and the campaign gates. `sendOutreach` is the legacy
   * AppleScript path. `executionClaim` is the provider execution claim, and it
   * was built to carry exactly those guarantees — which the test below now
   * requires of it rather than taking on trust.
   *
   * The list is named and closed. A third file appearing here still fails, and
   * a second path that skipped a guard would fail the companion test even if
   * somebody added it to this list.
   */
  const CONTACT_PATHS = ['server/lib/executionClaim.js', 'server/routes/sendOutreach.js'];

  it('creates outreach records in exactly two governed places', () => {
    const callers = FILES.filter((f) => (
      /createOutreach\s*\(/.test(read(f))
      && !f.endsWith('lib/outreach.js')
      && !f.endsWith('.test.js')
      && !allowed(f)
    ));
    expect(callers.sort()).toEqual(CONTACT_PATHS);
  });

  it('makes every contact path carry the guarantees the single one carried', () => {
    /**
     * The assertion that keeps the list above honest. A path that opens a
     * relationship with a coach must check the global suppression list and the
     * per-inbox cap; without both, an opted-out coach can be written to again
     * and a popular programme's head coach can be written to by five athletes
     * in a fortnight. Named by symbol rather than by behaviour because this
     * file scans source text — the behavioural proof is each path's own suite.
     */
    for (const f of CONTACT_PATHS) {
      const src = read(f);
      expect(src, `${f} must consult the suppression list`).toMatch(/isSuppressed|campaignContactDecision/);
      expect(src, `${f} must consult the per-inbox send cap`).toMatch(/isSendCapped/);
    }
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
