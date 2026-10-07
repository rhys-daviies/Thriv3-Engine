import express from 'express';
import { programmeContactsForCollege } from '../lib/programmeContacts.js';

/**
 * A PROGRAMME'S OWN PUBLISHED INBOX, FOR THE PROGRAMME CARD — Phase 1B. GET only.
 *
 * Separate from /colleges/:id/coaches on purpose: that route lists people, this lists
 * communication endpoints, and the two never merge into one list. Every contact carries
 * kind PROGRAMME_INBOX and sendable:false; nothing here can be selected or sent to yet.
 * Sport comes off the registry row, as on the coaches route.
 */
export const programmeContactsRouter = express.Router();

programmeContactsRouter.get('/colleges/:id/programme-contacts', (req, res) => {
  try {
    const result = programmeContactsForCollege(req.params.id);
    if (!result) return res.status(404).json({ error: 'No such college.', code: 'COLLEGE_NOT_FOUND' });
    return res.json(result);
  } catch (err) {
    console.error('[colleges/programme-contacts]', err);
    return res.status(500).json({ error: 'Could not load programme contacts.' });
  }
});
