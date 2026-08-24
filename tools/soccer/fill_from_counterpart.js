#!/usr/bin/env node
/**
 * Fill a blank identity row from the same school's other-sport row.
 *
 * 45 institutions have identity on one sport's row and none on the other, purely because the
 * two files spell the school differently ("Adrian" / "Adrian College") and the population
 * script keys on the name.
 *
 * The copy is only made when the SOURCE ROW'S ARTICLE ITSELF confirms the target's name --
 * the article title's core tokens must equal the blank row's. That is what keeps this from
 * repeating the mistake the exact-match rule was introduced to prevent: "Pacific" and
 * "Pacific University" reduce to the same core token and are DIFFERENT schools (Tigers vs
 * Boxers), so a rule that paired on our own two names alone would eventually copy one onto
 * the other. Requiring the article to name the target keeps the institution in the loop.
 *
 * Usage: node fill_from_counterpart.js [--apply]
 */
import { College } from '../app/server/db/entities/college.js';
import { isPluralNickname } from '../app/server/lib/nicknameGrammar.js';

const APPLY = process.argv.includes('--apply');
// "institute" and "seminary" are NOT generic here. Treating "institute" as noise made
// "Lamar Institute" reduce to the same core as "Lamar" and take Lamar University's
// Cardinals -- two different schools in the same town.
const GENERIC = new Set(['university', 'college', 'the', 'of', 'at', 'and', 'school', 'univ']);
const STATE = { al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california',
  co: 'colorado', ct: 'connecticut', de: 'delaware', fl: 'florida', ga: 'georgia', hi: 'hawaii',
  id: 'idaho', il: 'illinois', in: 'indiana', ia: 'iowa', ks: 'kansas', ky: 'kentucky',
  la: 'louisiana', me: 'maine', md: 'maryland', ma: 'massachusetts', mi: 'michigan',
  mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana', ne: 'nebraska',
  nv: 'nevada', nh: 'hampshire', nj: 'jersey', nm: 'mexico', ny: 'york', nc: 'carolina',
  nd: 'dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania', ri: 'island',
  sc: 'carolina', sd: 'dakota', tn: 'tennessee', tx: 'texas', ut: 'utah', vt: 'vermont',
  va: 'virginia', wa: 'washington', wv: 'virginia', wi: 'wisconsin', wy: 'wyoming' };

function core(name) {
  let n = String(name).replace(/\(([A-Za-z]{2})\)/g, (m, c) => STATE[c.toLowerCase()] || c);
  n = n.replace(/\bst\b\.?/gi, 'saint');
  return new Set(n.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter((t) => t && !GENERIC.has(t)));
}
const eq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

const all = College.list();
const men = all.filter((c) => c.sport === 'mens-soccer');
const women = all.filter((c) => c.sport === 'womens-soccer');
const FIELDS = ['nickname', 'mascot', 'primary_color', 'secondary_color', 'logo_url'];

let filled = 0, refused = 0;
for (const [targets, sources] of [[men, women], [women, men]]) {
  for (const t of targets) {
    if (t.nickname) continue;
    const tc = core(t.name);
    if (!tc.size) continue;
    // Division must agree. Without it, the men's D2 "Salem" (Salem University, Tigers)
    // took the nickname of the women's D3 "Salem College" -- a women's-only college in a
    // different state, which the core-token test could not tell apart.
    const cands = sources.filter((s) => s.nickname && eq(core(s.name), tc)
      && s.division === t.division);
    if (cands.length !== 1) continue;
    const s = cands[0];
    const src = s.identity_source || '';
    // An `athletics-domain:` source was already confirmed against that site's own <title>
    // when it was recovered, so it needs no article-title test here -- only the same-core,
    // same-division agreement every fill requires. Refusing it was a false negative that
    // held back Centre, Berry, Alvernia, Wittenberg and others.
    if (src.startsWith('athletics-domain:')) {
      filled++;
      console.log(`FILL   ${t.name.padEnd(26)} <- ${s.name.padEnd(28)} ${JSON.stringify(s.nickname)} (domain-sourced)`);
      if (APPLY) {
        const patch = { identity_source: src,
          identity_notes: `copied from this school's other row (${s.name}), same division; `
            + `that row's nickname was recovered from the school's own athletics site` };
        for (const f of FIELDS) patch[f] = s[f] ?? null;
        patch.nickname_plural = isPluralNickname(s.nickname) ? 1 : 0;
        College.update(t.id, patch);
      }
      continue;
    }
    const title = src.replace(/^wikipedia:/, '');
    // the source's own ARTICLE must name our school, not merely share a core token
    if (!title || !eq(core(title), tc)) {
      refused++;
      console.log(`REFUSE ${t.name.padEnd(26)} <- ${s.name.padEnd(28)} ` +
        `article "${title}" does not name this school`);
      continue;
    }
    // A gendered form cannot be copied across sports. Hope College's women are the Flying
    // Dutch and its men the Flying DutchMEN; copying either onto the other is wrong even
    // though it is the same institution.
    if (/(?:^|[a-z])(men|women)$|^lady\b|dutch$/i.test(s.nickname.trim())) {
      refused++;
      console.log(`REFUSE ${t.name.padEnd(26)} <- ${s.name.padEnd(28)} ` +
        `${JSON.stringify(s.nickname)} is a gendered form; not copyable across sports`);
      continue;
    }
    filled++;
    console.log(`FILL   ${t.name.padEnd(26)} <- ${s.name.padEnd(28)} ${JSON.stringify(s.nickname)}`);
    if (!APPLY) continue;
    const patch = { identity_source: s.identity_source,
      identity_notes: `copied from this school's other-sport row (${s.name}); the article `
        + `"${title}" names this institution` };
    for (const f of FIELDS) patch[f] = s[f] ?? null;
    patch.nickname_plural = isPluralNickname(s.nickname) ? 1 : 0;
    College.update(t.id, patch);
  }
}
console.log(`\n${filled} fillable, ${refused} refused${APPLY ? ' (applied)' : ' (dry run)'}`);
