/**
 * Publishes the generated public site to Cloudflare Pages.
 *
 *   npm run publish
 *
 * The same code path the Go Live button takes, deliberately: a CLI that
 * deployed differently from the button would make one of them a rehearsal for
 * something that never happens.
 */
import 'dotenv/config';
import { publishSite, publisherReadiness } from '../lib/sitePublisher.js';

const readiness = publisherReadiness();
if (!readiness.ready) {
  console.error('[publish] cannot publish:');
  for (const problem of readiness.problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`[publish] project ${readiness.project}`);
console.log(`[publish] tracking endpoint ${readiness.endpoint}`);

const result = await publishSite();
for (const page of result.written) console.log(`[publish] ${page.name} -> p/${page.slug}.html`);
for (const skip of result.skipped) console.log(`[publish] skipped ${skip.name} — missing: ${skip.missing.join(', ')}`);
console.log(`[publish] ${result.written.length} page(s) deployed, ${result.skipped.length} skipped`);
if (result.deploymentUrl) console.log(`[publish] ${result.deploymentUrl}`);
