import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { selectEvidence } from './index.js';
import { internalEvidence } from './outreachEvidence.js';
import { generateEvidence, buildProgrammeContext } from './generate.js';
import { outreachEvidenceFor } from './outreachEvidence.js';
import {
  defineEvidence, CONFIDENCE, permissionsFor, PERMISSION, kindSpec, confidenceAtLeast,
} from './kinds.js';

/**
 * THE LEGACY SELECTOR DOES NOT RUN.
 *
 * `selectFrom` decided what an email said until G4, decided nothing after it,
 * explained nothing after H6 — and still executed on every production request
 * until H7, sorting the whole collection by strength, deduping it, filling
 * slot floors and building a parallel disposition log, so that four fields
 * could be derived from it. Three were diagnostics nothing read. The fourth
 * was `internal`, which is a licence question.
 *
 * This file is the tripwire. It fails if the old policy is reintroduced into a
 * production path, whether by an import, a call, or a field quietly derived
 * from one — and it deliberately does NOT fail on the function existing, being
 * exported, or being called by a test or a diagnostic script. The point is
 * where it runs, not whether it exists.
 */

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const athlete = {
  full_name: 'Rhys Davies', nationality: 'New Zealand', position: 'Defender',
  intended_major: 'Business', recruiting_class_year: 2027, sport: 'mens-soccer',
};
/** A roster row, so the internal roster kinds are actually generated. */
const row = (o = {}) => ({
  college_name: 'Test', sport: 'mens-soccer', season: '2026',
  updated_date: new Date().toISOString().slice(0, 10),
  player_name: 'A Player', position: 'D', minutes_played: null,
  projected_minutes: 600, estimated_graduation_year: 2029,
  eligibility_end_year: 2028, class_year_label: 'Jr.',
  nationality: 'USA', country: '', prior_programme: null, ...o,
});

const ctx = () => ({
  college: {
    name: 'Test', sport: 'mens-soccer',
    conference_champion_2025: true, conference_champion_name: 'ACC',
    postseason_2025_round: 'semi', notable_majors: ['Business'],
  },
  sport: 'mens-soccer',
  squad: [
    ...Array.from({ length: 20 }, (_, i) => row({ player_name: `P${i}` })),
    ...Array.from({ length: 4 }, (_, i) => row({ player_name: `I${i}`, nationality: 'International', country: 'Spain' })),
    row({ player_name: 'Kiwi Now', nationality: 'International', country: 'New Zealand' }),
  ],
  history: [{
    season: '2023', player_name: 'Kiwi', country: 'New Zealand',
    nationality: 'International', position: 'D', class_year: 'Fr.',
  }],
});

// ---------------------------------------------------------------------------

describe('no production path runs the legacy selector', () => {
  it('the assembly point neither imports nor calls it', () => {
    const index = code('shared/evidence/index.js');
    expect(index).not.toContain('selectFrom(');
    // `priorityOf` is a comparator and may still be used to order a list.
    // `selectFrom` is the ranking-plus-dedupe-plus-slot-floors engine.
    expect(index).toContain('outreachEvidenceFor(');
  });

  it('the composer route neither imports nor calls it', () => {
    const route = code('server/routes/evidence.js');
    expect(route).not.toContain('selectFrom');
    expect(route).not.toContain('result.legacy');
  });

  it('the send path neither imports nor calls it', () => {
    expect(code('server/routes/sendOutreach.js')).not.toContain('selectFrom');
  });

  it('the panel cannot reach it, because the wire does not carry it', () => {
    const result = selectEvidence(athlete, ctx());
    for (const gone of ['legacy', 'ranked', 'usable', 'suppressed', 'belowThreshold', 'rejected']) {
      expect(result, gone).not.toHaveProperty(gone);
    }
  });
});

describe('the fields it used to own are derived from the licence', () => {
  it('holds exactly the kinds the registry bars from an email', () => {
    /**
     * H7 proved this against `selectFrom` — 3,498 pairings, zero differences
     * in either direction — and H8 deleted the function, so the comparison
     * cannot be made any more. The rule it proved is asserted directly
     * instead, which is what the comparison was standing in for.
     */
    const evidence = generateEvidence(athlete, buildProgrammeContext(ctx()));
    const internal = internalEvidence(evidence);
    expect(internal.length).toBeGreaterThan(0);
    for (const ev of internal) {
      expect(permissionsFor(ev.kind).OUTREACH, ev.kind).toBe(PERMISSION.DENIED);
      expect(confidenceAtLeast(ev.confidence, kindSpec(ev.kind).minConfidence), ev.kind).toBe(true);
    }
    // And nothing licensed is hidden in it.
    const licensed = evidence.filter((e) => permissionsFor(e.kind).OUTREACH !== PERMISSION.DENIED);
    expect(licensed.length).toBeGreaterThan(0);
    for (const ev of licensed) {
      expect(internal.map((e) => e.kind), ev.kind).not.toContain(ev.kind);
    }
  });

  it('does not equate internal with the NOT_LICENSED dispositions', () => {
    /**
     * The distinction H7 had to get right. The selector tests the licence
     * FIRST and never reaches the confidence check for an unlicensed kind, so
     * its `NOT_LICENSED` list also holds kinds below their own floor — 1,343
     * more items across the live corpus. Those are not things we know and are
     * choosing not to say; they are things we do not know.
     */
    // An unlicensed kind, below its own confidence floor. Constructed rather
    // than fished out of a fixture: the point is the rule, and a programme
    // that happens not to produce one proves nothing either way.
    const weak = defineEvidence('POSITION_GROUP_SCARCITY', {
      source: 'test', confidence: CONFIDENCE.LOW, season: '2026',
      data: { position: 'DEFENSE', returning: 1, squad: 25 },
    });
    const strong = defineEvidence('TRANSFER_BEHAVIOUR', {
      source: 'test', confidence: CONFIDENCE.HIGH, season: '2026',
      data: { rate: 0.2, squad: 25 },
    });

    // Both are unlicensed, so both are NOT_LICENSED in the dispositions...
    const notes = outreachEvidenceFor({ all: [weak, strong] }).dispositions;
    expect(notes.filter((d) => d.disposition === 'NOT_LICENSED').map((d) => d.kind).sort())
      .toEqual(['POSITION_GROUP_SCARCITY', 'TRANSFER_BEHAVIOUR']);

    // ...and only the one we are sure enough of is something we KNOW and are
    // choosing not to say.
    expect(internalEvidence([weak, strong]).map((e) => e.kind)).toEqual(['TRANSFER_BEHAVIOUR']);

  });

  it('reports the operator\'s own choice from the function that honoured it', () => {
    const plain = selectEvidence(athlete, ctx());
    const swapped = selectEvidence(athlete, ctx(), { prefer: ['NOT_A_KIND'] });
    expect(plain.operatorSelected).toBe(false);
    expect(swapped.unavailableRequests).toEqual(['NOT_A_KIND']);
    expect(swapped.operatorSelected).toBe(plain.roles.operatorSelected);
  });

  it('names the outbound selector\'s own pick as `engineSelected`', () => {
    // It named the LEGACY engine's pick until H7 — an engine that had not
    // chosen anything for two stages. With no operator preference it is
    // exactly what the email carries.
    const result = selectEvidence(athlete, ctx());
    expect(result.engineSelected).toEqual(result.selected.map((e) => e.kind));
  });
});

describe('the old policy is not there at all', () => {
  it('is gone from the source, not merely unreferenced', () => {
    /**
     * H7 left `selectFrom` exported and tested, on the argument that a policy
     * comparison might still be wanted. H8 asked what decision anyone would
     * make from it and found none: it ranks by strength across nineteen kinds,
     * sixteen of which cannot be emailed, and where it disagrees with the
     * outbound selector it is the one that is wrong.
     *
     * A retired policy that still compiles is a policy someone can call.
     */
    // Scanned as CODE. The file still explains what it used to be and why it
    // is not that any more, which is a current safety boundary rather than
    // nostalgia — the next author needs to know the ranking is not coming back.
    const select = code('shared/evidence/select.js');
    for (const gone of ['selectFrom', 'fillSlots', 'dispositionsFor', 'SLOT_FLOORS',
      'MAX_PER_FAMILY', 'DISPOSITION', 'dedupe(']) {
      expect(select, gone).not.toContain(gone);
    }
  });

  it('left its shared helpers behind, because those have live callers', () => {
    // `select.js` is not deleted: `outreachPermitted`, `meetsConfidence`,
    // `priorityOf`, `familyOf`, `FAMILY_LABELS` and `MAX_EMAIL_EVIDENCE` all
    // answer registry questions that outlived the engine that asked them.
    const select = read('shared/evidence/select.js');
    for (const kept of ['export function outreachPermitted', 'export function meetsConfidence',
      'export function priorityOf', 'export function familyOf', 'export const FAMILY_LABELS',
      'export const MAX_EMAIL_EVIDENCE']) {
      expect(select, kept).toContain(kept);
    }
  });

  it('costs a production request nothing, because there is nothing to run', () => {
    const result = selectEvidence(athlete, ctx());
    expect(result.selected.length).toBeGreaterThan(0);
    expect(result.internal.length).toBeGreaterThan(0);
    expect(result.dispositions.length).toBeGreaterThan(0);
  });
});
