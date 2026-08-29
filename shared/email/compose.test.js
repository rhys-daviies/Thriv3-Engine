import { describe, it, expect } from 'vitest';
import { BLOCK_COPY, fragmentFor, slotToken, SLOT_TOKENS } from './blocks.js';
import {
  composeStructured, evidenceSlots, structuredTemplate, paragraphFor,
} from './compose.js';
import { BLOCKS, FLOWS, FLOW_KEYS, MAX_GATHERED } from '../evidence/structures.js';
import {
  DEFAULT_EMAIL_TEMPLATE, fillTemplate, buildEmailContext, emailBodyFor,
  canComposeStructured, BODY_SOURCE, unresolvedTokens, structureKeyOf,
} from '../../src/lib/emailTemplate.js';

const flow = (key, over = {}) => ({ key, ...FLOWS[key], ...over });

/**
 * A minimal evidence object.
 *
 * Composition renders its own sentences now, because the SLOT decides which of
 * the two variants a kind uses — so it needs evidence rather than prose. These
 * carry only what the renderers read.
 */
const ev = (kind, data = {}, tier = 'FACT') => ({ kind, tier, data, season: '2022-2025' });

const NZ = () => ev('HISTORICAL_SAME_COUNTRY', { country: 'New Zealand', count: 2, names: ['A', 'B'] });
const GRAD = () => ev('POSITION_GRADUATION', { position: 'DEFENSE', count: 3, names: [], classYear: 2027 });
const ACAD = () => ev('ACADEMIC_FIT', { major: 'Kinesiology' });
const TITLE = () => ev('CONFERENCE_TITLE', { conference: 'ACC' });

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
    // The exact string both pilot athletes carry in `players.email_template`.
    // If this fails, `canComposeStructured` has stopped recognising their
    // saved template and every draft has quietly reverted to the old shape.
    expect(DEFAULT_EMAIL_TEMPLATE).toContain('{{#if has_evidence}}');
    expect(DEFAULT_EMAIL_TEMPLATE).toContain('{{evidence_paragraph}}');
    expect(canComposeStructured({ email_template: DEFAULT_EMAIL_TEMPLATE })).toBe(true);
  });

  it('has rewritten the blocks away from it', () => {
    // Stated as an expectation so nobody "fixes" the divergence by pasting the
    // old sentences back in.
    expect(DEFAULT_EMAIL_TEMPLATE).not.toContain(BLOCK_COPY[BLOCKS.CTA].default);
    // The legacy template still carries the sentence the rewrite removed; the
    // block library has no equivalent block at all any more.
    expect(DEFAULT_EMAIL_TEMPLATE).toContain('We believe');
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
    const { template } = composeStructured(flow(key), three);
    const body = fillTemplate(template, buildEmailContext(player, college, 'Coach Smith', {
      profileUrl: 'https://example.test/p/x',
    }));

    expect(body).toMatch(/^Hi Coach Smith,/);
    expect(body).toContain('Rhys Davies');
    expect(body).toContain('https://example.test/p/x');
    expect(body.trimEnd().endsWith('Striv3 Elite Sports Management')).toBe(true);
  });

  it.each(FLOW_KEYS)('%s places every selected claim somewhere', (key) => {
    const { placement } = composeStructured(flow(key), three);
    expect(placement.map((p) => p.kind)).toEqual(three.map((s) => s.kind));
    for (const p of placement) expect([BLOCKS.HOOK, BLOCKS.RELEVANCE, BLOCKS.RECOGNITION]).toContain(p.slot);
  });

  it.each(FLOW_KEYS)('%s leaves no unresolved token', (key) => {
    const { template, tokens } = composeStructured(flow(key), three);
    const context = { ...buildEmailContext(player, college, 'Coach', {}), ...tokens };
    expect(unresolvedTokens(template, context)).toEqual([]);
  });

  it('produces a different email for each structure', () => {
    const bodies = FLOW_KEYS.map((key) => composeStructured(flow(key), three).template);
    expect(new Set(bodies).size).toBe(FLOW_KEYS.length);
  });
});

describe('graceful degradation', () => {
  const one = [TITLE()];

  it.each(FLOW_KEYS)('%s with one item leaves no empty paragraph', (key) => {
    const { template, tokens } = composeStructured(flow(key), one);
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
    const { template, placement } = composeStructured(flow(key), []);
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

describe('the single-paragraph form, for customised templates', () => {
  it('states the opening observation with its reasoning', () => {
    expect(paragraphFor([NZ()], { firstName: 'Rhys' }))
      .toMatch(/^I saw you've had .*, so I thought you might be open to another Kiwi\.$/);
  });

  /**
   * One lead-in for the group. Three sentences each opening "I noticed" is the
   * failure conversational copy creates, and it reads worse than the database
   * prose it replaced.
   */
  it('gathers the rest under a single lead-in', () => {
    const out = paragraphFor([NZ(), GRAD(), ACAD()], { firstName: 'Rhys' });
    expect(out.match(/I also noticed/g)).toHaveLength(1);
    expect(out).toContain(', and ');
  });

  it('puts a congratulation in its own sentence, never inside a clause', () => {
    const out = paragraphFor([GRAD(), TITLE()], { firstName: 'Rhys' });
    expect(out).toMatch(/Congrats on winning the ACC last year as well/);
    expect(out).not.toMatch(/and congrats/i);
  });

  it('is empty when there is nothing to say', () => {
    expect(paragraphFor([], {})).toBe('');
  });
});

describe('placement into blocks', () => {
  it('fills the hook, then the relevance paragraph', () => {
    const { placement } = evidenceSlots(flow('RELATIONSHIP_FIRST'),
      [NZ(), GRAD(), ACAD()], { firstName: 'Rhys' });
    expect(placement[0].slot).toBe(BLOCKS.HOOK);
    expect(placement[1].slot).toBe(BLOCKS.RELEVANCE);
    expect(placement[2].slot).toBe(BLOCKS.RELEVANCE);
  });

  it('has no hook block in the player-first flow', () => {
    const { tokens, placement } = evidenceSlots(flow('PLAYER_FIRST'),
      [NZ(), GRAD()], { firstName: 'Rhys' });
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
  it('assembles from the structure when the template is the default', () => {
    expect(canComposeStructured({ ...player, email_template: DEFAULT_EMAIL_TEMPLATE })).toBe(true);
    expect(canComposeStructured({ ...player, email_template: null })).toBe(true);
    expect(canComposeStructured({ ...player, email_template: '   ' })).toBe(true);
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
      composition: composeStructured(flow('PLAYER_FIRST'), [NZ()], { firstName: 'Rhys' }),
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
      composition: composeStructured(flow('PLAYER_FIRST'), [ACAD()],
        { firstName: 'Rhys', academicIntro: true }),
    };
    const out = emailBodyFor(player, college, 'Coach', { evidence });
    expect(out.source).toBe(BODY_SOURCE.STRUCTURED);
    expect(out.structure).toBe('PLAYER_FIRST');
    // The academic intro variant carries the subject into the introduction
    // rather than restating it as a second sentence.
    expect(out.body).toContain('planning to study Kinesiology');
    // The support clause drops its explanation inside this structure — the
    // introduction has already said what Rhys wants to study.
    expect(out.body).toContain('you offer Kinesiology');
    expect(out.body).not.toMatch(/Kinesiology[\s\S]*Kinesiology[\s\S]*Kinesiology/);
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
  const composition = composeStructured(flow('PLAYER_FIRST'), [ACAD()],
    { firstName: 'Rhys', academicIntro: true });

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
describe('an email displays at most two gathered clauses per paragraph', () => {
  const four = () => [
    NZ(),
    GRAD(),
    ACAD(),
    ev('SQUAD_GRADUATION', { total: 7, classYear: 2027 }),
  ];

  it('caps a single-slot structure and holds the rest back', () => {
    // PLAYER_FIRST has one evidence block: the opener plus two gathered is the
    // most it can carry, so the fourth is selected and not displayed.
    const { placement, tokens } = composeStructured(
      flow('PLAYER_FIRST'), four(), { firstName: 'Rhys' },
    );
    const shown = placement.filter((p) => p.displayed);
    const held = placement.filter((p) => !p.displayed);

    expect(shown).toHaveLength(3);
    expect(held).toHaveLength(1);
    expect(held[0].slot).toBeNull();
    // One lead-in, two clauses under it — never three.
    const para = Object.values(tokens).join(' ');
    expect(para.match(/, and /g) ?? []).toHaveLength(1);
  });

  it('spills into a later slot, and still caps that slot', () => {
    // INTERNATIONAL_CONNECTION has LEAD and SUPPORT. The opener takes one and
    // SUPPORT gathers two, so a fourth has nowhere left to go that would read
    // well — held back rather than forced into a third clause.
    const { placement } = composeStructured(
      flow('RELATIONSHIP_FIRST'), four(), { firstName: 'Rhys' },
    );
    expect(placement.filter((p) => p.displayed)).toHaveLength(3);
    expect(placement.filter((p) => !p.displayed)).toHaveLength(1);
    // The spill is real: the second and third items are in the SUPPORT slot,
    // not crammed into the opener.
    expect(placement.filter((p) => p.slot === 'RELEVANCE')).toHaveLength(2);
  });

  it('does not count the opener or a congratulation against the cap', () => {
    // Opener + congratulation + two gathered: four displayed in one block,
    // because only two of them are gathered into a single lead-in.
    const items = [GRAD(), TITLE(), ACAD(), ev('INTERNATIONAL_ROSTER', { count: 6, uniqueCountries: 2 })];
    const { placement, tokens } = composeStructured(
      flow('PLAYER_FIRST'), items, { firstName: 'Rhys' },
    );
    expect(placement.filter((p) => p.displayed)).toHaveLength(4);
    // ONE gathering lead-in. The opener's own "I noticed" is not one of them —
    // it is a sentence stating why we wrote, which is what the lead form is.
    expect(Object.values(tokens).join(' ').match(/I also noticed/g)).toHaveLength(1);
  });

  it('reports the cap it enforced', () => {
    expect(MAX_GATHERED).toBe(2);
  });

  it('keeps every selected item in the placement, displayed or not', () => {
    const { placement } = composeStructured(
      flow('PLAYER_FIRST'), four(), { firstName: 'Rhys' },
    );
    expect(placement.map((p) => p.kind).sort()).toEqual(four().map((e) => e.kind).sort());
  });

  it('renders no sentence for a claim it held back', () => {
    // The send path checks each sentence against the body to decide whether a
    // claim was delivered. A held-back item must not have one, or it would be
    // logged as cut by the operator rather than never sent.
    const { sentences, placement } = composeStructured(
      flow('PLAYER_FIRST'), four(), { firstName: 'Rhys' },
    );
    const held = placement.find((p) => !p.displayed);
    expect(sentences.map((x) => x.kind)).not.toContain(held.kind);
    expect(sentences).toHaveLength(3);
  });
});

describe('the filler fit line is gone', () => {
  it.each(FLOW_KEYS)('%s does not claim a fit in its own sentence', (key) => {
    const { template } = composeStructured(flow(key), [NZ(), GRAD()], { firstName: 'Rhys' });
    const body = fillTemplate(template, buildEmailContext(player, college, 'Coach', {
      profileUrl: 'https://example.test/p/x',
    }));
    expect(body).not.toMatch(/could suit .* well/);
    expect(body).not.toMatch(/interesting fit|potential fit|We believe/i);
  });
});

describe('large international counts stop being counted', () => {
  const roster = (count) => renderedFor(ev('INTERNATIONAL_ROSTER', { count, uniqueCountries: 3 }));
  const renderedFor = (item) => composeStructured(
    flow('PLAYER_FIRST'), [item], { firstName: 'Rhys' },
  ).sentences[0].text;

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
describe('the composed email explains itself exactly once', () => {
  const ctx = { firstName: 'Rhys' };

  it('gives the reasoning to the hook in the relationship flow', () => {
    const { tokens } = composeStructured(flow('RELATIONSHIP_FIRST'), [NZ(), GRAD()], ctx);
    expect(tokens.evidence_hook).toMatch(/^I saw .*, so I thought you might be open to another Kiwi\.$/);
    // The relevance paragraph is observations only — the reasoning was given.
    expect(tokens.evidence_relevance).toMatch(/^I also noticed /);
    expect(tokens.evidence_relevance).not.toMatch(/, so I/);
  });

  it('gives the reasoning to the first observation when there is no hook', () => {
    const { tokens } = composeStructured(flow('PLAYER_FIRST'), [GRAD(), ACAD()], ctx);
    expect(tokens.evidence_hook).toBeUndefined();
    expect(tokens.evidence_relevance)
      .toMatch(/^I was having a look through your program and noticed .*, so I thought Rhys/);
  });

  it('never uses more than one gathering lead-in in a paragraph', () => {
    for (const key of FLOW_KEYS) {
      const { tokens } = composeStructured(flow(key), [NZ(), GRAD(), ACAD(), TITLE()], ctx);
      for (const [name, text] of Object.entries(tokens)) {
        expect((text.match(/I also noticed/g) ?? []).length, `${key}.${name}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps the congratulation out of the reasoning and in its own line', () => {
    const { tokens } = composeStructured(flow('PLAYER_FIRST'), [GRAD(), TITLE()], ctx);
    expect(tokens.evidence_recognition).toMatch(/^Congrats on winning the ACC last year as well/);
    expect(tokens.evidence_relevance).not.toMatch(/congrats/i);
  });

  /**
   * A single trailing observation reads flat as "I also noticed X." Where a
   * kind supplies a sentence with its own point, composition uses it — for a
   * few kinds only, because appending a reason to everything is the
   * mechanical version of this and reads worse than the bare clause.
   */
  it('lets a lone supporting observation carry its own point', () => {
    const intl = ev('INTERNATIONAL_ROSTER', { count: 12, uniqueCountries: 3 });
    const { tokens } = composeStructured(flow('PLAYER_FIRST'), [GRAD(), intl], ctx);
    expect(tokens.evidence_relevance)
      .toContain("You've also got a pretty international squad, which made me think it was worth reaching out.");
  });

  it('does not append a reason to every gathered clause', () => {
    const { tokens } = composeStructured(flow('PLAYER_FIRST'), [GRAD(), ACAD(), NZ()], ctx);
    expect((tokens.evidence_relevance.match(/which made me think/g) ?? []).length)
      .toBeLessThanOrEqual(1);
  });

  it('never frames a clause that already opens with its own adverbial', () => {
    // "I saw going off last season's minutes, …" is what the naive framing
    // produces for a clause that starts with one.
    const starters = ev('POSITION_GRADUATION_STARTERS',
      { position: 'DEFENSE', count: 2 }, 'SIGNAL');
    const { tokens } = composeStructured(flow('PLAYER_FIRST'), [starters], ctx);
    expect(tokens.evidence_relevance).toMatch(/^Going off last season's minutes/);
    expect(tokens.evidence_relevance).not.toMatch(/noticed going off/);
  });
});
