/**
 * Thin fetch wrapper replacing the Base44 SDK client. Mirrors the same method
 * names/shapes (`entities.X.filter/list/create/update/delete`,
 * `integrations.Core.*`, `functions.*`) so page code that would have called
 * `base44.entities.Player.filter({sport})` reads the same here.
 */

/**
 * SIGNED OUT, ANYWHERE — Phase 13K.
 *
 * The server answers 401 to any protected request without a live session. It
 * can happen to any call at any moment — a session expires, an account is
 * deactivated, the secret is rotated — so the app learns about it here, once,
 * rather than in every component that might be the unlucky caller.
 */
const unauthenticatedListeners = new Set();

export function onUnauthenticated(listener) {
  unauthenticatedListeners.add(listener);
  return () => unauthenticatedListeners.delete(listener);
}

function noteUnauthenticated() {
  for (const listener of unauthenticatedListeners) {
    try { listener(); } catch { /* a listener must not break a request */ }
  }
}

/** True when the response says "sign in", so callers can stop rather than retry. */
export class SignedOutError extends Error {
  constructor(message) {
    super(message || 'Sign in to continue.');
    this.name = 'SignedOutError';
    this.signedOut = true;
  }
}

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    // The session cookie is same-origin in every deployment shape, but saying
    // so is what keeps a future cross-origin build from silently sending no
    // credentials and looking like a permissions bug.
    credentials: 'same-origin',
    ...options,
  });
  if (res.status === 401) {
    noteUnauthenticated();
    throw new SignedOutError();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = text;
    let code;
    try {
      const parsed = JSON.parse(text);
      message = parsed.error || text;
      code = parsed.code;
    } catch { /* not JSON */ }
    // `code` and `status` carried alongside the message rather than instead of
    // it. Every caller that reads `err.message` is unaffected; the ones that
    // need to tell a query-too-short apart from a school that is not in the
    // registry can branch on the server's own machine-readable code instead of
    // matching on a sentence somebody may improve later.
    throw Object.assign(new Error(message || `Request failed (${res.status})`), {
      code, status: res.status,
    });
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

/**
 * Sign in, sign out, who am I — Phase 13K.
 *
 * Three calls and no more: there is no registration, no password reset over
 * HTTP and no invitation flow, because an operator account is created on the
 * host by somebody with shell access. `me` answers with null rather than
 * failing when nobody is signed in, so a page load is never an error.
 */
export const auth = {
  me() {
    return request('/api/auth/me');
  },
  /**
   * Deliberately not routed through `request()`: a rejected sign-in is a 401,
   * and treating it as "you have been signed out" would replace the server's
   * own wording with a generic message and fire the sign-out listeners at
   * somebody who was never signed in.
   */
  async login(email, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw Object.assign(new Error(body.error || 'Sign-in failed.'), {
        code: body.code, status: res.status,
      });
    }
    return body;
  },
  async logout() {
    // 204, so there is no body to read.
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  },
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
  const res = await fetch(path, { credentials: 'same-origin', ...options });
  if (res.status === 401) { noteUnauthenticated(); throw new SignedOutError(); }
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
/**
 * A blob AND the name the server gave it — 13J / §14.
 *
 * The report's filename is decided by `reportFilename` on the server and is
 * part of the frozen product; the client must not reconstruct it. It reaches
 * us in `Content-Disposition`, in both an ASCII `filename=` and an RFC 5987
 * `filename*=`, and the second is preferred because it carries the exact
 * spelling of a name like "Zoё".
 */
async function requestPdf(path, options = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...options });
  if (res.status === 401) { noteUnauthenticated(); throw new SignedOutError(); }
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try { message = JSON.parse(text).error || text; } catch { /* not JSON */ }
    throw new Error(message || `Request failed (${res.status})`);
  }
  return { blob: await res.blob(), filename: filenameFrom(res.headers.get('content-disposition')) };
}

export function filenameFrom(disposition) {
  if (!disposition) return null;
  const extended = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (extended) { try { return decodeURIComponent(extended[1].trim()); } catch { /* fall through */ } }
  const plain = disposition.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1].trim() : null;
}

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
  /**
   * One document, with the filename the server chose for it. Without a player
   * it omits the athlete-specific part.
   */
  report(collegeId, playerId = null) {
    return requestPdf(playerId
      ? `/api/players/${playerId}/philosophy/${collegeId}/report.pdf`
      : `/api/philosophy/${collegeId}/report.pdf`);
  },
};

/**
 * The delivery surface — 13J.
 *
 * `generate` persists an immutable artefact and a history row; the two
 * `philosophy.report` endpoints above stay as the direct, unrecorded path.
 */
export const reports = {
  athletes(q = '') {
    return request(`/api/reports/athletes${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  },
  programmes(q = '', sport = null) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (sport) params.set('sport', sport);
    const qs = params.toString();
    return request(`/api/reports/programmes${qs ? `?${qs}` : ''}`);
  },
  /** One programme by id, sport-scoped — the link from Program Philosophy. */
  programme(id, sport = null) {
    const qs = sport ? `?sport=${encodeURIComponent(sport)}` : '';
    return request(`/api/reports/programmes/${encodeURIComponent(id)}${qs}`);
  },
  history({ athleteId = null, collegeId = null } = {}) {
    const params = new URLSearchParams();
    if (athleteId) params.set('athleteId', athleteId);
    if (collegeId) params.set('collegeId', collegeId);
    const qs = params.toString();
    return request(`/api/reports${qs ? `?${qs}` : ''}`);
  },
  generate({ athleteId = null, collegeId }) {
    return request('/api/reports', {
      method: 'POST',
      body: JSON.stringify({ athleteId, collegeId }),
    });
  },
  download(id) {
    return requestPdf(`/api/reports/${id}/download`);
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

/**
 * Programmes an athlete has a RELATIONSHIP with, as opposed to a rank.
 *
 * A purpose-built namespace rather than an `entities` table, for the reason
 * campaigns gives and one of its own: `entities` is unvalidated pass-through
 * CRUD, and through it a client could write any `college_name` it liked into
 * an athlete's list. The point of `athlete_programmes` is that a programme
 * identity is COPIED FROM THE REGISTRY rather than described by a request, so
 * the only way to name one here is a `college_id` the search returned.
 *
 * Note what none of these calls touch: the stored analysis. A specific request
 * is a relationship, not a recommendation — adding one does not put a school
 * in the Top 100, does not change a rank, and does not reach the reserve.
 */
export const athleteProgrammes = {
  /**
   * Find programmes the operator may then choose between. DISCOVERY, NOT
   * RESOLUTION: it answers with candidates and the operator picks one. There
   * is no call here that turns typed text into a school.
   *
   * Refusals carry a `code` — SEARCH_QUERY_TOO_SHORT, SPORT_REQUIRED — so the
   * UI can say the right thing without matching on the message.
   */
  search({ sport, q, limit } = {}) {
    const qs = new URLSearchParams();
    if (sport) qs.set('sport', sport);
    if (q !== undefined) qs.set('q', q);
    if (limit !== undefined) qs.set('limit', String(limit));
    return request(`/api/colleges/search?${qs.toString()}`);
  },

  /** Every relationship this athlete has, whatever state it is in. */
  list(playerId) {
    return request(`/api/players/${playerId}/programmes`);
  },

  /**
   * Create the relationship, or apply this state to the one that already
   * exists. AN UPSERT, and that is what makes a specific request safe to make
   * against a school that is already flagged: it lands on the same row and
   * leaves every other piece of state on it alone.
   *
   * `college_id` and the state fields only. Sending `college_name` is a 400
   * naming the field — the server reads the name off the registry row.
   */
  upsert(playerId, payload) {
    return request(`/api/players/${playerId}/programmes`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /** Change the state of an existing relationship. Never the programme it is with. */
  update(playerId, id, payload) {
    return request(`/api/players/${playerId}/programmes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
};
