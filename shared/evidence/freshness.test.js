import { describe, it, expect } from 'vitest';
import {
  rosterFreshness, applyFreshness, ageInDays, isFreshnessSensitive,
  FRESHNESS, FRESH_DAYS, ACCEPTABLE_DAYS,
} from './freshness.js';
import {
  selectEvidence, EVIDENCE_KINDS, EVIDENCE_KIND_NAMES, TEMPORALITY, TIERS,
  renderEvidence, kindSpec,
} from './index.js';

const NOW = Date.parse('2026-08-28T00:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

const nzDefender = {
  full_name: 'Rhys Davies', position: 'Defender',
  nationality: 'New Zealand', recruiting_class_year: 2027, sport: 'mens-soccer',
};
const college = (o = {}) => ({ name: 'Example University', sport: 'mens-soccer', notable_majors: [], ...o });
const row = (o = {}) => ({
  college_name: 'Example University', sport: 'mens-soccer', season: '2026',
  player_name: 'A Player', position: 'D', minutes_played: null, projected_minutes: 600,
  estimated_graduation_year: 2029, eligibility_end_year: 2028, class_year_label: 'Jr.',
  nationality: 'USA', country: '', prior_programme: null, updated_date: daysAgo(1), ...o,
});
const squadOf = (n, o = {}) => Array.from({ length: n }, (_, i) => row({ player_name: `P${i}`, ...o }));

describe('reading the scrape date', () => {
  it('measures age in whole days', () => {
    expect(ageInDays(daysAgo(0), NOW)).toBe(0);
    expect(ageInDays(daysAgo(45), NOW)).toBe(45);
    expect(ageInDays(null, NOW)).toBeNull();
    expect(ageInDays('not a date', NOW)).toBeNull();
  });

  it('never reports a future stamp as fresher than new', () => {
    // Clock skew between an import host and this one must not make a roster
    // look better than it is.
    expect(ageInDays(new Date(NOW + 5 * 86400000).toISOString(), NOW)).toBe(0);
  });

  it('grades against the transfer-window thresholds', () => {
    const at = (n) => rosterFreshness({ updatedAt: daysAgo(n), now: NOW }).state;
    expect(at(1)).toBe(FRESHNESS.CURRENT);
    expect(at(FRESH_DAYS)).toBe(FRESHNESS.CURRENT);
    expect(at(FRESH_DAYS + 1)).toBe(FRESHNESS.ACCEPTABLE);
    expect(at(ACCEPTABLE_DAYS)).toBe(FRESHNESS.ACCEPTABLE);
    expect(at(ACCEPTABLE_DAYS + 1)).toBe(FRESHNESS.STALE);
  });

  it('calls a missing stamp UNKNOWN rather than fresh', () => {
    expect(rosterFreshness({ updatedAt: null, now: NOW }).state).toBe(FRESHNESS.UNKNOWN);
  });

  it('is stale whatever the date says when the season itself is behind', () => {
    const f = rosterFreshness({ updatedAt: daysAgo(0), now: NOW, seasonBehind: true });
    expect(f.state).toBe(FRESHNESS.STALE);
    expect(f.reason).toMatch(/season/);
  });
});

describe('the policy is applied by temporality, not by kind', () => {
  const stale = { state: FRESHNESS.STALE, ageDays: 200 };
  const acceptable = { state: FRESHNESS.ACCEPTABLE, ageDays: 90 };

  it('exempts historical evidence — an old source is the point of it', () => {
    const spec = kindSpec('HISTORICAL_SAME_COUNTRY');
    expect(spec.temporality).toBe(TEMPORALITY.HISTORICAL);
    expect(applyFreshness(spec, 'HIGH', stale)).toBe('HIGH');
  });

  it('exempts static evidence, which is not roster-derived at all', () => {
    for (const kind of ['CONFERENCE_TITLE', 'ACADEMIC_FIT', 'COACH_CONTEXT', 'PROGRAM_MOMENTUM']) {
      expect(applyFreshness(kindSpec(kind), 'HIGH', stale), kind).toBe('HIGH');
    }
  });

  it('SUPPRESSES a stale present-tense claim rather than hedging it', () => {
    // There is no wording that makes naming a possibly-departed player safe.
    expect(applyFreshness(kindSpec('CURRENT_SAME_COUNTRY'), 'HIGH', stale)).toBeNull();
    expect(applyFreshness(kindSpec('INTERNATIONAL_ROSTER'), 'HIGH', stale)).toBeNull();
    expect(applyFreshness(kindSpec('POSITION_GRADUATION'), 'HIGH', stale)).toBeNull();
  });

  it('downgrades rather than suppresses a projected claim', () => {
    // Already hedged and already about an unplayed season; a stale source
    // makes it too soft to use, which the confidence floors then enforce.
    expect(applyFreshness(kindSpec('RETURNING_POSITION_DEPTH'), 'MEDIUM', stale)).toBe('LOW');
    expect(applyFreshness(kindSpec('POSITION_GRADUATION_STARTERS'), 'HIGH', stale)).toBe('MEDIUM');
  });

  it('drops a step at ACCEPTABLE and at UNKNOWN alike', () => {
    expect(applyFreshness(kindSpec('CURRENT_SAME_COUNTRY'), 'HIGH', acceptable)).toBe('MEDIUM');
    expect(applyFreshness(kindSpec('CURRENT_SAME_COUNTRY'), 'HIGH', { state: FRESHNESS.UNKNOWN })).toBe('MEDIUM');
  });

  it('classifies every kind, and marks the roster-dependent ones sensitive', () => {
    for (const kind of EVIDENCE_KIND_NAMES) {
      const spec = EVIDENCE_KINDS[kind];
      expect(Object.values(TEMPORALITY), kind).toContain(spec.temporality);
      const sensitive = spec.temporality === TEMPORALITY.CURRENT
        || spec.temporality === TEMPORALITY.PROJECTED;
      expect(isFreshnessSensitive(spec), kind).toBe(sensitive);
    }
  });
});

describe('end to end, through selectEvidence', () => {
  const squad = [
    row({ country: 'New Zealand', player_name: 'Kiwi Now' }),
    ...squadOf(20, { position: 'M', country: 'Spain' }),
  ];
  const history = [row({ season: '2023', country: 'New Zealand', player_name: 'Kiwi Then' })];

  it('keeps present-tense evidence when the roster was read yesterday', () => {
    const r = selectEvidence(nzDefender, { college: college(), squad, now: NOW });
    expect(r.programme.freshness.state).toBe(FRESHNESS.CURRENT);
    expect(r.all.map((e) => e.kind)).toContain('CURRENT_SAME_COUNTRY');
  });

  it('drops present-tense evidence when the roster is stale, and keeps history', () => {
    const old = squad.map((r) => ({ ...r, updated_date: daysAgo(200) }));
    const r = selectEvidence(nzDefender, { college: college(), squad: old, history, now: NOW });

    expect(r.programme.freshness.state).toBe(FRESHNESS.STALE);
    const kinds = r.all.map((e) => e.kind);
    expect(kinds).not.toContain('CURRENT_SAME_COUNTRY');
    expect(kinds).not.toContain('INTERNATIONAL_ROSTER');
    // The historical claim names its own window and survives, which is the
    // whole point of separating the two.
    expect(kinds).toContain('HISTORICAL_SAME_COUNTRY');
    expect(r.paragraph).toContain('since 2023');
  });

  it('never renders a present-tense sentence from a stale roster', () => {
    const old = squad.map((r) => ({ ...r, updated_date: daysAgo(300) }));
    const r = selectEvidence(nzDefender, { college: college(), squad: old, history, now: NOW });
    const text = r.sentences.map((s) => s.text).join(' ');
    expect(text).not.toMatch(/currently have|current roster|current squad/);
  });

  it('carries the freshness reading on each affected piece, for the operator', () => {
    const old = squad.map((r) => ({ ...r, updated_date: daysAgo(90) }));
    const r = selectEvidence(nzDefender, { college: college(), squad: old, now: NOW });
    const ev = r.all.find((e) => e.kind === 'CURRENT_SAME_COUNTRY');
    expect(ev.confidenceBeforeFreshness).toBe('HIGH');
    expect(ev.confidence).toBe('MEDIUM');
    expect(ev.freshness.ageDays).toBe(90);
    expect(ev.freshness.reason).toContain('90 days');
  });

  it('reports the roster age on the programme even when nothing was affected', () => {
    const r = selectEvidence(nzDefender, { college: college(), squad, now: NOW });
    expect(r.programme.rosterAgeDays).toBe(1);
  });
});

/**
 * Item 5 of the brief, enforced rather than reviewed.
 *
 * "Come through the programme since 2026" reached real prose for a player only
 * on the current unplayed roster. The registry now says what period each kind
 * claims, and this asserts the copy agrees with it — so a new renderer cannot
 * be written in the wrong tense without a test failing.
 */
describe('temporal language matches declared temporality', () => {
  // Written as what each temporality must NOT do, plus a narrow positive check
  // on the kinds where ambiguity would actually mislead.
  //
  // A general "is this present tense" regex is not expressible: "you have two
  // defenders in the 2027 graduating group" is present tense and contains none
  // of the words a naive pattern looks for. The bug this guards against is
  // specific — a CURRENT kind borrowing the language of history — so that is
  // what is asserted.
  const HISTORY_LANGUAGE = /\b(come through|have included|used to|previously)\b|\b(since|back in) \d{4}\b/i;
  /**
   * A historical claim must be anchored to a stated season, never left to
   * sound like the present.
   *
   * `in 2025` counts alongside `back in 2023`: the recent-year rule now writes
   * "in {year}" for anything within two seasons of SQUAD_SEASON, because "back
   * in 2026" was being said about the season that has not been played. Both
   * forms name an absolute year, which is what this rule is protecting; a
   * relative phrase like "this year" still fails it, and so does the present
   * tense.
   */
  const SPAN = /\b(have included|come through)\b|\b(since|back in|in) \d{4}\b/i;
  const HEDGE = /\b(looks? like|looked like|going off|based on|could|around|by \d{4}|as many as|a few)\b/i;
  const FUTURE = /\bwill\b|\bgoing to\b/i;

  /**
   * What anchors a claim to the squad as it stands NOW.
   *
   * Was a bare /current(ly)?/ check. The conversational copy says "you've
   * already got a Kiwi on the roster" and "a good chunk of your squad is
   * international", neither of which contains the word "current" and both of
   * which are unambiguously about the present squad — so matching on the word
   * was matching a proxy rather than the property.
   *
   * This is not a weakening: the ambiguity being guarded against is "you have
   * one New Zealander", which could mean ever. An explicit roster or squad
   * anchor rules that out, and the negative assertions above — no "come
   * through", no "since 2022" — remain the stronger half of the guard.
   */
  const PRESENT_ANCHOR = /\bcurrent(ly)?\b|\bon the roster\b|\byour (current )?squad\b/i;

  const sample = (kind) => {
    const data = {
      country: 'New Zealand', count: 2, names: ['A', 'B'], countries: ['Australia'],
      region: 'OCEANIA', athleteCountry: 'New Zealand', uniqueCountries: 3,
      position: 'DEFENSE', classYear: 2027, total: 2, returning: 2, groupSize: 5,
      players: 2, projectedMinutes: 900, share: 0.4, squadSize: 25, classifiedSquad: 25,
      round: 'semi', conference: 'ACC', major: 'Business', name: 'Pat Smith',
      seasonsObserved: 3, windowBounded: false, classification: 'RISING',
      recentWinPct: 0.7, priorWinPct: 0.5, basis: 'projected', arrivals: 4,
    };
    return { kind, tier: EVIDENCE_KINDS[kind].tier, data, season: '2022-2025' };
  };

  const renderable = (kind) => EVIDENCE_KINDS[kind].emailEligible || kind === 'POSITION_GROUP_SIZE';

  it('never lets a CURRENT kind borrow the language of history', () => {
    // This is the "come through the programme since 2026" bug, as a rule.
    for (const kind of EVIDENCE_KIND_NAMES) {
      if (EVIDENCE_KINDS[kind].temporality !== TEMPORALITY.CURRENT) continue;
      if (!renderable(kind)) continue;
      const text = renderEvidence(sample(kind));
      expect(text, `${kind}: ${text}`).not.toMatch(HISTORY_LANGUAGE);
      expect(text, `${kind}: ${text}`).not.toMatch(FUTURE);
    }
  });

  it('anchors a roster-membership claim to the present squad', () => {
    // "You have one New Zealander" could be read as ever; these must not be.
    for (const kind of ['CURRENT_SAME_COUNTRY', 'INTERNATIONAL_ROSTER', 'INTERNATIONAL_SHARE']) {
      const text = renderEvidence(sample(kind));
      expect(text, `${kind}: ${text}`).toMatch(PRESENT_ANCHOR);
    }
  });

  /**
   * Both variants, not just the opener.
   *
   * Every kind now renders two ways — a lead sentence and a support clause —
   * and the support clause is the one that appears in most emails, because
   * only one piece of evidence per email leads. Checking only the default
   * would leave the form that ships most often unguarded.
   */
  it('holds for the support variant as well as the lead', () => {
    for (const kind of EVIDENCE_KIND_NAMES) {
      const spec = EVIDENCE_KINDS[kind];
      if (!renderable(kind)) continue;
      const text = renderEvidence(sample(kind), { slot: 'SUPPORT', firstName: 'Rhys' });
      if (spec.temporality === TEMPORALITY.CURRENT) {
        expect(text, `${kind}: ${text}`).not.toMatch(HISTORY_LANGUAGE);
        expect(text, `${kind}: ${text}`).not.toMatch(FUTURE);
      }
      if (spec.temporality === TEMPORALITY.HISTORICAL) {
        expect(text, `${kind}: ${text}`).toMatch(SPAN);
        expect(text, `${kind}: ${text}`).not.toMatch(/\bcurrently\b/i);
      }
      if (spec.temporality === TEMPORALITY.PROJECTED) {
        expect(text, `${kind}: ${text}`).toMatch(HEDGE);
      }
    }
  });

  it('writes HISTORICAL kinds as a span, never as the present', () => {
    for (const kind of EVIDENCE_KIND_NAMES) {
      if (EVIDENCE_KINDS[kind].temporality !== TEMPORALITY.HISTORICAL) continue;
      const text = renderEvidence(sample(kind));
      expect(text, `${kind}: ${text}`).toMatch(SPAN);
      expect(text, `${kind} must not claim the present`).not.toMatch(/\bcurrently\b/i);
    }
  });

  it('writes PROJECTED kinds as hedged, and never as a bare fact', () => {
    for (const kind of EVIDENCE_KIND_NAMES) {
      const spec = EVIDENCE_KINDS[kind];
      if (spec.temporality !== TEMPORALITY.PROJECTED) continue;
      // Every projected kind is a SIGNAL by construction — a claim about an
      // unplayed season cannot be a fact.
      expect(spec.tier, kind).toBe(TIERS.SIGNAL);
      const text = renderEvidence(sample(kind));
      expect(text, `${kind}: ${text}`).toMatch(HEDGE);
    }
  });

  it('never lets a CURRENT kind be a SIGNAL-free assertion about the future', () => {
    for (const kind of EVIDENCE_KIND_NAMES) {
      if (EVIDENCE_KINDS[kind].temporality !== TEMPORALITY.CURRENT) continue;
      if (!EVIDENCE_KINDS[kind].emailEligible && kind === 'TRANSFER_BEHAVIOUR') continue;
      expect(renderEvidence(sample(kind)), kind).not.toMatch(/\bwill\b|\bgoing to\b/i);
    }
  });
});
