/**
 * EMAIL PUBLICATION — Phase 8D.3D. Is a coach's RECORDED address published on that coach's own
 * official current-season staff page? Three answers, and only one of them withholds anything:
 *
 *   COACH_PUBLISHED    the address is printed against THIS coach — exactly one person on the page
 *                      carries the coach's name, and the address is that person's own (not an inbox
 *                      printed against two or more people). Proof of the coach's current address.
 *   PAGE_PUBLISHED     the address is on the page but its association with the coach is unproven:
 *                      a footer or contact block, a department/programme label row, another person's
 *                      row, an inbox shared by several people, or a name that matches two people.
 *                      It BLOCKS a positive-absence finding and proves nothing about the coach.
 *   POSITIVELY_ABSENT  every condition below holds, and the address is printed nowhere on the page
 *   UNKNOWN            anything less — the treatment of the coach does not change
 *
 * POSITIVELY_ABSENT requires ALL of:
 *   1. the page was fetched (no block, no refusal) and parsed COMPLETELY, as a recognised staff
 *      LIST, by a versioned repository parser (sidearm-staff-2) that read at least one person — a
 *      zero-record, partial or profile (bio page) reading is UNKNOWN, never absence; PUBLISHED needs
 *      only a verified current page, which may be a bio page;
 *   2. provenance: fetched_at, source_url (https), parser_version and the body's sha256;
 *   3. the host identifies itself as the coach's FILED institution (athletics_domains UNITID) and the
 *      page is for the coach's sport;
 *   4. the page is for the season of the cycle it was fetched in (a historical page is UNKNOWN);
 *   5. exactly one person on the page is this coach (by normalised name);
 *   6. the page publishes at least one address for someone (a page that lists no emails at all
 *      says nothing about this one);
 *   7. this address appears nowhere on the page;
 *   8. no conflicting official evidence: the address was not observed published on an official page
 *      (coaches.email_seen_on_source_at) in this cycle or a later one.
 *
 * Pure: callers fetch rows and pages. The reconciler (qualifyingAbsence) and the composite writer
 * (COACH_EMAIL_ABSENCE fixtures) apply the same rules to a RECORDED observation.
 */
import crypto from 'node:crypto';
import { cycleOf } from './refresh/freshness.js';
import { STAFF_LISTS } from './refresh/adapters/sidearmStaff.js';

export const EMAIL_PUBLICATION = Object.freeze({ COACH_PUBLISHED: 'COACH_PUBLISHED', PAGE_PUBLISHED: 'PAGE_PUBLISHED', POSITIVELY_ABSENT: 'POSITIVELY_ABSENT', UNKNOWN: 'UNKNOWN' });
export const ABSENCE_REASON = 'recorded email positively not published on the official staff page (EMAIL_POSITIVELY_ABSENT)';

const lc = (s) => String(s ?? '').trim().toLowerCase();
const nameKey = (s) => lc(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const hostOfUrl = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; } };
const unknown = (...reasons) => ({ status: EMAIL_PUBLICATION.UNKNOWN, reasons });

/** A later-or-same-cycle official publication of the address contradicts an absence. */
export function publicationConflicts(coach, observedAt) {
  if (!coach?.email_seen_on_source_at || !coach?.email_seen_on_source_url) return false;
  const seen = cycleOf(coach.email_seen_on_source_at); const obs = cycleOf(observedAt);
  return seen != null && obs != null && seen >= obs;
}

export const absenceObservationId = (o) => crypto.createHash('sha256').update([o.coach_id, lc(o.email), o.source_url, o.evidence_sha256].join('|')).digest('hex');

/**
 * Classify one coach against one staff-page read.
 *   coach:     coaches row (id, full_name, email, sport, email_seen_on_source_at/url)
 *   programme: the coach's FILED colleges row (unitid, sport)
 *   read:      a refresh staff adapter result — { page } or { refusal } — or null when not fetched
 *   hostUnitid: the UNITID the page's host identifies itself as (athletics_domains), or null
 * Returns { status, reasons, observation? } — `observation` (the recordable fields) only for POSITIVELY_ABSENT.
 */
export function classifyEmailPublication({ coach, programme, read, hostUnitid }) {
  if (!coach?.email || !lc(coach.email).includes('@')) return unknown('no recorded address');
  if (!read) return unknown('page not fetched');
  if (read.refusal) return unknown(`page refused: ${read.refusal.code || 'unspecified'} (inaccessible or unparsed is not absence)`);
  const page = read.page;
  if (!page) return unknown('no page');
  const people = Array.isArray(page.people) ? page.people : [];
  const sha = page.adapter_evidence?.sha256;
  if (!page.parser_version || !page.fetched_at || !/^https:\/\//.test(page.source_url || '') || !/^[0-9a-f]{64}$/.test(sha || '')) return unknown('missing provenance (parser_version, fetched_at, https source_url, sha256)');
  if (page.sport !== coach.sport) return unknown(`wrong sport: page is ${page.sport}, coach is ${coach.sport}`);
  if (!programme || programme.unitid == null || hostUnitid == null || Number(hostUnitid) !== Number(programme.unitid)) return unknown(`wrong institution: host identifies as ${hostUnitid ?? 'nothing'}, coach is filed at ${programme?.unitid ?? 'nothing'}`);
  const cycle = cycleOf(page.fetched_at);
  if (page.observed_season == null || Number(page.observed_season) !== cycle) return unknown(`historical or unlabelled page: season ${page.observed_season ?? 'unknown'}, fetched in cycle ${cycle}`);
  // the page's own label must not contradict the season (a 2024 staff page served today is history)
  const titleYears = [...String(page.adapter_evidence?.title || '').matchAll(/\b(20\d\d)\b/g)].map((m) => Number(m[1]));
  if (titleYears.length && !titleYears.includes(cycle)) return unknown(`historical page: titled ${titleYears.join('/')}, fetched in cycle ${cycle}`);
  const mine = people.filter((p) => nameKey(p.full_name) && nameKey(p.full_name) === nameKey(coach.full_name));
  const email = lc(coach.email);
  // every address the page prints (sidearm-staff-2 lists all of them), else the people's own
  const published = [...new Set([...(page.emails_on_page || []).map(lc), ...people.map((p) => lc(p.email))])].filter((e) => e.includes('@'));
  // COACH_PUBLISHED: printed against this coach alone, on any verified current page (a bio page included)
  const personEmails = (page.person_emails || people.map((p) => ({ full_name: p.full_name, emails: [p.email].filter(Boolean), shared_emails: [] })));
  const minePe = personEmails.filter((x) => nameKey(x.full_name) && nameKey(x.full_name) === nameKey(coach.full_name));
  const labelEmails = (page.labels || []).flatMap((l) => l.emails || []).map(lc);
  const onPage = [...new Set([...published, ...personEmails.flatMap((x) => x.emails || []).map(lc), ...labelEmails])];
  if (minePe.length === 1 && (minePe[0].emails || []).map(lc).includes(email)) {
    if ((minePe[0].shared_emails || []).map(lc).includes(email)) return { status: EMAIL_PUBLICATION.PAGE_PUBLISHED, reasons: ['shared inbox: printed against this coach and at least one other person — not a personal address'] };
    return { status: EMAIL_PUBLICATION.COACH_PUBLISHED, reasons: ['address printed against this coach on the official page'] };
  }
  // PAGE_PUBLISHED: on the page, association unproven — blocks absence, proves nothing about the coach
  if (onPage.includes(email)) {
    const why = minePe.length > 1 && minePe.some((x) => (x.emails || []).map(lc).includes(email)) ? 'the coach\'s name matches more than one person on the page'
      : labelEmails.includes(email) ? 'printed in a label row (department / programme / recruiting inbox), not against a person'
      : personEmails.some((x) => (x.emails || []).map(lc).includes(email)) ? `printed against another person (${personEmails.filter((x) => (x.emails || []).map(lc).includes(email)).map((x) => x.full_name).join(', ')})`
      : 'printed elsewhere on the page (footer or contact block), not against a person';
    return { status: EMAIL_PUBLICATION.PAGE_PUBLISHED, reasons: [why] };
  }
  // ABSENCE is a statement about a whole staff LIST: complete, recognised as a list, at least one person read
  if (!page.source_complete || people.length === 0) return unknown(`incomplete parse: the parser did not read a complete staff list${page.incomplete_reason ? ` (${page.incomplete_reason})` : ''}`);
  if (!STAFF_LISTS.includes(page.structure)) return unknown(`page structure ${page.structure ?? 'unrecorded'} is not a recognised staff list`);
  if (mine.length === 0) return unknown('coach not identified on the page (a currentness question, not an email one)');
  if (mine.length > 1) return unknown('coach name matches more than one person on the page');
  if (published.length === 0) return unknown('the page publishes no addresses at all');
  if (publicationConflicts(coach, page.fetched_at)) return unknown('conflicting official evidence: address observed published in this cycle or later');
  const pe = (page.person_emails || []).find((x) => nameKey(x.full_name) === nameKey(coach.full_name));
  const allMine = (pe?.emails || [mine[0].email].filter(Boolean)).map(lc);
  const sharedMine = (pe?.shared_emails || []).map(lc);
  // the coach's own different address first; a shared inbox is only a lead, never the coach's address
  const other = allMine.find((e) => e.includes('@') && e !== email && !sharedMine.includes(e)) || allMine.find((e) => e.includes('@') && e !== email) || null;
  const observation = {
    coach_id: coach.id, email, observed_at: page.fetched_at, page_season: cycle, source_url: page.source_url, source_host: hostOfUrl(page.source_url),
    page_unitid: Number(programme.unitid), page_sport: page.sport, parser_version: page.parser_version, evidence_sha256: sha, parse_status: 'COMPLETE',
    staff_records: people.length, emails_published: published.length, coach_name_found: 1, coach_email_found: 0, other_email_for_coach: other,
  };
  return { status: EMAIL_PUBLICATION.POSITIVELY_ABSENT, reasons: other ? ['address not published; a different address is published for this coach'] : ['address not published for this coach'], observation: { ...observation, observation_id: absenceObservationId(observation) } };
}

/**
 * The reconciler's question: does a RECORDED observation still withhold this coach? Only if it is for
 * the coach's current address, institution (filed programme UNITID) and sport, its page season is its
 * own cycle, and no official publication of the address in the same or a later cycle supersedes it.
 */
export function qualifyingAbsence(rows, coach, programme) {
  if (!rows?.length || !coach?.email) return null;
  return rows.find((o) => o.coach_id === coach.id && lc(o.email) === lc(coach.email)
    && programme && programme.unitid != null && Number(o.page_unitid) === Number(programme.unitid)
    && o.page_sport === coach.sport && Number(o.page_season) === cycleOf(o.observed_at)
    && o.parse_status === 'COMPLETE' && o.coach_name_found === 1 && o.coach_email_found === 0
    && /^[0-9a-f]{64}$/.test(o.evidence_sha256 || '') && !!o.parser_version && /^https:\/\//.test(o.source_url || '')
    && !publicationConflicts(coach, o.observed_at)) || null;
}
