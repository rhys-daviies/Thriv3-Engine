import { describe, it, expect } from 'vitest';
import {
  TEMPLATE_VARIABLES, DEFAULT_EMAIL_TEMPLATE, buildEmailContext, fillTemplate,
  unresolvedTokens, emailBodyFor, BODY_SOURCE,
} from './emailTemplate.js';
import { EVIDENCE_KINDS, permissionsFor, PERMISSION } from '../../shared/evidence/kinds.js';
import { LICENSED_KINDS, outreachEvidenceFor } from '../../shared/evidence/outreachEvidence.js';
import { OUTREACH_COPY_KINDS } from '../../shared/evidence/outreachCopy.js';
import { templateVariant, TEMPLATE_VARIANTS } from '../../shared/evidence/templateVariant.js';

/**
 * RAW FACTS MAY REACH A TEMPLATE. EVIDENCE CLAIMS MAY NOT.
 *
 * The boundary, stated so it can be applied to a token nobody has written yet:
 *
 *   A RAW FACT is a property of ONE entity, readable from one row — the
 *   athlete's position, the programme's conference, the coach's name. It is
 *   true whoever you say it to.
 *
 *   An EVIDENCE CLAIM relates the athlete to the programme, or describes the
 *   programme's behaviour over time — players from this athlete's country have
 *   come through, players at this athlete's position are graduating, this
 *   programme won its conference. It is an observation the engine had to go
 *   and make, and it is only worth saying to one reader.
 *
 * The distinction does NOT depend on whether the claim happens to be licensed.
 * `is_conference_champion` agreed with CONFERENCE_TITLE on all 363 live pairs
 * and was removed anyway: parity is not authority, and a second derivation
 * that agrees today is a second derivation that can drift tomorrow.
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
  players_from_country: 3, international_players: 9,
  graduating_at_position: 4, graduating_names_at_position: ['A Smith', 'B Jones'],
  graduating_seniors_at_position: 4, graduating_senior_names_at_position: ['A Smith', 'B Jones'],
  graduating_starters_at_position: 2, graduating_starter_names_at_position: ['A Smith'],
  graduating_total: 11,
};

/** Every token that ever rebuilt a registered Evidence claim outside the engine. */
const RETIRED_CLAIM_TOKENS = [
  // J5 — these could state kinds the registry DENIES.
  'graduating_starters_count', 'graduating_starters_names',
  'graduating_total_count', 'has_graduating_total',
  'international_players_count', 'has_international_players',
  // J6 — these rebuilt LICENSED kinds outside qualification and selection.
  'graduating_seniors_count', 'graduating_seniors_names', 'graduating_seniors_position',
  'has_graduating_seniors', 'has_graduating_names',
  'players_from_country_count', 'has_players_from_country',
  'conference_champion_name', 'is_conference_champion',
  'postseason_round_label', 'has_postseason_result',
  'intended_major_label',
];

describe('no template token can rebuild an Evidence claim', () => {
  const ctx = buildEmailContext(player, richCollege, 'Ali Simmons', { profileUrl: 'https://x/p' });

  it('resolves none of them, from the richest college object we can build', () => {
    for (const t of RETIRED_CLAIM_TOKENS) expect(ctx[t], t).toBeUndefined();
  });

  it('offers none of them', () => {
    const offered = TEMPLATE_VARIABLES.map((v) => v.token);
    for (const t of RETIRED_CLAIM_TOKENS) expect(offered, t).not.toContain(t);
  });

  it('leaves a template that uses one visibly broken, never quietly empty', () => {
    /**
     * `fillTemplate` leaves an unknown token as written — a half-substituted
     * template is worse than an obvious one. Silently emptying these would
     * hide operator debt instead of surfacing it.
     */
    const tpl = RETIRED_CLAIM_TOKENS.map((t) => `{{${t}}}`).join(' ');
    expect(fillTemplate(tpl, ctx)).toBe(tpl);
    expect(unresolvedTokens(tpl, ctx).sort()).toEqual([...RETIRED_CLAIM_TOKENS].sort());
  });

  it('cannot be gated around either — a conditional on one is simply false', () => {
    const out = fillTemplate('{{#if has_graduating_seniors}}LEAK{{/if}}'
      + '{{#if is_conference_champion}}LEAK{{/if}}'
      + '{{#if has_postseason_result}}LEAK{{/if}}'
      + '{{#if has_players_from_country}}LEAK{{/if}}', ctx);
    expect(out).toBe('');
  });
});

describe('the scaffold says evidence only through the engine', () => {
  it('carries no claim token', () => {
    for (const t of RETIRED_CLAIM_TOKENS) expect(DEFAULT_EMAIL_TEMPLATE, t).not.toContain(t);
  });

  it('says nothing about need, fit or the roster in its own voice', () => {
    for (const phrase of ['We believe', 'interesting fit', 'needs', 'graduating', 'roster']) {
      expect(DEFAULT_EMAIL_TEMPLATE.toLowerCase(), phrase).not.toContain(phrase.toLowerCase());
    }
  });

  it('has exactly one way to state evidence', () => {
    expect(DEFAULT_EMAIL_TEMPLATE).toContain('{{evidence_paragraph}}');
    expect(DEFAULT_EMAIL_TEMPLATE).toContain('{{#if has_evidence}}');
  });

  it('states the athlete\'s position and class once each', () => {
    // J4 removed this duplication from the structured block and could not
    // touch the scaffold, because editing it reclassified athletes. J5 ended
    // that, so the scaffold catches up here.
    const body = fillTemplate(DEFAULT_EMAIL_TEMPLATE, buildEmailContext(player, richCollege, 'Coach'));
    expect(body.match(/defender/gi) ?? []).toHaveLength(1);
    expect(body.match(/2027/g) ?? []).toHaveLength(1);
  });

  it('keeps the raw facts a custom template needs', () => {
    const body = fillTemplate(DEFAULT_EMAIL_TEMPLATE, buildEmailContext(player, richCollege, 'Ali Simmons', { profileUrl: 'https://x/p' }));
    for (const fact of ['Rhys Davies', 'defender', 'New Zealand', '2027', '3.6', '1210', 'https://x/p']) {
      expect(body, fact).toContain(fact);
    }
    expect(unresolvedTokens(DEFAULT_EMAIL_TEMPLATE, buildEmailContext(player, richCollege, 'Coach'))).toEqual([]);
  });
});

describe('every licensed kind is voiced by the engine, and only by it', () => {
  it('has copy for each, in outreachCopy and nowhere else', () => {
    expect([...OUTREACH_COPY_KINDS].sort()).toEqual([...LICENSED_KINDS].sort());
    // Read from the registry rather than asserted as a number, so a licensing
    // change moves this with it.
    const licensed = Object.keys(EVIDENCE_KINDS)
      .filter((k) => permissionsFor(k).OUTREACH !== PERMISSION.DENIED);
    expect([...LICENSED_KINDS].sort()).toEqual(licensed.sort());
  });

  it('offers no per-kind token to templates', () => {
    // A template may insert the engine's paragraph. It may not pick a kind.
    const offered = TEMPLATE_VARIABLES.map((v) => v.token.toLowerCase());
    for (const kind of Object.keys(EVIDENCE_KINDS)) {
      expect(offered, kind).not.toContain(kind.toLowerCase());
    }
  });

  it('exposes a small, fixed evidence interface', () => {
    const evidenceTokens = TEMPLATE_VARIABLES.map((v) => v.token).filter((t) => t.includes('evidence'));
    expect(evidenceTokens.sort()).toEqual(
      ['evidence_paragraph', 'evidence_primary', 'evidence_structure', 'has_evidence', 'has_evidence_primary'].sort(),
    );
  });
});

/**
 * THE J3 AND J4 DECISIONS, PROVED UNREACHABLE FROM A TEMPLATE.
 *
 * Both stages withheld a claim that is true. If a template could restate it,
 * neither decision would mean anything.
 */
describe('a custom template cannot resurrect a withheld claim', () => {
  const D = {
    ARRIVAL_SAME_COUNTRY_POSITION: { country: 'New Zealand', position: 'defender', count: 1, seasons: ['2025'], name: 'Harrison Dudley', nameSeason: '2025' },
    POSITION_GRADUATION: { position: 'defender', count: 2, names: ['A Smith', 'B Jones'], classYear: 2027 },
    HISTORICAL_SAME_REGION: { countries: ['Australia'], count: 2, names: ['Tom Blake'], athleteCountry: 'New Zealand' },
  };
  const result = (...kinds) => outreachEvidenceFor({
    all: kinds.map((k) => ({ kind: k, data: D[k], confidence: 'HIGH' })),
  });

  it('POSITION_GRADUATION held by POSITION_FLOW_HOLD stays out of the body', () => {
    const r = result('ARRIVAL_SAME_COUNTRY_POSITION', 'POSITION_GRADUATION');
    // The engine withheld it — J4's cross-group rule.
    expect([...r.hooks, ...r.relevance].map((i) => i.kind)).not.toContain('POSITION_GRADUATION');
    expect((r.dispositions ?? []).find((d) => d.kind === 'POSITION_GRADUATION')?.disposition).toBe('HELD');
    // And no token can put it back.
    const ctx = buildEmailContext(player, richCollege, 'Coach');
    const attempt = '{{#if has_graduating_seniors}}{{graduating_seniors_count}} {{graduating_seniors_position}} '
      + 'graduating {{graduating_seniors_names}}{{/if}}';
    expect(fillTemplate(attempt, ctx)).toBe('');
  });

  it('HISTORICAL_SAME_REGION denied at J3 cannot be restated', () => {
    expect(permissionsFor('HISTORICAL_SAME_REGION').OUTREACH).toBe(PERMISSION.DENIED);
    const r = result('HISTORICAL_SAME_REGION');
    expect([...r.hooks, ...r.relevance, ...r.recognition]).toHaveLength(0);
    const ctx = buildEmailContext(player, richCollege, 'Coach');
    const attempt = '{{#if has_players_from_country}}{{players_from_country_count}} from the region{{/if}}'
      + '{{#if has_international_players}}{{international_players_count}} internationals{{/if}}';
    expect(fillTemplate(attempt, ctx)).toBe('');
  });
});

describe('a composition failure degrades to raw facts, not a second engine', () => {
  /**
   * `emailBodyFor` falls back to the scaffold when there is no composition —
   * an evidence lookup that threw, or a structure that produced nothing. That
   * path must not become the place a claim gets made.
   */
  it('renders the scaffold with no evidence and no claim', () => {
    const out = emailBodyFor(player, richCollege, 'Coach', { evidence: null });
    expect(out.source).toBe(BODY_SOURCE.TEMPLATE);
    expect(out.body).toContain('Rhys Davies');
    for (const claim of ['graduating', 'conference', 'postseason', 'internationals']) {
      expect(out.body.toLowerCase(), claim).not.toContain(claim);
    }
    expect(unresolvedTokens(out.template, out.context)).toEqual([]);
  });

  it('renders the scaffold cleanly when evidence exists but composed nothing', () => {
    const out = emailBodyFor(player, richCollege, 'Coach', {
      profileUrl: 'https://x/p',
      evidence: { selected: [], sentences: [], paragraph: '', composition: null },
    });
    expect(out.source).toBe(BODY_SOURCE.TEMPLATE);
    expect(out.body).not.toMatch(/\{\{/);
    expect(out.body).not.toMatch(/\n{3,}/);
  });
});

describe('history keeps its words', () => {
  it('retains DEFAULT_EVIDENCE_FIRST although nothing can produce it', () => {
    /**
     * J5 made a saved template an override whatever it says, so "byte-identical
     * to the default" is no longer a state anything can be in — a template
     * matching the default classifies as CUSTOM_EVIDENCE like any other.
     *
     * The value stays in the enum because real `outreach_evidence` and
     * `outreach_send` rows carry it. I2's model is that those rows say what
     * happened; deleting the word would leave stored data referring to a state
     * this build cannot name.
     */
    expect(TEMPLATE_VARIANTS.DEFAULT_EVIDENCE_FIRST).toBe('DEFAULT_EVIDENCE_FIRST');
    expect(Object.values(TEMPLATE_VARIANTS)).toContain('DEFAULT_EVIDENCE_FIRST');
  });

  it('never produces it for a new send', () => {
    expect(templateVariant(DEFAULT_EMAIL_TEMPLATE)).toBe(TEMPLATE_VARIANTS.CUSTOM_EVIDENCE);
    expect(templateVariant('')).toBe(TEMPLATE_VARIANTS.UNKNOWN);
    expect(templateVariant('Hi, no evidence here.')).toBe(TEMPLATE_VARIANTS.CUSTOM_NO_EVIDENCE);
    // And it no longer takes a default to compare against.
    expect(templateVariant.length).toBe(1);
  });
});
