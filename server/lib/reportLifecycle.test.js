/**
 * The lifecycle pages, rendered.
 *
 * The model tests beside this one prove the arithmetic refuses what it should.
 * These prove the document does: that the page replaced is gone, that a
 * suppressed division gets no destination page however many rows it happens to
 * have, that the contents numbering still lands on the page it names, and that
 * none of the words this analysis is forbidden to use reach the paper.
 */
import zlib from 'node:zlib';
import { describe, it, expect, beforeEach } from 'vitest';
import db from '../db/client.js';
import { programReportModel } from '../routes/philosophy.js';
import { renderProgramReport } from './philosophyReport.js';
import { invalidatePoolBenchmarks } from './philosophyQueries.js';
import { invalidateLifecyclePool } from './lifecycleQueries.js';
import { createAudit } from './reportAudit.js';

const WINANSI = { 0x85: '…', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x96: '–', 0x97: '—', 0xb7: '·' };

/** Every page's text, in order, so a claim can be pinned to the page it is on. */
function pdfPages(buf) {
  const raw = buf.toString('latin1');
  const pages = [];
  const re = /stream\r?\n([\s\S]*?)endstream/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    let body;
    try { body = zlib.inflateSync(Buffer.from(m[1], 'latin1')).toString('latin1'); } catch { continue; }
    const out = [];
    for (const op of body.matchAll(/(?:\[([^\]]*)\]\s*TJ|(<[0-9A-Fa-f]*>)\s*Tj)/g)) {
      let wordText = '';
      for (const hex of (op[1] ?? op[2] ?? '').matchAll(/<([0-9A-Fa-f]*)>/g)) {
        for (let i = 0; i + 1 < hex[1].length; i += 2) {
          const code = parseInt(hex[1].slice(i, i + 2), 16);
          wordText += WINANSI[code] ?? String.fromCharCode(code);
        }
      }
      if (wordText) out.push(wordText);
    }
    if (out.length) pages.push(out.join(' ').replace(/\s+/g, ' '));
  }
  return pages;
}

const now = new Date().toISOString();
const NAMES = ['Ada', 'Bram', 'Cleo', 'Dara', 'Enzo', 'Faye', 'Gus', 'Hana', 'Ivo', 'Juno',
  'Kit', 'Lior', 'Mira', 'Noor', 'Otto', 'Pia', 'Quin', 'Rex', 'Sana', 'Tao',
  'Uma', 'Vero', 'Wren', 'Xan', 'Yara', 'Zev'];
const SURNAMES = ['Aldridge', 'Bowen', 'Castell', 'Devlin', 'Ewart', 'Fennimore', 'Garrow',
  'Halloway', 'Ingersoll', 'Jarrow', 'Keswick', 'Lundqvist', 'Marchetti', 'Nevison',
  'Ormsby', 'Pemberton', 'Quilliam', 'Radcliffe', 'Sturridge', 'Thackeray',
  'Ulverston', 'Vasquez', 'Wheatley', 'Xavier', 'Yeardley', 'Zamora'];
/** A distinct, readable name for index i. `nameKey` strips digits, so no numbers. */
const person = (i) => `${NAMES[i % NAMES.length]} ${SURNAMES[Math.floor(i / NAMES.length) % SURNAMES.length]}${
  i >= NAMES.length * SURNAMES.length ? 'son' : ''}`;
const TOWNS = ['Ashford, OH', 'Belmont, PA', 'Carrow, MI', 'Denby, IN', 'Elstow, IL',
  'Fairhaven, NY', 'Girvan, WI', 'Harlow, MO', 'Ilkley, KY', 'Jarrow, TN',
  'Kelso, IA', 'Lorne, MN', 'Marlow, VA', 'Norbury, NC'];

let rowId = 0;
const insert = db.prepare(`INSERT INTO roster_players
  (id, created_date, updated_date, college_name, sport, division, season, player_name,
   class_year_label, position, minutes_played, games_played, games_started, nationality, hometown,
   estimated_graduation_year, eligibility_end_year, projected_minutes, prior_programme)
  VALUES (?,?,?,?,'mens-soccer',?,?,?,?,?,?,?,?,'USA',?,?,?,?,?)`);

const addRow = (school, division, o = {}) => insert.run(`r${rowId += 1}`, now, now, school, division,
  String(o.season ?? '2025'), o.name, o.class ?? 'So.', o.position ?? 'MIDFIELD',
  'minutes' in o ? o.minutes : 700, 'games' in o ? o.games : 16, o.starts ?? 12,
  o.hometown ?? null, o.grad ?? null, o.eligibility ?? null, o.projected ?? null, o.prior ?? null);

const addCollege = (id, name, division, o = {}) => db.prepare(
  `INSERT INTO colleges (id, created_date, updated_date, name, sport, division, conference, city,
     state, active, soccer_score, academic_rating, national_ranking)
   VALUES (?,?,?,?,'mens-soccer',?,'Test Conference','Testville','TS',1,?,?,?)`,
).run(id, now, now, name, division, o.soccer ?? 60, o.academic ?? 5, o.rank ?? 100);

const addCoaches = (name) => {
  for (const s of [2022, 2023, 2024, 2025, 2026]) {
    db.prepare(`INSERT INTO coach_seasons (school, sport, season, coach_name, imported_at)
      VALUES (?,'mens-soccer',?,'A Coach',?)`).run(name, s, now);
  }
};

const SEASONS = ['2022', '2023', '2024', '2025'];
const CLASSES = ['Fr.', 'So.', 'Jr.', 'Sr.'];

/**
 * A programme, its leavers, and somewhere for them to go.
 *
 * `leaversPerSeason` players drop out of each transition and, where `traceable`
 * is on, reappear at a destination with the same hometown — which is what makes
 * them a MATCH_A rather than a name the evidence cannot settle.
 */
function addProgramme({
  id = 'c1', name = 'Home', division = 'NCAA D2', squadSize = 26,
  leaversPerSeason = 4, traceable = 0, minutes = null, destinations = [],
  minutesPublished = true,
} = {}) {
  addCollege(id, name, division);
  addCoaches(name);
  let leaver = 0;
  for (const [si, season] of SEASONS.entries()) {
    for (let i = 0; i < squadSize; i += 1) {
      const mins = minutes ? minutes(i, si) : [0, 150, 400, 900, 1500][i % 5];
      addRow(name, division, {
        season,
        name: person(i),
        class: CLASSES[(i + si) % 4],
        position: ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'][i % 4],
        minutes: minutesPublished ? mins : 0,
        // A zero beside games played is the shape an unpublished minutes column
        // takes. A zero beside zero games is a real zero, and stays one.
        games: minutesPublished && mins === 0 ? 0 : 16,
        hometown: TOWNS[i % TOWNS.length],
      });
    }
    // The leavers: on this season's roster and never again.
    for (let i = 0; i < leaversPerSeason; i += 1) {
      const who = person(squadSize + leaver);
      const town = TOWNS[leaver % TOWNS.length];
      // Positions cycle so a thin-but-nonempty position sample exists, which is
      // the case the broadened athlete module has to handle.
      const leaverPosition = ['FORWARD', 'FORWARD', 'FORWARD', 'MIDFIELD', 'GOALKEEPER'][leaver % 5];
      addRow(name, division, {
        season, name: who, class: si === 3 ? 'Sr.' : 'Jr.', position: leaverPosition,
        minutes: 800, hometown: town,
      });
      if (leaver < traceable && si < SEASONS.length - 1 && destinations.length) {
        const [dName, dDivision] = destinations[leaver % destinations.length];
        addRow(dName, dDivision, {
          season: SEASONS[si + 1], name: who, class: 'Sr.', position: leaverPosition,
          minutes: 500, hometown: town,
        });
      }
      leaver += 1;
    }
  }
  // The forward roster, so the last transition is readable.
  for (let i = 0; i < squadSize; i += 1) {
    addRow(name, division, {
      season: '2026', name: person(i), class: CLASSES[(i + 4) % 4], minutes: null, games: null,
      position: ['GOALKEEPER', 'DEFENSE', 'MIDFIELD', 'FORWARD'][i % 4],
      eligibility: 2027 + (i % 3), projected: 400 + i * 10, hometown: TOWNS[i % TOWNS.length],
    });
  }
}

/** Somewhere for the leavers to land, with its own roster so it is a real programme. */
function addDestination(id, name, division, o = {}) {
  addCollege(id, name, division, o);
  addCoaches(name);
  // The same squad every season. A destination whose roster turns over
  // completely contributes a wave of untraceable departures of its own and
  // drags the division's pool coverage under the floor — which is a property
  // of the fixture, not of the programme under test.
  for (const season of [...SEASONS, '2026']) {
    for (let i = 0; i < 24; i += 1) {
      addRow(name, division, {
        season, name: person(200 + i), class: CLASSES[i % 4],
        minutes: season === '2026' ? null : [200, 600, 1100][i % 3],
        games: season === '2026' ? null : 16,
        hometown: TOWNS[(i + 3) % TOWNS.length],
      });
    }
  }
}

const addAthlete = (id, o = {}) => db.prepare(
  `INSERT INTO players (id, created_date, updated_date, full_name, position, nationality, sport,
     recruiting_class_year, football_ability)
   VALUES (?,?,?,?,?,'USA','mens-soccer',?,?)`,
).run(id, now, now, o.name ?? 'Test Athlete', o.position ?? 'Forward', o.year ?? 2027, o.level ?? 6);

beforeEach(() => {
  db.exec('DELETE FROM roster_players; DELETE FROM coach_seasons; DELETE FROM colleges; DELETE FROM players;');
  invalidatePoolBenchmarks();
  invalidateLifecyclePool();
  rowId = 0;
});

/** The text of the page a section actually starts on. The contents names them all. */
const pageOf = (pages, model, id) => {
  const section = model.sections.find((s) => s.id === id);
  expect(section, `section ${id}`).toBeTruthy();
  return pages[section.page - 1];
};

const build = async (playerId = null, collegeId = 'c1') => {
  const model = programReportModel({ collegeId, playerId });
  const audit = createAudit();
  const buf = await renderProgramReport(model, { audit });
  const pages = pdfPages(buf);
  return { model, audit, pages, text: pages.join(' ') };
};

/** A D1 programme whose leavers can be traced, plus the pool that traces them. */
function tracedWorld() {
  addDestination('d1', 'Stronger Place', 'NCAA D1', { soccer: 85, academic: 9, rank: 20 });
  addDestination('d2', 'Lower Place', 'NCAA D2', { soccer: 40, academic: 3, rank: 260 });
  addProgramme({
    id: 'c1', name: 'Home', division: 'NCAA D1', traceable: 12, leaversPerSeason: 5,
    destinations: [['Stronger Place', 'NCAA D1'], ['Lower Place', 'NCAA D2']],
  });
}

// ---------------------------------------------------------------------------

describe('the page that was replaced', () => {
  beforeEach(() => addProgramme());

  it('renders the multi-year development page in its place', async () => {
    const { text, model } = await build();
    expect(text).toContain('How players develop after they arrive');
    expect(text).toMatch(/Do players who arrive here tend to grow into meaningful roles\?/);
    expect(model.sections.map((s) => s.id)).toContain('player-development');
  });

  it('carries no trace of the year-one-to-year-two page', async () => {
    const { text, model } = await build();
    expect(text).not.toContain('After the first season');
    expect(model.sections.map((s) => s.id)).not.toContain('freshman-development');
    expect(model.freshman.progression).toBeUndefined();
    expect(model.freshman.retention).toBeUndefined();
  });

  it('shows four years, each with its own denominator', async () => {
    const { text, model } = await build();
    const d = model.lifecycle.development;
    expect(d.byYear).toHaveLength(4);
    for (const [i, y] of d.byYear.entries()) {
      expect(text).toContain(`YEAR ${i + 1}`);
      expect(text).toContain(`${y.reached} of ${y.denominator}`);
    }
    // The denominators shrink to the right. That is the whole point of them.
    expect(d.byYear[0].denominator).toBeGreaterThanOrEqual(d.byYear[3].denominator);
  });
});

describe('roster continuity on the page', () => {
  beforeEach(() => addProgramme());

  it('leads with retention and states the pool it is read against', async () => {
    const { text, model } = await build();
    expect(text).toContain('Roster continuity');
    expect(text).toMatch(/How often do players who could return appear on the next roster\?/);
    const c = model.lifecycle.continuity;
    expect(text).toContain(`${c.returned} of ${c.returnable}`);
  });

  it('shows expected exits and early departures as separate groups', async () => {
    const { text } = await build();
    expect(text).toContain('Expected exits');
    expect(text).toContain('Early departures');
    expect(text).toMatch(/senior or graduate/);
    expect(text).toMatch(/first-year, sophomore or junior/);
  });

  it('says that eligibility years are not used as separate evidence', async () => {
    const { text } = await build();
    expect(text).toMatch(/Eligibility years are not used here/);
  });
});

describe('the destination gate, in the document', () => {
  it('omits the destination pages entirely for Division III', async () => {
    addDestination('d1', 'Stronger Place', 'NCAA D1', { soccer: 85 });
    addProgramme({
      id: 'c1', name: 'Home', division: 'NCAA D3', traceable: 12, leaversPerSeason: 5,
      destinations: [['Stronger Place', 'NCAA D1']],
    });
    const { text, model } = await build();
    expect(model.lifecycle.departures.gate.allowed).toBe(false);
    expect(model.lifecycle.departures.gate.reason).toBe('division-suppressed');
    // Rows exist. The page still does not, which is the point.
    expect(model.lifecycle.departures.tracing.observed).toBeGreaterThan(0);
    const ids = model.sections.map((s) => s.id);
    expect(ids).not.toContain('observed-destinations');
    expect(ids).not.toContain('table-destinations');
    expect(text).not.toContain('Where we can trace players next');
    expect(text).not.toContain('Every traced move');
    // Everything that does not depend on tracing still renders.
    expect(ids).toContain('roster-continuity');
    expect(ids).toContain('player-development');
    expect(text).toContain('Early departures');
  });

  it('renders the destination pages for a Division I programme with coverage', async () => {
    tracedWorld();
    const { text, model } = await build();
    expect(model.lifecycle.departures.gate.allowed).toBe(true);
    expect(text).toContain('Where we can trace players next');
    expect(text).toContain('Every traced move');
  });

  it('omits them for a programme with too few traced moves', async () => {
    addDestination('d1', 'Stronger Place', 'NCAA D1', { soccer: 85 });
    addProgramme({
      id: 'c1', name: 'Home', division: 'NCAA D1', traceable: 2, leaversPerSeason: 5,
      destinations: [['Stronger Place', 'NCAA D1']],
    });
    const { model, text } = await build();
    expect(model.lifecycle.departures.gate.reason).toBe('too-few-observed');
    expect(text).not.toContain('Where we can trace players next');
  });
});

describe('the destination page itself', () => {
  beforeEach(tracedWorld);

  it('puts coverage first, at full size, above any destination pattern', async () => {
    const { pages, model } = await build();
    const page = pageOf(pages, model, 'observed-destinations');
    const d = model.lifecycle.departures;
    expect(page).toContain('Observed destinations only');
    expect(page).toContain(`${d.tracing.observed} traced to another roster`);
    expect(page).toContain('How much of this programme’s movement can be seen at all');
    // Coverage is stated before the first of the three measures.
    expect(page.indexOf('traced to another roster'))
      .toBeLessThan(page.indexOf('Football rating'));
  });

  it('names the unresolved group and does not bury it', async () => {
    const { pages, model } = await build();
    const page = pageOf(pages, model, 'observed-destinations');
    expect(page).toMatch(/not traceable \(\d+\)/);
    expect(page).toContain(`${model.lifecycle.departures.tracing.unresolved} more left and appear on no roster`);
  });

  it('shows football, academic and division as three separate bars', async () => {
    const { pages, model } = await build();
    const page = pageOf(pages, model, 'observed-destinations');
    for (const label of ['Football rating', 'Academic rating', 'Division']) {
      expect(page).toContain(label);
    }
    expect(page).toMatch(/never combined into one/);
  });

  it('lists every traced move in the supporting record, and only traced ones', async () => {
    const { pages, model } = await build();
    const page = pageOf(pages, model, 'table-destinations');
    const d = model.lifecycle.departures;
    for (const m of d.named) expect(page).toContain(m.name);
    expect(page).toContain(`${d.departures.total - d.named.length} could not be traced`);
  });
});

describe('the athlete module', () => {
  beforeEach(() => {
    tracedWorld();
    addAthlete('p1', { name: 'Forward Athlete', position: 'Forward' });
  });

  it('shows the athlete’s own position where the sample carries it', async () => {
    const { text, model } = await build('p1');
    const p = model.lifecycle.athletePosition;
    expect(p.group).toBe('position');
    expect(text).toContain('Forwards here we could trace');
    expect(text).toMatch(/Players recorded at forward who left and could be traced/);
  });

  it('says so outright when it is showing the programme instead', async () => {
    db.exec("DELETE FROM players");
    addAthlete('p2', { name: 'Keeper Athlete', position: 'Goalkeeper' });
    const { text, model } = await build('p2');
    const p = model.lifecycle.athletePosition;
    expect(p.group).toBe('programme');
    expect(text).toContain('THIS IS NOT THE POSITION ON ITS OWN');
    expect(text).toMatch(/the programme-wide record is at the back/);
    // And it shows the goalkeepers it could trace rather than reprinting the
    // programme's list, which is already in the supporting record in full.
    expect(p.positionRows.length).toBeGreaterThan(0);
    for (const m of p.positionRows) expect(text).toContain(m.name);
    expect(text).toMatch(/traced moves? at this position/);
  });
});

describe('words this analysis may not use', () => {
  const worlds = {
    'a traced Division I programme': tracedWorld,
    'a Division III programme with departures': () => {
      addDestination('d1', 'Stronger Place', 'NCAA D1', { soccer: 85 });
      addProgramme({ id: 'c1', name: 'Home', division: 'NCAA D3', traceable: 12, leaversPerSeason: 5,
        destinations: [['Stronger Place', 'NCAA D1']] });
    },
  };

  for (const [label, world] of Object.entries(worlds)) {
    it(`never states a transfer rate or names a rate over departures — ${label}`, async () => {
      world();
      const { text, model } = await build();
      expect(text).not.toMatch(/transfer rate/i);
      expect(text).not.toMatch(/\btransfer history\b/i);
      expect(text).not.toMatch(/where players transfer/i);
      expect(JSON.stringify(model.lifecycle)).not.toMatch(/transferRate|transfer_rate/i);
    });

    it(`infers nothing about satisfaction, culture or reasons — ${label}`, async () => {
      world();
      const { text } = await build();
      for (const banned of [/satisfaction/i, /\bhapp(y|iness)\b/i, /culture problem/i,
        /players dislike/i, /unhappy/i, /successful transfer/i, /failed transfer/i,
        /successful move/i, /failed move/i]) {
        expect(text).not.toMatch(banned);
      }
    });

    it(`does not call an early departure a transfer — ${label}`, async () => {
      world();
      const { text } = await build();
      // Every surviving use of the word is the sentence that exists to say the
      // roster cannot tell one route in from another.
      for (const hit of text.match(/.{0,45}\btransfers?\b.{0,45}/gi) ?? []) {
        expect(hit).toMatch(/cannot (tell|reliably separate)/i);
      }
    });
  }
});

describe('the contents still names the right pages', () => {
  it('numbers every lifecycle section onto the page it starts on', async () => {
    tracedWorld();
    const { model, pages } = await build();
    const wanted = {
      'player-development': 'How players develop after they arrive',
      'roster-continuity': 'Roster continuity',
      'observed-destinations': 'Where we can trace players next',
      'table-destinations': 'Every traced move',
    };
    for (const [id, title] of Object.entries(wanted)) {
      const section = model.sections.find((s) => s.id === id);
      expect(section, id).toBeTruthy();
      expect(section.page, id).toBeGreaterThan(0);
      expect(pages[section.page - 1], `${id} on page ${section.page}`).toContain(title);
    }
    // And the contents page itself lists them.
    for (const title of Object.values(wanted)) expect(pages[0]).toContain(title);
  });
});

describe('sparse programmes', () => {
  it('says why there are no percentages where minutes were never published', async () => {
    addProgramme({ minutesPublished: false });
    const { text, model } = await build();
    expect(model.lifecycle.development.minutesCoverage.readable).toBe(false);
    expect(text).toContain('WHY THERE ARE NO PERCENTAGES HERE');
    expect(text).not.toMatch(/0% reached/);
  });

  it('draws no individual careers, and says so, where none is long enough', async () => {
    addProgramme({ squadSize: 12, leaversPerSeason: 1 });
    db.exec("DELETE FROM roster_players WHERE season IN ('2023','2024')");
    const { text } = await build();
    expect(text).toContain('NO INDIVIDUAL CAREERS TO DRAW');
  });

  it('renders a one-season programme without a continuity page', async () => {
    addProgramme();
    db.exec("DELETE FROM roster_players WHERE season <> '2025'");
    const { model, audit } = await build();
    expect(model.lifecycle.continuity.returnable).toBe(0);
    expect(model.sections.map((s) => s.id)).not.toContain('roster-continuity');
    expect(audit.violations).toHaveLength(0);
  });
});

describe('the whole document stays inside its box', () => {
  it('renders a traced programme and an athlete report with no layout defect', async () => {
    tracedWorld();
    addAthlete('p1', { name: 'Forward Athlete', position: 'Forward' });
    for (const playerId of [null, 'p1']) {
      const { audit } = await build(playerId);
      expect(audit.violations, 'overflow').toHaveLength(0);
      expect(audit.clipped, 'clipped headings').toHaveLength(0);
      expect(audit.unencodable, 'unencodable characters').toHaveLength(0);
      expect(audit.collisions, 'text over text').toHaveLength(0);
    }
  });
});
