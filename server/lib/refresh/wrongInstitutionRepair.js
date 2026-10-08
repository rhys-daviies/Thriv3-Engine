/**
 * WRONG_INSTITUTION REPAIR — Phase 1G-PRE. Which decided-wrong athletics_domains rows may be
 * reversed, decided by one deterministic rule, and the protected-correction fixture that does it.
 *
 * THE DEFECT. verifyAthleticsDomains.js (2026-09-01) set a host's row status with
 * `wrong.length ? WRONG_INSTITUTION : ...`: refuting ONE claimant condemned the whole host, even
 * when the page named the row's stored UNITID and another claim agreed (Phase 8C.5D corrected
 * three such hosts by hand). Every reader then distrusts the host — ownerOfHost, the legacy
 * institution resolver, the coach reconciler — so the institution's own athletics site cannot
 * prove its own staff.
 *
 * WHY A RULE AND NOT "THE STORED UNITID WINS". Of the 49 rows on 2026-10-08, four store the WRONG
 * institution: the page names the refuted claimant (rattlerathletics.com is St. Mary's TX, stored
 * as Saint Mary's CA; ucgoldeneagles.com is Charleston WV, stored as College of Charleston), the
 * claimant's own site links the host, and the staff on it use the claimant's mail domain. For
 * those, WRONG_INSTITUTION is protecting us. A blanket reversal would have made them trusted for
 * the wrong school. So a row is reversed only when independent evidence agrees on the owner:
 *
 *   R1 the row is WRONG_INSTITUTION with a stored owner UNITID, at least one refuted claimant,
 *      and the owner is not itself among the refuted
 *   R2 the page's self-identification is a CERTAIN whole name on its athletics site
 *      (og:site_name / title) that is a FEDERAL REGISTRY name of the owner (IPEDS INSTNM, a
 *      hyphen part of it, or an IPEDS ALIAS) and of no refuted claimant
 *   R3 a mapping claim agrees with the owner (Phase 2C: self-identification alone never verifies)
 *   R4 boundaries: the UNITID carries exactly one SINGLE entity and no campus; no www twin row;
 *      not held; not a shared platform root; no entity assigned yet
 *   R5 corroboration, observed fresh: the owner's own institution site links the host, no
 *      refuted claimant's site links it, and no verified staff member published on the host
 *      uses a refuted claimant's federal website domain
 *
 * The fixture this builds is applied ONLY by the existing protected-correction path
 * (protectedCorrection.js), which re-checks the complete expected-old row, keeps the stored
 * UNITID, wrong_mappings and every evidence column byte-identical, and changes status,
 * athletics_entity_id, ownership_class and notes alone. Nothing here writes.
 *
 * The canonical selfIdentifies() (changeClassifier.js) is deliberately NOT the R2 test: it
 * compares normalised short names ("Georgetown University" -> "georgetown", which Georgetown
 * College also is) and ties on 8 of these legitimate hosts. The federal registry name is the
 * discriminating record.
 */
import { nameKey } from './adapters/institutionNames.js';
import { registrableDomain } from '../institutionResolver.js';
import { SHARED_PLATFORM_ROOT } from './identityResolver.js';
import { fixtureHash, PROTECTED_CORRECTION_KIND } from './protectedCorrection.js';
import { isHeldDomain } from '../../../shared/heldDomainAdjudications.js';

export const RULE_VERSION = '1G-PRE-R1-R5';
export const WHY_WRONG = 'domain status rule (wrong.length ? WRONG_INSTITUTION : ...) turned the refutation of ANOTHER claimant into the whole row status although the host self-identifies as the stored UNITID and a claim agrees (decision logic, not evidence)';

const SELF_ID_KINDS = new Set(['OG_SITE_NAME', 'PAGE_TITLE']);
const lc = (s) => String(s ?? '').trim().toLowerCase();
const bare = (h) => lc(h).replace(/^www\./, '');
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };
const regOf = (host) => (host ? registrableDomain(`https://${bare(host)}/`) : null);

/** The page's institution name, without the athletics-site dressing around it. */
export function selfIdName(text) {
  return String(text ?? '')
    .replace(/\s*[-–|:]\s*official.*$/i, '')
    .replace(/\s+(athletics?|sports)\s*$/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
}

/** Every federal registry name of one institution, as name keys: INSTNM, its hyphen parts, ALIAS. */
export function registryNames(reg) {
  if (!reg) return new Set();
  const names = [reg.INSTNM, ...String(reg.INSTNM || '').split(/\s*-\s*/).filter((x) => x.length > 3),
    ...String(reg.ALIAS || '').split(/[|,;]/).map((x) => x.trim()).filter((x) => x.length > 1 && x !== 'NA')];
  return new Set(names.map(nameKey).filter(Boolean));
}

/** The registrable domain of an institution's federal website (IPEDS INSTURL). */
export function registryDomain(reg) {
  if (!reg?.INSTURL) return null;
  return regOf(String(reg.INSTURL).replace(/^https?:\/\//i, '').replace(/[/?#].*$/, ''));
}

/**
 * Everything the rule reads, loaded once (read-only).
 *   registry: Map UNITID -> { UNITID, INSTNM, ALIAS, INSTURL } (federal registry rows)
 *   evidence: { links: { host: 'what links it' }, claimantLinks: { host: 'which claimant links it' } }
 */
export function loadRepairContext(db, { registry, evidence }) {
  const entities = db.prepare('SELECT * FROM athletics_entities').all();
  const domains = db.prepare('SELECT * FROM athletics_domains').all();
  const staffByHost = new Map();
  for (const c of db.prepare("SELECT email, email_source_url FROM coaches WHERE email_status = 'verified' AND email LIKE '%@%' AND email_source_url LIKE 'http%'").all()) {
    const h = hostOf(c.email_source_url); if (!h || /web\.archive\.org/.test(h)) continue;
    (staffByHost.get(h) || staffByHost.set(h, []).get(h)).push(c);
  }
  const reg = registry instanceof Map ? registry : new Map((registry || []).map((r) => [Number(r.UNITID), r]));
  return { entities, domains, staffByHost, registry: reg, links: evidence?.links || {}, claimantLinks: evidence?.claimantLinks || {} };
}

/** Judge one WRONG_INSTITUTION row against R1-R5. Returns { host, eligible, failures[], owner, evidence }. */
export function assessRow(row, ctx) {
  const host = bare(row.domain);
  const failures = [];
  const unitid = row.unitid == null ? null : Number(row.unitid);
  const wrong = parse(row.wrong_mappings) || [];
  const claimed = (parse(row.claimed_unitids) || []).map(Number);
  const claimantIds = [...new Set(wrong.map((w) => Number(w.claimantUnitid)))];

  // R1
  if (row.status !== 'WRONG_INSTITUTION') failures.push(`R1 status is ${row.status}, not WRONG_INSTITUTION`);
  if (unitid == null) failures.push('R1 no stored owner UNITID');
  if (!wrong.length) failures.push('R1 no refuted claimant to preserve');
  if (unitid != null && claimantIds.includes(unitid)) failures.push('R1 the stored owner is itself a refuted claimant');

  // R2
  if (!(row.confidence === 'CERTAIN' && row.identity_strength === 'WHOLE_NAME' && row.role === 'ATHLETICS_SITE' && SELF_ID_KINDS.has(row.evidence_kind))) {
    failures.push('R2 self-identification below the refutation standard (CERTAIN whole name, athletics site, og:site_name/title)');
  }
  const pageName = selfIdName(row.evidence_text);
  const pageKey = nameKey(pageName);
  if (!pageKey || !registryNames(ctx.registry.get(unitid)).has(pageKey)) failures.push(`R2 page name "${pageName}" is not a federal registry name of ${unitid}`);
  const namesClaimant = wrong.filter((w) => registryNames(ctx.registry.get(Number(w.claimantUnitid))).has(pageKey)).map((w) => w.key);
  if (namesClaimant.length) failures.push(`R2 page name "${pageName}" is also a federal registry name of refuted claimant(s) ${[...new Set(namesClaimant)].join(', ')}`);

  // R3
  if (unitid != null && !claimed.includes(unitid)) failures.push('R3 no mapping claim agrees with the stored owner');

  // R4
  const own = ctx.entities.filter((e) => e.federal_unitid != null && Number(e.federal_unitid) === unitid);
  const campus = ctx.entities.filter((e) => e.parent_unitid != null && Number(e.parent_unitid) === unitid);
  const owner = own.length === 1 && own[0].entity_kind === 'SINGLE' && campus.length === 0 ? own[0].athletics_entity_id : null;
  if (!owner) failures.push(`R4 UNITID ${unitid} is not exactly one SINGLE entity without campuses (${own.length} entit${own.length === 1 ? 'y' : 'ies'}, ${campus.length} campus)`);
  if (ctx.domains.some((d) => d !== row && bare(d.domain) === host)) failures.push('R4 a www twin row exists');
  if (isHeldDomain(host)) failures.push('R4 held for external adjudication');
  if (SHARED_PLATFORM_ROOT.test(host)) failures.push('R4 shared platform root');
  if (row.athletics_entity_id != null) failures.push('R4 an entity is already assigned');

  // R5
  if (!ctx.links[host]) failures.push('R5 no observed link from the owner\'s institution site to the host');
  if (ctx.claimantLinks[host]) failures.push(`R5 a refuted claimant links or publishes the host: ${ctx.claimantLinks[host]}`);
  const staff = ctx.staffByHost.get(host) || [];
  const staffDomains = staff.map((c) => regOf(c.email.split('@')[1]));
  const claimantMail = claimantIds.map((u) => ({ u, d: registryDomain(ctx.registry.get(u)) })).filter((x) => x.d && staffDomains.includes(x.d));
  if (claimantMail.length) failures.push(`R5 verified staff on the host use a refuted claimant's domain (${claimantMail.map((x) => `${x.d}/${x.u}`).join(', ')})`);
  const ownDomain = registryDomain(ctx.registry.get(unitid));

  return {
    host, eligible: failures.length === 0, failures, owner, unitid,
    evidence: {
      page_name: pageName, institution_link: ctx.links[host] || null,
      staff_verified: staff.length, staff_on_owner_domain: staffDomains.filter((d) => d && d === ownDomain).length, owner_federal_domain: ownDomain,
    },
  };
}

/** Assess every WRONG_INSTITUTION row. Deterministic order (by host). */
export function planWrongInstitutionRepair(db, opts) {
  const ctx = loadRepairContext(db, opts);
  const rows = ctx.domains.filter((d) => d.status === 'WRONG_INSTITUTION').sort((a, b) => bare(a.domain).localeCompare(bare(b.domain)));
  return { ctx, assessments: rows.map((r) => ({ row: r, ...assessRow(r, ctx) })) };
}

/**
 * The PROTECTED_SOURCE_CORRECTION fixture for every row that passes R1-R5. `approval` is the
 * record of who approved the scope; the fixture lists exactly the hosts it covers. The fixture
 * hash is the protected path's own (fixtureHash).
 */
export function buildRepairFixture(db, { registry, evidence, approval, phase = '1G-PRE', createdAt }) {
  const { assessments } = planWrongInstitutionRepair(db, { registry, evidence });
  const eligible = assessments.filter((a) => a.eligible);
  const regName = (u) => registry instanceof Map ? registry.get(u)?.INSTNM : (registry || []).find((r) => Number(r.UNITID) === u)?.INSTNM;
  const corrections = eligible.map((a) => {
    const wrong = parse(a.row.wrong_mappings);
    return {
      action_id: `PC-${phase}-${a.host}`, approval_id: approval.approval_id, host: a.host, true_entity: a.owner, unitid: a.unitid,
      transition: { from_status: 'WRONG_INSTITUTION', to_status: 'VERIFIED', from_ownership_class: null, to_ownership_class: 'ENTITY_OWNED' },
      wrong_claimants: wrong, expected_old: { ...a.row },
      evidence: {
        rule: RULE_VERSION,
        institution_to_host: a.evidence.institution_link,
        host_to_institution: `${a.row.evidence_kind} '${a.row.evidence_text}' (${a.row.identity_strength}, ${a.row.confidence}, checked ${a.row.checked_at}) is federal registry name '${a.evidence.page_name}' of UNITID ${a.unitid}, of no refuted claimant; ${a.evidence.staff_verified} verified staff published on the host, ${a.evidence.staff_on_owner_domain} on ${a.evidence.owner_federal_domain}, none on a refuted claimant's domain`,
      },
      original_adjudication: { tool: 'server/scripts/verifyAthleticsDomains.js --apply (commit 735092b)', timestamp: a.row.checked_at, decision: `WRONG_INSTITUTION; wrong_mappings ${a.row.wrong_mappings}`, why_wrong: WHY_WRONG },
      reason: `restore ${regName(a.unitid) || a.unitid}'s own athletics host as authoritative for ${a.owner}; refuted claimant(s) ${wrong.map((w) => `${w.key} (${w.claimantUnitid})`).join(', ')} remain refused via wrong_mappings`,
      blast_radius: `athletics_domains row ${a.host} only (status, athletics_entity_id, ownership_class, notes)`,
    };
  });
  const fx = {
    phase, created_at: createdAt, kind: PROTECTED_CORRECTION_KIND, rule: RULE_VERSION,
    approvals: [{ ...approval, hosts: corrections.map((c) => c.host) }],
    excluded: assessments.filter((a) => !a.eligible).map((a) => ({ host: a.host, failures: a.failures })),
    corrections,
  };
  fx.fixture_hash = fixtureHash(fx);
  return { fixture: fx, assessments };
}
