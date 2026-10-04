/**
 * PLAYER-HISTORY INTEGRITY CHECKS (Phase 8B.1A) — permanent, read-only.
 *
 * A name match is a candidate, not a person. These detect any RECURRENCE of a factual
 * prior-programme, transfer or identity claim that does not stand on evidence. Run by
 * `npm run integrity:monitor` (category PLAYER); a HARD finding fails the monitor.
 * -> [{ id, severity, list, note }]
 */
export function playerHistoryChecks(db) {
  const out = []; const mk = (id, severity, list, note) => ({ id, severity, list, note });
  const hasLinks = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='player_observation_links'").get();
  const FACTUAL = ['EXPLICIT_PRIOR_SCHOOL', 'MULTI_SIGNAL', 'REVIEWED', 'PROGRAMME_SCOPED'];
  const priors = db.prepare('SELECT id, college_name, sport, season, prior_programme FROM roster_players WHERE prior_programme IS NOT NULL').all();
  const links = hasLinks ? db.prepare('SELECT link_id, relation, to_observation_id, from_observation_id, from_programme, from_season, to_season, to_programme, sport, decision, evidence_class, evidence_json, evidence_id, reviewed_at FROM player_observation_links').all() : [];
  const verifiedBy = new Map(); for (const l of links) if (l.decision === 'VERIFIED_SAME_PERSON') { const k = `${l.to_observation_id}|${l.from_programme}`; verifiedBy.set(k, [...(verifiedBy.get(k) || []), l]); }
  const label = (r) => `${r.college_name} ${r.sport} ${r.season} <- ${r.prior_programme}`;
  const okLink = (r) => (verifiedBy.get(`${r.id}|${r.prior_programme}`) || []).filter((l) => FACTUAL.includes(l.evidence_class) && (l.evidence_class !== 'PROGRAMME_SCOPED' || r.prior_programme === r.college_name));
  out.push(mk('factual_prior_from_name_only', 'HARD', priors.filter((r) => r.prior_programme !== r.college_name && okLink(r).length !== 1).map(label), 'a cross-programme prior_programme with no VERIFIED_SAME_PERSON link carrying evidence — a name match presented as a transfer'));
  out.push(mk('factual_continuation_without_link', hasLinks ? 'HARD' : 'WARN', priors.filter((r) => r.prior_programme === r.college_name && okLink(r).length !== 1).map(label), 'same-programme continuation with no decided link (run project-minutes)'));
  const sig = (l) => { try { return JSON.parse(l.evidence_json || '{}').signals || {}; } catch { return {}; } };
  const factualCross = links.filter((l) => l.decision === 'VERIFIED_SAME_PERSON' && l.relation !== 'SAME_PROGRAMME_CONTINUATION');
  out.push(mk('contradicted_hometown_on_factual_link', 'HARD', factualCross.filter((l) => l.evidence_class === 'MULTI_SIGNAL' && sig(l).hometown !== 'MATCH').map((l) => l.link_id), 'an inferred (non-explicit) factual link whose hometowns do not match'));
  out.push(mk('simultaneous_conflicting_programmes', 'HARD', factualCross.filter((l) => l.evidence_class !== 'REVIEWED' && sig(l).priorContinues).map((l) => l.link_id), 'factual origin whose prior player is still on the prior programme the same season'));
  out.push(mk('factual_link_without_provenance', 'HARD', links.filter((l) => l.decision === 'VERIFIED_SAME_PERSON' && (!l.evidence_json || !FACTUAL.includes(l.evidence_class) || (l.evidence_class === 'EXPLICIT_PRIOR_SCHOOL' && !l.evidence_id) || (l.evidence_class === 'REVIEWED' && !l.reviewed_at))).map((l) => l.link_id)));
  out.push(mk('invalid_temporal_sequence', 'WARN', links.filter((l) => l.decision === 'VERIFIED_SAME_PERSON' && ((l.from_season && Number(l.from_season) !== Number(l.to_season) - 1) || (l.evidence_class !== 'EXPLICIT_PRIOR_SCHOOL' && l.evidence_class !== 'REVIEWED' && ['BACKWARDS', 'RESET_TO_FRESHMAN'].includes(sig(l).classStep)))).map((l) => l.link_id), 'factual link out of season order, or a class reset/backwards step on an inferred link'));
  const nonFactualPair = new Set(links.filter((l) => l.decision !== 'VERIFIED_SAME_PERSON').map((l) => `${l.to_observation_id}|${l.from_programme}`));
  out.push(mk('ambiguous_link_consumed_as_verified', 'HARD', priors.filter((r) => nonFactualPair.has(`${r.id}|${r.prior_programme}`) && !verifiedBy.has(`${r.id}|${r.prior_programme}`)).map(label), 'prior_programme set from a PROBABLE/CANDIDATE/AMBIGUOUS/CONTRADICTED claim'));
  const observed = db.prepare("SELECT COUNT(*) n FROM recruiting_arrivals WHERE prior_confidence = 'OBSERVED'").get().n;
  out.push(mk('candidate_transfer_presented_as_factual', 'HARD', observed ? [`${observed} recruiting_arrivals rows claim an OBSERVED prior with no evidence path`] : [], 'NAME_MATCH priors in recruiting_arrivals are candidates; nothing may relabel them OBSERVED'));
  const ids = new Set(db.prepare('SELECT id FROM roster_players').all().map((r) => r.id));
  const merged = links.filter((l) => !ids.has(l.to_observation_id) || (l.from_observation_id && !ids.has(l.from_observation_id))).map((l) => l.link_id);
  const fromTo = new Map(); for (const l of factualCross) if (l.from_observation_id) fromTo.set(l.from_observation_id, [...(fromTo.get(l.from_observation_id) || []), l.to_observation_id]);
  for (const [from, tos] of fromTo) if (new Set(tos).size > 1) merged.push(`one prior observation ${from} claimed by ${new Set(tos).size} destinations`);
  out.push(mk('observation_overwritten_by_identity_merge', 'HARD', merged, 'a link to a vanished observation, or one person verified into two places'));
  return out;
}
