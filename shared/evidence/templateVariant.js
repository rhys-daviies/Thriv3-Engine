/**
 * Which template shape actually produced an email.
 *
 * Deliberately a different variable from `structure`, and the distinction
 * matters for anything we later conclude from reply rates:
 *
 *   `structure` is what the evidence engine WOULD choose — the argument order
 *   it thinks fits this pairing. Today it is advisory: the email is rendered
 *   from the athlete's own `email_template`, so the structure key changes
 *   nothing about the words that are sent. Logging it now means that when a
 *   real structure library exists the earlier sends are still comparable, and
 *   until then an honest analysis can say the variable was constant.
 *
 *   `template_variant` is what actually rendered. That is the one that
 *   differs between athletes today, and the one that explains why two emails
 *   carrying the same evidence angle can read very differently.
 *
 * Keeping them apart is the whole point: with one field, "INTERNATIONAL_
 * CONNECTION replied better" could equally mean "the athletes whose templates
 * happen to mention their country replied better", and there would be no way
 * to tell.
 */

import { EVIDENCE_TOKEN } from '../templateMigration.js';

export const TEMPLATE_VARIANTS = Object.freeze({
  /** Byte-identical to the shipped default, evidence paragraph included. */
  DEFAULT_EVIDENCE_FIRST: 'DEFAULT_EVIDENCE_FIRST',
  /** Operator-edited, but still renders the engine's paragraph. */
  CUSTOM_EVIDENCE: 'CUSTOM_EVIDENCE',
  /**
   * Operator-edited and carrying NO evidence token, so the engine's paragraph
   * is computed, shown in the composer, and never sent. Sends under this id
   * must be excluded from any comparison of evidence angles — the angle was
   * chosen and then discarded before it reached the coach.
   */
  CUSTOM_NO_EVIDENCE: 'CUSTOM_NO_EVIDENCE',
  /** No template on file at all; the default was used verbatim. */
  UNKNOWN: 'UNKNOWN',
});

/**
 * @param {string|null} template  the athlete's saved `email_template`
 * @param {string}      defaultTemplate  the current shipped default
 */
export function templateVariant(template, defaultTemplate) {
  const text = String(template ?? '');
  if (!text.trim()) return TEMPLATE_VARIANTS.UNKNOWN;
  if (text === defaultTemplate) return TEMPLATE_VARIANTS.DEFAULT_EVIDENCE_FIRST;
  return text.includes(EVIDENCE_TOKEN)
    ? TEMPLATE_VARIANTS.CUSTOM_EVIDENCE
    : TEMPLATE_VARIANTS.CUSTOM_NO_EVIDENCE;
}
