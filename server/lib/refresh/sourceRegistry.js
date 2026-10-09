/**
 * The committed official-source registry, shared/officialSourceRegistry.json (DI-03D/F). One reader, no
 * override parameter: officialEvidence.js always reads this file. (A test file that must exercise a
 * SHARED_DEV / PRODUCTION correction end to end replaces this module with vi.mock for that file only.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REGISTRY_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../shared/officialSourceRegistry.json');
/** Parsed JSON, or null when unreadable. */
export function readSourceRegistry() {
  try { return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')); } catch { return null; }
}
