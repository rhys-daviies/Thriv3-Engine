/**
 * CANONICAL WRITE GUARD — Phase 7E. Closes the legacy bypass paths.
 *
 * Phase 7E's audit found ~35 writers that change canonical tables without the athletics-
 * entity model: wholesale rebuilds (verifyAthleticsDomains, importInstitutionAliases,
 * importCoachTenure, importProgrammeSeasons, importConferenceSeasons, importRosterSheets
 * broad mode), re-importers that undo adjudicated repairs (loadMatchingInputs would put
 * Saint Francis (IL) back on the Peoria nursing college's UNITID; promoteCoaches would
 * re-insert repaired coach rows), and HTTP functions that fuzzy-match or fabricate.
 *
 * On an INTEGRITY-MANAGED database (the entity model is populated) those writers now refuse
 * to run unless the operator acknowledges, explicitly and with a reason, that they are
 * bypassing the guarded refresh workflow:
 *
 *   --legacy-write-ack --reason "<why this cannot go through integrity:refresh>"
 *
 * and the monitor (npm run integrity:monitor) must be run afterwards. Databases without the
 * model (tests, fresh checkouts) are untouched — the guard is inert there. HTTP routes get
 * the same refusal with no override: an operator tool on the product surface cannot bypass
 * identity integrity.
 */
export class ManagedWriteRefused extends Error {
  constructor(script, detail) {
    super(`${script} writes canonical tables without the athletics-entity model, and this database is integrity-managed.\n`
      + `  Use the guarded workflow: npm run integrity:refresh (stage) -> npm run integrity:promote (gated).\n`
      + `  To bypass deliberately: --legacy-write-ack --reason "<why>" and run npm run integrity:monitor afterwards.${detail ? `\n  ${detail}` : ''}`);
    this.name = 'ManagedWriteRefused';
    this.code = 'INTEGRITY_MANAGED';
  }
}

/** True when the database carries the Phase 7D/7E identity model. */
export function isIntegrityManaged(db) {
  try {
    const t = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='athletics_entities'").get();
    return !!t && !!db.prepare('SELECT 1 FROM athletics_entities LIMIT 1').get();
  } catch { return false; }
}

/** CLI entry-point guard. Returns {managed, acknowledged, reason}; throws ManagedWriteRefused. */
export function assertLegacyWriteAllowed(db, { script, argv = process.argv, detail } = {}) {
  if (!isIntegrityManaged(db)) return { managed: false, acknowledged: false, reason: null };
  if (!argv.includes('--legacy-write-ack')) throw new ManagedWriteRefused(script, detail);
  const i = argv.indexOf('--reason'); const reason = i > -1 ? argv[i + 1] : null;
  if (!reason || reason.startsWith('--') || reason.trim().length < 10) throw new ManagedWriteRefused(script, '--legacy-write-ack needs --reason "<at least a sentence>"');
  console.warn(`\n[integrity] LEGACY WRITE ACKNOWLEDGED by operator: ${script} — ${reason}\n[integrity] run npm run integrity:monitor after this completes.\n`);
  return { managed: true, acknowledged: true, reason };
}

/** Express guard for operator HTTP functions that write canonical tables. */
export function refuseOnManagedDatabase(db, route) {
  return (req, res, next) => {
    if (!isIntegrityManaged(db)) return next();
    return res.status(409).json({ error: `${route} is disabled on an integrity-managed database: it writes canonical tables without the athletics-entity model. Use the guarded refresh workflow (integrity:refresh -> integrity:promote).`, code: 'INTEGRITY_MANAGED' });
  };
}
