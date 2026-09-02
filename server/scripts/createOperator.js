#!/usr/bin/env node
/**
 * CREATE THE FIRST OPERATOR — Phase 13K.
 *
 * There is no default password and no self-service registration, so this is
 * how an account comes to exist. Run it on the host, once, before the first
 * sign-in:
 *
 *   THRIV3_OPERATOR_PASSWORD='…' node server/scripts/createOperator.js rhys@…
 *   node server/scripts/createOperator.js rhys@… --reset       # prompts
 *   node server/scripts/createOperator.js --list
 *   node server/scripts/createOperator.js rhys@… --deactivate
 *
 * THE PASSWORD NEVER TOUCHES DISK OR HISTORY. It comes from the environment
 * (the way a host's secret store supplies it) or from a prompt with echo
 * turned off. It is never an argument, because an argument is in `ps` and in
 * the shell history of everybody who has ever typed it; it is never printed,
 * never logged, and what is stored is the scrypt hash.
 */
import readline from 'node:readline';
import {
  createOperator, listOperators, normaliseEmail, passwordProblem, setOperatorActive,
  operatorCount,
} from '../lib/operatorAuth.js';
import db from '../db/client.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const email = args.find((a) => !a.startsWith('--')) || null;

/** Reads a line with the terminal's echo off, so nothing appears on screen. */
function prompt(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('No terminal to prompt on. Set THRIV3_OPERATOR_PASSWORD instead.'));
      return;
    }
    const rl = readline.createInterface({
      input: process.stdin, output: process.stdout, terminal: true,
    });
    // readline echoes every keystroke by default. Let the question through and
    // nothing else, so neither the password nor its length reaches the screen
    // — or a shared terminal recording.
    rl._writeToOutput = (chunk) => {
      if (String(chunk).startsWith(question)) rl.output.write(question);
    };
    rl.question(question, (answer) => {
      rl.output.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

async function readPassword() {
  const fromEnv = process.env.THRIV3_OPERATOR_PASSWORD;
  if (fromEnv) return fromEnv;
  const once = await prompt('Password (not shown): ');
  const twice = await prompt('Again: ');
  if (once !== twice) throw new Error('Those two passwords are different.');
  return once;
}

async function main() {
  if (flag('list')) {
    const rows = listOperators();
    if (!rows.length) {
      console.log('No operator accounts. Nobody can sign in.');
      return;
    }
    console.log(`${rows.length} operator account(s):\n`);
    for (const r of rows) {
      console.log(`  ${r.active ? '●' : '○'} ${r.email}`
        + `   created ${r.created_at.slice(0, 10)}`
        + `   last signed in ${r.last_login_at ? r.last_login_at.slice(0, 16).replace('T', ' ') : 'never'}`);
    }
    return;
  }

  if (!email) {
    console.error('Usage: node server/scripts/createOperator.js <email> [--reset|--deactivate|--reactivate]');
    console.error('       node server/scripts/createOperator.js --list');
    process.exitCode = 1;
    return;
  }

  if (flag('deactivate') || flag('reactivate')) {
    const active = flag('reactivate');
    const row = db.prepare('SELECT id FROM operator_users WHERE email = ?').get(normaliseEmail(email));
    if (!row) throw new Error(`${normaliseEmail(email)} has no account.`);
    setOperatorActive(row.id, active);
    console.log(`${normaliseEmail(email)} is now ${active ? 'active' : 'deactivated'}`
      + `${active ? '' : ' — its sessions were ended'}.`);
    if (!active && operatorCount() === 0) {
      console.warn('\n  WARNING: no active operator accounts remain. Nobody can sign in.');
    }
    return;
  }

  const password = await readPassword();
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);

  const result = await createOperator({ email, password, reset: flag('reset') });
  console.log(result.created
    ? `Created ${result.email}. Sign in at the app's own address.`
    : `Reset the password for ${result.email}. Every existing session was ended.`);
}

main().catch((err) => {
  // The message only ever describes the account or the rule that was broken.
  console.error(`\n${err.message}\n`);
  process.exitCode = 1;
});
