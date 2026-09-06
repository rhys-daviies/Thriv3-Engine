import db from '../db/client.js';

/**
 * THE ONE CHECK THAT MAKES CAMPAIGN ATTRIBUTION MEAN ANYTHING.
 *
 * Two tables carry `programme_campaign_id` and they mean different things, so
 * both are written by their own module — relationship provenance by
 * `outreach.js`, per-message attribution by `outreachSend.js`. What they share
 * is the question "is this programme campaign actually the right one for this
 * athlete and this coach", and that is all this module answers.
 *
 * It lives here rather than in `server/lib/campaigns.js` deliberately: that
 * module owns campaign lifecycle and is already large, and this is not a
 * campaign operation. It is a guard the outreach side needs before it writes a
 * foreign key.
 *
 * WHAT IT PREVENTS, concretely. A programme campaign id is an opaque string
 * that arrives from a caller. Without this, one belonging to a different
 * athlete — or to Duke while the message goes to Clemson — would be written
 * without complaint, and every later reading of that campaign's sends would be
 * quietly wrong in a way nothing could detect afterwards.
 */

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

const PROGRAMME_CAMPAIGN = db.prepare(`
  SELECT pc.id, pc.college_name, pc.sport, pc.campaign_id, c.athlete_id
  FROM programme_campaigns pc
  JOIN campaigns c ON c.id = pc.campaign_id
  WHERE pc.id = ?
`);

const COACH = db.prepare('SELECT id, full_name, school, sport FROM coaches WHERE id = ?');

/**
 * Resolve a programme campaign and prove it belongs to this athlete and this
 * coach's programme, or refuse.
 *
 * PROGRAMME IDENTITY IS `(college_name, sport)`, which is what every table in
 * this database joins on — `coaches.school`, `outreach_evidence.college_name`,
 * `outreach_send.college_name`, `roster_players.college_name`. All 6,347 coach
 * rows carry a non-null school and sport, and on all 96 existing outreach rows
 * `coaches.school` equals the programme name the send recorded, so the pair is
 * a sound key here rather than an approximation.
 *
 * The sport is checked as well as the name because a school fields two
 * programmes: one person can staff both the men's and the women's side, and
 * `coaches` is keyed on `(email, school, sport)` precisely so those are two
 * rows. Matching on the name alone would let a women's campaign attribute a
 * men's send.
 *
 * @returns {{id, campaign_id, athlete_id, college_name, sport}} the verified row.
 */
export function resolveProgrammeCampaignFor({ programmeCampaignId, athleteId, coachId }) {
  const pc = PROGRAMME_CAMPAIGN.get(programmeCampaignId);
  if (!pc) {
    throw fail('PROGRAMME_CAMPAIGN_NOT_FOUND', `No programme campaign ${programmeCampaignId}`);
  }

  if (pc.athlete_id !== athleteId) {
    // Deliberately does not name the other athlete.
    throw fail(
      'CAMPAIGN_ATHLETE_MISMATCH',
      `Programme campaign ${programmeCampaignId} belongs to a different athlete's campaign. `
      + 'Outreach is attributed to the campaign of the athlete it is sent for.',
    );
  }

  const coach = COACH.get(coachId);
  if (!coach) throw fail('COACH_NOT_FOUND', `No coach ${coachId}`);

  if (coach.school !== pc.college_name || coach.sport !== pc.sport) {
    throw fail(
      'CAMPAIGN_PROGRAMME_MISMATCH',
      `Programme campaign ${programmeCampaignId} is for ${pc.college_name} (${pc.sport}), `
      + `but this coach is at ${coach.school} (${coach.sport}). `
      + 'A message is attributed to the programme campaign for the programme it was sent to.',
    );
  }

  return pc;
}

/**
 * The same check, expressed as a value rather than a throw, for a caller that
 * already knows the id may be absent.
 *
 * `null` in means `null` out and NO validation — an unattributed relationship
 * or send is a legitimate record of manual outreach, not an error.
 */
export function verifiedProgrammeCampaignId({ programmeCampaignId, athleteId, coachId }) {
  if (programmeCampaignId === null || programmeCampaignId === undefined) return null;
  return resolveProgrammeCampaignFor({ programmeCampaignId, athleteId, coachId }).id;
}
