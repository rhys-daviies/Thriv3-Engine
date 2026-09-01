import { describe, it, expect } from 'vitest';
import {
  renderEvidence, evidenceParts, factParts, signalParts, RENDERABLE_KINDS,
  isRecognition, EvidenceRenderError, yearPhrase, BACK_IN_DISTANCE,
} from './render.js';
import { EVIDENCE_KINDS, EVIDENCE_KIND_NAMES, TIERS } from './kinds.js';
import { conferenceLabel } from '../conference.js';

/**
 * The conversational copy layer, and the rules it must not break.
 *
 * The rewrite from database prose to something a person would write is the
 * kind of change that is easy to review sentence by sentence and easy to get
 * wrong in aggregate: a clause that reads well can quietly claim more than the
 * data supports, and a voice applied uniformly can turn into three "I noticed"
 * sentences in a row. Both failures are asserted here rather than left to
 * review.
 */

/** Every field any renderer reads, so a kind can be rendered in isolation. */
const SAMPLE = {
  country: 'New Zealand',
  count: 2,
  names: ['Sam Reid', 'Alex Kerr'],
  countries: ['Australia'],
  region: 'OCEANIA',
  athleteCountry: 'New Zealand',
  uniqueCountries: 3,
  position: 'DEFENSE',
  classYear: 2027,
  total: 5,
  returning: 3,
  groupSize: 6,
  players: 2,
  projectedMinutes: 900,
  share: 0.41,
  squadSize: 25,
  classifiedSquad: 25,
  round: 'semi',
  conference: 'ACC',
  major: 'Kinesiology',
  name: 'Pat Smith',
  seasonsObserved: 3,
  windowBounded: false,
  classification: 'RISING',
  recentWinPct: 0.7,
  priorWinPct: 0.5,
  basis: 'projected',
  arrivals: 4,
  // Recruiting-history fields. A shared fixture rather than per-kind ones, on
  // the same argument as the rest of this object: every renderer must survive
  // being handed the union of what any of them reads.
  seasons: ['2024', '2025'],
  nameSeason: '2025',
  observedTransitions: 4,
  transitionsWithArrival: 2,
  coachOwned: false,
  coachAttributed: 2,
  attributableTransitions: 3,
  earliestSupportedSeason: '2024',
  latestSupportedSeason: '2026',
  coach: 'Pat Coach',
};

const sample = (kind) => ({
  kind, tier: EVIDENCE_KINDS[kind].tier, data: SAMPLE, season: '2022-2025',
});

const CTX = { firstName: 'Rhys' };
const emailKinds = EVIDENCE_KIND_NAMES.filter((k) => EVIDENCE_KINDS[k].emailEligible);

/**
 * Every piece of text any kind can put in an email: [kind, part, text].
 *
 * All the parts, not just the sentence — a `reason` that overstepped would be
 * invisible to a check that only read the composed opener.
 */
const everyClause = () => emailKinds.flatMap((kind) => {
  const p = evidenceParts(sample(kind), CTX);
  return Object.entries(p)
    .filter(([field, v]) => typeof v === 'string' && field !== 'framing')
    .map(([field, v]) => [kind, field, v]);
});

describe('every email-eligible kind supplies usable parts', () => {
  it.each(emailKinds)('%s gives a clause and a reason, or a recognition line', (kind) => {
    const p = evidenceParts(sample(kind), CTX);
    if (p.recognition) {
      // A congratulation is a whole sentence and has no clause to gather.
      expect(p.recognition, kind).toMatch(/^Congrats\b/);
      expect(p.clause, kind).toBeUndefined();
      return;
    }
    expect(p.clause, `${kind} clause`).toBeTruthy();
    expect(p.reason, `${kind} reason`).toBeTruthy();
    // The clause states the observation; the reason states why we wrote. If
    // they were the same the decomposition would be doing nothing.
    expect(p.clause, kind).not.toBe(p.reason);
    // A clause is a fragment, not a sentence — composition supplies the frame.
    expect(p.clause[0], `${kind} clause must be lower case`).toBe(p.clause[0].toLowerCase());
  });

  it('renders without an athlete name, for the operator preview', () => {
    for (const kind of emailKinds) {
      const text = renderEvidence(sample(kind), {});
      expect(text, kind).toBeTruthy();
      expect(text, `${kind} must not print a missing name`).not.toMatch(/undefined|null/);
    }
  });

  it('registers copy for every email-eligible kind', () => {
    for (const kind of emailKinds) expect(RENDERABLE_KINDS, kind).toContain(kind);
  });
});

/**
 * THE INTERPRETATION RULE.
 *
 * A clause may say why WE are writing. It may never say what the COACH needs.
 * "so I thought Rhys could be worth putting on your radar" is our reasoning
 * and claims nothing about their squad; "so you'll need another defender" is a
 * claim no roster row supports.
 *
 * This is the rule that makes conversational copy safe, and it is the one that
 * would erode first — each individual overstep reads harmlessly.
 */
describe('observation never becomes a claim about the coach', () => {
  const FORBIDDEN = [
    [/\byou'?ll need\b/i, 'asserts a need'],
    [/\byou need\b/i, 'asserts a need'],
    [/\byou (are|'re) (clearly|obviously|evidently)\b/i, 'asserts intent'],
    [/\byou'?re looking for\b/i, 'asserts intent'],
    [/\byour needs?\b/i, 'asserts a need'],
    [/\bwill need\b/i, 'asserts a need'],
    [/\bmust\b/i, 'instructs the coach'],
    [/\bshould be looking\b/i, 'instructs the coach'],
    [/\bgap in your\b/i, 'asserts a deficiency'],
    [/\bhole in your\b/i, 'asserts a deficiency'],
    [/\byou'?re short\b/i, 'asserts a deficiency'],
    [/\bdesperately\b/i, 'asserts a deficiency'],
  ];

  it.each(everyClause())('%s (%s) claims nothing about the squad', (kind, slot, text) => {
    for (const [pattern, why] of FORBIDDEN) {
      expect(text, `${kind}/${slot} ${why}: "${text}"`).not.toMatch(pattern);
    }
  });

  /**
   * The corporate register the rewrite replaced. Banned across the copy so it
   * cannot creep back one clause at a time.
   */
  const CORPORATE = [
    'aligns with', 'demonstrates', 'indicates', 'presents an opportunity',
    'roster composition', 'positional need', 'historical tendency',
    'regional representation', 'our data', 'we believe', 'leverage',
  ];

  it.each(everyClause())('%s (%s) avoids corporate phrasing', (kind, slot, text) => {
    for (const phrase of CORPORATE) {
      expect(text.toLowerCase(), `${kind}/${slot}: "${text}"`).not.toContain(phrase);
    }
  });

  /**
   * No pronoun for the athlete. `players` stores no gender or pronoun field,
   * and inferring one from the sport would be a guess about a real person that
   * is wrong for anyone it is wrong for.
   */
  it.each(everyClause())('%s (%s) uses no third-person pronoun', (kind, slot, text) => {
    expect(text, `${kind}/${slot}: "${text}"`).not.toMatch(/\b(he|him|his|she|her|hers)\b/i);
  });
});

describe('the tier wall survives the rewrite', () => {
  it('refuses to render a SIGNAL as a statement of fact', () => {
    const signal = sample('PROGRAM_MOMENTUM');
    expect(signal.tier).toBe(TIERS.SIGNAL);
    expect(() => factParts(signal)).toThrow(EvidenceRenderError);
  });

  it('lets a FACT be stated softly, but never the reverse', () => {
    expect(() => signalParts(sample('CONFERENCE_TITLE'))).not.toThrow();
  });

  it('throws on a kind with no copy at all', () => {
    expect(() => factParts({ kind: 'NOT_A_KIND', tier: TIERS.FACT, data: {} }))
      .toThrow(EvidenceRenderError);
  });

  /**
   * The hedges are load-bearing. Each of these describes a projection, a ratio
   * over a denominator we only mostly trust, or an eligibility assumption, and
   * a coach who checks must find it approximately right rather than exactly
   * right.
   */
  it.each([
    ['POSITION_GRADUATION_STARTERS', /going off last season's minutes/i],
    ['RETURNING_POSITION_DEPTH', /looks like/i],
    ['ELIGIBILITY_CLIFF', /look like/i],
    ['INTERNATIONAL_SHARE', /looks to be/i],
    ['POSITION_GROUP_SCARCITY', /looks a little light/i],
  ])('%s keeps its hedge in the clause, where the uncertainty is', (kind, hedge) => {
    expect(evidenceParts(sample(kind), CTX).clause, kind).toMatch(hedge);
    // And in the composed sentence, so no framing can strip it.
    expect(renderEvidence(sample(kind), CTX), kind).toMatch(hedge);
  });
});

describe('recognition', () => {
  /**
   * The registry's `recognition` flag and the copy must agree. A kind marked
   * in one and not the other would either be gathered into somebody else's
   * clause — "I also noticed congrats on winning the CAA" — or lose its
   * placement at the end of the email.
   */
  it('matches what the copy actually produces', () => {
    const fromCopy = emailKinds.filter((kind) => isRecognition(sample(kind), CTX));
    const fromRegistry = emailKinds.filter((kind) => EVIDENCE_KINDS[kind].recognition);
    expect(fromCopy.sort()).toEqual(fromRegistry.sort());
  });

  it('names the two congratulations', () => {
    expect(isRecognition(sample('CONFERENCE_TITLE'), CTX)).toBe(true);
    expect(isRecognition(sample('POSTSEASON_RESULT'), CTX)).toBe(true);
    expect(isRecognition(sample('POSITION_GRADUATION'), CTX)).toBe(false);
  });
});

describe('conference names reach copy in their display form', () => {
  it('strips the division suffix we added for our own disambiguation', () => {
    expect(conferenceLabel('MWC-D3')).toBe('MWC');
    expect(conferenceLabel('MIAA-D3')).toBe('MIAA');
  });

  it('leaves real names alone, including the ones with digits and hyphens', () => {
    for (const name of ['Atlantic 10', 'Big 12', 'Northeast-10', 'Empire 8', 'C2C',
      'ACC', 'America East', 'C-USA', 'American Rivers']) {
      expect(conferenceLabel(name), name).toBe(name);
    }
  });

  it('applies it inside the congratulation itself', () => {
    const ev = { kind: 'CONFERENCE_TITLE', tier: TIERS.FACT, data: { conference: 'MWC-D3' } };
    const text = renderEvidence(ev, CTX);
    expect(text).toContain('the MWC last year');
    expect(text).not.toContain('D3');
  });

  it('falls back to naming no conference rather than an empty one', () => {
    const ev = { kind: 'CONFERENCE_TITLE', tier: TIERS.FACT, data: { conference: null } };
    expect(renderEvidence(ev, CTX)).toContain('winning your conference');
  });
});

describe('names are used where they help and dropped where they do not', () => {
  const grad = (count, names) => evidenceParts({
    kind: 'POSITION_GRADUATION',
    tier: TIERS.FACT,
    data: { position: 'DEFENSE', count, names, classYear: 2027 },
  }, CTX).clause;

  it('names up to three players', () => {
    expect(grad(3, ['A', 'B', 'C'])).toContain('(A, B and C)');
  });

  it('drops the list at four, where it reads as a printout', () => {
    const text = grad(4, ['A', 'B', 'C', 'D']);
    expect(text).not.toContain('(A');
    expect(text).toContain('four defenders graduating');
  });

  it('names the single compatriot rather than counting them', () => {
    const text = renderEvidence({
      kind: 'HISTORICAL_SAME_COUNTRY',
      tier: TIERS.FACT,
      season: '2025',
      data: { country: 'New Zealand', count: 1, names: ['Hayden Aish'] },
    }, CTX);
    expect(text).toContain('Hayden Aish');
    expect(text).toContain('another Kiwi');
  });
});

/**
 * The recent-year rule.
 *
 * "Back in 2026" was being written about the season that has not been played
 * yet, and "back in 2025" about a player who arrived a year ago. Both read as
 * though nobody had looked at a calendar, and a coach reading about their own
 * intake is the person most likely to notice.
 */
describe('year wording is measured from the pinned squad season', () => {
  it('writes the current and previous season as "in {year}"', () => {
    expect(yearPhrase('2026', { squadSeason: '2026' })).toBe('in 2026');
    expect(yearPhrase('2025', { squadSeason: '2026' })).toBe('in 2025');
  });

  it('writes two seasons back and older as "back in {year}"', () => {
    expect(yearPhrase('2024', { squadSeason: '2026' })).toBe('back in 2024');
    expect(yearPhrase('2019', { squadSeason: '2026' })).toBe('back in 2019');
    expect(BACK_IN_DISTANCE).toBe(2);
  });

  /** The boundary itself, from both sides. */
  it('turns over exactly at the two-season boundary', () => {
    expect(yearPhrase(2024, { squadSeason: 2026 })).toBe('back in 2024');
    expect(yearPhrase(2025, { squadSeason: 2026 })).toBe('in 2025');
  });

  /**
   * The rule moves with the season rather than being pinned to 2026, so next
   * year's squad re-dates every clause without anyone editing copy.
   */
  it('moves with the squad season instead of hardcoding a year', () => {
    expect(yearPhrase('2026', { squadSeason: '2028' })).toBe('back in 2026');
    expect(yearPhrase('2027', { squadSeason: '2028' })).toBe('in 2027');
  });

  it('never prints a phrase for a year it cannot read', () => {
    expect(yearPhrase(null)).toBe('');
    expect(yearPhrase(undefined)).toBe('');
    expect(yearPhrase('')).toBe('');
  });

  /** A future season is not "back in" anything. */
  it('does not reach backwards for a season ahead of the squad', () => {
    expect(yearPhrase('2027', { squadSeason: '2026' })).toBe('in 2027');
  });

  it('reaches the real clauses, not just the helper', () => {
    const recent = renderEvidence({
      kind: 'COACH_ARRIVAL_SAME_COUNTRY',
      tier: TIERS.FACT,
      season: '2026',
      data: { country: 'New Zealand', count: 1, seasons: ['2026'], name: 'Joby Reid', nameSeason: '2026' },
    });
    expect(recent).toContain('in 2026');
    expect(recent).not.toContain('back in 2026');

    const old = renderEvidence({
      kind: 'COACH_ARRIVAL_SAME_COUNTRY',
      tier: TIERS.FACT,
      season: '2023',
      data: { country: 'New Zealand', count: 1, seasons: ['2023'], name: 'Max Collingwood', nameSeason: '2023' },
    });
    expect(old).toContain('back in 2023');
  });
});

/**
 * One person, said once.
 *
 * SIUE's hook rested on two Australian defenders who arrived in 2024 and 2025;
 * the graduating clause two sentences later named one of the same two. Both
 * true, and together they read as a database joining itself in front of the
 * reader.
 */
describe('a person is not talked about twice in one email', () => {
  const arrival = () => ({
    kind: 'ARRIVAL_SAME_REGION_POSITION',
    tier: TIERS.FACT,
    season: '2024-2025',
    data: {
      position: 'DEFENSE', countries: ['Australia'], count: 2, seasons: ['2024', '2025'],
      name: null,
      provenance: {
        supporting: [
          { playerName: 'Elliott Forestier', identityMethod: 'EXACT' },
          { playerName: 'Murray Peart', identityMethod: 'EXACT' },
        ],
      },
    },
  });
  const graduating = (names) => ({
    kind: 'POSITION_GRADUATION',
    tier: TIERS.FACT,
    season: '2026',
    data: { position: 'DEFENSE', count: names.length, names, classYear: 2027 },
  });

  const pass = () => ({ firstName: 'Rhys', namesUsed: new Set() });

  it('names everybody when nothing has been said yet', () => {
    const ctx = pass();
    const out = evidenceParts(graduating(['Elliott Forestier', 'Colin Bastianoni']), ctx);
    expect(out.clause).toContain('(Elliott Forestier and Colin Bastianoni)');
  });

  /**
   * The hook does not PRINT Elliott — it rests on him silently — and the later
   * clause still must not name him. That asymmetry is the whole guard.
   */
  it('drops a name the hook already rested on, and says the list is partial', () => {
    const ctx = pass();
    evidenceParts(arrival(), ctx);
    const out = evidenceParts(graduating(['Elliott Forestier', 'Colin Bastianoni']), ctx);
    expect(out.clause).not.toContain('Elliott Forestier');
    expect(out.clause).toContain('two defenders graduating');
    expect(out.clause).toContain('(including Colin Bastianoni)');
  });

  /**
   * Printing two of three without saying so would read as the whole group,
   * which is the one way this guard could make a true claim misleading.
   */
  it('marks a trimmed list rather than presenting it as complete', () => {
    const ctx = pass();
    evidenceParts(arrival(), ctx);
    const out = evidenceParts(graduating(['Elliott Forestier', 'Colin Bastianoni', 'Sam Reid']), ctx);
    expect(out.clause).toContain('three defenders graduating');
    expect(out.clause).toContain('(including Colin Bastianoni and Sam Reid)');
  });

  it('falls back to the count alone when nobody is left to name', () => {
    const ctx = pass();
    evidenceParts(arrival(), ctx);
    const out = evidenceParts(graduating(['Elliott Forestier']), ctx);
    expect(out.clause).toBe('you\'ve got one defender graduating in 2027');
    expect(out.clause).not.toContain('Elliott');
  });

  it('matches a person however their name is cased or spaced', () => {
    const ctx = pass();
    evidenceParts(arrival(), ctx);
    const out = evidenceParts(graduating(['elliott  forestier', 'Colin Bastianoni']), ctx);
    expect(out.clause).not.toMatch(/forestier/i);
  });

  /** A named arrival is not repeated either — it falls back to the count. */
  it('stops a later arrival clause repeating a name', () => {
    const ctx = pass();
    evidenceParts(graduating(['Hayden Aish', 'Colin Bastianoni']), ctx);
    const out = evidenceParts({
      kind: 'ARRIVAL_SAME_COUNTRY_POSITION',
      tier: TIERS.FACT,
      season: '2025',
      data: {
        country: 'New Zealand', position: 'DEFENSE', count: 1, seasons: ['2025'],
        name: 'Hayden Aish', nameSeason: '2025', coachOwned: true,
      },
    }, ctx);
    expect(out.clause).not.toContain('Hayden Aish');
    expect(out.clause).toContain('a defender from New Zealand');
  });

  /**
   * Without a pass set — a caller rendering one clause in isolation, which the
   * operator panel does — nothing is filtered and today's behaviour stands.
   */
  it('changes nothing for a caller that renders one clause on its own', () => {
    const out = evidenceParts(graduating(['Elliott Forestier', 'Colin Bastianoni']), { firstName: 'Rhys' });
    expect(out.clause).toContain('(Elliott Forestier and Colin Bastianoni)');
  });
});
