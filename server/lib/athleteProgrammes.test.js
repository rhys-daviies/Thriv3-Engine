import { describe, it, expect, beforeEach } from 'vitest';
import db from '../db/client.js';
import {
  listAthleteProgrammes, getAthleteProgramme, findRelationship,
  upsertAthleteProgramme as upsertRaw, updateAthleteProgramme,
} from './athleteProgrammes.js';

/**
 * The upsert answers `{ programme, created }`. Most tests here are about the
 * row, so they unwrap it; the block on one-row-per-programme asserts the flag
 * itself.
 */
const upsertAthleteProgramme = (athleteId, fields) => upsertRaw(athleteId, fields).programme;

/**
 * The relationship model, exercised through the module that owns it.
 *
 * Two properties carry the most weight here and neither is about a happy path:
 *
 *   IDENTITY IS THE REGISTRY'S. A relationship can only ever name a college
 *   that exists, in the athlete's sport, and active. There is no arrangement
 *   of fields that gets a school name into this table without a registry row
 *   behind it.
 *
 *   NOTHING REACHES `suppressions`. That table is keyed on email with no
 *   athlete column, so a row in it silences an address for EVERY athlete. The
 *   final block asserts its contents are untouched by every write here.
 */

const ATHLETE = 'a-rel';
const OTHER = 'a-rel-other';
const WOMENS = 'a-rel-womens';

let seq = 0;
function college({ name, sport = 'mens-soccer', active = 1 }) {
  const id = `col-${++seq}`;
  db.prepare(`
    INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, active)
    VALUES (?, '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z', ?, ?, 'NCAA D1', 'ACC', ?)
  `).run(id, name, sport, active);
  return id;
}

function insertAthlete(id, sport = 'mens-soccer') {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport)
    VALUES (?, '2026-09-11T00:00:00.000Z', '2026-09-11T00:00:00.000Z', ?, 'MIDFIELD', ?)
  `).run(id, `Athlete ${id}`, sport);
}

let duke;
beforeEach(() => {
  db.exec('DELETE FROM athlete_programmes; DELETE FROM suppressions; DELETE FROM colleges; DELETE FROM players;');
  insertAthlete(ATHLETE);
  insertAthlete(OTHER);
  insertAthlete(WOMENS, 'womens-soccer');
  duke = college({ name: 'Duke' });
});

// ---------------------------------------------------------------------------

describe('creating a relationship', () => {
  it('creates one for a canonical college', () => {
    const row = upsertAthleteProgramme(ATHLETE, { college_id: duke });
    expect(row).toMatchObject({
      athlete_id: ATHLETE,
      college_name: 'Duke',
      sport: 'mens-soccer',
      college_id: duke,
      request_state: 'none',
      flagged: false,
      visibility: 'default',
      contact_stance: 'default',
      note: null,
    });
    expect(row.id).toBeTruthy();
    expect(row.created_at).toBe(row.updated_at);
  });

  it('copies the name from the registry, so a caller cannot supply one', () => {
    // The library ignores anything but `college_id`; the router refuses a
    // `college_name` outright. Both layers, because either alone is one
    // refactor away from being the only one.
    const row = upsertAthleteProgramme(ATHLETE, { college_id: duke, college_name: 'Duke Universty' });
    expect(row.college_name).toBe('Duke');
  });

  it('refuses a relationship with no college named at all', () => {
    expect(() => upsertAthleteProgramme(ATHLETE, {})).toThrowError(/must name a college_id/);
    expect(() => upsertAthleteProgramme(ATHLETE, { college_id: '  ' })).toThrowError(/must name a college_id/);
  });

  it('refuses arbitrary free text as an identity', () => {
    // The failure mode this guards: a school typed into a box, stored, and
    // joining to nothing for the rest of its life.
    for (const bogus of ['Hogwarts', 'Duke', 'Duke University', 'col-does-not-exist']) {
      expect(() => upsertAthleteProgramme(ATHLETE, { college_id: bogus }))
        .toThrowError(/in the registry/);
    }
    expect(listAthleteProgrammes(ATHLETE)).toEqual([]);
  });

  it('refuses an unknown athlete', () => {
    expect(() => upsertAthleteProgramme('nobody', { college_id: duke })).toThrowError(/No athlete/);
  });

  it('refuses a college from another sport, and says which', () => {
    const womensDuke = college({ name: 'Duke', sport: 'womens-soccer' });
    try {
      upsertAthleteProgramme(ATHLETE, { college_id: womensDuke });
      throw new Error('should have refused');
    } catch (err) {
      expect(err.code).toBe('COLLEGE_SPORT_MISMATCH');
      expect(err.message).toMatch(/womens-soccer.*mens-soccer/);
    }
  });

  it('refuses an inactive programme, distinctly from a missing one', () => {
    const closed = college({ name: 'Closed Athletics', active: 0 });
    try {
      upsertAthleteProgramme(ATHLETE, { college_id: closed });
      throw new Error('should have refused');
    } catch (err) {
      expect(err.code).toBe('COLLEGE_INACTIVE');
    }
  });

  it('refuses when the athlete has no sport to resolve against', () => {
    db.prepare('UPDATE players SET sport = NULL WHERE id = ?').run(ATHLETE);
    expect(() => upsertAthleteProgramme(ATHLETE, { college_id: duke })).toThrowError(/no sport/);
  });
});

describe('one row per athlete per programme', () => {
  it('upserts rather than duplicating, and says which it did', () => {
    const first = upsertRaw(ATHLETE, { college_id: duke });
    expect(first.created).toBe(true);

    const wrapped = upsertRaw(ATHLETE, { college_id: duke, flagged: true, flag_reason: 'club connection' });
    // Not re-derived by the caller: `created_at === updated_at` is true for an
    // upsert that changed nothing, so guessing from the row is wrong.
    expect(wrapped.created).toBe(false);

    const { programme: second } = wrapped;
    expect(second.id).toBe(first.programme.id);
    expect(listAthleteProgrammes(ATHLETE)).toHaveLength(1);
    expect(second.flagged).toBe(true);

    const count = db.prepare(
      'SELECT COUNT(*) c FROM athlete_programmes WHERE athlete_id = ? AND college_name = ? AND sport = ?',
    ).get(ATHLETE, 'Duke', 'mens-soccer').c;
    expect(count).toBe(1);
  });

  it('refuses a duplicate at the database level too', () => {
    const row = upsertAthleteProgramme(ATHLETE, { college_id: duke });
    expect(() => db.prepare(`
      INSERT INTO athlete_programmes (id, athlete_id, college_name, sport, college_id,
        request_state, flagged, visibility, contact_stance, created_at, updated_at)
      VALUES ('forced', ?, 'Duke', 'mens-soccer', ?, 'none', 0, 'default', 'default', 'x', 'x')
    `).run(ATHLETE, duke)).toThrowError(/UNIQUE/);
    expect(listAthleteProgrammes(ATHLETE)).toHaveLength(1);
    expect(row.college_name).toBe('Duke');
  });

  it('lets two athletes hold a relationship with the same programme', () => {
    const mine = upsertAthleteProgramme(ATHLETE, { college_id: duke, flagged: true, flag_reason: 'visited' });
    const theirs = upsertAthleteProgramme(OTHER, { college_id: duke });

    expect(mine.id).not.toBe(theirs.id);
    expect(mine.flagged).toBe(true);
    // The other athlete's view of the same programme is untouched. This is the
    // whole reason the state is here rather than on `colleges`.
    expect(theirs.flagged).toBe(false);
    expect(listAthleteProgrammes(ATHLETE)).toHaveLength(1);
    expect(listAthleteProgrammes(OTHER)).toHaveLength(1);
  });

  it('keeps the same school in two sports apart', () => {
    const womensDuke = college({ name: 'Duke', sport: 'womens-soccer' });
    upsertAthleteProgramme(ATHLETE, { college_id: duke });
    upsertAthleteProgramme(WOMENS, { college_id: womensDuke });

    expect(findRelationship(ATHLETE, 'Duke', 'mens-soccer')).toBeTruthy();
    expect(findRelationship(ATHLETE, 'Duke', 'womens-soccer')).toBeNull();
    expect(findRelationship(WOMENS, 'Duke', 'womens-soccer')).toBeTruthy();
  });

  it('dies with the athlete', () => {
    upsertAthleteProgramme(ATHLETE, { college_id: duke });
    db.prepare('DELETE FROM players WHERE id = ?').run(ATHLETE);
    expect(db.prepare('SELECT COUNT(*) c FROM athlete_programmes').get().c).toBe(0);
  });
});

describe('the three states are three states', () => {
  it('records a specific request with who asked and when', () => {
    const row = upsertAthleteProgramme(ATHLETE, {
      college_id: duke, request_state: 'requested', requested_by: 'family',
    });
    expect(row.request_state).toBe('requested');
    expect(row.requested_by).toBe('family');
    expect(row.requested_at).toBeTruthy();
    // A request says nothing about visibility or contact.
    expect(row.visibility).toBe('default');
    expect(row.contact_stance).toBe('default');
    expect(row.flagged).toBe(false);
  });

  it('requires who asked, following the campaign reason convention', () => {
    expect(() => upsertAthleteProgramme(ATHLETE, { college_id: duke, request_state: 'requested' }))
      .toThrowError(/who asked/);
  });

  it('keeps who asked and when after a request is withdrawn', () => {
    const id = upsertAthleteProgramme(ATHLETE, {
      college_id: duke, request_state: 'requested', requested_by: 'athlete',
    }).id;
    const withdrawn = updateAthleteProgramme(ATHLETE, id, { request_state: 'withdrawn' });
    expect(withdrawn.request_state).toBe('withdrawn');
    // A withdrawn request that forgets it was ever made is indistinguishable
    // from one never made.
    expect(withdrawn.requested_by).toBe('athlete');
    expect(withdrawn.requested_at).toBeTruthy();
  });

  it('does not re-date a request that was already made', () => {
    const first = upsertAthleteProgramme(ATHLETE, {
      college_id: duke, request_state: 'requested', requested_by: 'athlete',
    });
    const again = updateAthleteProgramme(ATHLETE, first.id, {
      request_state: 'requested', requested_by: 'operator',
    });
    expect(again.requested_at).toBe(first.requested_at);
    expect(again.requested_by).toBe('operator');
  });

  it('flags with a reason, and refuses a flag without one', () => {
    expect(() => upsertAthleteProgramme(ATHLETE, { college_id: duke, flagged: true }))
      .toThrowError(/what the relationship is/);
    expect(() => upsertAthleteProgramme(ATHLETE, { college_id: duke, flagged: true, flag_reason: '   ' }))
      .toThrowError(/what the relationship is/);

    const row = upsertAthleteProgramme(ATHLETE, {
      college_id: duke, flagged: true, flag_reason: 'assistant coaches her club side',
    });
    expect(row.flagged).toBe(true);
    expect(row.flag_reason).toBe('assistant coaches her club side');
    expect(row.flagged_at).toBeTruthy();
  });

  it('flagging changes neither visibility nor contact stance', () => {
    const row = upsertAthleteProgramme(ATHLETE, {
      college_id: duke, flagged: true, flag_reason: 'family friend',
    });
    // Three columns because they are three decisions. A flag is a fact about
    // the world; it does not hide the programme and it does not silence it.
    expect(row.visibility).toBe('default');
    expect(row.contact_stance).toBe('default');
  });

  it('clears the reason and the timestamp together when unflagged', () => {
    const id = upsertAthleteProgramme(ATHLETE, {
      college_id: duke, flagged: true, flag_reason: 'visited on tour',
    }).id;
    const cleared = updateAthleteProgramme(ATHLETE, id, { flagged: false });
    expect(cleared.flagged).toBe(false);
    // A stale reason under flagged = 0 reads as a flag in every list view.
    expect(cleared.flag_reason).toBeNull();
    expect(cleared.flagged_at).toBeNull();
  });

  it('refuses to empty the reason of a still-flagged relationship', () => {
    const id = upsertAthleteProgramme(ATHLETE, {
      college_id: duke, flagged: true, flag_reason: 'visited on tour',
    }).id;
    expect(() => updateAthleteProgramme(ATHLETE, id, { flag_reason: null }))
      .toThrowError(/Unflag it instead/);
  });

  it('records suppression as visibility, on its own', () => {
    const row = upsertAthleteProgramme(ATHLETE, { college_id: duke, visibility: 'suppressed' });
    expect(row.visibility).toBe('suppressed');
    expect(row.flagged).toBe(false);
    expect(row.contact_stance).toBe('default');
  });

  it('records a contact stance, on its own', () => {
    const row = upsertAthleteProgramme(ATHLETE, { college_id: duke, contact_stance: 'do_not_contact' });
    expect(row.contact_stance).toBe('do_not_contact');
    expect(row.visibility).toBe('default');
    expect(row.flagged).toBe(false);
  });

  it('refuses a value outside each bounded set', () => {
    const cases = [
      [{ request_state: 'maybe' }, 'INVALID_REQUEST_STATE'],
      [{ request_state: 'requested', requested_by: 'coach' }, 'INVALID_REQUESTED_BY'],
      [{ visibility: 'hidden' }, 'INVALID_VISIBILITY'],
      [{ contact_stance: 'never' }, 'INVALID_CONTACT_STANCE'],
      [{ flagged: 'yes' }, 'INVALID_FLAG'],
      [{ flagged: 1 }, 'INVALID_FLAG'],
      [{ note: 42 }, 'INVALID_FIELD'],
    ];
    for (const [fields, code] of cases) {
      try {
        upsertAthleteProgramme(ATHLETE, { college_id: duke, ...fields });
        throw new Error(`should have refused ${JSON.stringify(fields)}`);
      } catch (err) {
        expect(err.code).toBe(code);
      }
    }
  });
});

describe('the note', () => {
  it('is mutable current state, stamped when it changes', () => {
    const first = upsertAthleteProgramme(ATHLETE, { college_id: duke, note: 'Spoke at the showcase' });
    expect(first.note).toBe('Spoke at the showcase');
    expect(first.note_updated_at).toBeTruthy();

    const second = updateAthleteProgramme(ATHLETE, first.id, { note: 'Replied 12 Sept' });
    expect(second.note).toBe('Replied 12 Sept');
    // No history: there is no operator identity to attribute one to. See the
    // note on this column in server/db/schema.sql.
    expect(second.note_updated_at).toBeTruthy();
  });

  it('clears to null, timestamp and all', () => {
    const id = upsertAthleteProgramme(ATHLETE, { college_id: duke, note: 'x' }).id;
    const cleared = updateAthleteProgramme(ATHLETE, id, { note: '  ' });
    expect(cleared.note).toBeNull();
    expect(cleared.note_updated_at).toBeNull();
  });
});

describe('updating', () => {
  it('refuses a relationship that is not this athlete’s', () => {
    const mine = upsertAthleteProgramme(ATHLETE, { college_id: duke });
    expect(() => updateAthleteProgramme(OTHER, mine.id, { visibility: 'suppressed' }))
      .toThrowError(/No programme relationship/);
    expect(getAthleteProgramme(ATHLETE, mine.id).visibility).toBe('default');
  });

  it('refuses an unknown relationship id', () => {
    expect(() => updateAthleteProgramme(ATHLETE, 'nope', { note: 'x' }))
      .toThrowError(/No programme relationship/);
  });

  it('does not claim something happened when nothing was asked', () => {
    const row = upsertAthleteProgramme(ATHLETE, { college_id: duke });
    const again = updateAthleteProgramme(ATHLETE, row.id, {});
    expect(again.updated_at).toBe(row.updated_at);
  });
});

describe('listing', () => {
  it('returns this athlete’s relationships and nobody else’s', () => {
    const unc = college({ name: 'North Carolina' });
    upsertAthleteProgramme(ATHLETE, { college_id: duke });
    upsertAthleteProgramme(ATHLETE, { college_id: unc });
    upsertAthleteProgramme(OTHER, { college_id: duke });

    expect(listAthleteProgrammes(ATHLETE).map((r) => r.college_name))
      .toEqual(['Duke', 'North Carolina']);
    expect(listAthleteProgrammes(OTHER).map((r) => r.college_name)).toEqual(['Duke']);
  });

  it('refuses to list for an athlete that does not exist', () => {
    expect(() => listAthleteProgrammes('nobody')).toThrowError(/No athlete/);
  });
});

// ---------------------------------------------------------------------------

describe('the global suppression table is never touched', () => {
  /**
   * THE REGRESSION THAT MATTERS MOST IN THIS SLICE.
   *
   * `suppressions` is keyed on `email` and has no athlete column. A row in it
   * means an address is never written to again, for ANY athlete. Turning "this
   * athlete already knows the coach at Duke" into a suppression would silence
   * Duke's staff across the whole system from one operator marking one
   * relationship — and nothing about the resulting state would say why.
   */
  function suppressionRows() {
    return db.prepare('SELECT * FROM suppressions ORDER BY email').all();
  }

  it('writes no suppression for any relationship state, including all three at once', () => {
    expect(suppressionRows()).toEqual([]);

    const row = upsertAthleteProgramme(ATHLETE, {
      college_id: duke,
      request_state: 'requested',
      requested_by: 'family',
      flagged: true,
      flag_reason: 'the head coach recruited her sister',
      visibility: 'suppressed',
      contact_stance: 'do_not_contact',
      note: 'Handled directly by the family.',
    });

    expect(row.contact_stance).toBe('do_not_contact');
    expect(row.visibility).toBe('suppressed');
    expect(row.flagged).toBe(true);
    // And the global table is still empty.
    expect(suppressionRows()).toEqual([]);
  });

  it('leaves an existing suppression exactly as it was', () => {
    db.prepare(`
      INSERT INTO suppressions (email, created_at, reason, source)
      VALUES ('coach@duke.test', '2026-09-01T00:00:00.000Z', 'unsubscribed', 'edge')
    `).run();
    const before = suppressionRows();

    const row = upsertAthleteProgramme(ATHLETE, {
      college_id: duke, flagged: true, flag_reason: 'club connection',
    });
    updateAthleteProgramme(ATHLETE, row.id, { contact_stance: 'manual_only' });
    updateAthleteProgramme(ATHLETE, row.id, { visibility: 'suppressed' });
    updateAthleteProgramme(ATHLETE, row.id, { flagged: false });

    expect(suppressionRows()).toEqual(before);
  });

  it('is not imported by the module at all', async () => {
    // Belt to the braces above: a future edit that adds the import is the way
    // this regression would actually arrive.
    const fs = await import('node:fs');
    const source = fs.readFileSync(new URL('./athleteProgrammes.js', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from '\.\/suppressions\.js'/);
    expect(source).not.toMatch(/INSERT INTO suppressions/i);
  });
});
