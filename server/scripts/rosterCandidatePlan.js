/**
 * Where to look first, for a programme we have never fetched.
 *
 * L6D attempted 34 active NCAA programmes and made no request against any of
 * them: every acquiring stage transforms a URL the pipeline already holds, and
 * these had none. This is the step that supplies the first one — institution →
 * verified athletics host → ordered roster candidates — and it is the only
 * place those three are joined.
 *
 * It writes no pipeline state, no roster sheet and no database row. `--csv`
 * emits `_registry_candidates.csv`, which `build_targets.py` reads ALONGSIDE
 * the membership export and uses only where a programme has no scanned history:
 * a known-good URL from a prior season always wins, because it is an
 * observation and this is a suggestion.
 *
 *   node server/scripts/rosterCandidatePlan.js --keys /tmp/l6d-keys.txt
 *   node server/scripts/rosterCandidatePlan.js --simulate
 *   node server/scripts/rosterCandidatePlan.js --keys … --verify   (bounded HEAD/GET)
 *   node server/scripts/rosterCandidatePlan.js --csv --out <path>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import db from '../db/client.js';
import {
  inverseIndex, canonicalHost, PROFILE, LOOKUP,
} from '../../shared/evidence/domainAuthority.js';
import { candidatesForLookup, CANDIDATE, MAX_ATTEMPTED_CANDIDATES } from '../../shared/roster/rosterCandidates.js';
import { classifyReadiness, READINESS } from '../../shared/roster/rosterReadiness.js';
import { rosterTargetUniverse } from './rosterTargetUniverse.js';

export const CANDIDATE_SEASON = 2026;

const LEDGER = `SELECT domain, unitid, status, role, confidence, identity_strength,
                       evidence_text, wrong_mappings, platform
                FROM athletics_domains`;

/**
 * Host spellings this corpus's rosters have actually been fetched from.
 *
 * TWO READINGS OF ONE QUERY, and they are not the same question. `usage` is
 * canonical and answers "which of several hosts does this institution really
 * use", the tiebreak `hostsForInstitution` applies. `observed` keeps the
 * spelling — `www.gonorthwood.com`, not `gonorthwood.com` — and answers "what
 * did we actually put on the wire and get a roster back from". Canonicalising
 * the second into the first is the defect L7I exists to correct, so the raw
 * form is carried rather than recovered.
 */
export function rosterHostForms() {
  const usage = new Set();
  // How MANY sources used each spelling, not merely that one did: where an
  // institution has fetched rosters from both forms, the count is the tiebreak.
  const observed = new Map();
  for (const r of db.prepare(
    'SELECT DISTINCT source_roster_url u FROM roster_players WHERE source_roster_url IS NOT NULL',
  ).all()) {
    try {
      const h = new URL(r.u).hostname.toLowerCase();
      observed.set(h, (observed.get(h) ?? 0) + 1);
      usage.add(canonicalHost(h));
    } catch { /* not a URL; nothing to learn */ }
  }
  return { usage, observed };
}

/** Hosts an institution's own rosters have actually been fetched from. */
export function rosterHostUsage() {
  return rosterHostForms().usage;
}

/** Programmes that already hold a roster source, so a candidate is unnecessary. */
function programmesWithSource() {
  const out = new Set();
  for (const r of db.prepare(
    'SELECT DISTINCT college_name n, sport s FROM roster_players WHERE source_roster_url IS NOT NULL',
  ).all()) out.add(`${r.n}||${r.s}`);
  return out;
}

/**
 * One row per programme: what the discovery path would offer it, and why.
 *
 * `profile` defaults to DISCOVERY because that is what this file is for. The
 * STRICT profile is what production source verification reads, and the two are
 * deliberately different — see `domainAuthority.js`.
 */
export function candidatePlan({
  programmes = null, season = CANDIDATE_SEASON, profile = PROFILE.DISCOVERY, limit = Infinity,
} = {}) {
  const rows = db.prepare(LEDGER).all();
  const { usage, observed } = rosterHostForms();
  const index = inverseIndex(rows, { profile, usage, observed });
  const platform = new Map(rows.filter((r) => r.platform)
    .map((r) => [canonicalHost(r.domain), r.platform]));
  const haveSource = programmesWithSource();
  const targets = programmes ?? rosterTargetUniverse();

  return targets.map((p) => {
    const key = `${p.school}||${p.sport}`;
    const lookup = p.unitid == null
      ? { status: LOOKUP.NO_UNITID, hosts: [], reason: 'programme has no unitid' }
      : index.get(p.unitid) ?? { status: LOOKUP.NO_TRUSTED_HOST, hosts: [], reason: 'institution absent from the ledger' };
    const host0 = lookup.hosts?.[0] ?? null;
    const gen = candidatesForLookup(lookup, {
      sport: p.sport, season, limit, platform: host0 ? platform.get(host0) ?? null : null,
    });
    let state;
    if (haveSource.has(key)) state = 'EXISTING_CANDIDATE';
    else if (gen.status === CANDIDATE.OK) state = 'NEW_VERIFIED_HOST_CANDIDATES';
    else if (gen.status === CANDIDATE.AMBIGUOUS_HOST) state = 'AMBIGUOUS_HOST';
    else state = 'NO_TRUSTED_HOST';
    return {
      key,
      school: p.school,
      sport: p.sport,
      division: p.division,
      unitid: p.unitid ?? null,
      state,
      host: gen.host ?? null,
      hosts: lookup.hosts,
      fetchHosts: lookup.fetchHosts ?? [],
      platform: gen.host ? platform.get(gen.host) ?? null : null,
      candidates: gen.candidates,
      reason: gen.reason,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Bounded verification                                                        */
/* -------------------------------------------------------------------------- */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** A page that shows a squad, told apart from one that merely answered 200. */
const ROSTER_MARKS = /sidearm-roster-player|roster-card|s-person-card|data-player|roster__player|class="[^"]*roster/i;
/** A 200 that is really a "not found" — the failure mode L6's audit named. */
const SOFT_404 = /page not found|404|cannot be found|no longer available/i;

const ogSiteName = (html) => html.match(
  /<meta[^>]+(?:property|name)="og:site_name"[^>]*content="([^"]*)"/i,
)?.[1] ?? html.match(/<title[^>]*>([^<]{0,90})/i)?.[1]?.trim() ?? null;

/**
 * A redirect that changed the sport is a refusal wearing a 200.
 *
 * `uwlathletics.com/sports/mens-soccer/roster/2026` answers by redirecting to
 * `/sports/mens-track-and-field/roster/gary-trkula/4182` — a different sport,
 * and a player rather than a squad. It carries roster markup and would pass a
 * naive "did we land on a roster" test, which is exactly how a source ends up
 * cited for the wrong programme. So the landing path must still name the slug
 * that was asked for, and must not end in a player segment.
 */
/**
 * The page must be about the programme that was asked for.
 *
 * L7E called Southwest Minnesota State ready on the strength of HTTP 200, the
 * right host, and 82 roster markers. The page was
 * `Sonya Smith - Women's Soccer - SMSU Athletics` — a women's bio served at
 * `/sports/msoc/roster/season/2026`, on a host whose `.aspx` routing answers
 * `/sports/msoc` with a football event page. Host identity was never in
 * question; the SPORT was, and nothing checked it.
 *
 * So a page that names the other gender's programme in its own title is
 * refused. The markers are no defence: a site's navigation carries roster
 * markup on every page it serves.
 */
const SPORT_TITLE = {
  'mens-soccer': { own: /\bmen'?s soccer\b/i, other: /\bwomen'?s soccer\b/i },
  'womens-soccer': { own: /\bwomen'?s soccer\b/i, other: /\bmen'?s soccer\b/i },
};

export function sportContradicted(html, sport) {
  const t = SPORT_TITLE[sport];
  if (!t) return null;
  const title = html.match(/<meta[^>]+(?:property|name)="og:title"[^>]*content="([^"]*)"/i)?.[1]
    ?? html.match(/<title[^>]*>([^<]{0,140})/i)?.[1] ?? '';
  const said = title.replace(/&#39;|&apos;/g, "'");
  if (t.other.test(said) && !t.own.test(said)) return said.trim().slice(0, 70);
  return null;
}

const SEASON_TAIL = /^(?:20\d\d|20\d\d-\d\d|season)$/i;
const PLAYER_TAIL = /\/roster\/([a-z0-9][a-z0-9.-]*)(?:\/\d+)?\/?$/i;

function landedOnAsked(finalUrl, slug) {
  let path;
  try { path = new URL(finalUrl).pathname; } catch { return false; }
  if (!path.includes(`/sports/${slug}/`) && !path.endsWith(`/sports/${slug}`)) return false;
  // `/roster/2026` and `/roster/season/2026` are seasons, not people.
  const tail = path.match(PLAYER_TAIL)?.[1];
  return !tail || SEASON_TAIL.test(tail);
}

/**
 * One request, and a verdict about the PROGRAMME rather than about the site.
 *
 * The verdict vocabulary is unchanged so the console output and the cohort file
 * still read the same, but what decides it is now `classifyReadiness`, which
 * reads the page's own title and counts its roster entries. `READY` carries the
 * old `200_ROSTER` / `REDIRECT_TO_ROSTER` distinction; everything short of it is
 * UNKNOWN, and a contradiction is REFUSED. See `rosterReadiness.js` for why.
 */
async function probe(url, slug, sport, { season = CANDIDATE_SEASON, identityHost = null } = {}) {
  let res;
  try {
    res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'text/html' } });
  } catch (err) { return { verdict: 'OTHER', readiness: READINESS.UNKNOWN, detail: err.message.slice(0, 60) }; }
  const html = res.ok ? (await res.text()).slice(0, 400_000) : '';
  const r = classifyReadiness({
    html, finalUrl: res.url, slug, sport, season, identityHost, status: res.status,
  });
  const common = { readiness: r.readiness, entries: r.entries, title: r.title };
  if (r.readiness === READINESS.REFUSED) {
    if (res.status === 404) return { verdict: '404', ...common, detail: null };
    return { verdict: 'SOFT_404', ...common, detail: r.reason };
  }
  if (r.readiness === READINESS.UNKNOWN) {
    if (res.status === 403) return { verdict: '403', ...common, detail: r.reason };
    return { verdict: 'OTHER', ...common, detail: r.reason };
  }
  const redirected = new URL(res.url).pathname !== new URL(url).pathname;
  return {
    verdict: redirected ? 'REDIRECT_TO_ROSTER' : '200_ROSTER',
    ...common, url: res.url, identity: ogSiteName(html),
  };
}

/** First candidate that answers, per programme. Sequential — this is a courtesy, not a crawl. */
export async function verifyPlan(plan, per = 8) {
  const out = [];
  for (const p of plan) {
    if (p.state !== 'NEW_VERIFIED_HOST_CANDIDATES') {
      out.push({ ...p, verdict: p.state, tried: 0 });
      continue;
    }
    let last = null; let tried = 0;
    for (const c of p.candidates.slice(0, per)) {
      tried += 1;
      // Sequential with a pause. An earlier pass at full speed drew rate limits
      // that read as 404s, which is a good way to conclude something false.
      if (tried > 1) await new Promise((r) => { setTimeout(r, 600); });
      const r = await probe(c.url, c.slug, p.sport, { identityHost: p.host });
      last = r;
      if (r.verdict === '200_ROSTER' || r.verdict === 'REDIRECT_TO_ROSTER') break;
      // A 403 is the host refusing every path; asking seven more proves nothing.
      if (r.verdict === '403') break;
    }
    out.push({ school: p.school, sport: p.sport, host: p.host, tried, ...last });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

const argv = process.argv.slice(2);
const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

function keyed(path) {
  const want = new Set(readFileSync(path, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean));
  return rosterTargetUniverse().filter((p) => want.has(`${p.school}||${p.sport}`));
}

const cell = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function main() {
  const season = Number(arg('season', CANDIDATE_SEASON));
  const keysPath = arg('keys');
  const plan = candidatePlan({
    programmes: keysPath ? keyed(keysPath) : null,
    season,
    limit: Number(arg('limit', Infinity)),
  });

  if (argv.includes('--csv')) {
    /*
     * THE WHOLE ORDERED LIST, not just the first.
     *
     * It used to be the first only, on the reasoning that the pipeline's own
     * ladder expands a candidate into its season-bearing forms. That holds
     * WITHIN a shape family and not across one. L7F met the difference:
     * Southwest Minnesota State's first candidate 404s, its roster sits at
     * `/sports/msoc/roster/season/2026` — candidate ten — and no amount of
     * transforming candidate one reaches a different family. Measured against
     * every known NCAA roster URL, 7.9% of them win at ordinal 2 or later.
     *
     * `Candidate` stays as the first so nothing that reads one URL breaks;
     * `Candidates` carries the ordered list the acquirer walks.
     */
    const wanted = plan.filter((p) => p.state === 'NEW_VERIFIED_HOST_CANDIDATES');
    const body = ['School,Sport,Host,Platform,Candidate,Candidates', ...wanted.map((p) => [
      p.school, p.sport, p.host, p.platform ?? '', p.candidates[0].url,
      p.candidates.slice(0, MAX_ATTEMPTED_CANDIDATES).map((c) => c.url).join('|'),
    ].map(cell).join(','))].join('\r\n') + '\r\n';
    const out = arg('out');
    if (out) { writeFileSync(out, body, 'utf8'); console.log(`wrote ${out} — ${wanted.length} candidates`); }
    else process.stdout.write(body);
    return;
  }

  if (argv.includes('--verify')) {
    /*
     * BOUNDED VERIFICATION, NOT ACQUISITION. One request per candidate until a
     * programme answers, no parsing into data, no state, no sheet, no import.
     * It answers one architectural question — does a generated candidate reach
     * a roster page — and nothing about whether that page may be believed,
     * which is what the pipeline's own gates are for.
     */
    verifyPlan(plan, Number(arg('per', 8))).then((results) => {
      const counts = {};
      for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
      /*
       * The acquisition cohort, DERIVED. A programme whose generated candidate
       * reached a roster page over plain HTTP is DIRECT_READY. One whose host
       * answered 200 with the squad loaded by script is BROWSE_REQUIRED — this
       * verifier is static and cannot read it, but `browse.py` drives Playwright
       * and is the stage built for exactly that, so it belongs in the run.
       *
       * Everything else stays out: a soft-404 is a site answering every path
       * with something else, and no trusted host is no candidate at all. Written
       * to a file rather than pasted into a brief so the membership is
       * reproducible and nobody has to trust a list.
       */
      const CLASS = { '200_ROSTER': 'DIRECT_READY', REDIRECT_TO_ROSTER: 'DIRECT_READY', OTHER: 'BROWSE_REQUIRED' };
      const cohortOut = arg('cohort-out');
      if (cohortOut) {
        const picked = results.filter((r) => CLASS[r.verdict]);
        writeFileSync(cohortOut, `${picked.map((r) => `${r.school}||${r.sport}`).join('\n')}\n`, 'utf8');
        const classOut = arg('class-out');
        if (classOut) {
          writeFileSync(classOut, ['Key,Class,Host,Verdict,Url', ...results.map((r) => [
            `${r.school}||${r.sport}`, CLASS[r.verdict] ?? 'EXCLUDED', r.host ?? '', r.verdict, r.url ?? '',
          ].map(cell).join(','))].join('\r\n') + '\r\n', 'utf8');
        }
        console.log(`wrote ${cohortOut} — ${picked.length} keys `
          + `(${picked.filter((r) => CLASS[r.verdict] === 'DIRECT_READY').length} direct, `
          + `${picked.filter((r) => CLASS[r.verdict] === 'BROWSE_REQUIRED').length} browse)`);
      }
      for (const r of results) {
        console.log(`${(r.readiness ?? r.verdict).padEnd(9)} ${r.verdict.padEnd(18)} `
          + `${r.school.slice(0, 32).padEnd(32)} ${r.sport === 'mens-soccer' ? 'M' : 'W'}  `
          + `${r.tried} tried  ${r.entries != null ? `${r.entries} entries  ` : ''}${r.url ?? r.detail ?? ''}`);
        if (r.identity) console.log(`${''.padEnd(18)}   og:site_name = ${JSON.stringify(r.identity)}`);
      }
      console.log(`\n  ${JSON.stringify(counts)}`);
    });
    return;
  }

  if (argv.includes('--simulate')) {
    const by = new Map();
    for (const p of plan) {
      const k = `${p.division}|${p.sport}`;
      if (!by.has(k)) by.set(k, { EXISTING_CANDIDATE: 0, NEW_VERIFIED_HOST_CANDIDATES: 0, AMBIGUOUS_HOST: 0, NO_TRUSTED_HOST: 0 });
      by.get(k)[p.state] += 1;
    }
    console.log(`\nCANDIDATE PLAN — ${plan.length} active NCAA programmes, season ${season}\n`);
    console.log('  division    sport      existing   generated  ambiguous   no host');
    const tot = { EXISTING_CANDIDATE: 0, NEW_VERIFIED_HOST_CANDIDATES: 0, AMBIGUOUS_HOST: 0, NO_TRUSTED_HOST: 0 };
    for (const [k, e] of by) {
      const [d, s] = k.split('|');
      for (const x of Object.keys(tot)) tot[x] += e[x];
      console.log(`  ${d.padEnd(11)}${s.replace('-soccer', '').padEnd(10)}`
        + `${String(e.EXISTING_CANDIDATE).padStart(10)}${String(e.NEW_VERIFIED_HOST_CANDIDATES).padStart(12)}`
        + `${String(e.AMBIGUOUS_HOST).padStart(11)}${String(e.NO_TRUSTED_HOST).padStart(10)}`);
    }
    console.log(`\n  ${tot.EXISTING_CANDIDATE} already hold a roster source — the generator is not used for them.`);
    console.log(`  ${tot.NEW_VERIFIED_HOST_CANDIDATES} would be offered candidates from a verified host.`);
    console.log(`  ${tot.AMBIGUOUS_HOST} hold several hosts and nothing distinguishes them.`);
    console.log(`  ${tot.NO_TRUSTED_HOST} have no host this profile will stand behind.\n`);
    console.log('  A candidate is a place to ask, not a verified source. Every gate still runs.');
    return;
  }

  for (const p of plan) {
    console.log(`${p.division.padEnd(8)} ${p.sport === 'mens-soccer' ? 'M' : 'W'} `
      + `${p.school.slice(0, 38).padEnd(38)} ${p.state}`);
    if (p.host) console.log(`    host ${p.host}${p.platform ? ` [${p.platform}]` : ''} — ${p.candidates.length} candidates`);
    else console.log(`    ${p.reason}${p.hosts.length ? ` (${p.hosts.join(', ')})` : ''}`);
  }
  const n = (s) => plan.filter((p) => p.state === s).length;
  console.log(`\n  EXISTING_CANDIDATE ${n('EXISTING_CANDIDATE')} · NEW_VERIFIED_HOST_CANDIDATES ${n('NEW_VERIFIED_HOST_CANDIDATES')}`
    + ` · AMBIGUOUS_HOST ${n('AMBIGUOUS_HOST')} · NO_TRUSTED_HOST ${n('NO_TRUSTED_HOST')}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
