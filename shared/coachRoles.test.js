import { describe, it, expect } from 'vitest';
import { classifyRole, shouldContact, bySeniority, pickBestContact, titleOf, hasUsableEmail } from './coachRoles.js';

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

describe('pickBestContact', () => {
  it('picks the head coach over more senior-sounding noise', () => {
    const staff = [
      { name: 'A', title: 'Assistant Coach', email: 'a@x.edu' },
      { name: 'B', title: 'Head Coach', email: 'b@x.edu' },
    ];
    expect(pickBestContact(staff)).toMatchObject({ name: 'B', role: 'head' });
  });

  // The regression this whole picker exists for: the tab used to test
  // /head coach/i, which matches "Head Coach" and misses the 35% of real
  // titles that name the sport in between the two words.
  it('finds a head coach whose title names the sport', () => {
    for (const title of ["Head Men's Soccer Coach", "Head Women's Soccer Coach", 'Director of Soccer']) {
      expect(pickBestContact([{ name: 'A', title, email: 'a@x.edu' }])).toMatchObject({ role: 'head' });
    }
  });

  it('falls back to the associate head, and says so', () => {
    const staff = [
      { name: 'A', title: 'Assistant Coach', email: 'a@x.edu' },
      { name: 'B', title: 'Associate Head Coach', email: 'b@x.edu' },
    ];
    expect(pickBestContact(staff)).toMatchObject({ name: 'B', role: 'associate-head' });
  });

  it('prefers a real head coach to an associate', () => {
    const staff = [
      { name: 'B', title: 'Associate Head Coach', email: 'b@x.edu' },
      { name: 'A', title: 'Head Coach', email: 'a@x.edu' },
    ];
    expect(pickBestContact(staff)).toMatchObject({ name: 'A', role: 'head' });
  });

  it('will not return a coach with no address to write to', () => {
    expect(pickBestContact([{ name: 'A', title: 'Head Coach', email: 'N/A' }])).toBeNull();
    expect(pickBestContact([{ name: 'A', title: 'Head Coach' }])).toBeNull();
  });

  // 21 school-sports list assistants and no head. Dropping them cost the
  // programme entirely; an assistant can forward.
  it('falls through to an assistant when there is no head or associate', () => {
    expect(pickBestContact([{ name: 'A', title: 'Assistant Coach', email: 'a@x.edu' }]))
      .toMatchObject({ name: 'A', role: 'assistant' });
  });

  // Not merely the most senior assistant — the one whose job this email is.
  it('prefers a recruiting coordinator among assistants', () => {
    const staff = [
      { name: 'A', title: 'Assistant Coach', email: 'a@x.edu' },
      { name: 'B', title: 'Assistant Coach/Recruiting Coordinator', email: 'b@x.edu' },
    ];
    expect(pickBestContact(staff)).toMatchObject({ name: 'B', role: 'assistant' });
  });

  it('prefers an explicit first or senior assistant over a plain one', () => {
    const staff = [
      { name: 'A', title: 'Assistant Coach', email: 'a@x.edu' },
      { name: 'B', title: 'First Assistant Coach', email: 'b@x.edu' },
    ];
    expect(pickBestContact(staff)).toMatchObject({ name: 'B' });
  });

  it('keeps the staff-page order among equally ranked assistants', () => {
    const staff = [
      { name: 'A', title: 'Assistant Coach', email: 'a@x.edu' },
      { name: 'B', title: 'Assistant Coach', email: 'b@x.edu' },
    ];
    expect(pickBestContact(staff)).toMatchObject({ name: 'A' });
  });

  // 24 school-sports have nothing else. Last on the ladder, never before a
  // person, and labelled so the operator knows what they are writing to.
  it('takes a shared team inbox only when nothing else is on file', () => {
    expect(pickBestContact([{ name: null, title: 'Team Email', email: 'soccer@x.edu' }]))
      .toMatchObject({ role: 'team-email', email: 'soccer@x.edu' });
  });

  it('prefers any named coach to the shared inbox', () => {
    const staff = [
      { name: null, title: 'Team Email', email: 'soccer@x.edu' },
      { name: 'A', title: 'Assistant Coach', email: 'a@x.edu' },
    ];
    expect(pickBestContact(staff)).toMatchObject({ name: 'A', role: 'assistant' });
  });

  // Never, at any rung. Not who decides, and a recruit gets one approach.
  it('never picks a volunteer or a graduate assistant', () => {
    expect(pickBestContact([{ name: 'A', title: 'Volunteer Assistant Coach', email: 'a@x.edu' }])).toBeNull();
    expect(pickBestContact([{ name: 'B', title: 'Graduate Assistant Coach', email: 'b@x.edu' }])).toBeNull();
  });

  it('survives an empty or missing staff', () => {
    expect(pickBestContact([])).toBeNull();
    expect(pickBestContact()).toBeNull();
  });
});

/**
 * Operational and administrative titles that were reading as coaching ones.
 *
 * Utah Valley's draft greeted Abby Williams, Director of Soccer Operations,
 * ahead of head coach Michael Chesler — who was on the same email. The head
 * pattern is not anchored, so it matched the second job in a combined title
 * and the word "Operations" after "Director of Soccer".
 */
describe('operations and assistant titles never outrank a head coach', () => {
  it('reads a soccer-operations director as operations, not as the head', () => {
    expect(classifyRole('Director of Soccer Operations')).toBe('operations');
    expect(classifyRole('Director, Soccer Operations')).toBe('operations');
    expect(classifyRole('Soccer Operations')).toBe('operations');
    expect(classifyRole('Coordinator of Operations')).toBe('operations');
    expect(classifyRole('Director of Operations')).toBe('operations');
    expect(classifyRole('Operations Coordinator')).toBe('operations');
  });

  /**
   * "Director of Soccer" on its own is genuinely the senior coaching job at
   * some programmes, and combined titles still name a real head coach. The
   * narrow fix must not take those with it.
   */
  it('leaves the titles that really are the head coach alone', () => {
    expect(classifyRole('Head Coach')).toBe('head');
    expect(classifyRole("Head Men's Soccer Coach")).toBe('head');
    expect(classifyRole('Director of Soccer')).toBe('head');
    expect(classifyRole('Director of Soccer Operations/Head Coach')).toBe('head');
    expect(classifyRole("Head Men's & Women's Soccer Coach / Director of Soccer Operations")).toBe('head');
    expect(classifyRole('Head Coach / Coordinator of Soccer Operations')).toBe('head');
    expect(classifyRole('Assistant Athletic Director / Head Soccer Coach')).toBe('head');
  });

  /** An assistant who also heads a reserve side is an assistant. */
  it('reads an assistant title as an assistant however it continues', () => {
    expect(classifyRole('Assistant Head Coach')).toBe('assistant');
    expect(classifyRole('Assistant Coach / Head EDS Coach')).toBe('assistant');
    expect(classifyRole('Assistant Coach/Head Reserves Coach')).toBe('assistant');
    expect(classifyRole('Senior Assistant Coach/Recruitment Coordinator')).toBe('assistant');
    expect(classifyRole('Assistant Coach')).toBe('assistant');
    expect(classifyRole('Associate Head Coach')).toBe('associate-head');
  });

  it('still refuses to write to a volunteer or a graduate assistant', () => {
    expect(classifyRole('Volunteer Assistant Coach')).toBe('volunteer');
    expect(classifyRole("Graduate Assistant Men's Soccer Coach/Recruiting Coordinator"))
      .toBe('graduate-assistant');
  });

  /** The routing consequence, which is what the defect actually was. */
  it('sorts a real head coach ahead of a soccer-operations director', () => {
    const staff = [
      { full_name: 'Abby Williams', position_title: 'Director of Soccer Operations' },
      { full_name: 'Michael Chesler', position_title: 'Head Coach' },
    ].sort(bySeniority);
    expect(staff[0].full_name).toBe('Michael Chesler');
    expect(shouldContact(staff[1], { athletePosition: 'Defender' })).toBe(false);
  });
});
