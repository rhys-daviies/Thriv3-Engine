/**
 * A MISSING ACCEPTANCE CORPUS IS A REFUSAL, NOT A RESULT — L8B-2.
 *
 * `client.js` creates the database when the path does not exist, so a typo in
 * RECRUITMATCH_DB produced an empty corpus and the baseline runner reported
 * `dataset CHANGED` — which reads as "the data moved" when the truth is "there
 * is no data". Measured during L8B-2.
 *
 * It never fell back to the live database and never reported PASS, but a
 * comparison against nothing is not a comparison.
 *
 * THIS IS ITS OWN MODULE because ES module imports are evaluated in source
 * order and `client.js` opens the file during ITS evaluation. A check written
 * as a statement in the runner runs too late — the database is already created
 * by the time control reaches it. Imported first, this runs first.
 */
import { existsSync } from 'node:fs';

const selected = (process.env.RECRUITMATCH_DB ?? '').trim();
if (selected && selected !== ':memory:' && !existsSync(selected)) {
  process.stderr.write(
    `\n  RECRUITMATCH_DB names a database that does not exist:\n    ${selected}\n\n`
    + '  Refusing rather than creating an empty one and reporting the emptiness\n'
    + '  as a dataset change. Check the path, or capture the corpus first.\n\n',
  );
  process.exit(2);
}
