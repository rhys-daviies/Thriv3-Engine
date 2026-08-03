import { College } from '../db/entities/college.js';

// Well-known football-first schools that don't sponsor men's soccer
// (e.g. most of the SEC). Section 12: "delete College records for schools
// that don't have active men's soccer programs."
const INACTIVE_PATTERNS = [
  'university of alabama', 'auburn university', 'university of georgia',
  'louisiana state university', 'university of oklahoma', 'university of arkansas',
  'mississippi state university', 'university of mississippi', 'texas a&m university',
  'university of texas at austin', 'university of tennessee', 'university of south carolina',
  'university of missouri', 'university of florida', 'texas christian university',
  'oklahoma state university', 'kansas state university', 'iowa state university',
  'university of kansas', 'baylor university', 'texas tech university',
  'west virginia university', 'university of nebraska', 'university of arizona',
];

/**
 * Deletes College records (men's soccer only) whose name matches a known
 * inactive-program pattern.
 */
export async function cleanInactiveSchools({ sport = 'mens-soccer' } = {}) {
  const all = College.filter({ sport });
  const toDelete = all.filter((c) => {
    const lower = c.name.toLowerCase();
    return INACTIVE_PATTERNS.some((p) => lower.includes(p));
  });

  for (const c of toDelete) College.delete(c.id);

  return { deleted: toDelete.length, names: toDelete.map((c) => c.name) };
}
