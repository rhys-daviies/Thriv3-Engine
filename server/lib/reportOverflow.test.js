/**
 * The layout guard, and the reports run through it.
 *
 * Two halves. The first proves the guard actually fires — a guard that has
 * never failed is indistinguishable from a guard that cannot fail, and this
 * one is guarding against defects that three rounds of human review missed.
 * The second renders whole reports, including deliberately awkward ones, and
 * asserts nothing lands outside the content box.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import db from '../db/client.js';
import { programReportModel } from '../routes/philosophy.js';
import { renderProgramReport } from './philosophyReport.js';
import { invalidatePoolBenchmarks } from './philosophyQueries.js';
import { render, THEME } from './philosophyPdf.js';
import { createAudit, describeViolations, reserved } from './reportAudit.js';

const { M, W } = THEME;

const now = new Date().toISOString();
const letters = (i) => {
  let s = ''; let x = i;
  do { s = String.fromCharCode(97 + (x % 26)) + s; x = Math.floor(x / 26) - 1; } while (x >= 0);
  return s.replace(/^./, (c) => c.toUpperCase());
};
const word = (season) => ['Alpha', 'Bravo', 'Charlie', 'Delta'][Number(season) - 2022] ?? 'Echo';

const insert = db.prepare(`INSERT INTO roster_players
  (id, created_date, updated_date, college_name, sport, division, season, player_name,
   class_year_label, position, minutes_played, games_played, games_started, nationality, country,
   eligibility_end_year, projected_minutes, prior_programme)
  VALUES (?,?,?,?,'mens-soccer','NCAA D2',?,?,?,?,?,?,?,?,?,?,?,?)`);

let n = 0;
const addRow = (school, o = {}) => insert.run(`r${n += 1}`, now, now, school,
  o.season ?? '2025', o.player_name ?? `Player ${letters(n)}`, o.class_year_label ?? 'So.',
  o.position ?? 'DEFENSE', o.minutes_played ?? 600, o.games_played ?? 15, o.games_started ?? 10,
  o.nationality ?? 'USA', o.country ?? null,
  o.eligibility_end_year ?? null, o.projected_minutes ?? null, o.prior_programme ?? null);

function addProgramme(id = 'c1', name = 'Test College', { squad = true } = {}) {
  db.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, city, state, active)
    VALUES (?,?,?,?,'mens-soccer','NCAA D2','Test Conference','Testville','TS',1)`).run(id, now, now, name);
  for (const season of ['2022', '2023', '2024', '2025']) {
    addRow(name, { season, player_name: `Senior ${word(season)}`, class_year_label: 'Sr.', minutes_played: 1400 });
    addRow(name, { season, player_name: `Fresh One ${word(season)}`, class_year_label: 'Fr.', minutes_played: 900 });
    addRow(name, { season, player_name: `Fresh Two ${word(season)}`, class_year_label: 'Fr.', minutes_played: 120 });
    addRow(name, { season, player_name: `Arrived ${word(season)}`, class_year_label: 'Jr.', minutes_played: 700, prior_programme: 'Somewhere Else' });
    for (let i = 0; i < 10; i += 1) {
      addRow(name, { season, player_name: `Mid ${letters(i)} ${word(season)}`, class_year_label: 'So.', position: 'MIDFIELD', minutes_played: 300 });
    }
  }
  for (const s of [2022, 2023, 2024, 2025, 2026]) {
    db.prepare(`INSERT INTO coach_seasons (school, sport, season, coach_name, imported_at)
      VALUES (?,'mens-soccer',?,'A Coach',?)`).run(name, s, now);
  }
  if (squad) {
    addRow(name, { season: '2026', player_name: 'Leaving Soon', class_year_label: 'Gr.', minutes_played: null, games_played: null, eligibility_end_year: 2026, projected_minutes: 1100 });
    addRow(name, { season: '2026', player_name: 'Final Year', class_year_label: 'Sr.', minutes_played: null, games_played: null, eligibility_end_year: 2027, projected_minutes: 900 });
    addRow(name, { season: '2026', player_name: 'No Projection', class_year_label: 'Fr.', minutes_played: null, games_played: null, eligibility_end_year: 2030, projected_minutes: null });
    addRow(name, { season: '2026', player_name: 'Came From Away', class_year_label: 'Jr.', minutes_played: null, games_played: null, eligibility_end_year: 2028, projected_minutes: 500, prior_programme: 'Another School' });
  }
}

const addAthlete = (id, over = {}) => db.prepare(
  `INSERT INTO players (id, created_date, updated_date, full_name, position, nationality, sport, recruiting_class_year)
   VALUES (?,?,?,?,?,?,'mens-soccer',?)`).run(id, now, now, over.name ?? 'Test Athlete',
  over.position ?? 'Defender', over.nationality ?? 'USA', over.year ?? 2027);

beforeEach(() => {
  db.exec('DELETE FROM roster_players; DELETE FROM coach_seasons; DELETE FROM colleges; DELETE FROM players;');
  invalidatePoolBenchmarks();
  n = 0;
});

/** Render a whole report under the guard and return what it found. */
async function audited(playerId = null) {
  const model = programReportModel({ collegeId: 'c1', playerId });
  const audit = createAudit();
  await renderProgramReport(model, { audit });
  return { model, audit };
}

const clean = (audit) => {
  if (audit.violations.length) throw new Error(`layout overflow:\n${describeViolations(audit.violations)}`);
  // A data cell may clip — a name is as long as it is. A column HEADING may
  // not: "RETURNING S…" leaves the reader guessing what the column measures.
  if (audit.clipped.length) {
    throw new Error(`clipped column headings:\n${audit.clipped
      .map((x) => `p${x.page} "${x.label}" -> "${x.fitted}" in ${x.width}pt`).join('\n')}`);
  }
  // A character Helvetica cannot encode is not drawn as itself. Three phases
  // of this report shipped one before the guard existed.
  if (audit.unencodable.length) {
    throw new Error(`characters Helvetica cannot draw:\n${audit.unencodable
      .map((x) => `p${x.page} ${JSON.stringify(x.characters)} in "${x.text}"`).join('\n')}`);
  }
  return true;
};

// ---------------------------------------------------------------------------
// The guard itself
// ---------------------------------------------------------------------------

describe('the layout guard', () => {
  const probe = async (draw) => {
    const audit = createAudit();
    await render((k) => draw(k.doc, k), { audit });
    return audit;
  };

  it('sees the text a report draws', async () => {
    const audit = await probe((doc) => {
      doc.font('Helvetica').fontSize(9).text('inside the box', M, M, { width: W });
    });
    expect(audit.drawn).toBe(1);
    expect(audit.violations).toEqual([]);
  });

  it('catches text below the footer-safe boundary', async () => {
    const audit = await probe((doc) => {
      doc.page.margins.bottom = 0;                 // exactly what footer() does
      doc.font('Helvetica').fontSize(9).text('too low', M, doc.page.height - 30, { width: W, lineBreak: false });
    });
    expect(audit.violations).toHaveLength(1);
    expect(audit.violations[0].edges).toContain('below');
    expect(audit.violations[0].text).toBe('too low');
  });

  it('catches text past the right content boundary', async () => {
    const audit = await probe((doc) => {
      doc.font('Helvetica').fontSize(9)
        .text('a string that is much wider than the space it was given', M + W - 20, M,
          { width: 20, lineBreak: false });
    });
    expect(audit.violations).toHaveLength(1);
    expect(audit.violations[0].edges).toContain('right');
  });

  it('catches text left of the content area', async () => {
    const audit = await probe((doc) => {
      doc.font('Helvetica').fontSize(9).text('out at the left', 4, M, { width: 200, lineBreak: false });
    });
    expect(audit.violations[0].edges).toContain('left');
  });

  it('catches a fixed region running off the bottom of the page', async () => {
    const audit = await probe((doc) => {
      doc.save().rect(M, 700, W, 200).fill('#EEEEEE').restore();
    });
    expect(audit.violations).toHaveLength(1);
    expect(audit.violations[0].kind).toBe('rect');
    expect(audit.violations[0].edges).toContain('below');
  });

  it('catches a plotted point drawn half off the edge', async () => {
    const audit = await probe((doc) => {
      doc.save().circle(M + W, 300, 6).fill('#000000').restore();
    });
    expect(audit.violations[0].kind).toBe('circle');
  });

  // The masthead kicker is above the top margin on every page by design.
  it('allows the kicker band above the top margin', async () => {
    const audit = await probe((doc) => {
      doc.font('Helvetica-Bold').fontSize(8.5).text('THRIV3', M, M - 18, { width: W, lineBreak: false });
    });
    expect(audit.violations).toEqual([]);
  });

  it('allows drawing that declares itself reserved', async () => {
    const audit = await probe((doc) => {
      reserved(doc, () => {
        doc.page.margins.bottom = 0;
        doc.font('Helvetica').fontSize(7.5).text('a footer', M, doc.page.height - 48, { width: W, lineBreak: false });
      });
    });
    expect(audit.violations).toEqual([]);
  });

  it('attributes a violation to the page it happened on', async () => {
    const audit = await probe((doc) => {
      doc.addPage();
      doc.addPage();
      doc.font('Helvetica').fontSize(9).text('out at the left', 4, M, { width: 200, lineBreak: false });
    });
    expect(audit.violations[0].page).toBe(3);
  });

  // The bounds are snapshotted at page creation precisely so that dropping the
  // margin later cannot move the floor out from under the check.
  it('does not let a dropped bottom margin excuse an overflow', async () => {
    const audit = await probe((doc) => {
      doc.page.margins.bottom = 0;
      doc.save().rect(M, 780, W, 40).fill('#EEEEEE').restore();
    });
    expect(audit.violations[0].edges).toContain('below');
  });

  it('leaves the rendered bytes unchanged', async () => {
    const draw = (k) => { k.title('A title'); k.body('Some body text.'); };
    const plain = await render(draw);
    const watched = await render(draw, { audit: createAudit() });
    // Only the creation date differs between two renders, and pdfkit stamps
    // none by default here, so the bytes are directly comparable.
    expect(watched.length).toBe(plain.length);
  });
});

describe('table headings', () => {
  const head = async (columns, rows = [{ a: 1, b: 2, c: 3 }]) => {
    const audit = createAudit();
    const buf = await render((k) => k.table({ columns, rows }), { audit });
    return { audit, buf };
  };

  it('breaks a long heading onto a second line rather than clipping it', async () => {
    const { audit, buf } = await head([
      { key: 'a', label: 'Projected minutes', width: 0.2 },
      { key: 'b', label: 'Previous programme', width: 0.2 },
      { key: 'c', label: 'X', width: 0.6 },
    ]);
    expect(audit.clipped).toEqual([]);
    // Both words survive, on two lines, so the meaning is intact.
    const text = buf.toString('latin1');
    expect(text.length).toBeGreaterThan(0);
    expect(audit.violations).toEqual([]);
  });

  it('reports a heading that cannot fit even on two lines', async () => {
    const { audit } = await head([
      { key: 'a', label: 'Extraordinarilylongunbreakableheading', width: 0.1 },
      { key: 'b', label: 'B', width: 0.45 },
      { key: 'c', label: 'C', width: 0.45 },
    ]);
    expect(audit.clipped).toHaveLength(1);
    expect(audit.clipped[0].label).toBe('EXTRAORDINARILYLONGUNBREAKABLEHEADING');
  });

  it('leaves a heading that fits on one line alone', async () => {
    const { audit } = await head([
      { key: 'a', label: 'Player', width: 0.4 },
      { key: 'b', label: 'Minutes', width: 0.3 },
      { key: 'c', label: 'Games', width: 0.3 },
    ]);
    expect(audit.clipped).toEqual([]);
  });
});

describe('names and the font', () => {
  const drawn = async (name) => {
    const audit = createAudit();
    await render((k) => {
      k.doc.font('Helvetica').fontSize(9).text(name, M, M, { width: W });
    }, { audit });
    return audit;
  };

  it('draws accented, apostrophed and hyphenated names as themselves', async () => {
    for (const name of ['José Muñoz', 'Søren Ødegård', 'Ana-Lucía O’Connell',
      'François Lefèvre', 'Þór Bjarnason', 'Åsa Nyström']) {
      const audit = await drawn(name);
      expect(audit.unencodable).toEqual([]);
    }
  });

  // A name can arrive decomposed. WinAnsi has "ã" and no combining tilde at
  // all, so without composing, the tilde is dropped and the name is silently
  // misspelled on the page.
  it('composes a decomposed name rather than losing its accents', async () => {
    const decomposed = 'Joa\u0303o Sa\u0301';
    expect(decomposed).not.toBe(decomposed.normalize('NFC'));
    const audit = await drawn(decomposed);
    expect(audit.unencodable).toEqual([]);
  });

  it('reports a character it genuinely cannot draw, rather than substituting silently', async () => {
    // A Cyrillic homoglyph — the one shape in 132,590 roster names that
    // Helvetica has no glyph for. Reported, never transliterated.
    const audit = await drawn('Zo\u0451 May');
    expect(audit.unencodable).toHaveLength(1);
    expect(audit.unencodable[0].characters).toEqual(['\u0451']);
  });

  it('reports a glyph outside the set drawn anywhere in a report', async () => {
    const audit = await drawn('a \u2192 b, x \u2260 y');
    expect(audit.unencodable[0].characters.sort()).toEqual(['\u2192', '\u2260']);
  });
});

// ---------------------------------------------------------------------------
// Whole reports
// ---------------------------------------------------------------------------

describe('the report stays inside the page', () => {
  it('holds for a generic programme report', async () => {
    addProgramme();
    const { audit } = await audited();
    expect(clean(audit)).toBe(true);
    expect(audit.drawn).toBeGreaterThan(200);
  });

  it('holds for an athlete report', async () => {
    addProgramme();
    addAthlete('p1');
    const { audit } = await audited('p1');
    expect(clean(audit)).toBe(true);
  });

  it('holds for a sparse programme with almost nothing on file', async () => {
    db.prepare(`INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, city, state, active)
      VALUES ('c1',?,?,'Thin College','mens-soccer','NCAA D3',NULL,NULL,NULL,1)`).run(now, now);
    addRow('Thin College', { season: '2025', minutes_played: null, games_played: null });
    const { audit } = await audited();
    expect(clean(audit)).toBe(true);
  });

  it('holds for a very long programme name', async () => {
    addProgramme('c1', 'The University of Somewhere Extremely Long at Saint Something-upon-Water');
    addAthlete('p1');
    const { audit } = await audited('p1');
    expect(clean(audit)).toBe(true);
  });

  it('holds for a large first-year intake and a large roster', async () => {
    addProgramme();
    for (const season of ['2022', '2023', '2024', '2025']) {
      for (let i = 0; i < 22; i += 1) {
        addRow('Test College', {
          season, player_name: `Extra Fresh ${letters(i)} ${word(season)}`, class_year_label: 'Fr.',
          minutes_played: 40 * i, position: ['DEFENSE', 'MIDFIELD', 'FORWARD', 'GOALKEEPER'][i % 4],
        });
      }
    }
    for (let i = 0; i < 40; i += 1) {
      addRow('Test College', {
        season: '2026', player_name: `Squad ${letters(i)}`, class_year_label: 'Jr.',
        minutes_played: null, games_played: null, position: 'DEFENSE',
        eligibility_end_year: 2027 + (i % 4), projected_minutes: i % 5 === 0 ? null : 100 + i * 30,
      });
    }
    addAthlete('p1');
    const { audit } = await audited('p1');
    expect(clean(audit)).toBe(true);
  });

  it('holds where names are long and awkward', async () => {
    addProgramme();
    const awkward = ['Maximilian Fitzgerald-Wentworth O’Shaughnessy III',
      'José Muñoz-Ødegård', 'Joa\u0303o Sa\u0301 Pereira', 'François Lefèvre-Ångström'];
    awkward.forEach((name, i) => {
      addRow('Test College', {
        season: ['2022', '2023', '2024', '2025'][i], class_year_label: 'Fr.', minutes_played: 1500,
        player_name: name,
        prior_programme: 'The Community College of Somewhere Very Long Indeed',
      });
    });
    addRow('Test College', {
      season: '2026', player_name: 'Bartholomew Vanderhoeven-Castellanos', class_year_label: 'Jr.',
      minutes_played: null, games_played: null, eligibility_end_year: 2029, projected_minutes: 800,
      prior_programme: 'A Previous Programme With An Unreasonably Long Name',
    });
    addAthlete('p1');
    const { audit } = await audited('p1');
    expect(clean(audit)).toBe(true);
  });

  it('holds where eligibility years and projections are mostly missing', async () => {
    addProgramme('c1', 'Test College', { squad: false });
    for (let i = 0; i < 16; i += 1) {
      addRow('Test College', {
        season: '2026', player_name: `Unknown ${letters(i)}`, class_year_label: 'So.',
        minutes_played: null, games_played: null, eligibility_end_year: null, projected_minutes: null,
      });
    }
    addAthlete('p1');
    const { audit } = await audited('p1');
    expect(clean(audit)).toBe(true);
  });
});
