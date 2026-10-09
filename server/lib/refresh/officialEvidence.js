/**
 * OFFICIAL EVIDENCE — Phase DI-03D. Evidence for an ownership correction is never a fixture's own
 * declaration. It is BYTES, read from a content-addressed evidence store (a directory of files named
 * by their sha256), re-hashed on every read, and parsed here:
 *
 *   OFFICIAL SOURCES (institution -> host) are accepted only if their sha256 is pinned in the reviewed
 *   registry shared/officialSourceRegistry.json (adding one is a reviewed code change). The engine parses
 *   them itself: an IPEDS institutional-characteristics file (UNITID, INSTNM, IALIAS, CITY, STABBR,
 *   WEBADDR, ATHURL) and the NCAA directory member list (orgId, nameOfficial, state, webSiteUrl,
 *   athleticWebUrl, academicYear). Which hosts an institution lists, and which other institutions list
 *   the same host, are derived from the bytes — never from fixture metadata.
 *
 *   SITE PAGES (host -> institution) are fetched bodies in the same store. The engine reads their
 *   title / og:site_name / text and decides whether the page names the owner MORE specifically than
 *   any rival institution, and (where asked) whether it carries the owner's location.
 *
 * Registry entries with scope TEST_ONLY (synthetic sources the regression tests use) are refused for
 * any runtime database. Every source and page has a maximum age.
 *
 * CONTRADICTIONS (DI-03F) are searched in EVERY registered source of the cited scope
 * (registeredSources), never only in the sources a fixture chose to cite.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normHost } from './identityResolver.js';

import { readSourceRegistry, REGISTRY_PATH } from './sourceRegistry.js';

export { REGISTRY_PATH };
export const MAX_EVIDENCE_DAYS = 30;
const HEX64 = /^[0-9a-f]{64}$/;
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

/** The pinned registry. Unreadable -> empty (no source is official: fail closed). */
export function loadRegistry() {
  try {
    const j = readSourceRegistry();
    if (j?.kind !== 'OFFICIAL_SOURCE_REGISTRY' || !Array.isArray(j.sources)) return [];
    return j.sources.filter((s) => s?.source_id && HEX64.test(s.sha256 || '') && ['IPEDS_HD', 'NCAA_DIRECTORY_MEMBERLIST'].includes(s.kind) && ['PRODUCTION', 'TEST_ONLY'].includes(s.scope));
  } catch { return []; }
}

/** A content-addressed evidence store. read(sha) returns the bytes only if they hash to sha. */
export function evidenceStore(dir) {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`evidence store ${dir ?? '(none)'} is not a directory`);
  const cache = new Map();
  return {
    dir,
    read(h) {
      if (!HEX64.test(String(h || ''))) throw new Error(`evidence reference ${h} is not a sha256`);
      if (cache.has(h)) return cache.get(h);
      const f = path.join(dir, h);
      if (!fs.existsSync(f)) throw new Error(`evidence ${h.slice(0, 12)} is not in the store`);
      const b = fs.readFileSync(f);
      if (sha(b) !== h) throw new Error(`evidence ${h.slice(0, 12)}: stored bytes do not hash to their name`);
      cache.set(h, b); return b;
    },
  };
}

/** Host of a URL as the sources write it ("www.x.edu/", "https://x.edu/a", "x.edu; y.edu" -> each). */
export function hostsOfUrlField(v) {
  return String(v ?? '').split(/[;,\s]+/).map((u) => u.trim()).filter(Boolean).map((u) => {
    try { return normHost(new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname); } catch { return null; }
  }).filter((h) => h && h.includes('.'));
}

function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(f); f = ''; }
    else if (ch === '\n') { row.push(f.replace(/\r$/, '')); rows.push(row); row = []; f = ''; } else f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const parsed = new Map();
function parseIpeds(bytes) {
  const rows = parseCsv(bytes.toString('utf8').replace(/^﻿/, ''));
  const H = rows[0].map((h) => h.trim().toUpperCase()); const ix = (k) => H.indexOf(k);
  for (const k of ['UNITID', 'INSTNM', 'CITY', 'STABBR', 'WEBADDR']) if (ix(k) < 0) throw new Error(`IPEDS file lacks column ${k}`);
  const byUnitid = new Map(); const byHost = new Map();
  for (const r of rows.slice(1)) {
    if (r.length < H.length - 1) continue;
    const u = Number(r[ix('UNITID')]); if (!Number.isInteger(u)) continue;
    const rec = { unitid: u, name: r[ix('INSTNM')], aliases: ix('IALIAS') >= 0 ? String(r[ix('IALIAS')]).split('|').map((x) => x.trim()).filter((x) => x.length > 2) : [],
      city: r[ix('CITY')], state: r[ix('STABBR')], hosts: [...new Set([...hostsOfUrlField(r[ix('WEBADDR')]), ...(ix('ATHURL') >= 0 ? hostsOfUrlField(r[ix('ATHURL')]) : [])])] };
    byUnitid.set(u, rec);
    for (const h of rec.hosts) (byHost.get(h) || byHost.set(h, new Set()).get(h)).add(u);
  }
  return { byUnitid, byHost };
}
function parseNcaa(bytes) {
  const list = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(list)) throw new Error('NCAA directory file is not a member list');
  const byOrg = new Map(); const byHost = new Map();
  for (const o of list) {
    if (o?.orgId == null) continue;
    const rec = { org_id: o.orgId, name: String(o.nameOfficial || '').trim(), state: o.memberOrgAddress?.state ?? null, academic_year: o.academicYear,
      web_hosts: hostsOfUrlField(o.webSiteUrl), athletic_hosts: hostsOfUrlField(o.athleticWebUrl) };
    byOrg.set(o.orgId, rec);
    for (const h of [...rec.web_hosts, ...rec.athletic_hosts]) (byHost.get(h) || byHost.set(h, new Set()).get(h)).add(o.orgId);
  }
  return { byOrg, byHost };
}

const daysOld = (iso, now) => { const d = new Date(String(iso ?? '')); return Number.isNaN(d.getTime()) ? null : (now.getTime() - d.getTime()) / 86_400_000; };

/**
 * An official source by registry id, verified and parsed. Any `target` class but DISPOSABLE refuses TEST_ONLY sources.
 * -> { entry, kind, data } or throws.
 */
export function officialSource(sourceId, store, { target, now = new Date() } = {}) {
  const entry = loadRegistry().find((s) => s.source_id === sourceId);
  if (!entry) throw new Error(`${sourceId} is not a registered official source (shared/officialSourceRegistry.json)`);
  if (entry.scope === 'TEST_ONLY' && target !== 'DISPOSABLE') throw new Error(`${sourceId} is a TEST_ONLY source and may not support a runtime correction`);
  const age = daysOld(entry.retrieved_at, now);
  if (age == null || age < -1 || age > MAX_EVIDENCE_DAYS) throw new Error(`${sourceId} was retrieved ${entry.retrieved_at}: older than ${MAX_EVIDENCE_DAYS} days (or undated)`);
  const bytes = store.read(entry.sha256);
  const key = entry.sha256;
  if (!parsed.has(key)) parsed.set(key, entry.kind === 'IPEDS_HD' ? parseIpeds(bytes) : parseNcaa(bytes));
  return { entry, kind: entry.kind, data: parsed.get(key) };
}

/**
 * EVERY registered source of one scope (PRODUCTION or TEST_ONLY), verified and parsed — the set a
 * contradiction check must read, whatever the fixture chose to cite (DI-03E MAJOR-4). A registered
 * source whose bytes are not in the store, or that is stale, is a problem: a contradiction it might
 * hold cannot be ruled out. -> { sources: [{ entry, kind, data }], problems }
 */
export function registeredSources(scope, store, { target, now = new Date() } = {}) {
  const sources = []; const problems = [];
  for (const e of loadRegistry().filter((x) => x.scope === scope)) {
    try { sources.push(officialSource(e.source_id, store, { target, now })); } catch (err) { problems.push(`registered source ${e.source_id} cannot be read (${err.message}) — contradictions it may hold cannot be ruled out`); }
  }
  return { sources, problems };
}

// ---------- page self-identification

const ENT = { amp: '&', '#39': "'", '#039': "'", apos: "'", quot: '"', rsquo: "'", lsquo: "'", nbsp: ' ', ndash: '-', mdash: '-', '#x27': "'" };
const decode = (s) => String(s ?? '').replace(/&(#?x?[0-9a-z]+);/gi, (m, k) => ENT[k.toLowerCase()] ?? (k.startsWith('#x') ? String.fromCharCode(parseInt(k.slice(2), 16)) : k.startsWith('#') ? String.fromCharCode(Number(k.slice(1))) : m));
/** Normalised words: lower case, & -> and, st/st. -> saint, apostrophes dropped, other punctuation -> space. */
export const words = (s) => decode(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/['’`]/g, '')
  .replace(/\bst\b\.?/g, 'saint').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
const GENERIC = new Set(['university', 'college', 'of', 'the', 'at', 'in', 'and', 'campus', 'main', 'athletics', 'official']);
/** A name and its distinctive form (generic words removed), as word arrays, distinct. */
export function nameForms(name) {
  const w = words(String(name ?? '').replace(/\(.*?\)/g, ' ')); const d = w.filter((x) => !GENERIC.has(x));
  return [w, d].filter((x) => x.length).map((x) => x.join(' ')).filter((v, i, a) => a.indexOf(v) === i);
}
/** Longest (in words) of `names`' forms that appears as a whole phrase in `text`. */
export function nameScore(text, names) {
  const t = ` ${words(text).join(' ')} `;
  let best = 0;
  for (const n of names) for (const f of nameForms(n)) if (t.includes(` ${f} `)) best = Math.max(best, f.split(' ').length);
  return best;
}
/** Title, og:site_name and visible text of an HTML page. */
export function pageText(bytes) {
  const h = bytes.toString('utf8');
  const title = decode((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
  const og = decode((h.match(/property=["']og:site_name["'][^>]*content=["']([^"']*)/i) || h.match(/content=["']([^"']*)["'][^>]*property=["']og:site_name["']/i) || [])[1] || '').trim();
  const text = decode(h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  return { title, og, text };
}
export const STATE_NAMES = Object.freeze({ AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california', CO: 'colorado', CT: 'connecticut', DE: 'delaware', DC: 'district of columbia', FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho', IL: 'illinois', IN: 'indiana', IA: 'iowa', KS: 'kansas', KY: 'kentucky', LA: 'louisiana', ME: 'maine', MD: 'maryland', MA: 'massachusetts', MI: 'michigan', MN: 'minnesota', MS: 'mississippi', MO: 'missouri', MT: 'montana', NE: 'nebraska', NV: 'nevada', NH: 'new hampshire', NJ: 'new jersey', NM: 'new mexico', NY: 'new york', NC: 'north carolina', ND: 'north dakota', OH: 'ohio', OK: 'oklahoma', OR: 'oregon', PA: 'pennsylvania', RI: 'rhode island', SC: 'south carolina', SD: 'south dakota', TN: 'tennessee', TX: 'texas', UT: 'utah', VT: 'vermont', VA: 'virginia', WA: 'washington', WV: 'west virginia', WI: 'wisconsin', WY: 'wyoming' });
/** Does the text carry the institution's city AND its state (full name, or "City, ST")? */
export function locatedAt(text, { city, state }) {
  const t = ` ${words(text).join(' ')} `; const c = words(city).join(' ');
  if (!c || !t.includes(` ${c} `)) return false;
  const full = STATE_NAMES[String(state).toUpperCase()];
  return (!!full && t.includes(` ${full} `)) || new RegExp(`${String(city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')},?\\s+${state}\\b`, 'i').test(decode(text));
}
