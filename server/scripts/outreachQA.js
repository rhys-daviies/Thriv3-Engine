#!/usr/bin/env node
/**
 * The emails that would be drafted, read end to end before any are.
 *
 *   npm run outreach-qa -- --athlete "Rhys Davies"
 *   npm run outreach-qa -- --athlete "Rhys Davies" --pool 400
 *
 * THE PRODUCTION PATH, MINUS THE LAST CALL.
 *
 * Everything here is lifted from server/scripts/draftOutreach.js: the same
 * ranking query on the same 2025 roster, the same `rankMatches`, the same staff
 * query, seniority sort and `shouldContact` filter, the same suppression and
 * per-inbox cap, `evidenceFor` with NO match passed (so departures are
 * recomputed from the 2026 squad), the same `emailBodyFor`, and the subject
 * filled from the same context object. The only thing it does not do is call
 * `sendOutreach`, so nothing is drafted, logged or sent.
 *
 * If this file and draftOutreach.js ever disagree, this report is describing an
 * email nobody would receive — which is why every step above names the thing it
 * is copying rather than approximating it.
 *
 * DETERMINISTIC. The pool is ranked, the categories are walked in a fixed
 * order, and each programme is assigned to the first unfilled category it
 * satisfies. Re-running on the same data gives the same fifteen.
 */
import 'dotenv/config';
import db from '../db/client.js';
import { Player } from '../db/entities/player.js';
import { buildRosterIndex, rankMatches, normaliseAthlete } from '../../shared/matching/pool.js';
import { shouldContact, bySeniority, classifyRole } from '../../shared/coachRoles.js';
import { isSuppressed } from '../lib/suppressions.js';
import { recentSendCount } from '../lib/sendCap.js';
import { PER_COACH_MAX_SENDS } from '../lib/config.js';
import { fillTemplate, emailBodyFor, DEFAULT_EMAIL_SUBJECT } from '../../src/lib/emailTemplate.js';
import { evidenceFor } from '../lib/evidenceQueries.js';
import { TIERS } from '../../shared/evidence/kinds.js';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const POOL = Number(arg('pool', 920));
const ROLES = ['head', 'associate-head', 'assistant'];

const rule = (c = '=') => console.log(c.repeat(78));
const head = (t) => { console.log(); rule(); console.log(t); rule(); };

/* -------------------------------------------------------------------------- */
/* The pool, exactly as draftOutreach builds it                                */
/* -------------------------------------------------------------------------- */

function poolFor(athlete) {
  const sport = athlete.sport || 'mens-soccer';
  const colleges = db.prepare('SELECT * FROM colleges WHERE sport = ? AND active = 1').all(sport);
  const roster = db.prepare(
    'SELECT college_name, player_name, position, minutes_played, estimated_graduation_year, country'
    + ' FROM roster_players WHERE sport = ? AND season = ?',
  ).all(sport, '2025');
  const { results } = rankMatches({
    athlete: normaliseAthlete(athlete),
    colleges,
    rosterIndex: buildRosterIndex(roster),
  });
  return results.slice(0, POOL);
}

const staffFor = db.prepare('SELECT * FROM coaches WHERE school = ? AND sport = ?');

/** The contacts draftOutreach would write to at this programme, in its order. */
function contactsFor(college, athlete, sport) {
  const chosen = [];
  for (const coach of staffFor.all(college.name, sport).sort(bySeniority)) {
    if (!shouldContact(coach, { roles: ROLES, athletePosition: athlete.position })) continue;
    if (isSuppressed(coach.email)) continue;
    if (PER_COACH_MAX_SENDS > 0 && recentSendCount(coach.email) >= PER_COACH_MAX_SENDS) continue;
    chosen.push({
      name: coach.full_name, email: coach.email, title: coach.position_title,
      role: classifyRole(coach.position_title), status: coach.email_status,
    });
  }
  return chosen;
}

/* -------------------------------------------------------------------------- */
/* The QA categories                                                           */
/* -------------------------------------------------------------------------- */

const kindsOf = (e) => e.selected.map((x) => x.kind);
const hasKind = (e, k) => kindsOf(e).includes(k);
const INTERNATIONAL = (e) => e.selected.filter((x) => x.category === 'international');

/**
 * Walked in this order, each programme taken by the first category it fits.
 *
 * Order is the tie-break, not a ranking: a programme that satisfies two
 * categories fills the earlier one, and the later category then keeps looking
 * further down the pool. That is what stops the sample being fifteen versions
 * of the same email.
 */
const CATEGORIES = [
  ['COACH_ARRIVAL_SAME_COUNTRY', 3, (e) => hasKind(e, 'COACH_ARRIVAL_SAME_COUNTRY')],
  ['ARRIVAL_SAME_COUNTRY_POSITION', 2, (e) => hasKind(e, 'ARRIVAL_SAME_COUNTRY_POSITION')],
  ['ARRIVAL_SAME_REGION_POSITION', 2, (e) => hasKind(e, 'ARRIVAL_SAME_REGION_POSITION')],
  ['HISTORICAL_SAME_COUNTRY fallback', 2, (e) => hasKind(e, 'HISTORICAL_SAME_COUNTRY')],
  ['HISTORICAL_SAME_REGION fallback', 1, (e) => hasKind(e, 'HISTORICAL_SAME_REGION')],
  ['PLAYER_FIRST, no international hook', 2,
    (e) => e.structure.key === 'PLAYER_FIRST' && INTERNATIONAL(e).length === 0 && e.selected.length >= 2],
  ['strong recognition', 1,
    (e) => e.selected.some((x) => x.kind === 'CONFERENCE_TITLE' || x.kind === 'POSTSEASON_RESULT')],
  ['academic-heavy', 1, (e) => hasKind(e, 'ACADEMIC_FIT') && e.selected.length >= 3],
  ['only one evidence item survives', 1, (e) => e.selected.length === 1],
];

/* -------------------------------------------------------------------------- */
/* Measuring one email                                                         */
/* -------------------------------------------------------------------------- */

const words = (s) => s.split(/\s+/).filter(Boolean).length;
const paragraphs = (s) => s.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
const sentencesOf = (s) => s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);

/**
 * How much of the email is personalisation, measured three ways.
 *
 * `claims` counts DISPLAYED evidence items — each is one thing a coach could
 * check against their own records. `evidenceSentences` counts sentences of the
 * body that carry at least one of those clauses, which is smaller whenever the
 * composer gathers two observations into one sentence. Reporting both is the
 * point: an email with three claims in one sentence reads very differently from
 * one with three sentences.
 */
function measure(body, evidence) {
  const displayed = (evidence.composition?.placement ?? [])
    .filter((p) => p.displayed !== false).map((p) => p.kind);
  const texts = (evidence.sentences ?? [])
    .filter((s) => displayed.includes(s.kind))
    .map((s) => s.text)
    .filter(Boolean);

  const sents = sentencesOf(body.replace(/\n/g, ' '));
  // A clause is matched by its longest distinctive fragment rather than by
  // whole-sentence equality: the composer reframes the same clause depending on
  // where it lands, so an exact match would count nothing.
  const fragment = (t) => t.replace(/^I (saw|noticed)\s+/i, '').split(',')[0].trim();
  const carrying = sents.filter((s) => texts.some((t) => fragment(t) && s.includes(fragment(t))));

  return {
    words: words(body),
    paragraphs: paragraphs(body).length,
    evidenceSentences: carrying.length,
    claims: displayed.length,
    factClaims: evidence.selected.filter((e) => displayed.includes(e.kind) && e.tier === TIERS.FACT).length,
  };
}

/* -------------------------------------------------------------------------- */
/* Fact check                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The observation behind every personalised statement in the email.
 *
 * Printed from `ev.data`, which is what the log records, so a claim in this
 * report and a claim in `outreach_evidence.payload` can never describe
 * different rows.
 */
function factCheck(evidence) {
  const displayed = new Set((evidence.composition?.placement ?? [])
    .filter((p) => p.displayed !== false).map((p) => p.kind));
  const textOf = new Map((evidence.sentences ?? []).map((s) => [s.kind, s.text]));

  console.log('\n  FACT CHECK');
  for (const ev of evidence.selected) {
    if (!displayed.has(ev.kind)) {
      console.log(`    ${ev.kind}  — SELECTED BUT NOT DISPLAYED; nothing claimed.`);
      continue;
    }
    const d = ev.data ?? {};
    console.log(`\n    CLAIM   [${ev.kind}, ${ev.tier}, ${ev.confidence}]`);
    console.log(`      "${textOf.get(ev.kind) ?? '(no sentence)'}"`);
    console.log('    SUPPORT');
    const p = d.provenance;
    if (p) {
      console.log(`      athlete            : ${p.athleteCountry} / ${p.athleteRegion} / ${p.athletePosition}`);
      console.log(`      observation        : count ${d.count}, seasons ${(d.seasons ?? []).join(', ')}`);
      console.log(`      coverage           : ${p.observedTransitions}/${p.possibleTransitions} comparable transitions`
        + `  [${p.coverageStatus}, scope ${p.coverageScope}]`);
      console.log(`      field / sport      : position recorded on ${(100 * (p.fieldCoverage ?? 0)).toFixed(0)}% of arrivals`
        + `, sport data ${p.sportDataStatus}`);
      console.log(`      named in copy      : ${d.name ?? '(not licensed — count used instead)'}`);
      if (d.coach) console.log(`      coach              : ${d.coach}, ${d.attributableTransitions} attributable transitions`);
      if (d.coachOwned !== undefined) console.log(`      arrivals under this coach: ${d.coachOwned ? 'all of them' : 'not all — programme voice used'}`);
      for (const s of p.supporting ?? []) {
        console.log(`      supporting arrival : ${s.playerName}`);
        console.log(`                           country: ${s.country}`);
        console.log(`                           arrival season: ${s.season}   (transition ${s.transition})`);
        console.log(`                           position: ${s.position}`);
        console.log(`                           arrival confidence: DIRECT`);
        console.log(`                           identity: ${s.identityMethod}`);
        console.log(`                           coach attribution: ${s.coachAttribution}`);
        console.log(`                           prior programme: ${s.priorConfidence}`
          + `${s.priorProgramme ? ` (${s.priorProgramme}) — NOT stated in the email` : ''}`);
      }
    } else {
      // The frozen roster-derived kinds, whose data shape predates provenance.
      for (const [k, v] of Object.entries(d)) {
        console.log(`      ${k.padEnd(19)}: ${Array.isArray(v) ? v.join(', ') : v}`);
      }
      console.log(`      season span        : ${ev.season ?? '—'}`);
      console.log(`      source             : ${ev.source}`);
    }
  }
}

/* -------------------------------------------------------------------------- */

function main() {
  const athlete = Player.get(arg('athlete'))
    ?? db.prepare('SELECT * FROM players WHERE lower(full_name) = lower(?)').get(arg('athlete', 'Rhys Davies'));
  if (!athlete) throw new Error('athlete not found');
  const sport = athlete.sport || 'mens-soccer';

  head(`OUTREACH QA — ${athlete.full_name}, ${sport}, ${athlete.position}, class of ${athlete.recruiting_class_year}`);
  console.log(`  saved template : ${athlete.email_template ? `${athlete.email_template.length} chars` : '(none — structured composer)'}`);
  console.log(`  archived       : ${athlete.email_template_archived ? `${athlete.email_template_archived.length} chars, ${athlete.email_template_archived_at}` : '(none)'}`);
  console.log(`  pool           : top ${POOL} by match score, roles ${ROLES.join('/')}`);

  const ranked = poolFor(athlete);
  const quota = new Map(CATEGORIES.map(([name, n]) => [name, n]));
  const picked = [];
  const taken = new Set();

  // One pass down the ranking per category, in category order. Walking the
  // ranking rather than the category list keeps the sample inside the pool the
  // athlete would actually be written to.
  for (const [name, , test] of CATEGORIES) {
    for (const college of ranked) {
      if (quota.get(name) <= 0) break;
      if (taken.has(college.name)) continue;
      const contacts = contactsFor(college, athlete, sport);
      if (!contacts.length) continue;
      const evidence = evidenceFor(athlete, college.name, { sport });
      if (!test(evidence)) continue;
      taken.add(college.name);
      quota.set(name, quota.get(name) - 1);
      picked.push({
        category: name,
        rank: ranked.indexOf(college) + 1,
        college,
        contacts,
        evidence,
      });
    }
  }

  const unfilled = [...quota.entries()].filter(([, n]) => n > 0);
  if (unfilled.length) {
    console.log(`\n  categories not fillable from this pool: `
      + unfilled.map(([k, n]) => `${k} (${n} short)`).join(', '));
  }

  const metrics = [];
  for (const [i, item] of picked.entries()) {
    const { college, contacts, evidence, category, rank } = item;
    const composed = emailBodyFor(athlete, college, contacts[0].name || 'Coach', { evidence });
    const subject = fillTemplate(athlete.email_subject || DEFAULT_EMAIL_SUBJECT, composed.context);

    head(`${i + 1}/15  ${college.name}   [${category}]`);
    console.log(`  PROGRAMME     : ${college.name} · ${college.division} · `
      + `${college.conference ?? '—'} · match ${college.match_score} (rank ${rank} of ${ranked.length})`);
    console.log(`  COACH/CONTACT : ${contacts.map((c) => `${c.name} (${c.role}, ${c.email})`).join('\n                  ')}`);
    console.log(`  SUBJECT       : ${subject}`);
    console.log(`  STRUCTURE     : ${evidence.structure.key} (${evidence.structure.source})`);
    console.log(`  BODY SOURCE   : ${composed.source}`);

    console.log('\n  AVAILABLE EVIDENCE');
    for (const d of evidence.dispositions) {
      console.log(`    ${d.kind.padEnd(32)} ${d.disposition}`);
    }

    console.log('\n  SUPPRESSED EVIDENCE');
    const dropped = [...(evidence.suppressed ?? []), ...(evidence.belowThreshold ?? []),
      ...(evidence.rejected ?? [])];
    if (!dropped.length) console.log('    (none)');
    for (const s of dropped) console.log(`    ${s.kind.padEnd(32)} ${s.reason}`);

    console.log('\n  SELECTED ORDER');
    evidence.selected.forEach((ev, n) => console.log(
      `    ${n + 1}. ${ev.kind.padEnd(32)} ${ev.tier}  ${ev.confidence}  strength ${ev.strength}`,
    ));

    console.log('\n  DISPLAYED ORDER');
    (evidence.composition?.placement ?? []).forEach((s, n) => console.log(
      `    ${n + 1}. ${s.kind.padEnd(32)} ${s.slot}${s.displayed === false ? '   HELD BACK' : ''}`,
    ));

    console.log('\n  FINAL EMAIL');
    console.log('  ' + '-'.repeat(74));
    for (const line of composed.body.split('\n')) console.log(`  | ${line}`);
    console.log('  ' + '-'.repeat(74));

    factCheck(evidence);

    const m = measure(composed.body, evidence);
    metrics.push({ programme: college.name, subject, ...m });
    console.log(`\n  LENGTH: ${m.words} words · ${m.paragraphs} paragraphs · `
      + `${m.evidenceSentences} evidence sentence(s) · ${m.claims} personalisation claim(s)`
      + ` (${m.factClaims} FACT)`);
  }

  /* ---- safety ---- */
  head('SAFETY CHECK');
  const bodies = picked.map((it, i) => ({
    programme: it.college.name,
    evidence: it.evidence,
    body: emailBodyFor(athlete, it.college, it.contacts[0].name || 'Coach', { evidence: it.evidence }).body,
    n: i + 1,
  }));

  /**
   * Each check names what it would catch, and fails loudly rather than
   * printing a tick it did not earn. A green line here means the assertion ran
   * over all fifteen bodies, not that nobody looked.
   */
  const CHECKS = [
    ['no sub-positions inferred',
      () => bodies.filter((b) => /\b(centre[- ]?back|center[- ]?back|full[- ]?back|wing[- ]?back|sweeper|holding mid|number (six|eight|ten)|winger|striker|target man)\b/i.test(b.body))],
    ['no unsupported recruiting need',
      () => bodies.filter((b) => /\b(you'?ll need|you need|looking for|in the market|gap|hole|replacement|fill)\b/i.test(b.body))],
    ['no scholarship or money claim',
      () => bodies.filter((b) => /\b(scholarship|funding|financial aid|walk[- ]?on|money|tuition)\b/i.test(b.body))],
    ['no transfer-origin claim',
      () => bodies.filter((b) => {
        const priors = b.evidence.selected.flatMap((e) => e.data?.provenance?.supporting ?? [])
          .map((s) => s.priorProgramme).filter(Boolean);
        return priors.some((name) => b.body.includes(name))
          || /\b(transferred|came from|out of|via)\b/i.test(b.body);
      })],
    ["no women's country evidence",
      () => bodies.filter((b) => b.evidence.programme.sport !== 'mens-soccer'
        && b.evidence.selected.some((e) => e.source === 'recruiting_arrivals'))],
    ['no POSITION_INTAKE_HISTORY rendered',
      () => bodies.filter((b) => (b.evidence.composition?.placement ?? [])
        .some((p) => p.kind === 'POSITION_INTAKE_HISTORY') || /\bintakes\b/i.test(b.body))],
    ['no absence evidence rendered',
      () => bodies.filter((b) => /\b(no |never |haven'?t|hasn'?t|none of)\b.*\b(from New Zealand|internationals?|defenders?)\b/i.test(b.body))],
    ['at most one international-connection claim',
      () => bodies.filter((b) => (b.evidence.composition?.placement ?? [])
        .filter((p) => p.displayed !== false)
        .filter((p) => b.evidence.selected.find((e) => e.kind === p.kind)?.category === 'international')
        .length > 1)],
    ['all evidence appears before the profile link',
      () => bodies.filter((b) => {
        const link = b.body.indexOf('Profile and highlight film');
        if (link < 0) return true;
        const displayed = (b.evidence.composition?.placement ?? []).filter((p) => p.displayed !== false);
        const texts = (b.evidence.sentences ?? []).filter((s) => displayed.some((d) => d.kind === s.kind));
        return texts.some((t) => {
          const frag = t.text.replace(/^I (saw|noticed)\s+/i, '').split(',')[0].trim();
          const at = frag ? b.body.indexOf(frag) : -1;
          return at >= 0 && at > link;
        });
      })],
    ['CTA unchanged from the frozen wording',
      () => bodies.filter((b) => !b.body.includes(`Would be great to hear your thoughts on Rhys for your ${athlete.recruiting_class_year} group.`))],
    ['no athlete named as their own supporting arrival',
      () => bodies.filter((b) => b.evidence.selected.flatMap((e) => e.data?.provenance?.supporting ?? [])
        .some((s) => s.playerName.toLowerCase() === String(athlete.full_name).toLowerCase()))],
  ];

  console.log();
  for (const [label, run] of CHECKS) {
    const hits = run();
    console.log(`  ${hits.length ? 'FAIL' : 'PASS'}  ${label}`
      + (hits.length ? `  — ${hits.map((h) => `#${h.n} ${h.programme}`).join(', ')}` : ''));
  }
  console.log(`  PASS  nothing sent — this script never calls sendOutreach`);

  /* ---- distribution ---- */
  head('LENGTH DISTRIBUTION');
  const stat = (key) => {
    const v = metrics.map((m) => m[key]).sort((a, b) => a - b);
    const mid = Math.floor(v.length / 2);
    const median = v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
    return { min: v[0], median, max: v[v.length - 1] };
  };
  console.log('\n  metric                     min   median   max');
  for (const [label, key] of [
    ['words', 'words'], ['paragraphs', 'paragraphs'],
    ['evidence sentences', 'evidenceSentences'], ['personalisation claims', 'claims'],
  ]) {
    const s = stat(key);
    console.log(`  ${label.padEnd(24)} ${String(s.min).padStart(4)}  ${String(s.median).padStart(6)}  ${String(s.max).padStart(5)}`);
  }
  console.log('\n  per email');
  for (const m of metrics) {
    console.log(`    ${m.programme.padEnd(28)} ${String(m.words).padStart(4)}w  ${m.paragraphs}p  `
      + `${m.evidenceSentences} ev-sent  ${m.claims} claims`);
  }

  head('SUBJECT LINES');
  for (const m of metrics) console.log(`  ${m.programme.padEnd(28)} ${m.subject}`);

  console.log('\nRead-only. No drafts created, nothing logged, nothing sent.\n');
}

main();
