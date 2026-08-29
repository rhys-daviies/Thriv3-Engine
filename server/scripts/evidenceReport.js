#!/usr/bin/env node
/**
 * What Thriv3 knows about one athlete at one programme, and what it would say.
 *
 * The evidence engine decides things an operator has to be able to disagree
 * with before a send: which angle leads, what was considered and dropped, and
 * what shape the email takes. Reading that out of a drafted message means
 * inferring it from prose; this prints it directly.
 *
 * Also the honest way to see the gaps. A programme reporting no evidence and
 * no roster is not a failure of the engine, it is 325 men's programmes whose
 * 2026 roster we do not have, and the report says which of the two it is.
 *
 *   npm run evidence -- --athlete "Rhys Davies" --college "UNC Asheville"
 *   npm run evidence -- --athlete "Rhys Davies" --top 10
 *   npm run evidence -- --performance
 */
import 'dotenv/config';
import db from '../db/client.js';
import { Player } from '../db/entities/player.js';
import { buildRosterIndex, rankMatches, normaliseAthlete } from '../../shared/matching/pool.js';
import { evidenceFor } from '../lib/evidenceQueries.js';
import { evidenceParagraph } from '../../shared/evidence/index.js';
import { evidenceReport } from '../lib/evidencePerformance.js';
import { positionLabel } from '../../shared/positions.js';
import { SQUAD_SEASON } from '../../shared/philosophy.js';

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

function findAthlete(needle) {
  if (!needle) return null;
  return Player.get(needle)
    || db.prepare('SELECT * FROM players WHERE lower(full_name) = lower(?)').get(needle)
    || db.prepare('SELECT * FROM players WHERE lower(full_name) LIKE lower(?)').get(`%${needle}%`);
}

/** The evidence picture for one pairing, in the shape the brief asked for. */
function report(athlete, match, evidence) {
  const { all, selected, structure, programme, suppressed, rejected } = evidence;

  console.log(`\nPROGRAM:  ${programme.name}`);
  console.log(`ATHLETE:  ${athlete.full_name}`);
  // The person-noun, upper-cased. Still one of the four canonical groups —
  // DEFENSE is the stored key and "Defender" is what a person reads.
  console.log(`POSITION: ${(positionLabel(athlete.position) || 'UNKNOWN').toUpperCase()}`);
  console.log(`CLASS:    ${athlete.recruiting_class_year ?? '—'}`);
  console.log(`ROSTER:   ${programme.hasSquad ? `${programme.squadSize} players on the ${SQUAD_SEASON} roster` : `no ${SQUAD_SEASON} roster on file`}`
    + `${programme.hasHistory ? ', earlier seasons on file' : ', no earlier seasons on file'}`);

  console.log('\nAVAILABLE EVIDENCE');
  if (!all.length) {
    console.log('  none');
  } else {
    const selectedKinds = new Set(selected.map((e) => e.kind));
    const usable = new Set(evidence.usable.map((e) => e.kind));
    all.forEach((ev, i) => {
      const flag = ev.emailEligible ? '' : '   [internal only]';
      console.log(`\n  ${i + 1}. ${ev.kind}${flag}`);
      console.log(`     ${ev.tier}   ${ev.confidence} CONFIDENCE   strength ${ev.strength}`);
      console.log(`     selected: ${selectedKinds.has(ev.kind)}`);
      // "rendered" is the honest question: selected evidence reaches the email
      // only if the athlete's template carries {{evidence_paragraph}}, which is
      // checked at send time. Here it mirrors selection among email-eligible
      // kinds and is false for anything the registry forbids in email.
      console.log(`     rendered: ${selectedKinds.has(ev.kind) && ev.emailEligible}`);
      if (!usable.has(ev.kind)) console.log('     REJECTED: below its confidence floor');
      console.log(`     ${describe(ev)}`);
      console.log(`     source: ${ev.source}${ev.season ? `, ${ev.season}` : ''}`);
    });
  }

  console.log('\nSELECTED');
  console.log(`  Primary:   ${selected[0]?.kind ?? '—'}`);
  console.log(`  Secondary: ${selected[1]?.kind ?? '—'}`);

  if (suppressed.length) {
    console.log('\n  SUPPRESSED AS REDUNDANT');
    for (const s of suppressed) console.log(`    ${s.kind} — says the same as ${s.suppressedBy}`);
  }
  if (rejected.length) {
    console.log('\n  REJECTED');
    for (const r of rejected) console.log(`    ${r.kind} — ${r.reason}`);
  }

  console.log('\nEMAIL STRUCTURE');
  console.log(`  ${structure.key}${structure.eligible.length > 1 ? `   (also eligible: ${structure.eligible.slice(1).join(', ')})` : ''}`);

  const paragraph = evidenceParagraph(selected);
  console.log('\nEMAIL WOULD SAY');
  console.log(paragraph ? `  ${paragraph}` : '  (nothing about the programme — the athlete carries the email)');

  if (match) console.log(`\n  match score ${match.match_score}`);
}

/** A one-line summary of what a piece of evidence actually found. */
function describe(ev) {
  const d = ev.data;
  switch (ev.kind) {
    case 'HISTORICAL_SAME_COUNTRY':
    case 'CURRENT_SAME_COUNTRY':
      return `${d.count} from ${d.country}${d.names?.length ? `: ${d.names.join(', ')}` : ''}`;
    case 'HISTORICAL_SAME_REGION':
      return `${d.count} from ${d.countries.join(', ')} (region ${d.region})`;
    case 'INTERNATIONAL_ROSTER':
      return `${d.count} international players, ${d.uniqueCountries} countries`;
    case 'INTERNATIONAL_SHARE':
      return `${Math.round(d.share * 100)}% of a ${d.squadSize}-player squad`;
    case 'POSITION_GRADUATION':
      return `${d.count} in the ${d.classYear} graduating group${d.names?.length ? `: ${d.names.join(', ')}` : ''}`;
    case 'POSITION_GRADUATION_STARTERS':
      return `${d.count} of them projected starters (from carried-forward minutes)`;
    case 'SQUAD_GRADUATION':
      return `${d.total} across the squad, ${d.starters ?? '?'} projected starters`;
    case 'POSITION_GROUP_SIZE':
      return `${d.count} of ${d.squadSize} on the roster`;
    case 'POSITION_GROUP_SCARCITY':
      return `${d.count} of ${d.classifiedSquad} classified players (${Math.round(d.share * 100)}%)`;
    case 'RETURNING_POSITION_DEPTH':
      return `${d.returning} of ${d.groupSize} still eligible in ${d.classYear}`;
    case 'ELIGIBILITY_CLIFF':
      return `${d.players} players, ${d.projectedMinutes} projected minutes, by ${d.classYear}`;
    case 'CONFERENCE_TITLE':
      return `2025 ${d.conference ?? 'conference'} champions`;
    case 'POSTSEASON_RESULT':
      return `2025 postseason: ${d.round}`;
    case 'PROGRAM_MOMENTUM':
      return `${d.classification} — ${pct(d.recentWinPct)} recent vs ${pct(d.priorWinPct)} prior`;
    case 'COACH_CONTEXT':
      return `${d.name}, ${d.seasonsObserved} observed season(s)${d.windowBounded ? ', predates our window' : ''}`;
    case 'ACADEMIC_FIT':
      return `offers ${d.major}`;
    case 'TRANSFER_BEHAVIOUR':
      return `${d.arrivals} arrivals from other programmes${d.atPosition != null ? `, ${d.atPosition} at this position` : ''}`;
    default:
      return JSON.stringify(d);
  }
}

const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);

/**
 * What the outreach achieved, grouped by what it said.
 *
 * Every table prints its own sample size and a verdict, because the failure
 * mode here is not a wrong number — it is a right number read as a finding.
 * Below MIN_SAMPLE a row is marked INSUFFICIENT and its rate is shown in
 * brackets, so it can be read as an observation and not as evidence.
 */
function performance() {
  const opts = { sport: arg('sport'), athleteId: arg('athlete-id') };
  const rep = evidenceReport(opts);
  const t = rep.totals;

  console.log('\nEVIDENCE PERFORMANCE');
  console.log(`  ${t.sends} sent · ${t.rendered_sends} carried the evidence sentence · `
    + `${t.operator_selected_sends} operator-chosen`);
  console.log(`  ${t.opened} opened · ${t.clicked} watched · ${t.replies} replied`);
  console.log(`  minimum sample for a readable rate: ${rep.minSample} rendered sends per group`);

  if (rep.unattributedSends) {
    console.log(`\n  ${rep.unattributedSends} earlier send(s) carry no evidence row — they went out `
      + 'before the log existed.');
    console.log('  Deliberately NOT backfilled: writing evidence for them now would attribute');
    console.log('  angles to emails that never contained them.');
  }

  if (t.verdict !== 'READABLE') {
    console.log(`\n  !! INSUFFICIENT_SAMPLE overall (${t.rendered_sends} of ${rep.minSample}).`);
    console.log('     Every rate below is an observation, not a result. Do not compare angles yet.');
  }

  table('BY PRIMARY EVIDENCE', 'kind', rep.byPrimaryKind);
  table('BY SECONDARY EVIDENCE', 'kind', rep.bySecondaryKind);
  table('BY TIER', 'tier', rep.byTier);
  table('BY TEMPLATE VARIANT', 'template_variant', rep.byTemplateVariant);
  table('BY BODY SOURCE', 'body_source', rep.byBodySource);
  table('BY ROSTER FRESHNESS AT SEND', 'roster_freshness', rep.byRosterFreshness);
  table('BY EVIDENCE COUNT', 'evidence_count', rep.byEvidenceCount);
  table('BY SELECTED EVIDENCE SET', 'selected_kinds', rep.bySelectedSet);

  console.log('\n  BY STRUCTURE   [NOT COMPARABLE]');
  console.log(`  ${rep.byStructure.note.replace(/\s+/g, ' ')}`);
  table(null, 'structure', rep.byStructure.rows);

  /**
   * How much of what we selected actually reached a coach.
   *
   * Printed last and on its own because it qualifies every table above it: if
   * operators routinely cut the third and fourth sentence, the evidence-count
   * rows are measuring what was drafted rather than what was read.
   */
  const rc = rep.renderCompleteness;
  console.log('\n  CLAIM DELIVERY');
  console.log(rc.claims_checked
    ? `    ${rc.claims_delivered} of ${rc.claims_checked} checked claims survived into the sent `
      + `body (${pct(rc.delivery_rate).trim()})`
    : '    No send has had its claims checked item by item yet.');
  if (rc.unchecked) {
    console.log(`    ${rc.unchecked} send(s) carrying ${rc.claims_selected - rc.claims_checked} `
      + 'claim(s) predate per-item checking and are excluded above — unknown, not zero.');
  }
  console.log('    A gap is not a fault — cutting a weak third sentence is the system working —');
  console.log('    but it is what decides whether the rates above measure what they claim to.');

  console.log('\n  Structure and evidence both vary now, and structure is CHOSEN BY the evidence.');
  console.log('  Nothing here separates the two. Do not retune evidence priorities from a');
  console.log('  structure result, or the reverse; that needs randomised assignment within an');
  console.log('  eligible set, which is deliberately not built.');
  console.log();
}

function table(title, keyField, rows) {
  if (title) console.log(`\n  ${title}`);
  if (!rows.length) { console.log('    (nothing yet)'); return; }
  console.log('    group                          sends  rend  op  open  reply  rate     verdict');
  console.log('    ------------------------------ ----- ----- --- ----- ------ -------- --------------------');
  for (const r of rows) {
    const rate = r.reply_rate == null ? '   —' : pct(r.reply_rate);
    // Bracketed below the threshold so a number nobody should act on does not
    // look like one that can be.
    const shown = r.verdict === 'READABLE' ? rate.padStart(8) : `[${rate.trim()}]`.padStart(8);
    console.log(`    ${String(r[keyField] ?? 'none').padEnd(30)} `
      + `${String(r.sends).padStart(5)} ${String(r.rendered_sends).padStart(5)} `
      + `${String(r.operator_selected_sends).padStart(3)} ${String(r.opened).padStart(5)} `
      + `${String(r.replies).padStart(6)} ${shown} ${r.verdict}`);
  }
}

function main() {
  if (argv.includes('--performance')) return performance();

  const athlete = findAthlete(arg('athlete'));
  if (!athlete) {
    console.error('\nUsage: npm run evidence -- --athlete "<name or id>" [--college "<name>"] [--top 10]');
    console.error('       npm run evidence -- --performance\n');
    console.error('Known athletes: ' + db.prepare('SELECT full_name FROM players').all().map((p) => p.full_name).join(', ') + '\n');
    process.exit(1);
  }

  const sport = athlete.sport || 'mens-soccer';
  const collegeName = arg('college');

  if (collegeName) {
    // Ranked anyway, so the departure evidence — which comes from the matching
    // engine's own cohort walk rather than being recomputed — is available for
    // a single named programme too.
    const match = rankedMatch(athlete, sport, collegeName);
    return report(athlete, match, evidenceFor(athlete, match?.name ?? collegeName, { sport, match }));
  }

  const top = Number(arg('top', 5));
  for (const match of rankedList(athlete, sport).slice(0, top)) {
    report(athlete, match, evidenceFor(athlete, match.name, { sport, match }));
  }
  console.log();
}

function rankedList(athlete, sport) {
  const colleges = db.prepare('SELECT * FROM colleges WHERE sport = ? AND active = 1').all(sport);
  const roster = db.prepare(
    `SELECT college_name, player_name, position, minutes_played, projected_minutes,
            estimated_graduation_year, country
     FROM roster_players WHERE sport = ? AND season = ?`,
  ).all(sport, SQUAD_SEASON);
  return rankMatches({
    athlete: normaliseAthlete(athlete), colleges, rosterIndex: buildRosterIndex(roster),
  }).results;
}

function rankedMatch(athlete, sport, name) {
  const lower = name.toLowerCase();
  return rankedList(athlete, sport).find((r) => r.name.toLowerCase() === lower)
    ?? rankedList(athlete, sport).find((r) => r.name.toLowerCase().includes(lower))
    ?? null;
}

main();
