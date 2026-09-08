/**
 * What the outreach actually achieved, grouped by what it said.
 *
 * Reporting only. Nothing here feeds selection or ranking, and it must not:
 * the whole point of building the log before the analysis was to avoid tuning
 * weights against numbers that have not been collected yet.
 *
 * Outcomes come from `engagement_rollup` by join rather than being copied into
 * `outreach_evidence`, so a rebuilt rollup cannot leave two disagreeing
 * answers in the database.
 *
 * The dominant risk in this file is not a wrong number, it is a right number
 * read as a finding. Seven sends of one evidence kind can show a 43% reply
 * rate; three of another can show 0%. Every row therefore carries its own
 * sample size and a verdict, and the verdict is INSUFFICIENT_SAMPLE until
 * there is enough of it to mean anything.
 */

import db from '../db/client.js';

/**
 * How many sends a group needs before its rate is worth reading.
 *
 * 30 is the conventional floor for treating a proportion as anything other
 * than noise, and at a plausible cold-outreach reply rate of 5-15% it is still
 * generous — a 30-send group separates 5% from 30% and very little else. It is
 * a starting value in one place precisely so it can be raised once we know the
 * real base rate.
 *
 * It deliberately does NOT gate sending or evidence selection. It gates the
 * word "better".
 */
export const MIN_SAMPLE = 30;

export const VERDICT = Object.freeze({
  READABLE: 'READABLE',
  INSUFFICIENT_SAMPLE: 'INSUFFICIENT_SAMPLE',
});

export function verdictFor(sends) {
  return sends >= MIN_SAMPLE ? VERDICT.READABLE : VERDICT.INSUFFICIENT_SAMPLE;
}

/**
 * The outcome columns, written once because five groupings share them.
 *
 * `rendered` counts sends where the evidence sentence actually survived into
 * the body. It is the honest denominator for any claim about an evidence
 * kind: a send whose paragraph the operator deleted tells us nothing about
 * that angle, and counting it would dilute the very effect being measured.
 *
 * An outreach with no rollup row counts as sent-and-silent rather than as
 * missing. That is correct: an email nobody engaged with is a result.
 */
// COALESCE on every SUM: over zero rows SQLite returns NULL, and a report
// that prints "null sent" reads as a broken query rather than as an empty one.
const METRICS = `
  COUNT(*)                                                                  AS sends,
  COALESCE(SUM(CASE WHEN e.evidence_rendered = 1 THEN 1 ELSE 0 END), 0)     AS rendered_sends,
  COALESCE(SUM(CASE WHEN e.operator_selected = 1 THEN 1 ELSE 0 END), 0)     AS operator_selected_sends,
  COALESCE(SUM(CASE WHEN r.qualified_visits > 0 THEN 1 ELSE 0 END), 0)      AS opened,
  COALESCE(SUM(CASE WHEN r.best_coverage_pct > 0 THEN 1 ELSE 0 END), 0)     AS clicked,
  COALESCE(SUM(CASE WHEN r.responded_at IS NOT NULL THEN 1 ELSE 0 END), 0)  AS replies,
  AVG(COALESCE(r.engagement_score, 0))                                      AS avg_engagement
`;

const FROM = `
  FROM outreach_evidence e
  JOIN outreach o ON o.id = e.outreach_id
  LEFT JOIN engagement_rollup r ON r.outreach_id = e.outreach_id
  WHERE o.sent_at IS NOT NULL
    AND (@sport IS NULL OR e.sport = @sport)
    AND (@athleteId IS NULL OR e.athlete_id = @athleteId)
`;

function decorate(rows) {
  return rows.map((r) => ({
    ...r,
    avg_engagement: r.avg_engagement == null ? null : Math.round(r.avg_engagement * 10) / 10,
    // Rates over the sends whose sentence actually reached a coach. Null
    // rather than zero when none did — a rate with no denominator is not 0%,
    // it is unanswerable, and printing 0% invites exactly the wrong reading.
    reply_rate: r.rendered_sends ? r.replies / r.rendered_sends : null,
    open_rate: r.rendered_sends ? r.opened / r.rendered_sends : null,
    verdict: verdictFor(r.rendered_sends),
  }));
}

const group = (expr, filter = '') => `SELECT ${expr}, ${METRICS} ${FROM} ${filter} GROUP BY 1 ORDER BY sends DESC`;

/** Everything, by the leading evidence angle. */
export function byPrimaryKind(o = {}) {
  return decorate(run(group('e.primary_kind AS kind'), o));
}

/** The supporting angle, which no other grouping isolates. */
export function bySecondaryKind(o = {}) {
  return decorate(run(group('e.secondary_kind AS kind', 'AND e.secondary_kind IS NOT NULL'), o));
}

/** FACT against SIGNAL — the question with the best chance of a readable answer. */
export function byTier(o = {}) {
  return decorate(run(group('e.primary_tier AS tier'), o));
}

/**
 * Which template shape rendered the email. This is the variable that actually
 * differs between athletes today.
 */
export function byTemplateVariant(o = {}) {
  return decorate(run(group('e.template_variant AS template_variant'), o));
}

/**
 * The engine's chosen structure.
 *
 * `comparable: false` survives the structure library, for a different reason
 * than before. Structures now change the wording — that was the point of
 * building them — but which structure an email gets is DETERMINED BY the
 * evidence selected for it, so the two variables move together by design. A
 * programme drawing INTERNATIONAL_CONNECTION is a programme with a strong
 * country connection; a difference in reply rate between that and PLAYER_FIRST
 * is a difference between those programmes at least as much as between the two
 * shapes.
 *
 * Rows written before 2026-08-28 are worse than confounded: the structure key
 * was logged while the email rendered from the athlete's template, so it
 * changed no words at all. `structure_source` and `body_source` separate the
 * two eras — a row with body_source NULL predates composition.
 *
 * Separating structure from evidence needs controlled assignment: the same
 * evidence set rendered through two eligible structures, chosen at random. Not
 * built, deliberately, and not to be inferred from these rows in the meantime.
 */
export function byStructure(o = {}) {
  return {
    comparable: false,
    note: 'Structure now changes the wording, but it is CHOSEN BY the evidence, so the two '
      + 'move together: a difference between these rows is a difference between the '
      + 'programmes each structure fits at least as much as an effect of the shape. Rows '
      + 'with body_source NULL are older still — the structure was logged while the email '
      + "rendered from the athlete's template and changed no words. Observational only "
      + 'until assignment is randomised within an eligible set.',
    rows: decorate(run(group('e.structure AS structure'), o)),
  };
}

/**
 * The whole ordered evidence set, as one group.
 *
 * The question a combination answers that no single kind does: whether leading
 * with the country connection and supporting with the roster beats the
 * reverse. Order is part of the group key, which makes the groups small — this
 * will read INSUFFICIENT_SAMPLE for a long time, and should.
 */
export function bySelectedSet(o = {}) {
  return decorate(run(group("COALESCE(e.selected_kinds, '(none)') AS selected_kinds"), o));
}

/**
 * How many pieces of evidence the email carried.
 *
 * The most likely thing to show an effect early, because it has the fewest
 * levels and the most rows per level. It is also the most easily
 * over-interpreted: an email with four pieces went to a programme we know a
 * lot about, and knowing a lot about a programme correlates with it being a
 * bigger, better-documented one. Confounded, like everything else here.
 */
export function byEvidenceCount(o = {}) {
  return decorate(run(group('e.evidence_count AS evidence_count'), o));
}

/**
 * Whether the body was assembled from a structure or rendered from the
 * athlete's saved template.
 *
 * The cleanest of the new groupings, because it is nearly independent of the
 * evidence: it is decided by whether the athlete has customised their
 * template, which has nothing to do with the programme being written to.
 */
export function byBodySource(o = {}) {
  return decorate(run(group("COALESCE(e.body_source, '(pre-composition)') AS body_source"), o));
}

/**
 * How completely the evidence survived the operator's editing.
 *
 * `rendered_count` against `evidence_count`. A gap here is not a fault — an
 * operator cutting a weak third sentence is the system working — but it is the
 * number that decides whether any of the rows above are measuring what they
 * claim to.
 */
export function renderCompleteness({ sport = null, athleteId = null } = {}) {
  const row = db.prepare(`
    SELECT
      COUNT(*)                                                     AS rows_with_evidence,
      COALESCE(SUM(e.evidence_count), 0)                           AS claims_selected,
      -- Denominator counts only the sends whose items were actually checked.
      -- The 49 sends that predate per-item checking carry rendered_count NULL,
      -- and dividing their claims into a numerator they never contributed to
      -- printed "0 of 98 (0%)" — a rate of zero where the truthful answer is
      -- that nobody looked. Unchecked rows are reported separately instead.
      COALESCE(SUM(CASE WHEN e.rendered_count IS NOT NULL THEN e.evidence_count ELSE 0 END), 0)
                                                                   AS claims_checked,
      COALESCE(SUM(e.rendered_count), 0)                           AS claims_delivered,
      COALESCE(SUM(CASE WHEN e.rendered_count IS NULL THEN 1 ELSE 0 END), 0) AS unchecked
    ${FROM}
      AND e.evidence_count > 0
  `).get({ sport, athleteId });
  return {
    ...row,
    delivery_rate: row.claims_checked ? row.claims_delivered / row.claims_checked : null,
  };
}

/** How present-tense claims were faring when they went out. */
export function byRosterFreshness(o = {}) {
  return decorate(run(group("COALESCE(e.roster_freshness, 'UNKNOWN') AS roster_freshness"), o));
}

function run(sql, { sport = null, athleteId = null } = {}) {
  return db.prepare(sql).all({ sport, athleteId });
}

/**
 * Sends that carry no evidence row at all.
 *
 * Reported rather than backfilled. The 41 sends on file predate the log, and
 * writing evidence rows for them now would attribute angles to emails that
 * never contained them — fabricating exactly the measurement this table exists
 * to make honest. They are counted here so nobody reads "0 sent" as a bug.
 */
export function unattributedSends({ sport = null, athleteId = null } = {}) {
  return db.prepare(`
    SELECT COUNT(*) AS n FROM outreach o
    LEFT JOIN outreach_evidence e ON e.outreach_id = o.id
    LEFT JOIN players p ON p.id = o.athlete_id
    WHERE o.sent_at IS NOT NULL AND e.outreach_id IS NULL
      AND (@sport IS NULL OR p.sport = @sport)
      AND (@athleteId IS NULL OR o.athlete_id = @athleteId)
  `).get({ sport, athleteId }).n;
}

/** Headline counts, so a reader knows the size of everything below. */
export function totals({ sport = null, athleteId = null } = {}) {
  const row = db.prepare(`SELECT ${METRICS} ${FROM}`).get({ sport, athleteId });
  return {
    ...row,
    avg_engagement: row.avg_engagement == null ? null : Math.round(row.avg_engagement * 10) / 10,
    reply_rate: row.rendered_sends ? row.replies / row.rendered_sends : null,
    verdict: verdictFor(row.rendered_sends || 0),
    min_sample: MIN_SAMPLE,
  };
}

/** The whole report in one object, for a CLI or a route. */
export function evidenceReport(o = {}) {
  return {
    minSample: MIN_SAMPLE,
    unattributedSends: unattributedSends(o),
    totals: totals(o),
    byPrimaryKind: byPrimaryKind(o),
    bySecondaryKind: bySecondaryKind(o),
    byTier: byTier(o),
    byTemplateVariant: byTemplateVariant(o),
    byRosterFreshness: byRosterFreshness(o),
    byStructure: byStructure(o),
    bySelectedSet: bySelectedSet(o),
    byEvidenceCount: byEvidenceCount(o),
    byBodySource: byBodySource(o),
    renderCompleteness: renderCompleteness(o),
  };
}
