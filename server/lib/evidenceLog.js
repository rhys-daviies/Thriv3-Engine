/**
 * Recording what each email said, so we can eventually find out what works.
 *
 * The audit that led to this build found 41 sends, one reply, and nothing
 * anywhere recording which personalisation angle any of them used. Every
 * priority number in shared/evidence/select.js is therefore a bet. This module
 * is what turns those bets into questions the database can answer.
 *
 * Writes are best-effort by design: a failure to log must never stop an email
 * going out, and never be the reason a send loop aborts halfway through a
 * list. A missing row is a gap in the analysis; a thrown error here would be a
 * gap in the campaign.
 */

import db from '../db/client.js';
import { utcNow } from './time.js';
import { evidenceLogPayload } from '../../shared/evidence/index.js';

const upsert = db.prepare(`
  INSERT INTO outreach_evidence (
    outreach_id, athlete_id, college_name, sport, athlete_position, class_year,
    primary_kind, primary_tier, primary_strength,
    secondary_kind, secondary_tier, secondary_strength,
    structure, structure_source, evidence_count, selected_kinds, rendered_count,
    body_source, had_roster, had_history, evidence_rendered,
    primary_confidence, secondary_confidence, template_variant, rendered_paragraph,
    operator_selected, roster_freshness, roster_age_days, payload, created_at
  ) VALUES (
    @outreach_id, @athlete_id, @college_name, @sport, @athlete_position, @class_year,
    @primary_kind, @primary_tier, @primary_strength,
    @secondary_kind, @secondary_tier, @secondary_strength,
    @structure, @structure_source, @evidence_count, @selected_kinds, @rendered_count,
    @body_source, @had_roster, @had_history, @evidence_rendered,
    @primary_confidence, @secondary_confidence, @template_variant, @rendered_paragraph,
    @operator_selected, @roster_freshness, @roster_age_days, @payload, @created_at
  )
  ON CONFLICT(outreach_id) DO UPDATE SET
    primary_kind = excluded.primary_kind,
    primary_tier = excluded.primary_tier,
    primary_strength = excluded.primary_strength,
    secondary_kind = excluded.secondary_kind,
    secondary_tier = excluded.secondary_tier,
    secondary_strength = excluded.secondary_strength,
    structure = excluded.structure,
    structure_source = excluded.structure_source,
    evidence_count = excluded.evidence_count,
    selected_kinds = excluded.selected_kinds,
    rendered_count = excluded.rendered_count,
    body_source = excluded.body_source,
    had_roster = excluded.had_roster,
    had_history = excluded.had_history,
    evidence_rendered = excluded.evidence_rendered,
    primary_confidence = excluded.primary_confidence,
    secondary_confidence = excluded.secondary_confidence,
    template_variant = excluded.template_variant,
    rendered_paragraph = excluded.rendered_paragraph,
    operator_selected = excluded.operator_selected,
    roster_freshness = excluded.roster_freshness,
    roster_age_days = excluded.roster_age_days,
    payload = excluded.payload
`);

/**
 * Records the evidence behind one outreach.
 *
 * Upserts rather than inserts because `createOutreach` is idempotent — writing
 * to the same coach twice returns the existing row — so a second draft to a
 * pair we have already written to must update the record rather than fail a
 * primary-key constraint mid-send. `created_at` is deliberately not touched on
 * update: it dates the first approach, which is what an engagement window is
 * measured from.
 */
/**
 * @param {Set<string>|null} [args.renderedKinds]  which selected kinds the send
 *   path actually found in the body it handed to Outlook. Per ITEM, not per
 *   email: an operator who keeps the opening evidence and deletes the
 *   supporting paragraph has delivered one claim, not three, and logging three
 *   would inflate every angle in the report by exactly the amount the operator
 *   cut. Null means nobody checked.
 * @param {string|null} [args.bodySource]  STRUCTURED or TEMPLATE.
 */
export function logEvidence({
  outreachId, athleteId, collegeName, sport, evidence,
  rendered = null, templateVariant = null, renderedKinds = null, bodySource = null,
}) {
  if (!outreachId || !evidence) return null;
  try {
    const flat = evidenceLogPayload(evidence, { renderedKinds });
    upsert.run({
      outreach_id: outreachId,
      athlete_id: athleteId,
      college_name: collegeName ?? evidence.programme?.name ?? null,
      sport: sport ?? evidence.programme?.sport ?? null,
      athlete_position: evidence.athlete?.position ?? null,
      class_year: evidence.athlete?.classYear ?? null,
      primary_kind: flat.primary_kind,
      primary_tier: flat.primary_tier,
      primary_strength: flat.primary_strength,
      secondary_kind: flat.secondary_kind,
      secondary_tier: flat.secondary_tier,
      secondary_strength: flat.secondary_strength,
      structure: flat.structure,
      structure_source: flat.structure_source,
      evidence_count: flat.evidence_count,
      selected_kinds: flat.selected_kinds,
      rendered_count: flat.rendered_count,
      body_source: bodySource,
      had_roster: evidence.programme?.hasSquad ? 1 : 0,
      had_history: evidence.programme?.hasHistory ? 1 : 0,
      evidence_rendered: rendered === null ? null : (rendered ? 1 : 0),
      // What the present-tense claims rested on at send time. Recorded because
      // a roster re-scraped next month cannot answer "how old was this when we
      // sent it", and that is exactly the question an integrity audit asks.
      roster_freshness: evidence.programme?.freshness?.state ?? null,
      roster_age_days: evidence.programme?.rosterAgeDays ?? null,
      primary_confidence: evidence.primary?.confidence ?? null,
      secondary_confidence: evidence.secondary?.confidence ?? null,
      template_variant: templateVariant,
      // The prose as sent, so an audit never has to re-render from roster data
      // that may since have been re-scraped underneath it.
      rendered_paragraph: evidence.paragraph || null,
      operator_selected: evidence.operatorSelected ? 1 : 0,
      payload: JSON.stringify(flat.payload),
      created_at: utcNow(),
    });
    return true;
  } catch (err) {
    // Logged, not raised. See the module note: an analysis gap is survivable
    // and a half-sent campaign is not.
    console.warn(`  evidence log failed for outreach ${outreachId}: ${err.message}`);
    return false;
  }
}

export function evidenceForOutreach(outreachId) {
  const row = db.prepare('SELECT * FROM outreach_evidence WHERE outreach_id = ?').get(outreachId);
  if (!row) return null;
  return { ...row, payload: safeParse(row.payload) };
}

/**
 * Reply and engagement rate by leading evidence kind — the question the whole
 * build exists to make answerable.
 *
 * Joined to engagement_rollup rather than storing outcomes twice. Rows with no
 * rollup yet count as sent-and-silent, which is the correct denominator: an
 * email nobody engaged with is a result, not a missing measurement.
 *
 * It will say nothing useful for a while. At 41 sends every cell is single
 * digits, and the honest reading of this table before a few hundred sends is
 * "not yet". It is here so the data accumulates from the first send rather
 * than from the day somebody wants the answer.
 */
export function evidencePerformance({ sport = null } = {}) {
  const rows = db.prepare(`
    SELECT
      e.primary_kind,
      e.primary_tier,
      COUNT(*)                                              AS sends,
      SUM(CASE WHEN r.responded_at IS NOT NULL THEN 1 ELSE 0 END) AS replies,
      SUM(CASE WHEN r.qualified_visits > 0 THEN 1 ELSE 0 END)     AS engaged,
      AVG(COALESCE(r.engagement_score, 0))                  AS avg_engagement
    FROM outreach_evidence e
    JOIN outreach o ON o.id = e.outreach_id
    LEFT JOIN engagement_rollup r ON r.outreach_id = e.outreach_id
    WHERE o.sent_at IS NOT NULL
      AND (@sport IS NULL OR e.sport = @sport)
    GROUP BY e.primary_kind, e.primary_tier
    ORDER BY sends DESC
  `).all({ sport });

  return rows.map((r) => ({
    ...r,
    reply_rate: r.sends ? r.replies / r.sends : null,
    engagement_rate: r.sends ? r.engaged / r.sends : null,
  }));
}

/** The same question asked of email structures rather than evidence kinds. */
export function structurePerformance({ sport = null } = {}) {
  return db.prepare(`
    SELECT
      e.structure,
      COUNT(*)                                              AS sends,
      SUM(CASE WHEN r.responded_at IS NOT NULL THEN 1 ELSE 0 END) AS replies,
      SUM(CASE WHEN r.qualified_visits > 0 THEN 1 ELSE 0 END)     AS engaged
    FROM outreach_evidence e
    JOIN outreach o ON o.id = e.outreach_id
    LEFT JOIN engagement_rollup r ON r.outreach_id = e.outreach_id
    WHERE o.sent_at IS NOT NULL
      AND (@sport IS NULL OR e.sport = @sport)
    GROUP BY e.structure
    ORDER BY sends DESC
  `).all({ sport });
}

function safeParse(v) {
  try { return JSON.parse(v); } catch { return null; }
}
