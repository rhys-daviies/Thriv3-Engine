/**
 * STATIC IMPORT CLOSURE — Phase DI-07 (DI-06 MINOR-2).
 *
 * WHY. The trust root (trustRoot.js) used to compare a hand-kept list of 29 files with `main`. The code a
 * correction actually runs is larger: the two correction CLIs reach ~60 local modules, and any one of them
 * runs in-process and could, for example, replace crypto.verify. DI-06 forged a hardware approval that way
 * from a module nobody protected. The trust root now protects the TRANSITIVE STATIC IMPORT CLOSURE of the
 * correction entry points, computed at check time, so a new module or a new import is covered without
 * anyone remembering to list it.
 *
 * HOW. `scanImports` lexes ES-module source well enough to find import specifiers: comments are dropped,
 * string literals are recorded, template literals and regular-expression literals are skipped (a quote inside
 * a regex can therefore never start a phantom string). It reports:
 *   - static `import ... from '<s>'`, side-effect `import '<s>'`, `export ... from '<s>'`;
 *   - dynamic `import('<literal>')`;
 *   - PROBLEMS for anything the closure could not follow: a dynamic import of a non-literal, `require(` or
 *     `createRequire(` (CommonJS loading), a `#subpath` import, or an absolute / URL specifier.
 * A problem makes the trust root fail closed: code the check cannot see is code it cannot vouch for.
 * Unparseable source (an unterminated string, comment or regex) is a problem too.
 */
import path from 'node:path';
import { builtinModules } from 'node:module';

const REGEX_AFTER = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const isWord = (c) => /[\w$]/.test(c);
const STR = (n) => `"\u0000${n}\u0000"`;

/**
 * Lex `src` into code with every string literal replaced by a numbered token, template and regex literals
 * blanked and comments removed. -> { code, strings }. Throws on unterminated constructs.
 */
export function lexModule(src) {
  const n = src.length; const strings = [];
  let i = 0; let code = ''; let lastSig = ''; let lastWord = '';
  const noteChar = (c) => {
    if (/\s/.test(c)) return;
    if (isWord(c)) { lastWord = lastSig === 'w' ? lastWord + c : c; lastSig = 'w'; } else { lastSig = c; lastWord = ''; }
  };
  const quoted = (q) => {
    let j = i + 1; let s = '';
    while (j < n && src[j] !== q) {
      if (src[j] === '\\') { s += src[j + 1] ?? ''; j += 2; } else if (src[j] === '\n') throw new Error(`unterminated string at ${i}`); else s += src[j++];
    }
    if (j >= n) throw new Error(`unterminated string at ${i}`);
    i = j + 1; return s;
  };
  // code until a closing brace at depth 0 (stopAtBrace) or the end
  const scan = (stopAtBrace) => {
    let depth = 0;
    while (i < n) {
      const c = src[i]; const d = src[i + 1];
      if (c === '/' && d === '/') { const j = src.indexOf('\n', i); i = j < 0 ? n : j; continue; }
      if (c === '/' && d === '*') { const j = src.indexOf('*/', i + 2); if (j < 0) throw new Error(`unterminated comment at ${i}`); code += ' '; i = j + 2; continue; }
      if (c === '"' || c === "'") { strings.push(quoted(c)); code += STR(strings.length - 1); lastSig = '"'; lastWord = ''; continue; }
      if (c === '`') { template(); code += '``'; lastSig = '`'; lastWord = ''; continue; }
      if (c === '/' && (lastSig === '' || REGEX_AFTER.has(lastSig) || (lastSig === 'w' && REGEX_AFTER_WORD.has(lastWord)))) {
        let j = i + 1; let cls = false;
        while (j < n) {
          const x = src[j];
          if (x === '\\') { j += 2; continue; }
          if (x === '\n') throw new Error(`unterminated regular expression at ${i}`);
          if (x === '[') cls = true; else if (x === ']') cls = false; else if (x === '/' && !cls) break;
          j += 1;
        }
        if (j >= n) throw new Error(`unterminated regular expression at ${i}`);
        j += 1; while (j < n && /[a-z]/i.test(src[j])) j += 1;
        code += '/r/'; lastSig = 'r'; lastWord = ''; i = j; continue;
      }
      if (stopAtBrace) {
        if (c === '{') depth += 1;
        else if (c === '}') { if (depth === 0) { i += 1; return; } depth -= 1; }
      }
      code += c; noteChar(c); i += 1;
    }
    if (stopAtBrace) throw new Error('unterminated template expression');
  };
  const template = () => {
    i += 1;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { i += 1; return; }
      if (c === '$' && src[i + 1] === '{') { i += 2; code += ' ('; const ls = lastSig; lastSig = '('; scan(true); code += ') '; lastSig = ls; continue; }
      i += 1;
    }
    throw new Error('unterminated template literal');
  };
  scan(false);
  return { code, strings };
}

const TOK = '"\\u0000(\\d+)\\u0000"';
const STATIC = new RegExp(`(?:^|[^\\w$.])import\\s*(?:[\\w$*{}\\s,]+?\\s*from\\s*)?${TOK}`, 'g');
const REEXPORT = new RegExp(`(?:^|[^\\w$.])export\\s*(?:\\*\\s*(?:as\\s+[\\w$]+\\s*)?|\\{[^}]*\\}\\s*)from\\s*${TOK}`, 'g');
const DYNAMIC = /(?:^|[^\w$.])import\s*\(/g;
const DYNAMIC_LITERAL = new RegExp(`^\\s*${TOK}\\s*[,)]`);
const CJS = /(?:^|[^\w$.])(require|createRequire)\s*\(/g;

/** Import specifiers of one module. -> { specifiers: string[], problems: string[] } (never throws). */
export function scanImports(src) {
  let lx;
  try { lx = lexModule(String(src)); } catch (e) { return { specifiers: [], problems: [`source cannot be lexed (${e.message})`] }; }
  const { code, strings } = lx; const specifiers = []; const problems = [];
  for (const re of [STATIC, REEXPORT]) for (const m of code.matchAll(re)) specifiers.push(strings[Number(m[1])]);
  for (const m of code.matchAll(DYNAMIC)) {
    const rest = code.slice(m.index + m[0].length);
    const lit = rest.match(DYNAMIC_LITERAL);
    if (lit) specifiers.push(strings[Number(lit[1])]); else problems.push('dynamic import() of a non-literal specifier — the closure cannot follow it');
  }
  for (const m of code.matchAll(CJS)) problems.push(`${m[1]}() — CommonJS loading the closure cannot follow`);
  return { specifiers: [...new Set(specifiers)], problems };
}

const BUILTIN = new Set(builtinModules);
/** Package name of a bare specifier ('@scope/pkg/sub' -> '@scope/pkg'), or null for a builtin. */
export function packageOf(spec) {
  if (spec.startsWith('node:') || BUILTIN.has(spec) || BUILTIN.has(spec.split('/')[0])) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/**
 * The transitive static import closure of `entryPoints` (repo-relative paths), reading files through
 * `read(relPath) -> string|null`. -> { files: string[], packages: string[], problems: string[] }
 * A specifier resolving outside the repository, or to a file `read` cannot supply, is a problem.
 */
export function importClosure(entryPoints, read) {
  const files = new Set(); const packages = new Set(); const problems = [];
  const queue = [...entryPoints];
  while (queue.length) {
    const f = queue.shift();
    if (files.has(f)) continue;
    files.add(f);
    const src = read(f);
    if (src == null) { problems.push(`${f} is in the correction code's import closure but cannot be read`); continue; }
    const { specifiers, problems: ps } = scanImports(src);
    problems.push(...ps.map((x) => `${f}: ${x}`));
    for (const s of specifiers) {
      if (s.startsWith('./') || s.startsWith('../')) {
        const r = path.posix.normalize(path.posix.join(path.posix.dirname(f), s));
        if (r.startsWith('../') || path.posix.isAbsolute(r)) { problems.push(`${f} imports ${s}, outside the repository`); continue; }
        queue.push(r);
      } else if (s.startsWith('#') || s.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(s) && !s.startsWith('node:')) {
        problems.push(`${f} imports ${s} — subpath, absolute or URL specifiers are not followed`);
      } else { const p = packageOf(s); if (p) packages.add(p); }
    }
  }
  return { files: [...files].sort(), packages: [...packages].sort(), problems };
}
