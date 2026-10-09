/**
 * CORRECTION TARGET AND ITS ACTIVATION-HOLDS SOURCE — Phase DI-03D.
 *
 * The activation holds that protect a database are the ones its RUNNING APPLICATION reads: the
 * checkout that holds the database at <checkout>/server/data/<db> serves sends with
 * <checkout>/server/data/seeds/coach_activation_holds.json (canonicalCoachEligibility.HOLDS_PATH,
 * resolved from that checkout's code). A correction is therefore checked against the holds file
 * NEXT TO THE DATABASE — never the holds file of whichever checkout the correction code runs from
 * (DI-03C F9), and never a file the operator names instead.
 *
 *   RUNTIME     the database lives in a checkout's server/data directory (real path, native case).
 *               Holds: that checkout's seeds file, required to exist and be readable. Naming another
 *               holds file is refused.
 *   DISPOSABLE  anything else (a scratch copy, :memory:). Holds: an explicitly named file is required.
 *               A file-backed disposable database must have exactly one hard link: a hard link to a
 *               runtime database would otherwise pass as a scratch copy (DI-03C F10).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { activationHolds } from '../canonicalCoachEligibility.js';

export const HOLDS_FILE_NAME = path.join('seeds', 'coach_activation_holds.json');
const real = (p) => fs.realpathSync.native(p);

/**
 * -> { target, dbPath, holdsFile, holdsSha256, holdsCount } or throws.
 * `db`: a better-sqlite3 handle (db.name is its file). `activationHoldsFile`: only for DISPOSABLE.
 */
export function correctionTarget(db, { activationHoldsFile = null } = {}) {
  const name = db?.name;
  let target; let dbPath = null; let holdsFile;
  if (!name || name === ':memory:' || db.memory) {
    target = 'DISPOSABLE';
  } else {
    dbPath = real(name);
    const parts = dbPath.split(path.sep);
    const runtime = parts.length >= 3 && parts[parts.length - 3] === 'server' && parts[parts.length - 2] === 'data';
    if (runtime) target = 'RUNTIME';
    else {
      target = 'DISPOSABLE';
      if (fs.statSync(dbPath).nlink !== 1) throw new Error(`${dbPath} has ${fs.statSync(dbPath).nlink} hard links — it cannot be shown to be a disposable copy`);
    }
  }
  if (target === 'RUNTIME') {
    holdsFile = path.join(path.dirname(dbPath), HOLDS_FILE_NAME);
    if (activationHoldsFile && (!fs.existsSync(activationHoldsFile) || real(activationHoldsFile) !== real(holdsFile))) {
      throw new Error(`${dbPath} is a runtime database: its application enforces ${holdsFile} — no other holds file can stand in for it`);
    }
  } else {
    if (!activationHoldsFile) throw new Error('a disposable correction must name its activation-holds file explicitly');
    holdsFile = path.resolve(activationHoldsFile);
  }
  if (!fs.existsSync(holdsFile)) throw new Error(`activation holds file ${holdsFile} does not exist`);
  const index = activationHolds(holdsFile);
  if (index === null) throw new Error(`activation holds file ${holdsFile} is unreadable or inconsistent (fail closed)`);
  const bytes = fs.readFileSync(holdsFile);
  return { target, dbPath, holdsFile, holdsSha256: crypto.createHash('sha256').update(bytes).digest('hex'), holdsCount: index.size, holds: index };
}
