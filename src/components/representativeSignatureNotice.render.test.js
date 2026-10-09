/**
 * The signature notice beside every outreach review surface (Phase 2): warns,
 * never blocks, and says where a reply goes.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RepresentativeSignatureNotice from './RepresentativeSignatureNotice.jsx';
import CampaignMessageDetail from './CampaignMessageDetail.jsx';

const REP = { id: 'r1', full_name: 'Alex Morgan', email: 'alex@example.test', phone: '+1 415 555 0134', organisation: 'Striv3', active: 1 };
const LEGACY_BODY = 'Hi Pat,\n\n…\n\nBest regards,\nRhys Davies\nStriv3 Elite Sports Management';
const render = (props) => renderToStaticMarkup(React.createElement(RepresentativeSignatureNotice, props));

describe('the signature notice', () => {
  it('an unassigned athlete: names the standard signature, says sending is unaffected, and where replies go', () => {
    const html = render({ representative: null });
    expect(html).toContain('data-signature="LEGACY"');
    expect(html).toContain('No representative is assigned to this athlete');
    expect(html).toContain('Rhys Davies, Striv3 Elite Sports Management');
    expect(html).toContain('Sending is not affected');
    expect(html).toContain('not to the athlete or the representative');
  });

  it('a message composed before assignment: says it still carries the standard signature', () => {
    const html = render({ representative: REP, body: LEGACY_BODY });
    expect(html).toContain('written before a representative was assigned');
    expect(html).toContain('regenerate the message');
  });

  it('a representative\'s email: says who signs it, and that replies do not reach the representative', () => {
    const html = render({ representative: REP, body: 'Best regards,\nAlex Morgan\nStriv3' });
    expect(html).toContain('data-signature="REPRESENTATIVE"');
    expect(html).toContain('Signed by Alex Morgan');
    expect(html).toContain('not to the athlete or the representative');
  });

  it('Phase 5 (#1): a manual draft names the operator\'s own account, never the athlete\'s mailbox', () => {
    for (const props of [{ representative: null }, { representative: REP, body: 'Best regards,\nAlex Morgan' }, { representative: REP, body: 'edited' }]) {
      const html = render({ ...props, channel: 'manual' });
      expect(html).toContain('You send this from your own email account');
      expect(html).not.toMatch(/athlete(’|&#x27;|')s (own )?(connected )?mailbox/);
    }
    // No channel given: the manual wording, the only path that sends today.
    expect(render({ representative: REP })).toContain('your own email account');
  });

  it('Phase 5 (#1): a campaign message names the athlete\'s connected mailbox', () => {
    const html = render({ representative: REP, channel: 'campaign' });
    expect(html).toContain('the athlete’s own connected mailbox');
    expect(html).not.toContain('your own email account');
  });

  it('is on the campaign message screen, read from the stored body', () => {
    const html = renderToStaticMarkup(React.createElement(CampaignMessageDetail, {
      message: { id: 'm1', state: 'draft', subject: 'S', body: LEGACY_BODY },
      representative: REP, onBack: () => {}, onSave: () => {}, onReview: () => {},
    }));
    expect(html).toContain('data-testid="signature-notice"');
    expect(html).toContain('data-signature="LEGACY"');
    expect(html).toContain('the athlete’s own connected mailbox');
  });
});

describe('every outreach review surface shows it, with its own channel', () => {
  it.each([
    ['src/components/EmailComposer.jsx', 'manual'],
    ['src/components/BulkEmailComposer.jsx', 'manual'],
    ['src/components/CampaignMessageDetail.jsx', 'campaign'],
  ])('%s says channel="%s"', async (file, channel) => {
    const fs = await import('node:fs');
    expect(fs.readFileSync(file, 'utf8')).toMatch(new RegExp(`<RepresentativeSignatureNotice[^>]*channel="${channel}"`));
  });

  it('no operator-facing copy claims manual outreach leaves from the athlete\'s mailbox', async () => {
    const fs = await import('node:fs');
    for (const file of ['src/pages/player/ProfileTab.jsx', 'src/components/PlayerFormSteps.jsx', 'src/components/EmailComposer.jsx', 'src/components/BulkEmailComposer.jsx']) {
      expect(fs.readFileSync(file, 'utf8')).not.toMatch(/(still )?sends? from the athlete(&rsquo;|’|')s own mailbox/);
    }
    expect(fs.readFileSync('src/components/EmailComposer.jsx', 'utf8')).not.toContain('each message opens in Outlook for you to read and send yourself');
  });

  it.each(['src/components/EmailComposer.jsx', 'src/components/BulkEmailComposer.jsx', 'src/components/CampaignMessageDetail.jsx'])('%s', async (file) => {
    const fs = await import('node:fs');
    expect(fs.readFileSync(file, 'utf8')).toContain('<RepresentativeSignatureNotice');
  });
});
