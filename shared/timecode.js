/**
 * Video timecodes, in one place.
 *
 * The renderer, the retention chart, the chapter list and the chapter editor
 * all show clip times, and all of them were formatting seconds themselves.
 */

/** Accepts "1:06" or a plain count of seconds. Returns null for anything else. */
export function parseTimecode(text) {
  const value = String(text ?? '').trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value);
  const match = value.match(/^(\d{1,3}):([0-5]?\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatTimecode(seconds) {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return '';
  const total = Math.max(0, Math.floor(Number(seconds)));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
