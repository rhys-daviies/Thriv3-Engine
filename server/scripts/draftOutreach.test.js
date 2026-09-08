import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * The one production path that WRITES, and the last one with no test.
 *
 * `draftOutreach.js` composes an email and opens it in Outlook. It was the
 * only consumer of the evidence result nothing ran — and it had been throwing
 * since H7, on the first programme with any evidence at all, because it read
 * three fields (`ranked`, `suppressed`, `belowThreshold`) that were deleted
 * with the legacy selector. H7 migrated `evidenceReport.js` off the same three
 * in the same commit. Nobody noticed this one for five stages.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE IS FOR: PREVIEW == DRAFT == SEND.
 *
 * An operator approves a draft. If the send path would then compose something
 * else, the approval meant nothing. So the important assertions here are not
 * three snapshots of three paths — they are the equalities between them, for
 * the same athlete, programme, template and prefer state.
 *
 * The Outlook bridge is faked the way `sendOutreach.test.js` fakes it, so this
 * counts and inspects writes without opening a compose window on whoever runs
 * the suite.
 */

const composed = [];
let failNext = null;
vi.mock('../lib/outlook.js', () => ({
  isOutlookAvailable: () => true,
  composeInOutlook: vi.fn(async (message) => {
    if (failNext) { const e = failNext; failNext = null; throw new Error(e); }
    composed.push(message);
    return { ok: true, sent: message.send };
  }),
}));

const db = (await import('../db/client.js')).default;
const { utcNow } = await import('../lib/time.js');
const { draftOne } = await import('./draftOutreach.js');
const { sendOutreach } = await import('../routes/sendOutreach.js');
const { selectEvidence } = await import('../../shared/evidence/index.js');
const { emailBodyFor, fillTemplate, DEFAULT_EMAIL_SUBJECT } = await import('../../src/lib/emailTemplate.js');

const COACHES = [
  { name: 'Ali Simmons', email: 'asimmons@example.edu', title: 'Head Coach' },
  { name: 'J. Marsden', email: 'jmarsden@example.edu', title: 'Assistant Coach' },
];

function makeAthlete(overrides = {}) {
  const id = randomUUID();
  const ts = utcNow();
  const row = {
    id, created_date: ts, updated_date: ts,
    full_name: 'Rhys Davies', position: 'Defender', graduation_year: 2027,
    recruiting_class_year: 2027, nationality: 'New Zealand', intended_major: 'Business',
    email: 'athlete@example.com', public_slug: randomUUID().slice(0, 10),
    sport: 'mens-soccer', gpa: 3.6, sat_score: 1210,
    // The send path refuses without these: no video means no profile page, and
    // a dead link in front of a coach is the failure it is guarding.
    video_id: 'aqz-KE-bpKQ',
    video_chapters: JSON.stringify([{ t: 10, label: 'Opening' }, { t: 60, label: 'Middle' }]),
    ...overrides,
  };
  const cols = Object.keys(row);
  db.prepare(`INSERT INTO players (${cols.join(',')}) VALUES (${cols.map((c) => `@${c}`).join(',')})`).run(row);
  return { ...row, id };
}

const COLLEGE = { name: 'Jacksonville', sport: 'mens-soccer', division: 'NCAA D1', notable_majors: ['Business'] };

const row = (o = {}) => ({
  college_name: 'Jacksonville', sport: 'mens-soccer', season: '2026',
  player_name: 'A Player', position: 'D', minutes_played: null,
  class_year_label: 'Jr.', nationality: 'USA', country: '',
  estimated_graduation_year: 2027, eligibility_end_year: 2027,
  projected_minutes: 600, prior_programme: null,
  updated_date: new Date().toISOString().slice(0, 10), ...o,
});
const squad = (extra = []) => [
  ...Array.from({ length: 24 }, (_, i) => row({ player_name: `P${i}` })), ...extra,
];
const kiwi = (season, name) => row({
  season, player_name: name, nationality: 'International', country: 'New Zealand',
  minutes_played: season === '2026' ? null : 600,
});

/**
 * The eleven shapes a draft has to survive, as evidence results.
 *
 * Built through `selectEvidence` from roster rows rather than hand-made, so
 * they exercise the real licence, qualification, dedupe and placement — a
 * fixture that skipped those would prove the draft path agrees with a fiction.
 */
const FIXTURES = {
  hookRelevanceRecognition: {
    college: { ...COLLEGE, conference_champion_2025: true, conference_champion_name: 'ACC' },
    squad: squad([kiwi('2026', 'Kiwi Now')]), history: [kiwi('2023', 'Kiwi Past')],
    match: { graduating_at_position: 3, graduating_names_at_position: ['P0', 'P1', 'P2'], roster_season: '2026' },
  },
  hookOnly: {
    college: COLLEGE, squad: squad([kiwi('2026', 'Kiwi Now')]), history: [kiwi('2023', 'Kiwi Past')],
  },
  relevanceOnly: {
    college: COLLEGE, squad: squad(), history: [row({ season: '2024', minutes_played: 600 })],
    match: { graduating_at_position: 2, graduating_names_at_position: ['P0', 'P1'], roster_season: '2026' },
  },
  recognitionOnly: {
    college: { ...COLLEGE, notable_majors: [], conference_champion_2025: true, conference_champion_name: 'ACC' },
    squad: squad(), history: [],
  },
  zeroEvidence: { college: { ...COLLEGE, notable_majors: [] }, squad: [], history: [] },
  qualified: {
    college: COLLEGE, squad: squad(), history: [],
    match: { graduating_at_position: 2, graduating_names_at_position: ['P0', 'P1'], roster_season: '2026' },
  },
  sameRegion: {
    college: COLLEGE, squad: squad(),
    history: [row({ season: '2023', player_name: 'Aussie', nationality: 'International', country: 'Australia', minutes_played: 600 })],
  },
  withSourceUrl: {
    college: COLLEGE, squad: squad([kiwi('2026', 'Kiwi Now')]), history: [kiwi('2023', 'Kiwi Past')],
    rosterSource: { status: 'VERIFIED_DIRECT', url: 'https://judolphins.com/sports/mens-soccer/roster/2026' },
  },
  withoutSourceUrl: {
    college: COLLEGE, squad: squad([kiwi('2026', 'Kiwi Now')]), history: [kiwi('2023', 'Kiwi Past')],
  },
};

const evidenceOf = (athlete, name, opts = {}) => {
  const f = FIXTURES[name];
  return selectEvidence(athlete, { sport: 'mens-soccer', ...f }, opts);
};

/**
 * The composed body with the two transport steps undone.
 *
 * The tracking URL goes back to its token and the compliance footer comes off,
 * so what remains is what the composer produced and what a preview showed.
 */
function unwrap(body) {
  const withToken = body.replace(/https?:\/\/[^\s]*[?&]ref=[A-Za-z0-9]+/g, '{{player_profile_url}}');
  const i = withToken.indexOf('Striv3 Elite Sports Management');
  return i === -1 ? withToken : withToken.slice(0, i + 'Striv3 Elite Sports Management'.length);
}

/** What the browser preview composes, from the same two calls. */
const preview = (athlete, evidence, college = COLLEGE) => {
  const c = emailBodyFor(athlete, college, COACHES[0].name, { evidence });
  return {
    subject: fillTemplate(athlete.email_subject || DEFAULT_EMAIL_SUBJECT, c.context),
    body: c.body,
  };
};

beforeEach(() => {
  composed.length = 0;
  failNext = null;
  db.exec('DELETE FROM outreach_evidence; DELETE FROM engagement_rollup; DELETE FROM tracking_events; DELETE FROM outreach_send; DELETE FROM outreach; DELETE FROM players; DELETE FROM coaches; DELETE FROM suppressions;');
});

// ---------------------------------------------------------------------------

describe('a draft is the email the preview showed', () => {
  it.each(Object.keys(FIXTURES))('composes an identical body and subject — %s', async (name) => {
    const athlete = makeAthlete();
    const evidence = evidenceOf(athlete, name);
    const shown = preview(athlete, evidence, FIXTURES[name].college);

    await draftOne({ athlete, college: FIXTURES[name].college, coaches: [COACHES[0]], evidence });

    expect(composed).toHaveLength(1);
    expect(composed[0].subject).toBe(shown.subject);
    /**
     * TWO TRANSPORT STEPS, AND NOTHING ELSE.
     *
     * `sendOutreach` substitutes `{{player_profile_url}}` with a per-coach
     * tracking link and appends the compliance footer — both at write time,
     * both identical for a draft and a send, and neither an evidence decision.
     * Reversing them must give back the previewed body exactly, which is a
     * stronger claim than a prefix check: it says nothing was added, removed
     * or reordered in between.
     */
    expect(unwrap(composed[0].body)).toBe(shown.body);
  });
});

describe('a draft is the email the send path would send', () => {
  it.each(Object.keys(FIXTURES))('differs from a send by the send flag alone — %s', async (name) => {
    const athlete = makeAthlete();
    const evidence = evidenceOf(athlete, name);
    const shown = preview(athlete, evidence, FIXTURES[name].college);

    await draftOne({ athlete, college: FIXTURES[name].college, coaches: [COACHES[0]], evidence });
    const asDraft = { ...composed[0] };
    composed.length = 0;

    await sendOutreach({
      athleteId: athlete.id, coaches: [COACHES[0]],
      subject: shown.subject, body: shown.body, greetingName: COACHES[0].name,
      collegeName: FIXTURES[name].college.name, division: 'NCAA D1',
      matchId: FIXTURES[name].college.name, send: true, evidence,
    });

    expect(composed).toHaveLength(1);
    expect(composed[0].body).toBe(asDraft.body);
    expect(composed[0].subject).toBe(asDraft.subject);
    expect(composed[0].to).toBe(asDraft.to);
    // The only difference, and it is the one the operator is choosing between.
    expect(asDraft.send).toBe(false);
    expect(composed[0].send).toBe(true);
  });
});

describe('the operator\'s preference reaches the draft', () => {
  const swapCase = () => FIXTURES.hookRelevanceRecognition;

  it('honours a preferred alternative, exactly as the preview would', async () => {
    const athlete = makeAthlete();
    const plain = evidenceOf(athlete, 'hookRelevanceRecognition');
    const alt = (plain.roles.alternatives ?? [])[0];
    expect(alt, 'fixture must offer an alternative to swap').toBeTruthy();

    const preferred = evidenceOf(athlete, 'hookRelevanceRecognition', { prefer: [alt.kind] });
    expect(preferred.selected.map((e) => e.kind)).toContain(alt.kind);

    await draftOne({ athlete, college: swapCase().college, coaches: [COACHES[0]], evidence: preferred });
    expect(unwrap(composed[0].body)).toBe(preview(athlete, preferred, swapCase().college).body);
    // And it is a different email from the unpreferred one.
    expect(composed[0].body).not.toContain(plain.sentences[0].text);
  });

  it('ignores a preference the licence refuses', async () => {
    const athlete = makeAthlete();
    const denied = evidenceOf(athlete, 'hookRelevanceRecognition', { prefer: ['TRANSFER_BEHAVIOUR'] });
    const plain = evidenceOf(athlete, 'hookRelevanceRecognition');
    expect(denied.unavailableRequests).toContain('TRANSFER_BEHAVIOUR');
    expect(denied.sentences.map((s) => s.kind)).toEqual(plain.sentences.map((s) => s.kind));

    await draftOne({ athlete, college: swapCase().college, coaches: [COACHES[0]], evidence: denied });
    expect(composed[0].body).not.toMatch(/transfer|came from another programme/i);
  });
});

describe('a programme with nothing safe to say still drafts', () => {
  it('writes a whole player-first email rather than failing', async () => {
    const athlete = makeAthlete();
    const evidence = evidenceOf(athlete, 'zeroEvidence');
    expect(evidence.hasPersonalisation).toBe(false);
    expect(evidence.structure.key).toBe('PLAYER_FIRST');

    const { results } = await draftOne({
      athlete, college: FIXTURES.zeroEvidence.college, coaches: [COACHES[0]], evidence,
    });
    expect(results[0].status).toBe('drafted');
    expect(composed).toHaveLength(1);
    expect(composed[0].body).toContain('Rhys Davies');
    // A whole email, not a shell with a hole where the evidence was meant to be.
    expect(composed[0].body).not.toMatch(/\{\{|\}\}/);
  });
});

describe('what the draft may say about the evidence', () => {
  it('carries only what the email actually renders, never a held claim', async () => {
    /**
     * SELECTED IS NOT RENDERED. The selector licenses up to three body claims
     * and composition carries at most two; a draft that pasted everything
     * selected would put a sentence in front of a coach the composer had
     * decided against.
     */
    const athlete = makeAthlete();
    const evidence = evidenceOf(athlete, 'hookRelevanceRecognition');
    const rendered = new Set(evidence.sentences.map((s) => s.kind));
    const held = evidence.selected.filter((e) => !rendered.has(e.kind));
    expect(held.length, 'fixture must hold something back').toBeGreaterThan(0);

    await draftOne({ athlete, college: FIXTURES.hookRelevanceRecognition.college, coaches: [COACHES[0]], evidence });
    for (const h of held) {
      const text = (evidence.sentences.find((s) => s.kind === h.kind) ?? {}).text;
      if (text) expect(composed[0].body).not.toContain(text);
    }
    for (const s of evidence.sentences) expect(composed[0].body).toContain(s.text);
  });

  it('says nothing a coach may not be told', async () => {
    const athlete = makeAthlete();
    const evidence = evidenceOf(athlete, 'hookRelevanceRecognition');
    await draftOne({ athlete, college: FIXTURES.hookRelevanceRecognition.college, coaches: [COACHES[0]], evidence });
    // The sixteen DENIED kinds are on the result and may not be in the email.
    const internal = evidence.internal.map((e) => e.kind);
    expect(internal.length).toBeGreaterThan(0);
    for (const kind of internal) expect(composed[0].body).not.toContain(kind);
    expect(composed[0].body).not.toMatch(/[A-Z]{3,}_[A-Z_]{3,}/);
  });

  it('cites no source, with or without one on the evidence', async () => {
    // H12 gave four kinds a roster link for the operator panel. A coach email
    // has never cited anything and must not start.
    const athlete = makeAthlete();
    for (const name of ['withSourceUrl', 'withoutSourceUrl']) {
      composed.length = 0;
      const evidence = evidenceOf(athlete, name);
      await draftOne({ athlete, college: COLLEGE, coaches: [COACHES[0]], evidence });
      // The profile link the send path substitutes is the ONLY URL a coach
      // email carries, so the check is against the composed prose.
      expect(unwrap(composed[0].body), name).not.toMatch(/http|judolphins|source|according to/i);
    }
    // And the fixture really did carry one, so the check is not vacuous.
    expect(evidenceOf(athlete, 'withSourceUrl').all.some((e) => e.sourceUrl)).toBe(true);
  });
});

describe('the write happens once, last, and never silently', () => {
  it('creates exactly one draft per coach and no more', async () => {
    const athlete = makeAthlete();
    const evidence = evidenceOf(athlete, 'hookOnly');
    await draftOne({ athlete, college: COLLEGE, coaches: COACHES, evidence });
    expect(composed).toHaveLength(2);
    expect(composed.map((m) => m.to)).toEqual(COACHES.map((c) => c.email));
    for (const m of composed) expect(m.send).toBe(false);
  });

  it('greets the first coach, the one the preview greeted', async () => {
    /**
     * With several contacts at a programme the body is composed ONCE, greeting
     * the most senior — `draftOutreach` sorts by seniority before choosing —
     * and the same body goes to each. Greeting anyone else would put a
     * different name in front of the operator than the one they approved.
     */
    const athlete = makeAthlete();
    const evidence = evidenceOf(athlete, 'hookOnly');
    await draftOne({ athlete, college: COLLEGE, coaches: COACHES, evidence });
    for (const m of composed) {
      expect(m.body).toContain(`Hi ${COACHES[0].name.split(' ')[0]},`);
      expect(m.body).not.toContain(COACHES[1].name.split(' ')[0] + ',');
    }
    expect(unwrap(composed[0].body)).toBe(preview(athlete, evidence).body);
  });

  it('writes nothing when composition cannot produce a body', async () => {
    const athlete = makeAthlete();
    const evidence = evidenceOf(athlete, 'hookOnly');
    await expect(draftOne({
      athlete: { ...athlete, id: null }, college: COLLEGE, coaches: [COACHES[0]], evidence,
    })).rejects.toThrow();
    expect(composed).toHaveLength(0);
  });

  it('writes nothing when there is no recipient', async () => {
    // It returns an empty result rather than throwing, which is right for a
    // batch that skips a programme with no reachable coach. What matters is
    // that nothing was opened in Outlook.
    const athlete = makeAthlete();
    const evidence = evidenceOf(athlete, 'hookOnly');
    const { results } = await draftOne({ athlete, college: COLLEGE, coaches: [], evidence });
    expect(results).toEqual([]);
    expect(composed).toHaveLength(0);
  });

  it('reports a writer failure rather than counting it as drafted', async () => {
    const athlete = makeAthlete();
    const evidence = evidenceOf(athlete, 'hookOnly');
    failNext = 'Outlook does not appear to be running.';
    const { results } = await draftOne({ athlete, college: COLLEGE, coaches: [COACHES[0]], evidence });
    expect(results[0].status).not.toBe('drafted');
    expect(results[0].error).toBeTruthy();
    expect(composed).toHaveLength(0);
  });
});

describe('the draft path owns no policy of its own', () => {
  const source = readFileSync(new URL('./draftOutreach.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  it('references no retired policy machinery', () => {
    for (const gone of ['selectFrom', 'emailEligible', 'canLead', 'leadSuitability',
      'FACT_BONUS', 'INTERNATIONAL_PRIOR', 'result.legacy', 'DISPOSITION']) {
      expect(source, gone).not.toContain(gone);
    }
  });

  it('makes no evidence decision of its own', () => {
    /**
     * It may not rank, dedupe, choose a structure, write a clause or read a
     * permission. Every one of those has an owner, and a second implementation
     * here would be a draft-only policy — the exact shape H6 spent a stage
     * removing from the wire.
     */
    for (const owned of ['outreachEvidenceFor', 'applyPrefer', 'planFromRoles',
      'resolveStructure', 'outreachCopyFor', 'permissionsFor', 'permissions.OUTREACH',
      'outreachPermitted', 'priorityOf', 'baseStrength']) {
      expect(source, owned).not.toContain(owned);
    }
    // What it DOES call: the evidence engine, the one composer, the one writer.
    expect(source).toContain('evidenceFor(');
    expect(source).toContain('emailBodyFor(');
    expect(source).toContain('sendOutreach(');
  });

  it('sorts coaches and nothing else', () => {
    // Two sorts in the file: coach seniority, and a tally for the summary.
    const sorts = source.match(/\.sort\(/g) ?? [];
    expect(sorts).toHaveLength(2);
    expect(source).toContain('staff.sort(bySeniority)');
  });

  it('composes nothing when merely imported', () => {
    // `main()` runs only as a command. Importing this module — which this file
    // has already done — must not have drafted anything.
    expect(source).toContain('if (import.meta.url === `file://${process.argv[1]}`) main();');
    expect(composed).toHaveLength(0);
  });
});
