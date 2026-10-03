/**
 * A7.39: what class-year information Thriv3 cannot read, and why.
 *
 *   node server/scripts/a739ClassYearAudit.js --out=docs/validation/A7.39-classyear-audit.json
 *
 * READ-ONLY. It writes one JSON file and never touches the database.
 *
 * -- THE DISTINCTION THIS SCRIPT EXISTS TO MAKE ----------------------------
 *
 * "Unreadable" has been used loosely to mean "readClassYear failed", and that
 * is not what it means. A roster row produces no eligibility ceiling when ANY
 * of three quite different things is true:
 *
 *   1. the label is ABSENT           - nothing to parse
 *   2. the label parses but carries NO CLASS - a bare redshirt marker
 *   3. the DIVISION has no eligibility rule  - the label was read fine
 *
 * Only the first is a data-acquisition problem, only the third is an
 * eligibility-research problem, and NONE of them is a parser problem. A7.39
 * measured zero rows in the 2026 rosters where `readClassYear` failed to
 * recognise a label, so the recovery this phase was scoped to find does not
 * exist in the parser. This script is the standing evidence for that, and the
 * queue for the work that IS available.
 *
 * NO PII. Programme, division and counts only - never a player name.
 */
import fs from 'node:fs';
import db from '../db/client.js';
import { readClassYear } from '../../shared/classYear.js';
import { eligibilityCeiling, eligibilityRuleFor, ELIGIBILITY_MODEL } from '../../shared/eligibility.js';

const arg = (k, d = null) => process.argv.slice(2).find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const SEASON = arg('season', '2026');
const SPORTS = ['mens-soccer', 'womens-soccer'];

/**
 * The taxonomy, in the vocabulary A7.39 was asked for. Families A, B and C -
 * the recoverable ones - are ABSENT from the 2026 data, which is the finding
 * rather than an omission.
 */
export const CLASSIFICATION = Object.freeze({
  /** Label absent. Belongs to acquisition, not to parsing. */
  F_SOURCE_DATA_DEFECT: 'F_SOURCE_DATA_DEFECT',
  /** Parsed, and genuinely carries no class - "Rs." is a redshirt marker, not a year. */
  D_GENUINELY_UNKNOWN: 'D_GENUINELY_UNKNOWN',
  /** Read correctly; something outside the label is missing, e.g. the division's rule. */
  G_NEEDS_EXTERNAL_VERIFICATION: 'G_NEEDS_EXTERNAL_VERIFICATION',
});

export function auditClassYears({ season = SEASON } = {}) {
  const families = new Map();
  const programmes = new Map();
  let parserDefectRows = 0;

  for (const sport of SPORTS) {
    for (const r of db.prepare(
      'SELECT class_year_label lab, division, season, college_name FROM roster_players WHERE sport = ? AND season = ?',
    ).all(sport, season)) {
      const read = readClassYear(r.lab, { season: r.season });
      // The headline number: a label present that the parser could not read.
      if (r.lab !== null && !read.recognised) parserDefectRows += 1;
      const ruled = eligibilityRuleFor({ division: r.division, season: r.season })?.model !== ELIGIBILITY_MODEL.UNKNOWN;
      const ceiling = eligibilityCeiling({ klass: read.klass, redshirt: read.redshirt, season: r.season, division: r.division });
      if (ceiling.lastSeason !== null) continue;

      const classification = !ruled ? CLASSIFICATION.G_NEEDS_EXTERNAL_VERIFICATION
        : r.lab === null ? CLASSIFICATION.F_SOURCE_DATA_DEFECT
          : CLASSIFICATION.D_GENUINELY_UNKNOWN;
      const key = String(r.lab);
      if (!families.has(key)) {
        families.set(key, { rawValue: r.lab, classification, men: 0, women: 0, divisions: new Set(), programmes: new Set() });
      }
      const f = families.get(key);
      f[sport === 'mens-soccer' ? 'men' : 'women'] += 1;
      f.divisions.add(r.division);
      f.programmes.add(r.college_name);
    }

    for (const r of db.prepare(
      `SELECT college_name, division, source_roster_url,
              SUM(CASE WHEN class_year_label IS NULL THEN 1 ELSE 0 END) nulls, COUNT(*) total
         FROM roster_players WHERE sport = ? AND season = ? GROUP BY college_name HAVING nulls > 0`,
    ).all(sport, season)) {
      /**
       * THE DECIDING QUESTION for each programme, and it is answerable without
       * leaving the database: does this programme have class labels in ANOTHER
       * season? If it does, the source publishes them and one acquisition run
       * lost them. If it never has, the source may genuinely not publish them
       * and that needs checking at the page.
       */
      const other = db.prepare(
        `SELECT SUM(CASE WHEN class_year_label IS NOT NULL THEN 1 ELSE 0 END) lab, COUNT(*) n
           FROM roster_players WHERE sport = ? AND college_name = ? AND season <> ?`,
      ).get(sport, r.college_name, season);
      programmes.set(`${sport}|${r.college_name}`, {
        sport, programme: r.college_name, division: r.division,
        unlabelled: r.nulls, rows: r.total, entirelyUnlabelled: r.nulls === r.total,
        labelledRowsInOtherSeasons: other.lab, rowsInOtherSeasons: other.n,
        diagnosis: other.lab > 0 ? 'ACQUISITION_REGRESSION' : 'NEVER_LABELLED',
        sourceRosterUrl: r.source_roster_url,
      });
    }
  }
  return { families, programmes, parserDefectRows };
}

if (arg('out')) {
  const { families, programmes, parserDefectRows } = auditClassYears();
  const out = {
    phase: 'A7.39', season: SEASON, parserDefectRows,
    parserDefectNote: 'Rows carrying a label that readClassYear could not recognise. A7.39 measured ZERO, '
      + 'so no parser mapping was added - there was nothing for one to recover.',
    families: [...families.values()].map((f) => ({
      rawValue: f.rawValue, classification: f.classification, men: f.men, women: f.women,
      divisions: [...f.divisions].sort(), programmesAffected: f.programmes.size,
      exampleProgrammes: [...f.programmes].slice(0, 3),
    })).sort((a, b) => (b.men + b.women) - (a.men + a.women)),
    unlabelledProgrammes: [...programmes.values()].sort((a, b) => b.unlabelled - a.unlabelled),
    /**
     * NOT a family that fails to read - the class IS read from these. It is a
     * label whose SUFFIX may carry meaning the parser does not act on, found
     * while auditing the 117 labels the parser accepts. Recorded here because
     * an accuracy question with no source is still an open question, and the
     * next person should not have to rediscover it.
     */
    requiresResearch: [{
      rawValueFamily: ['Jr.-R', 'So.-R', 'Fr.-R', 'Sr.-R', 'Fr-R'],
      classification: CLASSIFICATION.G_NEEDS_EXTERNAL_VERIFICATION,
      currentReading: 'the class is read correctly; the -R suffix is NOT treated as a redshirt',
      rowsThisSeason: 17,
      rowsAllSeasons: 44,
      programmes: ['Hawaii Hilo', 'Nebraska at Kearney', 'San Francisco State'],
      why: 'At other programmes the same suffix slot carries -TR and -1L/-2L/-3L, so -R is plausibly '
        + 'Redshirt. hiloathletics.com publishes NO legend, key or expanded form, and a plausible '
        + 'reading is not a source.',
      whyLeftUnchanged: 'Treating the whole label as unreadable would discard the class year that IS '
        + 'unambiguous, and asserting a redshirt would hand the athlete a year of eligibility on an '
        + 'inference. Both are worse than a recorded open question.',
      recommendedAction: 'obtain an expansion from the programme or from a page that prints one, then revisit',
    }],
  };
  fs.writeFileSync(arg('out'), JSON.stringify(out, null, 1));
  console.log(`families ${out.families.length}, unlabelled programmes ${out.unlabelledProgrammes.length}, parser defects ${parserDefectRows}`);
  console.log('written', arg('out'));
}
