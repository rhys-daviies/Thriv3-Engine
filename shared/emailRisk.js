/**
 * How much to trust a coach's address, in the words a person needs before
 * pressing send.
 *
 * `email_status` records where an address came from, and the four values are
 * not equally safe to mail. 1,159 of the 6,346 contacts were inferred from an
 * institution's address pattern and have never been observed anywhere — those
 * are what bounce, and a bounce on cold outreach costs sender reputation
 * rather than just a lost email. Until this existed the matching tab showed
 * all four identically, so the only way to see the risk was to run
 * `npm run draft` in a terminal.
 *
 * Deliberately not a score. The operator is deciding whether to write to one
 * named person, and "inferred" tells them what to do about it in a way that
 * "0.4" does not.
 */

/**
 * Everything that is not plainly safe. `verified` is absent on purpose — it
 * was read off the programme's own staff page, and carries no warning.
 */
export const EMAIL_RISK = {
  inferred: {
    status: 'inferred',
    label: 'inferred',
    detail: 'Guessed from this institution\'s address pattern and never observed to work. Expect it to bounce.',
    severity: 'high',
  },
  generic: {
    status: 'generic',
    label: 'shared inbox',
    detail: 'A team address rather than a person. It will deliver, but nobody owns a reply.',
    severity: 'low',
  },
  unknown: {
    status: 'unknown',
    label: 'unverified',
    detail: 'No record of where this address came from, so nothing here says it works.',
    severity: 'medium',
  },
};

/** The warning for a status, or null when there is nothing to warn about. */
export function emailRisk(status) {
  const key = (status || '').trim().toLowerCase();
  // An address the status map has never heard of is unproven, not fine. The
  // reassuring reading of missing data is the one that gets people mailing
  // addresses nothing has ever checked.
  if (!key) return EMAIL_RISK.unknown;
  if (key === 'verified') return null;
  return EMAIL_RISK[key] ?? EMAIL_RISK.unknown;
}

/** True when this address carries any warning at all. */
export function isRisky(status) {
  return emailRisk(status) !== null;
}

/**
 * Counts a list of statuses by risk, for the one-line summary above a send.
 * Returns the total that carry a warning plus a breakdown by status.
 */
export function riskCounts(statuses = []) {
  const counts = { verified: 0, inferred: 0, generic: 0, unknown: 0 };
  for (const status of statuses) {
    const risk = emailRisk(status);
    if (!risk) counts.verified += 1;
    else counts[risk.status] += 1;
  }
  return { ...counts, risky: counts.inferred + counts.generic + counts.unknown };
}
