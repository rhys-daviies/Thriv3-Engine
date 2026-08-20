import { entities } from '@/api/client';

/**
 * The Section 7 matching algorithm — three phases, run client-side against
 * the local College / GraduatingSenior data, exactly as documented:
 * scouting (hard filters + ±20 soccer-score band) -> researching (roster
 * cross-reference + weighted score) -> ranking & persistence.
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

  let filtered = allColleges;

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
  }));

  onProgress({ current: 0, total: filteredPrograms.length, school: '', phase: 'scouting', loaded: filteredPrograms.length });

  // ---- Phase 2: Researching ----
  onPhase(2);
  const allRosters = await entities.GraduatingSenior.filter({ sport: playerSport });
  const rosterMap = {};
  for (const r of allRosters) rosterMap[r.college_name] = r;

  const targetPositionUpper = (player.position || '').toUpperCase();
  const results = [];
  let withRosterData = 0;

  for (let i = 0; i < filteredPrograms.length; i++) {
    const prog = filteredPrograms[i];
    try {
      const record = rosterMap[prog.name];
      let validatedPos = [];
      let validatedStarters = [];
      let totalGraduatingSeniors = 0;
      let allNames = [];
      let dataConfidence;
      let officialRosterUrl;
      let coachingStaff = [];
      let notes;
      let confirmedDivision;

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
