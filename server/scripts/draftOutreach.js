#!/usr/bin/env node
/**
 * Drafts a whole athlete's outreach into Outlook in one go.
 *
 * The UI composes per school, so a top-20 list is twenty trips through the
 * same dialog, and three athletes is sixty. This does the same thing in one
 * command: rank, pick the staff worth writing to, fill the athlete's own
 * template, and hand each message to Outlook as a draft. Nothing is sent —
 * you review and press send in Outlook, which is the whole point of running
 * the first pilot this way.
 *
 * Dry run by default, and the dry run is the useful half: it prints exactly
 * who would be written to, who is skipped and why, before anything opens.
 *
 *   node server/scripts/draftOutreach.js --athlete "Ryan Billing"
 *   node server/scripts/draftOutreach.js --athlete "Ryan Billing" --top 20 --apply
 *   node server/scripts/draftOutreach.js --athlete <id> --roles head
 */
import 'dotenv/config';
import db from '../db/client.js';
import { Player } from '../db/entities/player.js';
import { sendOutreach } from '../routes/sendOutreach.js';
import { buildRosterIndex, rankMatches, normaliseAthlete } from '../../shared/matching/pool.js';
import { shouldContact, bySeniority, classifyRole } from '../../shared/coachRoles.js';
import { isSuppressed } from '../lib/suppressions.js';
import { recentSendCount } from '../lib/sendCap.js';
import { complianceGaps, PER_COACH_MAX_SENDS } from '../lib/config.js';
import {
  fillTemplate, buildEmailContext, DEFAULT_EMAIL_SUBJECT, DEFAULT_EMAIL_TEMPLATE,
} from '../../src/lib/emailTemplate.js';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const TOP = Number(arg('top', 20));
const ROLES = (arg('roles', 'head,associate-head,assistant') || '').split(',').map((r) => r.trim()).filter(Boolean);

/**
 * The registrable-ish part of an address's domain.
 *
 * unc.edu, uncaa.unc.edu and live.unc.edu are one institution and must not
 * read as three; smumn.edu and stmarys-ca.edu are two Saint Mary's and must
 * not read as one. Last two labels gets both right for .edu, which is what
 * these addresses overwhelmingly are.
 */
function rootDomain(email) {
  const host = (email || '').split('@')[1];
  if (!host) return null;
  return host.toLowerCase().split('.').slice(-2).join('.');
}

/**
 * Contacts for one school sitting on unrelated domains.
 *
 * A strong signal the contact list has been contaminated by a same-named
 * institution — "Saint Mary's" carries staff from four of them, and
 * "Trinity (TX)" mixes Trinity University in Texas with Trinity College in
 * Connecticut. 191 of 1,986 school-sports are affected. There is nothing to
 * validate against yet (colleges.website_domain is empty on every row), so
 * this cannot say which domain is right — only that they disagree, which is
 * enough to stop you emailing the wrong school's coach.
 */
function domainSplit(coaches) {
  const roots = new Set(coaches.map((c) => rootDomain(c.email)).filter(Boolean));
  return roots.size > 1 ? [...roots] : null;
}

function findAthlete(needle) {
  if (!needle) return null;
  return Player.get(needle)
    || db.prepare('SELECT * FROM players WHERE lower(full_name) = lower(?)').get(needle)
    || db.prepare("SELECT * FROM players WHERE lower(full_name) LIKE lower(?)").get(`%${needle}%`);
}

function main() {
  const athlete = findAthlete(arg('athlete'));
  if (!athlete) {
    console.error('\nUsage: node server/scripts/draftOutreach.js --athlete "<name or id>" [--top 20] [--roles head,assistant] [--apply]\n');
    console.error('Known athletes: ' + db.prepare('SELECT full_name FROM players').all().map((p) => p.full_name).join(', ') + '\n');
    process.exit(1);
  }

  const sport = athlete.sport || 'mens-soccer';
  const colleges = db.prepare('SELECT * FROM colleges WHERE sport = ? AND active = 1').all(sport);
  const roster = db.prepare(
    'SELECT college_name, player_name, position, minutes_played, estimated_graduation_year, country FROM roster_players WHERE sport = ? AND season = ?'
  ).all(sport, '2025');

  const { results } = rankMatches({
    athlete: normaliseAthlete(athlete),
    colleges,
    rosterIndex: buildRosterIndex(roster),
  });
  const top = results.slice(0, TOP);

  const staffFor = db.prepare('SELECT * FROM coaches WHERE school = ? AND sport = ?');
  const plan = [];
  const skipped = { suppressed: [], capped: [], noContacts: [], byRole: {} };

  for (const college of top) {
    const staff = staffFor.all(college.name, sport);
    if (!staff.length) { skipped.noContacts.push(college.name); continue; }

    const chosen = [];
    for (const coach of staff.sort(bySeniority)) {
      const role = classifyRole(coach.position_title);
      if (!shouldContact(coach, { roles: ROLES, athletePosition: athlete.position })) {
        skipped.byRole[role] = (skipped.byRole[role] || 0) + 1;
        continue;
      }
      if (isSuppressed(coach.email)) { skipped.suppressed.push(coach.email); continue; }
      // Reported here as well as enforced at send time, so a capped contact is
      // visible while there is still time to choose a different school.
      if (PER_COACH_MAX_SENDS > 0 && recentSendCount(coach.email) >= PER_COACH_MAX_SENDS) {
        skipped.capped.push(coach.email);
        continue;
      }
      chosen.push({ name: coach.full_name, email: coach.email, title: coach.position_title, role, status: coach.email_status });
    }
    if (chosen.length) plan.push({ college, coaches: chosen, domainSplit: domainSplit(chosen) });
  }

  // ---- report ----
  const totalCoaches = plan.reduce((n, p) => n + p.coaches.length, 0);
  const inferred = plan.flatMap((p) => p.coaches).filter((c) => c.status === 'inferred').length;

  console.log(`\n${athlete.full_name} — ${sport}, ${athlete.position}, class of ${athlete.recruiting_class_year || '?'}`);
  console.log(`top ${TOP} programmes, roles: ${ROLES.join(', ')}${String(athlete.position || '').toUpperCase().startsWith('GOALKEEP') ? ' (+ goalkeeper coaches)' : ''}\n`);
  for (const { college, coaches, domainSplit: split } of plan) {
    console.log(`  ${String(college.match_score).padStart(3)}  ${college.name.padEnd(34)} ${String(college.division).padEnd(9)} ${coaches.length} contact(s)`);
    if (split) console.log(`         !! contacts span unrelated domains (${split.join(', ')}) — likely a same-named school mixed in. Check before sending.`);
    for (const c of coaches) {
      console.log(`         ${(c.name || '—').padEnd(26)} ${c.role.padEnd(15)} ${c.email}${c.status === 'inferred' ? '  [inferred]' : ''}`);
    }
  }

  console.log(`\n  ${plan.length} programme(s), ${totalCoaches} draft(s).`);
  if (inferred) console.log(`  ${inferred} address(es) are inferred and have never been observed to work — expect these to bounce.`);
  const split = plan.filter((p) => p.domainSplit);
  if (split.length) console.log(`  !! ${split.length} programme(s) have contacts on unrelated domains: ${split.map((p) => p.college.name).join(', ')}`);
  if (skipped.noContacts.length) console.log(`  ${skipped.noContacts.length} programme(s) skipped, no contacts at all: ${skipped.noContacts.join(', ')}`);
  if (skipped.suppressed.length) console.log(`  ${skipped.suppressed.length} contact(s) skipped, opted out`);
  if (skipped.capped.length) console.log(`  ${skipped.capped.length} contact(s) skipped, at the per-inbox cap`);
  const byRole = Object.entries(skipped.byRole).sort((a, b) => b[1] - a[1]);
  if (byRole.length) console.log(`  roles not written to: ${byRole.map(([r, n]) => `${r} ${n}`).join(', ')}`);

  const gaps = complianceGaps();
  if (gaps.length) {
    console.log(`\n  Cannot draft yet — missing ${gaps.join(', ')}.\n`);
    process.exit(APPLY ? 1 : 0);
  }
  if (!APPLY) {
    console.log('\ndry run — nothing drafted. Re-run with --apply to open these in Outlook.\n');
    return;
  }

  // ---- draft ----
  console.log('\ndrafting…');
  let drafted = 0;
  const failures = [];
  (async () => {
    for (const { college, coaches } of plan) {
      const context = buildEmailContext(athlete, college, coaches[0].name || 'Coach');
      try {
        const { results: sent } = await sendOutreach({
          athleteId: athlete.id,
          coaches: coaches.map((c) => ({ name: c.name, email: c.email, title: c.title })),
          subject: fillTemplate(athlete.email_subject || DEFAULT_EMAIL_SUBJECT, context),
          body: fillTemplate(athlete.email_template || DEFAULT_EMAIL_TEMPLATE, context),
          greetingName: coaches[0].name || 'Coach',
          collegeName: college.name,
          division: college.division,
          matchId: college.name,
          send: false,   // drafts only, always — you press send in Outlook
        });
        for (const r of sent) {
          if (r.status === 'drafted') drafted++;
          else failures.push(`${college.name} / ${r.email}: ${r.status}${r.error ? ` — ${r.error}` : ''}`);
        }
      } catch (err) {
        failures.push(`${college.name}: ${err.message}`);
      }
    }
    console.log(`\n${drafted} draft(s) waiting in Outlook. Nothing has been sent.`);
    if (failures.length) {
      console.log(`\n${failures.length} did not draft:`);
      for (const f of failures) console.log(`  ${f}`);
    }
    console.log();
  })();
}

main();
