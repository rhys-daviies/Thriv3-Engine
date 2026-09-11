import express from 'express';
import db from '../db/client.js';
import { findCanonicalCollege } from '../lib/collegeSearch.js';

/**
 * THE COACHING STAFF AT ONE PROGRAMME, FROM THE REGISTRY.
 *
 * Manual outreach needs contacts for a school that may never have appeared in
 * an athlete's Top 100, so it cannot read them where the match card does.
 * `graduating_seniors.coaching_staff` is a JSON blob copied onto each
 * recommendation by the matching run: it exists only for programmes that
 * matched, it carries no provenance, and nothing keeps it in step with the
 * `coaches` table that outreach actually writes against. `findOrCreateCoach`
 * resolves every send into `coaches` anyway, so composing from the blob means
 * composing against one list and sending against another.
 *
 * This reads `coaches` — the same rows `pursuitPolicy` plans from and
 * `outreach.coach_id` points at — and carries `email_status`, which the blob
 * has no equivalent for and which is the only thing on a contact that says
 * whether the address has ever been seen to work.
 *
 * ---------------------------------------------------------------------------
 * SCOPED BY (school, sport), AND THE SPORT IS NOT OPTIONAL.
 *
 * The URL is `/api/colleges/:id/coaches` because a canonical college id names
 * one (name, sport) pair already — `colleges` has a UNIQUE index on exactly
 * that — so the id carries the sport with it and there is nothing for a caller
 * to get wrong. Passing an athlete id instead was the alternative and is
 * worse: it would make a contact list depend on who was looking at it, which
 * is true of a relationship and is not true of a coaching staff.
 * ---------------------------------------------------------------------------
 */

export const programmeCoachesRouter = express.Router();

/**
 * Usable means AN ADDRESS WE COULD ACTUALLY SEND TO.
 *
 * `N/A` is filtered because it is a literal value in this data rather than a
 * null — the match card filters it the same way, and a contact whose address
 * is the string "N/A" would be offered, selected, and refused at the transport.
 */
const STAFF = db.prepare(`
  SELECT id, full_name, email, school, division, sport, position_title, email_status
    FROM coaches
   WHERE school = @school AND sport = @sport
     AND email IS NOT NULL AND trim(email) != '' AND upper(trim(email)) != 'N/A'
   ORDER BY id
`);

/**
 * The shape EmailComposer already reads, plus what it could not know before.
 *
 * `name`, `email` and `title` are the three fields the composer and
 * `pickBestContact` use, named as the recommendation blob names them so the
 * composer needs no adapter. `coach_id` and `email_status` are additions: the
 * first is the identity a send resolves to anyway, the second is provenance
 * the blob never carried.
 */
function contact(row) {
  return {
    coach_id: row.id,
    name: row.full_name,
    email: row.email,
    title: row.position_title,
    email_status: row.email_status ?? null,
  };
}

programmeCoachesRouter.get('/colleges/:id/coaches', (req, res) => {
  try {
    /**
     * Sport comes off the registry row, not off the query string. A caller
     * that could name the sport could name one the college does not field and
     * get an empty list that looked like a programme with no staff.
     */
    const college = db.prepare(
      'SELECT id, name, sport, division, active FROM colleges WHERE id = ?',
    ).get(req.params.id);

    if (!college) {
      return res.status(404).json({ error: 'No such college.', code: 'COLLEGE_NOT_FOUND' });
    }

    /**
     * INACTIVE PROGRAMMES ARE STILL READABLE HERE, unlike in the search that
     * feeds the picker. A relationship made while a programme was active is a
     * real relationship, and refusing to show its staff would leave an
     * operator unable to see who they had already written to. What an inactive
     * programme must not do is be SELECTED into a new relationship, and
     * `findCanonicalCollege` is what enforces that, where it belongs.
     */
    const rows = STAFF.all({ school: college.name, sport: college.sport });
    return res.json({
      college: {
        id: college.id,
        name: college.name,
        sport: college.sport,
        division: college.division,
        active: college.active,
      },
      coaches: rows.map(contact),
    });
  } catch (err) {
    console.error('[colleges/coaches]', err);
    return res.status(500).json({ error: 'Unexpected error.' });
  }
});

/** Exported for the manual outreach route, which needs the same rows server-side. */
export function programmeCoaches({ collegeName, sport }) {
  return STAFF.all({ school: collegeName, sport }).map(contact);
}

export { findCanonicalCollege };
