import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  outreachEvidenceFor, LICENSED_KINDS, ROLES, MAX_BODY_FACTS, MAX_RECOGNITION,
} from './outreachEvidence.js';
import {
  defineEvidence, permissionsFor, kindSpec, PERMISSION, CONFIDENCE,
  EVIDENCE_KINDS, EVIDENCE_KIND_NAMES,
} from './kinds.js';

/**
 * The outbound read model.
 *
 * Everything here is downstream of one question: may a stranger write this
 * sentence to a coach, with nothing else on the page to qualify it. Three
 * properties carry the suite.
 *
 * A CLAIM ENDS AT THE OBSERVATION. The licensed facts are records — who was
 * recruited, from where, when — and nothing in the projection may be read as
 * openness, preference, need or intent. The bridge from the observation to
 * the athlete is the email's own voice and belongs to structure.
 *
 * ONE CONNECTION IS ONE CLAIM. Six pathway kinds observe the same thing; sent
 * together they would read as several independent reasons.
 *
 * SPARSE IS THE ANSWER MOST OF THE TIME, and that is correct rather than a
 * gap: 51% of real pairs have nothing safe and specific to say.
 */

const src = { source: 'roster_players', confidence: CONFIDENCE.HIGH };
const resultOf = (all) => ({ all, programmeResolved: true });

const coachArrival = (over = {}) => defineEvidence('COACH_ARRIVAL_SAME_COUNTRY', {
  ...src, season: '2025',
  data: { country: 'New Zealand', coach: 'Ali Simmons', count: 1, seasons: ['2025'], name: 'Hayden Aish', nameSeason: '2025', ...over },
});
const countryPosition = (over = {}) => defineEvidence('ARRIVAL_SAME_COUNTRY_POSITION', {
  ...src, season: '2023',
  data: { country: 'New Zealand', position: 'DEFENSE', count: 1, seasons: ['2023'], ...over },
});
const historicalCountry = (over = {}) => defineEvidence('HISTORICAL_SAME_COUNTRY', {
  ...src, season: '2022',
  data: { country: 'New Zealand', count: 2, names: ['A', 'B'], seasons: ['2022'], ...over },
});
const currentCountry = (over = {}) => defineEvidence('CURRENT_SAME_COUNTRY', {
  ...src, season: '2026', data: { country: 'New Zealand', count: 1, names: ['A'], ...over },
});
const regionPosition = (over = {}) => defineEvidence('ARRIVAL_SAME_REGION_POSITION', {
  ...src, season: '2024',
  data: { region: 'OCEANIA', countries: ['Australia'], position: 'DEFENSE', count: 1, seasons: ['2024'], athleteCountry: 'New Zealand', provenance: { supporting: [{ playerName: 'X', identityMethod: 'EXACT' }] }, ...over },
});
const historicalRegion = (over = {}) => defineEvidence('HISTORICAL_SAME_REGION', {
  ...src, season: '2023',
  data: { region: 'OCEANIA', countries: ['Australia'], athleteCountry: 'New Zealand', count: 1, names: ['X'], ...over },
});
const graduation = (over = {}) => defineEvidence('POSITION_GRADUATION', {
  ...src, season: '2026',
  data: { position: 'DEFENSE', count: 3, names: ['A', 'B', 'C'], classYear: 2027, ...over },
});
const academic = (over = {}) => defineEvidence('ACADEMIC_FIT', {
  ...src, season: null, data: { major: 'Kinesiology', stated: 'exercise science', ...over },
});
const conference = (over = {}) => defineEvidence('CONFERENCE_TITLE', {
  ...src, season: '2025', data: { conference: 'ACC', ...over },
});
const postseason = (over = {}) => defineEvidence('POSTSEASON_RESULT', {
  ...src, season: '2025', data: { round: 'semi', ...over },
});
const starters = (over = {}) => defineEvidence('POSITION_GRADUATION_STARTERS', {
  ...src, season: '2026',
  data: { position: 'DEFENSE', count: 2, names: ['A', 'B'], basis: 'projected', ...over },
});

const kindsOf = (r) => [...r.hooks, ...r.relevance, ...r.recognition].map((x) => x.kind);
const SOURCE = readFileSync(new URL('./outreachEvidence.js', import.meta.url), 'utf8');
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

// ---------------------------------------------------------------------------

describe('the licence', () => {
  it('carries exactly ten of the twenty-six kinds', () => {
    expect(EVIDENCE_KIND_NAMES).toHaveLength(26);
    expect(LICENSED_KINDS).toHaveLength(10);
  });

  it('names the four that need no qualification and the six that do', () => {
    expect([...LICENSED_KINDS].sort()).toEqual([
      'ACADEMIC_FIT', 'ARRIVAL_SAME_COUNTRY_POSITION', 'ARRIVAL_SAME_REGION_POSITION',
      'COACH_ARRIVAL_SAME_COUNTRY', 'CONFERENCE_TITLE', 'CURRENT_SAME_COUNTRY',
      'HISTORICAL_SAME_COUNTRY', 'HISTORICAL_SAME_REGION', 'POSITION_GRADUATION',
      'POSTSEASON_RESULT',
    ]);
  });

  it('licenses nothing the registry denies', () => {
    // The role table may only ever be NARROWER than the permission. It is
    // narrower today on purpose — see the note on ROLE_OF — and the day the
    // registry is narrowed to match, this stays true.
    for (const kind of LICENSED_KINDS) {
      expect(permissionsFor(kind).OUTREACH, kind).not.toBe(PERMISSION.DENIED);
    }
  });

  it('is the registry, exactly — no gap in either direction', () => {
    /**
     * Until G4 this was containment: the registry granted OUTREACH to nineteen
     * kinds while this module named ten, because narrowing the registry alone
     * would have changed live emails before the copy existed. Both moved in one
     * commit, so the two are now one policy and the invariant is equality.
     */
    const licensedByRegistry = EVIDENCE_KIND_NAMES
      .filter((k) => permissionsFor(k).OUTREACH !== PERMISSION.DENIED);
    expect([...licensedByRegistry].sort()).toEqual([...LICENSED_KINDS].sort());
  });

  it('grades them 4 ALLOWED, 6 QUALIFIED, 16 DENIED', () => {
    const by = { ALLOWED: 0, QUALIFIED: 0, DENIED: 0 };
    for (const k of EVIDENCE_KIND_NAMES) by[permissionsFor(k).OUTREACH] += 1;
    expect(by).toEqual({ ALLOWED: 4, QUALIFIED: 6, DENIED: 16 });
  });

  it('grants ALLOWED only to the four that need no qualification', () => {
    const allowed = EVIDENCE_KIND_NAMES
      .filter((k) => permissionsFor(k).OUTREACH === PERMISSION.ALLOWED);
    expect([...allowed].sort()).toEqual([
      'ARRIVAL_SAME_COUNTRY_POSITION', 'COACH_ARRIVAL_SAME_COUNTRY',
      'CURRENT_SAME_COUNTRY', 'HISTORICAL_SAME_COUNTRY',
    ]);
  });

  it('gives every licensed kind exactly one role', () => {
    const r = outreachEvidenceFor(resultOf([
      coachArrival(), graduation(), academic(), conference(),
    ]));
    for (const item of [...r.hooks, ...r.relevance, ...r.recognition]) {
      expect(Object.values(ROLES)).toContain(item.role);
    }
  });
});

describe('nothing unlicensed gets through', () => {
  it('drops every kind with no role, one at a time', () => {
    for (const kind of EVIDENCE_KIND_NAMES) {
      if (LICENSED_KINDS.includes(kind)) continue;
      const fake = {
        kind, confidence: CONFIDENCE.HIGH, permissions: permissionsFor(kind), data: {},
        describes: { seasons: ['2025'] },
      };
      const r = outreachEvidenceFor(resultOf([fake]));
      expect(kindsOf(r), kind).toEqual([]);
      expect(r.hasPersonalisation, kind).toBe(false);
    }
  });

  it('says why, rather than dropping silently', () => {
    const r = outreachEvidenceFor(resultOf([
      defineEvidence('INTERNATIONAL_ROSTER', { ...src, season: '2026', data: { count: 6, countries: ['Australia'], uniqueCountries: 1 } }),
    ]));
    expect(r.dispositions).toEqual([{
      kind: 'INTERNATIONAL_ROSTER',
      disposition: 'NOT_LICENSED',
      reason: 'not permitted in an outbound email',
    }]);
  });

  it('names no generic programme claim among the licensed set', () => {
    for (const kind of ['INTERNATIONAL_ROSTER', 'INTERNATIONAL_SHARE', 'SQUAD_GRADUATION',
      'PROGRAM_MOMENTUM', 'COACH_CONTEXT', 'POSITION_GROUP_SCARCITY',
      'RETURNING_POSITION_DEPTH', 'ELIGIBILITY_CLIFF']) {
      expect(LICENSED_KINDS, kind).not.toContain(kind);
    }
  });
});

describe('POSITION_GRADUATION_STARTERS is refused', () => {
  /**
   * Its own block because it is the correction the policy was revised for.
   * The prose reads "one of THOSE defenders" — a sentence whose subject is
   * defined by a claim that may not be beside it. It is supporting detail
   * belonging to POSITION_GRADUATION, not an independent claim.
   */
  it('has no outreach role', () => {
    expect(LICENSED_KINDS).not.toContain('POSITION_GRADUATION_STARTERS');
  });

  it('cannot reach the selector even as a valid, confident object', () => {
    const ev = starters();
    expect(ev.kind).toBe('POSITION_GRADUATION_STARTERS');
    expect(ev.confidence).toBe(CONFIDENCE.HIGH);
    const r = outreachEvidenceFor(resultOf([ev]));
    expect(kindsOf(r)).toEqual([]);
  });

  it('cannot ride in beside the graduation claim it describes', () => {
    const r = outreachEvidenceFor(resultOf([graduation(), starters()]));
    expect(r.relevance.map((x) => x.kind)).toEqual(['POSITION_GRADUATION']);
    expect(kindsOf(r)).not.toContain('POSITION_GRADUATION_STARTERS');
  });

  it('is not promoted by the operator surface', () => {
    expect(permissionsFor('POSITION_GRADUATION_STARTERS').OPERATOR_EVIDENCE)
      .toBe(PERMISSION.ALLOWED);
    expect(permissionsFor('POSITION_GRADUATION_STARTERS').OUTREACH).toBe(PERMISSION.DENIED);
    expect(kindsOf(outreachEvidenceFor(resultOf([starters()])))).toEqual([]);
  });

  it('is refused by role, so its copy is never consulted', () => {
    // The selector does not read its grammar, its basis or its names — it
    // never gets far enough for them to exist.
    expect(CODE).not.toContain('POSITION_GRADUATION_STARTERS');
  });
});

describe('the permission is asked first, and may only narrow', () => {
  it('refuses a licensed kind whose OUTREACH is narrowed to DENIED', () => {
    const narrowed = coachArrival();
    const denied = defineEvidence('COACH_ARRIVAL_SAME_COUNTRY', {
      ...src, season: '2025', permissions: { OUTREACH: PERMISSION.DENIED },
      data: { country: 'New Zealand', coach: 'Ali Simmons', count: 1, seasons: ['2025'] },
    });
    expect(kindsOf(outreachEvidenceFor(resultOf([narrowed])))).toEqual(['COACH_ARRIVAL_SAME_COUNTRY']);
    expect(kindsOf(outreachEvidenceFor(resultOf([denied])))).toEqual([]);
  });

  it('lets a QUALIFIED kind through its rule, and only through it', () => {
    /**
     * QUALIFIED means renderable only via a path that states the
     * qualification. THIS module is that path, so the grade proceeds to the
     * rule — and the rule is what refuses it. Six of the ten licensed kinds
     * are QUALIFIED; every one of them is dropped when its facts cannot state
     * what the claim needs.
     */
    expect(permissionsFor('POSITION_GRADUATION').OUTREACH).toBe(PERMISSION.QUALIFIED);
    expect(kindsOf(outreachEvidenceFor(resultOf([graduation()])))).toEqual(['POSITION_GRADUATION']);
    const r = outreachEvidenceFor(resultOf([graduation({ names: [] })]));
    expect(kindsOf(r)).toEqual([]);
    expect(r.dispositions[0].disposition).toBe('UNQUALIFIED');
  });

  it('does not read the legacy flag', () => {
    expect(CODE).not.toContain('emailEligible');
  });
});

describe('qualification, one rule per kind', () => {
  const drops = (ev) => expect(kindsOf(outreachEvidenceFor(resultOf([ev])))).toEqual([]);

  it('needs concrete countries and a position for a region arrival', () => {
    drops(regionPosition({ countries: [] }));
    drops(regionPosition({ position: null }));
    expect(kindsOf(outreachEvidenceFor(resultOf([regionPosition()]))))
      .toEqual(['ARRIVAL_SAME_REGION_POSITION']);
  });

  it('needs countries and the excluded country for a region history', () => {
    drops(historicalRegion({ countries: [] }));
    drops(historicalRegion({ athleteCountry: null }));
  });

  it('never carries a raw region key or the provenance blob', () => {
    const [item] = outreachEvidenceFor(resultOf([regionPosition()])).hooks;
    const json = JSON.stringify(item);
    expect(json).not.toContain('OCEANIA');
    expect(json).not.toContain('provenance');
    expect(json).not.toContain('identityMethod');
    expect(item.facts).not.toHaveProperty('region');
    expect(item.facts.countries).toEqual(['Australia']);
  });

  it('says out loud that a region claim is wider than the athlete’s country', () => {
    // Without it a coach reads a row about Australia as a row about the New
    // Zealander being introduced.
    for (const ev of [regionPosition(), historicalRegion()]) {
      const [item] = outreachEvidenceFor(resultOf([ev])).hooks;
      expect(item.facts.widerThanOwnCountry).toBe(true);
      expect(item.facts.excludingCountry).toBe('New Zealand');
    }
  });

  it('needs names and a class year for a graduation claim, never a bare count', () => {
    drops(graduation({ names: [] }));
    drops(graduation({ classYear: null }));
    const [item] = outreachEvidenceFor(resultOf([graduation()])).relevance;
    expect(item.facts.names).toEqual(['A', 'B', 'C']);
    expect(item.facts.classYear).toBe(2027);
  });

  it('needs both academic labels and keeps them apart', () => {
    drops(academic({ stated: null }));
    drops(academic({ major: null }));
    const [item] = outreachEvidenceFor(resultOf([academic()])).relevance;
    // The live defect this prevents: the intro says "Exercise Science" and the
    // evidence says "Kinesiology", four lines apart, as though they were
    // different subjects. Both travel; neither is asserted to be the other.
    expect(item.facts).toEqual({
      athleteStatedMajor: 'exercise science',
      programmeMatchedSubject: 'Kinesiology',
    });
  });

  it('needs the concrete result for each recognition kind', () => {
    drops(conference({ conference: null }));
    drops(postseason({ round: null }));
  });

  it('enforces each kind’s own confidence floor', () => {
    // ACADEMIC_FIT sits at HIGH: a subject we are not sure is offered is worse
    // than saying nothing. Reused as a claim-safety floor, never as a rank.
    expect(kindSpec('ACADEMIC_FIT').minConfidence).toBe(CONFIDENCE.HIGH);
    const weak = defineEvidence('ACADEMIC_FIT', {
      ...src, confidence: CONFIDENCE.MEDIUM, season: null,
      data: { major: 'Kinesiology', stated: 'exercise science' },
    });
    const r = outreachEvidenceFor(resultOf([weak]));
    expect(kindsOf(r)).toEqual([]);
    expect(r.dispositions[0].disposition).toBe('BELOW_CONFIDENCE');
  });
});

describe('one connection is one claim', () => {
  it('keeps a single hook out of all six', () => {
    const r = outreachEvidenceFor(resultOf([
      historicalCountry(), currentCountry(), historicalRegion(),
      coachArrival(), countryPosition(), regionPosition(),
    ]));
    expect(r.hooks).toHaveLength(1);
  });

  it('keeps the most specific one, not the first declared', () => {
    /**
     * The defect the specificity ladder was written for. Ordered by registry
     * declaration, HISTORICAL_SAME_COUNTRY wins every time and the coach's own
     * recruiting record is suppressed by a weaker statement of the same
     * connection — measured at 0 survivals across 3,498 real pairs before the
     * ladder existed.
     */
    const r = outreachEvidenceFor(resultOf([historicalCountry(), coachArrival()]));
    expect(r.hooks.map((h) => h.kind)).toEqual(['COACH_ARRIVAL_SAME_COUNTRY']);

    const r2 = outreachEvidenceFor(resultOf([historicalRegion(), countryPosition()]));
    expect(r2.hooks.map((h) => h.kind)).toEqual(['ARRIVAL_SAME_COUNTRY_POSITION']);
  });

  it('does not change with input order', () => {
    const items = [regionPosition(), coachArrival(), academic(), graduation(), conference()];
    const forward = kindsOf(outreachEvidenceFor(resultOf(items)));
    const reversed = kindsOf(outreachEvidenceFor(resultOf([...items].reverse())));
    expect(forward).toEqual(reversed);
  });

  it('keeps one recognition, not two', () => {
    const r = outreachEvidenceFor(resultOf([conference(), postseason()]));
    expect(r.recognition).toHaveLength(1);
  });

  it('lets the three different measurements stand together', () => {
    // A recruiting pathway, a graduating cohort and a subject offering are
    // three different things about three different populations. No exclusion
    // table is needed once the roster-depth kinds are denied, and none exists.
    const r = outreachEvidenceFor(resultOf([coachArrival(), graduation(), academic()]));
    expect(r.hooks.map((h) => h.kind)).toEqual(['COACH_ARRIVAL_SAME_COUNTRY']);
    expect(r.relevance.map((h) => h.kind)).toEqual(['POSITION_GRADUATION', 'ACADEMIC_FIT']);
  });
});

describe('order and cap', () => {
  it('puts hooks first, then relevance, then recognition', () => {
    const r = outreachEvidenceFor(resultOf([conference(), academic(), coachArrival(), graduation()]));
    expect(r.hooks.map((h) => h.kind)).toEqual(['COACH_ARRIVAL_SAME_COUNTRY']);
    expect(r.relevance.map((h) => h.kind)).toEqual(['POSITION_GRADUATION', 'ACADEMIC_FIT']);
    expect(r.recognition.map((h) => h.kind)).toEqual(['CONFERENCE_TITLE']);
  });

  it('carries at most three body facts and one recognition', () => {
    const r = outreachEvidenceFor(resultOf([
      coachArrival(), graduation(), academic(), conference(), postseason(),
    ]));
    expect(r.hooks.length + r.relevance.length).toBeLessThanOrEqual(MAX_BODY_FACTS);
    expect(r.recognition.length).toBeLessThanOrEqual(MAX_RECOGNITION);
    expect(MAX_BODY_FACTS).toBe(3);
    expect(MAX_RECOGNITION).toBe(1);
  });

  it('does not fill quotas — one fact stays one fact', () => {
    const r = outreachEvidenceFor(resultOf([academic()]));
    expect(kindsOf(r)).toEqual(['ACADEMIC_FIT']);
  });

  it('reads no score, prior or strength', () => {
    for (const word of ['strength', 'baseStrength', 'priorityOf', 'CATEGORY_PRIOR',
      'FACT_BONUS', 'match_score', 'breakdown', 'weight', 'contribution', 'SLOT_FLOORS']) {
      expect(CODE, word).not.toContain(word);
    }
  });

  it('is unaffected by an object’s strength', () => {
    const weakCoach = defineEvidence('COACH_ARRIVAL_SAME_COUNTRY', {
      ...src, strength: 1, season: '2025',
      data: { country: 'New Zealand', coach: 'Ali Simmons', count: 1, seasons: ['2025'] },
    });
    const strongHistory = defineEvidence('HISTORICAL_SAME_COUNTRY', {
      ...src, strength: 100, season: '2022',
      data: { country: 'New Zealand', count: 2, names: ['A'], seasons: ['2022'] },
    });
    expect(outreachEvidenceFor(resultOf([weakCoach, strongHistory])).hooks.map((h) => h.kind))
      .toEqual(['COACH_ARRIVAL_SAME_COUNTRY']);
  });
});

describe('the input must be the whole picture', () => {
  it('refuses a pre-selected array', () => {
    expect(() => outreachEvidenceFor([coachArrival()])).toThrow(/full `all` collection/);
    expect(() => outreachEvidenceFor({ selected: [coachArrival()] })).toThrow(/full `all` collection/);
    expect(() => outreachEvidenceFor({ ranked: [coachArrival()] })).toThrow(/full `all` collection/);
    expect(() => outreachEvidenceFor(null)).toThrow(/full `all` collection/);
  });

  it('does not reuse another surface’s policy', () => {
    expect(CODE).not.toContain('topReasons');
    expect(CODE).not.toContain('matchingSummaryFor');
    expect(CODE).not.toContain('selectFrom');
  });
});

describe('hasPersonalisation', () => {
  it('is true for a hook', () => {
    expect(outreachEvidenceFor(resultOf([coachArrival()])).hasPersonalisation).toBe(true);
  });

  it('is true for relevance alone', () => {
    expect(outreachEvidenceFor(resultOf([academic()])).hasPersonalisation).toBe(true);
  });

  it('is FALSE for recognition alone', () => {
    /**
     * Congratulating a programme on a conference title is a courtesy any
     * sender could pay and says nothing about whether this athlete belongs
     * there. Counting it would turn the personalisation rate into a measure of
     * how many programmes won something.
     */
    const r = outreachEvidenceFor(resultOf([conference(), postseason()]));
    expect(r.recognition).toHaveLength(1);
    expect(r.hasPersonalisation).toBe(false);
  });

  it('is false when nothing survives', () => {
    const r = outreachEvidenceFor(resultOf([]));
    expect(r).toEqual({
      alternatives: [],
      hooks: [], relevance: [], recognition: [], hasPersonalisation: false, dispositions: [],
    });
  });
});

describe('recognition is not evidence about the athlete', () => {
  it('never lands in hooks or relevance', () => {
    const r = outreachEvidenceFor(resultOf([conference(), postseason()]));
    expect(r.hooks).toEqual([]);
    expect(r.relevance).toEqual([]);
  });

  it('cannot be the first thing an email has to say', () => {
    // Structurally: the hooks array is what may open, and recognition is never
    // in it — so nothing downstream has to remember the rule.
    const r = outreachEvidenceFor(resultOf([conference(), academic()]));
    expect(r.hooks).toEqual([]);
    expect(r.relevance.map((x) => x.kind)).toEqual(['ACADEMIC_FIT']);
    expect(r.recognition.map((x) => x.kind)).toEqual(['CONFERENCE_TITLE']);
  });
});

describe('the claim ends at the observation', () => {
  it('projects records, never intent', () => {
    const r = outreachEvidenceFor(resultOf([
      coachArrival(), graduation(), academic(), conference(),
    ]));
    const json = JSON.stringify(r);
    for (const word of ['open', 'openness', 'prefer', 'need', 'intent', 'looking',
      'recruiting', 'want', 'target', 'opportunity', 'opening', 'fit', 'suit']) {
      expect(json.toLowerCase(), word).not.toContain(`"${word}`);
    }
  });

  it('carries no field a renderer could read as a conclusion', () => {
    const r = outreachEvidenceFor(resultOf([coachArrival(), graduation(), academic()]));
    for (const item of [...r.hooks, ...r.relevance]) {
      expect(Object.keys(item).sort()).toEqual(['facts', 'kind', 'role']);
      for (const key of Object.keys(item.facts)) {
        // `classYear` is a required fact — the cohort's stated graduation year
        // — so the pattern names the machinery rather than matching on
        // "class". Ranking metadata is what must not travel.
        expect(key, `${item.kind}.${key}`)
          .not.toMatch(/score|rank|strength|polarity|decisionClass|confidence|tier|dedupe/i);
      }
    }
  });

  it('states a count and a date, which a coach can check', () => {
    const [hook] = outreachEvidenceFor(resultOf([coachArrival()])).hooks;
    expect(hook.facts).toEqual({
      coach: 'Ali Simmons', country: 'New Zealand', count: 1,
      seasons: ['2025'], namedArrival: 'Hayden Aish', namedArrivalSeason: '2025',
    });
  });
});

/**
 * One of each, and no legacy alternate.
 *
 * H2 deleted a second composer (`composeStructured`/`evidenceSlots`) and a
 * second paragraph builder (`paragraphFor`/`evidenceParagraph`), both of which
 * had had no production caller since G4 and both of which rendered through the
 * legacy copy — the "so I thought you might be open to another Kiwi" reasoning
 * Stage G removed. A dead alternate is not harmless when it writes sentences:
 * the H1 hardening quietly made one of them reachable again, and it took a
 * measurement to notice.
 *
 * So the invariant is stated rather than assumed. Scanned as source text
 * because the failure mode is a new file nobody thought to wire into a test.
 */
describe('there is one of each, in production', () => {
  const ROOT = new URL('../../', import.meta.url).pathname;
  const read = (rel) => readFileSync(`${ROOT}${rel}`, 'utf8');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const PRODUCTION = [
    'shared/evidence/index.js', 'shared/email/compose.js', 'shared/evidence/structures.js',
    'server/routes/evidence.js', 'server/routes/sendOutreach.js',
    'src/lib/emailTemplate.js', 'server/scripts/evidenceReport.js',
    'server/scripts/recruitingEvidenceReport.js',
  ];

  it('names no deleted legacy composer or paragraph builder anywhere in production', () => {
    for (const rel of PRODUCTION) {
      const code = strip(read(rel));
      for (const gone of ['composeStructured', 'evidenceSlots', 'paragraphFor',
        'evidenceParagraph', 'paragraphFromSentences', 'CardEvidence']) {
        expect(code, `${rel} :: ${gone}`).not.toContain(gone);
      }
    }
  });

  it('routes outbound selection through `outreachEvidenceFor` and nothing else', () => {
    const index = strip(read('shared/evidence/index.js'));
    expect(index).toContain('outreachEvidenceFor(');
    expect(index).toContain('composeOutreach(');
    /**
     * And `selectFrom` does not run at all. It decided nothing outbound after
     * G4, explained nothing after H6, and was still sorting, deduping and
     * slot-filling the whole collection on every request so that four fields
     * could be derived from it. H7 removed the call; the function is exported
     * and tested, and a production request no longer computes a policy the
     * system replaced.
     */
    expect(index).not.toContain('selectFrom(');
  });

  it('renders outbound claims through `outreachCopyFor` and nothing else', () => {
    const composer = strip(read('shared/email/compose.js'));
    expect(composer).toContain('outreachCopyFor(');
    // The legacy per-tier renderer must not reach the outbound composer.
    expect(composer).not.toContain('evidenceParts(');
    expect(composer).not.toContain('factParts(');
    expect(composer).not.toContain('signalParts(');
  });

  it('plans placement through `planFromRoles` and nothing else', () => {
    const composer = strip(read('shared/email/compose.js'));
    expect(composer).toContain('planFromRoles(');
    expect(composer).not.toContain('planPlacement(');
  });
});
