import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { exportAll, writeRobotsTxt, trackingEndpoint, OUTPUT_DIR } from '../export/exportProfiles.js';
import { PAGES_PROJECT, cloudflareCredentials } from './config.js';
import { validateCandidate, readLedger, writeLedger } from './publishManifest.js';

const runFile = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Publishes the generated public site to Cloudflare Pages.
 *
 * WHY THIS IS NOT `npm run publish` ANY MORE. That script chained three
 * things — export, bundle the worker with esbuild, deploy with wrangler — and
 * two of them cannot exist in the hosted runtime. Render builds with
 * `npm ci --include=dev && npm run build && npm prune --omit=dev`, so esbuild
 * leaves with Vite and wrangler was never in package.json at all. The Go Live
 * button therefore could not have worked once hosted, and would have failed as
 * a truncated shell error rather than as anything an operator could act on.
 *
 * The split that fixes it:
 *
 *   BUILD TIME  the worker is bundled while devDependencies are still present
 *               and the result is kept in the image (build/worker/_worker.js).
 *   PUBLISH     assembles the directory and calls wrangler. Nothing is
 *               compiled, so nothing needs a toolchain.
 *
 * Wrangler is still required, and is deliberately NOT a package.json
 * dependency: installing it pulls 226 MB, 145 MB of which is workerd — a local
 * dev runtime a deploy never executes — and it drags @esbuild back in, which
 * is the exact thing the prune exists to remove. The deployment contract
 * installs it explicitly after the prune instead, so the exception is visible
 * in render.yaml rather than hidden in a dependency list.
 */

/** Where the build stage leaves the bundled worker. */
export const WORKER_BUNDLE = process.env.THRIV3_WORKER_BUNDLE
  || path.resolve(repoRoot, 'build/worker/_worker.js');

/**
 * The wrangler binary, resolved explicitly rather than trusted to PATH.
 *
 * A spawned process does not inherit node_modules/.bin, so relying on the bare
 * name works in a shell and fails from the server — which is precisely the
 * class of bug this module exists to remove.
 */
export function resolveWranglerBin({ root = repoRoot, env = process.env } = {}) {
  if (env.THRIV3_WRANGLER_BIN) return env.THRIV3_WRANGLER_BIN;
  const local = path.join(root, 'node_modules', '.bin', 'wrangler');
  if (fs.existsSync(local)) return local;
  return null;
}

/**
 * Everything that must be true before the button can do anything, reported
 * together so one press names every gap rather than one per attempt.
 */
export function publisherReadiness({ env = process.env, root = repoRoot, workerBundle = WORKER_BUNDLE } = {}) {
  const problems = [];
  const endpoint = trackingEndpoint();
  const { apiToken, accountId } = cloudflareCredentials(env);

  if (!resolveWranglerBin({ root, env })) {
    problems.push(
      'wrangler is not installed. The hosted build installs it after the prune — '
      + 'see the buildCommand in render.yaml.'
    );
  }
  if (!fs.existsSync(workerBundle)) {
    problems.push(
      `the worker bundle is missing (${workerBundle}). It is produced by \`npm run build\`; `
      + 'a deploy without it would serve the pages with no collector behind them.'
    );
  }
  if (!apiToken) problems.push('CLOUDFLARE_API_TOKEN is not set.');
  if (!accountId) problems.push('CLOUDFLARE_ACCOUNT_ID is not set.');

  // The silent killer. A page whose tracker posts to localhost looks perfect
  // and reports nothing, and nobody finds out until a coach has already been
  // and gone. Refusing here is the difference between a failed deploy and a
  // month of blank engagement.
  if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(endpoint)) {
    problems.push(
      `the tracking endpoint is ${endpoint}, which no coach's browser can reach. `
      + 'Set THRIV3_TRACK_ENDPOINT to the public collector before publishing.'
    );
  }

  return { ready: problems.length === 0, problems, endpoint, project: PAGES_PROJECT };
}

/**
 * Builds the exact directory Cloudflare will serve: every eligible athlete's
 * page, robots.txt, and the worker that gates them.
 *
 * A Pages deployment is a snapshot of a directory, so this regenerates all of
 * them rather than one. Slugs come from the athlete record and are reused, so
 * a URL already in a coach's inbox keeps working.
 *
 * It builds into an EMPTY directory every time. Reusing the live directory
 * looked like an optimisation and was a correctness hole: files there survive
 * the athlete they belong to, so an archived athlete's page would be shipped
 * again by the next publish, and a half-finished earlier run would contribute
 * pages nothing in this run had generated. What is deployed must be exactly
 * what this run produced.
 */
export function assembleSite({ outputDir = OUTPUT_DIR, workerBundle = WORKER_BUNDLE, fresh = false } = {}) {
  if (fresh) fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  const { written, skipped } = exportAll({ outputDir });
  writeRobotsTxt(outputDir);

  if (!fs.existsSync(workerBundle)) {
    throw new Error(`Worker bundle not found at ${workerBundle} — run \`npm run build\` first.`);
  }
  fs.copyFileSync(workerBundle, path.join(outputDir, '_worker.js'));

  return { outputDir, written, skipped, workerBundle };
}

/** Where a candidate is built, and where the last good one is kept. */
export const stagingDirFor = (outputDir) => `${outputDir}.staging`;
const supersededDirFor = (outputDir) => `${outputDir}.superseded`;

/**
 * Replaces the locally served copy with the snapshot that just went public.
 *
 * Renames rather than copies, so the swap is a single filesystem operation on
 * one volume. Done AFTER the deploy: if promotion fails, Cloudflare is already
 * correct and only this machine's preview is stale, which is the harmless way
 * round.
 */
function promote(staging, outputDir) {
  const superseded = supersededDirFor(outputDir);
  fs.rmSync(superseded, { recursive: true, force: true });
  if (fs.existsSync(outputDir)) fs.renameSync(outputDir, superseded);
  fs.renameSync(staging, outputDir);
  fs.rmSync(superseded, { recursive: true, force: true });
}

/**
 * Assembles, validates, and only then deploys.
 *
 * The order is the whole point. Everything that can fail — generating pages,
 * finding the worker, checking that every already-public athlete is still
 * present — happens before wrangler is invoked, so a failure at any of those
 * steps leaves the previous Cloudflare deployment serving exactly as it was.
 * The candidate is thrown away on any refusal; the live directory is never
 * touched until a deploy has succeeded.
 *
 * `exec` is injectable so the command can be asserted without a network call
 * or a Cloudflare account — an untested deployment boundary behind an operator
 * button is what the audit objected to.
 */
export async function publishSite({
  outputDir = OUTPUT_DIR,
  workerBundle = WORKER_BUNDLE,
  env = process.env,
  root = repoRoot,
  exec = runFile,
} = {}) {
  const readiness = publisherReadiness({ env, root, workerBundle });
  if (!readiness.ready) {
    throw new Error(`Cannot publish — ${readiness.problems.join(' ')}`);
  }

  const staging = stagingDirFor(outputDir);
  const discard = () => fs.rmSync(staging, { recursive: true, force: true });

  let assembled;
  try {
    assembled = assembleSite({ outputDir: staging, workerBundle, fresh: true });
  } catch (err) {
    discard();
    throw new Error(
      `Publish refused — the candidate site could not be generated: ${err.message} `
      + 'Nothing was deployed and the live site is unchanged.'
    );
  }

  const verdict = validateCandidate({
    dir: staging,
    endpoint: readiness.endpoint,
    skipped: assembled.skipped,
    ledger: readLedger(outputDir),
  });
  if (!verdict.ok) {
    discard();
    throw new Error(
      `Publish refused — the candidate site is not safe to make public. `
      + `Nothing was deployed and the live site is unchanged.\n\n`
      + verdict.failures.map((f) => `• ${f}`).join('\n')
    );
  }

  const { apiToken, accountId } = cloudflareCredentials(env);
  const bin = resolveWranglerBin({ root, env });

  const args = [
    'pages', 'deploy', staging,
    '--project-name', PAGES_PROJECT,
    '--branch', 'main',
    '--commit-dirty=true',
  ];

  let output;
  try {
    // Credentials go in the child's environment, never in argv — argv is
    // readable from the process list by anything else on the box.
    const result = await exec(bin, args, {
      cwd: root,
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...env, CLOUDFLARE_API_TOKEN: apiToken, CLOUDFLARE_ACCOUNT_ID: accountId },
    });
    output = `${result.stdout || ''}\n${result.stderr || ''}`;
  } catch (err) {
    // The deployment failed, so the previous one is still production. Throw
    // away the candidate and change nothing locally either — in particular do
    // not stamp anyone as published.
    discard();
    const detail = `${err.stdout || ''}\n${err.stderr || ''}`.trim();
    throw new Error(
      `Deployment failed; the previous public site is still serving. `
      + redactSecrets(detail.split('\n').filter(Boolean).slice(-3).join(' — ') || err.message, env)
    );
  }

  const deploymentUrl = (output.match(/https:\/\/[a-z0-9.-]+\.pages\.dev/gi) || []).pop() || null;
  writeLedger(outputDir, { slugs: verdict.slugs, deploymentUrl });
  promote(staging, outputDir);

  return {
    ...assembled,
    outputDir,
    deploymentUrl,
    project: PAGES_PROJECT,
    slugs: verdict.slugs,
  };
}

/**
 * Wrangler does not print the token, but its errors quote what they were
 * given, and this string is on its way to a browser. Cheap insurance against
 * a future version being less careful.
 */
export function redactSecrets(text, env = process.env) {
  const { apiToken } = cloudflareCredentials(env);
  let out = String(text);
  for (const secret of [apiToken, env.THRIV3_SYNC_SECRET]) {
    if (secret && secret.length > 6) out = out.split(secret).join('[redacted]');
  }
  return out;
}
