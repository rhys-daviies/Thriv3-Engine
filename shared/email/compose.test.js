import { describe, it, expect } from 'vitest';
import { BLOCK_COPY, fragmentFor, slotToken, SLOT_TOKENS } from './blocks.js';
import { composeOutreach, structuredTemplate } from './compose.js';
import { BLOCKS, FLOWS, FLOW_KEYS } from '../evidence/structures.js';
import { outreachEvidenceFor } from '../evidence/outreachEvidence.js';
import { defineEvidence, CONFIDENCE } from '../evidence/kinds.js';
import { renderEvidence } from '../evidence/render.js';
import {
  DEFAULT_EMAIL_TEMPLATE, fillTemplate, buildEmailContext, emailBodyFor,
  canComposeStructured, BODY_SOURCE, unresolvedTokens, structureKeyOf,
  TEMPLATE_VARIABLES,
} from '../../src/lib/emailTemplate.js';

const flow = (key, over = {}) => ({ key, ...FLOWS[key], ...over });

/**
 * Real evidence objects, composed the way production composes them.
 *
 * These tests used to drive `composeStructured` and `evidenceSlots` — a second
 * composer that G4 replaced and that no production caller has reached since.
 * The properties they defended are real and are kept; what changed is the
 * function under test. Going through `outreachEvidenceFor` rather than
 * hand-building role items means the licence, the qualification rules, the
 * projection and the outbound copy are all exercised on the way, which is what
 * the composer actually sits on top of.
 */
const ev = (kind, data) => defineEvidence(kind, {
  source: 'roster_players', confidence: CONFIDENCE.HIGH, season: '2022-2025', data,
});

const NZ = () => ev('HISTORICAL_SAME_COUNTRY', { country: 'New Zealand', count: 2, names: ['A', 'B'], seasons: ['2022'] });
const GRAD = () => ev('POSITION_GRADUATION', { position: 'DEFENSE', count: 3, names: ['P', 'Q', 'R'], classYear: 2027 });
const ACAD = () => ev('ACADEMIC_FIT', { stated: 'exercise science', major: 'Kinesiology' });
const TITLE = () => ev('CONFERENCE_TITLE', { conference: 'ACC' });

/** The production composer, given real evidence. */
const compose = (key, items, ctx = { firstName: 'Rhys' }) => composeOutreach(
  flow(key), outreachEvidenceFor({ all: items }), new Map(items.map((e) => [e.kind, e])), ctx,
);

const player = {
  full_name: 'Rhys Davies',
  position: 'DEFENSE',
  nationality: 'New Zealand',
  recruiting_class_year: 2027,
  gpa: 3.6,
  intended_major: 'exercise science',
  email_template: null,
};

const college = { name: 'Example University', division: 'NCAA D1', notable_majors: ['Kinesiology'] };

// ---------------------------------------------------------------------------

/**
 * The block library and the legacy template are now DIFFERENT on purpose.
 *
 * They used to be identical, with a test asserting the block copy appeared
 * verbatim in DEFAULT_EMAIL_TEMPLATE. That guard is replaced rather than
 * deleted: the copy here has been rewritten into one first-person voice and
 * the legacy template deliberately has not, because `templateVariant` compares
 * saved templates against it byte for byte — editing it would reclassify every
 * athlete's saved template as customised and silently switch structured
 * composition off for all of them.
 *
 * So what has to be guarded is no longer sameness. It is that the legacy
 * template stays frozen, and that the athletes on it still compose
 * structurally.
 */
describe('the block library and the frozen legacy template', () => {
  it('keeps the legacy template on the tokens it has always used', () => {
    /**
     * Both pilot athletes used to carry this exact string in
     * `players.email_template`, and `canComposeStructured` recognised it by
     * comparison. J5 ended that: a saved template is now an override whatever
     * it says, the two copies were archived, and the constant is a scaffold
     * for the editor rather than the authority over composition.
     */
    expect(DEFAULT_EMAIL_TEMPLATE).toContain('{{#if has_evidence}}');
    expect(DEFAULT_EMAIL_TEMPLATE).toContain('{{evidence_paragraph}}');
    expect(canComposeStructured({ email_template: DEFAULT_EMAIL_TEMPLATE })).toBe(false);
  });

  it('has rewritten the blocks away from it', () => {
    // Stated as an expectation so nobody "fixes" the divergence by pasting the
    // old sentences back in.
    expect(DEFAULT_EMAIL_TEMPLATE).not.toContain(BLOCK_COPY[BLOCKS.CTA].default);
    /**
     * The scaffold has caught up with the blocks rather than the other way
     * round. It used to carry "We believe X could be an interesting fit" —
     * a suitability claim the outreach copy contract forbids — which is why
     * the block library never had an equivalent. J6 removed it from the
     * scaffold too, so neither says it now.
     */
    expect(DEFAULT_EMAIL_TEMPLATE).not.toContain('We believe');
    expect(BLOCKS.FIT).toBeUndefined();
    expect(Object.keys(BLOCK_COPY)).not.toContain('FIT');
  });

  /**
   * The phrases the rewrite exists to remove. Asserted against the whole block
   * library, so a future edit cannot reintroduce one quietly.
   *
   * "your needs" is the one that matters most: it is a claim about the coach's
   * squad that nothing in our data supports, and it sat in the closing line of
   * every email the system sent.
   */
  it.each([
    'We believe', "we'd love", 'your needs', 'potential fit', 'interesting fit',
    'aligns with', 'demonstrates', 'presents an opportunity', 'roster composition',
    'positional need', 'our data indicates',
  ])('never says %s', (phrase) => {
    const all = Object.values(BLOCK_COPY)
      .flatMap((variants) => Object.values(variants)).join(' \n ');
    expect(all.toLowerCase()).not.toContain(phrase.toLowerCase());
  });

  it('renders an evidence block as its slot token and nothing else', () => {
    expect(fragmentFor(BLOCKS.HOOK)).toBe('{{evidence_hook}}');
  });

  it('falls back to the default variant rather than rendering nothing', () => {
    expect(fragmentFor(BLOCKS.GREETING, 'does-not-exist'))
      .toBe(BLOCK_COPY[BLOCKS.GREETING].default);
  });

  it('gives every block a default variant', () => {
    for (const [block, copy] of Object.entries(BLOCK_COPY)) {
      expect(copy.default, block).toBeTruthy();
    }
  });

  /**
   * No pronoun for the athlete, anywhere. `players` stores no gender or
   * pronoun field, and inferring one from the sport would be a guess about a
   * real person that is wrong for anyone it is wrong for.
   */
  it('never uses a third-person pronoun for the athlete', () => {
    const all = Object.values(BLOCK_COPY).flatMap((v) => Object.values(v)).join(' ');
    expect(all).not.toMatch(/\b(he|him|his|she|her|hers)\b/i);
  });
});

describe('every structure assembles into a whole email', () => {
  const three = [NZ(), GRAD(), ACAD()];

  it.each(FLOW_KEYS)('%s greets, introduces, links and signs off', (key) => {
    const { template } = compose(key, three);
    const body = fillTemplate(template, buildEmailContext(player, college, 'Coach Smith', {
      profileUrl: 'https://example.test/p/x',
    }));

    expect(body).toMatch(/^Hi Coach Smith,/);
    expect(body).toContain('Rhys Davies');
    expect(body).toContain('https://example.test/p/x');
    expect(body.trimEnd().endsWith('Striv3 Elite Sports Management')).toBe(true);
  });

  it.each(FLOW_KEYS)('%s records every selected claim, rendered or held', (key) => {
    /**
     * SELECTED IS NOT RENDERED. The licence permits three body claims and the
     * email carries at most two — one hook and one relevance — so the third is
     * recorded with `slot: null` and `displayed: false` rather than dropped.
     * The panel and the log both read this, and neither may imply a coach read
     * something they did not.
     */
    const { placement } = compose(key, three);
    expect(placement.map((p) => p.kind).sort()).toEqual(three.map((s) => s.kind).sort());
    const shown = placement.filter((p) => p.displayed);
    expect(shown.length).toBeGreaterThan(0);
    for (const p of shown) {
      expect([BLOCKS.HOOK, BLOCKS.RELEVANCE, BLOCKS.RECOGNITION]).toContain(p.slot);
    }
    for (const p of placement.filter((x) => !x.displayed)) expect(p.slot).toBeNull();
  });

  it.each(FLOW_KEYS)('%s leaves no unresolved token', (key) => {
    const { template, tokens } = compose(key, three);
    const context = { ...buildEmailContext(player, college, 'Coach', {}), ...tokens };
    expect(unresolvedTokens(template, context)).toEqual([]);
  });

  it('produces a different email for each structure', () => {
    const bodies = FLOW_KEYS.map((key) => compose(key, three).template);
    expect(new Set(bodies).size).toBe(FLOW_KEYS.length);
  });
});

describe('graceful degradation', () => {
  const one = [TITLE()];

  it.each(FLOW_KEYS)('%s with one item leaves no empty paragraph', (key) => {
    const { template, tokens } = compose(key, one);
    const body = fillTemplate(template, {
      // A profileUrl is supplied because without one `player_profile_url`
      // deliberately resolves to its own token — the real link carries the
      // coach's tracking id and only the server knows it.
      ...buildEmailContext(player, college, 'Coach', { profileUrl: 'https://example.test/p/x' }),
      ...tokens,
    });
    expect(body).not.toMatch(/\n\n\n/);
    expect(body).not.toContain('{{');
    expect(body).toContain('Congrats on winning the ACC last year');
  });

  it.each(FLOW_KEYS)('%s with no evidence drops its evidence blocks entirely', (key) => {
    const { template, placement } = compose(key, []);
    expect(placement).toEqual([]);
    for (const token of SLOT_TOKENS) expect(template).not.toContain(`{{${token}}}`);
    // Still a complete email, not a stub.
    expect(template).toContain(BLOCK_COPY[BLOCKS.GREETING].default);
    expect(template).toContain(BLOCK_COPY[BLOCKS.SIGNOFF].default);
  });

  it('never leaves a slot token in a body when a structure could not fill it', () => {
    // The failure this guards: `fillTemplate` leaves an UNKNOWN token exactly
    // as written, so a slot defined by a structure and absent from the context
    // would reach a coach as the literal text "{{evidence_relevance}}".
    const context = buildEmailContext(player, college, 'Coach', {});
    for (const token of SLOT_TOKENS) expect(context).toHaveProperty(token);
  });
});

describe('placement into blocks', () => {
  it('fills the hook, then one relevance paragraph, then holds the rest', () => {
    const { placement } = compose('RELATIONSHIP_FIRST', [NZ(), GRAD(), ACAD()]);
    expect(placement[0].slot).toBe(BLOCKS.HOOK);
    expect(placement[1].slot).toBe(BLOCKS.RELEVANCE);
    // One relevance claim, not two. A first approach that lists everything
    // true about a programme reads as a report however well each line is
    // written.
    expect(placement[2].slot).toBeNull();
    expect(placement[2].displayed).toBe(false);
  });

  it('has no hook block in the player-first flow', () => {
    const { tokens, placement } = compose('PLAYER_FIRST', [NZ(), GRAD()]);
    expect(tokens.evidence_hook).toBeUndefined();
    expect(placement.every((p) => p.slot !== BLOCKS.HOOK)).toBe(true);
  });

  it('drops a block from the template when its paragraph is empty', () => {
    const template = structuredTemplate(flow('RELATIONSHIP_FIRST'), {
      evidence_hook: 'Something true.',
    });
    expect(template).toContain('{{evidence_hook}}');
    expect(template).not.toContain('{{evidence_relevance}}');
    expect(template).not.toContain('{{evidence_recognition}}');
  });
});

describe('which route composes the body', () => {
  it('assembles from the structure when there is no saved template', () => {
    // Presence, not content — see src/lib/compositionAuthority.test.js.
    expect(canComposeStructured({ ...player, email_template: null })).toBe(true);
    expect(canComposeStructured({ ...player, email_template: '   ' })).toBe(true);
    expect(canComposeStructured({ ...player, email_template: DEFAULT_EMAIL_TEMPLATE })).toBe(false);
  });

  it('leaves a customised template alone', () => {
    expect(canComposeStructured({ ...player, email_template: 'Hi {{coach_name}}, hello.' }))
      .toBe(false);
  });

  it('renders a customised template rather than a structure', () => {
    const custom = 'Hi {{coach_name}}. {{#if has_evidence}}{{evidence_paragraph}}{{/if}} Bye.';
    const evidence = {
      structure: { key: 'PLAYER_FIRST' },
      selected: [],
      paragraph: 'Something true.',
      composition: compose('PLAYER_FIRST', [NZ()], { firstName: 'Rhys' }),
    };
    const out = emailBodyFor({ ...player, email_template: custom }, college, 'Coach', { evidence });
    expect(out.source).toBe(BODY_SOURCE.TEMPLATE);
    expect(out.body).toBe('Hi Coach. Something true. Bye.');
  });

  it('falls back to the template when there is no composition to use', () => {
    const out = emailBodyFor(player, college, 'Coach', { evidence: null });
    expect(out.source).toBe(BODY_SOURCE.TEMPLATE);
    expect(out.body).toContain('Hi Coach,');
  });

  it('uses the structure when one is available', () => {
    const evidence = {
      structure: { key: 'PLAYER_FIRST' },
      selected: [],
      paragraph: '',
      composition: compose('PLAYER_FIRST', [ACAD()], { firstName: 'Rhys', academicIntro: true }),
    };
    const out = emailBodyFor(player, college, 'Coach', { evidence });
    expect(out.source).toBe(BODY_SOURCE.STRUCTURED);
    expect(out.structure).toBe('PLAYER_FIRST');
    /**
     * Two different things, said once each.
     *
     * The athlete typed "exercise science"; the college publishes
     * "Kinesiology". The introduction must carry the ATHLETE's words and the
     * evidence clause the COLLEGE's, which is both the honest attribution and
     * the reason the two sentences no longer echo.
     */
    expect(out.body).toContain('planning to study Exercise Science');
    // The evidence clause names both since G4, in one sentence, so a coach
    // reads a match rather than two unrelated subjects four lines apart.
    expect(out.body).toContain('Kinesiology is among the programmes you list');
    expect(out.body).not.toMatch(/Kinesiology[\s\S]*Kinesiology/);
  });
});

/**
 * The evidence result reaches this file in two shapes.
 *
 * `selectEvidence` returns `structure` as an object; `toWire` flattens it to
 * the key before sending it to the browser. Reading `.key` off a string is
 * silently undefined, which is what made the bulk preview show no structure
 * name beside a body that was plainly assembled from one.
 */
describe('the structure key, in either shape it arrives in', () => {
  const composition = compose('PLAYER_FIRST', [ACAD()], { firstName: 'Rhys', academicIntro: true });

  it('reads the object form the engine returns', () => {
    expect(structureKeyOf({ structure: { key: 'ACADEMIC_FIT', label: 'Academic fit' } }))
      .toBe('ACADEMIC_FIT');
  });

  it('reads the flattened form the wire sends', () => {
    expect(structureKeyOf({ structure: 'ACADEMIC_FIT' })).toBe('ACADEMIC_FIT');
  });

  it('is null when there is none, rather than undefined', () => {
    expect(structureKeyOf(null)).toBeNull();
    expect(structureKeyOf({})).toBeNull();
  });

  it.each([
    ['engine', { key: 'PLAYER_FIRST' }],
    ['wire', 'PLAYER_FIRST'],
  ])('reports the structure it composed from the %s form', (_label, structureField) => {
    const out = emailBodyFor(player, college, 'Coach', {
      evidence: { structure: structureField, selected: [], paragraph: '', composition },
    });
    expect(out.source).toBe(BODY_SOURCE.STRUCTURED);
    expect(out.structure).toBe('PLAYER_FIRST');
    expect(out.context.evidence_structure).toBe('PLAYER_FIRST');
  });
});

/**
 * The display cap.
 *
 * Selection may keep four pieces of evidence — they are worth logging and
 * worth showing an operator — but an email carrying all four reads as a list.
 * A four-evidence draft to Calvin produced "I also noticed you offer
 * Kinesiology, and you've got one defender graduating, and …", which is the
 * sentence this cap exists to prevent.
 */
describe('the filler fit line is gone', () => {
  it.each(FLOW_KEYS)('%s does not claim a fit in its own sentence', (key) => {
    const { template } = compose(key, [NZ(), GRAD()]);
    const body = fillTemplate(template, buildEmailContext(player, college, 'Coach', {
      profileUrl: 'https://example.test/p/x',
    }));
    expect(body).not.toMatch(/could suit .* well/);
    expect(body).not.toMatch(/interesting fit|potential fit|We believe/i);
  });
});

/**
 * INTERNATIONAL_ROSTER is OUTREACH DENIED since G4 — a squad's international
 * count says nothing about this athlete — so it can no longer reach a composed
 * email at all. Its wording still exists for the surfaces that may show it,
 * and is exercised through the renderer directly rather than through a
 * composer that would now refuse it.
 */
describe('large international counts stop being counted', () => {
  const roster = (count) => renderEvidence(defineEvidence('INTERNATIONAL_ROSTER', {
    source: 'roster_players', confidence: CONFIDENCE.HIGH, season: '2026',
    data: { count, uniqueCountries: 3, countries: ['Spain', 'Brazil', 'Japan'] },
  }));

  it('states a small count, which a coach recognises as their own squad', () => {
    expect(roster(6)).toContain('six internationals');
  });

  it('goes qualitative once the number is only a readout', () => {
    const text = roster(19);
    expect(text).not.toMatch(/\b19\b|nineteen/);
    expect(text).toMatch(/pretty international/);
  });
});

/**
 * Every structure completes its programme-specific reasoning before asking the
 * coach to click anything.
 *
 * ROSTER_OPPORTUNITY and PLAYER_FIRST both had a profile link followed by a
 * fresh observation and then the ask. It read as an afterthought, and worse
 * once the observation was conversational.
 */
describe('no structure puts an observation after the profile link', () => {
  it.each(FLOW_KEYS)('%s places every evidence block before PROFILE', (key) => {
    // Blocks are plain names now — a flow is an ordered list, not a list of
    // entries with options, because placement moved into planPlacement.
    const blocks = FLOWS[key].blocks;
    const profileAt = blocks.indexOf('PROFILE');
    const lastEvidenceAt = Math.max(
      blocks.indexOf('HOOK'), blocks.indexOf('RELEVANCE'), blocks.indexOf('RECOGNITION'),
    );
    expect(profileAt, `${key} must have a profile link`).toBeGreaterThan(-1);
    expect(lastEvidenceAt, `${key} puts evidence after the profile link`).toBeLessThan(profileAt);
  });
});

/**
 * The ask assumes nothing about what the coach is looking for.
 *
 * "Given your current roster and X's needs" was the first version of this
 * mistake; "If you're looking at defenders for 2027" was the second, in a
 * politer register that made it easy to miss. Both condition the ask on a
 * recruiting intention we have no evidence for — the first by asserting it,
 * the second by guessing at it and giving the coach a reason not to answer.
 *
 * Scanned across the whole block library rather than the CTA alone, because
 * the phrasing could reappear anywhere the copy addresses the coach directly.
 */
describe('no block assumes what the coach wants', () => {
  const allCopy = () => Object.entries(BLOCK_COPY)
    .flatMap(([block, variants]) => Object.entries(variants).map(([v, text]) => [`${block}.${v}`, text]));

  const FORBIDDEN = [
    /\bif you'?re looking\b/i,
    /\bif you need\b/i,
    /\bif you'?re recruiting\b/i,
    /\bif you'?re after\b/i,
    /\bif you'?re in the market\b/i,
    /\byour needs?\b/i,
    /\byou'?ll need\b/i,
    /\bwhat you'?re looking for\b/i,
    /\bgap in your\b/i,
  ];

  it.each(allCopy())('%s conditions nothing on an unknown recruiting need', (where, text) => {
    for (const pattern of FORBIDDEN) {
      expect(text, `${where}: "${text}"`).not.toMatch(pattern);
    }
  });

  it('states the ask plainly', () => {
    expect(BLOCK_COPY[BLOCKS.CTA].default)
      .toContain('Would be great to hear your thoughts on {{player_first_name}}');
    expect(BLOCK_COPY[BLOCKS.CTA].default).toContain('your {{player_class_year}} group');
  });

  it('offers one CTA, so no structure can reach a conditional variant', () => {
    expect(Object.keys(BLOCK_COPY[BLOCKS.CTA])).toEqual(['default']);
    for (const key of FLOW_KEYS) {
      expect(FLOWS[key].blocks, `${key} must ask for something`).toContain(BLOCKS.CTA);
    }
  });
});

/**
 * The composed paragraphs, read as a reader meets them.
 *
 * Placement is the thing that changed, so these assert the SHAPE of the
 * output rather than individual sentences: one reasoning sentence per email,
 * one gathering lead-in per paragraph, and the congratulation on its own.
 */
describe('the credentials block', () => {
  const bodyFor = (p) => emailBodyFor(p, college, 'Ali Simmons', {
    evidence: {
      selected: [ACAD()],
      structure: flow('PLAYER_FIRST'),
      composition: compose('PLAYER_FIRST', [ACAD()]),
    },
  }).body;

  const withBudget = { ...player, sat_score: 1210, budget_range: '$5k-$10k/yr' };

  it('never renders a budget, even when one is set', () => {
    const body = bodyFor(withBudget);
    expect(body).not.toMatch(/budget/i);
    expect(body).not.toContain('$5k-$10k/yr');
  });

  /**
   * Two lines since J4, not four.
   *
   * The block used to open with "• Position: Defender / • Graduation: 2027",
   * two lines after the introduction had already said "a defender … looking at
   * options for the 2027 class". Position and class year belong to the
   * introduction, which says them in prose; what is left here is what the
   * introduction does not carry.
   */
  it('renders the academic facts, and only those', () => {
    const bullets = bodyFor(withBudget).split('\n').filter((l) => l.startsWith('•'));
    expect(bullets).toEqual(['• GPA: 3.6', '• SAT: 1210']);
    // And the facts it stopped repeating are still in the email, once.
    const body = bodyFor(withBudget);
    expect(body).toContain('a defender');
    expect(body).toContain('2027 class');
  });

  /**
   * The omission behaviour the block already had, re-asserted because the
   * conditionals were re-chained when the budget line came out: each one opens
   * at the END of the preceding line, so a missing value takes its own newline
   * with it rather than leaving "• SAT:" with nothing after it.
   */
  it('omits a missing SAT cleanly, leaving no empty label', () => {
    const bullets = bodyFor({ ...player, budget_range: '$5k-$10k/yr' })
      .split('\n').filter((l) => l.startsWith('•'));
    expect(bullets).toEqual(['• GPA: 3.6']);
  });

  it('omits a missing GPA cleanly and keeps the SAT', () => {
    const bullets = bodyFor({ ...player, gpa: null, sat_score: 1210 })
      .split('\n').filter((l) => l.startsWith('•'));
    expect(bullets).toEqual(['• SAT: 1210']);
  });

  /**
   * Half the corpus. With no GPA and no test score the block used to be
   * nothing but the two repeated facts; now it resolves to nothing and the
   * email simply does not have a bullet list.
   */
  it('disappears entirely when no academic fact is on file', () => {
    const body = bodyFor({ ...player, gpa: null });
    expect(body.split('\n').filter((l) => l.startsWith('•'))).toEqual([]);
    // The athlete is still fully introduced.
    expect(body).toContain('a defender');
    expect(body).toContain('2027 class');
    expect(body).not.toMatch(/\n{3,}/);
  });

  /** Budget stays available to anything that is not the outreach body. */
  it('keeps the budget token registered for matching and for saved templates', () => {
    expect(TEMPLATE_VARIABLES.map((t) => t.token)).toContain('player_yearly_budget');
    const ctx = buildEmailContext(withBudget, college, 'Ali Simmons');
    expect(ctx.player_yearly_budget).toBe('$5k-$10k/yr');
    expect(ctx.has_yearly_budget).toBe('true');
  });
});
