/**
 * Refuse a fixture whose identities have been redacted for publication.
 *
 * The PR #49 closure rewrote 51 committed audit artifacts so they no longer
 * carry real coach names and addresses — the raw originals stay in the
 * untracked `server/data/generated/audit-fixtures/`. Several of those artifacts
 * are APPLIER INPUTS, and two of them (Phase 6C.1 promotions, 6C.3 acquisition)
 * insert `coaches.full_name` and `coaches.email` straight from the fixture.
 *
 * Re-running one against its COMMITTED copy would therefore write
 * `coach-<uuid>@redacted.invalid` into the coaches table as though it were an
 * address — silently, and looking entirely successful. The redaction that made
 * the repository safe to publish would have made the database wrong.
 *
 * So a redaction token is a hard refusal at the door, before any precondition
 * is evaluated. The operator is told exactly where the unredacted copy lives.
 */
export const REDACTION_MARKERS = ['@redacted.invalid', '[name withheld', '[withheld]'];
export const RAW_FIXTURE_DIR = 'server/data/generated/audit-fixtures/';

/** The markers present in a parsed fixture, or an empty array. */
export function redactionMarkers(fixture) {
  const text = typeof fixture === 'string' ? fixture : JSON.stringify(fixture);
  return REDACTION_MARKERS.filter((m) => text.includes(m));
}

/**
 * Throw unless the fixture still carries real identities. `label` names the
 * file in the message so the operator does not have to guess which one.
 */
export function assertUnredacted(fixture, label = 'this fixture') {
  const hits = redactionMarkers(fixture);
  if (!hits.length) return fixture;
  throw new Error(
    `Refusing to apply ${label}: it is the REDACTED published copy `
    + `(found ${hits.join(', ')}).\n`
    + `  Applying it would write redaction tokens into the database as names and addresses.\n`
    + `  The unredacted original is generated locally, untracked, at:\n`
    + `      ${RAW_FIXTURE_DIR}${String(label).split('/').pop()}\n`
    + '  Pass that path with --fixture / --recovery / --promotion instead.',
  );
}
