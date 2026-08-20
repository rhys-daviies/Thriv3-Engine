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
import { publicProfileHandler } from './routes/publicProfile.js';
import { syncWithEdge, isEdgeConfigured, lastSyncedAt } from './lib/edgeSync.js';
import { markResponded, clearResponded } from './lib/engagementRollup.js';

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

const PORT = process.env.API_PORT || 8787;
app.listen(PORT, () => {
  console.log(`Thriv3 API listening on http://localhost:${PORT}`);
});
