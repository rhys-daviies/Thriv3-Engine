/**
 * Bringing a saved email template up to the evidence engine.
 *
 * Every athlete carries their own `players.email_template`, copied from the
 * default the day they were created and editable since. Those copies predate
 * `{{evidence_paragraph}}`, so the engine computes evidence, the composer
 * displays it, and the coach receives the old hardcoded sentence — which is
 * how the Australia connection at Sacred Heart was found, displayed, and never
 * sent.
 *
 * The migration is deliberately conservative. A template is somebody's voice,
 * and rewriting it wholesale to add one paragraph would be a poor trade. So
 * there is exactly one transformation:
 *
 *   the existing {{#if has_graduating_seniors}} block becomes the {{else}}
 *   branch of a new {{#if has_evidence}} block
 *
 * which means the operator's own sentence — however they have edited it — is
 * preserved verbatim and still renders whenever there is no evidence. Nothing
 * is deleted, nothing is reworded, and a template with no such block is
 * reported rather than guessed at.
 */

/** Marks a template as already carrying the engine's output. */
export const EVIDENCE_TOKEN = '{{evidence_paragraph}}';

const OPEN = '{{#if ';
const CLOSE = '{{/if}}';

/**
 * The span of a `{{#if <name>}} … {{/if}}` block, nesting included.
 *
 * Written as a scan rather than a regular expression because these blocks
 * nest: the graduating block contains a `has_graduating_names` block, and a
 * non-greedy pattern closes on the inner `{{/if}}` — the exact bug that once
 * sent a coach an email ending "graduating this year{{#if has_graduating_names}}".
 */
export function findBlock(template, name) {
  const text = String(template ?? '');
  const openTag = `${OPEN}${name}}}`;
  const start = text.indexOf(openTag);
  if (start === -1) return null;

  let depth = 0;
  let i = start;
  while (i < text.length) {
    if (text.startsWith(OPEN, i)) { depth += 1; i += OPEN.length; continue; }
    if (text.startsWith(CLOSE, i)) {
      depth -= 1;
      i += CLOSE.length;
      if (depth === 0) return { start, end: i, text: text.slice(start, i) };
      continue;
    }
    i += 1;
  }
  // An unbalanced template is left alone rather than half-rewritten: the
  // composer already reports unresolved tokens, and a migration that produced
  // a worse template than it found would be the wrong kind of helpful.
  return null;
}

/**
 * The evidence block, wrapping whatever the athlete's template already said.
 *
 * The lead sentence is deliberately short and generic. The specific claim is
 * in `{{evidence_paragraph}}`, which the engine wrote and tiered; adding
 * adjectives around it here would be prose the FACT/SIGNAL rules never saw.
 */
export function evidenceBlock(fallback) {
  return [
    '{{#if has_evidence}}',
    '{{evidence_paragraph}}',
    '',
    'We believe {{player_name}} could be an interesting fit for {{college_name}}.',
    `{{else}}${fallback}{{/if}}`,
  ].join('\n');
}

export const MIGRATION_STATUS = Object.freeze({
  ALREADY: 'already-migrated',
  MIGRATED: 'migrated',
  EMPTY: 'empty',
  MANUAL: 'needs-manual-placement',
});

/**
 * Migrates one template.
 *
 * Idempotent by construction: a template already containing
 * `{{evidence_paragraph}}` is returned untouched, so the script can be run
 * repeatedly and after a partial run.
 *
 * @returns {{status: string, template: string, reason: string|null}}
 */
export function migrateTemplate(template) {
  const text = String(template ?? '');

  if (!text.trim()) {
    return {
      status: MIGRATION_STATUS.EMPTY,
      template: text,
      reason: 'no saved template — this athlete uses the default, which already has the token',
    };
  }

  if (text.includes(EVIDENCE_TOKEN)) {
    return { status: MIGRATION_STATUS.ALREADY, template: text, reason: null };
  }

  const block = findBlock(text, 'has_graduating_seniors');
  if (!block) {
    // Refused rather than guessed. Choosing a paragraph boundary in somebody
    // else's letter is exactly the kind of "helpful" edit that produces a
    // sentence in the wrong place, and the operator can put it where they
    // want it in seconds once told.
    return {
      status: MIGRATION_STATUS.MANUAL,
      template: text,
      reason: 'no {{#if has_graduating_seniors}} block to anchor to — add '
        + `${EVIDENCE_TOKEN} by hand where the programme sentence belongs`,
    };
  }

  const migrated = text.slice(0, block.start)
    + evidenceBlock(block.text)
    + text.slice(block.end);

  return { status: MIGRATION_STATUS.MIGRATED, template: migrated, reason: null };
}
