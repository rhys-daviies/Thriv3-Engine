import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  canComposeStructured, emailBodyFor, DEFAULT_EMAIL_TEMPLATE, BODY_SOURCE, TEMPLATE_VARIABLES,
  buildEmailContext, fillTemplate,
} from './emailTemplate.js';
import { classifyTemplates } from '../../server/scripts/migrateCompositionAuthority.js';

/**
 * WHICH COMPOSER RUNS, AND WHY IT IS NO LONGER A STRING COMPARISON.
 *
 * `canComposeStructured` used to ask whether a saved template was
 * byte-identical to `DEFAULT_EMAIL_TEMPLATE`. That made a product constant the
 * authority over composition: J4 edited it to remove a duplicated line, two
 * athletes' saved copies stopped matching, and 2,338 emails moved onto the
 * fallback composer with nothing reporting it.
 *
 * The rule is now presence. A saved template means somebody wrote one; no
 * saved template means the structured composer. Editing the default cannot
 * reclassify anybody, because nothing reads it to decide.
 */

const player = (over = {}) => ({
  id: 'p1', full_name: 'Rhys Davies', position: 'Defender', sport: 'mens-soccer',
  nationality: 'New Zealand', recruiting_class_year: 2027, public_slug: 's', ...over,
});
const college = { name: 'Jacksonville', division: 'NCAA D1' };
const evidence = {
  selected: [],
  structure: { key: 'PLAYER_FIRST', label: 'Player first', source: 'ENGINE' },
  composition: { template: 'Hi {{coach_name}},\n\nI\'m reaching out about {{player_name}}.\n\n{{player_profile_url}}' },
};

describe('composition authority is presence, not content', () => {
  it('composes structurally for an athlete with no saved template', () => {
    expect(canComposeStructured(player())).toBe(true);
    expect(canComposeStructured(player({ email_template: null }))).toBe(true);
    expect(canComposeStructured(player({ email_template: '   ' }))).toBe(true);
  });

  it('treats any saved template as a deliberate override', () => {
    expect(canComposeStructured(player({ email_template: 'Hi {{coach_name}}, custom.' }))).toBe(false);
  });

  it('treats a COPY of the default as an override too, and the migration clears it', () => {
    // The copy is not intent — the form used to create it. It is not special-cased
    // in the authority rule; it is removed from the data, once, by a named command.
    expect(canComposeStructured(player({ email_template: DEFAULT_EMAIL_TEMPLATE }))).toBe(false);
    const c = classifyTemplates([
      player({ id: 'a', email_template: DEFAULT_EMAIL_TEMPLATE }),
      player({ id: 'b', email_template: '' }),
      player({ id: 'c', email_template: 'genuinely mine' }),
    ]);
    expect(c.defaultCopy.map((p) => p.id)).toEqual(['a']);
    expect(c.structured.map((p) => p.id)).toEqual(['b']);
    expect(c.custom.map((p) => p.id)).toEqual(['c']);
  });

  /**
   * THE J4 FAILURE, AS A TEST.
   *
   * Editing the default used to move athletes onto the fallback path. Nothing
   * reads it to decide any more, so it cannot.
   */
  it('changing DEFAULT_EMAIL_TEMPLATE reclassifies nobody', () => {
    const structured = player();
    const custom = player({ email_template: 'Hi {{coach_name}}, custom.' });
    for (const pretend of ['', 'a completely different default', `${DEFAULT_EMAIL_TEMPLATE}\nextra line`]) {
      expect(canComposeStructured(structured, pretend), pretend.slice(0, 20)).toBe(true);
      expect(canComposeStructured(custom, pretend), pretend.slice(0, 20)).toBe(false);
    }
    // And it takes no second argument at all now — there is nothing to compare to.
    expect(canComposeStructured.length).toBe(1);
  });

  it('records what actually composed the body', () => {
    expect(emailBodyFor(player(), college, 'Coach', { evidence }).source).toBe(BODY_SOURCE.STRUCTURED);
    expect(emailBodyFor(player({ email_template: 'Hi {{coach_name}}.' }), college, 'Coach', { evidence }).source)
      .toBe(BODY_SOURCE.TEMPLATE);
  });

  it('composes structurally with no evidence at all', () => {
    // A generic email is a real email. Empty evidence must not force the
    // fallback path — only a missing composition can.
    const bare = { ...evidence, composition: { template: 'Hi {{coach_name}},\n\n{{player_profile_url}}' } };
    const out = emailBodyFor(player(), college, 'Coach', { evidence: bare });
    expect(out.source).toBe(BODY_SOURCE.STRUCTURED);
    expect(out.body).toContain('Hi Coach');
  });

  it('composes structurally when optional athlete data is missing', () => {
    for (const missing of [{ gpa: null }, { sat_score: null }, { intended_major: null },
      { secondary_position: null }, { nationality: null }]) {
      const out = emailBodyFor(player(missing), college, 'Coach', { evidence });
      expect(out.source, JSON.stringify(missing)).toBe(BODY_SOURCE.STRUCTURED);
    }
  });
});

/**
 * ONE EVIDENCE AUTHORITY.
 *
 * The template path could recreate, from the uploaded recommendations JSON,
 * claims the registry DENIES for outreach — with named players, no
 * qualification, no confidence floor, no freshness check and no disposition.
 */
describe('the template path cannot state a denied claim', () => {
  const DENIED_TOKENS = [
    'graduating_starters_count', 'graduating_starters_names',
    'graduating_total_count', 'has_graduating_total',
    'international_players_count', 'has_international_players',
  ];

  it('offers none of them', () => {
    const offered = TEMPLATE_VARIABLES.map((t) => t.token);
    for (const t of DENIED_TOKENS) expect(offered, t).not.toContain(t);
  });

  it('resolves none of them, even from a recommendations-shaped college', () => {
    /**
     * The exact shape the uploads carry. Before J5 this rendered
     * "6 defenders graduating. starters: 4 — Herman Tveit-Reffsgaard, …" for a
     * pairing whose only licensed claim was a compatriot connection.
     */
    const ctx = buildEmailContext(player(), {
      ...college,
      graduating_seniors_at_position: 6,
      graduating_starters_at_position: 4,
      graduating_starter_names_at_position: ['A Player', 'B Player'],
      graduating_total: 11,
      international_players: 9,
    }, 'Coach', { evidence });
    for (const t of DENIED_TOKENS) expect(ctx[t], t).toBeUndefined();
    // Unresolved tokens stay visible rather than rendering a claim.
    const out = fillTemplate('[{{graduating_starters_names}}|{{international_players_count}}]', ctx);
    expect(out).toBe('[{{graduating_starters_names}}|{{international_players_count}}]');
    expect(out).not.toContain('A Player');
  });

  it('leaves the engine\'s own paragraph as the way to say evidence', () => {
    expect(TEMPLATE_VARIABLES.map((t) => t.token)).toContain('evidence_paragraph');
  });

  it('does not re-derive evidence in the template module', () => {
    // The one authority is evidenceFor -> outreachEvidenceFor -> outreachCopyFor.
    const code = readFileSync(new URL('./emailTemplate.js', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const forbidden of ['outreachEvidenceFor', 'outreachCopyFor', 'generateEvidence', 'emailEligible']) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});
