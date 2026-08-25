import React from 'react';
import { emailRisk } from '@shared/emailRisk.js';

// Red is reserved for the one that actually fails. An inferred address has
// never been seen to work and will bounce; a shared inbox delivers perfectly
// well and merely has nobody's name on it, so colouring them alike would
// train the operator to ignore both.
const TONE = {
  high: 'bg-destructive/15 text-destructive',
  medium: 'bg-amber-500/15 text-amber-500',
  low: 'bg-muted text-muted-foreground',
};

/**
 * The provenance warning for one address, or nothing at all when it was read
 * off the programme's own staff page.
 *
 * `status` undefined means the lookup has not arrived yet — rendered as
 * nothing rather than as a warning, so a slow request does not flash a red
 * badge onto every verified coach on the page.
 */
export default function EmailRiskBadge({ status, loaded = true }) {
  if (!loaded) return null;
  const risk = emailRisk(status);
  if (!risk) return null;
  return (
    <span
      className={`shrink-0 rounded px-1 py-0.5 text-[10px] ${TONE[risk.severity]}`}
      title={risk.detail}
    >
      {risk.label}
    </span>
  );
}
