#!/usr/bin/env node
/**
 * Picks ONE emailable nickname per college row out of the multi-valued strings the
 * Wikipedia infobox yields, and records how it chose.
 *
 * populateSchoolIdentity.js deliberately preserves every value the infobox lists, because
 * throwing them away loses real information -- but that string cannot go in an email.
 * Penn State arrives as "Nittany Lions / Lady Lions / Behrend Lions / Roaring Lions /
 * Lions", and some rows still carry raw "<br/>" markup.
 *
 * The list is not just noise: a real subset of schools name their men's and women's teams
 * DIFFERENTLY (Cal Lutheran Kingsmen/Regals, Oberlin Yeomen/Yeowomen, Hobart & William
 * Smith Statesmen/Herons), which is the whole reason this runs per sport rather than once
 * per university. Others list BRANCH CAMPUS names (Penn State Behrend, FDU-Florham) that
 * belong to a different row in our own table, or a nickname used by ONE sport only
 * (Wayland Baptist's Flying Queens is a basketball name).
 *
 * Decisions are graded. Anything not resolved by an explicit, unambiguous signal is left
 * for human verification against the school's own athletics site rather than guessed --
 * these strings are going into live outreach.
 *
 * Usage:
 *   node server/scripts/resolveNicknamePerSport.js [--apply] [--out review.csv]
 */
import fs from 'node:fs';
import { College } from '../db/entities/college.js';
import { isPluralNickname } from '../lib/nicknameGrammar.js';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const outArg = args.find((a) => a.startsWith('--out'));
const OUT = outArg ? (outArg.split('=')[1] || args[args.indexOf(outArg) + 1]) : null;

// "&" and " and " join a men's/women's pair as often as "/" does -- "Bears & Sugar Bears",
// "Gentlemen & Ladies", "Tigers and Lady Tigers". Left unsplit, those reach an email whole.
/** Men's/women's splits that NO rule in this file can derive, because neither value carries
 * a gendered marker and neither is a decoration of the other -- "Bears & Sugar Bears",
 * "Thorobreds & Thorobrettes", "Gold Rush and Gold Nuggets".
 *
 * Each was confirmed against Wikipedia's ATHLETICS article, whose title names both teams by
 * convention, men's first: "Central Arkansas Bears and Sugar Bears", "Kentucky State
 * Thorobreds and Thorobrettes", "Xavier Gold Rush and Gold Nuggets". See
 * individualisation/verify_split_names.py, which also cross-checks the lead sentence.
 *
 * Keyed on the men's name so it applies to every row whose raw value contains that pair,
 * regardless of which of our duplicate school rows it sits on. */
const VERIFIED_SPLITS = [
  { men: 'Bears',      women: 'Sugar Bears',   source: 'Central Arkansas Bears and Sugar Bears' },
  { men: 'Thorobreds', women: 'Thorobrettes',  source: 'Kentucky State Thorobreds and Thorobrettes' },
  { men: 'Gold Rush',  women: 'Gold Nuggets',  source: 'Xavier Gold Rush and Gold Nuggets' },
];

const SPLIT = /<br\s*\/?>|\s+\/\s+|\/|\s+&\s+|\s+and\s+/gi;

/** Which sex a listed nickname belongs to, or null if it is sex-neutral.
 *
 * Markers are morphological as well as explicit, because the real per-sex pairs mostly
 * carry no annotation at all: Kingsmen/Regals, Yeomen/Yeowomen, Statesmen/Herons,
 * Highlanders/Highlassies, Northern Lights/Northern Skylights. */
function sexOf(raw) {
  const s = raw.toLowerCase().trim();
  if (/\(\s*(men|men's|m)\s*\)|^men'?s?\s*:/.test(s)) return 'men';
  if (/\(\s*(women|women's|w)\s*\)|^women'?s?\s*:/.test(s)) return 'women';
  if (/\(\s*ws\s*\)|\bwilliam smith\b/.test(s)) return 'women';
  if (/\(\s*hobart\s*\)/.test(s)) return 'men';
  if (/^lady\b/.test(s.replace(/^the\s+/, ''))) return 'women';
  if (/women|lassies|queens|skylights|wahine|w\u0101hine/.test(s)) return 'women';   // Yeowomen, Highlassies
  if (/men\b/.test(s)) return 'men';                              // Kingsmen, Statesmen
  return null;
}

const DECOR = /^(the\s+)?(lady|ladies|runnin'?|fightin'?|flyin'?)\s+/i;

/** Is this name itself MEN'S-specific, rather than the university's neutral name?
 *
 * This is the question that decides the "Lady X" cases, and it is not decidable from the
 * women's side alone. Compare:
 *
 *   Liberty     Flames / Lady Flames          "Flames" is neutral -> women's soccer are
 *                                             the Flames; "Lady Flames" is a basketball
 *                                             brand. (Confirmed on libertyflames.com.)
 *   Delta State Statesmen / Lady Statesmen     "Statesmen" is a MEN'S word -> it cannot be
 *                                             the women's team, so "Lady Statesmen" it is.
 *
 * Same surface pattern, opposite answers, distinguished only by whether the base name is
 * gendered. Getting this backwards is exactly what would put "Lady Lions" on Penn State
 * women's soccer or "Statesmen" on a women's team.
 */
function isMasculine(name) {
  const s = name.toLowerCase().trim();
  if (/women/.test(s)) return false;
  return /(?:^|[a-z])men$/.test(s) || /\b(boys|blueboys|lords|gentlemen|brothers|sirs)$/.test(s);
}

/** How the women's name relates to the men's/neutral one.
 *   'decoration' -- "Lady Flames" over "Flames": the same name with a prefix
 *   'distinct'   -- "Regals", "Yeowomen", "Sugar Bears", "Thorobrettes": its own word,
 *                   which means the school really does name the women's teams separately
 */
function relation(womensName, others) {
  return baseFor(womensName, others) ? 'decoration' : 'distinct';
}

/** The neutral name a decorated variant decorates, taken in the order the infobox listed
 * them so the school's PRIMARY name wins.
 *
 * Matching on endsWith rather than equality, because the base is usually the qualified
 * form: Penn State lists "Nittany Lions / Lady Lions / Behrend Lions / Roaring Lions /
 * Lions", and an equality test picked the bare "Lions" sitting last -- correct as a word,
 * wrong as the name of the programme. First-listed also keeps the flagship ahead of the
 * branch campus ("Behrend Lions" is Penn State Behrend, a separate row of ours). */
function baseFor(name, others) {
  if (!DECOR.test(name)) return null;
  const core = name.replace(DECOR, '').trim().toLowerCase();
  if (!core) return null;
  return others.find((o) => {
    const l = o.toLowerCase().trim();
    return l !== name.toLowerCase().trim() && (l === core || l.endsWith(' ' + core));
  }) || null;
}

/** A nickname the infobox scopes to ONE sport is not usable for soccer. */
function sportScoped(raw) {
  const m = raw.match(/\(([^)]*)\)/);
  if (!m) return null;
  const inner = m[1].toLowerCase();
  const sports = ['basketball', 'football', 'baseball', 'softball', 'volleyball',
                  'hockey', 'track', 'swimming', 'tennis', 'golf', 'rowing', 'wrestling'];
  const hit = sports.find((s) => inner.includes(s));
  return hit && !inner.includes('soccer') ? hit : null;
}

/** Remove punctuation debris an unbalanced parenthesis leaves behind. Wesleyan (GA) came
 * out of the pipeline as the literal "Wolves (" -- a stray bracket is invisible in a table
 * and unmissable in an email. */
function tidy(v) {
  return String(v || '')
    .replace(/[([{]\s*$/, '')
    .replace(/^\s*[)\]}]/, '')
    .replace(/\s*[,;:]\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function stripQualifier(raw) {
  const dash = raw.match(/^(.{3,40}?)\s+[-\u2013\u2014]\s+(.+)$/);
  if (dash) raw = dash[2];
  return raw.replace(/^(men|women)'?s?\s*:\s*/i, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s*[-–]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The parenthetical that is a CAMPUS rather than a sex or a sport. */
function campusOf(raw) {
  // Campuses appear as a prefix as often as a parenthetical: "St. Joe's Brooklyn - Bears",
  // "St. Joe's Long Island - Golden Eagles". Without this, a school whose own row names its
  // campus ("St. Joseph's University (Brooklyn)") could not be matched to its own entry.
  const dash = raw.match(/^(.{3,40}?)\s+[-\u2013\u2014]\s+(.+)$/);
  if (dash) return dash[1].trim();
  const m = raw.match(/\(([^)]*)\)/);
  if (!m) return null;
  const inner = m[1].trim();
  if (sexOf(`(${inner})`) || sportScoped(raw)) return null;
  if (/^(m|w|men|women|men's|women's|ws|hobart)$/i.test(inner)) return null;
  return inner;
}

/** Wikipedia sometimes writes the nickname WITH the school in front of it ("Howard Bison
 * and Lady Bison", "Liberty Flames and Lady Flames"). The email says "the {{nickname}}",
 * so the school's own name has to come off the front. */
function dropSchoolPrefix(value, schoolName) {
  const school = schoolName.toLowerCase().replace(/\s*\([^)]*\)/g, '').trim();
  const words = school.split(/\s+/).filter((w) => w.length > 2);
  let out = value;
  for (const w of words) {
    const re = new RegExp('^' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+', 'i');
    if (re.test(out) && out.replace(re, '').trim()) out = out.replace(re, '').trim();
  }
  return out || value;
}

export function resolveNickname(raw, sport, schoolName) {
  if (!raw) return null;
  // A superseded name is not a candidate. Widener's infobox reads "Pride (introduced in
  // 2006), formerly the Pioneers and ..." -- everything from "formerly" on is history, and
  // treating it as an alternative left the row unresolvable.
  const histIdx = raw.search(/,?\s*(formerly|previously|until\s+\d{4}|renamed from)\b/i);
  if (histIdx > 0) raw = raw.slice(0, histIdx);
  raw = raw.replace(/\((?:introduced|adopted|since|from)[^)]*\)/gi, ' ').replace(/\s+/g, ' ').trim();
  const sex = sport === 'womens-soccer' ? 'women' : 'men';
  const parts = raw.split(SPLIT).map((p) => p.trim()).filter(Boolean);

  if (parts.length === 1 && !/[(:]/.test(raw.replace(/[([{]\s*$/, ''))) {
    const v = tidy(dropSchoolPrefix(raw.trim(), schoolName));
    return { value: v, grade: 'single', reason: 'only one value offered' };
  }

  const cands = parts.map((p) => ({
    raw: p, clean: tidy(dropSchoolPrefix(stripQualifier(p), schoolName)), sex: sexOf(p),
    sport: sportScoped(p), campus: campusOf(p),
  })).filter((c) => c.clean);

  // Dedupe on the CLEANED value. "Texas Aggies / Aggies" both reduce to "Aggies" once the
  // school's own name is stripped, and two identical entries otherwise look like a
  // men's/women's pair to the matched-pair rule below.
  const byClean = new Map();
  for (const c of cands) if (!byClean.has(c.clean.toLowerCase())) byClean.set(c.clean.toLowerCase(), c);
  cands.length = 0;
  cands.push(...byClean.values());

  if (cands.length === 0) return null;
  if (cands.length === 1) {
    return { value: cands[0].clean, grade: 'single',
             reason: `one value after stripping "${raw}"` };
  }

  // A branch campus in our own school name ("FDU-Florham", "Penn State Behrend") must take
  // ITS nickname, not the flagship's -- these are separate rows in our table.
  const lowerSchool = schoolName.toLowerCase();
  const campusHit = cands.find((c) => c.campus &&
    c.campus.toLowerCase().split(/[\s,]+/).some((w) => w.length > 3 && lowerSchool.includes(w)));
  if (campusHit) {
    return { value: campusHit.clean, grade: 'confident',
             reason: `campus "${campusHit.campus}" matches this school's own name` };
  }

  const usable = cands.filter((c) => !c.sport);
  const dropped = cands.filter((c) => c.sport).map((c) => `${c.clean} (${c.sport} only)`);
  const pool = usable.length ? usable : cands;

  const cleans = pool.map((c) => c.clean);
  const lower = cleans.map((x) => x.toLowerCase());
  for (const v of VERIFIED_SPLITS) {
    if (lower.includes(v.men.toLowerCase()) && lower.includes(v.women.toLowerCase())) {
      const pick = sex === 'women' ? v.women : v.men;
      return { value: pick, grade: 'confident',
               reason: `verified men's/women's split, confirmed by the athletics article "${v.source}"` };
    }
  }
  const mine = pool.filter((c) => c.sex === sex);
  const theirs = pool.filter((c) => c.sex && c.sex !== sex);
  const neutral = pool.filter((c) => !c.sex);

  if (mine.length === 1) {
    const rel = relation(mine[0].clean, cleans.filter((x) => x !== mine[0].clean));
    if (rel === 'distinct') {
      return { value: mine[0].clean, grade: 'confident',
               reason: `"${mine[0].clean}" is this school's own ${sex}'s name, not a variant` +
                 (dropped.length ? `; ignored ${dropped.join(', ')}` : '') };
    }
    // a decorated form: correct only when the base name is itself the other sex's word
    const base = baseFor(mine[0].clean, cleans);
    if (base && isMasculine(base) === (sex === 'men' ? false : true)) {
      return { value: mine[0].clean, grade: 'confident',
               reason: `base name "${base}" is ${sex === 'women' ? "men's" : "women's"}-specific, ` +
                       `so the ${sex}'s teams use "${mine[0].clean}"` };
    }
    if (base) {
      return { value: base, grade: 'confident',
               reason: `"${mine[0].clean}" is a decorated variant of the neutral "${base}" ` +
                       `(typically one sport's brand), so the programme name is "${base}"` +
                 (dropped.length ? `; ignored ${dropped.join(', ')}` : '') };
    }
  }
  if (mine.length === 0 && theirs.length >= 1 && neutral.length >= 1) {
    return { value: neutral[0].clean, grade: 'confident',
             reason: `no ${sex}'s-specific name listed; took the neutral "${neutral[0].clean}" ` +
                     `over the ${theirs[0].sex}'s "${theirs[0].clean}"` };
  }
  if (mine.length === 0 && theirs.length === 1 && pool.length === 2) {
    const other = pool.find((c) => c !== theirs[0]);
    return { value: other.clean, grade: 'confident',
             reason: `paired with "${theirs[0].clean}", the ${theirs[0].sex}'s name` };
  }
  if (mine.length > 1) {
    return { value: null, grade: 'needs-review',
             reason: `more than one ${sex}'s name listed: ${mine.map((c) => c.clean).join(' | ')}` };
  }
  // Two names, neither carrying any gendered marker, but obviously a matched PAIR --
  // "Bears & Sugar Bears", "Thorobreds & Thorobrettes". These are real men's/women's
  // splits (Central Arkansas' women are the Sugar Bears, Kentucky State's the
  // Thorobrettes) that no marker in the string reveals, and taking the first would put a
  // men's name on a women's team. Too few to matter for throughput, too wrong to guess.
  if (pool.length === 2 && !pool.some((c) => c.sex) && !pool.some((c) => c.campus)) {
    const [a, b] = pool.map((c) => c.clean.toLowerCase());
    let shared = 0;
    while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared++;
    // A CLIPPED ALIAS is one word abbreviating another -- "Seminoles / Noles",
    // "Bulldogs / Dawgs". A genuine men's/women's pair adds a whole WORD instead --
    // "Bears" -> "Sugar Bears". So containment only implies a pair when the longer value
    // carries an extra word; otherwise it is the same name shortened, and the school's
    // primary form should win.
    const [shortV, longV] = a.length <= b.length ? [a, b] : [b, a];
    const clipped = !longV.includes(' ') && !shortV.includes(' ')
      && (longV.endsWith(shortV) || longV.startsWith(shortV));
    const extraWord = longV.endsWith(' ' + shortV) || longV.startsWith(shortV + ' ');
    if (!clipped && (extraWord || shared >= 5)) {
      return { value: null, grade: 'needs-review',
               reason: `matched pair with no gender marker, likely a men's/women's split: ` +
                       `${pool.map((c) => c.clean).join(' | ')}` };
    }
  }

  // no sex signal anywhere and no campus qualifiers -> the infobox's first value is the
  // university's primary athletics nickname, and the rest are alternates ("Bulldogs /
  // 'Zags", "Cavaliers / Wahoos"). Safe, but flagged as a judgement.
  if (!pool.some((c) => c.campus)) {
    return { value: pool[0].clean, grade: 'primary-first',
             reason: `no sex-specific values; took the first of ${pool.length}` +
               (dropped.length ? `; ignored ${dropped.join(', ')}` : '') };
  }
  // Campus-qualified values with none matching our own row: Wikipedia lists the flagship
  // first, and our table carries satellite campuses as their OWN rows ("Benedictine
  // University at Mesa" beside "Benedictine University"), so the unqualified row is the
  // flagship and takes the first value.
  const campusy = pool.filter((c) => c.campus);
  if (campusy.length >= 2 && campusy.length === pool.length) {
    return { value: pool[0].clean, grade: 'primary-first',
             reason: `campus-specific names (${pool.map((c) => c.campus).join(', ')}); this row `
                     + `names no campus, so it is the flagship and takes "${pool[0].clean}"` };
  }
  return { value: null, grade: 'needs-review',
           reason: `cannot choose between: ${cands.map((c) => c.raw).join(' | ')}` };
}

function main() {
  const rows = College.list().filter((c) => c.nickname);
  const review = [];
  let changed = 0, flagged = 0;

  for (const row of rows) {
    const r = resolveNickname(row.nickname, row.sport, row.name);
    if (!r) continue;
    if (r.grade === 'single' && r.value === row.nickname) continue;
    if (!r.value) {
      flagged++;
      review.push([row.name, row.sport, row.nickname, '', r.grade, r.reason]);
      continue;
    }
    if (r.value === row.nickname) continue;
    review.push([row.name, row.sport, row.nickname, r.value, r.grade, r.reason]);
    changed++;
    if (APPLY) {
      College.update(row.id, {
        nickname: r.value,
        nickname_plural: isPluralNickname(r.value) ? 1 : 0,
      });
    }
  }

  const byGrade = {};
  for (const r of review) byGrade[r[4]] = (byGrade[r[4]] || 0) + 1;
  console.log(`${rows.length} rows with a nickname; ${changed} rewritten, ${flagged} need review`);
  console.log('by grade:', byGrade);
  for (const r of review.filter((x) => x[4] !== 'single').slice(0, 40)) {
    console.log(`  [${r[4]}] ${r[1] === 'womens-soccer' ? 'W' : 'M'} ${r[0].slice(0, 26).padEnd(26)} ${JSON.stringify(r[2]).slice(0, 46).padEnd(46)} -> ${JSON.stringify(r[3])}`);
  }
  if (OUT) {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    fs.writeFileSync(OUT, ['school,sport,raw_nickname,resolved,grade,reason',
      ...review.map((r) => r.map(esc).join(','))].join('\n'));
    console.log(`wrote ${OUT}`);
  }
  if (!APPLY) console.log('Dry run -- re-run with --apply to write.');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
