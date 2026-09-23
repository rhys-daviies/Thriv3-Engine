import { describe, it, expect } from 'vitest';
import {
  PROGRAMME_STATUS, STATUS_REASON, TARGET_SEASON, STATUSES,
  activeForSeason, validateStatus, allowedReasonsFor,
} from './programmeStatus.js';

/**
 * L7P — whether a programme is fielded in a season.
 *
 * The defect being guarded is a boolean pretending to be a timeline.
 * `colleges.active` is already programme-level — Montana State Billings has
 * carried `mens-soccer active=0` beside `womens-soccer active=1` for some time —
 * so granularity was never the problem. Time was: Wisconsin-Oshkosh's men's side
 * is not fielded in 2026 and is fielded from 2027, and `active = 0` records that
 * as gone forever.
 */

const notActive = (to) => ({ status: PROGRAMME_STATUS.NOT_ACTIVE, activeToSeason: to });
const future = (from) => ({ status: PROGRAMME_STATUS.FUTURE, activeFromSeason: from });

describe('activeForSeason', () => {
  it('1. no status row leaves behaviour exactly as it was', () => {
    for (const y of [2022, 2024, 2026, 2030]) expect(activeForSeason(null, y)).toBe(true);
  });

  it('3/4. NOT_ACTIVE with an end season excludes after it and preserves before it', () => {
    // Anna Maria: closed after the 2025-26 academic year, so season 2025 is its
    // last. It genuinely played in 2024 and that must stay true.
    const s = notActive(2025);
    expect(activeForSeason(s, 2024)).toBe(true);
    expect(activeForSeason(s, 2025)).toBe(true);
    expect(activeForSeason(s, 2026)).toBe(false);
    expect(activeForSeason(s, 2027)).toBe(false);
  });

  it('NOT_ACTIVE with no end season was never fielded, in any season', () => {
    // Wisconsin-La Crosse and SMSU do not sponsor men's soccer and never have in
    // five seasons of our corpus. "Never" is the truthful reading.
    const s = notActive(null);
    for (const y of [2022, 2024, 2026, 2027]) expect(activeForSeason(s, y)).toBe(false);
  });

  it('5/6/7. FUTURE excludes before its start and includes it and after', () => {
    const s = future(2027);
    expect(activeForSeason(s, 2026)).toBe(false);
    expect(activeForSeason(s, 2027)).toBe(true);
    expect(activeForSeason(s, 2028)).toBe(true);
  });

  it('8. an unknown programme has no row, so it stays counted', () => {
    // Bryn Athyn is undecided. A record saying "undecided" would be
    // indistinguishable in effect from no record while implying a decision.
    expect(activeForSeason(undefined, TARGET_SEASON)).toBe(true);
  });

  it('carries no ACTIVE value — absence is the only way to say it', () => {
    expect([...STATUSES].sort()).toEqual(['FUTURE', 'NOT_ACTIVE']);
  });

  it('a FUTURE with no start season is not treated as a bound', () => {
    expect(activeForSeason({ status: PROGRAMME_STATUS.FUTURE }, 2026)).toBe(true);
  });
});

describe('what may be recorded', () => {
  const ok = { evidence: 'the site says so', sourceUrl: 'https://example.test/' };

  it('refuses FUTURE without a start season', () => {
    const r = validateStatus({ status: 'FUTURE', reason: 'LAUNCHING', ...ok });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/needs a start season/);
  });

  it('refuses a reason the status may not carry', () => {
    expect(validateStatus({ status: 'FUTURE', reason: 'NOT_SPONSORED', activeFromSeason: 2027, ...ok }).ok)
      .toBe(false);
    expect(allowedReasonsFor(PROGRAMME_STATUS.FUTURE)).toEqual([STATUS_REASON.LAUNCHING]);
  });

  it('refuses a decision with no evidence or no source', () => {
    const base = { status: 'NOT_ACTIVE', reason: 'NOT_SPONSORED' };
    expect(validateStatus({ ...base, evidence: '  ', sourceUrl: 'https://x.test' }).reason)
      .toMatch(/record the evidence/);
    expect(validateStatus({ ...base, evidence: 'looked', sourceUrl: '' }).reason)
      .toMatch(/cite a first-party source/);
  });

  it('refuses NOT_ACTIVE bounded from the wrong end', () => {
    expect(validateStatus({
      status: 'NOT_ACTIVE', reason: 'NOT_SPONSORED', activeFromSeason: 2027, ...ok,
    }).reason).toMatch(/bounded by activeToSeason/);
  });

  it('accepts the four shapes the six approved records use', () => {
    expect(validateStatus({ status: 'NOT_ACTIVE', reason: 'INSTITUTION_CLOSED', activeToSeason: 2025, ...ok }).ok).toBe(true);
    expect(validateStatus({ status: 'NOT_ACTIVE', reason: 'IDENTITY_TRANSITION', activeToSeason: 2025, ...ok }).ok).toBe(true);
    expect(validateStatus({ status: 'NOT_ACTIVE', reason: 'NOT_SPONSORED', ...ok }).ok).toBe(true);
    expect(validateStatus({ status: 'FUTURE', reason: 'LAUNCHING', activeFromSeason: 2027, ...ok }).ok).toBe(true);
  });
});
