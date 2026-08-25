import { describe, it, expect } from 'vitest';
import { classYearOf } from './athlete.js';

describe('classYearOf', () => {
  it('prefers the recruiting class year', () => {
    expect(classYearOf({ recruiting_class_year: 2027, graduation_year: 2026 })).toBe(2027);
  });

  it('falls back to graduation year for records made before the field existed', () => {
    expect(classYearOf({ graduation_year: 2026 })).toBe(2026);
    expect(classYearOf({ recruiting_class_year: null, graduation_year: 2026 })).toBe(2026);
    expect(classYearOf({ recruiting_class_year: '', graduation_year: 2026 })).toBe(2026);
  });

  it('is null when neither is set, rather than undefined or zero', () => {
    expect(classYearOf({})).toBeNull();
    expect(classYearOf({ recruiting_class_year: null, graduation_year: null })).toBeNull();
    expect(classYearOf(null)).toBeNull();
  });

  // A post-grad year is the case where the two genuinely differ: school in
  // 2026, prep year, arrives 2027. The arrival year is the one that matters.
  it('reads a post-grad year as the year they arrive', () => {
    expect(classYearOf({ graduation_year: 2026, recruiting_class_year: 2027 })).toBe(2027);
  });
});
