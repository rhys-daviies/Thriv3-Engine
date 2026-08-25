import { describe, it, expect } from 'vitest';
import { classifyRole, shouldContact, bySeniority, pickHeadCoach, titleOf, hasUsableEmail } from './coachRoles.js';

describe('classifyRole', () => {
  it('reads the plain titles', () => {
    expect(classifyRole('Head Coach')).toBe('head');
    expect(classifyRole('Assistant Coach')).toBe('assistant');
    expect(classifyRole('Associate Head Coach')).toBe('associate-head');
    expect(classifyRole('Goalkeeper Coach')).toBe('goalkeeper');
  });

  // "Associate Head Coach" contains "Head ... Coach", so order decides this.
  it('does not read an associate head as the head', () => {
    expect(classifyRole('Associate Head Coach')).not.toBe('head');
  });

  it('reads a head coach however the sports are written', () => {
    for (const title of [
      "Head Men's Soccer Coach", "Head Men's & Women's Soccer Coach",
      "Head Men's/Women's Soccer Coach", "Head Coach - Men's and Women's Soccer",
      "Director of Soccer / Head Men's Soccer Coach",
    ]) expect(classifyRole(title), title).toBe('head');
  });

  // A head coach misread as "other" is a head coach nobody writes to.
  it('never leaves a head coach unclassified', () => {
    expect(classifyRole("Head Men's/Women's Soccer Coach")).not.toBe('other');
  });

  it('excludes volunteers and graduate assistants however "assistant" they look', () => {
    expect(classifyRole('Volunteer Assistant Coach')).toBe('volunteer');
    expect(classifyRole('Graduate Assistant Coach')).toBe('graduate-assistant');
    expect(classifyRole('Graduate Assistant')).toBe('graduate-assistant');
  });

  it('excludes team inboxes, which are not people', () => {
    expect(classifyRole("Women's Soccer (Team Email)")).toBe('team-email');
  });

  // A combined title is the coach they are, not the second job.
  it('keeps a coach who also carries a support role', () => {
    expect(classifyRole('Assistant Coach/Equipment Manager')).toBe('assistant');
    expect(classifyRole('Assistant Coach | Head of Goalkeeper Development')).toBe('assistant');
  });

  it('excludes support roles that are not coaching at all', () => {
    expect(classifyRole('Director of Operations')).toBe('operations');
    expect(classifyRole('Strength and Conditioning')).toBe('performance-staff');
  });

  it('has no opinion about a blank title', () => {
    expect(classifyRole('')).toBe('unknown');
    expect(classifyRole(null)).toBe('unknown');
  });
});

describe('shouldContact', () => {
  const gk = { position_title: 'Goalkeeper Coach' };
  const assistant = { position_title: 'Assistant Coach' };

  it('writes to a goalkeeper coach only for a goalkeeper', () => {
    expect(shouldContact(gk, { athletePosition: 'Goalkeeper' })).toBe(true);
    expect(shouldContact(gk, { athletePosition: 'Midfield' })).toBe(false);
  });

  it('honours a narrowed role list', () => {
    expect(shouldContact(assistant, { roles: ['head'] })).toBe(false);
    expect(shouldContact(assistant, { roles: ['head', 'assistant'] })).toBe(true);
  });

  it('never writes to an excluded role, whatever roles are asked for', () => {
    const volunteer = { position_title: 'Volunteer Assistant Coach' };
    expect(shouldContact(volunteer, { roles: ['head', 'assistant', 'volunteer'] })).toBe(true);
    // Only because 'volunteer' was named explicitly — it is not in the default.
    expect(shouldContact(volunteer, {})).toBe(false);
  });
});

describe('bySeniority', () => {
  it('puts the head coach first and unknown roles last', () => {
    const staff = [
      { position_title: 'Assistant Coach', full_name: 'C' },
      { position_title: 'Head Coach', full_name: 'A' },
      { position_title: 'Director of Operations', full_name: 'D' },
      { position_title: 'Associate Head Coach', full_name: 'B' },
    ];
    expect([...staff].sort(bySeniority).map((s) => s.full_name)).toEqual(['A', 'B', 'C', 'D']);
  });
});

describe('titleOf', () => {
  // The database column and the coaching_staff JSON key differ. A picker that
  // read only one of them would return nothing at all on the other source.
  it('reads either column name', () => {
    expect(titleOf({ position_title: 'Head Coach' })).toBe('Head Coach');
    expect(titleOf({ title: 'Head Coach' })).toBe('Head Coach');
    expect(titleOf({})).toBe('');
    expect(titleOf(null)).toBe('');
  });
});

describe('hasUsableEmail', () => {
  it('rejects the placeholders the imports leave behind', () => {
    expect(hasUsableEmail({ email: 'a@x.edu' })).toBe(true);
    expect(hasUsableEmail({ email: 'N/A' })).toBe(false);
    expect(hasUsableEmail({ email: '  ' })).toBe(false);
    expect(hasUsableEmail({})).toBe(false);
  });
});

describe('pickHeadCoach', () => {
  it('picks the head coach over more senior-sounding noise', () => {
    const staff = [
      { name: 'A', title: 'Assistant Coach', email: 'a@x.edu' },
      { name: 'B', title: 'Head Coach', email: 'b@x.edu' },
    ];
    expect(pickHeadCoach(staff)).toMatchObject({ name: 'B', role: 'head' });
  });

  // The regression this whole picker exists for: the tab used to test
  // /head coach/i, which matches "Head Coach" and misses the 35% of real
  // titles that name the sport in between the two words.
  it('finds a head coach whose title names the sport', () => {
    for (const title of ["Head Men's Soccer Coach", "Head Women's Soccer Coach", 'Director of Soccer']) {
      expect(pickHeadCoach([{ name: 'A', title, email: 'a@x.edu' }])).toMatchObject({ role: 'head' });
    }
  });

  it('falls back to the associate head, and says so', () => {
    const staff = [
      { name: 'A', title: 'Assistant Coach', email: 'a@x.edu' },
      { name: 'B', title: 'Associate Head Coach', email: 'b@x.edu' },
    ];
    expect(pickHeadCoach(staff)).toMatchObject({ name: 'B', role: 'associate-head' });
  });

  it('prefers a real head coach to an associate', () => {
    const staff = [
      { name: 'B', title: 'Associate Head Coach', email: 'b@x.edu' },
      { name: 'A', title: 'Head Coach', email: 'a@x.edu' },
    ];
    expect(pickHeadCoach(staff)).toMatchObject({ name: 'A', role: 'head' });
  });

  it('will not return a coach with no address to write to', () => {
    expect(pickHeadCoach([{ name: 'A', title: 'Head Coach', email: 'N/A' }])).toBeNull();
    expect(pickHeadCoach([{ name: 'A', title: 'Head Coach' }])).toBeNull();
  });

  it('returns null for a staff of assistants, rather than an assistant', () => {
    expect(pickHeadCoach([{ name: 'A', title: 'Assistant Coach', email: 'a@x.edu' }])).toBeNull();
  });

  // A team inbox is hard-excluded by classifyRole, so it can never be picked
  // even when it is the only address on file.
  it('never picks a team inbox', () => {
    expect(pickHeadCoach([{ name: 'Soccer', title: 'Team Email', email: 'soccer@x.edu' }])).toBeNull();
  });

  it('survives an empty or missing staff', () => {
    expect(pickHeadCoach([])).toBeNull();
    expect(pickHeadCoach()).toBeNull();
  });
});
