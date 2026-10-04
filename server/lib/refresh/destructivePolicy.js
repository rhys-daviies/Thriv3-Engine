/**
 * DESTRUCTIVE-ACTION POLICY — Phase 7E.
 *
 * Some canonical changes are cheap to get wrong and expensive to notice: a coach filed at
 * the wrong institution looks exactly like a correct one. Those actions need STRONGER
 * PROOF than an ordinary refresh update, and every one of them needs an operator review.
 * Deletion is never an automatic outcome of a refresh: history is kept by marking
 * (PROVEN_STALE, inactive, closed period, superseded link), not by removing.
 *
 *   authorizeAction(action, facts) -> { allowed, requires_review, missing[] }
 *
 * `facts` is what the classifier established (source tiers, ownership, same-person
 * evidence, second source ...). `allowed` means "may be staged as promotable once
 * reviewed"; nothing here writes.
 */
export const PROTECTED_ACTIONS = Object.freeze({
  DELETE_COACH: { forbidden: true, prefer: 'MARK_PROVEN_STALE', why: 'a refresh never deletes a person; departure is a currentness fact' },
  DELETE_PROGRAMME: { forbidden: true, prefer: 'DEACTIVATE_PROGRAMME', why: 'rows keyed on the programme would be orphaned' },
  DELETE_ROSTER_ROW: { forbidden: true, prefer: 'none — absence from a later roster is not deletion', why: 'historical roster membership is permanent' },
  CHANGE_INSTITUTION: { needs: ['source_tier_A', 'source_owned_by_target_entity', 'target_programme_active'], why: 'reassigning a coach is the wrong-school defect when it is wrong' },
  CHANGE_ATHLETICS_ENTITY: { needs: ['source_tier_A', 'ownership_chain', 'no_collision'], why: 'moves every row keyed on the programme' },
  CHANGE_FEDERAL_UNITID: { needs: ['federal_registry_source', 'self_identification'], why: 'a UNITID is a federal fact, never inferred' },
  CHANGE_DIVISION: { needs: ['division_authority', 'effective_season', 'no_history_rewrite'], why: 'membership changes move coverage between divisions' },
  DEACTIVATE_PROGRAMME: { needs: ['programme_status_authority'], why: 'removes a programme from the current universe' },
  CREATE_PROGRAMME: { needs: ['programme_status_authority', 'entity_resolved'], why: 'adds to the current universe' },
  REPLACE_VERIFIED_EMAIL: { needs: ['source_tier_A', 'source_owned_by_programme_entity', 'same_person_evidence', 'new_email_published', 'old_email_absent'], why: 'a changed address must be the same person, published' },
  CHANGE_DOMAIN_OWNERSHIP: { needs: ['ownership_chain', 'no_collision', 'not_shared_platform'], why: 'a host decides the institution of every page on it' },
  MERGE_PROGRAMMES: { needs: ['same_entity', 'same_sport'], why: 'linked, never physically merged (importers match exact names)' },
  MERGE_PEOPLE: { needs: ['same_programme', 'same_person_evidence'], why: 'two people can share a name' },
  MARK_PROVEN_STALE: { needs: ['source_tier_A', 'second_source_or_named_replacement'], why: 'absence from one page is not proof of departure (Phase 4D)' },
});

export function isProtected(action) { return Object.prototype.hasOwnProperty.call(PROTECTED_ACTIONS, action); }

export function authorizeAction(action, facts = {}) {
  const p = PROTECTED_ACTIONS[action];
  if (!p) return { allowed: true, requires_review: false, missing: [] };
  if (p.forbidden) return { allowed: false, requires_review: true, missing: [`${action} is never performed by a refresh — ${p.why}; use ${p.prefer}`] };
  const missing = p.needs.filter((n) => facts[n] !== true);
  return { allowed: missing.length === 0, requires_review: true, missing };
}
