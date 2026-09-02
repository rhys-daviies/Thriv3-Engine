import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

import { Player } from './db/entities/player.js';
import { College } from './db/entities/college.js';
import { GraduatingSenior } from './db/entities/graduatingSenior.js';
import { RosterPlayer } from './db/entities/rosterPlayer.js';

import { seedD1Schools } from './routes/seedD1Schools.js';
import { importSoccerScores } from './routes/importSoccerScores.js';
import { evaluateSoccerProgram } from './routes/evaluateSoccerProgram.js';
import { buildGraduatingDatabase } from './routes/buildGraduatingDatabase.js';
import { importGraduatingCSV } from './routes/importGraduatingCSV.js';
import { exportGraduatingDatabaseCsv } from './routes/exportGraduatingDatabase.js';
import { listSchoolsByDivision } from './routes/listSchoolsByDivision.js';
import { cleanInactiveSchools } from './routes/cleanInactiveSchools.js';
import { sendEmailStub } from './routes/sendEmail.js';
import { csvAgentChat } from './routes/csvAgent.js';
import { coachingImportPreview } from './routes/coachingImportPreview.js';
import { coachingImportApply } from './routes/coachingImportApply.js';
import { trackRouter } from './routes/track.js';
import { athleteEngagement, coachSessions } from './lib/engagementQueries.js';
import { sendOutreach } from './routes/sendOutreach.js';
import { emailStatusMap } from './lib/coaches.js';
import { publicProfileHandler } from './routes/publicProfile.js';
import { publishStatus, regenerate, publish } from './routes/publish.js';
import { syncWithEdge, isEdgeConfigured, lastSyncedAt } from './lib/edgeSync.js';
import { startSyncScheduler, syncStatus } from './lib/syncScheduler.js';
import { markResponded, clearResponded } from './lib/engagementRollup.js';
import { philosophySummaries, programReportModel } from './routes/philosophy.js';
import { authRouter } from './routes/auth.js';
import {
  attachOperator, requireOperator, requireSameOrigin,
} from './lib/operatorAuth.js';
import { securityHeaders, corsPolicy } from './lib/httpSecurity.js';
import { assertRuntime, describeRuntime, resolveConfig } from './lib/runtimeConfig.js';
import { renderProgramReport, reportFilename, asciiFilename } from './lib/philosophyReport.js';
import {
  generateReport, listReports, readArtifact, selectableAthletes, selectableProgrammes,
  operatorMessage, STORE_ROOT, selectableProgramme,
} from './lib/reportDelivery.js';
import db from './db/client.js';
import { poolStatus, invalidatePoolBenchmarks, poolBenchmarks } from './lib/philosophyQueries.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/**
 * Uploaded files, which are not incidental — 13K / §19.
 *
 * `players.recommendations` stores a path into this directory, so an athlete's
 * matching analysis lives here as a file. It is therefore a persistent path
 * like the database and the report store, and in production it must be given
 * explicitly on the mounted disk; `runtimeProblems` refuses to start without
 * it. The in-tree default stays for local development.
 */
const uploadsDir = process.env.THRIV3_UPLOAD_DIR
  ? path.resolve(process.env.THRIV3_UPLOAD_DIR)
  : path.resolve(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const config = resolveConfig();
const app = express();

/**
 * Only as many proxies as are actually in front of this process — 13K / §37.
 *
 * `trust proxy` decides whether Express believes X-Forwarded-Proto (which
 * decides whether a Secure cookie can be set) and X-Forwarded-For (which
 * decides what the login rate limiter counts). Trusting every proxy means
 * trusting whatever a caller invents for both, so this is a hop count from the
 * environment: 1 on a platform that terminates TLS for you, 0 locally.
 */
if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);

// Headers first, so a response that fails later still carries them.
app.use(securityHeaders(config));

/**
 * Liveness, and the two things whose absence would make every other route
 * fail — 13K / §25.
 *
 * Public, because the host's health check calls it from outside before there
 * is any session to have. It reveals nothing: three booleans and an uptime,
 * no version, no counts, no paths.
 */
app.get('/healthz', (_req, res) => {
  const checks = { process: true, database: false, reportStore: false };
  try {
    db.prepare('SELECT 1').get();
    checks.database = true;
  } catch { /* reported as false */ }
  try {
    fs.accessSync(STORE_ROOT, fs.constants.W_OK);
    checks.reportStore = true;
  } catch { /* reported as false */ }
  const ok = Object.values(checks).every(Boolean);
  res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', checks,
    uptimeSeconds: Math.round(process.uptime()) });
});

app.use(corsPolicy(config));

// The public event collector is mounted before express.json() on purpose: it
// takes the raw body whatever Content-Type sendBeacon put on it, which the
// JSON parser would otherwise consume or reject.
//
// It is also mounted before the authentication boundary below, deliberately:
// it is called by athlete pages in coaches' browsers, identifies nobody, and
// answers 204 to everything. See the route's own header.
app.use('/api', trackRouter);

app.use(express.json({ limit: '10mb' }));

/**
 * ---- THE AUTHENTICATION BOUNDARY — Phase 13K ------------------------------
 *
 * Everything below this point is the internal operator application, and all of
 * it requires a session. Phase 13J made the documented "one operator, one
 * machine" model true by binding loopback; hosting it makes that impossible,
 * so the boundary has to be in the application.
 *
 * THE ORDER IS THE SECURITY.
 *
 *   attachOperator      reads the session cookie; sets req.operator or nothing
 *   requireSameOrigin   refuses a state-changing request from another origin
 *   authRouter          login / logout / me — the only unauthenticated /api
 *   requireOperator     everything after this line needs a session
 *
 * `requireOperator` is a single `app.use` rather than a decoration on each
 * route on purpose: a route added later is protected by default, and forgetting
 * to protect one is the failure this whole phase exists to prevent. The two
 * public surfaces — the collector above, and the athlete pages at the bottom of
 * this file — are outside `/api` or mounted before it, and an invariant checks
 * that the list of unauthenticated routes is exactly those.
 */
app.use(attachOperator);
app.use('/api', requireSameOrigin);
app.use('/api', authRouter);
app.use('/api', requireOperator);

// Uploaded match-recommendation files are internal data, so the static mount
// is behind the boundary like everything else.
app.use('/uploads', requireOperator, express.static(uploadsDir));

const ENTITIES = {
  players: Player,
  colleges: College,
  graduating_seniors: GraduatingSenior,
  roster_players: RosterPlayer,
};

function parseQuery(reqQuery) {
  const { _sort, _limit, ...filters } = reqQuery;
  return { filters, sort: _sort, limit: _limit ? Number(_limit) : undefined };
}

app.get('/api/entities/:table', (req, res) => {
  const entity = ENTITIES[req.params.table];
  if (!entity) return res.status(404).json({ error: 'Unknown entity' });
  const { filters, sort, limit } = parseQuery(req.query);
  const rows = Object.keys(filters).length > 0 ? entity.filter(filters, sort, limit) : entity.list(sort, limit);
  res.json(rows);
});

app.get('/api/entities/:table/:id', (req, res) => {
  const entity = ENTITIES[req.params.table];
  if (!entity) return res.status(404).json({ error: 'Unknown entity' });
  const row = entity.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

app.post('/api/entities/:table', (req, res) => {
  const entity = ENTITIES[req.params.table];
  if (!entity) return res.status(404).json({ error: 'Unknown entity' });
  res.json(entity.create(req.body));
});

app.put('/api/entities/:table/:id', (req, res) => {
  const entity = ENTITIES[req.params.table];
  if (!entity) return res.status(404).json({ error: 'Unknown entity' });
  res.json(entity.update(req.params.id, req.body));
});

app.delete('/api/entities/:table/:id', (req, res) => {
  const entity = ENTITIES[req.params.table];
  if (!entity) return res.status(404).json({ error: 'Unknown entity' });
  res.json(entity.delete(req.params.id));
});

// ---- Backend functions ----

app.post('/api/functions/exportGraduatingDatabase', (req, res) => {
  try {
    const csv = exportGraduatingDatabaseCsv(req.body || {});
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="graduating_database_2025.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Programme philosophy ----
//
// The PDF routes are registered here rather than in the FUNCTIONS registry
// because that dispatcher calls res.json() unconditionally, and a Buffer
// through res.json() serialises as {"type":"Buffer","data":[37,80,...]} —
// roughly triple the size, saved with a .pdf name, and only discovered when
// somebody tries to open the file.

/** A filename a header can carry: these school names include quotes and parens. */
/**
 * Both forms of the filename — 13I / §17.
 *
 * `filename=` has to be ASCII, so it carries `asciiFilename`, which replaces
 * what it cannot represent rather than deleting it: the previous helper mapped
 * every non-ASCII character to a space, which turned "Zoё" into "Zo " and quietly
 * renamed the athlete on the file a client saves. `filename*=` carries the exact
 * name in the RFC 5987 form, and every current browser prefers it.
 */
function sendPdf(res, buffer, filename) {
  const ascii = asciiFilename(filename).replace(/["\\]/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition',
    `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader('Content-Length', buffer.length);
  res.send(buffer);
}

app.get('/api/philosophy/pool', (req, res) => {
  try {
    res.json(poolStatus());
  } catch (err) {
    console.error('[philosophy/pool]', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/philosophy/pool/rebuild', (req, res) => {
  try {
    const cleared = invalidatePoolBenchmarks();
    const sport = (req.body || {}).sport || 'mens-soccer';
    poolBenchmarks(sport);
    res.json({ cleared, rebuilt: sport, ...poolStatus() });
  } catch (err) {
    console.error('[philosophy/pool/rebuild]', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/players/:playerId/philosophy/summaries', (req, res) => {
  try {
    res.json(philosophySummaries({
      playerId: req.params.playerId,
      collegeIds: (req.body || {}).collegeIds,
    }));
  } catch (err) {
    console.error('[philosophy/summaries]', err);
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/philosophy/:collegeId/report.pdf', async (req, res) => {
  try {
    const model = programReportModel({ collegeId: req.params.collegeId });
    sendPdf(res, await renderProgramReport(model), reportFilename(model));
  } catch (err) {
    console.error('[philosophy/report.pdf]', err);
    res.status(/^Unknown college/.test(err.message) ? 404 : 500).json({ error: err.message });
  }
});

app.get('/api/players/:playerId/philosophy/:collegeId/report.pdf', async (req, res) => {
  try {
    const model = programReportModel({
      collegeId: req.params.collegeId, playerId: req.params.playerId,
    });
    sendPdf(res, await renderProgramReport(model), reportFilename(model));
  } catch (err) {
    console.error('[philosophy/report.pdf]', err);
    const status = /^Unknown (college|player)/.test(err.message) ? 404
      : / plays /.test(err.message) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * ---- Report delivery — Phase 13J ------------------------------------------
 *
 * The operator workflow around the frozen report: pick, generate, download,
 * and see what has been generated before. Four routes and no more.
 *
 * The two `report.pdf` endpoints above are unchanged and remain the direct
 * path. These persist an immutable artefact and a history row as well, which
 * is the difference between "I looked at a report" and "this is the document
 * we sent".
 */
app.get('/api/reports/athletes', (req, res) => {
  try {
    res.json(selectableAthletes({ query: req.query.q, limit: req.query.limit }));
  } catch (err) {
    console.error('[reports/athletes]', err);
    res.status(500).json({ error: 'The athlete list could not be read.' });
  }
});

app.get('/api/reports/programmes', (req, res) => {
  try {
    res.json(selectableProgrammes({
      query: req.query.q, sport: req.query.sport || null, limit: req.query.limit,
    }));
  } catch (err) {
    console.error('[reports/programmes]', err);
    res.status(500).json({ error: 'The programme list could not be read.' });
  }
});

/**
 * One programme by id, for the link from the Program Philosophy tab — 13K.
 * Answers 404 rather than an unselectable row when the sport does not match.
 */
app.get('/api/reports/programmes/:id', (req, res) => {
  try {
    const row = selectableProgramme({ id: req.params.id, sport: req.query.sport || null });
    if (!row) return res.status(404).json({ error: 'That programme is not on file.' });
    return res.json(row);
  } catch (err) {
    console.error('[reports/programme]', err);
    return res.status(500).json({ error: 'That programme could not be read.' });
  }
});

app.get('/api/reports', (req, res) => {
  try {
    res.json(listReports({
      athleteId: req.query.athleteId || null,
      collegeId: req.query.collegeId || null,
      limit: req.query.limit,
    }));
  } catch (err) {
    console.error('[reports/list]', err);
    res.status(500).json({ error: 'The report history could not be read.' });
  }
});

/**
 * One explicit generation. Never triggered by selection alone — the client
 * posts this because an operator pressed the button.
 */
app.post('/api/reports', async (req, res) => {
  const { athleteId = null, collegeId } = req.body || {};
  try {
    if (!collegeId) return res.status(400).json({ error: 'Choose a programme first.' });
    // The signed-in operator is recorded on the artefact — 13K / §32. Taken
    // from the session, never from the request body: a client that could name
    // the operator could name somebody else.
    const row = await generateReport({ athleteId, collegeId, operator: req.operator });
    console.log('[reports/generate]', {
      report: row.id, operator: req.operator?.email, pages: row.pages, status: row.status,
    });
    res.json(row);
  } catch (err) {
    // The cause is logged; the operator sees a sentence.
    console.error('[reports/generate]', { athleteId, collegeId, operator: req.operator?.email }, err);
    res.status(err.status ?? 500).json({ error: err.message || operatorMessage(err) });
  }
});

/**
 * The artefact, resolved server-side from the generation id. The store is
 * never served statically — this is the only way out of it.
 */
app.get('/api/reports/:id/download', (req, res) => {
  try {
    const { bytes, filename } = readArtifact(req.params.id);
    sendPdf(res, bytes, filename);
  } catch (err) {
    // Every refused download is logged — a 400 from a crafted id and a 410
    // from a missing artefact are both things somebody needs to see — but only
    // a real fault carries the stack.
    if (!err.status || err.status >= 500) console.error('[reports/download]', req.params.id, err);
    else {
      console.warn('[reports/download] refused', {
        report: req.params.id, status: err.status, operator: req.operator?.email,
      });
    }
    res.status(err.status ?? 500).json({ error: err.message || 'That report could not be read.' });
  }
});

// ---- Coaching Contacts Import (reusable, re-runnable against future CSVs) ----

app.post('/api/coaching-import/preview', async (req, res) => {
  try {
    const result = await coachingImportPreview(req.body || {});
    res.json(result);
  } catch (err) {
    console.error('[coaching-import/preview]', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/coaching-import/apply', async (req, res) => {
  try {
    const result = await coachingImportApply(req.body || {});
    res.json(result);
  } catch (err) {
    console.error('[coaching-import/apply]', err);
    res.status(500).json({ error: err.message });
  }
});

const FUNCTIONS = {
  seedD1Schools,
  importSoccerScores,
  evaluateSoccerProgram,
  buildGraduatingDatabase,
  importGraduatingCSV,
  listSchoolsByDivision,
  cleanInactiveSchools,
};

app.post('/api/functions/:name', async (req, res) => {
  const fn = FUNCTIONS[req.params.name];
  if (!fn) return res.status(404).json({ error: `Unknown function: ${req.params.name}` });
  try {
    const result = await fn(req.body || {});
    res.json(result);
  } catch (err) {
    console.error(`[${req.params.name}]`, err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Uploads (UploadFile integration replacement) ----

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

app.post('/api/uploads', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  const filename = `${randomUUID()}-${req.file.originalname}`;
  fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
  res.json({ file_url: `/uploads/${filename}` });
});

// ---- SendEmail integration replacement (stub) ----

app.post('/api/send-email', async (req, res) => {
  const result = await sendEmailStub(req.body || {});
  res.json(result);
});

// ---- CSV specialist chat agent ----

app.post('/api/csv-agent/chat', async (req, res) => {
  try {
    const result = await csvAgentChat(req.body || {});
    res.json(result);
  } catch (err) {
    console.error('[csv-agent]', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Publishing an athlete's public page ----

app.get('/api/players/:id/publish', (req, res) => {
  try {
    res.json(publishStatus(req.params.id, req));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.post('/api/players/:id/regenerate', (req, res) => {
  try {
    res.json(regenerate(req.params.id, req));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/players/:id/publish', async (req, res) => {
  try {
    res.json(await publish(req.params.id, req));
  } catch (err) {
    console.error('[publish]', err);
    res.status(400).json({ error: err.message });
  }
});

// ---- Coach contacts ----

// Provenance for every address we hold, so the composer can warn before a
// send rather than after a bounce. Keyed on the address; see emailStatusMap.
app.get('/api/coaches/email-status', (req, res) => {
  try {
    res.json(emailStatusMap(req.query.sport || null));
  } catch (err) {
    console.error('[coaches/email-status]', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Outreach: create tokens and hand messages to Outlook ----

app.post('/api/outreach/send', async (req, res) => {
  try {
    res.json(await sendOutreach(req.body || {}));
  } catch (err) {
    console.error('[outreach/send]', err);
    res.status(400).json({ error: err.message });
  }
});

// ---- Edge sync ----

app.get('/api/engagement/sync', (req, res) => {
  res.json({ configured: isEdgeConfigured(), lastSyncedAt: lastSyncedAt() });
});

app.post('/api/engagement/sync', async (req, res) => {
  if (!isEdgeConfigured()) {
    return res.status(400).json({ error: 'Edge collector is not configured (THRIV3_EDGE_URL / THRIV3_SYNC_SECRET)' });
  }
  try {
    res.json(await syncWithEdge());
  } catch (err) {
    console.error('[sync]', err);
    res.status(502).json({ error: err.message });
  }
});

// ---- Coach engagement (Tab 3) ----
//
// Reads engagement_rollup and the qualified sessions behind it. No endpoint
// here exposes a raw pageview.

app.get('/api/engagement/athlete/:id', (req, res) => {
  try {
    res.json(athleteEngagement(req.params.id));
  } catch (err) {
    console.error('[engagement]', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/engagement/outreach/:id/sessions', (req, res) => {
  try {
    res.json(coachSessions(req.params.id));
  } catch (err) {
    console.error('[engagement]', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/engagement/outreach/:id/responded', (req, res) => {
  try {
    const responded = req.body?.responded !== false;
    res.json(responded ? markResponded(req.params.id) : clearResponded(req.params.id));
  } catch (err) {
    console.error('[engagement]', err);
    res.status(500).json({ error: err.message });
  }
});

// ---- Public athlete profile pages ----
//
// Generated by `npm run export:profiles` into build/public. Served here so the
// tracker runs over http (the YouTube IFrame API will not initialise on a
// file:// origin). This surface is deliberately separate from the staff app:
// no session, no nav, nothing but the athlete's own page.
const publicDir = path.resolve(__dirname, '../build/public');

// Gated ahead of the static mount so a revoked link cannot be served straight
// off disk.
app.get('/p/:slug', publicProfileHandler);
app.use(express.static(publicDir));

// Read by the app so staleness is visible where the data is, rather than
// only in a terminal nobody is looking at.
app.get('/api/engagement/sync/status', (req, res) => res.json(syncStatus()));

/**
 * An unmatched API path is an API answer — 13K.
 *
 * Without this it falls through to the single-page fallback below and returns
 * the operator app's HTML with a 200, so a typo in a route name reaches the
 * client as an unexplained JSON parse error rather than as a 404.
 */
app.use('/api', (req, res) => res.status(404).json({ error: 'No such endpoint.' }));

/**
 * ---- The built operator app — Phase 13K -----------------------------------
 *
 * In development Vite serves the app on its own port and proxies /api here, so
 * this does nothing. In the hosted shape one process serves both, which is
 * what makes the app and its API the same origin: no CORS, no second host, no
 * cookie that has to work cross-site.
 *
 * The shell is public. It has to be — it is what draws the sign-in screen —
 * and it contains no data: every byte of athlete information comes from the
 * API, which is behind the boundary above.
 */
if (config.clientDir) {
  const clientDir = path.resolve(config.clientDir);
  app.use(express.static(clientDir, {
    // The hashed asset filenames Vite emits may be cached hard; index.html
    // must not be, or a deploy leaves browsers on the previous bundle.
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  // Client-side routing: /player/x/reports is a route in the browser, not a
  // file on disk. Everything unmatched and not an API call gets the shell.
  app.get('*', (req, res, next) => {
    if (req.method !== 'GET') return next();
    return res.sendFile(path.join(clientDir, 'index.html'));
  });
}

/**
 * THE ACCESS BOUNDARY — 13J made it real, 13K moved it into the application.
 *
 * 13J bound loopback because there was no authentication and the documented
 * model was one operator on one machine. That default survives: a process
 * reachable from the network is now the result of somebody setting API_HOST,
 * and it is only safe because everything above requires a session.
 *
 * `assertRuntime` is what stops a hosted process starting half-configured — no
 * session secret, an ephemeral database path, an http origin — by exiting with
 * the list of problems rather than serving.
 */
const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  assertRuntime({ env: process.env });

  app.listen(config.port, config.host, () => {
    console.log(`Thriv3 API listening on http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
    console.log(`  ${describeRuntime(config)}`);

    // Said out loud either way. "Nothing schedules the sync" was true for four
    // days without anybody knowing, and silence at boot is what allowed that.
    const scheduler = startSyncScheduler();
    console.log(scheduler.started
      ? `Engagement sync scheduled every ${scheduler.intervalMinutes} minute(s).`
      : `Engagement sync NOT scheduled — ${scheduler.reason}.`);
  });
}

/**
 * Exported so a test can bind it to an ephemeral port and exercise the real
 * middleware chain — the authentication boundary, the CSRF check, the headers
 * — rather than a reconstruction of it. The chain is the thing under test, and
 * a test that builds its own app tests something else.
 */
export default app;
