/**
 * The reusable pieces an email is built from.
 *
 * Four concerns are kept apart across this system and this file is one of
 * them:
 *
 *   evidence calculation   shared/evidence/generate.js — what is true
 *   evidence copy          shared/evidence/render.js   — how firmly to say it
 *   structure layout       shared/evidence/structures.js — what order
 *   athlete copy           THIS FILE                   — the words around it
 *
 * A block is a template fragment in the existing `{{token}}` / `{{#if}}`
 * language, not a function returning a string. That is deliberate: the
 * conditionals, the filters and the unresolved-token report already exist and
 * are already tested, and a second templating mechanism living beside the
 * first is how two emails come to disagree about whether a GPA line should
 * appear.
 *
 * THE COPY HERE IS NOW THE SOURCE OF TRUTH, and deliberately DIVERGES from
 * DEFAULT_EMAIL_TEMPLATE.
 *
 * It used to be lifted verbatim from that template, with a test asserting so.
 * That test is gone on purpose: this copy has been rewritten into one
 * consistent first-person voice, and the legacy template has NOT — it is
 * frozen because `templateVariant` compares saved templates against it byte
 * for byte, and changing it would reclassify every athlete's saved template as
 * customised and silently switch structured composition off for all of them.
 *
 * So: structured emails render from here. An athlete who has customised their
 * template renders from theirs, unchanged, exactly as before.
 *
 * Nothing below makes a claim about a programme. Claims about programmes come
 * from the evidence renderers and nowhere else — every fragment here is about
 * the athlete, about us, or is a question.
 */

import { BLOCKS, EVIDENCE_BLOCKS } from '../evidence/structures.js';

/** The token an evidence block resolves to. */
export function slotToken(block) {
  return `evidence_${String(block).toLowerCase()}`;
}

export const SLOT_TOKENS = Object.freeze(EVIDENCE_BLOCKS.map(slotToken));

/**
 * Fragment text by block, then by variant.
 *
 * `default` is the variant every structure gets unless it names another. A
 * structure asking for a variant that does not exist falls back to `default`
 * rather than rendering nothing — a missing paragraph in a coach's inbox is a
 * worse failure than a slightly less tailored one.
 */
export const BLOCK_COPY = Object.freeze({
  /**
   * First name only.
   *
   * "Hi Ali Simmons," opened every email in the QA sample, and it is the line
   * that most reliably marks a message as generated — nobody greets a
   * colleague by their full name. `coach_first_name` falls back to the full
   * name when the first name cannot be read confidently, so this can never
   * render empty or leave a token behind.
   */
  [BLOCKS.GREETING]: {
    default: 'Hi {{coach_first_name}},',
  },

  [BLOCKS.ATHLETE_INTRO]: {
    default: "I'm reaching out about {{player_name}}, a {{player_position|lowercase}}"
      + '{{#if has_nationality}} from {{player_nationality}}{{/if}}'
      + ' looking at options for the {{player_class_year}} class.',

    /**
     * The academic structure's introduction.
     *
     * Carries the subject into the sentence that already introduces the
     * athlete rather than adding a second sentence restating it — "You offer
     * Kinesiology. Rhys is planning to study Kinesiology." is what the obvious
     * version produces.
     *
     * The athlete's OWN words, not the college's. `intended_major_stated` is
     * what the recruit typed ("exercise science"); `intended_major_label` is
     * the catalogue programme the college publishes ("Kinesiology"), and that
     * one belongs to the ACADEMIC_FIT clause. Printing the label here put the
     * college's word in the athlete's mouth and made the two sentences echo.
     *
     * Gated on `offers_intended_major`, which is only true when the athlete's
     * own stated major matched this school's notable majors. With no match the
     * clause disappears and the sentence is the default one.
     */
    academic: "I'm reaching out about {{player_name}}, a {{player_position|lowercase}}"
      + '{{#if has_nationality}} from {{player_nationality}}{{/if}}'
      + ' looking at options for the {{player_class_year}} class'
      + '{{#if offers_intended_major}}, and planning to study {{intended_major_stated}}{{/if}}.',
  },

  /**
   * The profile block: bullets, and nothing above them.
   *
   * It carried a "{{player_name}} — {{player_position}}" heading, then "A bit
   * about {{player_first_name}}:". Both are gone. The athlete was named in the
   * paragraph immediately above and the first bullet is the position, so a
   * heading announces what the reader can already see — which is what made it
   * read as a form rather than as a note from a person.
   */
  /**
   * NO BUDGET LINE.
   *
   * `player_yearly_budget` is still populated, still on the athlete's record,
   * and still read by matching and affordability — it is simply not something
   * a first approach tells a coach. A band in the opening email invites the
   * reader to price the athlete before they have watched a minute of film, and
   * it answers a question nobody asked.
   *
   * The token and its conditional stay registered so an operator's own
   * template can still use them; what changed is that the structured body no
   * longer does.
   *
   * Each conditional OPENS at the end of the preceding line, so a missing GPA
   * or SAT removes its whole line including the newline in front of it, rather
   * than leaving a bullet with an empty label.
   */
  [BLOCKS.CREDENTIALS]: {
    default: [
      '• Position: {{player_position}}{{player_secondary_position}}',
      '• Graduation: {{player_class_year}}{{#if has_gpa}}',
      '• GPA: {{player_gpa}}{{/if}}{{#if has_sat_score}}',
      '• SAT: {{player_sat_score}}{{/if}}',
    ].join('\n'),
  },

  [BLOCKS.PROFILE]: {
    default: 'Profile and highlight film:\n{{player_profile_url}}',
  },

  /**
   * The ask.
   *
   * The old close read "Given your current roster and {{college_name}}'s
   * needs, we'd love to hear your thoughts on whether {{player_name}} could be
   * a potential fit for your programme." Three separate problems: "your
   * needs" is a claim about their squad nothing in our data supports, "we'd
   * love" is the plural again, and the programme name had already appeared
   * twice. What replaces it asks a question and claims nothing.
   */
  /**
   * The ask. ONE variant, and no conditional on what the coach wants.
   *
   * The old close read "Given your current roster and {{college_name}}'s
   * needs, we'd love to hear your thoughts on whether {{player_name}} could be
   * a potential fit for your programme" — a claim about their squad nothing in
   * our data supports, in the plural where the rest of the email is singular.
   *
   * A second variant then opened "If you're looking at defenders for 2027",
   * which read as a softer question and was the same mistake in a politer
   * register: whether they are looking at defenders is a recruiting intention
   * we do not know. Conditioning the ask on it either flatters a guess or
   * quietly excuses the coach from answering. It is gone, and the structures
   * that used it now take the default like everything else.
   *
   * What remains states an interest and asks for a view. It assumes only that
   * the coach has an opinion, which is the one thing that is always true.
   */
  [BLOCKS.CTA]: {
    // No pronoun: `players` stores no gender or pronoun field, and guessing one
    // from the sport would be wrong for anyone it is wrong for. The first name
    // reads at least as naturally and cannot misgender a real person.
    default: 'Would be great to hear your thoughts on {{player_first_name}} for your'
      + ' {{player_class_year}} group.'
      + '\n\n'
      + "If it's worth a look I'm happy to send over anything else that would help — you can"
      + ' also reach me on WhatsApp [[+64 21 920 775](tel:+6421920775)].',
  },

  [BLOCKS.SIGNOFF]: {
    default: 'Best regards,\nRhys Davies\nStriv3 Elite Sports Management',
  },
});

/**
 * The fragment for one block of a flow.
 *
 * Evidence blocks resolve to their token and nothing else. The engine's prose
 * is substituted in at fill time, so no flow and no variant can add a word to
 * a factual claim — which is the property that makes FACT/SIGNAL survive the
 * introduction of composition at all.
 */
export function fragmentFor(block, variant = undefined) {
  if (EVIDENCE_BLOCKS.includes(block)) return `{{${slotToken(block)}}}`;
  const copy = BLOCK_COPY[block];
  if (!copy) throw new Error(`No copy registered for block ${block}`);
  return copy[variant] ?? copy.default;
}
