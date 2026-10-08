import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { parseSidearmStaffPage, mailtos, emailsOnPage, isPersonName, STAFF_STRUCTURE, SIDEARM_STAFF_PARSER_VERSION } from './sidearmStaff.js';
import { parseSidearmStaff } from './sidearm.js';
import { staffAdapter } from './gatherers.js';
import { classifyEmailPublication, EMAIL_PUBLICATION } from '../../emailPublication.js';

/**
 * PHASE 8D.3E — sidearm-staff-2. Fixtures reproduce the MARKUP of official Sidearm staff pages
 * measured on 2026-10-07 (the Vue s-table, the id-keyed sidearm-table, the older card list, a coach
 * bio page) with every person, institution and address invented (reserved .test domains).
 */
const th = (label, cls) => `<th data-test-id="s-table-heading__root" class="s-table-header__column !uppercase ${cls}" scope="col" data-v-1><div class="relative title-container"><div class="flex items-center"><span class="s-table-header__column-label" data-v-1>${label}</span></div></div></th>`;
const td = (inner) => `<td class="s-text-regular s-table-body_cell" position="left" data-v-1>${inner}</td>`;
const mail = (e) => `<a class="text-theme-link-light underline" href='mailto:${e}'>${e}</a>`;
const sRow = (name, title, email, slug) => `<tr class="s-table-body__row" data-v-1>${td(`<a href="/sports/womens-soccer/roster/coaches/${slug}/1"> ${name} </a>`)}${td(` ${title} `)}${td(email ? mail(email) : '')}</tr>`;
const sTable = (rows) => `<table class="w-full" data-v-1><thead class="s-table-header" data-v-1><!----><tr class="s-table-header__row" data-v-1>${th('Name', 'fullname')}${th('Title', 'staff_title')}${th('Email', 'staff_email')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
const page = (body, title = "2026 Women&#x27;s Soccer Coaches - Example College Athletics") => `<!doctype html><html><head><title>${title}</title></head><body><h1 class="hide">Example College Athletics</h1><main>${body}</main><footer><a href="mailto:webmaster@example-college.test">webmaster@example-college.test</a></footer></body></html>`;
const STAFF = page(sTable([
  sRow('Pat Example', "Head Women's Soccer Coach", 'pexample@example-college.test', 'pat-example'),
  sRow('Abby Sample', 'Assistant Coach', 'as123-sw@example-college.test', 'abby-sample'),
  sRow('Chris Nomail', 'Volunteer Assistant Coach', null, 'chris-nomail'),
]));
const idTable = (rows) => `<table class="sidearm-table collapse-on-medium"><caption class="hide">Staff Directory</caption><thead class="sidearm-primary"><tr>
  <th class="text-left" id="col-coaches-fullname" scope="col"></th><th class="text-left" id="col-coaches-staff_title" scope="col"></th><th class="text-left" id="col-coaches-staff_email" scope="col"></th><th class="text-left" id="col-coaches-staff_phone" scope="col"></th></tr></thead><tbody>
  ${rows.map(([n, t, e]) => `<tr class="sidearm-coaches-coach"><th scope='row' class=""><a class='text-no-wrap' href='/sports/womens-soccer/roster/coaches/x/1'>${n}</a></th><td class=""> ${t} </td><td class="">${e ? `<a href='mailto:${e}'>${e}</a>` : ''}</td><td class=""><span class="text-no-wrap">555-0100</span></td></tr>`).join('')}</tbody></table>`;
const cards = (people) => `<section>${people.map(([n, t, e]) => `<div class="s-person-card"><div class="s-person-details"><h3 class="s-person-details__personal-single-line">${n}</h3><div class="s-person-details__position">${t}</div>${e ? `<a href="mailto:${e}">${e}</a>` : ''}</div></div>`).join('')}</section>`;
const profileHtml = (name, email) => `<!doctype html><html><head><title>${name} - Assistant Coach - Women&#x27;s Soccer Coaches - Example College Athletics</title></head><body><h1 class="hide">Example College Athletics</h1>
  <ul class="flex row flex-wrap"><li class="large-6 flex columns"><dl class="flex-item-1"><dt>Title</dt><dd>Assistant Coach</dd></dl></li><li class="large-6 flex columns"><dl class="flex-item-1"><dt>Email</dt><dd><a href="mailto:${email}">${email}</a></dd></dl></li></ul></body></html>`;

describe('sidearm-staff-2 — reading the page', () => {
  it('1. the current s-table: every person, title and address, complete; sidearm-staff-1 read nobody', () => {
    const r = parseSidearmStaffPage(STAFF);
    expect(parseSidearmStaff(STAFF)).toEqual([]);
    expect(r).toMatchObject({ parser_version: SIDEARM_STAFF_PARSER_VERSION, structure: STAFF_STRUCTURE.STAFF_TABLE, complete: true, incomplete_reason: null, rows: 3 });
    expect(r.people.map((p) => [p.full_name, p.role, p.emails])).toEqual([
      ['Pat Example', "Head Women's Soccer Coach", ['pexample@example-college.test']],
      ['Abby Sample', 'Assistant Coach', ['as123-sw@example-college.test']],
      ['Chris Nomail', 'Volunteer Assistant Coach', []],
    ]);
    expect(r.emails_on_page).toEqual(['as123-sw@example-college.test', 'pexample@example-college.test', 'webmaster@example-college.test']);
  });
  it('2. the id-keyed sidearm-table (empty header cells, columns only in their ids) is read too', () => {
    const r = parseSidearmStaffPage(page(idTable([['Dr. Lee Example', 'Head Coach', 'lee@example-college.test'], ['Sam Sample', 'Assistant Coach', null]])));
    expect(r).toMatchObject({ structure: STAFF_STRUCTURE.STAFF_TABLE_ID, complete: true });
    expect(r.people.map((p) => [p.full_name, p.emails])).toEqual([['Dr. Lee Example', ['lee@example-college.test']], ['Sam Sample', []]]);
  });
  it('3. the older card list still reads, through the existing sidearm-staff-1 reader', () => {
    const r = parseSidearmStaffPage(page(cards([['Kim Example', 'Head Coach', 'kim@example-college.test']])));
    expect(r).toMatchObject({ structure: STAFF_STRUCTURE.STAFF_CARDS, complete: true });
    expect(r.people[0]).toMatchObject({ full_name: 'Kim Example', emails: ['kim@example-college.test'] });
  });
  it('4. a coach\'s bio page is a PROFILE: one person from the <title>, never a complete staff list', () => {
    const r = parseSidearmStaffPage(profileHtml('Jo Example', 'jo@example-college.test'));
    expect(r).toMatchObject({ structure: STAFF_STRUCTURE.PROFILE, complete: false, incomplete_reason: 'PROFILE_IS_NOT_A_STAFF_LIST' });
    expect(r.people).toEqual([expect.objectContaining({ full_name: 'Jo Example', emails: ['jo@example-college.test'] })]);
  });
  it('5. incomplete pages: no structure, an unnamed row holding an address, one person with two different addresses, views that disagree', () => {
    expect(parseSidearmStaffPage(page('<p>Coaching staff coming soon</p>'))).toMatchObject({ structure: STAFF_STRUCTURE.NONE, complete: false, incomplete_reason: 'NO_STAFF_STRUCTURE' });
    expect(parseSidearmStaffPage(page(sTable([sRow('Pat Example', 'Head Coach', 'p@example-college.test', 'p'), sRow('', '', 'orphan@example-college.test', 'o')])))).toMatchObject({ complete: false, incomplete_reason: 'UNNAMED_ROW_WITH_ADDRESS' });
    const twice = page(sTable([sRow('Pat Example', 'Head Coach', 'p1@example-college.test', 'p')]) + sTable([sRow('Pat Example', 'Head Coach', 'p2@example-college.test', 'p')]));
    expect(parseSidearmStaffPage(twice)).toMatchObject({ complete: false, incomplete_reason: 'DUPLICATE_PERSON_CONFLICT' });
    const disagree = page(sTable([sRow('Pat Example', 'Head Coach', 'p@example-college.test', 'p')]) + cards([['Pat Example', 'Head Coach', null], ['Ray Missing', 'Assistant', null]]));
    expect(parseSidearmStaffPage(disagree)).toMatchObject({ complete: false, incomplete_reason: 'VIEWS_DISAGREE' });
  });
  it('6. the same person printed twice with the same address (a hidden mobile copy) is one person, still complete', () => {
    const dup = page(sTable([sRow('Pat Example', 'Head Coach', 'p@example-college.test', 'p')]) + sTable([sRow('Pat Example', 'Head Coach', 'p@example-college.test', 'p')]));
    const r = parseSidearmStaffPage(dup);
    expect(r.complete).toBe(true); expect(r.people).toHaveLength(1);
  });
  it('7. shared inbox versus individual address; a label row is a label, not a person', () => {
    const r = parseSidearmStaffPage(page(sTable([
      sRow('Pat Example', 'Head Coach', 'wsoccer@example-college.test', 'p'), sRow('Abby Sample', 'Assistant Coach', 'wsoccer@example-college.test', 'a'),
      sRow('Lee Own', 'Assistant Coach', 'lee@example-college.test', 'l'), sRow('Recruiting Inquiries', '', 'wsocrecruit@example-college.test', 'r')])));
    expect(r.complete).toBe(true);
    expect(r.people.find((p) => p.full_name === 'Pat Example').shared_emails).toEqual(['wsoccer@example-college.test']);
    expect(r.people.find((p) => p.full_name === 'Lee Own').shared_emails).toEqual([]);
    expect(r.labels).toEqual([{ label: 'Recruiting Inquiries', emails: ['wsocrecruit@example-college.test'] }]);
    expect(isPersonName('Recruiting Inquiries')).toBe(false); expect(isPersonName('Dr. Lee Example')).toBe(true);
  });
  it('8. only well-formed mailto addresses count against a person; printed text addresses are still on the page', () => {
    expect(mailtos("<a href='mailto:WomensSoccerRecruiting'>x</a><a href='mailto:A%40example-college.test?subject=hi'>x</a>")).toEqual(['a@example-college.test']);
    expect(emailsOnPage('<p>Write to info@example-college.test</p>')).toEqual(['info@example-college.test']);
  });
  it('9. deterministic: the same bytes give the same reading', () => {
    expect(JSON.stringify(parseSidearmStaffPage(STAFF))).toBe(JSON.stringify(parseSidearmStaffPage(STAFF)));
  });
});

describe('sidearm-staff-2 through the staff adapter and the email-publication definition', () => {
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const fetchOf = (body, url = 'https://examplecollegeathletics.test/sports/womens-soccer/coaches') => async () => ({ url, final_url: url, host: 'examplecollegeathletics.test', final_host: 'examplecollegeathletics.test', fetched_at: '2026-10-07T23:52:41.664Z', status: 200, sha256: sha(body), body, block: null });
  const target = { host: 'examplecollegeathletics.test', platform: 'SIDEARM', sport: 'womens-soccer', athletics_entity_id: 'AE-X', institution_label: 'Example College', season: 2026 };
  const coach = { id: 'k1', full_name: 'Abby Sample', email: 'as123@example-college.test', sport: 'womens-soccer' };
  const prog = { unitid: 199999 };
  it('10. the adapter stages the people, the structure, every address on the page and a shared inbox is never a person\'s own', async () => {
    const shared = page(sTable([sRow('Pat Example', 'Head Coach', 'wsoccer@example-college.test', 'p'), sRow('Abby Sample', 'Assistant Coach', 'wsoccer@example-college.test', 'a')]));
    const r = await staffAdapter(target, { fetch: fetchOf(shared) });
    expect(r.page).toMatchObject({ parser_version: 'sidearm-staff-2', structure: 'STAFF_TABLE', source_complete: true });
    expect(r.page.people.map((p) => [p.full_name, p.email, p.email_origin])).toEqual([['Pat Example', null, 'NONE'], ['Abby Sample', null, 'NONE']]);
    expect(r.page.emails_on_page).toContain('wsoccer@example-college.test');
  });
  it('11. a different published address for the coach is a positive absence of the stored one (the email-change case)', async () => {
    const r = await staffAdapter(target, { fetch: fetchOf(STAFF) });
    const c = classifyEmailPublication({ coach, programme: prog, read: r, hostUnitid: 199999 });
    expect(c.status).toBe(EMAIL_PUBLICATION.POSITIVELY_ABSENT);
    expect(c.observation).toMatchObject({ parser_version: 'sidearm-staff-2', evidence_sha256: sha(STAFF), staff_records: 3, other_email_for_coach: 'as123-sw@example-college.test' });
    const again = classifyEmailPublication({ coach, programme: prog, read: await staffAdapter(target, { fetch: fetchOf(STAFF) }), hostUnitid: 199999 });
    expect(again.observation.observation_id).toBe(c.observation.observation_id); // deterministic provenance
    expect(classifyEmailPublication({ coach: { ...coach, email: 'as123-sw@example-college.test' }, programme: prog, read: r, hostUnitid: 199999 }).status).toBe(EMAIL_PUBLICATION.COACH_PUBLISHED);
  });
  it('12. refusals: wrong sport, wrong institution, historical page, profile page — none is absence', async () => {
    const mens = page(sTable([sRow('Abby Sample', 'Assistant Coach', 'x@example-college.test', 'a')]), "2026 Men&#x27;s Soccer Coaches - Example College Athletics");
    const wrongSport = await staffAdapter(target, { fetch: fetchOf(mens, 'https://examplecollegeathletics.test/sports/mens-soccer/coaches') });
    expect(wrongSport.refusal?.code).toBe('WRONG_SPORT');
    const notOwned = await staffAdapter(target, { fetch: fetchOf(STAFF), ownsHost: () => false });
    expect(notOwned.refusal?.code).toBe('INSTITUTION_MISMATCH');
    expect(classifyEmailPublication({ coach, programme: prog, read: wrongSport, hostUnitid: 199999 }).status).toBe(EMAIL_PUBLICATION.UNKNOWN);
    const old = await staffAdapter(target, { fetch: fetchOf(page(STAFF.replace(/<main>[\s\S]*<\/main>/, '') + STAFF, "2024 Women&#x27;s Soccer Coaches - Example College Athletics")) });
    expect(classifyEmailPublication({ coach, programme: prog, read: old, hostUnitid: 199999 }).status).toBe(EMAIL_PUBLICATION.UNKNOWN);
    const bio = await staffAdapter(target, { fetch: fetchOf(profileHtml('Abby Sample', 'as123-sw@example-college.test'), 'https://examplecollegeathletics.test/sports/womens-soccer/roster/coaches/abby-sample/1') });
    expect(classifyEmailPublication({ coach, programme: prog, read: bio, hostUnitid: 199999 }).status).toBe(EMAIL_PUBLICATION.UNKNOWN);
    expect(classifyEmailPublication({ coach, programme: prog, read: bio, hostUnitid: 188888 }).status).toBe(EMAIL_PUBLICATION.UNKNOWN);
  });
  it('13. from real-shaped HTML: footer address, department inbox, another coach\'s address and a shared inbox are PAGE_PUBLISHED, never the coach\'s own and never absent', async () => {
    const html = page(sTable([
      sRow('Pat Example', 'Head Coach', 'pexample@example-college.test', 'p'),
      sRow('Abby Sample', 'Assistant Coach', 'wsoccer@example-college.test', 'a'), sRow('Lee Own', 'Assistant Coach', 'wsoccer@example-college.test', 'l'),
      sRow('Recruiting Inquiries', '', 'wsocrecruit@example-college.test', 'r'),
    ]) + '<div class="contact"><p>Athletics department: <a href="mailto:athletics@example-college.test">athletics@example-college.test</a></p></div>');
    const read = await staffAdapter(target, { fetch: fetchOf(html) });
    expect(read.page.source_complete).toBe(true);
    const as = (email) => classifyEmailPublication({ coach: { ...coach, email }, programme: prog, read, hostUnitid: 199999 });
    const cases = { 'webmaster@example-college.test': /footer or contact block/, 'athletics@example-college.test': /footer or contact block/, 'wsocrecruit@example-college.test': /label row/,
      'pexample@example-college.test': /another person \(Pat Example\)/, 'wsoccer@example-college.test': /shared inbox/ };
    for (const [email, why] of Object.entries(cases)) { const r = as(email); expect(r.status, email).toBe(EMAIL_PUBLICATION.PAGE_PUBLISHED); expect(r.reasons[0]).toMatch(why); expect(r.observation).toBeUndefined(); }
    // the adapter never stages the shared inbox as either coach's own address
    expect(read.page.people.filter((p) => p.email === 'wsoccer@example-college.test')).toEqual([]);
    // an address on no part of the page, for a named coach on a complete list, is the one positive absence
    expect(as('as999@example-college.test').status).toBe(EMAIL_PUBLICATION.POSITIVELY_ABSENT);
  });
});
