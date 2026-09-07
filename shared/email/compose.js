/**
 * Assembling a flow into a template, and the evidence into its paragraphs.
 *
 * This is the join between the four things that must stay apart:
 *
 *   what is true          shared/evidence/generate.js
 *   how firmly to say it  shared/evidence/render.js  (clause + reason)
 *   where it goes         shared/evidence/structures.js (flow + placement)
 *   the words around it   shared/email/blocks.js
 *
 * Nothing here writes a factual claim. It supplies conversational FRAMING —
 * "I saw …", "I was having a look through your program and noticed …" — and
 * joins parts somebody else wrote, then hands the result to `fillTemplate`,
 * the same function the saved templates go through. A flow cannot add a word
 * to a claim, which is what makes FACT/SIGNAL survive composition.
 */

import { BLOCKS, EVIDENCE_BLOCKS, planFromRoles } from '../evidence/structures.js';
import { DEFAULT_HOOK_FRAMING, RELEVANCE_FRAMING } from '../evidence/render.js';
import { outreachCopyFor } from '../evidence/outreachCopy.js';
import { fragmentFor, slotToken } from './blocks.js';

const cap = (s) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : s);

/**
 * The outbound paragraphs, built from ROLES and the safe outreach copy.
 *
 * ---------------------------------------------------------------------------
 * NO "SO I THOUGHT". THE OBSERVATION IS THE SENTENCE.
 *
 * The composer this replaced wrote "I saw X, so I thought Y" — an observation
 * followed by an inference about what the coach might want. That shape is what
 * `outreachCopyFor` refuses to produce, so this function has no place to put a
 * reason: a hook renders as "I saw you brought Hayden Aish in from New Zealand
 * in 2025." and stops.
 *
 * The thought that follows belongs to the ATHLETE_INTRO block, in our own
 * voice — "I'm reaching out about ..." — which is a statement about us rather
 * than a guess about them.
 *
 * @param {object} flow    a resolved flow
 * @param {object} roles   an `outreachEvidenceFor` result
 * @param {Map}    byKind  evidence objects by kind
 * @param {object} ctx     { firstName }
 */
export function outreachSlots(flow, roles, byKind, ctx = {}) {
  const plan = planFromRoles(roles, byKind, flow.key);
  const tokens = {};
  const placement = [];
  const sentences = [];
  let order = 0;

  const record = (ev, block, text) => {
    placement.push({ kind: ev.kind, tier: ev.tier, slot: block, order, displayed: true });
    sentences.push({ kind: ev.kind, tier: ev.tier, slot: block, order, text });
    order += 1;
  };
  const copyOf = (ev, extra = {}) => outreachCopyFor(plan.itemOf.get(ev.kind), { ...ctx, ...extra });

  if (plan.hook) {
    const copy = copyOf(plan.hook);
    if (copy?.clause) {
      tokens[slotToken(BLOCKS.HOOK)] = `${DEFAULT_HOOK_FRAMING} ${copy.clause}.`;
      record(plan.hook, BLOCKS.HOOK, copy.clause);
    }
  }

  for (const ev of plan.relevance) {
    const copy = copyOf(ev);
    if (!copy?.clause) continue;
    // Framed as looking through the programme, which is what happened. With a
    // hook already spent, the shorter "I also noticed" carries it.
    const framing = plan.hook ? 'I also noticed' : RELEVANCE_FRAMING;
    tokens[slotToken(BLOCKS.RELEVANCE)] = `${framing} ${copy.clause}.`;
    record(ev, BLOCKS.RELEVANCE, copy.clause);
  }

  for (const ev of plan.recognition) {
    /**
     * "as well" needs something to be as well AS.
     *
     * The congratulation is written as a whole sentence, and it ended "last
     * season as well" whatever came before it. In 429 emails nothing did: the
     * only other paragraph was the introduction, so a coach read a connective
     * pointing back at an observation about their programme that the email
     * never made.
     *
     * The COMPOSER answers this, not the copy. Whether a claim precedes is a
     * property of the email's shape, which is this function's business; how
     * the sentence is worded stays in `outreachCopy.js`. Neither has to know
     * the other's job.
     */
    const copy = copyOf(ev, { afterClaim: sentences.length > 0 });
    if (!copy?.recognition) continue;
    tokens[slotToken(BLOCKS.RECOGNITION)] = copy.recognition;
    record(ev, BLOCKS.RECOGNITION, copy.recognition);
  }

  // Licensed, qualified, and deliberately not in this email. Recorded so the
  // log and the operator panel can say so rather than implying it was sent.
  for (const ev of plan.held) {
    placement.push({ kind: ev.kind, tier: ev.tier, slot: null, order, displayed: false });
    order += 1;
  }

  return { tokens, placement, sentences };
}

/**
 * The composed outbound email.
 *
 * @returns {{template, tokens, placement, sentences}}
 */
export function composeOutreach(flow, roles, byKind, ctx = {}) {
  const { tokens, placement, sentences } = outreachSlots(flow, roles, byKind, ctx);
  // The introduction names the athlete's subject only when the academic claim
  // is actually in the email.
  const academic = sentences.some((x) => x.kind === 'ACADEMIC_FIT');
  const variants = academic ? { [BLOCKS.ATHLETE_INTRO]: 'academic' } : {};
  return {
    template: structuredTemplate(flow, tokens, variants),
    tokens,
    placement,
    sentences,
  };
}

/**
 * The template for one flow, with empty blocks removed.
 *
 * An evidence block with nothing in it is dropped here rather than left to
 * render as an empty string, because `fillTemplate` collapses runs of blank
 * lines but cannot know that a paragraph was meant to be there. A flow given
 * one piece of evidence produces a shorter email, never a gap.
 */
export function structuredTemplate(flow, tokens = {}, variants = {}) {
  return flow.blocks
    .filter((block) => !EVIDENCE_BLOCKS.includes(block) || tokens[slotToken(block)])
    .map((block) => fragmentFor(block, variants[block]))
    .join('\n\n');
}

export { cap };
