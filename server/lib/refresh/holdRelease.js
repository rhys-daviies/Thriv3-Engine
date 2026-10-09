/**
 * HELD-DOMAIN RELEASE PROOF — Phase DI-03F (DI-03E MAJOR-3). Which of the code-level releases in
 * shared/heldDomainAdjudications.js HELD_DOMAIN_RELEASES are PROVEN in this database?
 *
 * A release is proven only if ALL hold, read from the database itself:
 *   - its correction ledger (correctionLedger.js) has the named ledger_id: a COMPOSITE_CORRECTION that
 *     COMMITTED and has not been reverted, with exactly the named manifest hash (re-computed from the
 *     stored canonical manifest);
 *   - that correction targeted a SHARED_DEV or PRODUCTION database — a rehearsal on a disposable copy
 *     never releases anything;
 *   - its stored signed approval still verifies against the reviewer registry, as of the commit
 *     instant, for that target (enrolled keys, scopes, enough distinct reviewers); its body hash is the
 *     one the ledger and manifest record; and the approval lists this exact release;
 *   - the manifest moved this domain from the held owner to the released owner, and the row still
 *     names the released owner now.
 * A fabricated or hand-written manifest has no ledger row; a typed reviewer has no signature; a
 * mismatched approval id or release fails the binding. Any doubt keeps the hold.
 */
import { HELD_DOMAIN_RELEASES, holdRecord, normHeldDomain } from '../../../shared/heldDomainAdjudications.js';
import { verifyApproval, APPROVAL_KINDS, ENV } from './approvalValidator.js';
import { ledgerEntry, manifestSha, LEDGER_KINDS } from './correctionLedger.js';

const EMPTY = Object.freeze(new Set());

/** Problems proving one release in this database ([] = proven). */
export function releaseProofProblems(db, r) {
  const p = [];
  const hold = holdRecord(r?.domain);
  if (!hold || r.domain !== hold.domain) return [`${r?.domain}: not exactly a held domain`];
  const row = ledgerEntry(db, r.ledger_id);
  if (!row) return [`ledger ${r.ledger_id} is not in this database — the correction never committed here`];
  if (row.kind !== LEDGER_KINDS.CORRECTION) p.push(`ledger ${r.ledger_id} is a ${row.kind}, not a correction`);
  if (row.status !== 'COMMITTED') p.push(`ledger ${r.ledger_id} is ${row.status}`);
  if (![ENV.SHARED_DEV, ENV.PRODUCTION].includes(row.target_class)) p.push(`ledger ${r.ledger_id} was committed to a ${row.target_class} database — a rehearsal never releases a hold`);
  let man; let env;
  try { man = JSON.parse(row.manifest_json); env = JSON.parse(row.approval_json); } catch { return [...p, 'ledger row unreadable']; }
  if (row.manifest_sha256 !== r.manifest_sha256 || manifestSha(man) !== r.manifest_sha256) p.push('manifest hash does not match the release');
  if (man.ledger_id !== row.ledger_id || man.approval_body_hash !== row.approval_body_hash) p.push('manifest is not bound to its ledger row');
  let v;
  try { v = verifyApproval(env, { kind: APPROVAL_KINDS.COMPOSITE, target: { class: row.target_class, identity: row.target_identity }, at: row.committed_at }); } catch (e) { v = { problems: [e.message], grant: null }; }
  if (v.problems.length) p.push(...v.problems.map((x) => `approval: ${x}`));
  else if (v.grant.body_hash !== row.approval_body_hash) p.push('approval body is not the one the ledger recorded');
  const listed = (env?.body?.hold_releases || []).some((x) => x?.release_id === r.release_id && x?.domain === hold.domain && Number(x?.released_to_unitid) === Number(r.released_to_unitid));
  if (!listed) p.push(`the signed approval does not list release ${r.release_id}`);
  const moved = (man.manifest || []).flatMap((m) => m.entries || []).some((e) => e.table === 'athletics_domains' && e.kind === 'UPDATE'
    && normHeldDomain(e.key?.domain) === hold.domain && Number(e.old?.unitid) === Number(hold.stored_unitid) && Number(e.new?.unitid) === Number(r.released_to_unitid));
  if (!moved) p.push(`the manifest does not move ${hold.domain} from ${hold.stored_unitid} to ${r.released_to_unitid}`);
  const cur = db.prepare('SELECT unitid FROM athletics_domains WHERE domain = ?').get(hold.domain);
  if (!cur || Number(cur.unitid) !== Number(r.released_to_unitid)) p.push(`${hold.domain} no longer names ${r.released_to_unitid} in this database`);
  return p;
}

/** The normalised held domains whose release is proven in `db` (pass to isHeldDomain). */
export function releasedHeldDomains(db, { releases = HELD_DOMAIN_RELEASES } = {}) {
  if (!releases.length || !db) return EMPTY;
  const out = new Set();
  for (const r of releases) { try { if (!releaseProofProblems(db, r).length) out.add(normHeldDomain(r.domain)); } catch { /* any doubt keeps the hold */ } }
  return out;
}
