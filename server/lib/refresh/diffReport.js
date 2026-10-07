/**
 * ANNUAL DIFF REPORT — Phase 7E. Human-readable, produced BEFORE promotion, from the staged
 * observations (and the gate result when there is one). No black-box annual overwrite: an
 * operator reads this, reviews what needs review, and only then runs the promotion.
 *
 * `redact: true` replaces person names with a stable hash and drops addresses, so the report
 * can be committed/shared; the unredacted form stays in gitignored server/data/generated/.
 */
import { sha256 } from './staging.js';

const J = (s) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function personOf(o) {
  const p = J(o.proposed_json); const r = J(o.raw_json); const e = J(o.evidence_json);
  return p.full_name || p.player_name || e.person || null;
}

export function buildDiffReport({ batch, observations, gate = null, plan = null }, { redact = true } = {}) {
  const who = (name) => (!name ? '(unnamed)' : redact ? `person#${sha256(name).slice(0, 8)}` : name);
  const clean = (s) => (redact ? String(s ?? '').replace(EMAIL_RE, '[address]') : String(s ?? ''));
  const line = (o, extra = '') => {
    const e = J(o.evidence_json); const why = [...(e.why || []), ...(e.notes || [])].map(clean).join('; ');
    const subj = o.dataset === 'COACH' || o.dataset === 'ROSTER' ? `${who(personOf(o))} @ ${o.raw_name}` : `${o.raw_name || o.target_key}`;
    return `- ${subj}${extra ? ` — ${extra}` : ''}${why ? ` _(${why})_` : ''}${o.requires_review ? ' **[review]**' : ''}`;
  };
  const pick = (ds, f) => observations.filter((o) => o.dataset === ds && f(o));
  const sec = (title, list, fmt = (o) => line(o)) => [`### ${title} (${list.length})`, ...(list.length ? list.slice(0, 200).map(fmt) : ['- none']), list.length > 200 ? `- … ${list.length - 200} more` : ''].filter(Boolean).join('\n');
  const P = (ds, a) => pick(ds, (o) => o.proposed_action === a);
  const cls = (ds, c) => pick(ds, (o) => o.classification === c);
  const periodDesc = (o) => { const e = J(o.evidence_json); return e.current && e.observed ? `${e.current.division}/${e.current.conference || '—'} → ${e.observed.division}/${e.observed.conference || '—'} (${e.observed.membership_status}) from ${o.observed_season}` : ''; };
  const out = [];
  out.push(`# Refresh diff — ${batch.batch_id}`);
  out.push(`season ${batch.season} · scope ${batch.scope} · status ${batch.status} · batch hash \`${String(batch.batch_hash).slice(0, 16)}\` · ${observations.length} observations${redact ? ' · REDACTED' : ''}`);
  out.push('');
  out.push('## PROGRAMMES');
  out.push(sec('added', P('PROGRAMME', 'CREATE_PROGRAMME')));
  out.push(sec('discontinued', P('PROGRAMME', 'DEACTIVATE_PROGRAMME')));
  out.push(sec('division / membership changed', [...P('PROGRAMME', 'CHANGE_DIVISION'), ...P('PROGRAMME', 'CHANGE_MEMBERSHIP_STATUS')], (o) => line(o, periodDesc(o))));
  out.push(sec('conference changed', P('PROGRAMME', 'CHANGE_CONFERENCE'), (o) => line(o, periodDesc(o))));
  out.push(sec('identity changed / unresolved', pick('PROGRAMME', (o) => ['IDENTITY_AMBIGUOUS', 'CONTRADICTION'].includes(o.classification))));
  out.push(sec('absent from an official membership listing (investigate)', cls('PROGRAMME', 'DISAPPEARED_FROM_SOURCE')));
  out.push('');
  out.push('## COACHES');
  out.push(sec('added', P('COACH', 'CREATE_COACH')));
  out.push(sec('departed — named replacement (STALE_CANDIDATE)', cls('COACH', 'STALE_CANDIDATE')));
  out.push(sec('absent from a complete staff page (investigate, not deleted)', cls('COACH', 'DISAPPEARED_FROM_SOURCE')));
  out.push(sec('role changed', P('COACH', 'UPDATE_COACH_ROLE')));
  out.push(sec('email changed / added / now published', [...P('COACH', 'REPLACE_VERIFIED_EMAIL'), ...P('COACH', 'ADD_PUBLISHED_EMAIL'), ...P('COACH', 'CONFIRM_OBSERVED_EMAIL')], (o) => line(o, o.proposed_action)));
  out.push(sec('unresolved (identity / untrusted source)', pick('COACH', (o) => ['IDENTITY_AMBIGUOUS', 'SOURCE_UNTRUSTED', 'CONTRADICTION', 'POSSIBLE_CHANGE'].includes(o.classification)), (o) => line(o, o.classification)));
  out.push(`- confirmed unchanged: ${cls('COACH', 'CONFIRMED_UNCHANGED').length}`);
  out.push('');
  out.push('## ROSTERS');
  const notes = (o) => (J(o.evidence_json).notes || []).join(' ');
  out.push(sec('added player-seasons', P('ROSTER', 'INSERT_ROSTER_ROW')));
  out.push(sec('departed (absent from a complete roster; kept)', cls('ROSTER', 'DISAPPEARED_FROM_SOURCE')));
  out.push(sec('transfer candidates (not linked automatically)', pick('ROSTER', (o) => /TRANSFER CANDIDATE/.test(notes(o)))));
  out.push(sec('changed class/year or position (held values never overwritten)', pick('ROSTER', (o) => o.proposed_action === 'REVIEW_ROSTER_FIELDS' || /CHANGED_(POSITION|CLASS)/.test(notes(o)))));
  out.push(sec('identity ambiguity', pick('ROSTER', (o) => ['IDENTITY_AMBIGUOUS', 'CONTRADICTION'].includes(o.classification)), (o) => line(o, o.classification)));
  out.push(`- confirmed unchanged: ${cls('ROSTER', 'CONFIRMED_UNCHANGED').length} · filled empty fields: ${P('ROSTER', 'FILL_ROSTER_FIELDS').length} · untrusted/non-player/frozen: ${cls('ROSTER', 'SOURCE_UNTRUSTED').length}`);
  out.push('');
  out.push('## DOMAINS');
  out.push(sec('new', P('DOMAIN', 'ASSIGN_DOMAIN'), (o) => line(o, `${o.target_key} → ${J(o.proposed_json).ownership_class}`)));
  out.push(sec('changed / conflicting', pick('DOMAIN', (o) => o.classification === 'CONTRADICTION'), (o) => line(o, o.target_key)));
  out.push(sec('disappeared / unreachable (investigate)', cls('DOMAIN', 'DISAPPEARED_FROM_SOURCE'), (o) => line(o, o.target_key)));
  out.push(sec('unverified or shared platform', pick('DOMAIN', (o) => ['POSSIBLE_CHANGE', 'SOURCE_UNTRUSTED'].includes(o.classification)), (o) => line(o, `${o.target_key} ${J(o.proposed_json).ownership_class || ''}`)));
  out.push('');
  out.push('## PROGRAMME CONTACTS');
  // the address itself is shown only in the unredacted operator report
  const addr = (o) => (redact ? '' : (J(o.proposed_json).email || J(o.expected_old_json).email || ''));
  out.push(sec('new programme inboxes', P('PROGRAMME_CONTACT', 'CREATE_PROGRAMME_CONTACT'), (o) => line(o, [J(o.proposed_json).contact_role, addr(o)].filter(Boolean).join(' '))));
  out.push(sec('absent from a complete official page (investigate, not deleted)', cls('PROGRAMME_CONTACT', 'DISAPPEARED_FROM_SOURCE'), (o) => line(o, o.target_key)));
  out.push(sec('refused (contradiction / identity / untrusted source)', pick('PROGRAMME_CONTACT', (o) => ['CONTRADICTION', 'IDENTITY_AMBIGUOUS', 'SOURCE_UNTRUSTED', 'POSSIBLE_CHANGE'].includes(o.classification)), (o) => line(o, o.classification)));
  out.push(`- confirmed unchanged: ${cls('PROGRAMME_CONTACT', 'CONFIRMED_UNCHANGED').length}`);
  out.push('');
  out.push('## INTEGRITY');
  out.push(sec('contradictions', observations.filter((o) => o.classification === 'CONTRADICTION'), (o) => line(o, o.dataset)));
  out.push(sec('review queue', observations.filter((o) => o.requires_review && !o.review_status), (o) => line(o, `${o.dataset} ${o.proposed_action || o.classification}`)));
  if (plan) out.push(sec('withheld from promotion', plan.refused.map((r) => ({ ...observations.find((o) => o.observation_id === r.id), __why: r.why })), (o) => line(o, o.__why)));
  if (gate) {
    out.push('');
    out.push(`## GATE: ${gate.pass ? 'PASS' : 'FAIL'}`);
    for (const [k, ok] of Object.entries(gate.gates)) out.push(`- ${ok ? '✅' : '❌'} ${k}`);
    if (!gate.pass) out.push('```\n' + clean(JSON.stringify(gate.details, null, 1)).slice(0, 4000) + '\n```');
  }
  return out.join('\n');
}
