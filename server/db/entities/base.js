import db from '../client.js';
import { randomUUID } from 'node:crypto';

function nowIso() {
  return new Date().toISOString();
}

function serializeRow(row, jsonFields) {
  const out = { ...row };
  for (const f of jsonFields) {
    if (typeof out[f] === 'string') {
      try {
        out[f] = JSON.parse(out[f]);
      } catch {
        out[f] = [];
      }
    }
  }
  return out;
}

function deserializeValue(value, isJsonField) {
  if (isJsonField) return JSON.stringify(value ?? []);
  if (value === undefined) return null;
  return value;
}

/**
 * Creates a lightweight data-access object for a SQLite table that mirrors
 * the Base44 SDK entity method names (list/filter/create/update/bulkCreate/delete)
 * so frontend call sites read the same as base44.entities.X.*
 */
export function createEntity(tableName, columns, jsonFields = []) {
  const allColumns = ['id', 'created_date', 'updated_date', 'created_by_id', ...columns];

  function buildWhere(query) {
    const keys = Object.keys(query || {});
    if (keys.length === 0) return { clause: '', params: [] };
    const clause = 'WHERE ' + keys.map((k) => `${k} = ?`).join(' AND ');
    const params = keys.map((k) => query[k]);
    return { clause, params };
  }

  function applySort(sql, sort) {
    if (!sort) return sql;
    const desc = sort.startsWith('-');
    const col = desc ? sort.slice(1) : sort;
    return `${sql} ORDER BY ${col} ${desc ? 'DESC' : 'ASC'}`;
  }

  return {
    tableName,

    list(sort, limit) {
      let sql = `SELECT * FROM ${tableName}`;
      sql = applySort(sql, sort);
      if (limit) sql += ` LIMIT ${Number(limit)}`;
      const rows = db.prepare(sql).all();
      return rows.map((r) => serializeRow(r, jsonFields));
    },

    filter(query = {}, sort, limit) {
      const { clause, params } = buildWhere(query);
      let sql = `SELECT * FROM ${tableName} ${clause}`;
      sql = applySort(sql, sort);
      if (limit) sql += ` LIMIT ${Number(limit)}`;
      const rows = db.prepare(sql).all(...params);
      return rows.map((r) => serializeRow(r, jsonFields));
    },

    get(id) {
      const row = db.prepare(`SELECT * FROM ${tableName} WHERE id = ?`).get(id);
      return row ? serializeRow(row, jsonFields) : null;
    },

    create(data) {
      const id = data.id || randomUUID();
      const ts = nowIso();
      const full = { id, created_date: ts, updated_date: ts, created_by_id: data.created_by_id ?? null, ...data };
      const cols = allColumns.filter((c) => c in full);
      const placeholders = cols.map(() => '?').join(', ');
      const values = cols.map((c) => deserializeValue(full[c], jsonFields.includes(c)));
      db.prepare(`INSERT INTO ${tableName} (${cols.join(', ')}) VALUES (${placeholders})`).run(...values);
      return this.get(id);
    },

    update(id, data) {
      const ts = nowIso();
      const full = { ...data, updated_date: ts };
      const cols = Object.keys(full).filter((c) => allColumns.includes(c) && c !== 'id');
      if (cols.length === 0) return this.get(id);
      const setClause = cols.map((c) => `${c} = ?`).join(', ');
      const values = cols.map((c) => deserializeValue(full[c], jsonFields.includes(c)));
      db.prepare(`UPDATE ${tableName} SET ${setClause} WHERE id = ?`).run(...values, id);
      return this.get(id);
    },

    upsert(matchQuery, data) {
      const existing = this.filter(matchQuery, undefined, 1)[0];
      if (existing) {
        return { record: this.update(existing.id, data), created: false };
      }
      return { record: this.create({ ...matchQuery, ...data }), created: true };
    },

    bulkCreate(items) {
      const created = [];
      const txn = db.transaction((rows) => {
        for (const row of rows) created.push(this.create(row));
      });
      txn(items);
      return created;
    },

    delete(id) {
      db.prepare(`DELETE FROM ${tableName} WHERE id = ?`).run(id);
      return { success: true };
    },

    deleteWhere(query) {
      const { clause, params } = buildWhere(query);
      const info = db.prepare(`DELETE FROM ${tableName} ${clause}`).run(...params);
      return { deleted: info.changes };
    },

    count(query = {}) {
      const { clause, params } = buildWhere(query);
      const row = db.prepare(`SELECT COUNT(*) as c FROM ${tableName} ${clause}`).get(...params);
      return row.c;
    },
  };
}
