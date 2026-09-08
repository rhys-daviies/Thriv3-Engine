import { describe, it, expect } from 'vitest';
import { outreachEvidenceFor, LICENSED_KINDS } from './outreachEvidence.js';
import { outreachCopyFor, OUTREACH_COPY_KINDS } from './outreachCopy.js';
import { EVIDENCE_KINDS, permissionsFor, PERMISSION } from './kinds.js';
import {
  OUTREACH_POLICY_VERSION, LEGACY_POLICY_VERSION, KNOWN_POLICY_VERSIONS, comparablePolicies,
} from './outreachPolicy.js';
import {
  DEFAULT_EMAIL_TEMPLATE, buildEmailContext, fillTemplate, validateTemplate,
  unresolvedTokens, TEMPLATE_VARIABLES, emailBodyFor, BODY_SOURCE,
} from '../../src/lib/emailTemplate.js';

/**
 * THE CLOSEOUT CHECKS FOR EMAIL INTELLIGENCE.
 *
 * Each of these pins a decision a whole stage was spent reaching, in the one
 * place a later change would break it without meaning to.
 */

const player = {
  full_name: 'Rhys Davies', position: 'Defender', sport: 'mens-soccer',
  nationality: 'New Zealand', recruiting_class_year: 2027, gpa: 3.6, sat_score: 1210,
  intended_major: 'exercise science',
};
/** Every field a recommendations blob or a college row can carry. */
const richCollege = {
  name: 'Jacksonville', division: 'NCAA D1', conference: 'ASUN', city: 'Jacksonville', state: 'FL',
  nickname: 'Dolphins', mascot: 'Fin', notable_majors: ['Kinesiology'],
  conference_champion_2025: 1, conference_champion_name: 'ASUN', postseason_2025_round: 'r16',
  players_from_country: 3, international_players: 9, graduating_total: 11,
  graduating_at_position: 4, graduating_names_at_position: ['A Smith', 'B Jones'],
  graduating_seniors_at_position: 4, graduating_senior_names_at_position: ['A Smith', 'B Jones'],
  graduating_starters_at_position: 2, graduating_starter_names_at_position: ['A Smith'],
};

describe('a congratulation says "as well" only when something precedes it', () => {
  const say = (afterClaim) => outreachCopyFor(
    { kind: 'POSTSEASON_RESULT', facts: { round: 'r16' } }, { afterClaim },
  ).recognition;

  it('drops the connective when it is the only claim', () => {
    // 429 emails. The introduction is about the athlete; a congratulation
    // following it alone pointed back at an observation never made.
    expect(say(false)).toBe('Congrats on reaching the round of 16 last season.');
    expect(say(undefined)).not.toContain('as well');
  });

  it('keeps it when a claim about this programme came first', () => {
    expect(say(true)).toBe('Congrats on reaching the round of 16 last season as well.');
  });

  it('does the same for the conference title', () => {
    const conf = (afterClaim) => outreachCopyFor(
      { kind: 'CONFERENCE_TITLE', facts: { conference: 'ACC' } }, { afterClaim },
    ).recognition;
    expect(conf(false)).toBe('Congrats on winning the ACC last year.');
    expect(conf(true)).toBe('Congrats on winning the ACC last year as well.');
  });

  it('changes nothing else about what the congratulation claims', () => {
    for (const round of ['champion', 'final', 'semi', 'quarter', 'r16', 'r32', 'appearance']) {
      const out = outreachCopyFor({ kind: 'POSTSEASON_RESULT', facts: { round } }, {}).recognition;
      expect(out, round).toMatch(/^Congrats on .+ last season\.$/);
    }
  });
});

describe('the policy version tracks what Stage J changed', () => {
  it('is P3, not P2', () => {
    /**
     * J3 changed licensing, qualification and selection; J4 added a
     * cross-group hold; J7 changed copy. Every one is on the bump list in
     * outreachPolicy.js, and the version had stayed at P2 while its own
     * description stopped being true of the engine.
     */
    // J8 set P3. K3C set P4 on the same rule — a licensing change and two
    // copy-semantic ones. What this test protects is that the version MOVED
    // when the engine did, not that it stopped at any particular letter.
    expect(KNOWN_POLICY_VERSIONS).toContain('P3');
    expect(OUTREACH_POLICY_VERSION).not.toBe('P2');
  });

  it('still knows P2 and LEGACY_UNKNOWN, and pools neither with anything', () => {
    expect(KNOWN_POLICY_VERSIONS).toEqual([LEGACY_POLICY_VERSION, 'P2', 'P3', 'P4', 'P5', 'P6']);
    expect(comparablePolicies('P3', 'P3')).toBe(true);
    expect(comparablePolicies('P2', 'P3')).toBe(false);
    expect(comparablePolicies('P3', 'P4')).toBe(false);
    expect(comparablePolicies('P4', 'P5')).toBe(false);
    expect(comparablePolicies('P5', 'P6')).toBe(false);
    expect(comparablePolicies(LEGACY_POLICY_VERSION, LEGACY_POLICY_VERSION)).toBe(false);
  });

  it('describes the licensing it actually ships', () => {
    // The defect was a version whose docstring had drifted from the registry.
    const grade = (k) => permissionsFor(k).OUTREACH;
    const licensed = Object.keys(EVIDENCE_KINDS).filter((k) => grade(k) !== PERMISSION.DENIED);
    expect(licensed).toHaveLength(9);
    expect(licensed.filter((k) => grade(k) === PERMISSION.ALLOWED)).toHaveLength(4);
    expect(licensed.filter((k) => grade(k) === PERMISSION.QUALIFIED)).toHaveLength(5);
  });
});

/**
 * THE BYPASS ATTACK, run against every registered kind rather than a list
 * somebody remembered to update.
 */
describe('no template can state a claim the engine withheld', () => {
  const ctx = buildEmailContext(player, richCollege, 'Ali Simmons', { profileUrl: 'https://x/p' });

  it('resolves no token named after any evidence kind', () => {
    const offered = TEMPLATE_VARIABLES.map((v) => v.token.toLowerCase());
    for (const kind of Object.keys(EVIDENCE_KINDS)) {
      expect(offered, kind).not.toContain(kind.toLowerCase());
      expect(ctx[kind.toLowerCase()], kind).toBeUndefined();
    }
  });

  it('cannot rebuild a DENIED kind from the richest college object', () => {
    const denied = Object.keys(EVIDENCE_KINDS).filter((k) => permissionsFor(k).OUTREACH === PERMISSION.DENIED);
    expect(denied).toHaveLength(17);
    // The tokens that once did it, all of them, gated and ungated.
    const attempt = ['graduating_starters_names', 'graduating_starters_count',
      'graduating_total_count', 'international_players_count', 'players_from_country_count',
      'has_graduating_total', 'has_international_players', 'has_players_from_country']
      .map((t) => `{{#if ${t}}}LEAK{{/if}}{{${t}}}`).join('');
    const out = fillTemplate(attempt, ctx);
    expect(out).not.toContain('LEAK');
    expect(out).not.toMatch(/\d/);
    expect(out).not.toContain('A Smith');
  });

  it('cannot rebuild a HELD, DEDUPED or UNSELECTED licensed kind', () => {
    /**
     * All three are claims the engine had, qualified, and chose not to send.
     * A template restating one would make every one of those decisions
     * decorative.
     */
    const r = outreachEvidenceFor({
      all: [
        { kind: 'ARRIVAL_SAME_COUNTRY_POSITION', confidence: 'HIGH', data: { country: 'New Zealand', position: 'defender', count: 1, seasons: ['2025'], name: 'Harrison Dudley', nameSeason: '2025' } },
        { kind: 'POSITION_GRADUATION', confidence: 'HIGH', data: { position: 'defender', count: 2, names: ['A Smith', 'B Jones'], classYear: 2027 } },
        { kind: 'CONFERENCE_TITLE', confidence: 'HIGH', data: { conference: 'ASUN' } },
        { kind: 'POSTSEASON_RESULT', confidence: 'HIGH', data: { round: 'r16' } },
      ],
    });
    const withheld = (r.dispositions ?? []).filter((d) => ['HELD', 'DEDUPED'].includes(d.disposition));
    // POSITION_GRADUATION held by POSITION_FLOW_HOLD; one of the two
    // recognitions deduped out of `programme-success`.
    expect(withheld.map((d) => d.kind)).toContain('POSITION_GRADUATION');
    expect(withheld.length).toBeGreaterThanOrEqual(2);

    const attempt = '{{#if has_graduating_seniors}}{{graduating_seniors_count}} {{graduating_seniors_position}} '
      + 'graduating {{graduating_seniors_names}}{{/if}}'
      + '{{#if is_conference_champion}}champions of {{conference_champion_name}}{{/if}}'
      + '{{#if has_postseason_result}}{{postseason_round_label}}{{/if}}';
    expect(fillTemplate(attempt, ctx)).toBe('');
  });

  it('gives every licensed kind exactly one voice', () => {
    expect([...OUTREACH_COPY_KINDS].sort()).toEqual([...LICENSED_KINDS].sort());
  });
});

describe('a composition failure degrades to raw facts', () => {
  it('renders the scaffold with no evidence claim in it', () => {
    const out = emailBodyFor(player, richCollege, 'Coach', { evidence: null, profileUrl: 'https://x/p' });
    expect(out.source).toBe(BODY_SOURCE.TEMPLATE);
    expect(out.body).toContain('Rhys Davies');
    for (const claim of ['graduating', 'conference', 'postseason', 'internationals', 'New Zealand players']) {
      expect(out.body.toLowerCase(), claim).not.toContain(claim.toLowerCase());
    }
    expect(unresolvedTokens(out.template, out.context)).toEqual([]);
  });

  it('carries no evidence-derivation token at all', () => {
    for (const t of ['graduating_seniors_count', 'has_graduating_seniors', 'is_conference_champion',
      'postseason_round_label', 'players_from_country_count', 'intended_major_label']) {
      expect(DEFAULT_EMAIL_TEMPLATE, t).not.toContain(t);
    }
  });
});

describe('a template naming a token nothing resolves cannot be saved', () => {
  it('accepts an empty template — that is the absence of an override', () => {
    expect(validateTemplate('').valid).toBe(true);
    expect(validateTemplate(null).valid).toBe(true);
  });

  it('accepts raw facts and the engine\'s paragraph', () => {
    expect(validateTemplate(DEFAULT_EMAIL_TEMPLATE).valid).toBe(true);
    expect(validateTemplate('Hi {{coach_name}}, about {{player_name}} '
      + '({{player_position}}, {{player_class_year}}).{{#if has_evidence}} {{evidence_paragraph}}{{/if}}').valid).toBe(true);
  });

  it('refuses a retired claim token, and names it', () => {
    const r = validateTemplate('Hi. {{graduating_seniors_count}} leaving.');
    expect(r.valid).toBe(false);
    expect(r.unknown).toEqual(['graduating_seniors_count']);
  });

  it('refuses a typo', () => {
    expect(validateTemplate('Hi {{coach_nmae}}.').unknown).toEqual(['coach_nmae']);
  });

  it('agrees with the preview, because it is the same parser', () => {
    const tpl = 'Hi {{coach_name}} {{graduating_starters_names}} {{nonsense}}';
    const ctx = buildEmailContext(player, richCollege, 'Coach', {});
    expect(validateTemplate(tpl).unknown.sort()).toEqual(unresolvedTokens(tpl, ctx).sort());
  });

  it('never edits the operator\'s text', () => {
    // A refusal reports; it does not strip, blank or rewrite.
    const tpl = 'Hi. {{graduating_seniors_count}} leaving.';
    const r = validateTemplate(tpl);
    expect(r).not.toHaveProperty('template');
    expect(Object.keys(r).sort()).toEqual(['unknown', 'valid']);
  });
});
