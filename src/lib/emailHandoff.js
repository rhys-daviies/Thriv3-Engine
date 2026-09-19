/**
 * HANDING ONE PREPARED EMAIL TO THE OPERATOR'S OWN MAIL CLIENT — R2B.
 *
 * ===========================================================================
 * THIS FILE COMPOSES NOTHING. IT IS A COURIER AND IT MUST STAY ONE.
 *
 * Every value it touches was built, validated and PERSISTED by the server —
 * see server/lib/emailHandoff.js, which reads them back out of the
 * `outreach_send` row that `recordDraft` wrote. The recipient, the subject,
 * the body, the HTML and the mailto URL all arrive finished. Nothing here
 * personalises, appends, substitutes, re-encodes or re-renders.
 *
 * That is not fastidiousness. The moment this file can produce a value that
 * the server did not, Thriv3 can report having sent one email while a coach
 * received another — and the entire manual workflow rests on the DRAFT row
 * being an honest record of what was handed over.
 * ===========================================================================
 *
 * ---------------------------------------------------------------------------
 * WHY A CLIPBOARD AND A KEYSTROKE RATHER THAN ONE CLICK.
 *
 * `mailto:` can carry a body — RFC 6068 defines the pseudo-header — and doing
 * that would remove the paste. It was measured instead of assumed: a real
 * Thriv3 email with four evidence sentences and the academic lines is 1,355
 * characters, which is a 2,007-character mailto URL. Two thousand is the safe
 * ceiling across browsers and OS URL handlers, so a realistic email is
 * already past it, and the failure is SILENT TRUNCATION of the END of the
 * body — where the CAN-SPAM footer lives.
 *
 * RFC 6068 also caps the fidelity: the body value is "the content for the
 * first TEXT/PLAIN body part", and Content-* headers "MUST be ignored". So
 * the URL could never carry the HTML, and the profile link and the WhatsApp
 * `tel:` link would arrive in front of a coach as literal markdown.
 *
 * The clipboard has neither limit. `ClipboardItem` carries text/html AND
 * text/plain at once, a mail composer takes the HTML flavour, and the coach
 * receives exactly what the macOS AppleScript path produces — same anchors,
 * same paragraph spacing, from the same `textToHtml`. One extra keystroke
 * buys all of that.
 * ---------------------------------------------------------------------------
 *
 * IT NEVER READS THE CLIPBOARD. Writing needs a user gesture and a secure
 * context, which a button click on an HTTPS deployment has. Reading needs a
 * permission prompt and would let this page see whatever the operator last
 * copied, for no gain whatsoever.
 */

/**
 * HOW MUCH OF THE EMAIL ACTUALLY REACHED THE CLIPBOARD.
 *
 * Three outcomes, not two, because "it failed" and "it worked in a reduced
 * way" need different sentences on screen. A plain-text copy is a working
 * handoff with one visible loss — the `tel:` link arrives as markdown text —
 * and telling the operator it failed would send them hunting for a problem
 * they do not have.
 */
export const HANDOFF_RESULT = Object.freeze({
  /** text/html and text/plain both written. Full fidelity. */
  RICH: 'RICH',
  /** text/plain only. Links arrive bare; most clients auto-link them. */
  PLAIN: 'PLAIN',
  /** Nothing reached the clipboard. The UI must show the body to copy by hand. */
  MANUAL: 'MANUAL',
});

/**
 * Can this browser put HTML on the clipboard?
 *
 * `ClipboardItem.supports` is the documented way to ask and is the reason it
 * is asked rather than assumed — but it is newer than `ClipboardItem` itself,
 * so an implementation that has the constructor and not the method is treated
 * as "try it and see". An optimistic attempt costs a caught exception; a
 * pessimistic assumption costs every operator on that browser the rich paste.
 */
function canWriteHtml() {
  if (typeof ClipboardItem === 'undefined') return false;
  if (typeof ClipboardItem.supports !== 'function') return true;
  try {
    return ClipboardItem.supports('text/html') && ClipboardItem.supports('text/plain');
  } catch {
    return true;
  }
}

function clipboard() {
  return (typeof navigator !== 'undefined' && navigator.clipboard) || null;
}

/**
 * Put the email on the clipboard, as richly as this browser allows.
 *
 * THREE LAYERS, EACH A REAL DEGRADATION RATHER THAN AN ERROR. Rich, then
 * plain, then nothing — and "nothing" is a reported status, not a thrown
 * exception, because the caller has a perfectly good answer for it (show the
 * body and let the operator select it) and an exception would turn a
 * recoverable state into a broken screen.
 *
 * `text/plain` is written alongside `text/html` in the rich case and is not
 * redundant: a plain-text composer, a terminal, or a paste into a notes app
 * takes that flavour, and without it those paste nothing at all.
 */
export async function copyEmail(handoff) {
  const api = clipboard();
  if (!api) return { status: HANDOFF_RESULT.MANUAL, error: 'No clipboard access.' };

  const body = String(handoff?.body ?? '');
  const html = String(handoff?.bodyHtml ?? '');

  if (html && canWriteHtml() && typeof api.write === 'function') {
    try {
      await api.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([body], { type: 'text/plain' }),
      })]);
      return { status: HANDOFF_RESULT.RICH, error: null };
    } catch {
      // Falls through. A refused rich write is common enough — Firefox, a
      // locked-down policy, a non-secure context in development — that it is
      // a branch rather than a failure.
    }
  }

  if (typeof api.writeText === 'function') {
    try {
      await api.writeText(body);
      return { status: HANDOFF_RESULT.PLAIN, error: null };
    } catch (err) {
      return { status: HANDOFF_RESULT.MANUAL, error: err?.message ?? null };
    }
  }

  return { status: HANDOFF_RESULT.MANUAL, error: 'No clipboard access.' };
}

/**
 * Copy the email, then open the operator's own mail application.
 *
 * ---------------------------------------------------------------------------
 * THE URL IS THE SERVER'S. It is not assembled here, and this file never
 * appends a parameter to it. `mailtoUrl` carries one recipient and a subject
 * and nothing else — no body, no cc, no bcc, no headers — and the server
 * refused the address outright if it carried a character that is structural
 * in a URI. Building it here would move that decision to the least trusted
 * place in the system.
 * ---------------------------------------------------------------------------
 *
 * THE COPY HAPPENS FIRST, AND IT IS AWAITED. A clipboard write needs the user
 * gesture that started this call; navigating first risks losing it. The
 * navigation is a `mailto:`, which hands off to the OS rather than unloading
 * the page, so the dialog and its pending-confirmation section survive it —
 * and `window.open` is deliberately not used, because a second one in a loop
 * is what popup blockers exist to stop.
 *
 * IT OPENS EVEN WHEN THE COPY FAILED. The operator still wants the compose
 * window with the address and subject in it; the UI tells them the body did
 * not copy and shows it instead. Refusing to open would take away the half
 * that worked.
 *
 * @returns {{status, opened, error}} `status` is a HANDOFF_RESULT.
 */
export async function openInEmail(handoff) {
  const result = await copyEmail(handoff);

  const url = handoff?.mailtoUrl;
  if (!url) return { ...result, opened: false };

  try {
    window.location.href = url;
    return { ...result, opened: true };
  } catch (err) {
    return { ...result, opened: false, error: result.error ?? err?.message ?? null };
  }
}
