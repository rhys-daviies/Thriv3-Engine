import { describe, it, expect } from 'vitest';
import {
  migrateTemplate, findBlock, evidenceBlock, MIGRATION_STATUS, EVIDENCE_TOKEN,
} from './templateMigration.js';
import { DEFAULT_EMAIL_TEMPLATE, fillTemplate, buildEmailContext } from '../src/lib/emailTemplate.js';

/**
 * The template both pilot athletes actually carried, byte for byte, read out
 * of `players.email_template` on 2026-08-28. Embedded rather than
 * reconstructed: the whole point of the migration is that it handles the real
 * string, and a fixture derived from the current default would prove nothing.
 */
const LEGACY_TEMPLATE = `Hi {{coach_name}},

I'm reaching out regarding {{player_name}}, a {{player_position|lowercase}}{{#if has_nationality}} from {{player_nationality}}{{/if}} who is exploring opportunities for the {{player_class_year}} recruiting class.

{{player_name}} — {{player_position}}

Recruiting Profile
• Position: {{player_position}}{{player_secondary_position}}
• Graduation: {{player_class_year}}{{#if has_gpa}}
• GPA: {{player_gpa}}{{/if}}{{#if has_sat_score}}
• SAT: {{player_sat_score}}{{/if}}{{#if has_yearly_budget}}
• Annual Budget: {{player_yearly_budget}}{{/if}}

Profile and highlight film:
{{player_profile_url}}
{{#if has_graduating_seniors}}
We believe {{player_name}} could be an interesting fit for {{college_name}}, particularly with {{graduating_seniors_count}} {{graduating_seniors_position}} graduating this season{{#if has_graduating_names}} {{graduating_seniors_names}}{{/if}}.
{{/if}}
Given your current roster and {{college_name}}'s needs, we'd love to hear your thoughts on whether {{player_name}} could be a potential fit for your programme.

Would you be open to taking a look at the profile and highlight film? If there's interest you can contact me directly via WhatsApp [[+64 21 920 775](tel:+6421920775)] to chat more.

Best regards,
Rhys Davies
Striv3 Elite Sports Management`;

/**
 * Conditional syntax left behind by a broken template.
 *
 * Deliberately not "any {{token}}": `{{player_profile_url}}` is SUPPOSED to
 * survive rendering — only the server knows each coach's tracking id, so
 * sendOutreach swaps it in per recipient. Asserting on all braces would fail
 * on the one token that is correct to leave.
 */
const unresolvedConditionals = (text) =>
  text.match(/\{\{#if[^}]*\}\}|\{\{else\}\}|\{\{\/if\}\}/g) ?? [];

const player = { full_name: 'Rhys Davies', position: 'Defender', nationality: 'New Zealand', recruiting_class_year: 2027 };
const college = { name: 'Example University', notable_majors: [] };

describe('finding the block to anchor to', () => {
  it('spans a nested block rather than closing on the inner {{/if}}', () => {
    const block = findBlock(LEGACY_TEMPLATE, 'has_graduating_seniors');
    expect(block.text.startsWith('{{#if has_graduating_seniors}}')).toBe(true);
    expect(block.text.endsWith('{{/if}}')).toBe(true);
    // The inner has_graduating_names block must be INSIDE, not the terminator.
    expect(block.text).toContain('{{#if has_graduating_names}}');
    expect(block.text.match(/\{\{\/if\}\}/g)).toHaveLength(2);
  });

  it('returns null for a block that is not there', () => {
    expect(findBlock(LEGACY_TEMPLATE, 'has_nothing')).toBeNull();
  });

  it('leaves an unbalanced template alone rather than half-rewriting it', () => {
    expect(findBlock('{{#if has_graduating_seniors}}no close', 'has_graduating_seniors')).toBeNull();
  });
});

describe('migrating the real legacy template', () => {
  it('produces exactly the current default', () => {
    const { status, template } = migrateTemplate(LEGACY_TEMPLATE);
    expect(status).toBe(MIGRATION_STATUS.MIGRATED);
    expect(template).toBe(DEFAULT_EMAIL_TEMPLATE);
  });

  it('is idempotent — running it twice changes nothing', () => {
    const once = migrateTemplate(LEGACY_TEMPLATE).template;
    const twice = migrateTemplate(once);
    expect(twice.status).toBe(MIGRATION_STATUS.ALREADY);
    expect(twice.template).toBe(once);
  });

  it('leaves the already-migrated default untouched', () => {
    const out = migrateTemplate(DEFAULT_EMAIL_TEMPLATE);
    expect(out.status).toBe(MIGRATION_STATUS.ALREADY);
    expect(out.template).toBe(DEFAULT_EMAIL_TEMPLATE);
  });
});

describe('preserving operator customisation', () => {
  const customised = LEGACY_TEMPLATE
    .replace('Hi {{coach_name}},', 'Kia ora {{coach_name}},')
    .replace(
      'We believe {{player_name}} could be an interesting fit for {{college_name}}, particularly with',
      'I noticed you have',
    );

  it('keeps every untouched line exactly as written', () => {
    const { template } = migrateTemplate(customised);
    expect(template).toContain('Kia ora {{coach_name}},');
    expect(template).toContain('WhatsApp [[+64 21 920 775](tel:+6421920775)]');
  });

  it('keeps the operator\'s own sentence verbatim, as the fallback', () => {
    const { template } = migrateTemplate(customised);
    expect(template).toContain('{{else}}{{#if has_graduating_seniors}}');
    expect(template).toContain('I noticed you have {{graduating_seniors_count}}');
  });

  it('adds nothing but the evidence block', () => {
    const { template } = migrateTemplate(customised);
    const added = template.length - customised.length;
    expect(added).toBe(evidenceBlock('').length - '{{else}}{{/if}}'.length + '{{else}}{{/if}}'.length);
  });
});

describe('refusing to guess', () => {
  it('flags a template with no block to anchor to', () => {
    const odd = 'Hi {{coach_name}},\n\nHave a look at {{player_name}}.\n\nThanks.';
    const out = migrateTemplate(odd);
    expect(out.status).toBe(MIGRATION_STATUS.MANUAL);
    expect(out.template).toBe(odd);          // unchanged
    expect(out.reason).toContain(EVIDENCE_TOKEN);
  });

  it('treats an empty template as already fine — it renders the default', () => {
    for (const empty of [null, undefined, '', '   ']) {
      expect(migrateTemplate(empty).status).toBe(MIGRATION_STATUS.EMPTY);
    }
  });
});

describe('the migrated template still renders correctly', () => {
  const migrated = migrateTemplate(LEGACY_TEMPLATE).template;

  it('renders the evidence paragraph when there is evidence', () => {
    const evidence = {
      selected: [], sentences: [], structure: { key: 'X' },
      paragraph: "You've had two New Zealanders come through the programme since 2022.",
    };
    const out = fillTemplate(migrated, buildEmailContext(player, college, 'Coach', { evidence }));
    expect(out).toContain("You've had two New Zealanders come through the programme since 2022.");
    // The fallback must NOT also appear — that would say the same thing twice.
    expect(out).not.toContain('particularly with');
  });

  it('falls back to the old sentence when there is no evidence at all', () => {
    const withGraduating = { ...college, graduating_at_position: 3, graduating_names_at_position: ['A', 'B'] };
    const out = fillTemplate(migrated, buildEmailContext(player, withGraduating, 'Coach'));
    expect(out).toContain('3 defenders graduating this season');
    expect(unresolvedConditionals(out)).toEqual([]);
  });

  it('says nothing about the programme when there is neither', () => {
    const out = fillTemplate(migrated, buildEmailContext(player, college, 'Coach'));
    expect(out).not.toContain('particularly with');
    expect(unresolvedConditionals(out)).toEqual([]);
    // Still a complete, sendable email.
    expect(out).toContain('Best regards');
  });

  it('leaves no unresolved conditional tags in any of the three states', () => {
    const states = [
      buildEmailContext(player, college, 'Coach'),
      buildEmailContext(player, { ...college, graduating_at_position: 2, graduating_names_at_position: [] }, 'Coach'),
      buildEmailContext(player, college, 'Coach', {
        evidence: { selected: [], sentences: [], structure: { key: 'X' }, paragraph: 'Something true.' },
      }),
    ];
    for (const ctx of states) {
      const out = fillTemplate(migrated, ctx);
      expect(out).not.toContain('{{#if');
      expect(out).not.toContain('{{else}}');
      expect(out).not.toContain('{{/if}}');
    }
  });
});
