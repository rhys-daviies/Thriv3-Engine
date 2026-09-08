import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { UPLOADS_DIR, resolveUploadDestination } from '../lib/uploadPath.js';

/**
 * The UploadFile integration replacement — one endpoint, one caller.
 *
 * `src/pages/player/PlayerWorkspace.jsx` posts a match analysis here after
 * ranking, stores the returned `file_url` in `players.recommendations`, and
 * fetches it back from the static mount. `server/lib/campaigns.js` reads the
 * same file when a campaign freezes that analysis.
 *
 * MOVED OUT OF server/index.js so the destination logic can be tested through
 * the route rather than only through the helper. A helper can be correct while
 * a route quietly bypasses it, and the flaw this replaces was exactly a
 * filename decision made inline where nothing could reach it. See
 * `server/lib/uploadPath.js` for the containment invariant.
 *
 * Memory storage, so multer itself never writes to disk: the only write is the
 * one below, at a destination that has been proved to sit inside the store.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

export const uploadsRouter = express.Router();

uploadsRouter.post('/uploads', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });
  try {
    const { destination, fileUrl } = resolveUploadDestination(req.file.originalname);
    // The store is created at boot, but a test directory or a cleaned-up
    // deployment may not have it, and failing to write is worse than a mkdir.
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    fs.writeFileSync(destination, req.file.buffer);
    return res.json({ file_url: fileUrl });
  } catch (err) {
    // Only reachable if the containment check refuses, which means the
    // sanitiser has been weakened. A 400 with no path in it.
    return res.status(400).json({ error: err.message });
  }
});
