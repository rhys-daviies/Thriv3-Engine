import React from 'react';
import { signatureState, SIGNATURE, LEGACY_REPRESENTATIVE } from '@shared/representative.js';

/**
 * WHO THIS EMAIL IS SIGNED BY, AND WHERE A REPLY GOES — Phase 2.
 *
 * Shown beside every place an operator reviews outreach. It warns, it never
 * blocks: an athlete with no representative still sends, signed with the
 * long-standing consultant signature, and the operator is told so.
 *
 * Replies are stated plainly because representative-first contact does NOT
 * route them: the email still leaves from the athlete's own mailbox, so a
 * coach who hits Reply writes to the athlete's mailbox, not to the
 * representative. The representative is reached through the details in the
 * signature and on the coach-facing page.
 */
export default function RepresentativeSignatureNotice({ representative = null, body = null }) {
  const s = signatureState({ representative, body });
  const replies = 'Sent from the athlete’s own mailbox, so a coach who replies writes to the athlete’s mailbox, not to the representative.';

  if (s.kind === SIGNATURE.LEGACY) {
    const why = s.reason === 'COMPOSED_BEFORE_ASSIGNMENT'
      ? 'This message was written before a representative was assigned, so it still carries'
      : 'No representative is assigned to this athlete, so this email uses';
    return (
      <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs" role="status" data-testid="signature-notice" data-signature="LEGACY">
        {why} the standard signature: {LEGACY_REPRESENTATIVE.full_name}, {LEGACY_REPRESENTATIVE.organisation}
        {' '}({LEGACY_REPRESENTATIVE.phone}). Sending is not affected
        {s.reason === 'COMPOSED_BEFORE_ASSIGNMENT' ? '; regenerate the message to sign it as the representative.' : '; assign a representative in Edit Profile to sign as them.'}
        {' '}{replies}
      </p>
    );
  }
  if (s.kind === SIGNATURE.REPRESENTATIVE) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="signature-notice" data-signature="REPRESENTATIVE">
        Signed by {s.name}, the athlete&rsquo;s representative. {replies}
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground" data-testid="signature-notice" data-signature="OTHER">
      This email&rsquo;s signature is not the representative&rsquo;s standard sign-off; check it before sending. {replies}
    </p>
  );
}
