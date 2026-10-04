/**
 * GATHERER FETCH LAYER — Phase 8A. One way to fetch a source page, with provenance.
 *
 * Returns what a staged observation needs to prove where a fact came from: the requested
 * URL, the final URL after redirects, the HTTP status, fetched_at, a body digest, and a
 * BLOCK classification so a challenge/403/empty page is never read as "no records".
 * Nothing here parses or decides; nothing here writes a database.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { hostOf } from '../../athleticsEntity.js';

export const ADAPTER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

/** Why a response cannot be read as content (null = readable). */
export function blockReason({ status, body = '', finalUrl = '' }) {
  if (!status) return 'UNREACHABLE';
  if (status === 403 || status === 429 || status === 503) return `HTTP_${status}`;
  // AWS WAF answers a challenged request with 202 and an empty (or JS-only) body
  if (status === 202) return 'BOT_CHALLENGE';
  if (status >= 400) return `HTTP_${status}`;
  const head = body.slice(0, 4000);
  if (/<title>\s*Just a moment\.\.\.|cf-challenge|challenge-platform|Attention Required! \| Cloudflare/i.test(head)) return 'BOT_CHALLENGE';
  // AWS WAF (PrestoSports): HTTP 200 with a JS challenge and an empty title — the page
  // that, read naively, looks like "this programme has no teams / no roster"
  if (/awsWafIntegration|gokuProps|challenge-container|token\.awswaf\.com/i.test(head)) return 'BOT_CHALLENGE';
  if (/<title>\s*(ERROR: The request could not be satisfied|Site Disabled|Page Not Found|404)/i.test(head)) return 'ERROR_PAGE';
  if (body.length < 800) return 'EMPTY_BODY';
  if (/web\.archive\.org/.test(finalUrl)) return null;
  return null;
}

/**
 * Default transport: the system curl. Measured in Phase 8A: PrestoSports' AWS WAF challenges
 * Node's built-in fetch (HTTP 202 challenge pages) while serving the same URL to curl, so
 * curl is the transport that returns real content. Same contract as `fetch`.
 */
export function curlFetch(url, { signal, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const tmp = path.join(os.tmpdir(), `p8a-${crypto.randomBytes(6).toString('hex')}.html`);
    const child = execFile('curl', ['-sL', '--compressed', '-A', headers['user-agent'] || ADAPTER_UA, '--max-time', '30', '-o', tmp, '-w', '%{http_code} %{url_effective}', url], { maxBuffer: 1 << 20 }, (err, stdout) => {
      let body = ''; try { body = fs.readFileSync(tmp, 'utf8'); fs.rmSync(tmp, { force: true }); } catch { /* none */ }
      const [code, ...rest] = String(stdout || '').trim().split(' ');
      if (err && !code) return reject(err);
      resolve({ status: Number(code) || 0, url: rest.join(' ') || url, text: async () => body });
    });
    signal?.addEventListener?.('abort', () => child.kill());
  });
}

/**
 * fetchPage(url) -> { url, final_url, host, final_host, status, fetched_at, sha256, bytes, body, block }
 * `fetchImpl` is injectable for tests (and for replaying saved captures).
 */
export async function fetchPage(url, { fetchImpl = curlFetch, timeoutMs = 35000, now = () => new Date() } = {}) {
  const fetched_at = now().toISOString();
  let status = 0; let body = ''; let final_url = url;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetchImpl(url, { redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': ADAPTER_UA, accept: 'text/html,application/xhtml+xml' } });
    clearTimeout(t);
    status = res.status; final_url = res.url || url; body = await res.text();
  } catch { status = 0; }
  const sha256 = crypto.createHash('sha256').update(body).digest('hex');
  return { url, final_url, host: hostOf(url), final_host: hostOf(final_url), status, fetched_at, sha256, bytes: body.length, body, block: blockReason({ status, body, finalUrl: final_url }) };
}

/** Replay a saved capture as if fetched (browser captures for bot-protected hosts). */
export function capturedPage({ url, final_url = url, status = 200, fetched_at, body, via = 'browser-capture' }) {
  const sha256 = crypto.createHash('sha256').update(body).digest('hex');
  return { url, final_url, host: hostOf(url), final_host: hostOf(final_url), status, fetched_at, sha256, bytes: body.length, body, block: blockReason({ status, body, finalUrl: final_url }), via };
}
