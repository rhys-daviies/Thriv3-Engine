import { describe, it, expect } from 'vitest';
import { parseTimecode, formatTimecode } from './timecode.js';

describe('parseTimecode', () => {
  it.each([
    ['1:06', 66],
    ['0:18', 18],
    ['2:02', 122],
    ['12:34', 754],
    ['0:00', 0],
    ['66', 66],
    ['0', 0],
    ['  1:06  ', 66],
  ])('reads %s as %i seconds', (input, expected) => {
    expect(parseTimecode(input)).toBe(expected);
  });

  it.each(['', '   ', 'abc', '1:60', '1:99', ':30', '1:2:3', null, undefined])(
    'rejects %p',
    (input) => {
      expect(parseTimecode(input)).toBeNull();
    }
  );
});

describe('formatTimecode', () => {
  it.each([
    [66, '1:06'],
    [18, '0:18'],
    [122, '2:02'],
    [0, '0:00'],
    [754, '12:34'],
  ])('renders %i as %s', (input, expected) => {
    expect(formatTimecode(input)).toBe(expected);
  });

  it('round-trips through parseTimecode', () => {
    for (const seconds of [0, 18, 66, 122, 215, 3599]) {
      expect(parseTimecode(formatTimecode(seconds))).toBe(seconds);
    }
  });

  it('renders nothing for a missing value', () => {
    expect(formatTimecode(null)).toBe('');
    expect(formatTimecode(undefined)).toBe('');
  });
});
