/**
 * PROGRAMME CONTACT ELIGIBILITY — Phase 1B. The floor for a programme inbox.
 *
 * COACH INTELLIGENCE IS NOT PROGRAMME CONTACT INTELLIGENCE. A coach is a person with a
 * verified employment relationship and is judged by coachIneligibility (coachEligibility.js),
 * which this module neither calls nor changes. A programme contact is a communication
 * endpoint the programme itself publishes, and it is judged here, by its own evidence:
 *
 *   the exact address was published on an OFFICIAL page (tier A, entity-hosted kind),
 *   on a host the programme's own athletics entity owns (identityResolver.hostOwnedBy —
 *   the ownerOfHost primitive), fetched inside the current competitive cycle; the
 *   address's own mail domain is owned by that same entity (by the identity registry or,
 *   Phase 1G-B, narrowly by the institution's own federal website record); the programme row is active,
 *   canonical and of the same sport; and the address is not a named person's.
 *
 * FAILS CLOSED. Every rule returns a reason when its evidence is absent, not only when it
 * is contradicted: a missing timestamp, an unowned host, an unresolvable mail domain or a
 * parent-only domain at a branch campus is ineligibility, never a pass by default.
 *
 * THE ADDRESS'S SPELLING IS NEVER IDENTITY. `sexSignalOfAddress` reads "wsoccer@" or
 * "menssoccer@" only as a CONFLICT DETECTOR: an address that names the other sex than its
 * programme fails, and an address that names neither (soccer@, or anything unusual) is
 * judged entirely on source and domain ownership. Which programme an address belongs to
 * is decided by the page it was published on and who owns that page — not by its letters.
 *
 * Pure: the context is built once (buildProgrammeContactContext) and passed in.
 */
import crypto from 'node:crypto';
import { hostOf } from './athleticsEntity.js';
import { loadRefreshContext } from './refresh/context.js';
import { freshnessOf, FRESHNESS } from './refresh/freshness.js';
import { PROGRAMME_CONTACT_SOURCE_KINDS } from './refresh/sourceAuthority.js';
import { sportEvidence, SPORT_STATUS } from './refresh/adapters/sourceEvidence.js';
import { federalMailDomainProof, loadFederalWebsites, FEDERAL } from './federalInstitutionWebsites.js';

export const PC_INELIGIBLE = Object.freeze({
  NOT_VERIFIED: 'PC_NOT_VERIFIED',
  NO_USABLE_EMAIL: 'PC_NO_USABLE_EMAIL',
  NO_OBSERVATION: 'PC_NO_OBSERVATION',
  OBSERVED_IN_FUTURE: 'PC_OBSERVED_IN_FUTURE',
  NOT_CURRENT: 'PC_NOT_CURRENT',
  SOURCE_NOT_OFFICIAL: 'PC_SOURCE_NOT_OFFICIAL',
  PROGRAMME_ABSENT: 'PC_PROGRAMME_ABSENT',
  PROGRAMME_INACTIVE: 'PC_PROGRAMME_INACTIVE',
  PROGRAMME_ROW_NOT_CANONICAL: 'PC_PROGRAMME_ROW_NOT_CANONICAL',
  ENTITY_MISMATCH: 'PC_ENTITY_MISMATCH',
  SPORT_MISMATCH: 'PC_SPORT_MISMATCH',
  SOURCE_NOT_OWNED: 'PC_SOURCE_NOT_OWNED',
  ADDRESS_DOMAIN_NOT_OWNED: 'PC_ADDRESS_DOMAIN_NOT_OWNED',
  ADDRESS_DOMAIN_PARENT_ONLY: 'PC_ADDRESS_DOMAIN_PARENT_ONLY',
  ADDRESS_DOMAIN_OTHER_ENTITY: 'PC_ADDRESS_DOMAIN_OTHER_ENTITY',
  NAMED_PERSON_ADDRESS: 'PC_NAMED_PERSON_ADDRESS',
  ADDRESS_AT_OTHER_PROGRAMME: 'PC_ADDRESS_AT_OTHER_PROGRAMME',
  SEX_CONFLICT: 'PC_SEX_CONFLICT',
  DEPARTMENT_INBOX: 'PC_DEPARTMENT_INBOX',
  // Phase 1G-B
  PERSONAL_MAIL_DOMAIN: 'PC_PERSONAL_MAIL_DOMAIN',
  CAMP_OR_ACADEMY: 'PC_CAMP_OR_ACADEMY',
  NOT_PROGRAMME_SPECIFIC: 'PC_NOT_PROGRAMME_SPECIFIC',
});

const EMAIL = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const lc = (s) => String(s ?? '').trim().toLowerCase();
export const addressDomain = (email) => { const e = lc(email); const i = e.lastIndexOf('@'); return i > 0 ? e.slice(i + 1) : null; };
/** One clock skew allowance for "fetched in the future" — a fetch stamp is a fact, not a forecast. */
const FUTURE_SKEW_MS = 24 * 60 * 60 * 1000;

/**
 * Which sex an address's LOCAL PART names, or null. A conflict detector only (see header).
 * "women" contains "men", so the women's signal is read and removed first; an address that
 * names both, or neither, returns null and decides nothing.
 */
export function sexSignalOfAddress(email) {
  const local = lc(email).split('@')[0] || '';
  const W = /wom|ladies|lady|wsoc|(^|[._-])w[._-]?soc/;
  const M = /mens|msoc|(^|[._-])m[._-]?soc|(^|[._-])men([._-]|soc)/;
  const women = W.test(local);
  const men = M.test(local.replace(new RegExp(W.source, 'g'), ' '));
  if (women && !men) return 'womens-soccer';
  if (men && !women) return 'mens-soccer';
  return null;
}

/**
 * An athletics-department or institution inbox (athletics@, sports@, info@, sid@ ...) that
 * names no sport is not a PROGRAMME's endpoint, wherever it is published: it reaches a
 * department, and a programme contact is the programme's own address.
 */
export function isDepartmentInbox(email) {
  const local = lc(email).split('@')[0] || '';
  if (/soc|futbol|football/.test(local)) return false;
  return /^(athletics?|sports?|sportsinfo|info|information|admin|office|sid|compliance|tickets?|marketing|media|communications|webmaster|help|contact|general|inquiries|enquiries|recruit|recruiting|coach|coaches)([._-]|\d|$)/.test(local);
}

/**
 * Phase 1G-B exclusions, each a property of the ADDRESS (where it was published is the classifier's
 * question). A free-mail domain is a person's or a volunteer's, never the programme's own; a camp,
 * academy or clinic address reaches a business line, not the programme's recruiting staff; and an
 * address whose local part does not name the sport is not provably THIS programme's.
 */
const PERSONAL_MAIL = /^(gmail|googlemail|yahoo|ymail|rocketmail|hotmail|outlook|live|msn|aol|icloud|me|mac|protonmail|proton|comcast|att|sbcglobal|verizon|charter|cox|gmx|mail|zoho|yandex|fastmail)\.[a-z.]+$/;
export const isPersonalMailDomain = (email) => PERSONAL_MAIL.test(addressDomain(email) || '');
export const isCampOrAcademy = (email) => /camp|academy|academies|clinic|showcase/.test(lc(email).split('@')[0] || '');
export const isProgrammeSpecific = (email) => /soc|futbol|f\u00fatbol/.test(lc(email).split('@')[0] || '');

/** Deterministic id of a programme contact: the logical programme plus the exact address. */
export function programmeContactId(entityId, sport, email) {
  return `PC-${crypto.createHash('sha256').update(`${entityId}|${sport}|${lc(email)}`).digest('hex').slice(0, 24)}`;
}

/**
 * The same context, built from a refresh context (loadRefreshContext + the held coaches and
 * programme contacts staging loads), so the classifier and the promotion gate judge a
 * record with exactly the rules the read path and the validator use.
 */
export function contextFromRefresh(ctx) {
  const namedAddresses = new Set((ctx.coaches || []).filter((c) => c.email && String(c.full_name ?? '').trim() !== '').map((c) => lc(c.email)));
  const verifiedByEmail = new Map();
  for (const c of (ctx.programmeContacts || []).filter((x) => x.status === 'VERIFIED')) (verifiedByEmail.get(c.email) || verifiedByEmail.set(c.email, []).get(c.email)).push(c);
  // Phase 1G-B: the federal website record, for the narrow mail-domain proof (federalInstitutionWebsites.js)
  const federal = { index: ctx.federalIndex !== undefined ? ctx.federalIndex : loadFederalWebsites(), entities: ctx.entities || [], domains: ctx.domains || [], resolver: ctx.resolver };
  return { resolver: ctx.resolver, collegeById: new Map(ctx.colleges.map((c) => [c.id, c])), linked: new Set(ctx.rowLinks.map((l) => l.college_id)), namedAddresses, verifiedByEmail, federal };
}

/**
 * Everything the floor reasons over, loaded once from a database handle (read-only use).
 *   resolver      identityResolver (ownerOfHost / hostOwnedBy)
 *   collegeById   colleges rows
 *   linked        colleges ids that are NOT canonical (programme_row_links.college_id)
 *   namedAddresses  lower-case addresses held by a NAMED coach row, any status, any school
 *   verifiedByEmail lower-case address -> VERIFIED programme_contacts rows
 */
export function buildProgrammeContactContext(db, { federalIndex } = {}) {
  const has = (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  const coaches = has('coaches') ? db.prepare('SELECT full_name, email FROM coaches WHERE email IS NOT NULL').all() : [];
  const programmeContacts = has('programme_contacts') ? db.prepare('SELECT * FROM programme_contacts').all() : [];
  return contextFromRefresh({ ...loadRefreshContext(db), coaches, programmeContacts, ...(federalIndex !== undefined ? { federalIndex } : {}) });
}

/**
 * Who owns an address's mail domain, judged for one entity:
 *   'OWNED' | ADDRESS_DOMAIN_PARENT_ONLY | ADDRESS_DOMAIN_OTHER_ENTITY | ADDRESS_DOMAIN_NOT_OWNED
 * A parent-only domain (a branch campus on its parent's institutional domain) cannot prove a
 * campus (the Phase 7D rule for IU Columbus, Benedictine Mesa and Park Gilbert).
 */
export function addressDomainVerdict(email, entityId, resolver, federal = null) {
  const domain = addressDomain(email);
  if (!domain) return PC_INELIGIBLE.ADDRESS_DOMAIN_NOT_OWNED;
  const owner = resolver.ownerOfHost(domain);
  if (owner.entity === entityId) return 'OWNED';
  if (owner.entity) return PC_INELIGIBLE.ADDRESS_DOMAIN_OTHER_ENTITY;
  if (owner.parentOnly?.length) return PC_INELIGIBLE.ADDRESS_DOMAIN_PARENT_ONLY;
  // Phase 1G-B: the institution's own federal website domain (narrow; see federalInstitutionWebsites.js)
  if (federal && !isPersonalMailDomain(email) && federalMailDomainProof(domain, entityId, { ...federal, resolver }).ok) return FEDERAL.OWNED;
  return PC_INELIGIBLE.ADDRESS_DOMAIN_NOT_OWNED;
}
/** Both proofs of a mail domain: the identity registry ('OWNED') or the federal website ('OWNED_FEDERAL'). */
export const isDomainProven = (verdict) => verdict === 'OWNED' || verdict === FEDERAL.OWNED;

/**
 * Every reason a programme contact row fails the floor (empty = eligible). Pure.
 * `row` is a programme_contacts row (or a proposed one). Rules are evaluated in full so a
 * report can show everything wrong with a record, not only the first thing.
 */
export function programmeContactProblems(row, ctx, { now = new Date() } = {}) {
  const out = [];
  if (!row) return [PC_INELIGIBLE.NOT_VERIFIED];
  const email = lc(row.email);
  if (row.status !== 'VERIFIED') out.push(PC_INELIGIBLE.NOT_VERIFIED);
  if (!email || !EMAIL.test(email) || email !== row.email) out.push(PC_INELIGIBLE.NO_USABLE_EMAIL);
  if (!row.observed_on_url || !row.observed_at || !row.currentness_checked_at || !hostOf(row.observed_on_url)) out.push(PC_INELIGIBLE.NO_OBSERVATION);
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  const seen = Date.parse(row.observed_at || '');
  if (Number.isFinite(seen) && seen > nowMs + FUTURE_SKEW_MS) out.push(PC_INELIGIBLE.OBSERVED_IN_FUTURE);
  if (freshnessOf('programme_contact', row, { now }).state !== FRESHNESS.CURRENT && row.status === 'VERIFIED') out.push(PC_INELIGIBLE.NOT_CURRENT);
  if (row.source_tier !== 'A' || !PROGRAMME_CONTACT_SOURCE_KINDS.includes(row.source_kind) || !/^https:\/\//i.test(row.observed_on_url || '') || /web\.archive\.org/i.test(row.observed_on_url || '')) out.push(PC_INELIGIBLE.SOURCE_NOT_OFFICIAL);

  const college = ctx.collegeById.get(row.college_id);
  if (!college) { out.push(PC_INELIGIBLE.PROGRAMME_ABSENT); return [...new Set(out)]; }
  if (college.active !== 1) out.push(PC_INELIGIBLE.PROGRAMME_INACTIVE);
  if (ctx.linked.has(college.id)) out.push(PC_INELIGIBLE.PROGRAMME_ROW_NOT_CANONICAL);
  if (!row.athletics_entity_id || college.athletics_entity_id !== row.athletics_entity_id) out.push(PC_INELIGIBLE.ENTITY_MISMATCH);
  const pageSport = row.observed_on_url ? sportEvidence({ url: row.observed_on_url, sport: row.sport }).status : null;
  if (college.sport !== row.sport || pageSport === SPORT_STATUS.CONTRADICTED) out.push(PC_INELIGIBLE.SPORT_MISMATCH);

  const entity = college.athletics_entity_id;
  const pageHost = hostOf(row.observed_on_url);
  if (!entity || !pageHost || !ctx.resolver.hostOwnedBy(pageHost, entity)) out.push(PC_INELIGIBLE.SOURCE_NOT_OWNED);
  const dom = entity ? addressDomainVerdict(email, entity, ctx.resolver, ctx.federal) : PC_INELIGIBLE.ADDRESS_DOMAIN_NOT_OWNED;
  if (!isDomainProven(dom)) out.push(dom);
  if (isPersonalMailDomain(email)) out.push(PC_INELIGIBLE.PERSONAL_MAIL_DOMAIN);
  if (isCampOrAcademy(email)) out.push(PC_INELIGIBLE.CAMP_OR_ACADEMY);
  if (email && !isProgrammeSpecific(email)) out.push(PC_INELIGIBLE.NOT_PROGRAMME_SPECIFIC);

  if (ctx.namedAddresses.has(email)) out.push(PC_INELIGIBLE.NAMED_PERSON_ADDRESS);
  const elsewhere = (ctx.verifiedByEmail.get(email) || []).filter((c) => c.athletics_entity_id !== row.athletics_entity_id);
  if (elsewhere.length) out.push(PC_INELIGIBLE.ADDRESS_AT_OTHER_PROGRAMME);
  if (isDepartmentInbox(email)) out.push(PC_INELIGIBLE.DEPARTMENT_INBOX);
  const sex = sexSignalOfAddress(email);
  if (sex && sex !== row.sport) out.push(PC_INELIGIBLE.SEX_CONFLICT);
  return [...new Set(out)];
}

/** The first reason a programme contact fails the floor, or null. */
export function programmeContactIneligibility(row, ctx, opts) {
  return programmeContactProblems(row, ctx, opts)[0] ?? null;
}
export const isProgrammeContactEligible = (row, ctx, opts) => programmeContactProblems(row, ctx, opts).length === 0;
