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

import {
  BLOCKS, EVIDENCE_BLOCKS, planPlacement, MAX_GATHERED,
} from '../evidence/structures.js';
import { evidenceParts, DEFAULT_HOOK_FRAMING, RELEVANCE_FRAMING } from '../evidence/render.js';
import { fragmentFor, slotToken } from './blocks.js';

const cap = (s) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : s);

/**
 * "I saw you've had X come through, so I thought you might be open to another."
 *
 * A clause that opens with its own adverbial — "going off last season's
 * minutes, …" — is stated directly, because a framing in front of it reads
 * "I saw going off last season's minutes".
 */
function reasoningSentence(parts, framing) {
  if (parts.selfFramed) return `${cap(parts.clause)}, so ${parts.reason}.`;
  return `${framing} ${parts.clause}, so ${parts.reason}.`;
}

/**
 * "I also noticed A." / "I also noticed A, and B."
 *
 * One lead-in for the whole group. Three sentences each opening "I noticed" is
 * the failure conversational copy creates, and it reads worse than the
 * database prose it replaced.
 */
function gathered(list, leadIn) {
  const texts = list.map((p) => (p.tail !== undefined ? `${p.clause}${p.tail}` : p.clause));
  if (!texts.length) return '';
  if (texts.length === 1) return `${leadIn} ${texts[0]}.`;
  return `${leadIn} ${texts.slice(0, -1).join(', ')}, and ${texts[texts.length - 1]}.`;
}

/**
 * The evidence paragraphs, and a record of what went where.
 *
 * @param {object} flow      a `chooseStructure`/`resolveStructure` result
 * @param {Array}  selected  evidence objects, in SELECTION order
 * @param {object} ctx       { firstName, academicIntro }
 */
export function evidenceSlots(flow, selected = [], ctx = {}) {
  const plan = planPlacement(selected, flow.key);
  /**
   * One rendering pass, one record of who has been talked about.
   *
   * The set is created here rather than by the caller so that two passes over
   * the same evidence — a preview and the send — cannot inherit each other's
   * state, and so `paragraphFor` below starts clean as well.
   *
   * `partsOf` memoises because it is called twice per item (once for the token,
   * once to record the sentence) and the person guard is order-sensitive: a
   * second render would filter out the names the first one had just printed.
   */
  const pass = { ...ctx, namesUsed: new Set() };
  const rendered = new Map();
  const partsOf = (ev) => {
    if (!rendered.has(ev)) rendered.set(ev, evidenceParts(ev, pass));
    return rendered.get(ev);
  };

  const tokens = {};
  const placement = [];
  const sentences = [];
  let order = 0;

  const record = (ev, block, text) => {
    placement.push({ kind: ev.kind, tier: ev.tier, slot: block, order, displayed: true });
    // The text AS IT APPEARS IN THE BODY. The send path checks each of these
    // against what was actually sent to decide whether the claim was
    // delivered, so a preview-shaped variant here would make every edited
    // draft look like the operator had cut it.
    sentences.push({ kind: ev.kind, tier: ev.tier, slot: block, order, text });
    order += 1;
  };

  // --- the hook ------------------------------------------------------------
  if (plan.hook) {
    const parts = partsOf(plan.hook);
    const text = parts.clause;
    tokens[slotToken(BLOCKS.HOOK)] = reasoningSentence(
      parts, parts.framing ?? DEFAULT_HOOK_FRAMING,
    );
    record(plan.hook, BLOCKS.HOOK, text);
  }

  // --- the relevance paragraph --------------------------------------------
  if (plan.relevance.length) {
    const items = plan.relevance;
    if (plan.hook) {
      // The reasoning was given by the hook, so this paragraph is observations
      // gathered under one lead-in.
      tokens[slotToken(BLOCKS.RELEVANCE)] = gathered(items.map(partsOf), 'I also noticed');
      items.forEach((ev) => record(ev, BLOCKS.RELEVANCE, partsOf(ev).clause));
    } else {
      /**
       * No hook, so the first observation carries the reasoning — the email
       * still explains itself, just after the introduction rather than before
       * it. Framed as looking THROUGH the programme, which is what actually
       * happened and reads as it.
       */
      const [first, ...rest] = items;
      const firstParts = partsOf(first);
      const sentencesOut = [reasoningSentence(firstParts, RELEVANCE_FRAMING)];
      record(first, BLOCKS.RELEVANCE, firstParts.clause);

      if (rest.length === 1 && partsOf(rest[0]).alsoSentence) {
        // A single trailing observation reads flat as "I also noticed X."
        // Where a kind supplies a sentence with its own point, use it. Only a
        // few do; appending a reason to everything is the mechanical version
        // of this and reads worse than the bare clause.
        const p = partsOf(rest[0]);
        sentencesOut.push(p.alsoSentence);
        record(rest[0], BLOCKS.RELEVANCE, p.alsoSentence);
      } else if (rest.length) {
        sentencesOut.push(gathered(rest.map(partsOf), 'I also noticed'));
        rest.forEach((ev) => record(ev, BLOCKS.RELEVANCE, partsOf(ev).clause));
      }
      tokens[slotToken(BLOCKS.RELEVANCE)] = sentencesOut.join(' ');
    }
  }

  // --- programme recognition ----------------------------------------------
  if (plan.recognition.length) {
    const ev = plan.recognition[0];
    const text = partsOf(ev).recognition;
    tokens[slotToken(BLOCKS.RECOGNITION)] = text;
    record(ev, BLOCKS.RECOGNITION, text);
  }

  // Selected, and deliberately not in the email. Recorded so the log and the
  // operator view can say so rather than implying the claim was delivered.
  for (const ev of plan.held) {
    placement.push({ kind: ev.kind, tier: ev.tier, slot: null, order, displayed: false });
    order += 1;
  }

  return { tokens, placement, sentences };
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

/**
 * Everything a caller needs to render a composed email.
 *
 * @returns {{template, tokens, placement, sentences}}
 */
export function composeStructured(flow, selected = [], ctx = {}) {
  const { tokens, placement, sentences } = evidenceSlots(flow, selected, ctx);
  // The introduction names the athlete's subject only when the academic angle
  // is actually in the email; otherwise it is a claim about their plans with
  // no bearing on this programme.
  const variants = ctx.academicIntro ? { [BLOCKS.ATHLETE_INTRO]: 'academic' } : {};
  return {
    template: structuredTemplate(flow, tokens, variants),
    tokens,
    placement,
    sentences,
  };
}

/**
 * Every selected clause as one paragraph.
 *
 * The single-paragraph form, for templates that carry one
 * {{evidence_paragraph}} token — a saved template an operator has customised,
 * and anything written before composition existed. A composed email does not
 * use this: it places evidence through the body, which is the point of this
 * module.
 */
export function paragraphFor(items = [], ctx = {}) {
  const list = items.filter(Boolean);
  if (!list.length) return '';

  // Its own pass, for the same reason: a paragraph rendered after a structured
  // body must not think the structured body's names have already been said.
  const pass = { ...ctx, namesUsed: new Set() };
  const parts = list.map((ev) => (ev.kind ? evidenceParts(ev, pass) : ev));
  const recognition = parts.filter((p) => p.recognition);
  const observations = parts.filter((p) => !p.recognition);

  const out = [];
  if (observations.length) {
    const [first, ...rest] = observations;
    out.push(reasoningSentence(first, first.framing ?? DEFAULT_HOOK_FRAMING));
    if (rest.length) out.push(gathered(rest.slice(0, MAX_GATHERED), 'I also noticed'));
  }
  for (const r of recognition) out.push(r.recognition);
  return out.join(' ');
}

export { cap };
