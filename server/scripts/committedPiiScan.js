#!/usr/bin/env node
/**
 * No real person's contact details may be committed to this repository.
 *
 *   npm run scan:committed-pii
 *
 * `main` carried 1,947 real head-coach addresses and 2,033 names in two
 * generated CSVs that nothing in the product reads. They arrived because a
 * generated artifact was copied into git and nobody looked. This scan is the
 * thing that looks, on every run, across every tracked file.
 *
 * IT IS NOT A CHECK ON TWO FILENAMES. Naming the files that were wrong catches
 * exactly the disclosure already found and nothing else; the next one will be a
 * different file. The rule is about the ADDRESS, wherever it appears.
 *
 * THE RULE
 *
 *   1. Redaction tokens are always fine — `…@redacted.invalid`, `[withheld]@…`.
 *   2. Reserved and placeholder domains are always fine: RFC 2606 (example.com,
 *      .test, .invalid, .localhost) and the obvious stand-ins (x.edu, a.com,
 *      school.edu, alpha.edu…). Nobody receives mail there.
 *   3. Domains we own are fine — they are ours to publish.
 *   4. Everywhere else, an address is a FINDING, with one narrow exception:
 *      source and test files may use an address listed in
 *      ALLOWED_FIXTURE_ADDRESSES, a register where every entry is a synthetic
 *      local part at a real-looking domain, added deliberately.
 *
 * DATA AND DOCUMENTATION GET NO EXCEPTION AT ALL. `data/`, `docs/` and anything
 * that looks generated must contain zero addresses outside rules 1–3, because
 * that is where bulk PII lands and a register there would just be somewhere to
 * hide it. A fixture belongs in a test, not in a committed dataset.
 *
 * Reported as counts and domains; the scan never prints an address it found.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

export const EMAIL_RX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Rule 2 — reserved by RFC 2606, or a placeholder nobody could receive mail at. */
const RESERVED_TLD = /\.(test|example|invalid|localhost|local|tld)$/i;
const RESERVED_DOMAIN = new Set([
  'example.com', 'example.org', 'example.net', 'example.edu', 'localhost', 'redacted.invalid',
]);
/** Single/short placeholder labels used throughout the fixtures: x.edu, a.com, b.co… */
const PLACEHOLDER = /^(?:[a-z]{1,2}|one|two|three|four|foo|bar|baz|test|fake|dummy|sample|empty|none|other|there|elsewhere|somewhere|shared|school|alpha|beta|gamma|acme|nowhere|first|second|third)\.[a-z]{2,4}$/i;

/** Rule 3 — domains this project owns. */
export const OWNED_DOMAINS = new Set(['cardaxia.ai', 'striv3.com', 'thriv3.com']);
/** Vendor/no-reply addresses that are not a person's mailbox. */
const VENDOR = /^(noreply|no-reply)@|@(users\.)?noreply\.github\.com$|@anthropic\.com$/i;

/**
 * Rule 4 — the register. EVERY ENTRY MUST BE A SYNTHETIC LOCAL PART.
 *
 * These are long-standing fixtures that use a recognisable university domain to
 * make a test read naturally. None is a real mailbox: they are `head@`, `asst@`,
 * `a@`, `optout@` and so on. Adding a real person here defeats the scan, so an
 * entry is a claim that the local part is invented — and `npm run scan:committed-pii`
 * prints the register so a reviewer can see it at a glance.
 */
export const ALLOWED_FIXTURE_ADDRESSES = new Set([
  'a@duke.edu', 'a1@duke.edu', 'a2@duke.edu', 'agree@duke.edu', 'ah@duke.edu', 'another@duke.edu',
  'assistant@duke.edu', 'assoc@duke.edu', 'asst@duke.edu', 'b@duke.edu', 'c@duke.edu',
  'coach@duke.edu', 'corrected@duke.edu', 'f@duke.edu', 'filler@duke.edu', 'followed@duke.edu',
  'g@duke.edu', 'gk@duke.edu', 'h@duke.edu', 'h1@duke.edu', 'h2@duke.edu', 'head@duke.edu',
  'john@duke.edu', 'john.smith.a.very.long.address@athletics.duke.edu', 'moved@duke.edu',
  'new@duke.edu', 'none@duke.edu', 'o@duke.edu', 'old@duke.edu', 'only@duke.edu',
  'opted@duke.edu', 'optout@duke.edu', 'other@duke.edu', 'popular@duke.edu', 'r@duke.edu',
  'second@duke.edu', 'soccer@duke.edu', 'theirs@duke.edu', 'u@duke.edu', 'v@duke.edu',
  'w@duke.edu', 'x@duke.edu', 'z@duke.edu',
  'e@elon.edu', 'h@elon.edu', 'opted@elon.edu',
  'other@clemson.edu', 'spend@clemson.edu', 'x@clemson.edu',
  'transition@annamaria.edu',
  'athlete@gmail.com',

  /**
   * PR #49 (institution identity) fixtures, added when that branch reconciled
   * with this contract. Every one was checked against the real coach data
   * before being listed: none matches a stored address, none matches a stored
   * name, and none is name-derived. That last check is the one that mattered —
   * the branch carried an address built from a real head coach's surname at
   * their real institution, which a membership test against our own `coaches`
   * table passed cleanly because we had never imported that particular
   * address. Belonging to a person is not the same as being in our table.
   * (Naming it here would republish it, which is why it is described instead.)
   */
  'a@aquinas.edu', 'a@bethanylb.edu', 'a@dom.edu', 'a@fiu.edu', 'a@gapu.edu', 'a@held.edu',
  'a@inactive.edu', 'a@keene.edu', 'a@maine.edu', 'a@mcla.edu', 'a@nec.edu', 'a@ozarks.edu',
  'a@ric.edu', 'a@sckans.edu', 'a@sterling.edu', 'a@stmarytx.edu', 'a@wilmington.edu',
  'a@wustl.edu', 'amy@gapu.edu', 'amy@testu.edu', 'ann@eureka.edu', 'bad@faulkner.edu',
  'bad@gapu.edu', 'bob@realstate.edu', 'cara@eureka.edu', 'coach@faulkner.edu',
  'coach@gmail.com', 'coach2@gmail.com', 'coach@naiau.edu', 'coachgmail@gmail.com',
  'good@faulkner.edu', 'good@gapu.edu', 'head@fallout.edu', 'held@gapu.edu',
  'jane@testville.com', 'newcoach@faulkner.edu', 'newasst@faulkner.edu',
  'samfixture@bethanywv.edu', 'samfixture@faulkner.edu', 'someoneelse@bethanywv.edu',
  'soccer@faulkner.edu', 'soccer@gapu.edu', 'someone@stmarytx.edu', 'wrong@faulkner.edu',
  'x@faulkner.edu',
]);

/** Paths that may never carry an address outside rules 1–3. */
export const NO_EXCEPTION_PREFIXES = ['data/', 'docs/'];
export const GENERATED_HINT = /(^|\/)(generated|__baselines__|fixtures|artifacts|snapshots)(\/|$)/i;

export const isToken = (a) => a.endsWith('@redacted.invalid') || a.startsWith('[withheld]@');
export function isAlwaysAllowed(address) {
  const a = address.toLowerCase();
  if (isToken(a) || VENDOR.test(a)) return true;
  const d = a.split('@').pop();
  return RESERVED_DOMAIN.has(d) || RESERVED_TLD.test(d) || PLACEHOLDER.test(d) || OWNED_DOMAINS.has(d);
}
export const allowsFixtures = (rel) =>
  !NO_EXCEPTION_PREFIXES.some((p) => rel.startsWith(p)) && !GENERATED_HINT.test(rel);

/** Findings for one file's text. Never returns the address itself. */
export function scanText(rel, text) {
  const findings = [];
  for (const a of new Set((text.match(EMAIL_RX) || []).map((s) => s.toLowerCase()))) {
    if (isAlwaysAllowed(a)) continue;
    if (allowsFixtures(rel) && ALLOWED_FIXTURE_ADDRESSES.has(a)) continue;
    findings.push({
      domain: a.split('@').pop(),
      reason: allowsFixtures(rel) ? 'not a reserved domain and not in the fixture register'
        : 'data/docs and generated artifacts may not contain any real-looking address',
    });
  }
  return findings;
}

export function trackedFiles(cwd = ROOT) {
  return execFileSync('git', ['ls-files'], { cwd, encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\n').filter(Boolean);
}

export function scanRepo(cwd = ROOT) {
  const out = [];
  for (const rel of trackedFiles(cwd)) {
    const abs = path.join(cwd, rel);
    let buf; try { buf = fs.readFileSync(abs); } catch { continue; }
    if (buf.includes(0)) continue; // binary
    const findings = scanText(rel, buf.toString('utf8'));
    if (findings.length) out.push({ file: rel, count: findings.length, domains: [...new Set(findings.map((f) => f.domain))], reason: findings[0].reason });
  }
  return out;
}

function main() {
  const findings = scanRepo();
  console.log(`scanned ${trackedFiles().length} tracked files`);
  console.log(`fixture register: ${ALLOWED_FIXTURE_ADDRESSES.size} declared synthetic addresses`);
  if (!findings.length) { console.log('\nNo committed contact PII found.'); return; }
  console.log('\nFINDINGS (domains only — the scan never prints an address):');
  for (const f of findings) console.log(`  ${String(f.count).padStart(5)}  ${f.file}\n         ${f.domains.slice(0, 6).join(', ')}${f.domains.length > 6 ? ` +${f.domains.length - 6}` : ''}\n         ${f.reason}`);
  console.log(`\n${findings.length} file(s) with unapproved addresses.`);
  process.exit(1);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
