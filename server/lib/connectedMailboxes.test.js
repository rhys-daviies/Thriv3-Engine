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

  it('takes the credential with the operator', () => {
    const m = connect();
    storeMailboxCredential(m.id, { refreshToken: TOKEN, operatorUserId: OP });
    db.prepare('DELETE FROM operator_users WHERE id = ?').run(OP);
    // Deactivating an operator must not leave live credentials addressable by
    // nobody.
    expect(db.prepare('SELECT COUNT(*) n FROM connected_mailboxes').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) n FROM connected_mailbox_credentials').get().n).toBe(0);
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
