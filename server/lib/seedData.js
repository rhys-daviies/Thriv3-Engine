import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../seed/data');

function loadJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, filename), 'utf-8'));
}

export function loadCollegeRankings() {
  return loadJson('colleges_rankings.json'); // [{name, division, conference, soccer_score, national_ranking}]
}

export function loadAcademicScores() {
  return loadJson('academic_scores.json'); // [{division, name, academic_score}]
}

export function loadD1Schools() {
  return loadJson('d1_schools.json'); // [{name, conference, rpi_rank}]
}

export function graduatingCsvPath(filename) {
  return path.join(dataDir, filename);
}

export const GRADUATING_CSV_FILES = [
  'graduating_d1_2025.csv',
  'graduating_d2_2025.csv',
  'graduating_d3_2025.csv',
  'graduating_naia_2025.csv',
];
