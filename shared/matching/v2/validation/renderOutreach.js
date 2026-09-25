/**
 * A7.13: render an outreach pack's BLIND VIEW A as something Rhys can sit
 * down with and fill in.
 *
 * -- THIS FILE CAN ONLY RENDER VIEW A -------------------------------------
 *
 * It takes a pack whose `viewB` is null and never reads a rank, a layer value
 * or an explanation, because the pack does not contain one. That is a
 * stronger guarantee than a renderer that could show the model and chooses
 * not to: there is nothing here to accidentally print.
 *
 * -- WHY MARKDOWN WITH INLINE CHECKBOXES ----------------------------------
 *
 * A7.13 §17 asks for a format the answers can be pasted back from without
 * retyping programme names. So every programme carries its own answer block,
 * keyed by the same blind number the pack stores - a filled sheet is
 * attributable line by line, and a reviewer who skips one leaves a visible
 * hole rather than a silent off-by-one.
 */
import { factBlock, athleteBlock } from './renderPack.js';
import { OUTREACH_CLASSIFICATION, FIRST_100, ATHLETE_QUESTIONS } from './outreachRubric.js';

const CLASS_LABEL = {
  PURSUE_STRONGLY: 'PURSUE STRONGLY',
  PURSUE: 'PURSUE',
  BORDERLINE: 'BORDERLINE',
  LOW_PRIORITY: 'LOW PRIORITY',
  WOULD_NOT_PURSUE: 'WOULD NOT PURSUE',
  INSUFFICIENT_INFORMATION: 'INSUFFICIENT INFORMATION',
};

const CLASS_KEYS = Object.keys(OUTREACH_CLASSIFICATION);

function answerBlock() {
  return [
    'Decision:',
    ...CLASS_KEYS.map((k) => `\`[ ]\` ${CLASS_LABEL[k] ?? k.replace(/_/g, ' ')}`),
    '',
    'First-100 outreach?',
    FIRST_100.answers.map((a) => `\`[ ]\` ${a}`).join('  '),
    '',
    'Notes: ______________________________________________________________',
  ].join('  \n');
}

function programmeBlock(p) {
  return [
    `### ${p.reviewNo}. ${p.facts?.name ?? p.id}`,
    '',
    factBlock(p.facts),
    '',
    answerBlock(),
    '',
    '---',
    '',
  ].join('\n');
}

/**
 * @param {object} pack  a pack from buildOutreachPack, with viewB null
 */
export function renderOutreachViewA(pack) {
  if (pack.viewB !== null) {
    // Refuses rather than filtering. A pack carrying a reveal is not a blind
    // pack, and rendering "just the blind part" of one is how a reveal ships.
    throw new Error('renderOutreachViewA: this pack carries a viewB and is no longer blind');
  }
  const out = [];
  const w = (...lines) => out.push(...lines);
  const a = pack.athlete;

  w(`# V3 OUTREACH REVIEW — ${pack.packId}`, '');
  w('**This is a blind review.** Nothing below tells you what Thriv3 did with any of these',
    'programmes: no rank, no score, no ordering, no grouping. The programmes are in a fixed',
    'but arbitrary order. Some are ones Thriv3 rates highly and some are not, and the sheet',
    'is deliberately built so you cannot tell which from the page.', '');
  w('You are being asked two different questions about each school, and they are not the same',
    'question. The first is what you think of the **school for this athlete**. The second is',
    'whether it belongs in the **first hundred programmes you would contact** — you can quite',
    'reasonably say a school is worth pursuing and still say it does not make the first hundred.', '');

  w('## The athlete', '');
  w(athleteBlock(a), '');
  w('### What this athlete asked for', '');
  w(`- Competing at the highest realistic college level: **${a.competitiveLevelPriority} of 5**`);
  w(`- A clearer path to playing time: **${a.playingOpportunityPriority} of 5**`);
  w(`- A college with a strong academic profile: **${a.academicStrengthPriority} of 5**`);
  w(`- Intended major: **${a.intendedMajor ?? 'not stated'}**`, '');

  w('## How to answer', '');
  w('For each programme, tick one decision and one first-100 answer.', '');
  w('- **PURSUE STRONGLY** — on the first outreach list, this week.');
  w('- **PURSUE** — worth contacting.');
  w('- **BORDERLINE** — depends on something you would need to check or ask.');
  w('- **LOW PRIORITY** — would contact only after the others.');
  w('- **WOULD NOT PURSUE** — would not email this school for this athlete.');
  w('- **INSUFFICIENT INFORMATION** — you cannot say. **This is not a mild answer and it is not a',
    '  criticism of the school.** It means the facts printed here do not support a decision either',
    '  way. Some of these programmes genuinely have very little on file, and saying so is the',
    '  correct answer for them.', '');
  w(`Then: _${FIRST_100.question}_ — **${FIRST_100.answers.join(' / ')}**.`, '');
  w('Do not try to guess a rank. UNSURE is a real answer.', '');

  w('---', '');
  w(`## Programmes (${pack.viewA.programmes.length})`, '');
  for (const p of pack.viewA.programmes) w(programmeBlock(p));

  w('# After the programmes', '');
  w('Three questions about the sample as a whole.', '');
  for (const [i, q] of ATHLETE_QUESTIONS.entries()) {
    w(`**${i + 1}. ${q.question}**`, '');
    if (q.answers) w(q.answers.map((x) => `\`[ ]\` ${x}`).join('  '), '');
    else w('```', '', '', '```', '');
  }

  w('---', '');
  w('# STOP', '');
  w('There is no model information in this document. When these answers are back, the reveal is',
    'generated as a separate artifact — it does not exist yet, on purpose.', '');
  w(`Pack \`${pack.packId}\` · athlete digest \`${pack.digests.athlete}\``
    + ` · pool \`${pack.digests.pool}\` · sample \`${pack.digests.sample}\``
    + ` · view A \`${pack.digests.viewA}\``, '');

  return out.join('\n');
}
