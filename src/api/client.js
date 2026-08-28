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
