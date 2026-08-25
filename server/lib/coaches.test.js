import { describe, it, expect, beforeEach } from 'vitest';
import db from '../db/client.js';
import { findOrCreateCoach, getCoach, emailStatusMap } from './coaches.js';

beforeEach(() => { db.prepare('DELETE FROM coaches').run(); });

const base = {
  full_name: 'Jane Doe', email: 'jane@example.edu',
  school: 'Example State', sport: 'mens-soccer', position_title: 'Head Coach',
};

describe('findOrCreateCoach', () => {
  it('creates once and finds thereafter', () => {
    const a = findOrCreateCoach(base);
    const b = findOrCreateCoach({ ...base, full_name: 'Different Spelling' });
    expect(b.id).toBe(a.id);
    expect(db.prepare('SELECT COUNT(*) n FROM coaches').get().n).toBe(1);
  });

  it('keys on school and sport as well as address, so a shared inbox is not one person', () => {
    findOrCreateCoach({ ...base, email: 'msoccer@example.edu' });
    findOrCreateCoach({ ...base, email: 'msoccer@example.edu', school: 'Other State' });
    expect(db.prepare('SELECT COUNT(*) n FROM coaches').get().n).toBe(2);
  });

  it('refuses a coach with no usable address', () => {
    expect(() => findOrCreateCoach({ ...base, email: '' })).toThrow(/no usable email/i);
    expect(() => findOrCreateCoach({ ...base, email: 'N/A' })).toThrow(/no usable email/i);
  });

  it('lowercases the address, so casing cannot duplicate a person', () => {
    const a = findOrCreateCoach({ ...base, email: 'Jane@Example.edu' });
    const b = findOrCreateCoach({ ...base, email: 'jane@example.edu' });
    expect(b.id).toBe(a.id);
    expect(getCoach(a.id).email).toBe('jane@example.edu');
  });

  // The table held both spellings because the lazy writer never normalised.
  it('normalises the division on the way in', () => {
    const c = findOrCreateCoach({ ...base, division: 'NCAA Division I' });
    expect(c.division).toBe('NCAA D1');
    expect(findOrCreateCoach({ ...base, email: 'b@example.edu', division: 'Division III' }).division).toBe('NCAA D3');
  });

  it('keeps an unrecognised division rather than flattening it to "Other"', () => {
    expect(findOrCreateCoach({ ...base, division: 'NCCAA' }).division).toBe('NCCAA');
  });

  it('marks a lazily created coach as having unknown provenance', () => {
    const c = findOrCreateCoach(base);
    const stored = getCoach(c.id);
    expect(stored.email_status).toBe('unknown');
    expect(stored.source).toBe('send');
    // Never presented as confirmed by anything.
    expect(stored.email_confirmed_at).toBeNull();
  });
});

describe('emailStatusMap', () => {
  const insert = (email, status, sport = 'mens-soccer') => {
    findOrCreateCoach({ ...base, email, sport, school: `School ${email}` });
    db.prepare('UPDATE coaches SET email_status = ? WHERE email = ?').run(status, email.toLowerCase());
  };

  it('maps every address for the sport to its status', () => {
    insert('head@a.edu', 'verified');
    insert('guess@b.edu', 'inferred');
    expect(emailStatusMap('mens-soccer')).toEqual({
      'head@a.edu': 'verified',
      'guess@b.edu': 'inferred',
    });
  });

  it('scopes to the sport asked for', () => {
    insert('mens@a.edu', 'verified', 'mens-soccer');
    insert('womens@a.edu', 'inferred', 'womens-soccer');
    expect(emailStatusMap('mens-soccer')).toEqual({ 'mens@a.edu': 'verified' });
    expect(emailStatusMap('womens-soccer')).toEqual({ 'womens@a.edu': 'inferred' });
  });

  it('returns every sport when asked for none', () => {
    insert('mens@a.edu', 'verified', 'mens-soccer');
    insert('womens@a.edu', 'inferred', 'womens-soccer');
    expect(Object.keys(emailStatusMap(null))).toHaveLength(2);
  });

  // The lookup on the other side lower-cases too. An address that fails to
  // match reads as unverified, which is alarming and wrong.
  it('keys on the lower-cased address', () => {
    findOrCreateCoach({ ...base, email: 'Coach.Name@A.EDU' });
    expect(emailStatusMap('mens-soccer')).toHaveProperty('coach.name@a.edu');
  });

  // A row created by a send rather than promoted from the contact sheets.
  it('reports a coach with no recorded provenance as unknown', () => {
    findOrCreateCoach({ ...base, email: 'new@a.edu' });
    expect(emailStatusMap('mens-soccer')['new@a.edu']).toBe('unknown');
  });

  it('is empty when nothing is on file', () => {
    expect(emailStatusMap('mens-soccer')).toEqual({});
  });
});
