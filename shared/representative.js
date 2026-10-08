/**
 * THE ATHLETE'S REPRESENTATIVE, AS COACHES MEET THEM — Phase 2.
 *
 * One module that the email composer (browser and server), the coach-facing
 * profile page and the write boundary all read, so a representative is spelled
 * and validated one way.
 *
 * -- WHAT A REPRESENTATIVE DOES NOT CHANGE -----------------------------------
 *
 * The sender. Outreach still leaves from the athlete's own connected mailbox
 * under the athlete's OAuth grant; nothing here sets a From, a Reply-To or a
 * CC. The representative is who the email and the profile tell a coach to
 * contact - in the sign-off and the call to action - and nothing more.
 *
 * -- WHY THERE IS A FALLBACK ------------------------------------------------
 *
 * Before Phase 2 every composed email ended with one hard-coded consultant.
 * An athlete with no representative assigned keeps exactly that text, byte
 * for byte, so no existing draft or approved message changes underneath an
 * operator. Assigning a representative is what changes it.
 */

/** The sign-off every email carried before representatives existed. */
export const LEGACY_REPRESENTATIVE = Object.freeze({
  full_name: 'Rhys Davies',
  organisation: 'Striv3 Elite Sports Management',
  phone: '+64 21 920 775',
});

/** The fields of a representative a coach may see. Nothing else leaves the server. */
export const PUBLIC_FIELDS = Object.freeze(['id', 'full_name', 'email', 'phone', 'title', 'organisation', 'active']);

export function publicRepresentative(row) {
  if (!row) return null;
  const out = {};
  for (const f of PUBLIC_FIELDS) out[f] = row[f] ?? null;
  return out;
}

const present = (v) => v !== null && v !== undefined && String(v).trim() !== '';

/** A dialable `tel:` target: a leading + and digits, nothing else. Null when there are no digits. */
export function telHref(phone) {
  if (!present(phone)) return null;
  const raw = String(phone).trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  return `${raw.startsWith('+') ? '+' : ''}${digits}`;
}

/**
 * The email tokens for the athlete's representative.
 *
 * `representative_assigned` is '' when the legacy sign-off is in use, so a
 * custom template can tell the two apart with {{#if representative_assigned}}.
 */
export function representativeTokens(representative) {
  const assigned = representative && present(representative.full_name);
  const r = assigned ? representative : LEGACY_REPRESENTATIVE;
  const phone = present(r.phone) ? String(r.phone).trim() : '';
  const tel = telHref(phone);
  return {
    representative_name: String(r.full_name).trim(),
    representative_title: present(r.title) ? String(r.title).trim() : '',
    representative_organisation: present(r.organisation) ? String(r.organisation).trim() : '',
    representative_email: assigned && present(r.email) ? String(r.email).trim() : '',
    representative_phone: tel ? phone : '',
    representative_phone_tel: tel ?? '',
    has_representative_phone: tel ? 'true' : '',
    has_representative_organisation: present(r.organisation) ? 'true' : '',
    representative_assigned: assigned ? 'true' : '',
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Refuse a representative a coach could not actually reach. Returns an error
 * sentence, or null. On an update only the fields in the patch are checked,
 * merged over the stored row.
 */
export function representativeError(data, existing = null) {
  const has = (k) => Object.prototype.hasOwnProperty.call(data ?? {}, k);
  const merged = { ...(existing ?? {}), ...(data ?? {}) };
  if (!present(merged.full_name)) return 'A representative needs a name.';
  if (!present(merged.email)) return 'A representative needs an email address coaches can write to.';
  if ((has('email') || !existing) && !EMAIL.test(String(merged.email).trim())) return `"${merged.email}" is not an email address.`;
  if ((has('phone') || !existing) && present(merged.phone) && !telHref(merged.phone)) return `"${merged.phone}" is not a phone number.`;
  if ((has('phone') || !existing) && present(merged.phone) && telHref(merged.phone).replace('+', '').length < 7) {
    return `"${merged.phone}" is too short to be a phone number.`;
  }
  return null;
}
