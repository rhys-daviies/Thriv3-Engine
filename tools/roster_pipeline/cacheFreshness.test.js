import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * L7U — a cached page has an age, and an old one is not an answer.
 *
 * `fetch` stored a body under sha1(url) and reused it whenever the file
 * existed: no age, no revalidation, no TTL. L7T found every page it was about
 * to acquire from had been cached 23 days earlier, and the difference was real
 * roster data — Augustana read 28 players from the cached copy and 46 from the
 * live one. The same stale bodies made the cohort diagnostic call 83 programmes
 * "still serving last season" when their sites had published weeks before.
 *
 * WHAT THESE TESTS PIN. The TTL boundary in both directions, the fail-closed
 * rule (a stale body is never served when revalidation fails), the safe reading
 * of an entry whose age is unknown, and the exemption for capture URLs whose
 * content cannot change. The clock is injected, so nothing here sleeps or
 * depends on wall time.
 *
 * Every test runs against a temporary cache directory and a local HTTP server,
 * so no test reaches the public internet or the working cache.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const python = (() => {
  try { execFileSync('python3', ['--version'], { stdio: 'ignore' }); return 'python3'; }
  catch { return null; }
})();
const d = python ? describe : describe.skip;

/**
 * Run a snippet with `lib` imported, its cache pointed at a temp directory and
 * a one-shot local server available as `SERVER` / `serve(body)`.
 */
function py(code, { serverBody = null, serverFail = false } = {}) {
  const prelude = `
import sys, os, json, time, tempfile, threading, http.server, socketserver
sys.path.insert(0, ${JSON.stringify(HERE)})
os.environ.setdefault('RB_SEASON', '2026')
import lib
lib.CACHE = tempfile.mkdtemp(prefix='l7u-cache-')
HITS = {'n': 0}
BODY = ${serverBody === null ? 'None' : JSON.stringify(serverBody)}
FAIL = ${serverFail ? 'True' : 'False'}

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        HITS['n'] += 1
        if FAIL or BODY is None:
            self.send_response(503); self.end_headers(); return
        b = BODY.encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers(); self.wfile.write(b)

httpd = socketserver.TCPServer(('127.0.0.1', 0), H)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
SERVER = 'http://127.0.0.1:%d/roster' % httpd.server_address[1]

def put(url, body, fetched_at):
    """Seed the cache the way an earlier run would have."""
    bp, mp = lib._cache_paths(url)
    open(bp, 'w', encoding='utf-8').write(body)
    if fetched_at is not None:
        json.dump({'url': url, 'fetched_at': fetched_at}, open(mp, 'w', encoding='utf-8'))

def at(t):
    lib._now = lambda: t
`;
  const out = execFileSync(python, ['-c', prelude + code], {
    cwd: HERE, encoding: 'utf8',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(out.trim().split('\n').pop());
}

/** A body comfortably over the 800-byte floor `fetch` applies. */
const BIG = (tag) => `<!doctype html><title>${tag}</title>` + `<p>${tag}</p>`.repeat(80);

d('the TTL boundary', () => {
  it('1. reuses a body cached inside the window, without touching the network', () => {
    const r = py(`
at(1_000_000)
put(SERVER, ${JSON.stringify(BIG('cached'))}, 1_000_000 - 60)
code, body = lib.fetch(SERVER)
print(json.dumps({'code': code, 'cached': 'cached' in body, 'hits': HITS['n'],
                  'stats': lib.CACHE_STATS, 'ttl': lib.CACHE_TTL_SECONDS}))
`, { serverBody: BIG('live') });
    expect(r.code).toBe(200);
    expect(r.cached).toBe(true);
    expect(r.hits).toBe(0);
    expect(r.stats.fresh).toBe(1);
    expect(r.ttl).toBe(6 * 3600);
  });

  it('2. reuses a body cached exactly at the TTL edge', () => {
    const r = py(`
at(1_000_000)
put(SERVER, ${JSON.stringify(BIG('cached'))}, 1_000_000 - lib.CACHE_TTL_SECONDS)
code, body = lib.fetch(SERVER)
print(json.dumps({'cached': 'cached' in body, 'hits': HITS['n'], 'stats': lib.CACHE_STATS}))
`, { serverBody: BIG('live') });
    expect(r.cached).toBe(true);
    expect(r.hits).toBe(0);
    expect(r.stats.fresh).toBe(1);
  });

  it('3. refetches one second past the TTL, and serves the live body', () => {
    const r = py(`
at(1_000_000)
put(SERVER, ${JSON.stringify(BIG('cached'))}, 1_000_000 - lib.CACHE_TTL_SECONDS - 1)
code, body = lib.fetch(SERVER)
print(json.dumps({'code': code, 'live': 'live' in body, 'cached': 'cached' in body,
                  'hits': HITS['n'], 'stats': lib.CACHE_STATS}))
`, { serverBody: BIG('live') });
    expect(r.code).toBe(200);
    expect(r.live).toBe(true);
    expect(r.cached).toBe(false);
    expect(r.hits).toBe(1);
    expect(r.stats['stale-refetched']).toBe(1);
  });

  it('4. a successful revalidation replaces the stored body and its timestamp', () => {
    const r = py(`
at(1_000_000)
put(SERVER, ${JSON.stringify(BIG('cached'))}, 1)
lib.fetch(SERVER)
state, body = lib.cache_state(SERVER)
bp, mp = lib._cache_paths(SERVER)
meta = json.load(open(mp))
print(json.dumps({'state': state, 'live': 'live' in body, 'fetched_at': meta['fetched_at']}))
`, { serverBody: BIG('live') });
    expect(r.state).toBe('FRESH');
    expect(r.live).toBe(true);
    expect(r.fetched_at).toBe(1000000);
  });
});

d('fail closed', () => {
  it('5. a stale body is NOT returned when revalidation fails', () => {
    /*
     * THE RULE THAT MATTERS. The old code would have served the three-week-old
     * copy here and the caller would have called it the current season.
     */
    const r = py(`
at(1_000_000)
put(SERVER, ${JSON.stringify(BIG('cached'))}, 1)
code, body = lib.fetch(SERVER, tries=1)
state, on_disk = lib.cache_state(SERVER)
print(json.dumps({'code': code, 'body': body, 'hits': HITS['n'], 'stats': lib.CACHE_STATS,
                  'state': state, 'still_on_disk': 'cached' in (on_disk or '')}))
`, { serverFail: true });
    expect(r.body).toBe('');
    expect(r.code).not.toBe(200);
    expect(r.hits).toBe(1);
    expect(r.stats['stale-refetch-failed']).toBe(1);
    // the stale copy stays on disk, and stays unused
    expect(r.state).toBe('STALE');
    expect(r.still_on_disk).toBe(true);
  });

  it('6. a miss whose fetch fails answers the same way', () => {
    const r = py(`
at(1_000_000)
code, body = lib.fetch(SERVER, tries=1)
print(json.dumps({'code': code, 'body': body, 'stats': lib.CACHE_STATS}))
`, { serverFail: true });
    expect(r.body).toBe('');
    expect(r.stats['fetch-failed']).toBe(1);
  });
});

d('an entry whose age is unknown', () => {
  it('7. a legacy body with no sidecar is STALE, never FRESH', () => {
    const r = py(`
at(1_000_000)
put(SERVER, ${JSON.stringify(BIG('legacy'))}, None)
state, _ = lib.cache_state(SERVER)
code, body = lib.fetch(SERVER)
print(json.dumps({'state': state, 'live': 'live' in body, 'hits': HITS['n'],
                  'stats': lib.CACHE_STATS}))
`, { serverBody: BIG('live') });
    expect(r.state).toBe('STALE');
    expect(r.live).toBe(true);
    expect(r.hits).toBe(1);
    expect(r.stats['stale-refetched']).toBe(1);
  });

  it('8. a timestamp in the future is STALE, not trusted', () => {
    const r = py(`
at(1_000_000)
put(SERVER, ${JSON.stringify(BIG('cached'))}, 9_000_000)
state, _ = lib.cache_state(SERVER)
code, body = lib.fetch(SERVER)
print(json.dumps({'state': state, 'live': 'live' in body, 'hits': HITS['n']}))
`, { serverBody: BIG('live') });
    expect(r.state).toBe('STALE');
    expect(r.live).toBe(true);
    expect(r.hits).toBe(1);
  });

  it('9. an unreadable sidecar is STALE rather than an error', () => {
    const r = py(`
at(1_000_000)
put(SERVER, ${JSON.stringify(BIG('cached'))}, 1_000_000 - 60)
bp, mp = lib._cache_paths(SERVER)
open(mp, 'w').write('{not json')
state, _ = lib.cache_state(SERVER)
code, body = lib.fetch(SERVER)
print(json.dumps({'state': state, 'live': 'live' in body}))
`, { serverBody: BIG('live') });
    expect(r.state).toBe('STALE');
    expect(r.live).toBe(true);
  });

  it('10. a body under the size floor is a MISS, as before', () => {
    const r = py(`
at(1_000_000)
put(SERVER, 'tiny', 1_000_000 - 60)
state, _ = lib.cache_state(SERVER)
code, body = lib.fetch(SERVER)
print(json.dumps({'state': state, 'live': 'live' in body, 'stats': lib.CACHE_STATS}))
`, { serverBody: BIG('live') });
    expect(r.state).toBe('MISS');
    expect(r.live).toBe(true);
    expect(r.stats['miss-fetched']).toBe(1);
  });
});

d('what the policy deliberately exempts', () => {
  it('11. an archive capture is cached indefinitely, because its URL names a time', () => {
    const r = py(`
at(1_000_000)
WB = 'https://web.archive.org/web/20251028022431id_/https://x.test/roster'
put(WB, ${JSON.stringify(BIG('capture'))}, 1)          # a year old, and still fine
state, body = lib.cache_state(WB)
code, got = lib.fetch(WB)
print(json.dumps({'state': state, 'capture': 'capture' in got, 'hits': HITS['n'],
                  'stats': lib.CACHE_STATS, 'immutable': lib.immutable_source(WB),
                  'live_url_immutable': lib.immutable_source('https://x.test/roster')}))
`, { serverBody: BIG('live') });
    expect(r.immutable).toBe(true);
    expect(r.live_url_immutable).toBe(false);
    expect(r.state).toBe('FRESH');
    expect(r.capture).toBe(true);
    expect(r.hits).toBe(0);
    expect(r.stats.immutable).toBe(1);
  });

  it('12. use_cache=False still goes to the network and still records a timestamp', () => {
    const r = py(`
at(1_000_000)
put(SERVER, ${JSON.stringify(BIG('cached'))}, 1_000_000 - 60)
code, body = lib.fetch(SERVER, use_cache=False)
state, _ = lib.cache_state(SERVER)
print(json.dumps({'live': 'live' in body, 'hits': HITS['n'], 'state': state}))
`, { serverBody: BIG('live') });
    expect(r.live).toBe(true);
    expect(r.hits).toBe(1);
    expect(r.state).toBe('FRESH');
  });

  it('13. a second read inside the window does not hit the network twice', () => {
    // The property that makes a bulk run affordable: one request per URL per
    // run, however many stages ask for it.
    const r = py(`
at(1_000_000)
for _ in range(5): lib.fetch(SERVER)
print(json.dumps({'hits': HITS['n'], 'stats': lib.CACHE_STATS}))
`, { serverBody: BIG('live') });
    expect(r.hits).toBe(1);
    expect(r.stats['miss-fetched']).toBe(1);
    expect(r.stats.fresh).toBe(4);
  });
});
