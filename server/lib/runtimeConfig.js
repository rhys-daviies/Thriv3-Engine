/**
 * THE RUNTIME CONTRACT — Phase 13K.
 *
 * One place that answers "is this process configured to be reachable by
 * somebody other than the person who started it", and refuses to start when
 * the answer is unclear.
 *
 * WHY THIS EXISTS. Phase 13J bound the API to loopback because the
 * application had no authentication and the documented model was one operator
 * on one machine. Hosting reverses every one of those assumptions: the process
 * is reachable, the disk is somebody else's, and a missing environment
 * variable is not a developer's inconvenience but an open door. Every silent
 * fallback that is right on a laptop is wrong on a host, so in production the
 * fallbacks are removed and the process exits instead.
 *
 * The rule: LOUD IN PRODUCTION, CONVENIENT IN DEVELOPMENT. Nothing here makes
 * local work harder, and nothing here lets a hosted process start half-secured.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** Placeholders that pass a length check while providing no secrecy at all. */
const REFUSED_SECRETS = new Set([
  'changeme', 'change-me', 'secret', 'session-secret', 'thriv3', 'password',
  'development', 'production', 'insecure', 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
]);

const MIN_SECRET_LENGTH = 32;

export const DEFAULTS = Object.freeze({
  port: 8787,
  /**
   * Loopback stays the default — 13J's rule survives hosting. A hosted process
   * must say `API_HOST=0.0.0.0` out loud, because a service that listens to
   * the world should be the result of a decision somebody wrote down.
   */
  host: '127.0.0.1',
  sessionIdleHours: 12,
  sessionMaxDays: 7,
  /**
   * scrypt cost as log2(N), with r=8, p=1.
   *
   * OWASP's floor for scrypt is N=2^17 (128 MiB per hash). This is one notch
   * below it, at 64 MiB, and the reason is the deployment shape rather than
   * taste: the recommended V1 instance has 512 MB of RAM, holds a division
   * benchmark pool in memory, and two concurrent sign-ins at 2^17 would be a
   * third of the machine. Login is rate limited to a handful of attempts per
   * window per address, so the attack this parameter defends against — offline
   * cracking of a stolen hash — is still met with 64 MiB and ~200 ms per guess.
   * Raise it with THRIV3_SCRYPT_COST=17 on an instance with room; hashes carry
   * their own parameters, so old ones keep verifying.
   */
  scryptCost: 16,
});

/**
 * A loopback origin, which cannot leave the machine.
 *
 * THE ONE EXEMPTION FROM THE HTTPS RULE, and it is not a flag anybody can
 * misuse. Running the app in production mode locally — built client, real
 * environment, authentication on — is how the hosted route shape gets tested
 * before it is deployed, and it happens over http on 127.0.0.1. A cookie on a
 * loopback origin is not a credential in transit anywhere, so the reason for
 * the rule does not apply. A real deployment's origin is a domain, so it
 * cannot take this path by accident.
 */
export function isLoopback(origin) {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
      || hostname === '::1';
  } catch { return false; }
}

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function int(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * A directory that must exist and be writable, resolved and checked once.
 *
 * Returns a problem string rather than throwing, so startup can report every
 * fault in one message instead of one per restart.
 */
export function checkWritableDir(dir, { create = false } = {}) {
  try {
    if (create) fs.mkdirSync(dir, { recursive: true });
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return `${dir} exists but is not a directory`;
    fs.accessSync(dir, fs.constants.W_OK);
    return null;
  } catch (err) {
    if (err.code === 'ENOENT') return `${dir} does not exist`;
    if (err.code === 'EACCES' || err.code === 'EPERM' || err.code === 'EROFS') {
      return `${dir} is not writable`;
    }
    return `${dir} could not be checked (${err.code || err.message})`;
  }
}

/**
 * Read the environment into the shape the rest of the server uses.
 *
 * Pure with respect to `env`, so a test can hand it a hosted environment
 * without setting one.
 */
export function resolveConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';

  const origins = String(env.THRIV3_APP_ORIGIN || '')
    .split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);

  const port = int(env.API_PORT, DEFAULTS.port);
  const clientPort = int(env.CLIENT_PORT, 5183);

  /**
   * In development the operator app is served by Vite on its own port and
   * proxies /api, so both origins are legitimate senders — and 127.0.0.1 and
   * localhost are different origins to a browser, which is exactly the sort of
   * detail that makes a CSRF check look broken when it is working.
   */
  const devOrigins = production ? [] : [
    `http://localhost:${clientPort}`, `http://127.0.0.1:${clientPort}`,
    `http://localhost:${port}`, `http://127.0.0.1:${port}`,
  ];

  return {
    production,
    port,
    host: env.API_HOST || DEFAULTS.host,
    /** Explicit hop count. Never `true`: trusting every proxy means trusting
     * whatever X-Forwarded-For a caller invents. Render terminates TLS one hop
     * in front of the process, so 1 is right there; 0 is right locally. */
    trustProxy: int(env.THRIV3_TRUST_PROXY, 0),
    appOrigins: origins.length ? origins : devOrigins,
    /** Secure cookies require HTTPS. Derived from the origin rather than set
     * separately, so the two cannot disagree. */
    cookieSecure: production
      ? !origins.some((o) => o.startsWith('http://'))
      : bool(env.THRIV3_COOKIE_SECURE, false),
    /** True when this production process is a local staging run over loopback. */
    localStaging: production && origins.length > 0 && origins.every(isLoopback),
    sessionSecret: env.THRIV3_SESSION_SECRET || null,
    sessionIdleHours: int(env.THRIV3_SESSION_IDLE_HOURS, DEFAULTS.sessionIdleHours),
    sessionMaxDays: int(env.THRIV3_SESSION_MAX_DAYS, DEFAULTS.sessionMaxDays),
    scryptCost: int(env.THRIV3_SCRYPT_COST, DEFAULTS.scryptCost),
    dbPath: env.RECRUITMATCH_DB || null,
    reportStore: env.THRIV3_REPORT_STORE || null,
    /**
     * Where uploaded files live — and the reason this is here.
     *
     * FOUND BY THE STAGING RESTORE. `players.recommendations` does not hold an
     * analysis; it holds a path like `/uploads/<uuid>-recommendations-<id>.json`,
     * so an athlete's whole matching result is a FILE. Restoring the database
     * and the report store into a clean directory produced an app that signed
     * in, listed athletes and showed "No matches yet" for every one of them —
     * because the third persistent thing was still on the machine the backup
     * was taken from. On a container host it would be discarded on the next
     * deploy, silently, and look exactly like an analysis nobody had run.
     */
    uploadDir: env.THRIV3_UPLOAD_DIR || null,
    /** Where the built operator app is served from when this process serves it
     * itself, which is the hosted shape: one origin, no CORS, no second host. */
    clientDir: env.THRIV3_CLIENT_DIR || null,
  };
}

/**
 * Everything wrong with this configuration, as sentences.
 *
 * Development returns problems too, but only the ones that are faults
 * anywhere; the production-only requirements are exactly the ones whose safe
 * default cannot exist on a host.
 */
export function runtimeProblems(env = process.env, config = resolveConfig(env)) {
  const problems = [];
  const { production } = config;

  // ---- the session secret ------------------------------------------------
  if (production) {
    const secret = config.sessionSecret;
    if (!secret) {
      problems.push('THRIV3_SESSION_SECRET is not set. Sessions cannot be issued without it. '
        + 'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    } else if (secret.length < MIN_SECRET_LENGTH) {
      problems.push(`THRIV3_SESSION_SECRET is ${secret.length} characters; `
        + `${MIN_SECRET_LENGTH} is the minimum.`);
    } else if (REFUSED_SECRETS.has(secret.toLowerCase())) {
      problems.push('THRIV3_SESSION_SECRET is a placeholder, not a secret.');
    }
  } else if (config.sessionSecret && config.sessionSecret.length < MIN_SECRET_LENGTH) {
    problems.push(`THRIV3_SESSION_SECRET is ${config.sessionSecret.length} characters; `
      + `${MIN_SECRET_LENGTH} is the minimum. Unset it to use a per-boot development secret.`);
  }

  // ---- where the data lives ----------------------------------------------
  //
  // Both paths must be given explicitly in production, because both defaults
  // sit inside the source tree — which on every host under consideration is a
  // container layer that is discarded on the next deploy. A report an operator
  // sent would simply stop existing, and nothing would report it.
  if (production) {
    if (!config.dbPath) {
      problems.push('RECRUITMATCH_DB is not set. In production it must be an absolute path on '
        + 'the persistent disk — the default lives in the source tree, which does not survive a deploy.');
    } else if (!path.isAbsolute(config.dbPath)) {
      problems.push(`RECRUITMATCH_DB (${config.dbPath}) must be an absolute path.`);
    } else {
      const bad = checkWritableDir(path.dirname(config.dbPath));
      if (bad) problems.push(`The database directory is not usable: ${bad}.`);
    }

    if (!config.reportStore) {
      problems.push('THRIV3_REPORT_STORE is not set. In production it must be an absolute path on '
        + 'the persistent disk: a generated report is a document that was sent, and it may not '
        + 'live on a filesystem that is thrown away.');
    } else if (!path.isAbsolute(config.reportStore)) {
      problems.push(`THRIV3_REPORT_STORE (${config.reportStore}) must be an absolute path.`);
    } else {
      const bad = checkWritableDir(config.reportStore, { create: true });
      if (bad) problems.push(`The report store is not usable: ${bad}.`);
    }

    if (!config.uploadDir) {
      problems.push('THRIV3_UPLOAD_DIR is not set. In production it must be an absolute path on '
        + 'the persistent disk: an athlete\'s stored matching analysis is a FILE in this '
        + 'directory, not a row, and losing it looks exactly like an analysis nobody ran.');
    } else if (!path.isAbsolute(config.uploadDir)) {
      problems.push(`THRIV3_UPLOAD_DIR (${config.uploadDir}) must be an absolute path.`);
    } else {
      const bad = checkWritableDir(config.uploadDir, { create: true });
      if (bad) problems.push(`The upload directory is not usable: ${bad}.`);
    }

    // The one check that is about the disk being the RIGHT disk rather than a
    // writable one. Sharing a mount is the intended shape: one volume holds
    // both, one snapshot captures both, and a restore cannot mix eras.
    const volumeOf = (p) => (p && path.isAbsolute(p) ? p.split(path.sep)[1] : null);
    const volumes = new Set([
      volumeOf(config.dbPath && path.dirname(config.dbPath)),
      volumeOf(config.reportStore),
      volumeOf(config.uploadDir),
    ].filter(Boolean));
    if (volumes.size > 1) {
      problems.push('The database, the report store and the upload directory are on different '
        + `top-level paths (${[...volumes].map((v) => `/${v}`).join(', ')}). All three must share `
        + 'one persistent volume, so one snapshot captures a consistent moment — otherwise a '
        + 'restore can produce history rows whose artefacts, or athletes whose analyses, are '
        + 'from another era.');
    }
  }

  // ---- who may talk to it ------------------------------------------------
  if (production) {
    if (!config.appOrigins.length) {
      problems.push('THRIV3_APP_ORIGIN is not set. It is the operator app\'s own origin, and '
        + 'without it every state-changing request is refused and CORS cannot be scoped.');
    } else {
      for (const origin of config.appOrigins) {
        if (!/^https?:\/\/[^/]+$/.test(origin)) {
          problems.push(`THRIV3_APP_ORIGIN entry "${origin}" is not a bare origin `
            + '(scheme://host[:port], no path).');
        } else if (origin.startsWith('http://') && !isLoopback(origin)) {
          problems.push(`THRIV3_APP_ORIGIN is ${origin}. Authentication is only accepted over `
            + 'HTTPS in production: a session cookie on http is a credential sent in clear.');
        }
      }
    }

    if (!env.API_HOST) {
      problems.push('API_HOST is not set. The default is 127.0.0.1, which a hosted platform '
        + 'cannot reach — set API_HOST=0.0.0.0 deliberately, behind this application\'s own '
        + 'authentication.');
    }

    if (env.THRIV3_TRUST_PROXY === undefined || env.THRIV3_TRUST_PROXY === '') {
      problems.push('THRIV3_TRUST_PROXY is not set. It is the number of proxies in front of this '
        + 'process (1 on a platform that terminates TLS for you, 0 if nothing does). Without it '
        + 'a secure cookie is either never sent or trusted on a forged header.');
    }

    // Only when an origin was actually given: with none, the message above
    // already says so, and adding a second consequence of the same fault is
    // noise in a list somebody is reading at deploy time.
    if (config.appOrigins.length && config.cookieSecure && config.trustProxy === 0
      && !config.localStaging) {
      problems.push('The app origin is HTTPS but THRIV3_TRUST_PROXY is 0, so Express will see '
        + 'plain HTTP and refuse to set a Secure cookie. Sign-in would fail with no error.');
    }
  }

  if (config.scryptCost < 14 || config.scryptCost > 20) {
    problems.push(`THRIV3_SCRYPT_COST is ${config.scryptCost}; it is log2(N) and must be 14–20. `
      + `${DEFAULTS.scryptCost} is the default.`);
  }

  return problems;
}

/**
 * The development session secret: random, per boot, never written down.
 *
 * A fixed development secret in the repository is a fixed secret in
 * production the first time somebody copies the file. The cost is that a
 * restart signs the developer out, which takes four seconds to undo.
 */
let devSecret;
export function sessionSecretFor(config) {
  if (config.sessionSecret) return config.sessionSecret;
  if (config.production) throw new Error('No session secret in production');
  devSecret ??= crypto.randomBytes(32).toString('hex');
  return devSecret;
}

/**
 * Called once, at startup, by the process that listens.
 *
 * Exits rather than throwing: a stack trace from inside a middleware chain is
 * the wrong shape for "you did not set an environment variable", and a host
 * that restarts a crashing container forever should be told to stop by a
 * non-zero exit with a readable reason above it.
 */
export function assertRuntime({ env = process.env, log = console, exit = process.exit } = {}) {
  const config = resolveConfig(env);
  const problems = runtimeProblems(env, config);
  if (problems.length) {
    log.error('\nTHRIV3 REFUSED TO START — '
      + `${problems.length} configuration problem${problems.length === 1 ? '' : 's'}:\n`);
    for (const p of problems) log.error(`  • ${p}`);
    log.error('\nSee docs/hosting.md for the full runtime contract.\n');
    return exit(1);
  }
  return config;
}

/** A one-line description of the boundary, printed at boot so it is never a guess. */
export function describeRuntime(config) {
  const reach = config.host === '0.0.0.0' || config.host === '::'
    ? 'reachable from the network' : `bound to ${config.host}`;
  return `${config.production ? 'production' : 'development'} · ${reach} · `
    + `authentication required · cookies ${config.cookieSecure ? 'Secure' : 'not Secure (http)'}`
    + (config.appOrigins.length ? ` · origin ${config.appOrigins.join(', ')}` : '');
}
