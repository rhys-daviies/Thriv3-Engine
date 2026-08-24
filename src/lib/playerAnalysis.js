import { entities } from '@/api/client';
import { STARTER_MINUTES_THRESHOLD, CURRENT_ROSTER_SEASON } from '@/lib/divisions';

function majorityConfidence(rows) {
  const counts = {};
  for (const r of rows) counts[r.data_confidence] = (counts[r.data_confidence] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * The Section 7 matching algorithm — three phases, run client-side:
 * scouting (hard filters + ±20 soccer-score band) -> researching (roster
 * cross-reference + weighted score) -> ranking & persistence.
 *
 * Phase 2 reads from roster_players (per-player, tagged with each player's
 * own estimated_graduation_year) for any sport the 2025 rebuild covers,
 * matching a recruit's recruiting_class_year against that year specifically
 * — "who's actually graduating the year this recruit would arrive" — rather
 * than "whoever happens to be a senior this season". Sports the rebuild
 * hasn't reached yet (no roster_players rows) fall back to the legacy
 * GraduatingSenior aggregate, unchanged.
 */
export async function analyze(player, { onPhase, onProgress }) {
  const playerSport = player.sport || 'mens-soccer';

  // ---- Phase 1: Scouting ----
  onPhase(1);
  const allColleges = await entities.College.filter({ sport: playerSport });

  const soccerTarget = player.football_ability != null ? player.football_ability * 10 : null;
  // parseFloat(null) is NaN, and NaN slips past a `!= null` guard further down
  // to poison match_score. Normalise anything unparseable back to null.
  const parsedImportance = player.academic_importance !== 'Not Important' && player.academic_importance != null
    ? parseFloat(player.academic_importance)
    : null;
  const academicImportance = Number.isNaN(parsedImportance) ? null : parsedImportance;

  // Exclude colleges flagged inactive (colleges.active === 0) — programs an
  // audit confirmed don't field the sport / aren't valid recruiting targets.
  // Coaching contacts for these still persist in the DB; they just don't
  // surface as match cards. `active` defaults to 1, so null/undefined pass.
  let filtered = allColleges.filter((c) => c.active !== 0);

  if (player.preferred_divisions && player.preferred_divisions.length > 0) {
    filtered = filtered.filter((c) => player.preferred_divisions.includes(c.division));
  }
  if (player.preferred_conferences && player.preferred_conferences.length > 0) {
    filtered = filtered.filter((c) => player.preferred_conferences.includes(c.conference));
  }
  if (academicImportance != null && !Number.isNaN(academicImportance)) {
    filtered = filtered.filter((c) => c.academic_rating != null && c.academic_rating >= academicImportance);
  }
  if (soccerTarget != null) {
    filtered = filtered.filter(
      (c) => c.soccer_score != null && c.soccer_score >= soccerTarget - 20 && c.soccer_score <= soccerTarget + 20
    );
  }

  const filteredPrograms = filtered.map((c) => ({
    name: c.name,
    location: c.location,
    division: c.division,
    conference: c.conference,
    website_domain: c.website_domain,
    soccer_score: c.soccer_score,
    academic_rating: c.academic_rating,
    program_quality_rating: c.soccer_score != null ? c.soccer_score / 10 : null,
    nickname: c.nickname,
    nickname_plural: c.nickname_plural,
    mascot: c.mascot,
    primary_color: c.primary_color,
    secondary_color: c.secondary_color,
    logo_url: c.logo_url,
    conference_champion_2025: c.conference_champion_2025,
    conference_champion_name: c.conference_champion_name,
  }));

  onProgress({ current: 0, total: filteredPrograms.length, school: '', phase: 'scouting', loaded: filteredPrograms.length });

  // ---- Phase 2: Researching ----
  onPhase(2);
  const allRosterPlayers = await entities.RosterPlayer.filter({ sport: playerSport, season: CURRENT_ROSTER_SEASON });
  const useRosterModel = allRosterPlayers.length > 0;

  const rosterModelMap = {};
  let legacyRosterMap = {};
  // Coaching contacts live on GraduatingSenior records regardless of which
  // model supplies the roster/senior data, so build a name -> staff lookup we
  // can join into the roster-model path too (otherwise the Email Coaches
  // button is permanently disabled once roster_players data exists).
  const coachingStaffMap = {};
  if (useRosterModel) {
    for (const rp of allRosterPlayers) {
      (rosterModelMap[rp.college_name] ||= []).push(rp);
    }
    const gradRecords = await entities.GraduatingSenior.filter({ sport: playerSport });
    for (const r of gradRecords) {
      if (r.coaching_staff && r.coaching_staff.length) coachingStaffMap[r.college_name] = r.coaching_staff;
    }
  } else {
    const allRosters = await entities.GraduatingSenior.filter({ sport: playerSport });
    for (const r of allRosters) legacyRosterMap[r.college_name] = r;
  }

  const targetPositionUpper = (player.position || '').toUpperCase();
  const targetYear = player.recruiting_class_year != null ? Number(player.recruiting_class_year) : null;
  const results = [];
  let withRosterData = 0;

  for (let i = 0; i < filteredPrograms.length; i++) {
    const prog = filteredPrograms[i];
    try {
      let validatedPos = [];
      let validatedStarters = [];
      let totalGraduatingSeniors = 0;
      let allNames = [];
      let dataConfidence;
      let officialRosterUrl;
      let coachingStaff = [];
      let notes;
      let confirmedDivision;

      if (useRosterModel) {
        coachingStaff = coachingStaffMap[prog.name] || [];
        const schoolPlayers = rosterModelMap[prog.name] || [];
        const gradYearPlayers = targetYear != null ? schoolPlayers.filter((p) => p.estimated_graduation_year === targetYear) : [];
        if (gradYearPlayers.length > 0) {
          withRosterData++;
          totalGraduatingSeniors = gradYearPlayers.length;
          allNames = gradYearPlayers.map((p) => p.player_name);
          dataConfidence = majorityConfidence(gradYearPlayers);
          officialRosterUrl = gradYearPlayers[0]?.source_roster_url;
          confirmedDivision = gradYearPlayers[0]?.division;

          const atPosition = gradYearPlayers.filter((p) => p.position === targetPositionUpper);
          validatedPos = atPosition.map((p) => p.player_name);
          validatedStarters = atPosition.filter((p) => (p.minutes_played || 0) >= STARTER_MINUTES_THRESHOLD).map((p) => p.player_name);
        }
      } else {
        const record = legacyRosterMap[prog.name];
        if (record) {
          withRosterData++;
          totalGraduatingSeniors = record.total_graduating_seniors || 0;
          allNames = record.all_graduating_senior_names || [];
          dataConfidence = record.data_confidence;
          officialRosterUrl = record.official_roster_url;
          coachingStaff = record.coaching_staff || [];
          notes = record.notes;
          confirmedDivision = record.confirmed_division;

          const posEntry = (record.position_data || []).find((pd) => (pd.position || '').toUpperCase() === targetPositionUpper);
          if (posEntry) {
            const allNamesLower = new Set(allNames.map((n) => n.trim().toLowerCase()));
            validatedPos = (posEntry.graduating_senior_names || []).filter((n) => allNamesLower.has(n.trim().toLowerCase()));
            const validatedPosLower = new Set(validatedPos.map((n) => n.trim().toLowerCase()));
            validatedStarters = (posEntry.graduating_starter_names || []).filter((n) => validatedPosLower.has(n.trim().toLowerCase()));
          }
        }
      }

      const starterBonus = validatedStarters.length * 5;
      const positionBonus = validatedPos.length * 2;
      const soccerCloseness = soccerTarget != null && prog.soccer_score != null
        ? Math.max(0, 70 - Math.abs(prog.soccer_score - soccerTarget) * 3)
        : 60;
      const academicBonus = academicImportance != null && prog.academic_rating != null
        ? Math.min(15, 10 + (prog.academic_rating - academicImportance) * 2)
        : 10;
      const match_score = Math.min(100, Math.round(soccerCloseness + academicBonus + starterBonus + positionBonus));

      results.push({
        ...prog,
        total_graduating_seniors: totalGraduatingSeniors,
        all_graduating_senior_names: allNames,
        graduating_seniors_at_position: validatedPos.length,
        graduating_senior_names_at_position: validatedPos,
        graduating_starters_at_position: validatedStarters.length,
        graduating_starter_names_at_position: validatedStarters,
        data_confidence: dataConfidence,
        official_roster_url: officialRosterUrl,
        division: confirmedDivision || prog.division,
        match_score,
        position_need: validatedStarters.length > 0 ? 'High' : validatedPos.length > 0 ? 'Medium' : 'Low',
        reason: notes,
        coaching_staff: coachingStaff,
      });
    } catch {
      // school failed to score — log and skip, count still increments
    }

    if (i % 20 === 0 || i === filteredPrograms.length - 1) {
      onProgress({ current: i + 1, total: filteredPrograms.length, school: prog.name, phase: 'researching' });
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // ---- Phase 3: Ranking & Persistence ----
  onPhase(3);
  results.sort((a, b) => b.match_score - a.match_score);
  const top100 = results.slice(0, 100);
  const withStarters = top100.filter((r) => r.graduating_starters_at_position > 0).length;
  const summary = `Analyzed ${filteredPrograms.length} programs (${withRosterData} with roster data). Top ${top100.length} ranked by match score. ${withStarters} of the top ${top100.length} have graduating starters at the ${player.position} position.`;

  return { recommendations: top100, summary };
}
