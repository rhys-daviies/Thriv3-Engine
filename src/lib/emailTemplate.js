// Relative, not the `@shared` alias: this module is the one file under src/
// that a Node CLI loads (server/scripts/draftOutreach.js imports it), and Node
// cannot resolve a Vite alias. When this was an alias `npm run draft` died on
// ERR_MODULE_NOT_FOUND while the app carried on working, so nothing noticed.
import { classYearOf } from '../../shared/athlete.js';
import { positionLabel, positionNoun, positionPlural } from '../../shared/positions.js';
import { UNDECLARED_BUDGET } from '../../shared/matching/constants.js';
import { majorLabelFor } from '../../shared/academicMajors.js';
import { conferenceLabel } from '../../shared/conference.js';
import { evidenceParagraph } from '../../shared/evidence/index.js';
import { SLOT_TOKENS } from '../../shared/email/blocks.js';

// Section 11: The Email Template System — ported exactly.

/** Soccer's own postseason round names -- see postseason_round_label below. */
const POSTSEASON_ROUND_LABELS = {
  appearance: 'made the postseason',
  r32: 'reached the Round of 32',
  r16: 'reached the Round of 16',
  quarter: 'reached the quarterfinals',
  semi: 'reached the semifinals',
  final: 'reached the championship game',
  champion: 'won the national championship',
};

export const TEMPLATE_VARIABLES = [
  { token: 'coach_name', label: 'Coach Name' },
  { token: 'college_name', label: 'College Name' },
  { token: 'college_division', label: 'Division' },
  { token: 'college_conference', label: 'Conference' },
  { token: 'college_location', label: 'Location' },
  { token: 'college_nickname', label: 'Team Nickname' },
  { token: 'college_mascot', label: 'Mascot' },
  { token: 'college_nickname_have', label: 'Have/Has (use with the nickname as subject)' },
  { token: 'college_nickname_are', label: 'Are/Is (use with the nickname as subject)' },
  {
    token: 'has_mascot',
    label: 'If mascot known… (conditional sentence)',
    snippet: '{{#if has_mascot}}I can\'t wait to represent the {{college_mascot}}.{{/if}}',
  },
  {
    token: 'has_real_nickname',
    label: 'If nickname known… (conditional sentence)',
    snippet: '{{#if has_real_nickname}}Go {{college_nickname}}!{{/if}}',
  },
  { token: 'conference_champion_name', label: 'Conference Won (2025)' },
  {
    token: 'is_conference_champion',
    label: 'If 2025 conference champs… (conditional sentence)',
    snippet: '{{#if is_conference_champion}}Congratulations on winning the {{conference_champion_name}} last year!{{/if}}',
  },
  { token: 'postseason_round_label', label: '2025 Postseason Result (e.g. "reached the semifinals")' },
  {
    token: 'has_postseason_result',
    label: 'If the program reached the postseason in 2025… (conditional sentence)',
    snippet: '{{#if has_postseason_result}}Congratulations, you {{postseason_round_label}} this past season.{{/if}}',
  },
  { token: 'graduating_seniors_count', label: 'Graduating Seniors Count' },
  { token: 'graduating_seniors_names', label: 'Graduating Seniors Names' },
  { token: 'graduating_seniors_position', label: 'Position word agreeing with that count (defender / defenders)' },
  {
    token: 'has_graduating_seniors',
    label: 'If anyone is graduating at the position… (conditional sentence)',
    snippet: '{{#if has_graduating_seniors}}{{graduating_seniors_count}} {{graduating_seniors_position}} graduating.{{/if}}',
  },
  {
    token: 'has_graduating_names',
    label: 'If those names were verified… (conditional sentence)',
    snippet: '{{#if has_graduating_names}} {{graduating_seniors_names}}{{/if}}',
  },
  { token: 'graduating_starters_count', label: 'Graduating Starters Count' },
  { token: 'graduating_starters_names', label: 'Graduating Starters Names' },
  { token: 'graduating_total_count', label: 'Total Graduating, Whole Squad' },
  {
    token: 'has_graduating_total',
    label: 'If anyone at all is graduating… (conditional sentence)',
    snippet: '{{#if has_graduating_total}}{{graduating_total_count}} players are graduating across the squad.{{/if}}',
  },
  {
    token: 'evidence_paragraph',
    label: 'Program Evidence — the strongest verified reasons to write (auto-selected)',
    snippet: '{{#if has_evidence}}{{evidence_paragraph}}{{/if}}',
  },
  {
    token: 'evidence_primary',
    label: 'Program Evidence — the single strongest reason only',
    snippet: '{{#if has_evidence_primary}}{{evidence_primary}}{{/if}}',
  },
  { token: 'has_evidence', label: 'If any program evidence was found… (conditional)' },
  { token: 'has_evidence_primary', label: 'If a leading piece of evidence was found… (conditional)' },
  { token: 'evidence_structure', label: 'Which email structure the evidence engine chose' },
  // The per-slot evidence tokens are deliberately NOT offered to operators as
  // template variables. They are filled by shared/email/compose.js, which
  // decides how many clauses a slot holds and where that slot sits; a template
  // that hardcoded {{evidence_lead}} would be asserting a placement the
  // structure had not chosen. They resolve in the context so a structured
  // body renders, and they are absent from this list so nothing offers them.

  { token: 'international_players_count', label: 'International Players on Roster' },
  {
    token: 'has_international_players',
    label: 'If the roster has any international players… (conditional sentence)',
    snippet: '{{#if has_international_players}}We currently have {{international_players_count}} international players on the roster.{{/if}}',
  },
  { token: 'players_from_country_count', label: "Players From the Recruit's Own Country" },
  {
    token: 'has_players_from_country',
    label: "If a teammate already shares the recruit's country… (conditional sentence)",
    snippet: '{{#if has_players_from_country}}We currently have players from {{player_nationality}} on the roster.{{/if}}',
  },
  { token: 'player_name', label: 'Player Name' },
  { token: 'player_first_name', label: 'Player First Name (for use after the introduction)' },
  { token: 'player_position', label: 'Player Position' },
  { token: 'player_position_plural', label: 'Position, plural (defenders)' },
  { token: 'player_secondary_position', label: 'Secondary Position' },
  { token: 'player_nationality', label: 'Nationality (New Zealand)' },
  { token: 'has_nationality', label: 'If a nationality is on file… (conditional)' },
  { token: 'player_gpa', label: 'GPA' },
  { token: 'has_gpa', label: 'If a GPA is on file… (conditional line)' },
  { token: 'has_sat_score', label: 'If an SAT is on file… (conditional line)' },
  { token: 'has_act_score', label: 'If an ACT is on file… (conditional line)' },
  { token: 'player_sat_score', label: 'SAT Score' },
  { token: 'player_act_score', label: 'ACT Score' },
  { token: 'player_yearly_budget', label: 'Annual Budget' },
  { token: 'has_yearly_budget', label: 'If a budget band is set… (conditional line)' },
  { token: 'player_class_year', label: 'Class Year (arrival)' },
  { token: 'player_profile_url', label: 'Tracked Profile Link' },
  { token: 'intended_major_label', label: "Recruit's Intended Major, Matched to a Notable Program" },
  {
    token: 'offers_intended_major',
    label: "If the school notably offers the recruit's intended major… (conditional sentence)",
    snippet: '{{#if offers_intended_major}}We also have a strong {{intended_major_label}} program.{{/if}}',
  },
];

/**
 * Scannable rather than clever. A coach triaging an inbox filters on class
 * year and position before anything else, so both are in front of the name.
 */
export const DEFAULT_EMAIL_SUBJECT = '{{player_name}} | {{player_position}} | {{player_class_year}} | Striv3 Recruitment';

/**
 * The pilot template, in the operator's own shape.
 *
 * Four things differ from the version it was written from, and each is a
 * token that did not resolve or a sentence that broke on real data:
 *
 *   {{position}} and {{graduation_year}} do not exist — the real names are
 *   {{player_position}} and {{player_class_year}}. Unknown tokens are left
 *   as written rather than blanked, so both reached coaches in braces.
 *
 *   "{{player_position}} / {{player_secondary_position}}" doubles the
 *   separator: the token already emits " / Midfielder", so a slash beside it
 *   rendered "Defender / " with nothing after it for an athlete with no
 *   secondary position.
 *
 *   "{{graduating_seniors_count}} {{player_position|lowercase}}" reads
 *   "4 defender". {{graduating_seniors_position}} agrees with the count.
 *
 *   That whole sentence is now inside a conditional. At a programme losing
 *   nobody at the position it read "0 defenders graduating this season, names
 *   could not be verified from official sources" — true, and not something to
 *   say to a coach about his own roster.
 *
 * The programme sentence comes from the evidence engine where one is supplied
 * (shared/evidence), which picks the strongest of several angles rather than
 * always reaching for the graduating cohort — a programme with two New
 * Zealanders in its recent history is a better reason to write than one
 * defender leaving. The old hardcoded sentence survives as the {{else}}
 * branch, because a caller with no evidence (the browser before the lookup
 * returns, or after it fails) must still send the email it always sent rather
 * than a worse one.
 *
 * The GPA, SAT and budget lines are each gated on having something to say.
 * Unggated they sent "GPA: N/A" and "Annual Budget: Undeclared" — Undeclared
 * being the absence of a budget rather than one. A line that is simply absent
 * reads better than a placeholder admitting we do not know.
 *
 * Blank lines are deliberate. The body is rendered as HTML at compose time,
 * where a blank line is a paragraph and a single newline a line break; without
 * them the message arrives as one block, which is how it used to look.
 */
export const DEFAULT_EMAIL_TEMPLATE = `Hi {{coach_name}},

I'm reaching out regarding {{player_name}}, a {{player_position|lowercase}}{{#if has_nationality}} from {{player_nationality}}{{/if}} who is exploring opportunities for the {{player_class_year}} recruiting class.

{{player_name}} — {{player_position}}

Recruiting Profile
• Position: {{player_position}}{{player_secondary_position}}
• Graduation: {{player_class_year}}{{#if has_gpa}}
• GPA: {{player_gpa}}{{/if}}{{#if has_sat_score}}
• SAT: {{player_sat_score}}{{/if}}{{#if has_yearly_budget}}
• Annual Budget: {{player_yearly_budget}}{{/if}}

Profile and highlight film:
{{player_profile_url}}
{{#if has_evidence}}
{{evidence_paragraph}}

We believe {{player_name}} could be an interesting fit for {{college_name}}.
{{else}}{{#if has_graduating_seniors}}
We believe {{player_name}} could be an interesting fit for {{college_name}}, particularly with {{graduating_seniors_count}} {{graduating_seniors_position}} graduating this season{{#if has_graduating_names}} {{graduating_seniors_names}}{{/if}}.
{{/if}}{{/if}}
Given your current roster and {{college_name}}'s needs, we'd love to hear your thoughts on whether {{player_name}} could be a potential fit for your programme.

Would you be open to taking a look at the profile and highlight film? If there's interest you can contact me directly via WhatsApp [[+64 21 920 775](tel:+6421920775)] to chat more.

Best regards,
Rhys Davies
Striv3 Elite Sports Management`;

function formatNameList(names) {
  const list = (names || []).filter(Boolean);
  if (list.length === 0) return 'names could not be verified from official sources';
  if (list.length === 1) return `(${list[0]})`;
  if (list.length === 2) return `(${list[0]} and ${list[1]})`;
  return `(${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]})`;
}

/**
 * Builds the token-resolution context from the player profile, a matched
 * college/CollegeCard result object, and the specific coach being addressed.
 */
/**
 * The graduating-cohort numbers, under either name they travel by.
 *
 * `rankMatches` emits `graduating_at_position`; this file was written against
 * `graduating_seniors_at_position`, and `playerAnalysis.js` bridged the two on
 * the way through. Anything calling `buildEmailContext` with a rankMatches row
 * directly therefore got `undefined`, read it as zero, and dropped the
 * sentence — which is exactly what `server/scripts/draftOutreach.js` does, so
 * every emailed draft was silently missing its roster paragraph. Evansville
 * has four defenders graduating and the draft said nothing about them.
 *
 * Both names are read rather than one being renamed away, and that is
 * permanent rather than transitional: `players.recommendations` holds stored
 * JSON blobs written under the legacy names, and an athlete analysed last week
 * must keep rendering.
 */
function graduatingAtPosition(college) {
  return {
    count: college.graduating_at_position
      ?? college.graduating_seniors_at_position
      ?? 0,
    names: (college.graduating_names_at_position
      ?? college.graduating_senior_names_at_position
      ?? []).filter(Boolean),
    starters: college.graduating_starters_at_position ?? 0,
    starterNames: (college.graduating_starter_names_at_position ?? []).filter(Boolean),
  };
}

/**
 * @param {object} [options.evidence]  a `selectEvidence()` result. Optional
 *   throughout: with none supplied every token below resolves exactly as it
 *   did before the evidence engine existed, which is what keeps the browser
 *   composer — which cannot load five seasons of roster history — working
 *   unchanged.
 */
export function buildEmailContext(player, college, coachName, { profileUrl = null, evidence = null } = {}) {
  const secondary = player.secondary_position && player.secondary_position !== 'None'
    ? ` / ${positionLabel(player.secondary_position)}`
    : '';

  const grad = graduatingAtPosition(college);
  const gradCount = grad.count;
  const gradNames = grad.names;

  // Rendered by the evidence engine, which picked the renderer appropriate to
  // each piece's tier. Deliberately not re-derived here: a template must not
  // be able to turn a projection into a plain assertion by choosing a
  // different token, so there is exactly one evidence paragraph and the engine
  // decided how firmly it speaks.
  // Prefers the paragraph the engine already rendered. Across the network the
  // browser receives that string and no evidence objects at all, so the
  // fallback only fires for an in-process caller holding real ones.
  const evidenceSentences = evidence?.sentences ?? [];
  const evidenceText = evidence?.paragraph
    ?? (evidence ? evidenceParagraph(evidence.selected ?? []) : '');

  // Matches the recruit's own free-text intended_major against this school's
  // notable_majors (see shared/academicMajors.js) -- gated on an actual match
  // rather than firing for every recruit with any major typed in, so the
  // sentence is never sent to a school that does not meaningfully offer it.
  const majorLabel = majorLabelFor(player.intended_major);
  const intendedMajorLabel = majorLabel && (college.notable_majors || []).includes(majorLabel) ? majorLabel : '';

  return {
    coach_name: coachName || 'Coach',
    college_name: college.name || '',
    college_division: college.division || '',
    college_conference: conferenceLabel(college.conference),
    // Derived from city and state, which are populated, rather than read from
    // colleges.location, which is empty on all 2,374 rows — so this token
    // rendered as nothing for every school. The card already prefers
    // city + state for the same reason.
    college_location: [college.city, college.state].filter(Boolean).join(', ') || college.location || '',
    // Falls back to the plain school name so a template referencing the
    // nickname never reads broken for a school we haven't backfilled yet.
    college_nickname: college.nickname || college.name || '',
    college_mascot: college.mascot || '',
    // For templates that use the nickname as the sentence's own subject
    // ("{{college_nickname}} {{college_nickname_have}} real depth..."),
    // where "have"/"has" has to agree with whether the nickname reads as
    // plural ("Blue Devils") or singular ("Cardinal"). Defaults to singular
    // when we don't know (nickname missing, or not yet classified) since
    // that's what agrees with the college_name fallback above.
    // Gated on the nickname as well as the flag, which is what the note above
    // always claimed and the code did not do: with no nickname the display
    // value falls back to the singular school name, so agreeing with a stale
    // plural flag would read "the SMU have real depth". No row is in that
    // state today — the two columns are always written together — but
    // clearing a wrong nickname without clearing the flag would create one.
    college_nickname_have: college.nickname && college.nickname_plural ? 'have' : 'has',
    college_nickname_are: college.nickname && college.nickname_plural ? 'are' : 'is',
    // college_nickname above always resolves (it falls back to the plain
    // school name), so it can't be used to gate a {{#if}} block on whether
    // we actually HAVE a real nickname -- these two exist for exactly that,
    // checking the underlying data rather than the display value.
    has_real_nickname: college.nickname ? 'true' : '',
    has_mascot: college.mascot ? 'true' : '',
    // Kept separate from college_conference (which can be stale after
    // realignment) -- this is whichever conference Wikipedia's own 2025
    // results actually credited the win to, so the sentence stays correct
    // even when that drifts from our stored conference field.
    conference_champion_name: conferenceLabel(college.conference_champion_name),
    is_conference_champion: college.conference_champion_2025 ? 'true' : '',
    // Soccer's own round names, not basketball's -- there is no "Sweet 16" in
    // an NCAA soccer bracket, and borrowing one would read as a mistake to
    // anyone who follows the sport. "Appearance" means qualified and lost the
    // first game, so it reads as having made the postseason at all rather
    // than claiming a specific round.
    postseason_round_label: POSTSEASON_ROUND_LABELS[college.postseason_2025_round] || '',
    has_postseason_result: college.postseason_2025_round ? 'true' : '',
    // Gates for the two ways this sentence goes wrong on a thin school: no
    // graduating players at the position ("0 defenders graduating"), and a
    // programme whose names we could not read, where the name list renders as
    // "names could not be verified from official sources" — true, and not
    // something to say to a coach about his own roster.
    has_graduating_seniors: gradCount > 0 ? 'true' : '',
    has_graduating_names: gradNames.length > 0 ? 'true' : '',
    graduating_seniors_count: String(gradCount),
    // Agrees with the count beside it. "{{graduating_seniors_count}}
    // {{player_position_plural}}" reads "1 defenders" at the 14 schools in a
    // typical top 100 that are losing exactly one, and a coach reading his own
    // roster back at him ungrammatically is the wrong first impression. Zero
    // takes the plural, which is correct: "0 defenders".
    graduating_seniors_position: gradCount === 1
      ? positionNoun(player.position)
      : positionPlural(player.position),
    graduating_seniors_names: formatNameList(gradNames),
    graduating_starters_count: String(grad.starters),
    graduating_starters_names: formatNameList(grad.starterNames),
    // Squad-wide, every position — a different number from the four above and
    // carried through pool.js since 2026-08-25 without anything reading it.
    graduating_total_count: String(college.graduating_total ?? 0),
    has_graduating_total: (college.graduating_total ?? 0) > 0 ? 'true' : '',
    // ---- evidence engine ----
    // Empty when no evidence was supplied, so a template carrying these tokens
    // renders as it always did rather than leaving a hole.
    evidence_paragraph: evidenceText,
    has_evidence: evidenceText ? 'true' : '',
    evidence_primary: evidenceSentences[0]
      ? `${evidenceSentences[0].text[0].toUpperCase()}${evidenceSentences[0].text.slice(1)}.`
      : '',
    has_evidence_primary: evidenceSentences[0] ? 'true' : '',
    evidence_structure: structureKeyOf(evidence) ?? '',
    // One token per evidence slot the structure defined, each already a
    // finished paragraph of server-rendered clauses. Always present, always a
    // string: a structured body drops the blocks it has nothing for, and a
    // saved template that never mentions them is unaffected either way.
    ...evidenceSlotTokens(evidence),
    // Sourced from shared/matching/pool.js's roster aggregation (international
    // count + same-country count), already computed for the international-fit
    // scoring criterion -- these just expose the same two numbers as tokens.
    international_players_count: String(college.international_players ?? 0),
    has_international_players: (college.international_players ?? 0) > 0 ? 'true' : '',
    players_from_country_count: String(college.players_from_country ?? 0),
    // Gated on the recruit having a stated country too -- a domestic athlete
    // has no "own country" for the sentence to be about.
    has_players_from_country: player.nationality && (college.players_from_country ?? 0) > 0 ? 'true' : '',
    player_name: player.full_name || '',
    /**
     * What a person says after the introduction.
     *
     * The old copy used the full name four times in a short email. Every use
     * after the first is now this token — and it is the FIRST NAME rather than
     * a pronoun on purpose: `players` stores no gender or pronoun field, and
     * inferring one from the sport would be a guess about a real person that
     * is wrong for anyone it is wrong for.
     *
     * Falls back to the whole string when there is no space to split on, so a
     * mononym renders as itself rather than as nothing.
     */
    player_first_name: (player.full_name || '').trim().split(/\s+/)[0] || '',
    // The person, not the stored key. These read as prose in every template
    // that uses them — "a talented Defense who is exploring" was going out
    // to coaches, and "graduating defense(s) this season" under it.
    player_position: positionLabel(player.position),
    player_position_plural: positionPlural(player.position),
    player_secondary_position: secondary,
    // So "from New Zealand" is a fact about the athlete rather than a phrase
    // baked into the template, which would be wrong the moment a US athlete
    // is added.
    player_nationality: player.nationality || '',
    has_nationality: player.nationality ? 'true' : '',
    player_gpa: player.gpa != null && player.gpa !== '' ? String(player.gpa) : 'N/A',
    // So a template can omit the line entirely rather than send "GPA: N/A",
    // which reads worse than saying nothing.
    has_gpa: player.gpa != null && player.gpa !== '' ? 'true' : '',
    has_sat_score: player.sat_score != null && player.sat_score !== '' ? 'true' : '',
    has_act_score: player.act_score != null && player.act_score !== '' ? 'true' : '',
    // Saved templates were already writing {{player_sat_score}} and
    // {{player_yearly_budget}} before either existed here. An unknown token is
    // left alone by fillTemplate rather than erroring, so those rendered
    // literally into the email body — the trial athlete's draft said
    // "SAT: {{player_sat_score}}" while his profile held 1210. Named to match
    // what the templates already say rather than renaming and breaking them.
    player_sat_score: player.sat_score != null && player.sat_score !== '' ? String(player.sat_score) : 'N/A',
    player_act_score: player.act_score != null && player.act_score !== '' ? String(player.act_score) : 'N/A',
    player_yearly_budget: player.budget_range || 'N/A',
    // Undeclared is the absence of a budget, so it gates the line off rather
    // than sending a coach "Annual Budget: Undeclared".
    has_yearly_budget: player.budget_range && player.budget_range !== UNDECLARED_BUDGET ? 'true' : '',
    // Both names resolve to the same value. `player_graduation_year` is kept
    // because saved templates in the database still use it, and renaming a
    // token does not error — it silently renders nothing.
    player_class_year: classYearOf(player) != null ? String(classYearOf(player)) : '',
    player_graduation_year: classYearOf(player) != null ? String(classYearOf(player)) : '',
    // The only link an email carries. `player_highlights_url` was removed
    // 2026-08-26: a raw YouTube URL beside a tracked one gave the coach a way
    // to watch the film without ever touching the profile, so the visit went
    // unrecorded and the engagement screen read cold. The film is on the
    // profile page anyway, which is what this link opens.
    //
    // Left as the token by default, because the real link carries the coach's
    // own tracking id and only the server knows it — `sendOutreach` swaps it
    // in per recipient. A caller that wants to *show* the operator what the
    // coach will receive passes `profileUrl`; the composer previews do, since
    // a preview displaying "{{player_profile_url}}" looks like the link failed
    // to resolve rather than like it resolves later.
    player_profile_url: profileUrl || '{{player_profile_url}}',
    intended_major_label: intendedMajorLabel,
    offers_intended_major: intendedMajorLabel ? 'true' : '',
  };
}

/**
 * The evidence slot tokens, every one of them defined.
 *
 * Defined even when empty, and that matters: `fillTemplate` leaves an
 * UNKNOWN token exactly as written, so a slot the structure did not fill would
 * otherwise reach a coach as the literal text "{{evidence_support}}". Every
 * slot the registry knows about resolves to a string, and an unfilled one
 * resolves to nothing.
 */
function evidenceSlotTokens(evidence) {
  const filled = evidence?.composition?.tokens ?? {};
  const out = {};
  for (const token of SLOT_TOKENS) out[token] = filled[token] ?? '';
  return out;
}

/**
 * The structure key, whichever shape the evidence arrived in.
 *
 * `selectEvidence` returns `structure` as an OBJECT — key, label, blocks,
 * eligible — and `toWire` flattens it to the key string before sending it to
 * the browser. Both reach this file: the drafting CLI passes the object, the
 * composer passes the wire form. Reading `.key` off a string yields undefined
 * silently, which is what made `evidence_structure` render as nothing and the
 * bulk preview show no structure name while the body it previewed was plainly
 * assembled from one.
 */
export function structureKeyOf(evidence) {
  const s = evidence?.structure;
  if (!s) return null;
  return typeof s === 'string' ? s : (s.key ?? null);
}

/**
 * Whether this athlete's email can be composed from a structure.
 *
 * Only when their saved template is the shipped default, or absent. A
 * customised template is somebody's own voice — the whole reason the migration
 * in shared/templateMigration.js preserves their sentence verbatim — and
 * replacing it with an assembled body because the engine now has structures
 * would be taking that away without asking.
 *
 * The composer says so on screen rather than leaving the operator to wonder
 * why every draft looks the same shape; unpicking it is one edit, back to the
 * default template.
 */
export function canComposeStructured(player, defaultTemplate = DEFAULT_EMAIL_TEMPLATE) {
  const saved = String(player?.email_template ?? '');
  return !saved.trim() || saved === defaultTemplate;
}

export const BODY_SOURCE = Object.freeze({
  /** Assembled from the structure's blocks. */
  STRUCTURED: 'STRUCTURED',
  /** The athlete's own saved template, rendered as it always was. */
  TEMPLATE: 'TEMPLATE',
});

/**
 * The email body, by whichever route this athlete and this evidence support.
 *
 * ONE function so the browser composer, the bulk composer, the drafting CLI
 * and the send route cannot disagree about which body a coach receives. They
 * used to each call `fillTemplate` themselves, which was survivable while
 * there was one template and became a real hazard the moment there were five
 * structures and two composition routes.
 *
 * `structured` forces the choice (the composer's own toggle); left null it is
 * decided by `canComposeStructured` and whether there is a composition to use.
 * Falling back when a structure produced nothing is deliberate — an athlete
 * whose evidence lookup failed still gets the email they always got.
 */
export function emailBodyFor(player, college, coachName, {
  profileUrl = null, evidence = null, structured = null,
} = {}) {
  const context = buildEmailContext(player, college, coachName, { profileUrl, evidence });
  const composed = evidence?.composition?.template || null;
  const allowed = structured === null ? canComposeStructured(player) : Boolean(structured);
  const useStructure = Boolean(allowed && composed);
  const template = useStructure
    ? composed
    : (player.email_template || DEFAULT_EMAIL_TEMPLATE);
  return {
    body: fillTemplate(template, context),
    source: useStructure ? BODY_SOURCE.STRUCTURED : BODY_SOURCE.TEMPLATE,
    structure: useStructure ? structureKeyOf(evidence) : null,
    template,
    context,
  };
}

/**
 * Tokens in a template that nothing will resolve.
 *
 * `fillTemplate` leaves an unknown token exactly as written rather than
 * erroring, which is right — a half-substituted template is worse than an
 * obvious one — but it means a typo reaches a coach intact. The trial
 * athlete's subject line was
 * "{{player_name}} | {{position}} | {{graduation_year}} | ..." where the real
 * tokens are `player_position` and `player_class_year`, and nothing said so.
 *
 * `{{#if}}` and `{{else}}` are template syntax, not tokens, and a filter
 * (`{{player_position|lowercase}}`) is stripped before the name is checked.
 */
export function unresolvedTokens(template, context) {
  const found = new Set();
  for (const match of String(template || '').matchAll(/\{\{\s*(?:#if\s+)?([a-zA-Z0-9_]+)\s*(?:\|[^}]*)?\}\}/g)) {
    const key = match[1];
    if (key === 'else' || key === 'if') continue;
    if (!Object.prototype.hasOwnProperty.call(context, key)) found.add(key);
  }
  return [...found];
}

function applyFilter(value, filter) {
  if (!filter) return value;
  if (filter === 'lowercase') return String(value).toLowerCase();
  if (filter === 'uppercase') return String(value).toUpperCase();
  return value;
}

function resolveToken(key, context) {
  if (Object.prototype.hasOwnProperty.call(context, key)) return context[key];
  return undefined;
}

/**
 * Resolves {{#if token}}...{{/if}} and {{#if token}}...{{else}}...{{/if}}
 * blocks against the context, keeping only the branch that applies, BEFORE
 * plain token substitution runs -- so a sentence built around optional data
 * (mascot, a real nickname) can be dropped or swapped entirely instead of
 * just leaving a blank where the missing value would have gone. An unknown
 * or empty-string token counts as false.
 *
 * Blocks nest. They did not until 2026-08-26, and the failure was silent
 * rather than loud: the non-greedy body matched to the *first* {{/if}}, so an
 * outer block closed early and the inner tags were left in the text — which
 * then went to a coach reading "graduating this year{{#if has_graduating_names}}".
 */
// Matches only a block whose body contains no further {{#if}} — the innermost
// one. Resolving those first and looping outwards is what makes nesting work.
const INNERMOST_IF = /\{\{#if\s+([a-zA-Z0-9_]+)\}\}((?:(?!\{\{#if\s)[\s\S])*?)\{\{\/if\}\}/;

function resolveConditionals(template, context) {
  let out = String(template);
  // Bounded so a malformed template — an {{#if}} with no {{/if}} — cannot spin
  // here. It falls through with the tags intact, which unresolvedTokens then
  // reports, rather than hanging the composer.
  for (let pass = 0; pass < 100 && INNERMOST_IF.test(out); pass += 1) {
    out = out.replace(INNERMOST_IF, (match, key, inner) => {
      const [truthyPart, falsyPart = ''] = inner.split(/\{\{else\}\}/);
      return resolveToken(key, context) ? truthyPart : falsyPart;
    });
  }
  return out;
}

/**
 * Replaces every {{token}} or {{token|filter}} occurrence using the given
 * context. Unknown tokens are left as-is. Resolves {{#if}} blocks first
 * (see resolveConditionals), then collapses any resulting run of 3+
 * blank lines left behind by a removed block back down to one blank line.
 */
export function fillTemplate(template, context) {
  if (!template) return '';
  const withConditionals = resolveConditionals(template, context);
  const filled = withConditionals.replace(/\{\{[^}]+\}\}/g, (match) => {
    const inner = match.slice(2, -2).trim();
    const [rawKey, filter] = inner.split('|').map((s) => s.trim());
    const resolved = resolveToken(rawKey, context);
    if (resolved === undefined) return match;
    return applyFilter(resolved, filter);
  });
  return filled.replace(/\n{3,}/g, '\n\n');
}
