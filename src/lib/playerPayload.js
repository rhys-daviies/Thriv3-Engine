import { PREFERENCE_FIELD_NAMES } from '@/lib/preferenceIntake';

/**
 * The player row a form submission becomes.
 *
 * Lifted out of NewPlayer.jsx in A7.9.3 so it can be tested without a DOM:
 * the contribution pair has a rule that the generic "drop every empty value"
 * pass gets exactly backwards, and that rule deserves tests of its own. The
 * three A7.12.1 preferences have the same rule, for the same reason.
 */
export function sanitizePlayerData(raw) {
  const out = { ...raw };
  out.gpa = out.gpa === '' || out.gpa === null || out.gpa === undefined ? undefined : parseFloat(out.gpa);
  out.graduation_year = out.graduation_year === '' ? undefined : Number(out.graduation_year);
  out.recruiting_class_year = out.recruiting_class_year === '' ? undefined : Number(out.recruiting_class_year);
  out.sat_score = out.sat_score === '' ? undefined : Number(out.sat_score);
  out.act_score = out.act_score === '' ? undefined : Number(out.act_score);
  out.height_cm = out.height_cm === '' ? undefined : Number(out.height_cm);
  out.weight_kg = out.weight_kg === '' ? undefined : Number(out.weight_kg);
  // 'Not Important' is the slider's N/A sentinel. It has to reach the database
  // as a real null, or "no minimum" would be stored as a string and read as a
  // floor of NaN.
  out.academic_minimum = out.academic_minimum === 'Not Important' || out.academic_minimum === '' || out.academic_minimum == null
    ? null
    : Number(out.academic_minimum);

  for (const key of Object.keys(out)) {
    if (out[key] === undefined || out[key] === '' || out[key] === null) delete out[key];
  }

  /**
   * The contribution pair travels together or not at all.
   *
   * The loop above deletes every null, which is right for a field the operator
   * left blank and catastrophic for this one: `max_annual_contribution_usd:
   * null` is not an absent answer, it is the answer that NOT_A_CONSTRAINT and
   * NEEDS_CONFIRMATION both require. Dropping it would leave a stale maximum
   * on the row, and the server checks the row a patch would produce, so the
   * save would fail with nothing on screen to explain why.
   */
  if (raw.contribution_state) {
    out.contribution_state = raw.contribution_state;
    out.max_annual_contribution_usd = raw.contribution_state === 'STATED'
      ? Number(raw.max_annual_contribution_usd)
      : null;
  }

  /**
   * The three preferences travel explicitly, including when the answer is
   * "unanswered".
   *
   * Same trap as the contribution pair: the loop above deletes every null,
   * and an omitted key is "leave this column alone". On an edit that is the
   * difference between clearing an answer and appearing to clear it - the
   * radio would come back empty, the save would report success, and the old
   * value would still be in the row and still be reaching the scorer.
   */
  for (const field of PREFERENCE_FIELD_NAMES) {
    if (Object.prototype.hasOwnProperty.call(raw, field)) {
      out[field] = raw[field] === '' || raw[field] === undefined ? null : raw[field];
    }
  }

  // A ranking reset to null must reach the server as an explicit empty array,
  // not be dropped by the loop above — dropping it leaves the previous ranking
  // in place, so "Reset to defaults" would appear to do nothing on save.
  if (raw.criterion_ranking === null || raw.criterion_ranking === undefined) out.criterion_ranking = [];

  // Same reason: clearing a minimum has to be sent, not dropped by the loop
  // above, or "back to N/A" would silently keep the old floor.
  if (out.academic_minimum === undefined) out.academic_minimum = null;
  return out;
}
