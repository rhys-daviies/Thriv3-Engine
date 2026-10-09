/**
 * Loads the plain rows the refresh pipeline reasons over. Read-only and defensive: a
 * database that predates Phase 7D/7E simply yields empty entity/period/link lists.
 */
import { releasedHeldDomains } from './holdRelease.js';
import { hostOf } from '../athleticsEntity.js';
import { createIdentityResolver } from './identityResolver.js';

export function tableExists(db, t) {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
}
export function columnsOf(db, t) {
  return tableExists(db, t) ? new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name)) : new Set();
}
const sel = (db, t, sql) => (tableExists(db, t) ? db.prepare(sql).all() : []);

export function loadRefreshContext(db) {
  const cc = columnsOf(db, 'colleges'); const dc = columnsOf(db, 'athletics_domains'); const ac = columnsOf(db, 'institution_aliases');
  const colleges = sel(db, 'colleges', `SELECT id, name, sport, division, conference, unitid, state, ${cc.has('active') ? 'active' : '1 AS active'}, ${cc.has('athletics_entity_id') ? 'athletics_entity_id' : 'NULL AS athletics_entity_id'} FROM colleges`);
  const domains = sel(db, 'athletics_domains', `SELECT domain, unitid, status, role, checked_at, final_url, ${dc.has('athletics_entity_id') ? 'athletics_entity_id' : 'NULL AS athletics_entity_id'}, ${dc.has('ownership_class') ? 'ownership_class' : 'NULL AS ownership_class'} FROM athletics_domains`);
  const aliases = sel(db, 'institution_aliases', `SELECT alias_key, alias_raw, unitid, conference_scope, alias_type, ${ac.has('athletics_entity_id') ? 'athletics_entity_id' : 'NULL AS athletics_entity_id'} FROM institution_aliases`);
  const entities = sel(db, 'athletics_entities', 'SELECT * FROM athletics_entities');
  const rowLinks = sel(db, 'programme_row_links', 'SELECT * FROM programme_row_links');
  const periods = sel(db, 'programme_membership_periods', 'SELECT * FROM programme_membership_periods');
  const freezes = sel(db, 'season_freezes', 'SELECT * FROM season_freezes');
  const locations = sel(db, 'athletics_source_locations', 'SELECT * FROM athletics_source_locations');
  const conferenceHosts = new Set();
  for (const r of sel(db, 'conference_seasons', 'SELECT DISTINCT source_url FROM conference_seasons')) { const h = hostOf(r.source_url); if (h) conferenceHosts.add(h); }
  const releasedHolds = releasedHeldDomains(db);
  const resolver = createIdentityResolver({ entities, colleges, domains, aliases, rowLinks, locations, releasedHolds });
  return { colleges, domains, aliases, entities, rowLinks, periods, freezes, locations, conferenceHosts, resolver, managed: entities.length > 0 };
}

/** Frozen seasons applicable to a scope (a '*' freeze covers every scope). */
export function frozenSeasons(ctx, scope) {
  return new Set(ctx.freezes.filter((f) => f.scope === '*' || f.scope === scope).map((f) => Number(f.season)));
}
