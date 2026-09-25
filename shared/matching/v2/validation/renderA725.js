/**
 * A7.25: render the blind THREE-LIST comparison sheet.
 *
 * -- WHY THIS IS NOT renderOutreachViewA ----------------------------------
 *
 * A7.13's sheet asks about a SAMPLE of programmes in a deliberately arbitrary
 * order, because the question there is "does this school belong in the first
 * hundred". A7.25 asks a different question - whether an ORDERED list reflects
 * the athlete's recruitment priorities - and an ordered list cannot be shown in
 * an arbitrary order without destroying the thing being judged.
 *
 * So the ordering IS the content here, and the blindness has to come from
 * somewhere else: the programme facts are printed once in a hash-ordered
 * appendix under codes that track no ranking, the three lists reference those
 * codes, and nothing on the page says which list came from which architecture
 * or which one is production.
 *
 * -- WHAT THIS FILE CANNOT PRINT -----------------------------------------
 *
 * It is given a pack that holds no score, no layer value, no Pursuit priority
 * and no variant id. As with View A, that is a stronger guarantee than
 * choosing not to print them: there is nothing here to leak.
 */
import { factBlock, athleteBlock } from './renderPack.js';

const QUESTIONS = [
  ['firstWave', 'Which of these belong in the FIRST WAVE of outreach?', 'codes'],
  ['lowerPriority', 'Which are reasonable but LOWER PRIORITY?', 'codes'],
  ['questionable', 'Which are QUESTIONABLE for this athlete?', 'codes'],
  ['substantiallyLower', 'Which should probably be SUBSTANTIALLY LOWER than where they sit?', 'codes'],
  ['missing', 'What important PROGRAMME TYPES are missing from the first wave?', 'text'],
  ['calibration', 'Is this list TOO CONSERVATIVE or TOO AGGRESSIVE on what the athlete asked for, or about right?', 'choice'],
  ['wrongTradeOffs', 'Which specific TRADE-OFFS in this list do you believe are wrong?', 'text'],
];

const CALIBRATION = ['TOO CONSERVATIVE', 'ABOUT RIGHT', 'TOO AGGRESSIVE'];

function listBlock(list, programmes) {
  const byCode = new Map(programmes.map((p) => [p.code, p]));
  const rows = list.programmes.map((r) => {
    const f = byCode.get(r.code)?.facts;
    const where = [f?.city, f?.state].filter(Boolean).join(', ');
    return `| ${r.position} | \`${r.code}\` | ${f?.name ?? '—'} | ${f?.division ?? '—'}${where ? ` · ${where}` : ''} |`;
  });
  return [
    `## LIST ${list.letter}`, '',
    '| # | code | programme | division |', '|---:|---|---|---|',
    ...rows, '',
    ...QUESTIONS.flatMap(([id, q, kind]) => [
      `**${list.letter}${QUESTIONS.findIndex((x) => x[0] === id) + 1}. ${q}**`, '',
      kind === 'choice' ? CALIBRATION.map((c) => `\`[ ]\` ${c}`).join('  ') : '```\n\n```',
      '',
    ]),
    '---', '',
  ].join('\n');
}

/** @param {object} pack a pack from a725Variants.build */
export function renderA725ViewA(pack) {
  const out = [];
  const w = (...lines) => out.push(...lines);
  const a = pack.athlete;

  w(`# A7.25 BLIND LIST REVIEW — ${pack.packId}`, '');
  w('**This is a blind review.** Below are THREE ordered outreach lists for the same athlete,',
    'drawn from the same universe of programmes on the same day. Nothing on this page tells you',
    'where any list came from, which one anybody currently uses, or what distinguishes them.',
    'The letters A, B and C carry no meaning and are not in any order.', '');
  w('You are judging **the programme recommendations**, not a method. For each list, say which',
    'schools belong in the first wave of outreach for this athlete, which do not, and which',
    'trade-offs the list gets wrong. There is no score to give and no ranking of the lists to',
    'produce — if two lists are equally good, or equally bad, say so.', '');
  w('The programmes are described once, in the appendix at the end, under a fixed code. The codes',
    'are in an arbitrary order and mean nothing.', '');

  w('## The athlete', '');
  w(athleteBlock(a), '');
  w('### What this athlete asked for', '');
  w(`- Competing at the highest realistic college level: **${a.competitiveLevelPriority} of 5**`);
  w(`- A clearer path to playing time: **${a.playingOpportunityPriority} of 5**`);
  w(`- A college with a strong academic profile: **${a.academicStrengthPriority} of 5**`);
  w(`- Intended major: **${a.intendedMajor ?? 'not stated'}**`, '');
  w(`Scale: **1** = matters materially less to this athlete than it would by default · **3** =`,
    '**neutral / default importance** · **5** = matters substantially more than default. A low',
    'number is NOT a request for the opposite: an athlete who rates academic strength 1 has not',
    'asked for a weak university.', '');

  w('## What to weigh', '');
  w('Judge each list the way a recruitment adviser would, on all of:', '');
  w('- the standard of football the athlete can realistically play at;');
  w('- whether a coach at that programme would plausibly recruit them;');
  w('- whether there is a genuine pathway to playing;');
  w('- whether the family can afford it;');
  w('- academic strength and, where the athlete has declared one, the intended major;');
  w('- anything else in the facts that bears on fit.', '');
  w('A list can be wrong by being too timid about what the athlete asked for, and it can be wrong',
    'by chasing it past the point of good advice. Both are real answers.', '');

  w('---', '');
  w(`# The three lists (${pack.listLength} programmes each)`, '');
  for (const list of pack.lists) w(listBlock(list, pack.programmes));

  w('# Across the three lists', '');
  w('**X1. Where the lists disagree about a programme, which placement is better for this athlete, and why?**', '');
  w('```', '', '```', '');
  w('**X2. Is there a trade-off all three lists get wrong in the same way?**', '');
  w('```', '', '```', '');

  w('---', '');
  w(`# Appendix — the programmes (${pack.programmes.length})`, '');
  w('Facts only. No list membership, no ordering, no model output.', '');
  for (const p of pack.programmes) {
    w(`### \`${p.code}\``, '');
    w(factBlock(p.facts), '');
  }

  w('---', '');
  w('# STOP', '');
  w('There is no information in this document about where any list came from. The mapping exists',
    'in a sealed file that is not opened until these answers are committed.', '');
  w(`Pack \`${pack.packId}\` · athlete \`${pack.digests.athlete}\``
    + ` · programmes \`${pack.digests.programmes}\` · lists \`${pack.digests.lists}\``, '');

  return out.join('\n');
}
