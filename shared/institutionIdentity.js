/**
 * WHICH INSTITUTION, AND HOW WE KNOW.
 *
 * Phase 12C fetched four seasons of real, well-formed, correctly parsed
 * athletics data from `gocolumbialions.com` and filed it under Columbia College,
 * Missouri. The site belongs to Columbia University, New York. It fetched
 * `maryvillesaints.com` for Maryville College, Tennessee; the site belongs to
 * Maryville University, Missouri. Nothing in the fetch was broken. The mapping
 * was wrong, and a successful HTTP 200 cannot tell you that.
 *
 * SO IDENTITY IS EVIDENCE, NOT CONFIGURATION. A domain appearing in a mapping
 * file is a lead. What makes it an identity is the host's own page naming an
 * institution that resolves, through this module, to the institution we expected
 * — and `IDENTITY_EVIDENCE.DOMAIN_ONLY` exists here purely so that it can be
 * named and rejected.
 *
 * THE CANONICAL INSTITUTION IS AN IPEDS UNITID.
 * Not a name. Names are the problem: `colleges.name` spells the same school two
 * ways across the two sports (378 of the 896 institutions that field both), and
 * "Columbia", "Bethel", "Maryville", "Miami" and "Concordia" each name several
 * different colleges. UNITID is assigned by the U.S. Department of Education,
 * one per institution, and it is already on 2,145 of the 2,155 rows in the
 * report universe. Under it, Columbia University is 190150 and Columbia College
 * (MO) is 177065, and no normaliser, similarity score or state heuristic is
 * needed to keep them apart. The 10 rows without one have no institution
 * identity and are refused rather than guessed.
 *
 * NO FUZZY MATCHING. NONE. Every accepted resolution is an EXACT lookup of a
 * normalised string in a table of written-down aliases. `institutionVariants`
 * generates a small CLOSED set of rewritings — "the" removed, a trailing
 * "Athletics" removed, "University of X" as "X" — and each variant is looked up
 * exactly. That is a finite enumeration of spellings, not a similarity measure:
 * it cannot return a near-miss, so it cannot return Central Arkansas for Kansas.
 * Phase 12C measured this ladder at 148 of 148 inspected matches correct.
 *
 * AMBIGUITY IS A RESULT, NOT AN ERROR TO BE BROKEN. A spelling claimed by two
 * institutions resolves to neither. The state qualifier that external sources
 * write into the name itself — "Aquinas College (Mich.)", "Springfield, Mo." —
 * is used to separate them, because that is the source stating which one it
 * means. Where it is absent, the answer is AMBIGUOUS.
 */

/** How an alias came to be believed. Stored per row; never inferred later. */
export const ALIAS_TYPE = Object.freeze({
  CURRENT_NAME: 'CURRENT_NAME',                     // the institution's name in `colleges`
  HISTORICAL_NAME: 'HISTORICAL_NAME',               // a name it used earlier in, or before, the window
  OFFICIAL_ABBREVIATION: 'OFFICIAL_ABBREVIATION',   // "ETSU", "WashU" — the institution's own short form
  ATHLETICS_NAME: 'ATHLETICS_NAME',                 // the name the athletics department publishes under
  MERGER_NAME: 'MERGER_NAME',                       // a name created by a merger of institutions
  RENAMED_INSTITUTION: 'RENAMED_INSTITUTION',       // the post-rename name, where the row predates it
  CONFERENCE_DISPLAY_NAME: 'CONFERENCE_DISPLAY_NAME', // how a conference's own tables print it
});

/** Why a raw institution string produced no identity. */
export const IDENTITY_UNRESOLVED = Object.freeze({
  EMPTY: 'EMPTY',
  UNKNOWN: 'UNKNOWN',            // no written-down alias matches any generated variant
  AMBIGUOUS: 'AMBIGUOUS',        // two institutions claim it and no qualifier separates them
  NO_UNITID: 'NO_UNITID',        // the row it matched has no institution identity on file
});

/** How an identity was reached. Stored, so any row can be re-examined. */
export const IDENTITY_METHOD = Object.freeze({
  EXACT: 'EXACT',                                   // the spelling is an alias, verbatim
  VARIANT: 'VARIANT',                               // a closed rewriting of the spelling is an alias
  QUALIFIER_DISAMBIGUATED: 'QUALIFIER_DISAMBIGUATED', // the source wrote the state, and it decided
});

/**
 * WHAT COUNTS AS PROOF THAT A FETCHED PAGE IS THE PROGRAMME WE ASKED FOR.
 *
 * Ordered by strength. A production competitive-collection row needs at least
 * one of the first four. `DOMAIN_ONLY` is listed so that the thing that
 * produced eight wrong seasons in 12C has a name and is explicitly not on the
 * accepted list.
 */
export const IDENTITY_EVIDENCE = Object.freeze({
  EXPLICIT_PAGE_INSTITUTION: 'EXPLICIT_PAGE_INSTITUTION',       // the page names the institution
  VERIFIED_DOMAIN_IDENTITY: 'VERIFIED_DOMAIN_IDENTITY',         // this host was audited and resolves to it
  VERIFIED_ALIAS: 'VERIFIED_ALIAS',                             // the page names a written-down alias of it
  CONFERENCE_MEMBERSHIP_CORROBORATION: 'CONFERENCE_MEMBERSHIP_CORROBORATION', // its conference's own table lists it
  DOMAIN_ONLY: 'DOMAIN_ONLY',                                   // NOT SUFFICIENT. Named so it can be refused.
});

export const ACCEPTED_IDENTITY_EVIDENCE = Object.freeze([
  IDENTITY_EVIDENCE.EXPLICIT_PAGE_INSTITUTION,
  IDENTITY_EVIDENCE.VERIFIED_DOMAIN_IDENTITY,
  IDENTITY_EVIDENCE.VERIFIED_ALIAS,
  IDENTITY_EVIDENCE.CONFERENCE_MEMBERSHIP_CORROBORATION,
]);

/**
 * Is this enough to file a fetched page under a programme?
 *
 * At least one accepted kind, and no conflict. A conflict is decisive on its
 * own: if the page names an institution and it is not the one we expected, no
 * quantity of other evidence rescues it.
 */
export function identityCorroborated({ evidence = [], conflict = null } = {}) {
  if (conflict) return { ok: false, reason: `IDENTITY_CONFLICT: ${conflict}` };
  const accepted = evidence.filter((e) => ACCEPTED_IDENTITY_EVIDENCE.includes(e));
  if (!accepted.length) {
    return { ok: false, reason: evidence.includes(IDENTITY_EVIDENCE.DOMAIN_ONLY) ? 'DOMAIN_ONLY' : 'NO_EVIDENCE' };
  }
  return { ok: true, evidence: accepted };
}

/** Spelling only: case, accents, `&`, punctuation. No words are removed here. */
export const normaliseInstitution = (s) => String(s ?? '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/**
 * The postal codes external sources write into a name, in the two spellings
 * they use: the postal abbreviation and the AP-style one college athletics
 * publishes. This is a lookup of what sources ACTUALLY write, which is why it
 * is a table and not a rule.
 */
const STATE_BY_TOKEN = new Map(Object.entries({
  ala: 'AL', alaska: 'AK', ariz: 'AZ', ark: 'AR', calif: 'CA', colo: 'CO', conn: 'CT', del: 'DE',
  fla: 'FL', ga: 'GA', hawaii: 'HI', idaho: 'ID', ill: 'IL', ind: 'IN', iowa: 'IA', kan: 'KS',
  ky: 'KY', la: 'LA', maine: 'ME', md: 'MD', mass: 'MA', mich: 'MI', minn: 'MN', miss: 'MS',
  mo: 'MO', mont: 'MT', neb: 'NE', nev: 'NV', nh: 'NH', nj: 'NJ', nm: 'NM', ny: 'NY',
  nc: 'NC', nd: 'ND', ohio: 'OH', okla: 'OK', ore: 'OR', pa: 'PA', ri: 'RI', sc: 'SC',
  sd: 'SD', tenn: 'TN', texas: 'TX', utah: 'UT', vt: 'VT', va: 'VA', wash: 'WA', wva: 'WV',
  wis: 'WI', wyo: 'WY', dc: 'DC', pr: 'PR',
  // Longer spellings the same sources also use.
  cal: 'CA', tex: 'TX', penn: 'PA', wisc: 'WI', mich: 'MI', colo: 'CO',
  florida: 'FL', georgia: 'GA', virginia: 'VA', kentucky: 'KY',
  // Postal codes, which our own `colleges.name` qualifiers use.
  al: 'AL', ak: 'AK', az: 'AZ', ar: 'AR', ca: 'CA', co: 'CO', ct: 'CT', de: 'DE', fl: 'FL',
  hi: 'HI', id: 'ID', il: 'IL', in: 'IN', ia: 'IA', ks: 'KS', me: 'ME', ma: 'MA', mi: 'MI',
  mn: 'MN', ms: 'MS', mt: 'MT', ne: 'NE', nv: 'NV', oh: 'OH', ok: 'OK', or: 'OR',
  tn: 'TN', tx: 'TX', ut: 'UT', wa: 'WA', wv: 'WV', wi: 'WI', wy: 'WY',
}));

/**
 * A raw name split into the part that identifies the school and the part that
 * says which one. "Aquinas College (Mich.)" is a base and a state, and the
 * state is the source telling us which Aquinas — it is evidence, not a guess.
 */
export function parseInstitutionName(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { base: '', state: null };
  // A trailing "(1)" is a national ranking, printed beside the school by the
  // conference. "Messiah (1)" and "Messiah" are the same programme, and the
  // marker made 16 rows unresolvable.
  let base = s.replace(/\s*\(\s*\d{1,2}\s*\)\s*$/, '').trim();
  let state = null;
  const paren = /\s*\(([^)]{1,24})\)\s*$/.exec(base);
  if (paren) {
    const st = STATE_BY_TOKEN.get(normaliseInstitution(paren[1]).replace(/\s/g, ''));
    if (st) { state = st; base = base.slice(0, paren.index).trim(); }
  }
  if (!state) {
    const comma = /,\s*([A-Za-z.]{2,8})\.?\s*$/.exec(base);
    if (comma) {
      const st = STATE_BY_TOKEN.get(normaliseInstitution(comma[1]).replace(/\s/g, ''));
      if (st) { state = st; base = base.slice(0, comma.index).trim(); }
    }
  }
  return { base, state };
}

/** Phrases that mark a page as an athletics site rather than name a school. */
const ATHLETICS_SUFFIX = /\s*(?:[-|–—:•]\s*)?(?:official\s+)?(?:athletics?|athletic\s+department|athletics?\s+(?:site|website|home\s*page)|sports)\b.*$/i;
const LEADING_THE = /^the\s+/i;

/** What athletics sites append to their own name, in the spellings they use. */
const BOILERPLATE = /\s*[-–—|]\s*(?:official\s+athletics?\s+(?:web)?site|official\s+site|official\s+athletics|athletics?\s+(?:web)?site|home\s*page|homepage)\s*$/i;

/**
 * Every spelling of one name that this module will look up — a closed set.
 *
 * These are enumerated rewritings, not a similarity search. Adding a rule adds
 * a finite number of exact lookups; it can never turn a near-miss into a match.
 */
/**
 * The abbreviations conference standings tables print, expanded.
 *
 * These are printing conventions, not guesses: the MASCAC writes "Framingham
 * St.", "Salem St." and "Worcester St." for three universities whose names end
 * in "State", and 34% of every member row a conference published was
 * unresolvable until they were written down.
 *
 * `St.` DEPENDS ON WHERE IT SITS, and both readings are generated rather than
 * chosen: at the end it is "State" (Framingham St.), at the start it is "Saint"
 * (St. Olaf). Generating both is safe — each is looked up exactly, and a
 * spelling that matches nothing matches nothing.
 */
const ABBREVIATIONS = [
  [/\bSt\.?\s*$/i, 'State'],
  [/^St\.\s+/i, 'Saint '],
  [/^St\s+/i, 'Saint '],
  [/\bCol\.\s*$/i, 'College'],
  [/\bUniv\.\s*$/i, 'University'],
  [/^Mt\.\s+/i, 'Mount '],
  [/\bSt\.\s+/gi, 'Saint '],
  [/\bU\.?\s*$/i, 'University'],
  // System prefixes and interior abbreviations, again as printed. The WIAC
  // writes "UW-Whitewater" for Wisconsin-Whitewater and the United East writes
  // "UMaine-Farmington" for Maine-Farmington; between them they accounted for
  // 15 programmes with no structural history at all.
  [/^UW[-–]/i, 'Wisconsin-'],
  [/^UMaine[-–]/i, 'Maine-'],
  [/^Pitt\.[-–]/i, 'Pitt-'],
  [/\bSt\.[-–]/i, 'State '],
  [/^Conn\.\s+/i, 'Connecticut '],
  [/^Mass\.\s+/i, 'Massachusetts '],
  [/^N\.C\.\s+/i, 'North Carolina '],
  [/\bInt'?l\.?\b/i, 'International'],
];

export function institutionVariants(raw) {
  const { base } = parseInstitutionName(raw);
  const seeds = new Set();
  const add = (v) => { const n = String(v ?? '').trim(); if (n) seeds.add(n); };
  add(base);
  add(base.replace(ATHLETICS_SUFFIX, ''));
  for (const v of [...seeds]) {
    for (const [re, to] of ABBREVIATIONS) if (re.test(v)) add(v.replace(re, to));
  }
  for (const v of [...seeds]) {
    add(v.replace(LEADING_THE, ''));
    add(v.replace(/\s+(?:university|college|institute|academy)\s*$/i, ''));
    add(v.replace(/\s+(?:university|college)\s+of\s+/i, ' '));
    const uOf = /^university\s+of\s+(.+)$/i.exec(v) ?? /^college\s+of\s+(.+)$/i.exec(v);
    if (uOf) add(uOf[1]);
    add(v.replace(/\s+(?:state\s+university|state\s+college)\s*$/i, ' State'));
    add(v.replace(/\s+(?:univ\.?|coll\.?)\s*$/i, ''));
    add(v.replace(/\s*[-–—]\s*/g, ' '));

  }
  return [...seeds].map((v) => normaliseInstitution(v)).filter(Boolean);
}

/**
 * The same rewritings, PLUS the name without its last word — and this one is
 * generated for OUR names only, never for a source's.
 *
 * Conferences print "Truman" for Truman State and "Gustavus" for Gustavus
 * Adolphus, so our own "Truman State" has to be reachable by its first word.
 * Doing it in the other direction is the opposite of safe: shortening what a
 * SOURCE wrote throws away what the source was specific about. Applied to
 * incoming names it turned the Peach Belt's "USC Aiken" into "USC" and gave the
 * University of Southern California two Division II seasons, and the Great
 * Southwest's "San Diego Christian" into "San Diego" and gave the University of
 * San Diego an NAIA one.
 */
export function indexVariants(raw) {
  const out = new Set(institutionVariants(raw));
  const { base } = parseInstitutionName(raw);
  for (const v of [base, base.replace(ATHLETICS_SUFFIX, '')]) {
    const words = String(v ?? '').trim().split(/\s+/);
    if (words.length >= 2) {
      const k = normaliseInstitution(words.slice(0, -1).join(' '));
      if (k) out.add(k);
    }
  }
  return [...out];
}

/**
 * The resolver, built from alias rows.
 *
 * @param aliases rows of `{ alias, unitid, aliasType, source, confidence }`
 * @param states  `{ [unitid]: 'MO' }` — used only to apply a qualifier the
 *   source itself wrote. It is never used to pick a "nearest" institution.
 */
export function buildInstitutionResolver(aliases = [], states = {}) {
  const byKey = new Map();       // WRITTEN-DOWN names -> Set(unitid)
  const byVariant = new Map();   // GENERATED rewritings of them -> Set(unitid)
  const meta = new Map();        // normalised alias -> first row seen
  // Keys that are a WHOLE written-down name, as opposed to the bare-base key
  // generated beside it. The difference decides whether a match is strong
  // enough to REFUTE a mapping — see `strength` below.
  const fullKeys = new Set();
  const register = (key, unitid, row, into = byKey) => {
    if (!key) return;
    if (!into.has(key)) { into.set(key, new Set()); if (!meta.has(key)) meta.set(key, row); }
    into.get(key).add(unitid);
  };
  for (const a of aliases) {
    // `Number(null)` is 0, which is finite — an institution with no UNITID
    // would have been registered as institution zero.
    if (a.unitid == null || a.unitid === '') continue;
    const unitid = Number(a.unitid);
    if (!Number.isFinite(unitid)) continue;
    const full = normaliseInstitution(a.alias);
    register(full, unitid, a);
    if (full) fullKeys.add(full);
    // AND the alias with its own state qualifier removed. `colleges.name` is
    // "Anderson (SC)", and a source that writes "Anderson" or "Anderson (Ind.)"
    // has to be able to reach it. The bare key is deliberately allowed to
    // collide — two Andersons land on it, and the qualifier the source wrote is
    // what separates them. Registering only the full spelling made every
    // state-qualified school in our own table unreachable.
    // The alias with its own state qualifier removed goes in the GENERATED map,
    // not beside the written-down names. `colleges` holds both "Columbia" and
    // "Columbia (MO)", and stripping the second down to "columbia" in the same
    // map made our own canonical name for Columbia University ambiguous with a
    // key we had generated ourselves. A written-down name outranks a generated
    // one; the state the source wrote is what reaches past it.
    const { base } = parseInstitutionName(a.alias);
    const baseKey = normaliseInstitution(base);
    if (baseKey && baseKey !== full) register(baseKey, unitid, a, byVariant);
    // AND the same closed rewritings applied to the alias itself, into a
    // SECOND map. The ladder has to be symmetric — our table says "Thiel
    // College" and a conference prints "Thiel" — but a generated spelling must
    // never outrank or collide with a written-down one: "USC Aiken" generates
    // "USC", which is a whole institution in its own right, and letting the two
    // meet in one map would refuse the real USC as ambiguous.
    for (const v of indexVariants(a.alias)) register(v, unitid, a, byVariant);
  }
  // A generated key is NOT deleted when a written-down name happens to equal
  // it. `resolve` reads the written-down map first, so it already wins; keeping
  // the generated entry is what lets "Columbia College (MO)" reach past
  // Columbia University once the state the source wrote has vetoed it.

  /** Every alias written down for more than one institution. */
  const collisions = () => [...byKey.entries()].filter(([, v]) => v.size > 1)
    .map(([key, v]) => ({ key, unitids: [...v].sort((x, y) => x - y) }));

  /**
   * How much weight a match can bear.
   *
   *   `WHOLE_NAME`  the matched key is a written-down name in full. Strong
   *                 enough to say a mapping is WRONG.
   *   `BASE_ONLY`   the matched key is only the bare base generated beside a
   *                 qualified name — "queens" from "Queens (NC)". Strong enough
   *                 to CONFIRM a claim, never to refute one: an institution we
   *                 do not track at all ("Queens College", CUNY) collapses onto
   *                 the same base and would be read as the one we do track.
   *                 Confirming is safe because the claimant's own name is what
   *                 generated the key in the first place.
   */
  const pick = (set, state, method, alias) => {
    const ids = [...set];
    const strength = fullKeys.has(alias) ? 'WHOLE_NAME' : 'BASE_ONLY';
    if (ids.length === 1) {
      // A STATE THE SOURCE WROTE CAN VETO A UNIQUE MATCH, and this is the whole
      // Columbia/Maryville class. "Embry-Riddle Aeronautical University (AZ)"
      // matches exactly one institution in our table — the Florida one — and
      // the source has said, in the name, that it does not mean that one.
      if (state && states[ids[0]] && states[ids[0]] !== state) {
        return { unitid: null, reason: IDENTITY_UNRESOLVED.AMBIGUOUS, alias, state, stateConflict: states[ids[0]] };
      }
      return { unitid: ids[0], method, alias, strength, aliasType: meta.get(alias)?.aliasType ?? null };
    }
    if (state) {
      const hits = ids.filter((id) => states[id] && states[id] === state);
      if (hits.length === 1) {
        return { unitid: hits[0], method: IDENTITY_METHOD.QUALIFIER_DISAMBIGUATED, alias, state, strength: 'WHOLE_NAME' };
      }
    }
    return { unitid: null, reason: IDENTITY_UNRESOLVED.AMBIGUOUS, candidates: ids.sort((x, y) => x - y), alias };
  };

  /**
   * One raw institution string to one UNITID, or a stated refusal.
   *
   * `restrictTo` narrows the answer to a known set of candidate institutions —
   * used when auditing a domain, where the question is not "who is this" in the
   * abstract but "is this one of the institutions that claimed this domain".
   */
  function resolve(raw, { restrictTo = null } = {}) {
    const { base, state } = parseInstitutionName(raw);
    if (!base) return { unitid: null, raw: raw ?? null, reason: IDENTITY_UNRESOLVED.EMPTY };
    const limit = restrictTo ? new Set(restrictTo.map(Number)) : null;
    const narrow = (set) => (limit ? new Set([...set].filter((id) => limit.has(id))) : set);

    // Written-down names first, in full; only then the generated rewritings.
    // A refusal from the written-down pass — an ambiguity, or a state the
    // source wrote that the match contradicts — is not the final answer: it
    // falls through, so "Columbia, Mo." reaches the Missouri college that only
    // a generated key names.
    let refusal = null;
    for (const map of [byKey, byVariant]) {
      const isFull = map === byKey;
      // The raw spelling in full comes first, qualifier and all: "Columbia
      // (MO)" is a written-down name, and reaching for its base before trying
      // it hands the query to the Columbia that only the base names.
      for (const v of [normaliseInstitution(raw), normaliseInstitution(base), ...institutionVariants(raw)]) {
        const set = map.get(v);
        if (!set) continue;
        const n = narrow(set);
        if (!n.size) continue;
        const picked = pick(n, v === normaliseInstitution(raw) ? null : state,
          isFull && (v === normaliseInstitution(raw) || v === normaliseInstitution(base))
            ? IDENTITY_METHOD.EXACT : IDENTITY_METHOD.VARIANT, v);
        if (picked.unitid) return { ...picked, raw };
        refusal = refusal ?? { ...picked, raw };
      }
    }
    return refusal ?? { unitid: null, raw, reason: IDENTITY_UNRESOLVED.UNKNOWN };
  }

  return { resolve, collisions, size: byKey.size };
}

/**
 * The institution a fetched page says it is.
 *
 * A page offers several candidate strings — `og:site_name`, and each segment of
 * a `<title>` split on its separators — and they are all resolved. The answer
 * is accepted only if the candidates that resolve at all agree on ONE
 * institution. Two candidates naming two institutions is a page we do not
 * understand, and a page we do not understand identifies nothing.
 */
export function institutionFromPage({ title = null, siteName = null, canonicalHost = null } = {}, resolver, opts = {}) {
  const candidates = [];
  const push = (v, kind) => { const s = String(v ?? '').trim(); if (s && s.length < 140) candidates.push({ text: s, kind }); };
  push(siteName, 'OG_SITE_NAME');
  push(title, 'PAGE_TITLE');
  // The boilerplate every Sidearm title carries, removed as a SUFFIX rather
  // than by splitting on its separator. Splitting on " - " tore
  // "University of Missouri - St. Louis Athletics" into "University of
  // Missouri", and read one of the four campuses of a university system as
  // another — the exact error this module exists to prevent, produced by the
  // module itself.
  push(String(title ?? '').replace(BOILERPLATE, '').trim(), 'PAGE_TITLE');
  for (const seg of String(title ?? '').split(/\s*[|•·]\s*|\s*::\s*/)) push(seg.replace(BOILERPLATE, '').trim(), 'TITLE_SEGMENT');
  const hits = [];
  for (const c of candidates) {
    const r = resolver.resolve(c.text, opts);
    if (r.unitid) hits.push({ ...r, kind: c.kind, text: c.text });
  }
  if (!hits.length) return { unitid: null, reason: IDENTITY_UNRESOLVED.UNKNOWN, candidates: candidates.slice(0, 6) };
  const ids = [...new Set(hits.map((h) => h.unitid))];
  if (ids.length > 1) {
    return { unitid: null, reason: IDENTITY_UNRESOLVED.AMBIGUOUS, candidates: ids, hits: hits.slice(0, 6) };
  }
  const best = hits.find((h) => h.kind === 'OG_SITE_NAME') ?? hits[0];
  // The strongest evidence any candidate offered, since they all agree on who.
  const strength = hits.some((h) => h.strength === 'WHOLE_NAME') ? 'WHOLE_NAME' : 'BASE_ONLY';
  return { unitid: ids[0], method: best.method, strength, matchedOn: best.kind, matchedText: best.text, matchedAlias: best.alias, canonicalHost };
}

/** The verdicts a domain mapping can carry. */
export const DOMAIN_STATUS = Object.freeze({
  VERIFIED: 'VERIFIED',                             // the host names the institution that claimed it
  VERIFIED_ALIAS: 'VERIFIED_ALIAS',                 // it names a written-down alias of that institution
  AMBIGUOUS: 'AMBIGUOUS',                           // claimed by two institutions, and the host settles neither
  WRONG_INSTITUTION: 'WRONG_INSTITUTION',           // the host names a DIFFERENT institution
  UNREACHABLE: 'UNREACHABLE',                       // no response. Says nothing about the mapping.
  INSUFFICIENT_EVIDENCE: 'INSUFFICIENT_EVIDENCE',   // reachable, and names nothing we can resolve
});
