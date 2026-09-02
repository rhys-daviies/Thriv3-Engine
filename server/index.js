import 'dotenv/config';
import express from 'express';
import cors from 'cors';
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
import { renderProgramReport, reportFilename, asciiFilename } from './lib/philosophyReport.js';
import {
  generateReport, listReports, readArtifact, selectableAthletes, selectableProgrammes,
  operatorMessage,
} from './lib/reportDelivery.js';
import { poolStatus, invalidatePoolBenchmarks, poolBenchmarks } from './lib/philosophyQueries.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.resolve(__dirname, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const app = express();
app.use(cors());

// The public event collector is mounted before express.json() on purpose: it
// takes the raw body whatever Content-Type sendBeacon put on it, which the
// JSON parser would otherwise consume or reject.
app.use('/api', trackRouter);

app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(uploadsDir));

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
    res.json(await generateReport({ athleteId, collegeId }));
  } catch (err) {
    // The cause is logged; the operator sees a sentence.
    console.error('[reports/generate]', { athleteId, collegeId }, err);
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
    if (!err.status || err.status >= 500) console.error('[reports/download]', req.params.id, err);
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
 * THE ACCESS BOUNDARY, MADE REAL — Phase 13J / §27.
 *
 * This application has no authentication, deliberately: the README says
 * "no auth, single user" and the roadmap's go-live shape is one operator
 * running the engine on athletes' behalf. That is the trust boundary, and the
 * delivery surface reuses it rather than inventing an auth system.
 *
 * But `app.listen(PORT)` binds every interface, so the boundary was not
 * actually enforced — anything on the same network could read the whole API,
 * including a client's report. Binding loopback by default is what makes the
 * documented model true. `API_HOST=0.0.0.0` restores the old behaviour for a
 * deployment that puts a real authenticating proxy in front, which is the only
 * circumstance in which it should be reachable from off the machine.
 */
const PORT = process.env.API_PORT || 8787;
const HOST = process.env.API_HOST || '127.0.0.1';
app.listen(PORT, HOST, () => {
  console.log(`Thriv3 API listening on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`
    + (HOST === '0.0.0.0' ? '  (bound to every interface — there is no authentication)' : ''));

  // Said out loud either way. "Nothing schedules the sync" was true for four
  // days without anybody knowing, and silence at boot is what allowed that.
  const scheduler = startSyncScheduler();
  console.log(scheduler.started
    ? `Engagement sync scheduled every ${scheduler.intervalMinutes} minute(s).`
    : `Engagement sync NOT scheduled — ${scheduler.reason}.`);
});
