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
    try { message = JSON.parse(text).error || text; } catch { /* not JSON */ }
    throw new Error(message || `Request failed (${res.status})`);
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
    async SendEmail({ to, cc, subject, body }) {
      // Stubbed per local-app scope: logs server-side and returns a mailto: link
      // instead of sending real mail. See server/routes/sendEmail.js.
      return request('/api/send-email', {
        method: 'POST',
        body: JSON.stringify({ to, cc, subject, body }),
      });
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
