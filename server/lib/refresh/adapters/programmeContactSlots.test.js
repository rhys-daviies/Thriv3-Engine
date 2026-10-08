import { describe, it, expect } from 'vitest';
import { extractAddressSlots, isPersonName, SLOT } from './programmeContactSlots.js';

/**
 * PHASE 1G-B (B1) — where an address is printed decides what it can be. Markup below follows the
 * shapes of real 2026 staff pages (Sidearm table view, Sidearm list/cards, Presto table and
 * cards); people and institutions are invented.
 */
const mail = (e) => (e ? `<a href="mailto:${e}">${e}</a>` : '');
const sidearmTable = (rows, { caption = 'Coaching Staff' } = {}) => `<table><caption>${caption}</caption>
  <thead><tr><th scope="col">Name</th><th scope="col">Title</th><th scope="col">Email Address</th><th scope="col">Phone</th></tr></thead>
  <tbody>${rows.map(([n, t, e]) => `<tr class="sidearm-coaches-coach"><th scope="row"><a href="/staff/x">${n}</a></th><td>${t}</td><td>${mail(e)}</td><td></td></tr>`).join('')}</tbody></table>`;
const page = (body, footer = '') => `<html><head><title>Men's Soccer Coaches - Example College</title></head><body><main>${body}</main><footer>${footer}</footer></body></html>`;
const slotOf = (r, e) => r.addresses.find((a) => a.email === e);

describe('slots', () => {
  it('an address against TWO OR MORE distinct named people is SHARED (Vermont shape)', () => {
    const r = extractAddressSlots(page(sidearmTable([['Avery Dale', 'Head Coach', 'mens.soccer@example.edu'], ['Blake Ford', 'Associate Head Coach', 'mens.soccer@example.edu'],
      ['Casey Hunt', 'Assistant Coach', 'casey.hunt@example.edu'], ['Drew Lane', 'Assistant Coach', 'mens.soccer@example.edu']])));
    expect(slotOf(r, 'mens.soccer@example.edu')).toMatchObject({ slot: SLOT.SHARED, person_count: 3 });
    expect(slotOf(r, 'casey.hunt@example.edu')).toMatchObject({ slot: SLOT.PERSON, person_count: 1 });
  });
  it('an inbox-looking address against exactly ONE named person is PERSON — coach intelligence (Hope shape)', () => {
    const r = extractAddressSlots(page(sidearmTable([['Dana Blake', 'Head Coach', 'menssoccer@example.edu'], ['Eli Fox', 'Assistant Coach', null]])));
    expect(slotOf(r, 'menssoccer@example.edu')).toMatchObject({ slot: SLOT.PERSON, person_count: 1 });
  });
  it('a staff row whose name is a label is a RECRUITING_SLOT / TEAM_SLOT (Wesleyan shape)', () => {
    const r = extractAddressSlots(page(sidearmTable([['Eva Moss', 'Head Coach', null], ['All Recruit Emails', 'Please Direct Inquiries to:', 'wsoccer@example.edu'], ['Team Email', 'Women\'s Soccer', 'wsoc.team@example.edu']])));
    expect(slotOf(r, 'wsoccer@example.edu')).toMatchObject({ slot: SLOT.RECRUITING_SLOT, person_count: 0, recruiting: true });
    expect(slotOf(r, 'wsoc.team@example.edu')).toMatchObject({ slot: SLOT.TEAM_SLOT, recruiting: false });
  });
  it('duplicated markup is not sharing: one coach printed twice is still one person', () => {
    const t = sidearmTable([['Gale Hart', 'Head Coach', 'msoccer@example.edu'], ['Ivy Ross', 'Assistant Coach', null]]);
    const r = extractAddressSlots(page(t + t));
    expect(slotOf(r, 'msoccer@example.edu')).toMatchObject({ slot: SLOT.PERSON, person_count: 1, rows: 2 });
  });
  it('a malformed mailto is recorded and never completed with the page domain (West Chester shape)', () => {
    const r = extractAddressSlots(page(sidearmTable([['Jo Kemp', 'Head Coach', 'WomensSoccerRecruiting'], ['Kit Lowe', 'Assistant Coach', 'WomensSoccerRecruiting@example.edu']])));
    expect(r.malformed).toEqual([{ text: 'womenssoccerrecruiting', near: 'Jo Kemp' }]);
    expect(slotOf(r, 'womenssoccerrecruiting@example.edu')).toMatchObject({ slot: SLOT.PERSON, person_count: 1, recruiting: true });
  });
  it('a programme contact block outside the staff rows is a CONTACT_BLOCK; a footer address is not a slot at all', () => {
    const body = sidearmTable([['Lee Moore', 'Head Coach', null]]) + `<div class="contact"><p>Prospective student-athletes: please complete the recruiting questionnaire or email ${mail('soccerrecruits@example.edu')}</p></div>`;
    const r = extractAddressSlots(page(body, `<p>If you have a disability and are having trouble accessing this website, contact ${mail('web-accessibility@example.edu')}</p>`));
    expect(slotOf(r, 'soccerrecruits@example.edu')).toMatchObject({ slot: SLOT.CONTACT_BLOCK, recruiting: true });
    expect(slotOf(r, 'web-accessibility@example.edu')).toBeUndefined();
  });
  it('a person\'s job title never makes a shared inbox a recruiting inbox (BC shape)', () => {
    const r = extractAddressSlots(page(sidearmTable([['Mia North', 'Head Coach', 'wsoccer@example.edu'], ['Nia Oak', 'Assistant Coach & Recruiting Coordinator', 'wsoccer@example.edu']])));
    expect(slotOf(r, 'wsoccer@example.edu')).toMatchObject({ slot: SLOT.SHARED, recruiting: false });
  });
  it('reads Sidearm list and card markup when there is no staff table', () => {
    const list = ['Owen Park', 'Pat Quinn'].map((n) => `<li class="sidearm-roster-coach"><div class="sidearm-roster-coach-name"><p>${n}</p></div><div class="sidearm-roster-coach-title"><span>Coach</span></div><div>${mail('soccer@example.edu')}</div></li>`).join('');
    expect(slotOf(extractAddressSlots(page(`<ul>${list}</ul>`)), 'soccer@example.edu')).toMatchObject({ slot: SLOT.SHARED, person_count: 2 });
    const cards = ['Rae Shaw', 'Sam Tate'].map((n) => `<div class="s-person-card"><h3 class="s-person-details__personal-single-line">${n}</h3><div class="s-person-details__position">Assistant Coach</div>${mail('wsoc@example.edu')}</div>`).join('');
    expect(slotOf(extractAddressSlots(page(`<section>${cards}</section>`)), 'wsoc@example.edu')).toMatchObject({ slot: SLOT.SHARED, person_count: 2 });
  });
  it('reads a Presto staff table (Name / Title columns) the same way', () => {
    const t = `<table><thead><tr><th>Name</th><th>Title</th><th>Email</th></tr></thead><tbody>
      <tr><td><a href="/sports/msoc/coaches/x">Uma Vale</a></td><td>Head Coach</td><td>${mail('msoc@example.edu')}</td></tr>
      <tr><td><a href="/sports/msoc/coaches/y">Vic Wells</a></td><td>Assistant Coach</td><td>${mail('msoc@example.edu')}</td></tr></tbody></table>`;
    expect(slotOf(extractAddressSlots(page(t)), 'msoc@example.edu')).toMatchObject({ slot: SLOT.SHARED, person_count: 2 });
  });
  it('addresses are lower-cased and url-decoded; output is deterministic', () => {
    const html = page(sidearmTable([['Wyn Xu', 'Head Coach', 'Soccer%40Example.EDU'], ['Yan Zee', 'Assistant Coach', 'soccer@example.edu']]));
    const a = extractAddressSlots(html); const b = extractAddressSlots(html);
    expect(a).toEqual(b);
    expect(slotOf(a, 'soccer@example.edu')).toMatchObject({ slot: SLOT.SHARED, person_count: 2 });
  });
  it('isPersonName: labels, empty cells and addresses are not people', () => {
    expect(isPersonName('Matthias "T" Steen')).toBe(true);
    for (const n of ['All Recruit Emails', 'Team Email', 'General Inquiries', '', 'x@y.edu', 'Coach']) expect(isPersonName(n), n).toBe(false);
  });
});
