/**
 * Thin fetch wrapper replacing the Base44 SDK client. Mirrors the same method
 * names/shapes (`entities.X.filter/list/create/update/delete`,
 * `integrations.Core.*`, `functions.*`) so page code that would have called
 * `base44.entities.Player.filter({sport})` reads the same here.
 */

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Request failed (${res.status}): ${text}`);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  return res.text();
}

function makeEntity(name) {
  const base = `/api/entities/${name}`;
  return {
    list(sort, limit) {
      const qs = new URLSearchParams();
      if (sort) qs.set('_sort', sort);
      if (limit) qs.set('_limit', String(limit));
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return request(`${base}${suffix}`);
    },
    filter(query = {}, sort, limit) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) qs.set(k, v);
      if (sort) qs.set('_sort', sort);
      if (limit) qs.set('_limit', String(limit));
      return request(`${base}?${qs.toString()}`);
    },
    get(id) {
      return request(`${base}/${id}`);
    },
    create(data) {
      return request(base, { method: 'POST', body: JSON.stringify(data) });
    },
    update(id, data) {
      return request(`${base}/${id}`, { method: 'PUT', body: JSON.stringify(data) });
    },
    delete(id) {
      return request(`${base}/${id}`, { method: 'DELETE' });
    },
  };
}

export const entities = {
  Player: makeEntity('players'),
  College: makeEntity('colleges'),
  GraduatingSenior: makeEntity('graduating_seniors'),
  RosterPlayer: makeEntity('roster_players'),
};

export const publishing = {
  status(playerId) {
    return request(`/api/players/${playerId}/publish`);
  },
  /** Rebuilds the page locally so it can be previewed without deploying. */
  regenerate(playerId) {
    return request(`/api/players/${playerId}/regenerate`, { method: 'POST' });
  },
  goLive(playerId) {
    return request(`/api/players/${playerId}/publish`, { method: 'POST' });
  },
};

export const coaches = {
  /**
   * Address provenance for a sport, as { email: status }. Fetched rather than
   * baked into the stored analysis: recommendations are a persisted blob, so
   * an athlete analysed before a contact was re-verified would keep showing
   * the old status forever.
   */
  emailStatus(sport) {
    const qs = sport ? `?sport=${encodeURIComponent(sport)}` : '';
    return request(`/api/coaches/email-status${qs}`);
  },
};

export const outreach = {
  /** Creates outreach and hands one message per coach to Outlook. */
  send(payload) {
    return request('/api/outreach/send', { method: 'POST', body: JSON.stringify(payload) });
  },
};

/**
 * Finite recruiting campaigns around an athlete's Top 100.
 *
 * A purpose-built namespace rather than an `entities` table, and the
 * difference is the point: `entities` is unvalidated pass-through CRUD, and a
 * campaign's rank, score, provenance and programme rows are a SNAPSHOT that
 * nothing may rewrite. The server refuses any field outside the small
 * operator-authored set — it answers 400 naming the field rather than
 * silently dropping it — so sending more than these does not fail quietly.
 *
 * Note what `createForPlayer` does NOT send: the Top 100. The server reads the
 * athlete's own stored analysis and freezes that, so a campaign records what
 * the product actually ranked rather than whatever a long-open tab was
 * holding — the same reasoning as the evidence endpoints, which take
 * programme names and recompute every fact for themselves.
 */
export const campaigns = {
  /**
   * @param {object} [payload]  label, starts_on, outreach_ends_on, ends_on.
   *   Dates are YYYY-MM-DD service boundaries, not timestamps.
   * @returns {Promise<{campaign: object, programmes: object[]}>} a DRAFT
   *   campaign; activating it is a separate, deliberate call to `update`.
   */
  createForPlayer(playerId, payload = {}) {
    return request(`/api/players/${playerId}/campaigns`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /** Summaries only — no programme rows. Use `get` for the one being read. */
  listForPlayer(playerId) {
    return request(`/api/players/${playerId}/campaigns`);
  },

  /** The campaign and its programmes, in snapshotted rank order. */
  get(campaignId) {
    return request(`/api/campaigns/${campaignId}`);
  },

  /**
   * ONE KIND OF CHANGE PER CALL. Either the details — `label`, `starts_on`,
   * `outreach_ends_on`, `ends_on` in any combination — or a lifecycle move,
   * `{ state: 'active' }` or `{ state: 'closed', close_reason: '...' }`.
   * Mixing them is refused, because the two are separate operations server-side
   * and a mixed request could half-apply.
   *
   * Dates are validated against the MERGED result, so moving `starts_on` past
   * an existing `ends_on` is refused even though the field alone is valid.
   */
  update(campaignId, payload) {
    return request(`/api/campaigns/${campaignId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  /**
   * One programme inside one campaign, addressed through its parent — the
   * server checks the programme actually belongs to that campaign.
   *
   * Either a tier change — `{ tier: 'A' }`, or `{ tier_source: 'AUTO' }` to put
   * it back where the rank bands had it — or a state change, `{ state: 'stopped',
   * state_reason: 'not_recruiting' }`. `tier_source` is a request to restore and
   * accepts only 'AUTO'; it becomes 'OPERATOR' by setting a tier and is never
   * declared directly.
   */
  updateProgramme(campaignId, programmeCampaignId, payload) {
    return request(`/api/campaigns/${campaignId}/programmes/${programmeCampaignId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  /**
   * What this campaign would do next across its programmes, and what is
   * stopping each of them.
   *
   * A DRY RUN. It sends nothing, reserves nothing and changes nothing — asking
   * twice gives the same answer twice, because nothing was consumed by asking.
   * There is no companion method that executes it: the plan exists so a person
   * can look at it before anything is allowed to act on it.
   *
   * Returns `{ campaign, summary, programmes, priorityActions }`.
   * `priorityActions` is the order the actions should be CONSIDERED in, with
   * `withinBudgetToday` marking how far down today's remaining budget reaches.
   * It is recomputed on every call and is not a queue.
   *
   * @param {string} [opts.onDate]  YYYY-MM-DD. Campaign boundaries and
   *   follow-up eligibility are timezone-free dates, so reviewing tomorrow's
   *   plan is a matter of asking for tomorrow. Defaults to today, UTC.
   */
  executionPlan(campaignId, { onDate } = {}) {
    const qs = onDate ? `?on_date=${encodeURIComponent(onDate)}` : '';
    return request(`/api/campaigns/${campaignId}/execution-plan${qs}`);
  },
};

/**
 * A response we want as bytes.
 *
 * Separate from `request()` on purpose: a function whose return type depends
 * on a response header is a trap for every caller that already exists. On a
 * failure the server answers with JSON, so the message is read out and thrown
 * the same way `request()` does rather than discarded.
 */
async function requestBlob(path, options = {}) {
  const res = await fetch(path, options);
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try { message = JSON.parse(text).error || text; } catch { /* not JSON */ }
    throw new Error(message || `Request failed (${res.status})`);
  }
  return res.blob();
}

export const evidence = {
  /**
   * What the server can genuinely say about this athlete at these programmes,
   * keyed by college name.
   *
   * The composer sends names and nothing else. It holds the departure numbers
   * from its own matching run and deliberately does not send them: the server
   * recomputes them, so the sentences in a coach's inbox come from the
   * database rather than from whatever a long-open tab was holding.
   */
  /**
   * @param {object} [opts.prefer]          { "<college>": ["KIND", ...] }
   * @param {object} [opts.preferStructure] { "<college>": "STRUCTURE_KEY" }
   *
   * Both are REQUESTS, not instructions. The server validates each kind
   * against the evidence it generated and each structure against what that
   * evidence supports, and refuses rather than honours anything else — which
   * is why the client is allowed to ask at all.
   */
  summaries(playerId, collegeNames, { prefer = null, preferStructure = null } = {}) {
    return request(`/api/players/${playerId}/evidence`, {
      method: 'POST',
      body: JSON.stringify({ collegeNames, prefer, preferStructure }),
    });
  },
};

/**
 * The operator decision surface's own endpoint.
 *
 * Separate from `evidence` above, matching the server: that one returns the
 * composer's rendered prose, this one returns structured facts the screen
 * phrases for itself. Same identity mechanism — athlete in the path, programme
 * names in the body — because there is one athlete and one list of programmes,
 * not two.
 */
export const operatorEvidence = {
  summaries(playerId, collegeNames) {
    return request(`/api/players/${playerId}/operator-evidence`, {
      method: 'POST',
      body: JSON.stringify({ collegeNames }),
    });
  },
};

/**
 * Recruiting signals for the match card.
 *
 * A third evidence endpoint beside `evidence` and `operatorEvidence`, on the
 * same identity mechanism. It is separate because the licence is: six of the
 * twenty-six kinds may appear beside a match score, and none of them is
 * anything the score already consumes.
 */
export const matchingSummary = {
  summaries(playerId, collegeNames) {
    return request(`/api/players/${playerId}/matching-summary`, {
      method: 'POST',
      body: JSON.stringify({ collegeNames }),
    });
  },
};

export const philosophy = {
  /** One compact row per school for the Program Philosophy tab. */
  summaries(playerId, collegeIds) {
    return request(`/api/players/${playerId}/philosophy/summaries`, {
      method: 'POST',
      body: JSON.stringify({ collegeIds }),
    });
  },
  poolStatus() {
    return request('/api/philosophy/pool');
  },
  /** One document. Without a player it omits the athlete-specific part. */
  report(collegeId, playerId = null) {
    return requestBlob(playerId
      ? `/api/players/${playerId}/philosophy/${collegeId}/report.pdf`
      : `/api/philosophy/${collegeId}/report.pdf`);
  },
};

export const engagement = {
  syncStatus() {
    return request('/api/engagement/sync');
  },
  syncNow() {
    return request('/api/engagement/sync', { method: 'POST' });
  },
  athlete(athleteId) {
    return request(`/api/engagement/athlete/${athleteId}`);
  },
  sessions(outreachId) {
    return request(`/api/engagement/outreach/${outreachId}/sessions`);
  },
  setResponded(outreachId, responded) {
    return request(`/api/engagement/outreach/${outreachId}/responded`, {
      method: 'POST',
      body: JSON.stringify({ responded }),
    });
  },
};

export const integrations = {
  Core: {
    async UploadFile(file) {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/uploads', { method: 'POST', body: form });
      if (!res.ok) throw new Error('Upload failed');
      return res.json(); // { file_url }
    },
  },
};

function callFunction(name, body) {
  return request(`/api/functions/${name}`, { method: 'POST', body: JSON.stringify(body || {}) });
}

export const functions = {
  buildGraduatingDatabase: (body) => callFunction('buildGraduatingDatabase', body),
  evaluateSoccerProgram: (body) => callFunction('evaluateSoccerProgram', body),
  importSoccerScores: (body) => callFunction('importSoccerScores', body),
  listSchoolsByDivision: (body) => callFunction('listSchoolsByDivision', body),
  seedD1Schools: (body) => callFunction('seedD1Schools', body),
  cleanInactiveSchools: (body) => callFunction('cleanInactiveSchools', body),
  importGraduatingCSV: (body) => callFunction('importGraduatingCSV', body),
  csvAgentChat: (body) => request('/api/csv-agent/chat', { method: 'POST', body: JSON.stringify(body) }),
  exportGraduatingDatabase(body) {
    return requestBlob('/api/functions/exportGraduatingDatabase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
  },
};
