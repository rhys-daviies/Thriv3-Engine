import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import db from '../db/client.js';
import {
  MAILBOX_PROVIDER, MAILBOX_STATUS,
  createConnectedMailbox, mailbox, mailboxesForOperator, mailboxesForAthlete,
  updateMailbox, storeMailboxCredential, mailboxCredential, revokeMailbox, hasStoredCredential,
} from './connectedMailboxes.js';

/**
 * D2 — the mailbox foundation, and the one property everything rests on:
 * a refresh token can be stored and used without ever leaving the database
 * through any read a caller can reach.
 */

const OP = 'op-1';
const OTHER_OP = 'op-2';
const ATHLETE = 'a-mbx';
const TOKEN = '1//0gTOKEN-not-a-real-refresh-token';
let seq = 0;

function insertOperator(id, email) {
  db.prepare(`
    INSERT INTO operator_users (id, email, password_hash, active, created_at)
    VALUES (?, ?, 'scrypt$1$8$1$x$y', 1, '2026-09-09T00:00:00.000Z')
  `).run(id, email);
}
function insertAthlete(id) {
  db.prepare(`
    INSERT INTO players (id, created_date, updated_date, full_name, position, sport, public_slug)
    VALUES (?, 'x', 'x', 'Mailbox Athlete', 'MIDFIELD', 'mens-soccer', ?)
  `).run(id, randomUUID().slice(0, 10));
}

const connect = (over = {}) => createConnectedMailbox({
  operatorUserId: OP, athleteId: ATHLETE, provider: MAILBOX_PROVIDER.GOOGLE,
  providerAccountId: `sub-${++seq}`, emailAddress: `Athlete${seq}@Example.COM `,
  displayName: 'An Athlete', scopes: ['https://www.googleapis.com/auth/gmail.send'],
  ...over,
});

beforeEach(() => {
  // Mailboxes first: the operator FK refuses a delete while one references it,
  // which is the invariant under test rather than an inconvenience.
  db.exec(`DELETE FROM connected_mailbox_credentials; DELETE FROM connected_mailboxes;
           DELETE FROM operator_sessions; DELETE FROM operator_users; DELETE FROM players;`);
  insertOperator(OP, 'op1@thriv3.test');
  insertOperator(OTHER_OP, 'op2@thriv3.test');
  insertAthlete(ATHLETE);
  seq = 0;
});

// ---------------------------------------------------------------------------

describe('the identity comes from the provider', () => {
  it('records a verified mailbox, address normalised', () => {
    const m = connect();
    expect(m).toMatchObject({
      operator_user_id: OP, athlete_id: ATHLETE, provider: 'GOOGLE',
      email_address: 'athlete1@example.com',       // trimmed and lowercased
      display_name: 'An Athlete',
    });
    expect(m.scopes).toEqual(['https://www.googleapis.com/auth/gmail.send']);
  });

  it('is NEEDS_RECONSENT until a credential exists, never CONNECTED on creation', () => {
    // A mailbox with an identity and no token cannot send. A status is a
    // statement about what is true, not about what was intended.
    expect(connect().status).toBe(MAILBOX_STATUS.NEEDS_RECONSENT);
  });

  it('refuses a second row for one provider account', () => {
    connect({ providerAccountId: 'sub-fixed' });
    expect(() => connect({ providerAccountId: 'sub-fixed' }))
      .toThrow(/already connected/);
    // One real inbox, one row: two would budget the same inbox twice under B5
    // and split its reputation history.
    expect(db.prepare('SELECT COUNT(*) n FROM connected_mailboxes').get().n).toBe(1);
  });

  it('refuses an identity it was not given', () => {
    expect(() => connect({ providerAccountId: null })).toThrow(/account id the provider issued/);
    expect(() => connect({ emailAddress: '  ' })).toThrow(/verified address/);
    expect(() => connect({ provider: 'YAHOO' })).toThrow(/Unknown mailbox provider/);
    expect(() => connect({ operatorUserId: null })).toThrow(/operated by somebody/);
  });

  it('lets the same address exist twice, because identity is the account', () => {
    // An alias, a reassigned address inside an organisation, or a reconnection
    // after revocation. Two live mailboxes sharing an address share one budget
    // under B5, which is the correct accounting either way.
    connect({ providerAccountId: 'sub-a', emailAddress: 'shared@example.com' });
    const second = connect({ providerAccountId: 'sub-b', emailAddress: 'shared@example.com' });
    expect(second.email_address).toBe('shared@example.com');
    expect(mailboxesForOperator(OP)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------

describe('ownership is a parameter, not an assumption', () => {
  it('hides another operator\'s mailbox behind the same answer as a missing one', () => {
    const m = connect();
    expect(mailbox(m.id, { operatorUserId: OTHER_OP })).toBeNull();
    expect(mailbox('no-such-id', { operatorUserId: OP })).toBeNull();
    // A caller who guessed an id learns nothing about whether it is real.
  });

  it('scopes every list by the operator asking', () => {
    connect();
    connect({ providerAccountId: 'sub-other', operatorUserId: OTHER_OP });
    expect(mailboxesForOperator(OP)).toHaveLength(1);
    expect(mailboxesForOperator(OTHER_OP)).toHaveLength(1);
    expect(mailboxesForAthlete(ATHLETE, { operatorUserId: OTHER_OP })).toHaveLength(1);
  });

  it('refuses every write from an operator who does not own the mailbox', () => {
    const m = connect();
    const theirs = { operatorUserId: OTHER_OP };
    expect(() => updateMailbox(m.id, { display_name: 'x' }, theirs)).toThrow(/No mailbox/);
    expect(() => storeMailboxCredential(m.id, { refreshToken: TOKEN, ...theirs })).toThrow(/No mailbox/);
    expect(() => mailboxCredential(m.id, theirs)).toThrow(/No mailbox/);
    expect(() => revokeMailbox(m.id, theirs)).toThrow(/No mailbox/);
  });

  it('never trusts that there is only one operator', () => {
    const src = fs.readFileSync(new URL('./connectedMailboxes.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // Every statement that reads the table scopes on the operator.
    for (const stmt of code.match(/FROM connected_mailboxes[\s\S]*?`/g) ?? []) {
      expect(stmt, stmt.slice(0, 80)).toMatch(/operator_user_id/);
    }
  });
});

// ---------------------------------------------------------------------------

describe('the credential never leaves through a read', () => {
  it('appears in no public projection', () => {
    const m = connect();
    storeMailboxCredential(m.id, { refreshToken: TOKEN, operatorUserId: OP });

    const secretish = ['ciphertext', 'iv', 'auth_tag', 'authTag', 'key_version',
      'refresh_token', 'refreshToken', 'token', 'credential'];
    const shapes = [
      mailbox(m.id, { operatorUserId: OP }),
      ...mailboxesForOperator(OP),
      ...mailboxesForAthlete(ATHLETE, { operatorUserId: OP }),
      updateMailbox(m.id, { display_name: 'Renamed' }, { operatorUserId: OP }),
      storeMailboxCredential(m.id, { refreshToken: TOKEN, operatorUserId: OP }),
      revokeMailbox(m.id, { operatorUserId: OP }),
    ];
    for (const shape of shapes) {
      for (const field of secretish) expect(shape).not.toHaveProperty(field);
      // Serialised, as a route would send it.
      const json = JSON.stringify(shape);
      expect(json).not.toContain(TOKEN);
      expect(json).not.toMatch(/ciphertext|auth_tag|refresh/i);
    }
  });

  it('is the only statement that selects secret material', () => {
    const src = fs.readFileSync(new URL('./connectedMailboxes.js', import.meta.url), 'utf8');
    /**
     * Three statements touch the credential table and only one of them reads
     * the secret: `revokeMailbox` DELETEs, `hasStoredCredential` SELECTs the
     * literal 1, and `mailboxCredential` selects the columns. Counting
     * mentions of the table would have counted all three; what matters is how
     * many places can hold a ciphertext.
     */
    const selectsSecret = (src.match(/SELECT[^']*ciphertext[^']*FROM connected_mailbox_credentials/g) ?? []);
    expect(selectsSecret).toHaveLength(1);
    expect(src).toMatch(/SELECT 1 FROM connected_mailbox_credentials/);
  });

  it('stores no plaintext token anywhere in the database', () => {
    const m = connect();
    storeMailboxCredential(m.id, { refreshToken: TOKEN, operatorUserId: OP });

    for (const table of ['connected_mailboxes', 'connected_mailbox_credentials']) {
      const dump = JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all());
      expect(dump, table).not.toContain(TOKEN);
      expect(dump, table).not.toContain('refresh_token');
    }
    // And the ciphertext really is there, so this is not passing vacuously.
    expect(hasStoredCredential(m.id)).toBe(true);
  });

  it('gives the token back to the trusted internal caller', () => {
    const m = connect();
    storeMailboxCredential(m.id, { refreshToken: TOKEN, operatorUserId: OP });
    expect(mailboxCredential(m.id, { operatorUserId: OP }))
      .toMatchObject({ refreshToken: TOKEN, keyVersion: 1 });
  });
});

// ---------------------------------------------------------------------------

describe('storing and rotating', () => {
  it('makes the mailbox CONNECTED, and only then', () => {
    const m = connect();
    expect(m.status).toBe(MAILBOX_STATUS.NEEDS_RECONSENT);
    expect(storeMailboxCredential(m.id, { refreshToken: TOKEN, operatorUserId: OP }).status)
      .toBe(MAILBOX_STATUS.CONNECTED);
  });

  it('keeps one credential per mailbox and replaces the ciphertext', () => {
    const m = connect();
    storeMailboxCredential(m.id, { refreshToken: TOKEN, operatorUserId: OP });
    const first = db.prepare('SELECT * FROM connected_mailbox_credentials WHERE mailbox_id = ?').get(m.id);

    storeMailboxCredential(m.id, { refreshToken: 'a-rotated-token', operatorUserId: OP });
    const second = db.prepare('SELECT * FROM connected_mailbox_credentials WHERE mailbox_id = ?').get(m.id);

    expect(db.prepare('SELECT COUNT(*) n FROM connected_mailbox_credentials').get().n).toBe(1);
    expect(second.ciphertext).not.toBe(first.ciphertext);
    expect(second.iv).not.toBe(first.iv);
    // A rotation cannot leave the previous ciphertext behind for somebody to find.
    expect(mailboxCredential(m.id, { operatorUserId: OP }).refreshToken).toBe('a-rotated-token');
  });

  it('refuses to edit the provider\'s answer', () => {
    const m = connect();
    for (const field of ['provider', 'provider_account_id', 'email_address', 'id']) {
      expect(() => updateMailbox(m.id, { [field]: 'x' }, { operatorUserId: OP }))
        .toThrow(/not ours to edit|Cannot change/);
    }
    expect(() => updateMailbox(m.id, { status: 'GREAT' }, { operatorUserId: OP }))
      .toThrow(/Unknown mailbox status/);
  });
});

// ---------------------------------------------------------------------------

describe('revocation', () => {
  it('destroys the credential and keeps the record', () => {
    const m = connect();
    storeMailboxCredential(m.id, { refreshToken: TOKEN, operatorUserId: OP });

    const revoked = revokeMailbox(m.id, { operatorUserId: OP });

    // The secret is gone: a revoked token that still exists is a revoked token
    // somebody can still use.
    expect(hasStoredCredential(m.id)).toBe(false);
    expect(mailboxCredential(m.id, { operatorUserId: OP })).toBeNull();
    // The identity stays, because messages were sent through it.
    expect(revoked.status).toBe(MAILBOX_STATUS.REVOKED);
    expect(revoked.revoked_at).toBeTruthy();
    expect(revoked.email_address).toBe('athlete1@example.com');
    expect(mailbox(m.id, { operatorUserId: OP })).toBeTruthy();
  });

  it('can be reconnected, which clears the revocation', () => {
    const m = connect();
    revokeMailbox(m.id, { operatorUserId: OP });
    const back = storeMailboxCredential(m.id, { refreshToken: TOKEN, operatorUserId: OP });
    expect(back).toMatchObject({ status: MAILBOX_STATUS.CONNECTED, revoked_at: null });
  });
});

// ---------------------------------------------------------------------------

describe('what the schema refuses', () => {
  it('will not delete an athlete out from under a live credential', () => {
    const m = connect();
    storeMailboxCredential(m.id, { refreshToken: TOKEN, operatorUserId: OP });
    // Athletes are archived in this product, never deleted. If one ever is,
    // the mailbox must be revoked first — which destroys the credential.
    expect(() => db.prepare('DELETE FROM players WHERE id = ?').run(ATHLETE))
      .toThrow(/FOREIGN KEY constraint failed/);
  });

  it('will not let an operator be deleted out from under a mailbox', () => {
    const m = connect();
    storeMailboxCredential(m.id, { refreshToken: TOKEN, operatorUserId: OP });

    /**
     * THE OPERATOR'S LIFECYCLE MUST NOT REACH THROUGH TO THE MAILBOX'S.
     *
     * A mailbox row is durable historical identity — D4 will put a
     * `connected_mailbox_id` on `outreach_send` to say which mailbox sent a
     * message. Under a cascade, deleting an operator would erase the identity
     * that attribution depends on, silently.
     *
     * Access is withdrawn by deactivation (`active = 0`), which is what the
     * product actually does; nothing hard-deletes an operator. Revoke the
     * mailboxes first if one truly must go, which is the deliberate order.
     */
    expect(() => db.prepare('DELETE FROM operator_users WHERE id = ?').run(OP))
      .toThrow(/FOREIGN KEY constraint failed/);
    expect(db.prepare('SELECT COUNT(*) n FROM connected_mailboxes').get().n).toBe(1);
    expect(hasStoredCredential(m.id)).toBe(true);
  });

  it('declares no cascade on the operator, and keeps one on the session', () => {
    const operatorFk = db.prepare('PRAGMA foreign_key_list(connected_mailboxes)').all()
      .find((fk) => fk.table === 'operator_users');
    expect(operatorFk.on_delete).not.toBe('CASCADE');
    expect(operatorFk.on_delete).toBe('NO ACTION');
    // A session is ephemeral, carries no history, and must not outlive its
    // user. Unchanged by D2.1.
    const sessionFk = db.prepare('PRAGMA foreign_key_list(operator_sessions)').all()
      .find((fk) => fk.table === 'operator_users');
    expect(sessionFk.on_delete).toBe('CASCADE');
  });

  it('lets the operator go once the mailboxes are revoked', () => {
    const m = connect();
    storeMailboxCredential(m.id, { refreshToken: TOKEN, operatorUserId: OP });
    revokeMailbox(m.id, { operatorUserId: OP });

    // Revocation destroys the credential and keeps the identity, so the row
    // still refuses the delete — the identity is the thing being protected.
    expect(hasStoredCredential(m.id)).toBe(false);
    expect(() => db.prepare('DELETE FROM operator_users WHERE id = ?').run(OP))
      .toThrow(/FOREIGN KEY constraint failed/);

    // Removing the mailbox record itself is the deliberate act that frees it.
    db.prepare('DELETE FROM connected_mailboxes WHERE id = ?').run(m.id);
    expect(() => db.prepare('DELETE FROM operator_users WHERE id = ?').run(OP)).not.toThrow();
  });

  it('deactivates an operator without touching a mailbox', () => {
    const m = connect();
    storeMailboxCredential(m.id, { refreshToken: TOKEN, operatorUserId: OP });
    // How access is actually withdrawn in this product.
    db.prepare('UPDATE operator_users SET active = 0 WHERE id = ?').run(OP);

    expect(mailbox(m.id, { operatorUserId: OP })).toMatchObject({ status: 'CONNECTED' });
    expect(hasStoredCredential(m.id)).toBe(true);
  });

  it('rejects a provider or status outside the vocabulary', () => {
    const insert = (col, value) => db.prepare(`
      INSERT INTO connected_mailboxes (id, operator_user_id, provider, provider_account_id,
        email_address, status, connected_at, created_at, updated_at)
      VALUES ('x', '${OP}', ?, 's', 'e@x.com', ?, 'x', 'x', 'x')
    `).run(col === 'provider' ? value : 'GOOGLE', col === 'status' ? value : 'CONNECTED');
    expect(() => insert('provider', 'YAHOO')).toThrow(/CHECK constraint failed/);
    expect(() => insert('status', 'HEALTHY')).toThrow(/CHECK constraint failed/);
  });

  it('allows a mailbox with no athlete, for an operator-owned sending address', () => {
    const m = connect({ athleteId: null });
    expect(m.athlete_id).toBeNull();
    expect(mailboxesForOperator(OP)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe('what D2 deliberately does not do', () => {
  it('reaches no provider and knows no token shape', () => {
    const src = fs.readFileSync(new URL('./connectedMailboxes.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // No OAuth, no Google, no Microsoft, no transport, and no guess about what
    // a provider returns — D4 owns parsing an OAuth response.
    expect(code).not.toMatch(/googleapis|graph\.microsoft|oauth|access_token|expires_in|token_type|tenant|fetch\(/i);
  });

  it('is reachable from no HTTP route', () => {
    // Creation before OAuth would let an operator type an address into a
    // record whose whole purpose is to say "a provider told us this".
    const routes = fs.readdirSync(new URL('../routes/', import.meta.url))
      .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
    for (const f of routes) {
      const src = fs.readFileSync(new URL(`../routes/${f}`, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/connectedMailboxes|mailboxCrypto|mailboxCredential/);
    }
    const index = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    expect(index).not.toMatch(/connectedMailboxes|mailboxCrypto|mailboxes/);
  });

  it('changes no send behaviour', () => {
    // B5 still budgets on a caller-supplied address; wiring mailbox id through
    // is a later phase with a provider to send through.
    const b5 = fs.readFileSync(new URL('./outboundBudget.js', import.meta.url), 'utf8');
    expect(b5).not.toMatch(/connectedMailboxes|mailbox_id|connected_mailbox/);
    const send = fs.readFileSync(new URL('../routes/sendOutreach.js', import.meta.url), 'utf8');
    expect(send).not.toMatch(/connectedMailboxes|connected_mailbox/);
  });
});

// ---------------------------------------------------------------------------

describe('a database that already carries the shipped-for-one-commit shape', () => {
  /**
   * `schema.sql` uses CREATE TABLE IF NOT EXISTS, which does nothing to a
   * table that already exists — and SQLite cannot alter a foreign key in
   * place. So a database that ran the branch before D2.1 keeps the CASCADE
   * shape for ever unless something rebuilds it, and the local working
   * database is one: it acquired both tables during D2 inspection.
   */
  const CASCADE_SHAPE = `
    CREATE TABLE connected_mailboxes (
      id TEXT PRIMARY KEY,
      operator_user_id TEXT NOT NULL REFERENCES operator_users(id) ON DELETE CASCADE,
      athlete_id TEXT REFERENCES players(id),
      provider TEXT NOT NULL CHECK (provider IN ('GOOGLE', 'MICROSOFT')),
      provider_account_id TEXT NOT NULL,
      email_address TEXT NOT NULL,
      display_name TEXT,
      status TEXT NOT NULL CHECK (status IN (
        'CONNECTED', 'NEEDS_RECONSENT', 'REVOKED', 'UNHEALTHY_TEMPORARY')),
      scopes TEXT, connected_at TEXT NOT NULL, last_verified_at TEXT, revoked_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE (provider, provider_account_id)
    );
    CREATE TABLE connected_mailbox_credentials (
      mailbox_id TEXT PRIMARY KEY REFERENCES connected_mailboxes(id) ON DELETE CASCADE,
      ciphertext TEXT NOT NULL, iv TEXT NOT NULL, auth_tag TEXT NOT NULL,
      key_version INTEGER NOT NULL, rotated_at TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );`;

  /** A database with the old shape and a credential in it. */
  async function legacyDb() {
    const { default: Database } = await import('better-sqlite3');
    const d = new Database(':memory:');
    d.pragma('foreign_keys = ON');
    d.exec(`
      CREATE TABLE operator_users (id TEXT PRIMARY KEY, email TEXT, password_hash TEXT,
        active INTEGER, created_at TEXT, last_login_at TEXT);
      CREATE TABLE players (id TEXT PRIMARY KEY);
      ${CASCADE_SHAPE}
    `);
    d.prepare("INSERT INTO operator_users VALUES ('op','o@x','h',1,'x',NULL)").run();
    d.prepare(`INSERT INTO connected_mailboxes (id, operator_user_id, provider,
      provider_account_id, email_address, status, connected_at, created_at, updated_at)
      VALUES ('m1','op','GOOGLE','sub-1','a@b.com','CONNECTED','x','x','x')`).run();
    d.prepare(`INSERT INTO connected_mailbox_credentials VALUES
      ('m1','CIPHER','IV','TAG',1,'x','x','x')`).run();
    return d;
  }

  const operatorFk = (d) => d.prepare('PRAGMA foreign_key_list(connected_mailboxes)').all()
    .find((fk) => fk.table === 'operator_users').on_delete;

  it('is converged, and keeps the encrypted credential while doing it', async () => {
    const { preserveMailboxIdentityAcrossOperators: migrate } = await import('../db/migrate.js');
    const d = await legacyDb();
    expect(operatorFk(d)).toBe('CASCADE');

    migrate(d);

    expect(operatorFk(d)).toBe('NO ACTION');
    /**
     * The rows are carried across rather than assumed absent. Every such
     * database today holds zero mailboxes — nothing can create one — so this
     * is a formality, and it is written because "impossible today" is the
     * assumption that later turns out to have been wrong, and the rows it
     * would discard are encrypted credentials.
     */
    expect(d.prepare('SELECT * FROM connected_mailbox_credentials').get())
      .toMatchObject({ mailbox_id: 'm1', ciphertext: 'CIPHER', iv: 'IV', auth_tag: 'TAG', key_version: 1 });
    expect(d.prepare('SELECT COUNT(*) n FROM connected_mailboxes').get().n).toBe(1);

    expect(() => d.prepare("DELETE FROM operator_users WHERE id = 'op'").run())
      .toThrow(/FOREIGN KEY constraint failed/);
    d.close();
  });

  it('runs again without doing anything', async () => {
    const { preserveMailboxIdentityAcrossOperators: migrate } = await import('../db/migrate.js');
    const d = await legacyDb();
    migrate(d);
    const first = d.prepare('SELECT * FROM connected_mailboxes').get();
    migrate(d); migrate(d);
    expect(d.prepare('SELECT * FROM connected_mailboxes').get()).toEqual(first);
    expect(operatorFk(d)).toBe('NO ACTION');
    d.close();
  });

  it('agrees with schema.sql, which is the copy that could drift', async () => {
    const { default: Database } = await import('better-sqlite3');
    const { preserveMailboxIdentityAcrossOperators: migrate } = await import('../db/migrate.js');
    // The migration inlines its own DDL — SQLite gives it no choice — so the
    // two definitions are asserted equal rather than assumed to be.
    const fresh = new Database(':memory:');
    fresh.exec(fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
    const rebuilt = await legacyDb();
    migrate(rebuilt);

    const shapeOf = (d, table) => d.prepare(`PRAGMA table_info(${table})`).all()
      .map((c) => `${c.name}:${c.type}:${c.notnull}:${c.pk}`).join('|');
    const fksOf = (d, table) => d.prepare(`PRAGMA foreign_key_list(${table})`).all()
      .map((f) => `${f.table}.${f.to}:${f.on_delete}`).sort().join('|');

    for (const table of ['connected_mailboxes', 'connected_mailbox_credentials']) {
      expect(shapeOf(rebuilt, table), table).toBe(shapeOf(fresh, table));
      expect(fksOf(rebuilt, table), table).toBe(fksOf(fresh, table));
    }
    fresh.close(); rebuilt.close();
  });
});
