/**
 * FEDERAL WEBSITE MAIL-DOMAIN PROOF — Phase 1G-B (B4). Narrow, programme-contact only.
 *
 * The registry (athletics_domains, ownerOfHost) proves who owns a HOST from the host's own pages.
 * Many institutional MAIL domains were never proven that way (berkeley.edu INSUFFICIENT_EVIDENCE,
 * athletics.ucla.edu UNREACHABLE) although the federal registry names them as the institution's own
 * website. This module lets a programme contact's MAIL DOMAIN be proven by that federal record —
 * and nothing else: it changes no ownership answer, no host trust, no coach rule.
 *
 * A mail domain D is proven for athletics entity E only if EVERY condition holds (fail closed):
 *   F1 E is a SINGLE entity with its own federal UNITID, and no campus entity hangs off that UNITID
 *      (a parent's domain never proves a campus, and a campus-bearing UNITID cannot pick one)
 *   F2 the federal seed has a website for that UNITID
 *   F3 D is that website's registrable domain or a subdomain of it
 *   F4 that registrable domain is the website of exactly ONE UNITID in the whole federal seed
 *      (a system domain shared by several institutions proves none of them)
 *   F5 the identity registry records nothing contrary about D or its registrable domain: not owned
 *      by another entity, not parent-only, not HELD / WRONG_INSTITUTION / AMBIGUOUS /
 *      CONFLICTING_TWINS / a shared platform, and no row naming a different UNITID
 *      (absence of a record, INSUFFICIENT_EVIDENCE and UNREACHABLE make no contrary claim)
 *
 * The seed is server/data/seeds/federal_institution_websites.json (built by
 * scripts/buildFederalWebsiteSeed.js from the unmodified College Scorecard release; its source
 * sha256 and retrieval date are recorded in the file).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registrableDomain } from './institutionResolver.js';

export const FEDERAL_SEED_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/seeds/federal_institution_websites.json');
export const FEDERAL = Object.freeze({
  OWNED: 'OWNED_FEDERAL',
  NOT_SINGLE: 'FEDERAL_ENTITY_NOT_SINGLE',
  CAMPUS: 'FEDERAL_UNITID_HAS_CAMPUS',
  NO_WEBSITE: 'FEDERAL_NO_WEBSITE',
  NOT_WEBSITE_DOMAIN: 'FEDERAL_NOT_WEBSITE_DOMAIN',
  SHARED_DOMAIN: 'FEDERAL_WEBSITE_DOMAIN_SHARED',
  CONTRADICTED: 'FEDERAL_REGISTRY_CONTRADICTS',
  NO_SEED: 'FEDERAL_SEED_UNAVAILABLE',
});
const CONTRARY_STATUS = new Set(['HELD', 'WRONG_INSTITUTION', 'AMBIGUOUS', 'CONFLICTING_TWINS', 'SHARED_PLATFORM']);
const lc = (s) => String(s ?? '').trim().toLowerCase().replace(/^www\./, '');
const regOf = (host) => (host ? registrableDomain(`https://${lc(host)}/`) : null);
export const websiteHost = (w) => (w ? lc(String(w).replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '')) : null);

/** Index a seed (the parsed JSON, or its rows). */
export function indexFederalWebsites(seed) {
  const rows = Array.isArray(seed) ? seed : seed?.rows || [];
  const byUnitid = new Map(); const unitidsByDomain = new Map();
  for (const r of rows) {
    byUnitid.set(Number(r.unitid), r);
    const d = regOf(websiteHost(r.website));
    if (d) (unitidsByDomain.get(d) || unitidsByDomain.set(d, new Set()).get(d)).add(Number(r.unitid));
  }
  return { byUnitid, unitidsByDomain, seed_sha256: seed?.seed_sha256 ?? null, source_sha256: seed?.source_sha256 ?? null };
}

let memo = null;
/** The committed seed, read once. Null (and every proof fails closed) when the file is absent. */
export function loadFederalWebsites(file = FEDERAL_SEED_PATH) {
  if (memo && memo.file === file) return memo.index;
  let index = null;
  try { index = indexFederalWebsites(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { index = null; }
  memo = { file, index };
  return index;
}

/**
 * Prove a mail domain for an entity from the federal website record.
 *   fed: { index, entities, domains, resolver }
 * -> { ok, code, unitid?, website? }
 */
export function federalMailDomainProof(domain, entityId, fed) {
  const D = lc(domain);
  if (!fed?.index) return { ok: false, code: FEDERAL.NO_SEED };
  const ent = (fed.entities || []).find((e) => e.athletics_entity_id === entityId);
  if (!ent || ent.entity_kind !== 'SINGLE' || ent.federal_unitid == null) return { ok: false, code: FEDERAL.NOT_SINGLE };
  const unitid = Number(ent.federal_unitid);
  if ((fed.entities || []).some((e) => e.parent_unitid != null && Number(e.parent_unitid) === unitid)) return { ok: false, code: FEDERAL.CAMPUS };
  const row = fed.index.byUnitid.get(unitid);
  const site = regOf(websiteHost(row?.website));
  if (!site) return { ok: false, code: FEDERAL.NO_WEBSITE };
  if (regOf(D) !== site) return { ok: false, code: FEDERAL.NOT_WEBSITE_DOMAIN };
  if ((fed.index.unitidsByDomain.get(site)?.size ?? 0) !== 1) return { ok: false, code: FEDERAL.SHARED_DOMAIN };
  for (const h of [...new Set([D, site])]) {
    const o = fed.resolver.ownerOfHost(h);
    if ((o.entity && o.entity !== entityId) || o.parentOnly?.length || CONTRARY_STATUS.has(o.status)) return { ok: false, code: FEDERAL.CONTRADICTED };
    const named = (fed.domains || []).filter((d) => lc(d.domain) === h && d.unitid != null && Number(d.unitid) !== unitid);
    if (named.length) return { ok: false, code: FEDERAL.CONTRADICTED };
  }
  return { ok: true, code: FEDERAL.OWNED, unitid, website: row.website };
}
