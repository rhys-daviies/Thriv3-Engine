import { randomUUID } from 'node:crypto';
import db from '../db/client.js';
import { utcNow } from './time.js';
import { buildSendSnapshot } from '../../shared/evidence/sendSnapshot.js';
import { LEGACY_POLICY_VERSION } from '../../shared/evidence/outreachPolicy.js';

/**
 * PERSISTING ONE OUTBOUND EMAIL.
 *
 * Two phases, because the world has two phases and pretending otherwise is
 * what produced the defect this replaces.
 *
 *   DRAFT       a body exists and reached Outlook. The snapshot is frozen HERE,
 *               before anything can move underneath it, and the row is created
 *               with `sent_at` null.
 *   CONFIRM     something we observed sent it — Outlook's own Send, or the
 *               operator saying so through `npm run confirm-sends`. `sent_at`
 *               is stamped and the row becomes an analytics send.
 *
 * A draft is not a send and a preview is not a draft. Only `sent_at IS NOT
 * NULL` counts, which is the denominator I1 found trustworthy and this does
 * not weaken.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS MUTABLE, AND WHERE IT STOPS.
 *
 * A PENDING row is the draft currently sitting in Outlook, and re-drafting to
 * the same coach REPLACES it — same sequence, new snapshot — exactly as
 * `outreach.drafted_at` has always overwritten. Redrafting is not a follow-up.
 *
 * A CONFIRMED row is frozen. Nothing here updates one, and the next draft to
 * that coach opens a new row at the next sequence. So send 1 keeps its own
 * evidence however many times send 2 is rewritten, which is the property the
 * old single-row model could not offer.
 */

const insertSend = db.prepare(`
  INSERT INTO outreach_send (
    id, outreach_id, sequence, drafted_at, sent_at,
    athlete_id, coach_id, college_name, sport, policy_version,
    structure, structure_source, body_source, template_variant,
    has_personalisation, primary_kind, primary_role, hook_kind,
    rendered_kinds, rendered_roles, rendered_count,
    subject, body_hash, payload, created_at
  ) VALUES (
    @id, @outreach_id, @sequence, @drafted_at, @sent_at,
    @athlete_id, @coach_id, @college_name, @sport, @policy_version,
    @structure, @structure_source, @body_source, @template_variant,
    @has_personalisation, @primary_kind, @primary_role, @hook_kind,
    @rendered_kinds, @rendered_roles, @rendered_count,
    @subject, @body_hash, @payload, @created_at
  )
`);

/** The unsent draft for this relationship, if one is open. At most one. */
const pendingFor = db.prepare(
  'SELECT * FROM outreach_send WHERE outreach_id = ? AND sent_at IS NULL ORDER BY sequence DESC LIMIT 1',
);

/**
 * The next sequence number for this relationship.
 *
 * Confirmed sends plus one. A pending draft does not advance it — replacing an
 * unsent draft is not a second message — so drafting five times and sending
 * once produces sequence 1, not sequence 5.
 */
export function nextSequence(outreachId) {
  const { n } = db.prepare(
    'SELECT COUNT(*) AS n FROM outreach_send WHERE outreach_id = ? AND sent_at IS NOT NULL',
  ).get(outreachId);
  return n + 1;
}

/**
 * Record that a body reached Outlook, with the evidence that produced it.
 *
 * @returns {{id, sequence}} the send this draft belongs to.
 */
export function recordDraft({
  outreachId, athleteId, coachId, collegeName = null, sport = null,
  evidence, body = null, subject = null,
  bodySource = null, templateVariant = null, renderedKinds = null,
  at = utcNow(),
}) {
  const snapshot = buildSendSnapshot({
    evidence, body, subject, bodySource, templateVariant, renderedKinds,
  });
  const open = pendingFor.get(outreachId);
  const row = {
    id: open?.id ?? randomUUID(),
    outreach_id: outreachId,
    sequence: open?.sequence ?? nextSequence(outreachId),
    drafted_at: at,
    sent_at: null,
    athlete_id: athleteId,
    coach_id: coachId,
    college_name: collegeName,
    sport,
    policy_version: snapshot.policy_version,
    structure: snapshot.structure,
    structure_source: snapshot.structure_source,
    body_source: snapshot.body_source,
    template_variant: snapshot.template_variant,
    has_personalisation: snapshot.has_personalisation ? 1 : 0,
    primary_kind: snapshot.primary_kind,
    primary_role: snapshot.primary_role,
    hook_kind: snapshot.hook_kind,
    rendered_kinds: snapshot.rendered_kinds,
    rendered_roles: snapshot.rendered_roles,
    rendered_count: snapshot.rendered_count,
    subject: snapshot.subject,
    body_hash: snapshot.body_hash,
    payload: JSON.stringify(snapshot.payload),
    created_at: open?.created_at ?? at,
  };
  if (open) {
    // Replaces the draft in Outlook, and only ever a draft: the WHERE clause
    // cannot reach a confirmed row.
    db.prepare(`
      UPDATE outreach_send SET
        drafted_at = @drafted_at, policy_version = @policy_version,
        structure = @structure, structure_source = @structure_source,
        body_source = @body_source, template_variant = @template_variant,
        has_personalisation = @has_personalisation, primary_kind = @primary_kind,
        primary_role = @primary_role, hook_kind = @hook_kind,
        rendered_kinds = @rendered_kinds, rendered_roles = @rendered_roles,
        rendered_count = @rendered_count, subject = @subject,
        body_hash = @body_hash, payload = @payload,
        college_name = @college_name, sport = @sport
      WHERE id = @id AND sent_at IS NULL
    `).run(row);
  } else {
    insertSend.run(row);
  }
  return { id: row.id, sequence: row.sequence };
}

/**
 * Confirm the open draft for this relationship as sent.
 *
 * Idempotent and one-way: a confirmed row is never re-stamped, so a second
 * confirmation cannot move a send forward out of an engagement window. Returns
 * null when there was no open draft — which is the honest answer for a
 * relationship confirmed before this table existed.
 */
export function confirmSend(outreachId, at = utcNow()) {
  const open = pendingFor.get(outreachId);
  if (!open) return null;
  db.prepare('UPDATE outreach_send SET sent_at = ? WHERE id = ? AND sent_at IS NULL')
    .run(at, open.id);
  return { id: open.id, sequence: open.sequence, sent_at: at };
}

/* -------------------------------------------------------------------------- */
/* The analytics read boundary                                                 */
/* -------------------------------------------------------------------------- */

const parse = (row) => (row ? { ...row, payload: safeParse(row.payload) } : null);
const safeParse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

/**
 * Confirmed sends, with the relationship they belong to.
 *
 * THE ONLY PATH ANALYTICS MAY TAKE, and it reads stored columns. It does not
 * import `evidenceFor`, `outreachEvidenceFor` or `outreachCopyFor`, and a test
 * asserts that it never will: the moment a historical decision can be rebuilt
 * from today's data, it will be — and today's data says something else. The
 * stored sentence reads "you've got three defenders graduating in 2027"; the
 * same programme re-rendered now says "three defenders are listed to graduate
 * in 2027". Re-rendering would fabricate an email nobody received.
 *
 * `policyVersion` defaults to nothing so a caller must decide. Pooling P2 with
 * LEGACY_UNKNOWN is averaging two products; the filter makes that a choice
 * rather than an accident.
 */
export function confirmedSends({ policyVersion = null, athleteId = null, sport = null } = {}) {
  return db.prepare(`
    SELECT s.*, o.token, o.match_id, c.email AS coach_email, c.position_title AS coach_title
    FROM outreach_send s
    JOIN outreach o ON o.id = s.outreach_id
    LEFT JOIN coaches c ON c.id = s.coach_id
    WHERE s.sent_at IS NOT NULL
      AND (@policyVersion IS NULL OR s.policy_version = @policyVersion)
      AND (@athleteId IS NULL OR s.athlete_id = @athleteId)
      AND (@sport IS NULL OR s.sport = @sport)
    ORDER BY s.sent_at, s.id
  `).all({ policyVersion, athleteId, sport }).map(parse);
}

/** Every send for one relationship, initial first. For a drilldown, later. */
export function sendsForOutreach(outreachId) {
  return db.prepare('SELECT * FROM outreach_send WHERE outreach_id = ? ORDER BY sequence')
    .all(outreachId).map(parse);
}

/** One send by its own id. */
export function sendById(id) {
  return parse(db.prepare('SELECT * FROM outreach_send WHERE id = ?').get(id));
}

/**
 * How many confirmed sends we hold under each policy.
 *
 * The first thing any future analysis must look at: LEGACY_UNKNOWN rows record
 * a product that no longer exists and may not be pooled with P2.
 */
export function sendsByPolicy() {
  return db.prepare(`
    SELECT policy_version,
           COUNT(*) AS sends,
           SUM(CASE WHEN payload IS NOT NULL THEN 1 ELSE 0 END) AS with_snapshot,
           SUM(CASE WHEN has_personalisation = 1 THEN 1 ELSE 0 END) AS personalised
    FROM outreach_send WHERE sent_at IS NOT NULL
    GROUP BY policy_version ORDER BY sends DESC
  `).all();
}

export { LEGACY_POLICY_VERSION };
