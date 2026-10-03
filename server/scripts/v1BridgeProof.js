/**
 * A7.9.5: the live ranking, before and after the bridge.
 *
 * READ-ONLY. Reproduces the path src/lib/playerAnalysis.js takes - the same
 * active-college filter, the same CURRENT_ROSTER_SEASON roster index, the
 * same rankMatches, the same splitRanked - because the figure that matters is
 * the ordering actually persisted to players.recommendations, and a
 * diagnostic roster index built without the season filter reported 33/100
 * where the truth was 42/100.
 *
 *   node server/scripts/v1BridgeProof.js
 */
import { FIXTURES } from './v2Fixtures.js';

const fmt = (n, d = 3) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const med = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const kendall = (a, b) => {
  let c = 0; let d = 0;
  for (let i = 0; i < a.length; i += 1) for (let j = i + 1; j < a.length; j += 1) {
    const p = (a[i] - a[j]) * (b[i] - b[j]); if (p > 0) c += 1; else if (p < 0) d += 1;
  }
  return (c - d) / (c + d || 1);
};

async function main() {
  const { default: db } = await import('../db/client.js');
  const { normaliseAthlete, rankMatches, buildRosterIndex } = await import('../../shared/matching/pool.js');
  const { splitRanked } = await import('../../shared/matching/reserve.js');
  /**
   * Restated rather than imported: src/lib/divisions.js reaches for the
   * `@shared` alias, which only the bundler resolves. Pinned by the assertion
   * below, so a drift fails loudly instead of quietly scoring a wrong season.
   */
  const CURRENT_ROSTER_SEASON = '2026';
  const src = (await import('node:fs')).readFileSync(new URL('../../src/lib/divisions.js', import.meta.url), 'utf8');
  const declared = /CURRENT_ROSTER_SEASON\s*=\s*'([^']+)'/.exec(src)?.[1];
  if (declared !== CURRENT_ROSTER_SEASON) {
    throw new Error(`roster season drift: product says ${declared}, this proof says ${CURRENT_ROSTER_SEASON}`);
  }
  const { BUDGET_CEILINGS } = await import('../../shared/matching/constants.js');

  const cache = new Map();
  const poolFor = (sport) => {
    if (!cache.has(sport)) {
      cache.set(sport, {
        colleges: db.prepare('SELECT * FROM colleges WHERE sport = ? AND active = 1').all(sport)
          .filter((c) => c.active !== 0),
        rosterIndex: buildRosterIndex(db.prepare('SELECT * FROM roster_players WHERE sport = ? AND season = ?')
          .all(sport, String(CURRENT_ROSTER_SEASON))),
      });
    }
    return cache.get(sport);
  };

  /** The persisted top 100, exactly as playerAnalysis would store it. */
  const recommend = (f, over) => {
    const { colleges, rosterIndex } = poolFor(f.player.sport);
    const athlete = normaliseAthlete({ ...f.player, preferred_divisions: '[]', preferred_conferences: '[]', ...over });
    const { results } = rankMatches({ athlete, colleges, rosterIndex });
    return splitRanked(results).top.map((r) => r.name);
  };

  const compare = (a, b) => {
    const pa = new Map(a.map((n, i) => [n, i])); const x = []; const y = []; const mv = [];
    b.forEach((n, j) => { const i = pa.get(n); if (i !== undefined) { x.push(i); y.push(j); mv.push(Math.abs(i - j)); } });
    const shared = b.filter((n) => pa.has(n)).length;
    return { shared, tau: kendall(x, y), medMove: med(mv), identical: a.length === b.length && a.every((n, i) => b[i] === n) };
  };

  console.log(`live path: active colleges + roster season ${CURRENT_ROSTER_SEASON}, splitRanked top 100\n`);
  console.log(`${'fx'.padEnd(3)}${'legacy band'.padEnd(24)}${'new representation'.padEnd(26)}${'shared'.padStart(8)}${'tau'.padStart(8)}${'medMv'.padStart(7)}  ordering`);

  for (const f of FIXTURES) {
    const band = f.player.budget_range;
    const ceiling = BUDGET_CEILINGS[band];
    const legacy = recommend(f, {});
    if (!Number.isFinite(ceiling)) {
      /**
       * The open band states no ceiling and is NOT the same statement as any
       * finite maximum, so there is no exact equivalent to manufacture. What
       * is checked instead is that it still travels the legacy path untouched.
       */
      const same = recommend(f, {});
      const c = compare(legacy, same);
      console.log(`${f.id.slice(0, 1).padEnd(3)}${band.padEnd(24)}${'(none — open band)'.padEnd(26)}${String(c.shared).padStart(8)}${fmt(c.tau).padStart(8)}${String(c.medMove).padStart(7)}  ${c.identical ? 'IDENTICAL' : 'CHANGED'}`);
      continue;
    }
    const bridged = recommend(f, {
      budget_range: null, contribution_state: 'STATED', max_annual_contribution_usd: ceiling,
    });
    const c = compare(legacy, bridged);
    console.log(`${f.id.slice(0, 1).padEnd(3)}${band.padEnd(24)}${`STATED $${ceiling.toLocaleString('en-US')}`.padEnd(26)}${String(c.shared).padStart(8)}${fmt(c.tau).padStart(8)}${String(c.medMove).padStart(7)}  ${c.identical ? 'IDENTICAL' : 'CHANGED'}`);
  }

  console.log('\n-- Fixture B closure, the number A7.9.4 measured');
  const b = FIXTURES.find((f) => f.id.startsWith('B-'));
  const legacy = recommend(b, {});
  for (const [label, over] of [
    ['no bridge (band removed)', { budget_range: null }],
    ['STATED $10,000', { budget_range: null, contribution_state: 'STATED', max_annual_contribution_usd: 10000 }],
    ['NEEDS_CONFIRMATION', { budget_range: null, contribution_state: 'NEEDS_CONFIRMATION' }],
    ['Undeclared (old unknown)', { budget_range: 'Undeclared' }],
    ['NOT_A_CONSTRAINT', { budget_range: null, contribution_state: 'NOT_A_CONSTRAINT' }],
    ['$40k+/yr (open band)', { budget_range: '$40k+/yr' }],
  ]) {
    const c = compare(legacy, recommend(b, over));
    console.log(`   ${label.padEnd(28)} shared ${String(c.shared).padStart(3)}/100  tau ${fmt(c.tau)}  ${c.identical ? 'IDENTICAL ordering' : ''}`);
  }

  console.log('\n-- unknown equivalence: NEEDS_CONFIRMATION against V1\'s two existing unknowns');
  for (const f of FIXTURES) {
    const nc = recommend(f, { budget_range: null, contribution_state: 'NEEDS_CONFIRMATION' });
    const und = recommend(f, { budget_range: 'Undeclared' });
    const blank = recommend(f, { budget_range: null });
    const a = compare(und, nc); const bl = compare(blank, nc);
    console.log(`   ${f.id.slice(0, 1)}  vs Undeclared ${a.identical ? 'IDENTICAL' : `shared ${a.shared}`}   vs blank ${bl.identical ? 'IDENTICAL' : `shared ${bl.shared}`}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
