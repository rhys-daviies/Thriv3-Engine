import { describe, it, expect } from 'vitest';
import {
  renderUnsubscribeConfirm, renderUnsubscribeDone,
  renderUnsubscribeUnknown, renderPrivacyNotice,
} from './compliancePages.js';

describe('unsubscribe pages', () => {
  it('confirms before recording anything, and only POSTs', () => {
    const page = renderUnsubscribeConfirm({ actionPath: '/u/abc' });
    expect(page).toContain('method="POST"');
    expect(page).toContain('action="/u/abc"');
    // The wording has to make clear nothing has happened yet, or a coach who
    // closes the tab believes they have opted out.
    expect(page).toMatch(/nothing has changed yet/i);
  });

  it('says the opt-out covers every athlete', () => {
    // Whitespace-normalised: the copy wraps, and a line break mid-phrase is
    // formatting rather than a change of meaning.
    const text = renderUnsubscribeDone().replace(/\s+/g, ' ');
    expect(text).toMatch(/every athlete, not just the one who contacted you/i);
  });

  it('reveals nothing about an unknown token', () => {
    const page = renderUnsubscribeUnknown();
    expect(page).not.toMatch(/not found|invalid|does not exist/i);
    expect(page).toMatch(/no longer active/i);
  });

  it('carries no external requests — these load inside mail gateways', () => {
    for (const page of [renderUnsubscribeConfirm({ actionPath: '/u/x' }), renderUnsubscribeDone(), renderPrivacyNotice({})]) {
      expect(page).not.toMatch(/<script/i);
      expect(page).not.toMatch(/https?:\/\/(?!.*mailto)/);
    }
  });

  it('keeps all of it out of search indexes', () => {
    expect(renderPrivacyNotice({})).toContain('name="robots" content="noindex"');
  });
});

describe('privacy notice', () => {
  const page = renderPrivacyNotice({
    senderIdentity: 'Thriv3 Ltd', postalAddress: '1 Example St', contactEmail: 'privacy@example.com',
  });

  it('states what is recorded and what is not', () => {
    expect(page).toMatch(/what is recorded/i);
    expect(page).toMatch(/what is not recorded/i);
    expect(page).toMatch(/no cookies/i);
  });

  it('carries the identity and postal address it was given', () => {
    expect(page).toContain('Thriv3 Ltd');
    expect(page).toContain('1 Example St');
    expect(page).toContain('privacy@example.com');
  });

  it('renders without them rather than printing "undefined"', () => {
    const bare = renderPrivacyNotice({});
    expect(bare).not.toMatch(/undefined|null/);
    expect(bare).toContain('Thriv3');
  });
});
