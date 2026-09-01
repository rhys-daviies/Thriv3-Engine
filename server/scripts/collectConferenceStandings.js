#!/usr/bin/env node
/**
 * Collects every conference's own standings table, and writes the artefact
 * `importConferenceSeasons.js` reads.
 *
 * WHAT IT DOES AND DELIBERATELY DOES NOT DO. It fetches and it extracts rows.
 * It resolves no identity, derives no division and decides nothing: the artefact
 * records what each conference PUBLISHED, and every judgement happens in the
 * importer, which is tested and can be re-run without refetching. That split is
 * what makes adding one alias a two-second re-import rather than a re-crawl.
 *
 * THREE ROUTES, BECAUSE CONFERENCE SITES SIT ON THREE PLATFORMS.
 *
 *   SIDEARM_STANDINGS  /standings.aspx?path=msoc, then ?standings=<id>. The
 *                      `?year=` parameter is accepted and SILENTLY IGNORED —
 *                      it returns the current table — so the season selector's
 *                      own option list has to be read off the live page first.
 *   PRESTO_STANDINGS   /sports/msoc/2022-23/standings. The better source of the
 *                      three: its <title> is "2022 MASCAC Men's Soccer
 *                      Standings", which confirms season, sport and conference
 *                      in one string. 12C rejected PrestoSports on the
 *                      PROGRAMME side, where it parsed 0 of 13 schedules; that
 *                      verdict is about schedules and does not transfer here.
 *   NEXT_STANDINGS     /msoc/standings/2022/, with the table inside the page's
 *                      __NEXT_DATA__ payload. The Big Ten and the Southern
 *                      Conference render client-side and 404 on the other two.
 *
 * A ROUTE IS TRIED ONLY WHERE THE EARLIER ONES DID NOT CONFIRM A SEASON, and a
 * confirmed table is never overwritten: two platforms disagreeing is a fact to
 * keep, not a preference to exercise.
 *
 * NOTHING IS COLLAPSED INTO AN ABSENCE. A timeout is TRANSPORT_FAILED. A 202
 * with a 2 KB body is CHALLENGED — a JavaScript bot check, not a page and not a
 * missing conference; a single request to the same URL minutes earlier returned
 * the table, and reading it as "no such conference" would have deleted the
 * MASCAC, the SUNYAC and the GPAC from the record.
 *
 *   node server/scripts/collectConferenceStandings.js               # dry run
 *   node server/scripts/collectConferenceStandings.js --write
 *   node server/scripts/collectConferenceStandings.js --only psac
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { conferenceById } from '../../shared/conferenceIdentity.js';
import { COLLECTION_STATUS } from '../../shared/conferenceHistory.js';

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const OUT = arg('out', path.join(os.homedir(), 'Documents/Thriv3/Competitive Collection'));
const CACHE = arg('cache', path.join(OUT, 'cache'));
const ONLY = arg('only', null);
const CONCURRENCY = Number(arg('concurrency', '4'));

export const SEASONS = ['2022', '2023', '2024', '2025'];
export const ARTEFACT = 'conference-standings.json';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const SLUG = { 'mens-soccer': 'msoc', 'womens-soccer': 'wsoc' };
const SPORT_WORDS = { 'mens-soccer': /men.?s\s+soccer/i, 'womens-soccer': /women.?s\s+soccer/i };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const stats = { requests: 0, cached: 0, retries: 0, challenged: 0, failures: 0, bytes: 0, latency: [] };

/** A 2xx with almost no body and no <title> is a bot check, not a page. */
const isChallenge = (http, body) => http === 202 || (body.length < 5000 && !/<title/i.test(body));

async function get(url, { cache = CACHE } = {}) {
  fs.mkdirSync(cache, { recursive: true });
  const f = path.join(cache, `${crypto.createHash('sha1').update(url).digest('hex').slice(0, 20)}.json`);
  if (fs.existsSync(f)) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (j.status !== COLLECTION_STATUS.CHALLENGED) { stats.cached += 1; return j; }
  }
  let out = null;
  for (let i = 1; i <= 3 && !out; i += 1) {
    if (i > 1) stats.retries += 1;
    const t0 = Date.now();
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(40_000) });
      const ok = r.status >= 200 && r.status < 300;
      const body = ok ? await r.text() : '';
      stats.requests += 1; stats.bytes += body.length; stats.latency.push(Date.now() - t0);
      if (ok && isChallenge(r.status, body)) {
        if (i < 3) { await sleep(10_000 * i); continue; }
        stats.challenged += 1;
        out = { url, status: COLLECTION_STATUS.CHALLENGED, http: r.status, body: '' };
      } else if (ok) out = { url, status: 'OK', http: r.status, finalUrl: r.url, body };
      else out = { url, status: COLLECTION_STATUS.SOURCE_NOT_FOUND, http: r.status, body: '' };
    } catch (e) {
      if (i === 3) { stats.failures += 1; out = { url, status: COLLECTION_STATUS.TRANSPORT_FAILED, http: null, error: String(e.name ?? e).slice(0, 60), body: '' }; }
      else await sleep(2000 * i);
    }
  }
  fs.writeFileSync(f, JSON.stringify(out));
  return out;
}

export const strip = (s) => String(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&#0?39;|&rsquo;|&#8217;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
export const titleOf = (h) => { const m = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(h); return m ? strip(m[1]) : null; };
const CONF_REC = /^(\d+)-(\d+)(?:-(\d+))?$/;

/**
 * One standings table, from either HTML platform.
 *
 * WHICH RECORD COLUMN IS THE CONFERENCE ONE depends on the site, and the header
 * is read to find out. Taking "the first record in the row" put the OVERALL
 * record into the conference column for 23 conference-seasons — a wrong number
 * rather than a missing one. The importer settles the remainder by eliminating
 * the programme's own overall record.
 *
 * A single-cell row inside the table is a pod heading ("East", "West"). It is
 * captured, because it is the reason row order is not a finish.
 */
export function parseStandingsTable(html) {
  const trs = html.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
  const header = trs
    .map((tr) => (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/g) ?? []).map(strip).filter(Boolean).join(' '))
    .find((t) => /overall/i.test(t) && /conf/i.test(t)) ?? '';
  const overallFirst = !!header && header.search(/overall/i) < header.search(/conf/i);
  // Matches played is only read where the table declares a GP column. Sidearm's
  // tables do not, and the integer before the record there is points — which
  // failed the record's own arithmetic and refused 795 perfectly good records.
  const hasGamesPlayed = /\bGP\b/i.test(header);
  const rows = [];
  let group = null;
  for (const tr of trs) {
    const cells = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/g) ?? []).map(strip);
    const ne = cells.filter(Boolean);
    if (ne.length === 1 && ne[0].length < 40 && !CONF_REC.test(ne[0])) { group = ne[0]; continue; }
    if (ne.length < 4 || /^(school|team)$/i.test(ne[0])) continue;
    const raw = ne[0];
    const school = raw.replace(/\s*[&^*#!$]+\s*\d*\s*$/, '').replace(/\s*\^\s*\d+\s*/g, ' ').trim();
    const recs = ne.filter((c) => CONF_REC.test(c));
    if (!school || !recs.length || /^\d/.test(school) || /^(conference|overall|pct|gp|pts)$/i.test(school)) continue;
    const confRecord = overallFirst && recs.length > 1 ? recs[1] : recs[0];
    const i = ne.indexOf(confRecord);
    const before = i > 0 ? ne[i - 1] : null;
    rows.push({
      school, raw, group,
      seed: /\^\s*(\d+)/.exec(raw) ? Number(/\^\s*(\d+)/.exec(raw)[1]) : null,
      champion: /[&*]/.test(raw),
      confRecord,
      overallRecord: overallFirst ? recs[0] : (recs[1] ?? null),
      recordColumnOrder: overallFirst ? 'OVERALL_FIRST' : 'CONFERENCE_FIRST',
      // Matches played sits immediately BEFORE the record. The header cannot be
      // indexed against the data row: empty cells are dropped from both at
      // different rates, and "the second integer in the row" is the points column.
      conferenceMatches: hasGamesPlayed && before && /^\d{1,2}$/.test(before) ? Number(before) : null,
      cells: ne.slice(0, 12),
    });
  }
  // These tables print the school twice per row — a logo cell, then the name.
  const seen = new Set();
  return rows.filter((r) => { const k = r.school.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** The standings table inside a Next.js page's own data payload. */
export function parseNextPayload(html) {
  const m = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  let j;
  try { j = JSON.parse(m[1]); } catch { return null; }
  const fb = j?.props?.pageProps?.fallback;
  const key = fb && Object.keys(fb).find((k) => /standings\/table/.test(k));
  if (!key || !Array.isArray(fb[key]?.data)) return null;
  const teams = fb[key].data.map((row, i) => {
    const cells = Object.assign({}, ...(row.data ?? []));
    return {
      school: row.market ?? row.alias ?? null,
      raw: row.market ?? row.alias ?? '',
      group: null, row: i + 1, seed: null, champion: false,
      confRecord: cells.conf_record ?? null,
      overallRecord: cells.ovr_record ?? null,
      recordColumnOrder: 'CONFERENCE_FIRST',
      conferenceMatches: null,
      cells: Object.entries(cells).slice(0, 12).map(([k, v]) => `${k}=${v}`),
    };
  }).filter((t) => t.school && t.confRecord);
  // The payload also lists which seasons the conference published, so a season
  // it never had is distinguishable from one we failed to fetch.
  return { teams, availableSeasons: (fb[key].available_seasons ?? []).map((s) => String(s.season_year)) };
}

export const seasonIds = (html) => {
  const out = {};
  for (const m of html.matchAll(/<option[^>]*value=["'](\d+)["'][^>]*>\s*(\d{4})[^<]*<\/option>/g)) if (!out[m[2]]) out[m[2]] = m[1];
  return out;
};

const member = (t, i, platform) => ({
  raw: t.school, printed: t.raw, row: t.row ?? i + 1, group: t.group ?? null,
  conferenceRecord: t.confRecord ?? null, overallRecord: t.overallRecord ?? null,
  conferenceMatches: t.conferenceMatches ?? null, recordColumnOrder: t.recordColumnOrder ?? null,
  seed: t.seed ?? null, champion: !!t.champion, cells: t.cells ?? null, platform,
});
const season = (status, extra = {}) => ({ status, ...extra });

/** One conference-sport, over the four seasons, across the three routes. */
export async function collect(conf, sport) {
  const rec = {
    conferenceId: conf.id,
    conferenceName: conferenceById(conf.id)?.name ?? conf.name,
    sport,
    host: conf.host,
    hostSource: conf.hostSource ?? 'CURATED',
    hostSourceUrl: conf.hostSourceUrl ?? null,
    divisionStatements: conf.divisionStatements ?? [],
    seasons: {},
  };
  if (!conf.host) { rec.entryStatus = COLLECTION_STATUS.SOURCE_NOT_FOUND; return rec; }
  const need = () => SEASONS.filter((y) => rec.seasons[y]?.status !== 'OK');

  // ── route A: Sidearm, via the season selector's own option list ───────────
  let entry = null;
  for (const p of [SLUG[sport], sport, `${SLUG[sport]}occer`]) {
    const r = await get(`https://${conf.host}/standings.aspx?path=${p}`);
    await sleep(250);
    if (r.status === 'OK' && /<option[^>]*value=["']\d+["'][^>]*>\s*\d{4}/.test(r.body)) { entry = r; break; }
    if (r.status === COLLECTION_STATUS.TRANSPORT_FAILED) { rec.entryStatus = r.status; break; }
  }
  if (entry) {
    const ids = seasonIds(entry.body);
    for (const y of SEASONS) {
      if (!ids[y]) { rec.seasons[y] = season(COLLECTION_STATUS.SEASON_NOT_AVAILABLE); continue; }
      const url = `https://${conf.host}/standings.aspx?standings=${ids[y]}`;
      const page = await get(url);
      await sleep(250);
      if (page.status !== 'OK') { rec.seasons[y] = season(page.status, { url, http: page.http }); continue; }
      const title = titleOf(page.body);
      const teams = parseStandingsTable(page.body);
      rec.seasons[y] = teams.length ? {
        status: 'OK', url, platform: 'SIDEARM_STANDINGS', title,
        seasonConfirmed: !!title && new RegExp(`\\b${y}\\b`).test(title),
        sportConfirmed: !!title && SPORT_WORDS[sport].test(title),
        groups: [...new Set(teams.map((t) => t.group).filter(Boolean))],
        members: teams.map((t, i) => member(t, i, 'SIDEARM_STANDINGS')),
      } : season(COLLECTION_STATUS.PARSE_FAILED, { url, title });
    }
  }

  // ── route B: PrestoSports, where the season is in the path ────────────────
  for (const y of need()) {
    const url = `https://${conf.host}/sports/${SLUG[sport]}/${y}-${String(Number(y) + 1).slice(2)}/standings`;
    const page = await get(url);
    await sleep(200);
    if (page.status !== 'OK') { rec.seasons[y] = rec.seasons[y] ?? season(page.status, { url, http: page.http }); continue; }
    const title = titleOf(page.body);
    if (/not found/i.test(title ?? '')) { rec.seasons[y] = season(COLLECTION_STATUS.SEASON_NOT_AVAILABLE, { url, title }); continue; }
    const teams = parseStandingsTable(page.body);
    const confirms = !!title && new RegExp(`\\b${y}\\b`).test(title);
    rec.seasons[y] = teams.length && confirms ? {
      status: 'OK', url, platform: 'PRESTO_STANDINGS', title,
      seasonConfirmed: true, sportConfirmed: !!title && SPORT_WORDS[sport].test(title),
      groups: [...new Set(teams.map((t) => t.group).filter(Boolean))],
      members: teams.map((t, i) => member(t, i, 'PRESTO_STANDINGS')),
    } : season(teams.length ? COLLECTION_STATUS.SEASON_NOT_CONFIRMED : COLLECTION_STATUS.PARSE_FAILED, { url, title });
  }

  // ── route C: Next.js, with the table in the page's own data payload ───────
  for (const y of need()) {
    const url = `https://${conf.host}/${SLUG[sport]}/standings/${y}/`;
    const page = await get(url);
    await sleep(400);
    if (page.status !== 'OK') { rec.seasons[y] = rec.seasons[y] ?? season(page.status, { url, http: page.http }); continue; }
    const parsed = parseNextPayload(page.body);
    const title = titleOf(page.body);
    if (!parsed) { rec.seasons[y] = rec.seasons[y] ?? season(COLLECTION_STATUS.PARSE_FAILED, { url, title }); continue; }
    if (!parsed.availableSeasons.includes(y)) { rec.seasons[y] = season(COLLECTION_STATUS.SEASON_NOT_AVAILABLE, { url, title }); continue; }
    const confirms = !!title && new RegExp(`\\b${y}\\b`).test(title);
    rec.seasons[y] = parsed.teams.length && confirms ? {
      status: 'OK', url, platform: 'NEXT_STANDINGS', title,
      seasonConfirmed: true, sportConfirmed: !!title && SPORT_WORDS[sport].test(title),
      groups: [],
      members: parsed.teams.map((t, i) => member(t, i, 'NEXT_STANDINGS')),
    } : season(parsed.teams.length ? COLLECTION_STATUS.SEASON_NOT_CONFIRMED : COLLECTION_STATUS.PARSE_FAILED, { url, title });
  }
  return rec;
}

/**
 * The inventory: which conferences to collect, on which host, with what said
 * about their division. It is data rather than code — a candidate host is
 * research output — and it lives beside the artefact so the collector is
 * re-runnable without this repository holding a list of domains.
 */
export function readInventory(dir = OUT) {
  const f = path.join(dir, 'conference-inventory.json');
  if (!fs.existsSync(f)) throw new Error(`conference inventory not found: ${f}`);
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (!Array.isArray(j.conferences) || !j.conferences.length) throw new Error(`conference inventory is empty: ${f}`);
  return j.conferences;
}

export async function run({ write = false, dir = OUT, only = null, log = console.log } = {}) {
  const inventory = readInventory(dir).filter((c) => !only || c.id === only);
  const jobs = inventory.flatMap((c) => [...new Set(c.sports ?? [])].map((sport) => ({ c, sport })));
  log(`conference-sports to collect: ${jobs.length}`);
  const out = [];
  let i = 0;
  const worker = async () => {
    for (;;) {
      const n = i; i += 1;
      if (n >= jobs.length) return;
      out[n] = await collect(jobs[n].c, jobs[n].sport);
      if ((n + 1) % 20 === 0) log(`  ${n + 1}/${jobs.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const artefact = { collectedAt: new Date().toISOString(), seasons: SEASONS.map(Number), conferences: out.filter(Boolean) };
  let ok = 0; let members = 0;
  for (const c of artefact.conferences) for (const s of Object.values(c.seasons)) if (s.status === 'OK') { ok += 1; members += s.members.length; }
  const lat = [...stats.latency].sort((a, b) => a - b);
  log(`seasons collected ${ok}   member rows ${members}`);
  log(`requests ${stats.requests} (cached ${stats.cached}, retries ${stats.retries}, challenged ${stats.challenged}, `
    + `transport failures ${stats.failures})  ${(stats.bytes / 1e6).toFixed(1)} MB  `
    + `mean ${lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : 0} ms`);
  if (!write) { log('\ndry run — pass --write to replace the artefact'); return { artefact, written: null }; }
  const f = path.join(dir, ARTEFACT);
  // Atomic: a half-written artefact is a coverage collapse the importer would
  // load without complaint.
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(artefact, null, 1));
  fs.renameSync(`${f}.tmp`, f);
  log(`wrote ${f}`);
  return { artefact, written: f };
}

if (import.meta.url === `file://${process.argv[1]}`) run({ write: WRITE, only: ONLY });
