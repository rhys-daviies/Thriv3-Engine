import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

/**
 * WHERE UPLOADED FILES GO, AND WHAT THEY MAY BE CALLED.
 *
 * One home for both, because the vulnerability this module exists to close was
 * a filename decision made inline in a route: `POST /api/uploads` built its
 * stored path as `${randomUUID()}-${req.file.originalname}` and handed it
 * straight to `path.join`. The UUID prefix absorbs exactly one `..` segment,
 * which makes the flaw look contained and is not:
 *
 *   '../../evil.json'        -> <root>/server/uploads/evil.json   contained
 *   '../../../evil.json'     -> <root>/server/evil.json           ESCAPES
 *   '../../../../etc/passwd' -> <root>/etc/passwd                 ESCAPES
 *   'a/../../../evil.json'   -> <root>/evil.json                  ESCAPES
 *
 * `server/data/recruitmatch.sqlite` is two levels above the store, so it was
 * reachable. A prefix is not a boundary.
 *
 * THE INVARIANT: every file accepted by the upload endpoint is written inside
 * this directory, whatever the client called it. It is held twice over — the
 * name is reduced to a flat, URL-safe basename, and the resolved destination is
 * then checked for containment before anything is written. The second check is
 * unreachable while the first is correct, which is exactly why it is there.
 *
 * The read side has its own, separate guard: `resolveAnalysisPath` in
 * campaigns.js refuses any stored pointer that is not a flat name under this
 * directory. Neither guard makes the other redundant — one governs what we
 * write, the other what we are willing to open.
 */

/**
 * THRIV3_UPLOADS_DIR points the test suite at a throwaway directory, the same
 * arrangement THRIV3_BUILD_DIR makes for generated pages: a test that writes a
 * fixture upload must not leave it in the store the product reads.
 *
 * Resolved to absolute here so every containment check below compares like
 * with like, whatever the process's working directory happens to be.
 */
export const UPLOADS_DIR = path.resolve(
  process.env.THRIV3_UPLOADS_DIR
  || fileURLToPath(new URL('../uploads', import.meta.url)),
);

/** The prefix every stored `file_url` carries, and the static mount serving it. */
export const UPLOAD_URL_PREFIX = '/uploads/';

/**
 * Long enough to keep a recognisable name, short enough that the whole
 * filename stays inside the 255-byte limit every filesystem here imposes —
 * the UUID and its separator already account for 37 characters.
 */
const MAX_SUFFIX_LENGTH = 120;

/** Both separators, always. A POSIX host still receives Windows-shaped names. */
const ANY_SEPARATOR = /[/\\]/;

/** Control characters, including NUL, which can truncate a path in a syscall. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/**
 * Everything outside this set becomes an underscore.
 *
 * Not only a security measure. The stored name is handed back as
 * `/uploads/<name>` and the browser fetches that URL directly
 * (src/pages/player/PlayerWorkspace.jsx), so a `#` would truncate the request,
 * a `?` would start a query string and a `%` would open an escape sequence.
 * Restricting to URL-safe characters fixes a real breakage class as well as a
 * traversal one.
 */
const UNSAFE_CHARS = /[^A-Za-z0-9._-]/g;

/**
 * A stored filename that cannot contain directory structure, whatever it was
 * called on the way in.
 *
 * STRUCTURAL, NOT A DENYLIST. It takes the last segment under either
 * separator and then keeps only characters that cannot mean anything to a path
 * or a URL — so there is no `../` spelling to catch, and no need to have
 * anticipated one. `..`, `.`, `.env` and a bare `.hidden` all lose their
 * leading dots and become the UUID alone or a plain name.
 *
 * The UUID prefix is for uniqueness, NOT for safety. Every property this
 * function guarantees holds with the prefix removed.
 */
export function safeUploadFilename(originalName) {
  const raw = typeof originalName === 'string' ? originalName : '';

  // The last segment under BOTH separators. `path.basename` only understands
  // the host's, so on Linux it would return the whole of 'a\\..\\..\\evil'.
  const segment = raw.split(ANY_SEPARATOR).pop() ?? '';

  const suffix = segment
    .replace(CONTROL_CHARS, '')
    .replace(UNSAFE_CHARS, '_')
    // No leading dots: this is what turns '.', '..' and '.env' into a name
    // with no special meaning to a shell, a server or a path resolver.
    .replace(/^\.+/, '')
    .slice(0, MAX_SUFFIX_LENGTH);

  // An empty suffix is not an error — a file called '..' is simply one we will
  // store under a generated name.
  return suffix ? `${randomUUID()}-${suffix}` : randomUUID();
}

/**
 * Where a client-supplied filename is allowed to be written, with the
 * containment proved rather than assumed.
 *
 * The throw is unreachable while `safeUploadFilename` is correct. That is the
 * point of it: if somebody later relaxes the sanitiser, this fails closed
 * instead of writing outside the store.
 *
 * @returns {{filename: string, destination: string, fileUrl: string}}
 */
export function resolveUploadDestination(originalName) {
  const filename = safeUploadFilename(originalName);
  const destination = path.resolve(UPLOADS_DIR, filename);

  if (path.dirname(destination) !== UPLOADS_DIR
      || path.basename(destination) !== filename
      || !destination.startsWith(UPLOADS_DIR + path.sep)) {
    throw new Error(`Refusing to write outside the upload store: ${JSON.stringify(originalName)}`);
  }

  return { filename, destination, fileUrl: `${UPLOAD_URL_PREFIX}${filename}` };
}
