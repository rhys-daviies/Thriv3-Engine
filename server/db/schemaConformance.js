/**
 * DOES A DATABASE'S SCHEMA EQUAL WHAT THIS CODE BUILDS? — DI-09A.
 *
 * DI-08's rehearsal answers a narrower question: "would this code's migration change anything?". The
 * migration is `CREATE … IF NOT EXISTS` plus guarded steps, so it is blind to anything it has no guard
 * for: an extra table or column left by another branch's code, a column that is NOT NULL here and
 * nullable in the code, a foreign key whose ON DELETE differs, a trigger with a different body. All of
 * those rehearse as "nothing pending". The shared dev database (3c3d1d6d) has five of them, from
 * unmerged email-agent branches — and `--adopt` would have recorded it as CURRENT.
 *
 * So adoption also compares STRUCTURE against a reference: the schema this code produces on an empty
 * database (schema.sql + migrate() in memory). Not the DDL text — an `ALTER TABLE … ADD COLUMN` appends
 * to the stored CREATE, so an old database and a fresh one never match verbatim — but what SQLite
 * reports about each object:
 *
 *   tables    columns as a SET of (name, declared type, NOT NULL, default, pk, hidden) — column order
 *             is history, not meaning; foreign keys (table, from, to, ON UPDATE, ON DELETE); and the
 *             CHECK clauses, whitespace- and case-normalised, as a multiset
 *   indexes, triggers, views
 *             their CREATE text, whitespace- and case-normalised
 *
 * Internal sqlite_* objects and the audit table are excluded, as they are from the fingerprint.
 */
import crypto from 'node:crypto';

const norm = (s) => (s || '').replace(/\s+/g, ' ').replace(/\s*([(),;])\s*/g, '$1').trim().toLowerCase();

function checkClauses(sql) {
  const out = [];
  const re = /\bcheck\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    let depth = 0; let j = m.index + m[0].length - 1;
    for (; j < sql.length; j += 1) {
      if (sql[j] === '(') depth += 1;
      else if (sql[j] === ')' && --depth === 0) break;
    }
    out.push(norm(sql.slice(m.index + m[0].length - 1, j + 1)));
  }
  return out.sort();
}

/** A structural description of every schema object, keyed `type name`. */
export function describeSchema(db, excludeTable) {
  const out = new Map();
  const rows = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND tbl_name <> ?").all(excludeTable);
  for (const o of rows) {
    let d;
    if (o.type === 'table') {
      const q = `"${o.name.replace(/"/g, '""')}"`;
      d = {
        columns: db.prepare(`PRAGMA table_xinfo(${q})`).all()
          .map((c) => [c.name, String(c.type || '').toUpperCase(), c.notnull, c.dflt_value, c.pk, c.hidden].join('|')).sort(),
        foreignKeys: db.prepare(`PRAGMA foreign_key_list(${q})`).all()
          .map((f) => [f.table, f.from, f.to, f.on_update, f.on_delete].join('|')).sort(),
        checks: checkClauses(o.sql || ''),
      };
    } else {
      d = { on: o.tbl_name, sql: norm(o.sql) };
    }
    out.set(`${o.type} ${o.name}`, d);
  }
  return out;
}

/**
 * The differences between `db` and `reference`, as sorted human-readable lines, plus a digest an
 * operator can approve. Empty means structurally identical.
 */
export function structuralDifferences(reference, db, excludeTable) {
  const want = describeSchema(reference, excludeTable);
  const have = describeSchema(db, excludeTable);
  const lines = [];
  for (const [k, d] of have) if (!want.has(k)) lines.push(`EXTRA ${k}`);
  for (const k of want.keys()) if (!have.has(k)) lines.push(`MISSING ${k}`);
  for (const [k, w] of want) {
    const h = have.get(k);
    if (!h) continue;
    if (w.columns) {
      const hs = new Set(h.columns); const ws = new Set(w.columns);
      for (const c of h.columns) if (!ws.has(c)) lines.push(`DIFFERENT ${k}: column in database ${c}`);
      for (const c of w.columns) if (!hs.has(c)) lines.push(`DIFFERENT ${k}: column in code ${c}`);
      const hf = new Set(h.foreignKeys); const wf = new Set(w.foreignKeys);
      for (const f of h.foreignKeys) if (!wf.has(f)) lines.push(`DIFFERENT ${k}: foreign key in database ${f}`);
      for (const f of w.foreignKeys) if (!hf.has(f)) lines.push(`DIFFERENT ${k}: foreign key in code ${f}`);
      if (JSON.stringify(h.checks) !== JSON.stringify(w.checks)) lines.push(`DIFFERENT ${k}: CHECK constraints differ`);
    } else if (w.sql !== h.sql || w.on !== h.on) {
      lines.push(`DIFFERENT ${k}: definition differs`);
    }
  }
  lines.sort();
  const digest = crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
  return { differences: lines, digest };
}
