/**
 * WHICH CONFERENCE, IN WHICH DIVISION, IN WHICH SEASON — and how sure.
 *
 * `competitiveHistory.js` says what a programme recorded. This says who it was
 * recording it against. The two are separate because the second is the
 * denominator of the first: a .929 season means one thing in Division II and
 * another in Division I, and Mercyhurst played both inside this four-year
 * window.
 *
 * HISTORICAL DIVISION IS NEVER THE CURRENT DIVISION, and there is no fallback.
 * `colleges.division` is a snapshot taken today. Mercyhurst men's played 2022 in
 * Division II and every internal column in this database calls that season
 * Division I. 12B.1 measured it: 0 of 2,122 men's and 0 of 1,719 women's
 * programme-sports have a division that varies by season anywhere in our own
 * data, because all three internal columns are stamped at import. A season
 * whose division is not established carries null, the benchmark refuses with a
 * stated reason, and no disclosure would make substituting the current division
 * acceptable.
 *
 * A CONFERENCE IS A DIVISION-LEVEL ENTITY, WHICH IS WHY THIS WORKS AT ALL.
 * The PSAC is Division II and stays Division II; realignment moves PROGRAMMES
 * between conferences. So a conference's own published standings table for 2022
 * establishes both facts for every member at once: which conference, and
 * therefore which division. That is the whole reason conference-side collection
 * is the cheapest source in this design.
 *
 * PURE. It reads no database and fetches nothing.
 */

/** The four divisions this product reports on. */
export const DIVISIONS = Object.freeze(['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA']);

/**
 * How a division came to be believed, stored on every row.
 *
 *   EXPLICIT_OFFICIAL               the conference's own page states it
 *   DERIVED_FROM_OFFICIAL_MEMBERSHIP the conference's own standings table lists
 *                                   this programme as a member that season, and
 *                                   the conference's division is established
 *   CONFLICTING                     two sources disagree; nothing is claimed
 *   UNKNOWN                         no source establishes it
 */
export const DIVISION_PROVENANCE = Object.freeze({
  EXPLICIT_OFFICIAL: 'EXPLICIT_OFFICIAL',
  DERIVED_FROM_OFFICIAL_MEMBERSHIP: 'DERIVED_FROM_OFFICIAL_MEMBERSHIP',
  CONFLICTING: 'CONFLICTING',
  UNKNOWN: 'UNKNOWN',
});

/**
 * Every way collection can fail to produce a row, named separately.
 *
 * MISSING IS NOT ZERO and the distinctions are not decoration: "the conference
 * has no page for that season" and "the page loaded and we could not read it"
 * lead to different work, and collapsing them is how a parser bug gets recorded
 * as a conference that did not exist.
 */
export const COLLECTION_STATUS = Object.freeze({
  OK: 'OK',
  SOURCE_NOT_FOUND: 'SOURCE_NOT_FOUND',                   // no standings page on this host
  SEASON_NOT_AVAILABLE: 'SEASON_NOT_AVAILABLE',           // the host has no table for that season
  SEASON_NOT_CONFIRMED: 'SEASON_NOT_CONFIRMED',           // a table came back and did not name the season
  PARSE_FAILED: 'PARSE_FAILED',                           // the page loaded and produced no rows
  CHALLENGED: 'CHALLENGED',                               // a bot check answered instead of the page
  TRANSPORT_FAILED: 'TRANSPORT_FAILED',                   // no response. NEVER read as an absence.
  IDENTITY_UNRESOLVED: 'IDENTITY_UNRESOLVED',             // a member name matched no programme
  MEMBERSHIP_UNRESOLVED: 'MEMBERSHIP_UNRESOLVED',         // it matched several and none was chosen
  CONFERENCE_UNKNOWN: 'CONFERENCE_UNKNOWN',               // the conference spelling resolves to nothing
  DIVISION_UNKNOWN: 'DIVISION_UNKNOWN',                   // the conference's division is not established
  CONFERENCE_DIVISION_CONFLICT: 'CONFERENCE_DIVISION_CONFLICT', // two sources disagree about it
  CONFLICTING_OFFICIAL_SOURCES: 'CONFLICTING_OFFICIAL_SOURCES', // two accepted sources name different conferences
});

/**
 * A conference's division, from the statements made about it.
 *
 * TWO INDEPENDENT SOURCES, AND THEY HAVE TO AGREE. A reference statement about
 * the conference is one; the divisions of the programmes the conference's own
 * table lists as its members is the other. Across 120 conferences the two agree
 * on 119, which is what makes either believable.
 *
 * MEMBERSHIP IS USED AT THE CONFERENCE LEVEL AND NOWHERE ELSE. Taking a
 * PROGRAMME's current division as its historical one is the error this whole
 * layer exists to prevent. Taking a CONFERENCE's division from where its
 * members sit is a different claim, and it holds because a conference does not
 * change division — its members change conference. It is also why one mover
 * cannot break it: Mercyhurst leaving the PSAC for Division I does not make the
 * PSAC ambiguous, so the rule is a strict majority of resolved members, and a
 * disagreeing reference statement is a CONFLICT rather than a tiebreak.
 *
 * @param statements `[{ division, kind, source }]` — kind is EXPLICIT for the
 *   conference's own page, REFERENCE for a citable third party, CURATED for a
 *   written-down decision.
 * @param memberDivisions `{ 'NCAA D2': 17, 'NCAA D1': 1 }` — current divisions
 *   of the programmes this conference's own table listed as members.
 */
export function deriveConferenceDivision({ statements = [], memberDivisions = {} } = {}) {
  const stated = [...new Set(statements.map((s) => s.division).filter((d) => DIVISIONS.includes(d)))];
  const counts = Object.entries(memberDivisions).filter(([d]) => DIVISIONS.includes(d));
  const total = counts.reduce((a, [, n]) => a + n, 0);
  const top = counts.sort((a, b) => b[1] - a[1])[0] ?? null;
  const majority = top && total > 0 && top[1] * 2 > total ? top[0] : null;

  if (stated.length > 1) {
    return { division: null, provenance: DIVISION_PROVENANCE.CONFLICTING, statements: stated, majority, reason: 'two sources state different divisions' };
  }
  if (stated.length === 1) {
    // A STATEMENT IS CONTRADICTED ONLY WHEN NO MEMBER SUPPORTS IT. A stricter
    // test — the majority must agree — fires on the wrong thing: the Great
    // Southwest Athletic Conference is NAIA and lost half its membership to
    // Division II inside this window, so by 2025 the majority of its 2022
    // members sit in D2 and the conference would be refused for a move its
    // members made three seasons later. Zero support is a real contradiction:
    // the Coast-to-Coast Athletic Conference was stated as Division I by a
    // reference lookup that had landed on the wrong article, and not one of its
    // members is in Division I.
    if (total > 0 && (memberDivisions[stated[0]] ?? 0) === 0) {
      return { division: null, provenance: DIVISION_PROVENANCE.CONFLICTING, statements: stated, majority, reason: `stated ${stated[0]}, and no member of it is in that division` };
    }
    const explicit = statements.some((s) => s.division === stated[0] && s.kind === 'CONFERENCE_PAGE');
    return {
      division: stated[0],
      provenance: explicit ? DIVISION_PROVENANCE.EXPLICIT_OFFICIAL : DIVISION_PROVENANCE.DERIVED_FROM_OFFICIAL_MEMBERSHIP,
      corroboratedBy: majority ? 'membership' : null,
      statements: stated,
    };
  }
  // No statement at all. Membership alone carries it only when it is unanimous:
  // without a second source there is nothing for a majority to be checked
  // against, and a near-enough majority is exactly the guess this refuses.
  if (counts.length === 1 && total > 0) {
    return { division: counts[0][0], provenance: DIVISION_PROVENANCE.DERIVED_FROM_OFFICIAL_MEMBERSHIP, statements: [], corroboratedBy: null };
  }
  return { division: null, provenance: DIVISION_PROVENANCE.UNKNOWN, statements: [], majority, reason: 'no source establishes this conference’s division' };
}

/**
 * WHERE A MEMBERSHIP ROW CAME FROM, and how the four accepted sources rank.
 *
 * All four are OFFICIAL. The order is about how specific the evidence is to the
 * fact being claimed, not about which collector produced it — a conference's own
 * standings table for 2022 states 2022 membership directly, and an association
 * directory states current membership and has to be reasoned from. Phase 12C's
 * programme-side evidence sits inside that order rather than beneath it: the
 * Pac-12's own site no longer publishes its pre-collapse tables, and
 * `calbears.com` does publish California's own 2022 season and the conference it
 * played in. Refusing that because it came from the other collector would be
 * privileging ownership over truth.
 *
 * RESEARCH EVIDENCE IS NOT IN THIS SET. Wikipedia found the conference hosts and
 * a candidate division; neither is a membership provenance, and neither may
 * become production truth on its own.
 */
export const MEMBERSHIP_PROVENANCE = Object.freeze({
  OFFICIAL_CONFERENCE_STANDINGS: 'OFFICIAL_CONFERENCE_STANDINGS',   // the conference's own table for that season
  OFFICIAL_PROGRAMME_SOURCE: 'OFFICIAL_PROGRAMME_SOURCE',           // the programme's own season page
  OFFICIAL_CONFERENCE_MEMBERSHIP: 'OFFICIAL_CONFERENCE_MEMBERSHIP', // a conference's own member directory
  OFFICIAL_NCAA_MEMBERSHIP: 'OFFICIAL_NCAA_MEMBERSHIP',             // the NCAA member directory
  OFFICIAL_NAIA_MEMBERSHIP: 'OFFICIAL_NAIA_MEMBERSHIP',             // the NAIA conference school listing
});

/**
 * The order in which sources are consulted, most season-specific first.
 *
 * A source lower in the list is used only where every source above it is silent.
 * It is never used to overrule one above it — that is a conflict, and conflicts
 * are refused rather than ordered away.
 */
export const MEMBERSHIP_PRIORITY = Object.freeze([
  MEMBERSHIP_PROVENANCE.OFFICIAL_CONFERENCE_STANDINGS,
  MEMBERSHIP_PROVENANCE.OFFICIAL_PROGRAMME_SOURCE,
  MEMBERSHIP_PROVENANCE.OFFICIAL_CONFERENCE_MEMBERSHIP,
  MEMBERSHIP_PROVENANCE.OFFICIAL_NCAA_MEMBERSHIP,
  MEMBERSHIP_PROVENANCE.OFFICIAL_NAIA_MEMBERSHIP,
]);

/** Whether a membership row also carries the record made inside that conference. */
export const RECORD_STATUS = Object.freeze({
  RECORD_KNOWN: 'RECORD_KNOWN',
  RECORD_UNAVAILABLE: 'RECORD_UNAVAILABLE',
});

/**
 * MEMBERSHIP TRUTH AND CONFERENCE-RECORD TRUTH ARE SEPARATE, and a report needs
 * to be able to say the first without the second.
 *
 * "Big East, NCAA Division I" is a complete, checkable fact. "5-2-1 in
 * conference" is a different fact from a different part of the same page, and a
 * source can carry the first and not the second — a conference member directory
 * has no records in it at all. Requiring a record before believing a membership
 * would throw away the membership, so it is never required.
 */
export const COVERAGE_CLASS = Object.freeze({
  MEMBERSHIP_KNOWN_RECORD_KNOWN: 'MEMBERSHIP_KNOWN_RECORD_KNOWN',
  MEMBERSHIP_KNOWN_RECORD_UNKNOWN: 'MEMBERSHIP_KNOWN_RECORD_UNKNOWN',
  MEMBERSHIP_UNKNOWN: 'MEMBERSHIP_UNKNOWN',
});

export function coverageClass(row) {
  if (!row || !row.conferenceId || !row.seasonConfirmed) return COVERAGE_CLASS.MEMBERSHIP_UNKNOWN;
  return row.conferenceWins == null
    ? COVERAGE_CLASS.MEMBERSHIP_KNOWN_RECORD_UNKNOWN
    : COVERAGE_CLASS.MEMBERSHIP_KNOWN_RECORD_KNOWN;
}

/**
 * WHAT HAPPENS WHEN TWO ACCEPTED OFFICIAL SOURCES DISAGREE: nothing is chosen.
 *
 * The default is refusal, and it is the default because the alternative is a
 * rule that decides which official body was wrong. Both provenance records are
 * returned so that a person can look.
 *
 * ONE CASE RESOLVES AUTOMATICALLY, and only one: two sources naming the SAME
 * conference. That is agreement, and it upgrades the row's confidence rather
 * than settling anything. Recency does not resolve a conflict here — a 2026
 * directory is not a better witness to 2022 than a 2022 standings table — and
 * neither does source specificity on its own, because specificity is what
 * `MEMBERSHIP_PRIORITY` already used to choose which source to consult first.
 */
export function reconcileMembership(claims = []) {
  const usable = claims.filter((c) => c && c.conferenceId);
  if (!usable.length) return { conferenceId: null, status: COLLECTION_STATUS.CONFERENCE_UNKNOWN, claims: [] };
  const ids = [...new Set(usable.map((c) => c.conferenceId))];
  if (ids.length === 1) {
    const rank = (c) => MEMBERSHIP_PRIORITY.indexOf(c.membershipProvenance);
    const best = [...usable].sort((a, b) => rank(a) - rank(b))[0];
    return {
      conferenceId: ids[0],
      status: COLLECTION_STATUS.OK,
      chosen: best,
      corroborations: usable.length - 1,
      claims: usable,
    };
  }
  // THE ONE AUTOMATIC RESOLUTION, and it is not about recency.
  //
  // Two conference tables can both list a school called "Xavier" and mean two
  // different institutions; the disagreement is about identity, not about the
  // season. Where the PROGRAMME'S OWN season page names one of the competing
  // conferences, the institution has stated which competition it played in, and
  // no third party is better placed to say. That claim wins and the others are
  // recorded beside it.
  //
  // Nothing else resolves. A newer source does not beat an older one — a 2026
  // directory is not a better witness to 2022 than a 2022 standings table — and
  // two conference tables disagreeing with no programme-side statement is a
  // refusal with both records kept.
  const own = usable.filter((c) => c.membershipProvenance === MEMBERSHIP_PROVENANCE.OFFICIAL_PROGRAMME_SOURCE);
  if (own.length === 1 && usable.some((c) => c !== own[0] && c.conferenceId === own[0].conferenceId)) {
    return {
      conferenceId: own[0].conferenceId,
      status: COLLECTION_STATUS.OK,
      chosen: usable.find((c) => c !== own[0] && c.conferenceId === own[0].conferenceId),
      resolvedBy: 'OFFICIAL_PROGRAMME_SOURCE_AGREEMENT',
      corroborations: usable.filter((c) => c.conferenceId === own[0].conferenceId).length - 1,
      claims: usable,
    };
  }
  return {
    conferenceId: null,
    status: COLLECTION_STATUS.CONFLICTING_OFFICIAL_SOURCES,
    claims: usable,
    reason: `official sources name ${ids.length} different conferences: ${usable.map((c) => `${c.conferenceId} (${c.membershipProvenance})`).join(', ')}`,
  };
}

/**
 * A conference record as the conference printed it.
 *
 * W-L-D, which is what every source in this domain publishes and what
 * `competitiveHistory.recordString` already writes. 12A pulled three schools'
 * own headers — Mercyhurst 19-1-1 on 19W/1D/1L, Messiah 20-0-2 on 20W/2D/0L,
 * Grand Valley State 16-2-5 on 16W/5D/2L — and all three are W-L-D.
 *
 * A TWO-PART RECORD HAS NO DRAWS, NOT UNKNOWN DRAWS. "10-0" in a conference
 * table is ten wins and no losses in a competition that had no ties to record,
 * and reading the missing third number as unknown would refuse a complete row.
 * Where the source also printed matches played, the triple must reproduce it or
 * the record is refused: two numbers that do not add up are not a record.
 */
export function parseConferenceRecord(raw, { matchesPlayed = null } = {}) {
  const m = /^(\d{1,2})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(String(raw ?? '').trim());
  if (!m) return { ok: false, reason: 'unreadable' };
  const wins = Number(m[1]);
  const losses = Number(m[2]);
  const draws = m[3] == null ? 0 : Number(m[3]);
  const matches = wins + losses + draws;
  if (matchesPlayed != null && Number.isFinite(Number(matchesPlayed)) && Number(matchesPlayed) !== matches) {
    return { ok: false, reason: `record ${raw} totals ${matches}, source printed ${matchesPlayed} matches` };
  }
  return { ok: true, wins, losses, draws, matches, record: `${wins}-${losses}-${draws}` };
}

/**
 * A programme's structural history across the window.
 *
 * FACTS IN SEQUENCE, and never a trajectory. A move from Division II to
 * Division I is recorded as two seasons in each; it is not an improvement, it is
 * not a decline, and nothing here says why it happened. `changes` exists so a
 * reader is not left to infer a break from a list, and `unknownSeasons` is
 * beside it so a gap is never read as continuity.
 *
 * @param rows `[{ season, conferenceId, conferenceName, historicalDivision }]`
 */
export function structuralHistory(rows = []) {
  const seasons = [...rows]
    .filter((r) => Number.isFinite(Number(r.season)))
    .sort((a, b) => Number(a.season) - Number(b.season))
    .map((r) => ({
      season: Number(r.season),
      conferenceId: r.conferenceId ?? r.conference_id ?? null,
      conferenceName: r.conferenceName ?? r.conference_name ?? null,
      division: r.historicalDivision ?? r.historical_division ?? null,
    }));

  const changes = [];
  for (let i = 1; i < seasons.length; i += 1) {
    const prev = seasons[i - 1];
    const cur = seasons[i];
    // `fromSeason` IS THE PREVIOUS SEASON ON FILE, not the season before this
    // one. Where 2023 and 2024 are missing, a change observed at 2025 is a
    // change from 2022 — and saying "in 2024 and 2025" would assert a 2024
    // membership that is not established. The two are the same number only when
    // the window has no gap in it.
    if (prev.conferenceId && cur.conferenceId && prev.conferenceId !== cur.conferenceId) {
      changes.push({ kind: 'CONFERENCE', season: cur.season, fromSeason: prev.season, from: prev.conferenceName, to: cur.conferenceName });
    }
    if (prev.division && cur.division && prev.division !== cur.division) {
      changes.push({ kind: 'DIVISION', season: cur.season, fromSeason: prev.season, from: prev.division, to: cur.division });
    }
  }

  const conferences = [...new Set(seasons.map((s) => s.conferenceName).filter(Boolean))];
  const divisions = [...new Set(seasons.map((s) => s.division).filter(Boolean))];
  return {
    seasons,
    conferences,
    divisions,
    changes,
    // Every denominator stated rather than inferred.
    knownSeasons: seasons.map((s) => s.season),
    divisionKnownSeasons: seasons.filter((s) => s.division).map((s) => s.season),
    // A single conference across every season we know — and only across those.
    stableConference: conferences.length === 1 ? conferences[0] : null,
    stableDivision: divisions.length === 1 ? divisions[0] : null,
    movedDivision: changes.some((c) => c.kind === 'DIVISION'),
    movedConference: changes.some((c) => c.kind === 'CONFERENCE'),
  };
}

/**
 * A programme's conference record for one season, kept apart from its overall
 * record on purpose.
 *
 * A CONFERENCE RECORD IS NOT COMPARABLE ACROSS CONFERENCES. 8-1-1 in one
 * conference and 8-1-1 in another are the same string about different
 * competitions, and this module will not rank them against each other — that
 * would be schedule strength, which 12A rejected and 12C left rejected. It is
 * reported beside the overall record and never blended into it.
 */
export function conferenceRecordRow(row) {
  const parsed = parseConferenceRecord(row.record ?? null, { matchesPlayed: row.matchesPlayed ?? null });
  if (!parsed.ok) return { season: Number(row.season), available: false, reason: parsed.reason };
  return {
    season: Number(row.season),
    available: true,
    wins: parsed.wins,
    losses: parsed.losses,
    draws: parsed.draws,
    matches: parsed.matches,
    record: parsed.record,
    conferenceName: row.conferenceName ?? null,
    conferenceSize: row.conferenceSize ?? null,
  };
}
