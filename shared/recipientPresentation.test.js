import { describe, it, expect } from 'vitest';
import {
  presentRecipient, presentRecipientRow, recipientRowKey, inboxTemplate, inboxSubject, assertInboxBody,
  INBOX_GREETING, PROGRAMME_CONTACT_LABEL,
} from './recipientPresentation.js';
import { emailBodyFor, DEFAULT_EMAIL_TEMPLATE } from '../src/lib/emailTemplate.js';

/** Phase 1F — "Programme Contact" and "Hi Coach,", decided once. */
const code = (fn) => { try { fn(); } catch (e) { return e.code; } return 'NO_THROW'; };
const PLAYER = { full_name: 'Marcus Reyes', position: 'Defender', sport: 'mens-soccer', recruiting_class_year: 2027 };
const COLLEGE = { name: 'Cornell', division: 'NCAA D1' };

describe('presentation', () => {
  it('an inbox is "Programme Contact" with its programme as context, never a person', () => {
    expect(presentRecipient({ kind: 'PROGRAMME_INBOX', label: "Cornell Men's Soccer", name: 'Ignored' }))
      .toEqual({ kind: 'PROGRAMME_INBOX', primary: PROGRAMME_CONTACT_LABEL, secondary: "Cornell Men's Soccer", isPerson: false });
  });
  it('a coach is shown exactly as before: by name, with the title', () => {
    expect(presentRecipient({ kind: 'COACH', name: 'Ali Simmons', title: 'Head Coach' })).toMatchObject({ primary: 'Ali Simmons', secondary: 'Head Coach', isPerson: true });
    expect(presentRecipientRow({ coach_name: 'Ali Simmons', position_title: 'Head Coach', coach_id: 'c1' })).toMatchObject({ primary: 'Ali Simmons' });
  });
  it('row keys never collide across kinds', () => {
    expect(recipientRowKey({ recipient_kind: 'PROGRAMME_INBOX', recipient_id: 'PC-1', coach_id: null })).toBe('PROGRAMME_INBOX:PC-1');
    expect(recipientRowKey({ coach_id: 'c1' })).toBe('COACH:c1');
  });
});

describe('composition for a programme inbox', () => {
  it('the default template and the structured greeting both become "Hi Coach,"', () => {
    expect(inboxTemplate(DEFAULT_EMAIL_TEMPLATE).split('\n')[0]).toBe(INBOX_GREETING);
    expect(inboxTemplate('Hi {{coach_first_name}},\n\nBody').split('\n')[0]).toBe(INBOX_GREETING);
    expect(inboxTemplate('Dear {{coach_name}},\n\nBody').split('\n')[0]).toBe(INBOX_GREETING);
  });
  it('fails closed on a coach-name token outside the greeting, or no greeting at all', () => {
    expect(code(() => inboxTemplate('Hi {{coach_name}},\n\nCoach {{coach_name}}, I hope...'))).toBe('INBOX_TEMPLATE_USES_COACH_NAME');
    expect(code(() => inboxTemplate('I am writing about {{player_name}}.'))).toBe('INBOX_TEMPLATE_HAS_NO_GREETING');
    expect(code(() => inboxSubject('For {{coach_first_name}}'))).toBe('INBOX_TEMPLATE_USES_COACH_NAME');
  });
  it('a finished body must open "Hi Coach," and must not name the person the operator had in mind', () => {
    expect(code(() => assertInboxBody('Hi Coach,\n\nx'))).toBe('NO_THROW');
    expect(code(() => assertInboxBody('Hi Sam,\n\nx'))).toBe('INBOX_BODY_GREETING_NOT_NEUTRAL');
    expect(code(() => assertInboxBody('Hi Coach,\n\nThanks Sam Smith', { personName: 'Sam Smith' }))).toBe('INBOX_BODY_NAMES_A_PERSON');
  });
  it('an athlete\'s CUSTOM template naming the coach outside the greeting refuses an inbox — no silent fallback', () => {
    const custom = { ...PLAYER, email_template: 'Hi {{coach_first_name}},\n\nCoach {{coach_name}}, I hope your season is going well.' };
    expect(code(() => emailBodyFor(custom, COLLEGE, null, { recipientKind: 'PROGRAMME_INBOX' }))).toBe('INBOX_TEMPLATE_USES_COACH_NAME');
    // the same template still composes for a coach, exactly as it always did
    expect(emailBodyFor(custom, COLLEGE, 'Ali Simmons', {}).body).toBe('Hi Ali,\n\nCoach Ali Simmons, I hope your season is going well.');
  });
  it('emailBodyFor composes an inbox with no name, and a coach exactly as before', () => {
    expect(emailBodyFor(PLAYER, COLLEGE, 'Ali Simmons', { recipientKind: 'PROGRAMME_INBOX' }).body.split('\n')[0]).toBe('Hi Coach,');
    const coach = emailBodyFor(PLAYER, COLLEGE, 'Ali Simmons', {});
    expect(coach.body.split('\n')[0]).toBe('Hi Ali Simmons,');
    expect(coach).toEqual(emailBodyFor(PLAYER, COLLEGE, 'Ali Simmons', { recipientKind: 'COACH' }));
  });
});
