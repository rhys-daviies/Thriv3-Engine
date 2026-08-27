/**
 * Hand a generated file to the browser.
 *
 * The anchor is appended to the document before it is clicked and the object
 * URL is revoked on a timer rather than in the same tick. Both matter: a
 * detached anchor's programmatic click has historically been ignored, and
 * revoking synchronously can race the browser's own download start, which
 * produces a click that silently does nothing.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A filename that survives a school called `Saint Mary's (CA)`. */
export function slug(text) {
  return String(text ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report';
}
