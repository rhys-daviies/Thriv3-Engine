import { describe, it, expect, beforeEach } from 'vitest';
import db from '../db/client.js';
import { isSuppressed, suppress, unsuppress, suppressedSet, listSuppressions } from './suppressions.js';

beforeEach(() => { db.prepare('DELETE FROM suppressions').run(); });

describe('suppressions', () => {
  it('keys on the address alone, so an opt-out covers every athlete', () => {
    suppress({ email: 'coach@example.edu' });
    // Nothing about athlete or campaign is stored, so nothing can scope it.
    expect(isSuppressed('coach@example.edu')).toBe(true);
    const cols = db.prepare('PRAGMA table_info(suppressions)').all().map((c) => c.name);
    expect(cols).not.toContain('athlete_id');
  });

  it('normalises case and whitespace', () => {
    suppress({ email: '  Coach@Example.EDU ' });
    expect(isSuppressed('coach@example.edu')).toBe(true);
    expect(isSuppressed('COACH@EXAMPLE.EDU')).toBe(true);
  });

  it('is idempotent and keeps the first timestamp', async () => {
    const first = suppress({ email: 'a@b.edu', reason: 'unsubscribed', source: 'edge' });
    await new Promise((r) => setTimeout(r, 5));
    const second = suppress({ email: 'a@b.edu', reason: 'manual', source: 'manual' });
    expect(second.alreadySuppressed).toBe(true);
    expect(second.created_at).toBe(first.created_at);
    // The original reason survives — it is the one that was actually asked for.
    expect(second.reason).toBe('unsubscribed');
    expect(listSuppressions()).toHaveLength(1);
  });

  it('refuses a blank address and an unknown reason', () => {
    expect(() => suppress({ email: '   ' })).toThrow(/blank/i);
    expect(() => suppress({ email: 'a@b.edu', reason: 'because' })).toThrow(/unknown suppression reason/i);
  });

  it('reports a set for filtering a list before a send', () => {
    suppress({ email: 'a@b.edu' });
    suppress({ email: 'c@d.edu' });
    const set = suppressedSet();
    expect(set.has('a@b.edu')).toBe(true);
    expect(set.has('nobody@x.edu')).toBe(false);
  });

  it('only un-suppresses through its own explicit call', () => {
    suppress({ email: 'a@b.edu' });
    expect(unsuppress('a@b.edu')).toBe(true);
    expect(isSuppressed('a@b.edu')).toBe(false);
    expect(unsuppress('never@there.edu')).toBe(false);
  });

  it('treats an unknown address as mailable rather than erroring', () => {
    expect(isSuppressed('stranger@example.edu')).toBe(false);
    expect(isSuppressed('')).toBe(false);
    expect(isSuppressed(null)).toBe(false);
  });
});
