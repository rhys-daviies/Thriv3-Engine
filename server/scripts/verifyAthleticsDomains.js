#!/usr/bin/env node
/**
 * Builds `athletics_domains` — which institution each host actually belongs to.
 *
 * WHY THIS EXISTS. Phase 12C fetched four seasons of well-formed athletics data
 * from `gocolumbialions.com` and filed it under Columbia College, Missouri. The
 * host belongs to Columbia University, New York. It did the same with
 * `maryvillesaints.com` for Maryville College, Tennessee — the site is Maryville
 * University, Missouri. Nothing about either fetch was broken. The mapping was
 * wrong, and an HTTP 200 cannot tell you that.
 *
 * THE CHEAPEST RELIABLE METHOD, and it was chosen for that. One HTTPS GET per
 * host, with the response stream stopped at `</head>` or 128 KB: 2,714 hosts,
 * 2,571 requests, 76.9 MB. Identity is then read from what the host says it is
 * — its `og:site_name`, its `<title>` — because that is the only thing in the
 * transaction the mapping file did not write.
 *
 * A MAPPING IS THE UNIT, NOT A DOMAIN. `known_domains.json` lists
 * `gomatadors.com` under Cal State Northridge and under Concordia Irvine. One
 * of those two is right. A per-domain verdict cannot say which, so every
 * (name, domain) pair is classified separately and the domain row carries the
 * claims its host contradicts.
 *
 * REFUTING TAKES MORE EVIDENCE THAN CONFIRMING, and the asymmetry is deliberate.
 * Confirming a claim is safe on a weak match because the claimant's own name is
 * what generated the spelling being matched. Refuting one needs an ATHLETICS
 * site's og:site_name or whole title naming a whole written-down institution:
 * a university homepage titled with a system brand ("Purdue University" on
 * pnw.edu) cannot speak for a campus, a fragment of a title cannot either
 * ("University of Missouri" is what splitting "University of Missouri - St.
 * Louis Athletics" produces), and a match through a shared bare base cannot
 * ("Queens College" is Queens College CUNY, absent from our spine entirely).
 *
 * NOTHING HERE REWRITES known_domains.json. A WRONG_INSTITUTION verdict makes a
 * mapping unusable, which is safe whether the verdict is right or wrong.
 * Proving a replacement is separate work and is not done by a script.
 *
 *   node server/scripts/verifyAthleticsDomains.js            # dry run
 *   node server/scripts/verifyAthleticsDomains.js --apply
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import db from '../db/client.js';
import { utcNow } from '../lib/time.js';
import { buildResolvers } from '../lib/institutionQueries.js';
import {
  institutionFromPage, institutionVariants, normaliseInstitution,
  DOMAIN_STATUS, IDENTITY_UNRESOLVED, IDENTITY_METHOD,
} from '../../shared/institutionIdentity.js';
import { COMBINED_PROGRAMME_DOMAINS } from '../../shared/institutionAliasData.js';

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const DIR = arg('dir', path.join(os.homedir(), 'Documents/Thriv3/Competitive Collection'));
export const EVIDENCE_FILE = 'athletics-domain-evidence.json';
export const MAPPING_FILE = 'tools/soccer/verification/known_domains.json';

/** Reading the evidence fails closed: an empty audit looks exactly like a clean one. */
export function readEvidence(dir = DIR) {
  const f = path.join(dir, EVIDENCE_FILE);
  if (!fs.existsSync(f)) throw new Error(`domain evidence not found: ${f}`);
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!Array.isArray(j.domains) || !j.domains.length) throw new Error(`domain evidence is empty: ${f}`);
  return j;
}

const ATHLETICS_WORD = /\b(athletics?|sports|varsity|intercollegiate)\b/i;

/** ATHLETICS_SITE, INSTITUTION_SITE or UNKNOWN, from what the host calls itself. */
export function roleOf({ title, siteName }) {
  const t = `${title ?? ''} ${siteName ?? ''}`.trim();
  if (!t) return 'UNKNOWN';
  return ATHLETICS_WORD.test(t) ? 'ATHLETICS_SITE' : 'INSTITUTION_SITE';
}

/**
 * One (claiming name, domain) pair.
 *
 * @param claim   `{ key, unitid, reason }` — the name in the mapping file, resolved
 * @param host    `{ unitid, method, strength, matchedOn, ... }` — what the host says
 */
export function classifyMapping(claim, host, evidence) {
  if (!evidence.reachable) {
    return { status: DOMAIN_STATUS.UNREACHABLE, notes: evidence.note };
  }
  if (host.unitid == null) {
    return {
      status: host.reason === IDENTITY_UNRESOLVED.AMBIGUOUS ? DOMAIN_STATUS.AMBIGUOUS : DOMAIN_STATUS.INSUFFICIENT_EVIDENCE,
      notes: `host names nothing resolvable (${host.reason ?? 'no candidate'})`,
    };
  }
  if (claim.unitid == null) {
    return { status: DOMAIN_STATUS.INSUFFICIENT_EVIDENCE, notes: `claiming name unresolved (${claim.reason})` };
  }
  const combined = COMBINED_PROGRAMME_DOMAINS[evidence.domain];
  if (combined && combined.unitids.includes(claim.unitid)) {
    return { status: DOMAIN_STATUS.VERIFIED_ALIAS, notes: `${combined.programme} is one athletics programme fielded by several institutions` };
  }
  if (claim.unitid === host.unitid) {
    return { status: host.method === IDENTITY_METHOD.EXACT ? DOMAIN_STATUS.VERIFIED : DOMAIN_STATUS.VERIFIED_ALIAS };
  }
  // A HOST THAT SAYS SOMETHING THE CLAIMANT COULD ALSO BE CALLED SETTLES
  // NOTHING. `columbiacougars.com` is Columbia College, Missouri's own
  // athletics site and its page says "Columbia College" — which our table reads
  // as Columbia University, because that is the only Columbia it names without
  // a qualifier. Refuting on it would report a correct mapping as wrong, which
  // is the same error as 12C's in the opposite direction. The answer is that
  // the host does not distinguish the two, so it is ambiguous and unusable —
  // not that the mapping is wrong.
  const claimantAlsoCalled = new Set(institutionVariants(claim.key));
  if (host.matchedText && claimantAlsoCalled.has(normaliseInstitution(host.matchedText.replace(/\s*(?:athletics?|official.*)$/i, '')))) {
    return { status: DOMAIN_STATUS.AMBIGUOUS, notes: `host names "${host.matchedText}", which is also a name for ${claim.key}` };
  }
  if (host.strength === 'WHOLE_NAME' && evidence.role === 'ATHLETICS_SITE'
    && (host.matchedOn === 'OG_SITE_NAME' || host.matchedOn === 'PAGE_TITLE')) {
    return { status: DOMAIN_STATUS.WRONG_INSTITUTION, notes: `host identifies as ${host.unitid}` };
  }
  return {
    status: DOMAIN_STATUS.INSUFFICIENT_EVIDENCE,
    notes: `host names "${host.matchedText}" (${host.matchedOn}, ${host.strength}, ${evidence.role}) — not strong enough to refute`,
  };
}

export function audit({ evidence, mapping, resolvers, now = utcNow() }) {
  const claims = new Map();
  const keyResolution = {};
  for (const key of Object.keys(mapping)) keyResolution[key] = resolvers.resolve(key);
  for (const [key, domains] of Object.entries(mapping)) {
    for (const raw of domains) {
      const d = String(raw).trim().toLowerCase();
      if (!d || !d.includes('.')) continue;
      if (!claims.has(d)) claims.set(d, []);
      claims.get(d).push(key);
    }
  }

  const byDomain = new Map(evidence.domains.map((e) => [e.domain, e]));
  const mappings = [];
  const rows = [];
  for (const [domain, keys] of claims) {
    const e = byDomain.get(domain) ?? { domain, http: null, error: 'not fetched' };
    // Reachable means the host answered, NOT that it said anything useful. A
    // 200 whose first 128 KB carry no <title> is INSUFFICIENT_EVIDENCE — a
    // statement about the page — and conflating it with UNREACHABLE would be a
    // statement about the network that is not true.
    const reachable = e.http != null && e.http < 400 && (e.bytesRead ?? 0) > 0;
    const ev = {
      domain,
      reachable,
      role: reachable ? roleOf(e) : null,
      note: reachable ? null : (e.error ?? (e.http ? `HTTP ${e.http}` : 'no response')),
    };
    const host = reachable
      ? institutionFromPage({ title: e.title, siteName: e.siteName }, { resolve: resolvers.resolve })
      : { unitid: null, reason: 'UNREACHABLE' };

    const mine = [];
    for (const key of keys) {
      const claim = { key, ...keyResolution[key] };
      const verdict = classifyMapping(claim, host, ev);
      const m = {
        key, domain, claimantUnitid: claim.unitid ?? null, claimantReason: claim.reason ?? null,
        hostUnitid: host.unitid ?? null, evidenceKind: host.matchedOn ?? null,
        evidenceText: host.matchedText ?? null, ...verdict,
      };
      mappings.push(m); mine.push(m);
    }
    const wrong = mine.filter((m) => m.status === DOMAIN_STATUS.WRONG_INSTITUTION);
    const anyVerified = mine.some((m) => m.status === DOMAIN_STATUS.VERIFIED);
    rows.push({
      domain,
      unitid: host.unitid ?? null,
      // The domain row's status is about the HOST's identity, and the claims
      // it contradicts lead: a host that refutes a mapping is the finding.
      status: !reachable ? DOMAIN_STATUS.UNREACHABLE
        : host.unitid == null
          ? (host.reason === IDENTITY_UNRESOLVED.AMBIGUOUS ? DOMAIN_STATUS.AMBIGUOUS : DOMAIN_STATUS.INSUFFICIENT_EVIDENCE)
          : wrong.length ? DOMAIN_STATUS.WRONG_INSTITUTION
            : anyVerified || host.method === IDENTITY_METHOD.EXACT ? DOMAIN_STATUS.VERIFIED
              : DOMAIN_STATUS.VERIFIED_ALIAS,
      role: ev.role,
      claimed_keys: JSON.stringify(keys),
      claimed_unitids: JSON.stringify([...new Set(keys.map((k) => keyResolution[k].unitid).filter((u) => u != null))].sort((a, b) => a - b)),
      wrong_mappings: wrong.length ? JSON.stringify(wrong.map((m) => ({ key: m.key, claimantUnitid: m.claimantUnitid }))) : null,
      evidence_kind: host.matchedOn ?? null,
      evidence_text: host.matchedText ?? null,
      identity_method: host.method ?? null,
      identity_strength: host.strength ?? null,
      platform: e.platform ?? null,
      http_status: e.http ?? null,
      final_url: e.finalUrl ?? null,
      verification_method: reachable ? 'PAGE_SELF_IDENTIFICATION' : 'HEAD_FETCH',
      confidence: host.strength === 'WHOLE_NAME' ? 'CERTAIN' : host.unitid ? 'CORROBORATED' : 'NONE',
      notes: ev.note,
      checked_at: now,
    });
  }
  return { rows, mappings, keyResolution };
}

export function run({ apply = false, dir = DIR, log = console.log } = {}) {
  const evidence = readEvidence(dir);
  const mapping = JSON.parse(fs.readFileSync(path.join(process.cwd(), MAPPING_FILE), 'utf8'));
  const resolvers = buildResolvers();
  const { rows, mappings } = audit({ evidence, mapping, resolvers });

  const byMap = {}; for (const m of mappings) byMap[m.status] = (byMap[m.status] ?? 0) + 1;
  const byDom = {}; for (const r of rows) byDom[r.status] = (byDom[r.status] ?? 0) + 1;
  log(`known_domains names ${Object.keys(mapping).length}   mappings ${mappings.length}   distinct domains ${rows.length}`);
  log('by mapping:'); for (const [k, v] of Object.entries(byMap).sort((a, b) => b[1] - a[1])) log(`  ${k.padEnd(24)}${String(v).padStart(5)}`);
  log('by domain :'); for (const [k, v] of Object.entries(byDom).sort((a, b) => b[1] - a[1])) log(`  ${k.padEnd(24)}${String(v).padStart(5)}`);

  if (!apply) { log('\ndry run — pass --apply to write'); return { rows, mappings, written: 0 }; }
  const cols = Object.keys(rows[0]);
  const ins = db.prepare(`INSERT INTO athletics_domains (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`);
  const write = db.transaction((all) => {
    db.prepare('DELETE FROM athletics_domains').run();
    for (const r of all) ins.run(r);
  });
  write(rows);
  const written = db.prepare('SELECT COUNT(*) n FROM athletics_domains').get().n;
  log(`  written: ${written} rows`);
  return { rows, mappings, written };
}

if (import.meta.url === `file://${process.argv[1]}`) run({ apply: APPLY });
