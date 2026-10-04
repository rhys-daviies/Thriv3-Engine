/**
 * Structured previous-school evidence from OFFICIAL roster pages — Phase 8B.1A.
 *
 *   node server/scripts/collectPriorSchoolEvidence.js --db <sqlite> --season 2026 --out <file.json>
 *   node server/scripts/collectPriorSchoolEvidence.js --db <copy.sqlite> --season 2026 --apply
 *
 * Reads the page each season row was acquired from (`source_roster_url`) out of the roster
 * pipeline's page cache (never the network), extracts the school fields the markup declares and
 * resolves them against canonical college names and institution aliases. See
 * server/lib/players/priorSchoolEvidence.js for the two measured traps this guards against.
 *
 * --out writes JSON and touches nothing (read-only open). --apply writes the evidence table and is
 * refused on the managed shared DB: there it is applied only through the guarded Phase 8B.1A fixture.
 */
import fs from 'node:fs'; import os from 'node:os'; import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { buildInstitutionIndex } from '../lib/players/priorSchoolEvidence.js';
import { collectPageEvidence } from '../lib/players/linkBuilder.js';

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(`--${n}`);

export function collectSeasonEvidence(db, { season, cacheDir, recordedAt = new Date().toISOString() }) {
  const rows = db.prepare('SELECT id, college_name, sport, season, player_name, source_roster_url FROM roster_players WHERE season = ? AND source_roster_url IS NOT NULL').all(String(season));
  const byUrl = new Map(); for (const r of rows) (byUrl.get(r.source_roster_url) || byUrl.set(r.source_roster_url, []).get(r.source_roster_url)).push(r);
  const idx = new Map(); const indexFor = (s) => idx.get(s) || idx.set(s, buildInstitutionIndex(db, s)).get(s);
  const evidence = []; const pages = { total: byUrl.size, cached: 0, structure: {} };
  for (const [url, rs] of byUrl) {
    const f = `${cacheDir}/${crypto.createHash('sha1').update(url).digest('hex')}.html`;
    if (!fs.existsSync(f)) { pages.structure.NOT_CACHED = (pages.structure.NOT_CACHED || 0) + 1; continue; }
    pages.cached += 1;
    const observedAt = fs.statSync(f).mtime.toISOString();
    const sports = [...new Set(rs.map((r) => r.sport))];
    for (const sport of sports) {
      const r = collectPageEvidence({ html: fs.readFileSync(f, 'utf8'), url, observedAt, rows: rs.filter((x) => x.sport === sport), index: indexFor(sport) });
      pages.structure[r.structure] = (pages.structure[r.structure] || 0) + 1;
      for (const e of r.evidence) { const { _parts, ...row } = e; evidence.push({ ...row, recorded_at: recordedAt }); }
    }
  }
  evidence.sort((a, b) => a.evidence_id.localeCompare(b.evidence_id));
  return { evidence, pages };
}

export function writeEvidence(db, evidence) {
  const ins = db.prepare(`INSERT OR REPLACE INTO player_prior_school_evidence (evidence_id, observation_id, source_url, observed_at, field_type, raw_value, resolution, resolved_programmes, resolved_entity, evidence_strength, parser_version, recorded_at)
    VALUES (@evidence_id, @observation_id, @source_url, @observed_at, @field_type, @raw_value, @resolution, @resolved_programmes, @resolved_entity, @evidence_strength, @parser_version, @recorded_at)`);
  db.transaction(() => { for (const e of evidence) ins.run(e); })();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dbPath = arg('db'); const season = arg('season', '2026'); const out = arg('out');
  const cacheDir = arg('cache', `${os.homedir()}/Library/Caches/recruitmatch-rb/pages`);
  if (!dbPath) { console.error('Give --db.'); process.exit(2); }
  if (flag('apply') && /server\/data\/recruitmatch\.sqlite$/.test(fs.realpathSync(dbPath))) { console.error('refused: --apply on the managed shared DB. Apply through the guarded Phase 8B.1A fixture.'); process.exit(3); }
  const db = new Database(dbPath, { readonly: !flag('apply'), fileMustExist: true });
  const { evidence, pages } = collectSeasonEvidence(db, { season, cacheDir });
  if (flag('apply')) writeEvidence(db, evidence);
  if (out) fs.writeFileSync(out, JSON.stringify({ season, pages, evidence }, null, 1));
  const tally = evidence.reduce((a, e) => { a[e.evidence_strength] = (a[e.evidence_strength] || 0) + 1; return a; }, {});
  console.log(JSON.stringify({ season, pages, evidence: evidence.length, by_strength: tally, wrote: flag('apply') }, null, 1));
  db.close();
}
