#!/usr/bin/env node
/**
 * PROGRAMME CONTACT BATCH ACQUISITION — Phase 1G-D. Resumable, deterministic, ISOLATED.
 *
 *   node server/scripts/programmeContactAcquire.js --source-db <shared db> --work-dir <dir> --season 2026 \
 *     [--cohorts REACQUIRE] [--programmes <json>] [--batch-size 10] [--max-batches N] \
 *     [--apply-work] [--refetch] [--delay-ms 2500] [--report-only]
 *
 * THE SOURCE DATABASE IS NEVER WRITTEN. It is copied once into <work-dir>/base.sqlite (pristine,
 * never written) and <work-dir>/work.sqlite (the acquisition's own working copy). Every write —
 * staging, and with --apply-work the rehearsal promotions — happens in work.sqlite. Applying to a
 * shared database is a separate, authorised `integrity:promote --apply` of a batch this run staged.
 * The command refuses a work directory whose copy is the source, and refuses to resume when the
 * source has changed since the run began (the plan was made against a different database).
 *
 * Each batch: GATHER (programmeContactAdapter, host-only, cached per staff URL so a resume or a
 * re-run reads the same evidence) -> STAGE (stageRefresh into work.sqlite) -> DRY RUN (the
 * unchanged integrity:promote CLI: simulation on copies + 14 gates) -> optionally APPLY_TO_WORK
 * (the same CLI with --apply, so later batches are judged on top of earlier ones and coverage can be
 * measured). State is written after every step to <work-dir>/state.json; a crash resumes from the
 * last completed step. The report (<work-dir>/report.json, report.md) gives one outcome per lead.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { buildProgrammeContactPlan } from './programmeContactPlan.js';
import { buildLeadQueue } from './programmeContactLeads.js';
import { loadRefreshContext } from '../lib/refresh/context.js';
import { programmeContactAdapter, ADAPTER_VERSION } from '../lib/refresh/adapters/gatherers.js';
import { fetchPage } from '../lib/refresh/adapters/fetchPage.js';
import { stageRefresh, writeStagedBatch } from '../lib/refresh/staging.js';
import { copyDatabase } from '../lib/refresh/integrityMeasure.js';
import { batchPlan, batchScope, outcomeOf, pendingCorrectionFor, reportDigest, OUTCOME, ACQ_VERSION } from '../lib/refresh/programmeContactAcquisition.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROMOTE = path.join(ROOT, 'server/scripts/integrityPromote.js');
const FIXTURE_1GPRE = path.join(ROOT, 'docs/validation/integrity-audit/phase1gpre_protected_correction_fixture.json');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const fileSha = (p) => sha(fs.readFileSync(p));
const writeJson = (p, v) => { const t = `${p}.tmp`; fs.writeFileSync(t, `${JSON.stringify(v, null, 1)}\n`); fs.renameSync(t, p); };
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/** integrity:promote, unchanged, as a child process. -> { exit, ops, withheld, gates, pass, applied, out } */
export function runPromote(dbPath, batchId, batchHash, { apply = false, manifestOut = null } = {}) {
  const args = [PROMOTE, '--db', dbPath, '--batch', batchId, '--batch-hash', batchHash, ...(apply ? ['--apply', '--manifest-out', manifestOut] : [])];
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, RECRUITMATCH_DB: ':memory:' }, maxBuffer: 64 << 20 });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const plan = out.match(/PROMOTION PLAN \S+: (\d+) op\(s\), (\d+) withheld/);
  const gates = Object.fromEntries([...out.matchAll(/^\s+(PASS|FAIL) (G\d+\w*)/gm)].map((m) => [m[2], m[1] === 'PASS']));
  return { exit: r.status, ops: plan ? Number(plan[1]) : null, withheld: plan ? Number(plan[2]) : null, gates, pass: r.status === 0 && Object.keys(gates).length > 0 && Object.values(gates).every(Boolean),
    applied: /PROMOTED (\d+) op/.test(out) ? Number(out.match(/PROMOTED (\d+) op/)[1]) : 0, out: out.slice(-4000) };
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (n, d = null) => { const i = argv.indexOf(`--${n}`); return i > -1 ? argv[i + 1] : d; };
  const flag = (n) => argv.includes(`--${n}`);
  const fail = (m, c = 2) => { console.error(m); process.exit(c); };
  const source = arg('source-db') && path.resolve(arg('source-db'));
  const dir = arg('work-dir') && path.resolve(arg('work-dir'));
  const season = Number(arg('season'));
  if (!source || !dir || !Number.isInteger(season)) fail('usage: programmeContactAcquire --source-db <db> --work-dir <dir> --season <year> [--cohorts ..] [--programmes f] [--batch-size N] [--max-batches N] [--apply-work] [--refetch] [--delay-ms N] [--report-only]');
  if (/^\/data\//.test(source)) fail('Refusing a production /data path.');
  fs.mkdirSync(path.join(dir, 'cache'), { recursive: true }); fs.mkdirSync(path.join(dir, 'batches'), { recursive: true });
  const base = path.join(dir, 'base.sqlite'); const work = path.join(dir, 'work.sqlite');
  if ([base, work].includes(source)) fail('The work directory holds the source database itself — refusing (the source is never written).');
  const statePath = path.join(dir, 'state.json');
  const sourceSha = fileSha(source);
  let state = fs.existsSync(statePath) ? readJson(statePath) : null;
  if (state && state.source_sha256 !== sourceSha) fail(`SOURCE CHANGED since this run began (${state.source_sha256.slice(0, 12)} -> ${sourceSha.slice(0, 12)}). The plan is stale: start a new work directory.`, 1);
  if (!state) {
    copyDatabase(source, base); copyDatabase(source, work);
    state = { acq_version: ACQ_VERSION, adapter_version: ADAPTER_VERSION, source: path.basename(source), source_sha256: sourceSha, season, started_at: new Date().toISOString(), batches: {} };
    writeJson(statePath, state);
  }

  // PLAN — from the pristine copy; programmes already holding a VERIFIED contact are not re-acquired
  const bdb = new Database(base, { readonly: true }); bdb.pragma('query_only = ON');
  const programmes = arg('programmes') ? readJson(path.resolve(arg('programmes'))).programmes : null;
  const plan = buildProgrammeContactPlan(bdb, { season, programmes, cohorts: (arg('cohorts') || 'REACQUIRE').split(',') });
  const held = new Set(bdb.prepare("SELECT athletics_entity_id || '|' || sport FROM programme_contacts WHERE status = 'VERIFIED'").pluck().all());
  const bp = batchPlan(plan, { batchSize: Number(arg('batch-size', 10)), held });
  if (state.run_id && state.run_id !== bp.run_id) fail(`this work directory belongs to run ${state.run_id}; the requested plan is ${bp.run_id}. Use a new --work-dir.`, 1);
  state.run_id = bp.run_id; state.plan_hash = bp.plan_hash; state.batch_size = bp.batch_size; writeJson(statePath, state);
  const ctx = loadRefreshContext(bdb);
  const ownsHost = (h, e) => ctx.resolver.hostOwnedBy(h, e);
  const maxBatches = Number(arg('max-batches', bp.batches.length));
  const delay = Number(arg('delay-ms', 2500));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  console.log(`RUN ${bp.run_id} · plan ${bp.plan_hash.slice(0, 12)} · ${bp.batches.length} batch(es) of ≤${bp.batch_size} · ${bp.already_held.length} already held · ${bp.skipped.length} not planned`);

  if (!flag('report-only')) {
    for (const b of bp.batches.slice(0, maxBatches)) {
      const st = state.batches[b.batch_key] || (state.batches[b.batch_key] = { batch_no: b.batch_no, status: 'PLANNED', targets: b.targets.map((t) => `${t.athletics_entity_id}|${t.sport}`) });
      const bdir = path.join(dir, 'batches', b.batch_key); fs.mkdirSync(bdir, { recursive: true });
      try {
        // GATHER (cached per staff URL; a resume or re-run reads the same evidence)
        if (st.status === 'PLANNED') {
          const pages = []; const refusals = [];
          for (const t of b.targets) {
            const cp = path.join(dir, 'cache', `${sha(t.staff_url).slice(0, 24)}.json`);
            let r;
            if (fs.existsSync(cp) && !flag('refetch')) r = readJson(cp);
            else { await wait(delay); r = await programmeContactAdapter({ ...t, season }, { ownsHost, fetch: fetchPage, url: t.staff_url }); writeJson(cp, r); }
            if (r.page) pages.push(r.page); else refusals.push({ ...r.refusal, athletics_entity_id: t.athletics_entity_id, sport: t.sport });
            console.log(`  ${b.batch_key} ${t.institution_label} [${t.sport}] -> ${r.page ? `${r.page.contacts.length} address(es)` : `REFUSED ${r.refusal.code}`}`);
          }
          const gatheredAt = pages.map((p) => p.fetched_at).sort().pop() || null;
          writeJson(path.join(bdir, 'gathered.json'), { season, scope: batchScope(b), parser_version: ADAPTER_VERSION, gathered_at: gatheredAt, pages });
          writeJson(path.join(bdir, 'refusals.json'), refusals);
          st.status = pages.length ? 'GATHERED' : 'DONE_NO_PAGES'; st.pages = pages.length; st.refusals = refusals.length; writeJson(statePath, state);
        }
        // STAGE (work copy only; identical input re-stages as a no-op)
        if (st.status === 'GATHERED') {
          const wdb = new Database(work);
          try {
            const staged = stageRefresh(wdb, readJson(path.join(bdir, 'gathered.json')));
            writeStagedBatch(wdb, staged);
            Object.assign(st, { status: 'STAGED', refresh_batch_id: staged.batch.batch_id, batch_hash: staged.batch.batch_hash, observations: staged.summary.total });
          } finally { wdb.close(); }
          writeJson(statePath, state);
        }
        // DRY RUN (the unchanged promotion CLI: simulation on copies + every gate)
        if (st.status === 'STAGED') {
          const r = runPromote(work, st.refresh_batch_id, st.batch_hash);
          fs.writeFileSync(path.join(bdir, 'dry_run.log'), r.out);
          Object.assign(st, { status: r.pass ? 'DRY_RUN_PASSED' : 'DRY_RUN_FAILED', ops: r.ops, withheld: r.withheld, gates: r.gates });
          writeJson(statePath, state);
        }
        // APPLY TO THE WORK COPY (rehearsal only; resumable: a promotion already recorded is not re-applied)
        if (st.status === 'DRY_RUN_PASSED' && flag('apply-work')) {
          const w = new Database(work, { readonly: true });
          const done = w.prepare("SELECT promotion_id FROM refresh_promotions WHERE batch_id = ? AND status = 'PROMOTED'").pluck().get(st.refresh_batch_id); w.close();
          if (done) Object.assign(st, { status: 'APPLIED_TO_WORK', promotion_id: done });
          else {
            const r = runPromote(work, st.refresh_batch_id, st.batch_hash, { apply: true, manifestOut: path.join(bdir, 'manifest.json') });
            fs.writeFileSync(path.join(bdir, 'apply.log'), r.out);
            if (!r.pass || r.exit !== 0) { st.status = 'APPLY_TO_WORK_FAILED'; st.error = 'apply refused or reverted (see apply.log)'; }
            else { const w2 = new Database(work, { readonly: true }); Object.assign(st, { status: 'APPLIED_TO_WORK', applied: r.applied, promotion_id: w2.prepare("SELECT promotion_id FROM refresh_promotions WHERE batch_id = ? ORDER BY promoted_at DESC").pluck().get(st.refresh_batch_id) }); w2.close(); }
          }
          writeJson(statePath, state);
        }
      } catch (e) { st.error = String(e.message || e).slice(0, 500); writeJson(statePath, state); console.error(`  ${b.batch_key} stopped at ${st.status}: ${st.error} (re-run to resume)`); }
      console.log(`BATCH ${b.batch_key}: ${st.status}${st.ops != null ? ` · ${st.ops} op(s)` : ''}${st.gates ? ` · gates ${Object.values(st.gates).filter(Boolean).length}/${Object.keys(st.gates).length}` : ''}`);
    }
  }

  // REPORT — one outcome per lead; coverage measured on the work copy against the pristine base.
  // The selection module opens (and boots) the app's database client; point it at a THROWAWAY copy so
  // a report never changes work.sqlite (its suppressions are the work copy's own).
  const scratch = path.join(dir, 'report_scratch.sqlite');
  fs.rmSync(scratch, { force: true }); copyDatabase(work, scratch);
  process.env.RECRUITMATCH_DB = scratch;
  const { manualRecipientChoice } = await import('../lib/recipientSelection.js');
  const { PURSUED_ROLES } = await import('../lib/pursuitPolicy.js');
  const { classifyRole } = await import('../../shared/coachRoles.js');
  const wdb = new Database(work, { readonly: true });
  const correctionHosts = new Set(fs.existsSync(FIXTURE_1GPRE) ? readJson(FIXTURE_1GPRE).corrections.map((c) => c.host) : []);
  const leads = buildLeadQueue(bdb).leads;
  const leadBy = new Map(); for (const l of leads) if (l.programme) leadBy.set(`${l.programme.athletics_entity_id}|${l.programme.sport}`, [...(leadBy.get(`${l.programme.athletics_entity_id}|${l.programme.sport}`) || []), l]);
  const targets = [];
  for (const b of bp.batches) {
    const st = state.batches[b.batch_key];
    const bdir = path.join(dir, 'batches', b.batch_key);
    const obs = st?.refresh_batch_id ? wdb.prepare('SELECT * FROM refresh_observations WHERE batch_id = ?').all(st.refresh_batch_id) : [];
    for (const t of b.targets) {
      const cp = path.join(dir, 'cache', `${sha(t.staff_url).slice(0, 24)}.json`);
      const gathered = fs.existsSync(cp) && st && st.status !== 'PLANNED' ? readJson(cp) : undefined;
      const mine = gathered?.page ? obs.filter((o) => o.source_url === gathered.page.source_url) : [];
      const gate = st?.gates ? { pass: st.status !== 'DRY_RUN_FAILED', failed: Object.entries(st.gates).filter(([, ok]) => !ok).map(([g]) => g) } : undefined;
      const o = outcomeOf({ gathered, observations: mine, gate });
      const created = mine.filter((x) => x.proposed_action === 'CREATE_PROGRAMME_CONTACT').map((x) => { const p = JSON.parse(x.proposed_json); const ev = JSON.parse(x.evidence_json || '{}'); return { contact_id: p.contact_id, email: p.email, contact_role: p.contact_role, slot: ev.slot, person_count: ev.person_count }; });
      let coverage = null;
      if (o.outcome === 'VERIFIED' && st.status === 'APPLIED_TO_WORK') {
        const before = manualRecipientChoice({ collegeName: t.institution_label, sport: t.sport }, { handle: bdb });
        const after = manualRecipientChoice({ collegeName: t.institution_label, sport: t.sport }, { handle: wdb });
        // two surfaces, one hierarchy: the manual picker offers ANY eligible named staff member; campaigns
        // pursue only coaching roles (pursuitPolicy PURSUED_ROLES; a goalkeeper coach only for a keeper),
        // so a programme whose only eligible staff are operations roles reaches its inbox in campaigns
        const roles = after.kind === 'COACH' ? after.recipients.map((c) => classifyRole(c.position_title)) : [];
        const effect = before.kind === 'NO_RECIPIENT' && after.kind === 'PROGRAMME_INBOX' ? 'GAINS_REACHABLE_RECIPIENT'
          : after.kind !== 'COACH' ? `${before.kind}->${after.kind}`
            : roles.some((r) => PURSUED_ROLES.includes(r)) ? 'RETAINS_NAMED_COACH_PRIORITY'
              : roles.includes('goalkeeper') ? 'CAMPAIGN_INBOX_UNLESS_KEEPER_MANUAL_KEEPS_STAFF' : 'CAMPAIGN_GAINS_INBOX_MANUAL_KEEPS_STAFF';
        coverage = { before: before.kind, after: after.kind, blocked_by: after.inbox?.blockedBy ?? null, manual_staff_roles: roles, effect };
      }
      const published = (gathered?.page?.contacts || []).map((c) => ({ email: c.email, slot: c.slot, person_count: c.person_count }));
      targets.push({ athletics_entity_id: t.athletics_entity_id, sport: t.sport, programme: t.institution_label, batch: b.batch_key, staff_url: t.staff_url, ...o, contacts: created, published, fetched_at: gathered?.page?.fetched_at ?? gathered?.refusal?.fetched_at ?? null, coverage });
    }
  }
  const planned = new Set(targets.map((t) => `${t.athletics_entity_id}|${t.sport}`));
  const skippedWhy = new Map(bp.skipped.map((x) => [`${x.athletics_entity_id}|${x.sport}`, x.reason]));
  const notPlanned = leads.filter((l) => l.programme && !planned.has(`${l.programme.athletics_entity_id}|${l.programme.sport}`)).map((l) => {
    const k = `${l.programme.athletics_entity_id}|${l.programme.sport}`;
    const isHeld = held.has(k);
    const dep = pendingCorrectionFor(l, correctionHosts);
    return { athletics_entity_id: l.programme.athletics_entity_id, sport: l.programme.sport, programme: l.programme.name, outcome: isHeld ? OUTCOME.ALREADY_HELD : l.queue_status.startsWith('BLOCKED') ? 'BLOCKED' : OUTCOME.NOT_PLANNED,
      reason: isHeld ? 'a VERIFIED programme contact is already held' : skippedWhy.get(k) || l.queue_status, lead_status: l.queue_status, address_domain: l.checks.address_domain,
      // a pending correction of the page host unblocks the lead only when nothing else (its mail domain, a rule) stands in the way
      data_integrity_dependency: dep ? { ...dep, alone_unblocks: l.queue_status === 'REACQUIRE_DISCOVER_PAGE' } : null };
  }).filter((x, i, a) => a.findIndex((y) => y.athletics_entity_id === x.athletics_entity_id && y.sport === x.sport) === i);
  const count = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
  const report = {
    kind: 'PROGRAMME_CONTACT_ACQUISITION_REPORT', acq_version: ACQ_VERSION, run_id: bp.run_id, plan_hash: bp.plan_hash, source_sha256: sourceSha, season, batch_size: bp.batch_size, generated_at: new Date().toISOString(),
    totals: {
      leads_examined: leads.length, programmes_examined: new Set(leads.filter((l) => l.programme).map((l) => `${l.programme.athletics_entity_id}|${l.programme.sport}`)).size,
      planned_targets: targets.length, by_outcome: count(targets, (t) => t.outcome), not_planned: count(notPlanned, (t) => `${t.outcome}/${t.reason}`),
      verified_contacts: targets.reduce((n, t) => n + (t.outcome === 'VERIFIED' ? t.contacts.length : 0), 0),
      coverage: count(targets.filter((t) => t.coverage), (t) => t.coverage.effect),
      data_integrity_dependencies: notPlanned.filter((t) => t.data_integrity_dependency).length,
      data_integrity_dependencies_alone_unblocking: notPlanned.filter((t) => t.data_integrity_dependency?.alone_unblocks).length,
    },
    batches: bp.batches.map((b) => ({ batch_key: b.batch_key, ...(({ targets: _t, ...s }) => s)(state.batches[b.batch_key] || { status: 'PLANNED' }) })),
    resume: { complete: bp.batches.every((b) => ['DRY_RUN_PASSED', 'APPLIED_TO_WORK', 'DONE_NO_PAGES', 'DRY_RUN_FAILED'].includes(state.batches[b.batch_key]?.status)), pending: bp.batches.filter((b) => !['DRY_RUN_PASSED', 'APPLIED_TO_WORK', 'DONE_NO_PAGES', 'DRY_RUN_FAILED'].includes(state.batches[b.batch_key]?.status)).map((b) => b.batch_key) },
    targets, not_planned: notPlanned,
  };
  report.report_digest = reportDigest(report);
  writeJson(path.join(dir, 'report.json'), report);
  fs.writeFileSync(path.join(dir, 'report.md'), markdown(report));
  bdb.close(); wdb.close();
  try { (await import('../db/client.js')).default.close(); } catch { /* already closed */ }
  for (const f of [scratch, `${scratch}-wal`, `${scratch}-shm`]) fs.rmSync(f, { force: true });
  console.log(`\nREPORT ${report.report_digest.slice(0, 16)} · ${JSON.stringify(report.totals.by_outcome)} · verified contacts ${report.totals.verified_contacts} · coverage ${JSON.stringify(report.totals.coverage)}${report.resume.complete ? '' : ` · RESUME PENDING ${report.resume.pending.length} batch(es)`}\n  ${path.join(dir, 'report.md')}\n  The source database was not written.`);
}

function markdown(r) {
  const L = [`# Programme contact acquisition — ${r.run_id}`, '', `Source \`${r.source_sha256.slice(0, 16)}\` · plan \`${r.plan_hash.slice(0, 16)}\` · season ${r.season} · report \`${r.report_digest.slice(0, 16)}\``, '',
    '**Nothing here was written to the source database.** Verified contacts are staged (and, with --apply-work, promoted) in this run\'s own work copy only.', '',
    '## Totals', '', '```json', JSON.stringify(r.totals, null, 1), '```', '', `Resume: ${r.resume.complete ? 'complete' : `pending ${r.resume.pending.join(', ')}`}`, '',
    '## Batches', '', '| batch | status | pages | refusals | ops | gates |', '|---|---|---|---|---|---|'];
  for (const b of r.batches) L.push(`| ${b.batch_key} | ${b.status} | ${b.pages ?? ''} | ${b.refusals ?? ''} | ${b.ops ?? ''} | ${b.gates ? `${Object.values(b.gates).filter(Boolean).length}/${Object.keys(b.gates).length}` : ''} |`);
  L.push('', '## Planned programmes', '', '| programme | sport | outcome | reason | verified contact | published on the page (slot×people) | coverage |', '|---|---|---|---|---|---|---|');
  for (const t of r.targets) L.push(`| ${t.programme} | ${t.sport} | ${t.outcome} | ${t.reason}${t.detail ? ` — ${String(t.detail).slice(0, 120)}` : ''} | ${t.contacts.map((c) => `${c.email} (${c.contact_role})`).join(', ')} | ${(t.published || []).map((c) => `${c.email} ${c.slot}×${c.person_count}`).join(', ')} | ${t.coverage?.effect ?? ''} |`);
  L.push('', '## Not planned', '', '| programme | sport | outcome | reason | mail domain | Data Integrity dependency |', '|---|---|---|---|---|---|');
  for (const t of r.not_planned) L.push(`| ${t.programme} | ${t.sport} | ${t.outcome} | ${t.reason} | ${t.address_domain} | ${t.data_integrity_dependency ? `${t.data_integrity_dependency.correction} (${t.data_integrity_dependency.host})${t.data_integrity_dependency.alone_unblocks ? '' : ' — not sufficient alone'}` : ''} |`);
  return `${L.join('\n')}\n`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
