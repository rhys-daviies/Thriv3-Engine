/**
 * Render a validation packet as something a person can actually sit down with.
 *
 * Markdown, because it survives being emailed, printed, opened in any editor
 * and diffed - and because the operator surface for this exercise should cost
 * nothing to build and nothing to throw away. The JSON beside it is canonical;
 * this is a rendering of it, the same relationship A7.6 established between
 * reason codes and prose.
 *
 * THE DIVIDER IS LOAD-BEARING. Everything before it is the blind view and
 * contains no model output of any kind. A test asserts that the rendered
 * view-A text contains no rank, no layer value and no explanation sentence.
 */
import { CLASSIFICATION, REASON_TAG, VALIDATION_QUESTIONS, ADOPTION_BLOCKERS } from './rubric.js';

const CHECK = (labels) => labels.map((l) => `\`[ ]\` ${l}`).join('  ');
const CLASS_LINE = CHECK(Object.keys(CLASSIFICATION).map((k) => k.replace(/_/g, ' ')));
const TAG_KEYS = Object.keys(REASON_TAG);
const TAG_LEGEND = TAG_KEYS.map((k, i) => `**${i + 1}** ${REASON_TAG[k]}`).join(' · ');
/** Numbers rather than thirteen repeated labels: the legend sits once at the top of the view. */
const TAG_LINE = TAG_KEYS.map((_, i) => `\`[ ]\`${i + 1}`).join(' ');

/**
 * THE `Number(null) === 0` GUARD.
 *
 * Third occurrence of this bug in this codebase and the first one a reviewer
 * would have read as a fact: Penn State Scranton has no College Scorecard
 * match and therefore no academic rating, and the blind view printed
 * "Academics: rating 0.0" - a confident statement that a school is the worst
 * in the country, manufactured out of an absence. The same guard already
 * exists in opportunityComponents.js for exactly this reason.
 */
const stated = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
const money = (n) => (stated(n) ? `$${Math.round(Number(n)).toLocaleString('en-US')}` : '—');
const pct = (n) => (stated(n) ? `${Math.round(Number(n) * 100)}%` : '—');
const num = (n, d = 2) => (stated(n) ? Number(n).toFixed(d) : '—');
const or = (v, alt = '—') => (v === null || v === undefined || v === '' ? alt : v);

/** IPEDS `control`, spelled out. A reviewer should not have to know that 2 means private. */
const CONTROL_WORD = { 1: 'public', 2: 'private', 3: 'private for-profit' };

function factBlock(f) {
  if (!f) return '_No programme record._';
  const where = [f.city, f.state].filter(Boolean).join(', ');
  return [
    `**${f.name}** — ${f.division}${f.conference ? ` · ${f.conference}` : ''}${where ? ` · ${where}` : ''}${CONTROL_WORD[f.control] ? ` · ${CONTROL_WORD[f.control]}` : ''}`,
    `Programme strength ${or(num(f.programmeStrength, 1))}`
      + `${f.nationalRanking ? ` · national rank ${f.nationalRanking}` : ''}`
      + `${f.postseason2025 ? ` · 2025 postseason: ${f.postseason2025}` : ''}`
      + ` · win rate ${pct(f.recentWinPct)} (prior ${pct(f.priorWinPct)})`,
    `Academics: rating ${stated(f.academicRating) ? num(f.academicRating, 1) : 'not rated'} · SAT avg ${or(f.satAvg)} · admit rate ${pct(f.admitRate)}`,
    `Cost: net price ${money(f.netPrice)} · tuition in-state ${money(f.tuitionInState)} / out-of-state ${money(f.tuitionOutState)}`,
  ].join('  \n');
}

function athleteBlock(a) {
  const row = (k, v) => `| ${k} | ${or(v)} |`;
  return [
    '| input | value |', '|---|---|',
    row('sport', a.sport),
    row('sex', a.sex),
    row('position', a.position),
    row('ability rating (operator-assessed, 1-10)', a.abilityRating),
    row('calibrated athlete percentile', a.athletePercentile === null ? null : `${(a.athletePercentile * 100).toFixed(1)}th`),
    row('equivalent programme strength', a.equivalentProgrammeScore === null ? null : num(a.equivalentProgrammeScore, 1)),
    row('entry / recruiting class year', a.entryYear),
    row('eligibility basis', a.eligibilityBasis),
    row('GPA', a.gpa), row('SAT', a.sat), row('ACT', a.act),
    row('budget band (stated)', a.budgetRange),
    row('family contribution interval used', a.budgetInterval),
    row('domestic / international', a.origin),
    row('nationality', a.nationality),
    row('home state', a.state),
    row('recruit type', a.recruitType),
    row('competitive-level priority (1-5)', a.competitiveLevelPriority ?? 'UNDECLARED'),
    row('playing-opportunity priority (1-5)', a.playingOpportunityPriority ?? 'UNDECLARED'),
    row('intended major', a.intendedMajor ?? 'NOT COLLECTED'),
    row('preferred divisions', a.preferredDivisions?.length ? a.preferredDivisions.join(', ') : 'none (no division filter)'),
    row('preferred conferences', a.preferredConferences?.length ? a.preferredConferences.join(', ') : 'none'),
    row('legacy criterion ranking', a.criterionRanking?.length ? a.criterionRanking.join(' > ') : 'none'),
  ].join('\n');
}

function provenanceBlock(p) {
  const row = (k, v) => `| ${k} | \`${or(v)}\` |`;
  return [
    '| pinned to | value |', '|---|---|',
    row('V2 model commit', p.v2Commit),
    row('explanation commit', p.explanationCommit),
    row('V1 freeze commit', p.v1FreezeCommit),
    row('ability calibration', p.calibrationId),
    row('positional norms digest', p.positionalNormsDigest),
    row('playing norms digest', p.playingNormsDigest),
    row('pursuit weights', `R ${p.weights.recruitability} · F ${p.weights.financial} · O ${p.weights.opportunity}`),
    row('recruitability gate', `floor ${p.gates.recruitability.floor}, threshold ${p.gates.recruitability.threshold}`),
    row('financial gate', `floor ${p.gates.financial.floor}, threshold ${p.gates.financial.threshold}`),
    row('weighting architecture', p.weightingArchitecture),
    row('roster season', p.rosterSeason),
    row('fixture digest', p.fixtureDigest),
    row('pool digest', p.poolDigest),
    row('generated', p.generatedAt),
  ].join('\n');
}

function viewAProgramme(p) {
  return [
    `### ${p.reviewNo}. ${p.facts?.name ?? p.id}`,
    '',
    factBlock(p.facts),
    '',
    `Classification: ${CLASS_LINE}`,
    '',
    `Reasons: ${TAG_LINE}`,
    '',
    'Notes: ______________________________________________________________',
    '',
  ].join('\n');
}

function viewBProgramme(p) {
  const m = p.model;
  const head = m.rankingState === 'RANKED'
    ? `**#${p.rank}** of ${p.division} · priority **${num(m.pursuitPriority, 3)}**`
      + ` · R ${num(m.recruitability)} · F ${num(m.financial)} · O ${num(m.opportunity)}`
      + ` · gates gR ${num(m.recruitabilityGate)} gF ${num(m.financialGate)}`
    : `**${m.rankingState}** · missing ${m.missingLayers.join(' + ') || '—'}`
      + ` · known R ${or(num(m.recruitability))} F ${or(num(m.financial))} O ${or(num(m.opportunity))}`;
  const out = [
    `### ${p.reviewNo}. ${p.name} — ${p.division}`,
    '',
    head,
    `V1 rank ${or(p.v1Rank)} · programme strength ${or(num(p.programmeStrength, 1))} · sampled as: ${p.strata.join(', ')}`,
  ];
  if (p.standing) {
    out.push(`Standing: rank ${p.standing.rank} of ${p.standing.outOf} ranked · absolute strength ${p.standing.absoluteStrength}`
      + `${p.standing.rankAloneIsMisleading ? ' · **rank alone is misleading here**' : ''}`);
  }
  if (p.layerSummary) {
    out.push(`Bands: ${p.layerSummary.layers.map((l) => `${l.layer} ${l.band}`).join(' · ')}`
      + ` — strongest ${p.layerSummary.strongest}, weakest ${p.layerSummary.weakest}`);
  }
  out.push('', 'Explanation as the operator would see it:', '');
  for (const line of p.explanation.lines) out.push(`- ${line}`);
  for (const g of p.explanation.gates) out.push(`- _gate:_ ${g}`);
  for (const c of p.explanation.checks) out.push(`- _next check:_ ${c}`);
  out.push('', `Evidence: ${p.explanation.evidenceQuality.map((e) => `${e.layer} ${e.quality} (coverage ${num(e.coverage)})`).join(' · ')}`);
  out.push('', `Movement: ${p.movement.sentence}`);
  if (p.ambitionSensitivity) {
    const a = p.ambitionSensitivity;
    out.push('', `Rank under each ambition profile — undeclared ${or(a.undeclared)} · level-first ${or(a.levelFirst)} · playing-first ${or(a.playingFirst)}`);
  }
  out.push('', `Explanation review — HELPFUL: ${CHECK(['YES', 'PARTLY', 'NO'])}   ACCURATE: ${CHECK(['YES', 'PARTLY', 'NO'])}   TOO MUCH DETAIL: ${CHECK(['YES', 'NO'])}`);
  out.push('', 'Missing important reason: ________________________________________');
  out.push('', 'Misleading claim: _______________________________________________');
  out.push('');
  return out.join('\n');
}

function distributionBlock(d) {
  const comp = (o) => Object.entries(o ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') || '—';
  const p = d.pursuitPriority ?? {};
  return [
    `Pool ${d.poolSize} programmes — **RANKED ${d.ranked}**, **LIMITED DATA ${d.limitedData}**, ineligible ${d.ineligible}, suppressed ${d.suppressed}.`,
    '',
    `Pursuit priority across the ranked pool: p10 ${num(p.p10, 3)} · p25 ${num(p.p25, 3)} · **median ${num(p.median, 3)}** · p75 ${num(p.p75, 3)} · p90 ${num(p.p90, 3)} · max ${num(p.max, 3)}`,
    d.poolMostlyOutOfReach
      ? '\n> **Most of this athlete\'s pool is out of reach.** The median programme scores below 0.10, so a rank here says more about the shortlist than about any one school. Read the classifications as "would I contact this", not "is this good".\n'
      : '',
    `Compression: ${pct(d.compression?.below005)} of ranked programmes below 0.05, ${pct(d.compression?.above090)} above 0.90.`,
    '',
    `Gates fired in the ranked pool: recruitability ${pct(d.gateFiringRate?.recruitability)} · financial ${pct(d.gateFiringRate?.financial)}.`,
    '',
    `Correlation of programme strength with: priority ${or(d.programmeStrengthInfluence?.pursuitPriority)} · R ${or(d.programmeStrengthInfluence?.recruitability)} · F ${or(d.programmeStrengthInfluence?.financial)} · O ${or(d.programmeStrengthInfluence?.opportunity)}.`,
    '',
    `Top 100 by division: ${comp(d.topComposition)}`,
    `Top 25 by division: ${comp(d.top25Composition)}`,
    `Limited data by division: ${comp(d.limitedComposition)}`,
    `Limited because: ${comp(d.limitedReasons)}`,
  ].join('\n');
}

export function renderPack(pack) {
  const out = [];
  const w = (...lines) => out.push(...lines);

  w(`# V2 validation pack — ${pack.packId}`, '');
  w(`_${pack.athlete.label}_`, '');
  w('This pack has two halves. **Do not read the second half until the first is finished.**',
    'The first half asks you what you would do. The second half shows you what the model did.',
    'If you read them the other way round the exercise measures nothing.', '');
  w('## Pinned to', '', provenanceBlock(pack.provenance), '');
  w('---', '');

  w('# VIEW A — HUMAN FIRST', '');
  w('Below is one athlete and a list of programmes, in no particular order.',
    `For each one, say what you would do. ${pack.sample.size} programmes.`, '');
  w('Classification meanings:', '',
    '- **PURSUE STRONGLY** — on the first outreach list, this week.',
    '- **PURSUE** — worth contacting.',
    '- **BORDERLINE / CONTEXT DEPENDENT** — depends on something you would need to check or ask.',
    '- **LOW PRIORITY** — would contact only after the others.',
    '- **WOULD NOT CURRENTLY PURSUE** — would not email this school for this athlete.',
    '- **INSUFFICIENT INFORMATION** — you cannot say. This is not a mild answer; it means the question cannot be answered from what is here.', '');
  w('## The athlete', '', athleteBlock(pack.athlete), '');
  /**
   * Only NEUTRAL notes here. A fixture's `why` says what the model is expected
   * to do with it - "the pathology fixture", "what rank an elite programme
   * reaches here is the number the ceiling exists to move" - and printing that
   * above the blind list tells the reviewer the answer before they start. It
   * appears in View B instead. This was in the first generated pack.
   */
  if (pack.athlete.notes?.length) {
    w('', ...pack.athlete.notes.map((n) => `> ${n}`), '');
  }
  w('## Programmes', '');
  w(`Reason numbers: ${TAG_LEGEND}`, '');
  for (const p of pack.viewA.programmes) w(viewAProgramme(p));

  w('', '---', '', '# STOP', '',
    'Finish View A before continuing. Once you have read below, this pack can no longer produce a blind review.',
    '', '---', '');

  w('# VIEW B — MODEL REVEAL', '');
  if (pack.whyThisAthlete) {
    w('## Why this athlete is in the set', '', `> ${pack.whyThisAthlete}`, '',
      '_Withheld from View A on purpose: it says what the model is expected to do._', '');
  }
  w('## Distribution context', '', distributionBlock(pack.distribution), '');
  if (pack.ambition) {
    w('## The same athlete under each ambition profile', '');
    w('| profile | top 100 by division | median programme strength, top 100 | corr(strength, priority) |', '|---|---|---|---|');
    for (const [k, v] of Object.entries(pack.ambition.profiles)) {
      w(`| ${k} (${v.label}) | ${Object.entries(v.topComposition).map(([d, n]) => `${d} ${n}`).join(', ')} | ${or(v.medianProgrammeStrengthTop100)} | ${or(v.programmeStrengthCorrelation)} |`);
    }
    w('', `Top-100 overlap: level-first vs playing-first **${pack.ambition.levelVsPlayingJaccard}** · undeclared vs level-first ${pack.ambition.undeclaredVsLevelJaccard} · undeclared vs playing-first ${pack.ambition.undeclaredVsPlayingJaccard}.`,
      '', '_A Jaccard of 1.0 would mean declaring an ambition changed nothing._', '');
  }
  if (pack.v1Comparison) {
    const c = pack.v1Comparison;
    w('## Against frozen V1', '');
    w(`Ranks only — ${c.note}`, '');
    w(`Top 100: ${c.overlapTop100} shared, ${c.enteredTop100} entered, ${c.leftTop100} left. ${c.v1Top100NowLimitedData} of V1's top 100 are now LIMITED DATA.`, '');
    w('| V1 rank | programme | division | V2 |', '|---|---|---|---|');
    for (const r of c.v1Top10) w(`| ${r.v1Rank} | ${r.name} | ${r.division} | ${r.v2Rank ? `#${r.v2Rank}` : r.v2State} |`);
    w('');
  }
  w('## The same programmes, as V2 ranked them', '');
  w('_Numbered as in View A, ordered by V2 rank._', '');
  for (const p of pack.viewB.programmes) w(viewBProgramme(p));

  w('---', '', '## After the reveal', '');
  w('For each programme where you and V2 disagree, say which of these it is:', '',
    '- **MODEL BUG** — the evidence or the arithmetic is wrong.',
    '- **DATA GAP** — the model could not know; Thriv3 does not hold the data.',
    '- **INPUT GAP** — we never asked the athlete something that matters.',
    '- **HUMAN JUDGEMENT** — you know something the model does not represent.',
    '- **EXPLANATION DEFECT** — the score is fair and the sentence is not.',
    '- **ACCEPTABLE DIFFERENCE** — neither ordering is better.', '');
  w('### The questions this pack exists to answer', '');
  for (const q of VALIDATION_QUESTIONS) w(`**${q.id}.** ${q.question}  \n_Where to look: ${q.evidence}_  \nAnswer: ______________________________________________`, '');
  w('### Red flags', '',
    'These are PROPOSED lines, not agreed ones. Say whether each is the right line.', '');
  for (const b of ADOPTION_BLOCKERS) {
    w(`- **${b.id}** (${b.severity}) — ${b.statement}  \n  _Trigger:_ ${b.trigger}  \n  _Right line?_ \`[ ]\` yes \`[ ]\` no — ____________________`);
  }
  w('');
  w('### Overall', '',
    'Would you send an athlete this list? \`[ ]\` yes  \`[ ]\` yes with changes  \`[ ]\` no',
    '', 'What would you change first? ______________________________________', '');
  w(`Reviewer: ____________________   Date: ____________   Pack: \`${pack.packId}\``, '');

  return out.join('\n');
}

/**
 * Just the blind half, from the view-A heading to the divider.
 *
 * The pack HEADER is excluded deliberately: it carries the pinned weights and
 * gate parameters, which identify the model but say nothing about any
 * programme's answer. What must not leak is this athlete's outputs, and that
 * is exactly the span this returns.
 */
export function renderViewA(pack) {
  const md = renderPack(pack);
  return md.slice(md.indexOf('# VIEW A'), md.indexOf('\n# STOP\n'));
}
