import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toWire } from './evidence.js';
import { selectEvidence } from '../../shared/evidence/index.js';
import { outreachEvidenceFor, applyPrefer, ROLES } from '../../shared/evidence/outreachEvidence.js';
import { defineEvidence, CONFIDENCE, kindLabel } from '../../shared/evidence/kinds.js';

/**
 * ONE OWNER FOR OUTBOUND DECISION STATE.
 *
 * `toWire` used to take `selected` and `available` from the outbound selector
 * and `disposition` and `reason` from the LEGACY selector's diagnostic log —
 * a different engine, ranking by strength and category prior across nineteen
 * kinds under a policy that decides nothing outbound.
 *
 * For most programmes the two happened to agree. At five they did not, and the
 * wire then said the claim being SENT was "suppressed as redundant" and the
 * claim being OFFERED was "selected", with no reason. Both statements were
 * true about an email nobody was sending.
 *
 * Every assertion here is about provenance rather than about a value: what
 * matters is not that the reason reads well but that only one engine wrote it.
 */

const src = { source: 'roster_players', confidence: CONFIDENCE.HIGH, season: '2026' };
const ev = (kind, data) => defineEvidence(kind, { ...src, data });

/** The Saint Louis shape: two congratulations, one connection, engines disagreeing. */
const TWO_CONGRATULATIONS = () => [
  ev('CONFERENCE_TITLE', { conference: 'ACC' }),
  ev('POSTSEASON_RESULT', { round: 'semi' }),
];

const dispositionOf = (result, kind) => (result.dispositions ?? []).find((d) => d.kind === kind);

// ---------------------------------------------------------------------------

describe('the outbound selector accounts for every kind it saw', () => {
  it('records what it SENT, not only what it dropped', () => {
    // The winners used to be absent from the log entirely, which is why the
    // wire had to infer them from somewhere else.
    const r = outreachEvidenceFor({ all: TWO_CONGRATULATIONS() });
    const sent = dispositionOf(r, r.recognition[0].kind);
    expect(sent.disposition).toBe('SELECTED');
    expect(sent.reason).toBeNull();
    expect(sent.order).toBe(0);
    expect(sent.role).toBe(ROLES.RECOGNITION);
  });

  it('names what superseded a deduped claim, in the registry\'s WORDS', () => {
    const r = outreachEvidenceFor({ all: TWO_CONGRATULATIONS() });
    const loser = r.alternatives[0].kind;
    const d = dispositionOf(r, loser);
    expect(d.disposition).toBe('DEDUPED');
    expect(d.supersededBy).toBe(r.recognition[0].kind);
    // Not the key. The panel holds no vocabulary of its own, so a constant
    // written here reaches an operator as a constant.
    expect(d.reason).toContain(kindLabel(r.recognition[0].kind).toLowerCase());
    expect(d.reason).not.toMatch(/[A-Z]{3,}_[A-Z_]{3,}/);
  });

  it('gives every kind exactly one outcome', () => {
    const r = outreachEvidenceFor({ all: TWO_CONGRATULATIONS() });
    const kinds = r.dispositions.map((d) => d.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(new Set(kinds)).toEqual(new Set(['CONFERENCE_TITLE', 'POSTSEASON_RESULT']));
  });
});

describe('an operator swap rewrites the decision, not just the email', () => {
  const both = () => outreachEvidenceFor({ all: TWO_CONGRATULATIONS() });

  it('makes the preferred claim SELECTED and the default DEDUPED behind it', () => {
    const before = both();
    const winner = before.recognition[0].kind;
    const other = before.alternatives[0].kind;

    const after = applyPrefer(before, [other]);
    expect(after.recognition.map((i) => i.kind)).toEqual([other]);
    expect(dispositionOf(after, other).disposition).toBe('SELECTED');
    expect(dispositionOf(after, winner).disposition).toBe('DEDUPED');
    expect(dispositionOf(after, winner).supersededBy).toBe(other);
  });

  it('does not leave the old winner describing itself as sent', () => {
    // Spreading the selector's result carried its notes through untouched, so
    // the panel would have described the email it had stopped sending.
    const before = both();
    const winner = before.recognition[0].kind;
    const after = applyPrefer(before, [before.alternatives[0].kind]);
    expect(dispositionOf(after, winner).disposition).not.toBe('SELECTED');
    expect(dispositionOf(after, winner).reason).toBeTruthy();
  });

  it('says a claim was dropped when nothing replaced it', () => {
    const before = outreachEvidenceFor({
      all: [
        ev('COACH_ARRIVAL_SAME_COUNTRY', { coach: 'A', country: 'New Zealand', count: 1, seasons: ['2025'] }),
        ev('CONFERENCE_TITLE', { conference: 'ACC' }),
      ],
    });
    const after = applyPrefer(before, ['COACH_ARRIVAL_SAME_COUNTRY']);
    const d = dispositionOf(after, 'CONFERENCE_TITLE');
    expect(d.disposition).toBe('DESELECTED');
    // Not DENIED, not UNQUALIFIED, not INTERNAL_ONLY — it was a valid claim.
    expect(d.reason).toBe('not part of the order you chose');
  });

  it('leaves an unlicensed kind exactly as it found it', () => {
    const before = outreachEvidenceFor({
      all: [...TWO_CONGRATULATIONS(), ev('TRANSFER_BEHAVIOUR', { rate: 0.2, squad: 25 })],
    });
    const after = applyPrefer(before, [before.alternatives[0].kind]);
    expect(dispositionOf(after, 'TRANSFER_BEHAVIOUR'))
      .toEqual(dispositionOf(before, 'TRANSFER_BEHAVIOUR'));
  });
});

describe('the wire carries the outbound decision and nothing else', () => {
  const athlete = { full_name: 'Rhys Davies', nationality: 'New Zealand', position: 'Defender', sport: 'mens-soccer' };
  const ctx = (over = {}) => ({
    college: {
      name: 'Test', sport: 'mens-soccer',
      conference_champion_2025: true, conference_champion_name: 'ACC',
      postseason_2025_round: 'semi',
    },
    sport: 'mens-soccer',
    ...over,
  });

  it('agrees with the selector on every entry, kind for kind', () => {
    const result = selectEvidence(athlete, ctx());
    const wire = toWire(result);
    const own = new Map(result.roles.dispositions.map((d) => [d.kind, d]));
    for (const a of wire.available ?? []) {
      expect(a.disposition, a.kind).toBe(own.get(a.kind)?.disposition ?? null);
      expect(a.reason, a.kind).toBe(own.get(a.kind)?.reason ?? null);
    }
    expect(wire.dispositions).toEqual(result.roles.dispositions);
  });

  it('carries none of the legacy selector\'s vocabulary', () => {
    // SUPPRESSED_REDUNDANT, BELOW_THRESHOLD and AVAILABLE are `select.js`
    // words. INTERNAL_ONLY too — outbound calls that NOT_LICENSED, because the
    // question it answers is about a licence rather than about ranking.
    const wire = toWire(selectEvidence(athlete, ctx()));
    const seen = new Set([
      ...(wire.dispositions ?? []).map((d) => d.disposition),
      ...(wire.available ?? []).map((a) => a.disposition),
      ...(wire.otherKnown ?? []).map((o) => o.disposition),
    ].filter(Boolean));
    for (const legacyWord of ['SUPPRESSED_REDUNDANT', 'BELOW_THRESHOLD', 'AVAILABLE', 'INTERNAL_ONLY']) {
      expect(seen, legacyWord).not.toContain(legacyWord);
    }
  });

  it('does not join the legacy log into an outbound entry', () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'evidence.js'), 'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

    // The one disposition map, built from the outbound account.
    expect(source).toContain('const dispositionOf = new Map((result.dispositions ?? [])');
    expect(source).not.toContain('selectFrom');

    /**
     * The legacy arrays may still be PASSED THROUGH — that is what the
     * `legacy_` prefix is for — and may never be read into an entry. Asserted
     * line by line: every mention sits on a line that names it legacy.
     */
    for (const [i, line] of source.split('\n').entries()) {
      if (!/result\.(legacy|suppressed|belowThreshold|rejected)\b/.test(line)) continue;
      expect(line.trim(), `line ${i + 1}`).toMatch(/^legacy_/);
    }
  });

  it('holds the dedupe losers as OFFERS, not as things it could not use', () => {
    /**
     * The list the panel puts them in. `otherKnown` used to be the legacy
     * `suppressed` + `belowThreshold` arrays, which on live data held exactly
     * the dedupe losers `available` was already offering — so the panel's
     * collapsed drawer held the swappable claims and "Other strong options"
     * held whatever the legacy engine had happened to pick instead.
     */
    const result = selectEvidence(athlete, ctx());
    const wire = toWire(result);
    const deduped = (wire.dispositions ?? []).filter((d) => d.disposition === 'DEDUPED').map((d) => d.kind);
    expect(deduped.length).toBeGreaterThan(0);
    for (const kind of deduped) {
      expect(wire.available.map((a) => a.kind), kind).toContain(kind);
      expect(wire.otherKnown.map((o) => o.kind), kind).not.toContain(kind);
    }
  });

  it('keeps held status the composition\'s answer, not the selector\'s', () => {
    // `displayed` says whether the EMAIL carries a claim, which is a placement
    // question. The selector licenses; composition decides what fits.
    const result = selectEvidence(athlete, ctx({
      history: [{
        season: '2023', player_name: 'Kiwi', country: 'New Zealand',
        nationality: 'International', position: 'D', class_year: 'Fr.',
      }],
      notable_majors: ['Kinesiology'],
    }));
    const wire = toWire(result);
    const placement = new Map((result.composition?.placement ?? []).map((p) => [p.kind, p.displayed !== false]));
    for (const e of wire.selected) expect(e.displayed, e.kind).toBe(placement.get(e.kind) ?? false);
  });

  it('leaves the legacy answer computable, under its own name', () => {
    // It is not deleted. An analysis comparing the two policies needs the old
    // one, and the panel is simply no longer one of its readers.
    const result = selectEvidence(athlete, ctx());
    expect(result.legacy).toBeTruthy();
    expect(result.legacy.dispositions.length).toBeGreaterThan(0);
    // And it may disagree, harmlessly, because nothing operator-facing reads it.
    expect(result.dispositions).not.toEqual(result.legacy.dispositions);
  });
});
