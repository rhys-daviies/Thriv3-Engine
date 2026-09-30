/**
 * SIDEARM + platform detection — Phase 8A. Pure functions over page HTML.
 *
 * Sidearm Sports sites serve rosters at /sports/<mens-soccer|womens-soccer>/roster[/<year>]
 * and staff at /sports/<sport>/coaches. Markup has changed over the years (the classic
 * `sidearm-roster-player` list, the newer `s-person-card` cards, and table views), so every
 * reader here tries all of them and reports a COUNT the caller checks against expectations.
 */
const decode = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&#39;|&#039;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const strip = (s) => decode(String(s || '').replace(/<[^>]+>/g, ' '));

export function detectPlatform(html) {
  const h = String(html || '').slice(0, 200000);
  if (/sidearmsports|sidearm-|sidearmstats|s-person-card/i.test(h)) return 'SIDEARM';
  if (/prestosports|presto-sport-static|presto-sport/i.test(h)) return 'PRESTO';
  return 'CUSTOM';
}

/** Sidearm roster players (name, position, class, hometown) across markup generations. */
export function parseSidearmRoster(html) {
  const out = [];
  const h = String(html || '');
  for (const m of h.matchAll(/<li[^>]+class="[^"]*sidearm-roster-player[^"]*"[\s\S]*?<\/li>/gi)) {
    const b = m[0];
    const name = strip((b.match(/sidearm-roster-player-name[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i) || b.match(/data-player-name="([^"]*)"/i) || [])[1]);
    if (!name) continue;
    out.push({ player_name: name, position: strip((b.match(/sidearm-roster-player-position[^>]*>([\s\S]*?)<\/(?:span|div)>/i) || [])[1]) || null,
      class_year_label: strip((b.match(/sidearm-roster-player-academic-year[^>]*>([\s\S]*?)<\/(?:span|div)>/i) || [])[1]) || null,
      hometown: strip((b.match(/sidearm-roster-player-hometown[^>]*>([\s\S]*?)<\/(?:span|div)>/i) || [])[1]) || null, nationality: null });
  }
  if (!out.length) {
    for (const m of h.matchAll(/<div[^>]+class="[^"]*s-person-card[^"]*"[\s\S]*?(?=<div[^>]+class="[^"]*s-person-card[^"]*"|<\/section>)/gi)) {
      const b = m[0];
      const name = strip((b.match(/s-person-details__personal-single-line[^>]*>([\s\S]*?)<\/(?:h3|span|a)>/i) || b.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) || [])[1]);
      if (!name || /coach/i.test(b.slice(0, 400))) continue;
      const bio = [...b.matchAll(/s-person-details__bio-stats-item[^>]*>([\s\S]*?)<\/span>/gi)].map((x) => strip(x[1]));
      out.push({ player_name: name, position: bio.find((x) => /^(position|pos)/i.test(x))?.replace(/^\S+\s*/, '') || bio[0] || null, class_year_label: bio.find((x) => /^(academic year|class|year)/i.test(x))?.replace(/^(academic year|class|year)\s*/i, '') || null, hometown: null, nationality: null });
    }
  }
  return out;
}
export const countSidearmRoster = (html) => parseSidearmRoster(html).length;

/** Sidearm coaching staff: name, title, and ONLY an address printed as a mailto link. */
export function parseSidearmStaff(html) {
  const out = [];
  const h = String(html || '');
  const blocks = [...h.matchAll(/<(?:li|div|tr)[^>]+class="[^"]*(?:sidearm-roster-coach|sidearm-coach|s-person-card|sidearm-staff-member)[^"]*"[\s\S]*?<\/(?:li|tr)>|<div[^>]+class="[^"]*s-person-card[^"]*"[\s\S]*?(?=<div[^>]+class="[^"]*s-person-card|<\/section>)/gi)].map((m) => m[0]);
  for (const b of blocks) {
    const name = strip((b.match(/(?:sidearm-roster-coach-name|s-person-details__personal-single-line)[^>]*>([\s\S]*?)<\/(?:h3|span|a|div)>/i) || b.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) || [])[1]);
    if (!name) continue;
    const title = strip((b.match(/(?:sidearm-roster-coach-title|s-person-details__position)[^>]*>([\s\S]*?)<\/(?:span|div|p)>/i) || [])[1]) || null;
    const mail = (b.match(/mailto:([^"'?\s>]+)/i) || [])[1] || null;
    out.push({ full_name: name, role: title, email: mail ? decodeURIComponent(mail).toLowerCase() : null, email_origin: mail ? 'PUBLISHED_ON_SOURCE' : 'NONE' });
  }
  return out;
}
export const countSidearmStaff = (html) => parseSidearmStaff(html).length;
