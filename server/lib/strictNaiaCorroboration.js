/**
 * PHASE 7B.1 — strict independent-corroboration evaluator (Part I). ANALYSIS ONLY.
 *
 * This does NOT change the live eligibility gate (G6 in reconcileCoaches.js). It is a
 * pure predicate used only in Phase-7B.1 simulation to measure how many pilot coaches
 * WOULD be safely corroborated by the Phase-4–6 authoritative-evidence model instead of
 * coach_seasons. It is deliberately strict: every one of the nine conditions must hold.
 *
 * A current coach is independently strongly corroborated only if ALL hold:
 *   1. canonical UNITID resolved (unitid != null)
 *   2. active programme (programmeActive === true)
 *   3. correct sport (coachSport === programmeSport)
 *   4. current authoritative official staff evidence (currentness_status === 'CURRENT')
 *   5. authoritative athletics domain independently mapped to the SAME UNITID
 *        - VERIFIED  -> accepted
 *        - VERIFIED_ALIAS -> accepted ONLY with independent institution proof
 *          (aliasIndependentlyProven === true), because an alias can be wrong
 *   6. exact personal email currently published (email_status === 'verified', real address,
 *        not a generic/department inbox)
 *   7. email_seen evidence captured (email_seen_on_source_url present)
 *   8. currentness evidence captured (currentness_source_url present)
 *   9. no contradictory coach_seasons / institution evidence (contradiction !== true)
 *
 * Inferred and generic emails are prohibited in every scenario.
 */
export function evaluateStrictCorroboration(c) {
  const reasons = [];
  const realEmail = !!(c.email && c.email.includes('@') && c.email.toUpperCase() !== 'N/A' && !c.email.includes('@redacted.invalid'));
  const status = String(c.email_status || '').toLowerCase();
  const domainStatus = String(c.domain_status || 'MISSING');
  const domainVerified = ['VERIFIED', 'VERIFIED_ALIAS'].includes(domainStatus) && c.domain_unitid != null;
  const domainUnitidMatch = domainVerified && Number(c.domain_unitid) === Number(c.unitid);

  if (c.unitid == null) reasons.push('NO_CANONICAL_UNITID');            // 1
  if (c.programmeActive !== true) reasons.push('PROGRAMME_NOT_ACTIVE');  // 2
  if (c.coachSport && c.programmeSport && c.coachSport !== c.programmeSport) reasons.push('SPORT_MISMATCH'); // 3
  if (c.currentness_status !== 'CURRENT') reasons.push('CURRENTNESS_NOT_CURRENT'); // 4
  if (!domainVerified) reasons.push('DOMAIN_NOT_VERIFIED');              // 5a
  else if (!domainUnitidMatch) reasons.push('DOMAIN_UNITID_MISMATCH');   // 5b
  else if (domainStatus === 'VERIFIED_ALIAS' && c.aliasIndependentlyProven !== true) reasons.push('ALIAS_NOT_INDEPENDENTLY_PROVEN'); // 5c
  if (!realEmail) reasons.push('NO_REAL_EMAIL');                         // 6a
  else if (status === 'inferred') reasons.push('EMAIL_INFERRED');        // 6b
  else if (status === 'generic') reasons.push('EMAIL_GENERIC');          // 6c
  else if (status !== 'verified') reasons.push('EMAIL_NOT_VERIFIED');    // 6d
  if (!c.email_seen_on_source_url) reasons.push('NO_EMAIL_SEEN_EVIDENCE'); // 7
  if (!c.currentness_source_url) reasons.push('NO_CURRENTNESS_EVIDENCE');  // 8
  if (c.contradiction === true) reasons.push('CONTRADICTORY_EVIDENCE');    // 9

  return { corroborated: reasons.length === 0, reasons };
}
