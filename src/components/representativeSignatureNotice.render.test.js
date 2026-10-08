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
    expect(html).toContain('not to the representative');
  });

  it('a message composed before assignment: says it still carries the standard signature', () => {
    const html = render({ representative: REP, body: LEGACY_BODY });
    expect(html).toContain('written before a representative was assigned');
    expect(html).toContain('regenerate the message');
  });

  it('a representative\'s email: says who signs it, and still that replies go to the athlete\'s mailbox', () => {
    const html = render({ representative: REP, body: 'Best regards,\nAlex Morgan\nStriv3' });
    expect(html).toContain('data-signature="REPRESENTATIVE"');
    expect(html).toContain('Signed by Alex Morgan');
    expect(html).toContain('writes to the athlete');
  });

  it('is on the campaign message screen, read from the stored body', () => {
    const html = renderToStaticMarkup(React.createElement(CampaignMessageDetail, {
      message: { id: 'm1', state: 'draft', subject: 'S', body: LEGACY_BODY },
      representative: REP, onBack: () => {}, onSave: () => {}, onReview: () => {},
    }));
    expect(html).toContain('data-testid="signature-notice"');
    expect(html).toContain('data-signature="LEGACY"');
  });
});

describe('every outreach review surface shows it', () => {
  it.each(['src/components/EmailComposer.jsx', 'src/components/BulkEmailComposer.jsx', 'src/components/CampaignMessageDetail.jsx'])('%s', async (file) => {
    const fs = await import('node:fs');
    expect(fs.readFileSync(file, 'utf8')).toContain('<RepresentativeSignatureNotice');
  });
});
