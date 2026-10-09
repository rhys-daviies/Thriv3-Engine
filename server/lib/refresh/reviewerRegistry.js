/**
 * The committed reviewer registry, shared/correctionReviewers.json (DI-03F). One reader, no override
 * parameter: approvalValidator.js always authenticates against this file. (Tests that need a SHARED_DEV
 * or PRODUCTION reviewer replace this module with vi.mock for that test file only.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REVIEWERS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../shared/correctionReviewers.json');
/** Parsed JSON, or null when unreadable. */
export function readReviewerRegistry() {
  try { return JSON.parse(fs.readFileSync(REVIEWERS_PATH, 'utf8')); } catch { return null; }
}
