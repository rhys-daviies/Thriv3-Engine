/**
 * The two pages a recipient can reach from a recruiting email.
 *
 * In shared/ rather than in the Worker because the local Express server serves
 * the same pages during a dry run, and a legal notice that differs between
 * the copy you tested and the copy a coach reads is not a notice.
 *
 * Plain HTML, no external anything: these load inside corporate mail gateways
 * that strip scripts and block third-party fonts.
 */

const SHELL = (title, body) => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; padding:2.5rem 1.25rem; background:#0b0e11; color:#e8eaed;
         font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  main { max-width:34rem; margin:0 auto; }
  h1 { font-size:1.35rem; margin:0 0 1rem; }
  h2 { font-size:1rem; margin:1.75rem 0 .4rem; }
  p, li { color:#c2c7cd; }
  a { color:#f2b705; }
  .brand { font-weight:700; letter-spacing:.02em; margin-bottom:1.75rem; color:#f2b705; }
  button { font:inherit; font-weight:600; padding:.7rem 1.2rem; border-radius:.5rem;
           border:0; background:#f2b705; color:#14171a; cursor:pointer; }
  .quiet { color:#8b9299; font-size:.875rem; }
</style>
</head><body><main><p class="brand">Thriv3</p>${body}</main></body></html>`;

/** Shown when the link is opened. Nothing has been recorded yet. */
export function renderUnsubscribeConfirm({ actionPath }) {
  return SHELL('Unsubscribe — Thriv3', `
<h1>Stop receiving these emails?</h1>
<p>You will not be contacted again about any athlete, by anyone using Thriv3.</p>
<form method="POST" action="${actionPath}">
  <button type="submit">Yes, unsubscribe me</button>
</form>
<p class="quiet">Nothing has changed yet — this takes effect when you confirm.</p>`);
}

/** Shown after the POST. Also shown for an already-suppressed token. */
export function renderUnsubscribeDone() {
  return SHELL('Unsubscribed — Thriv3', `
<h1>Done — you have been unsubscribed</h1>
<p>Your address has been added to our suppression list. It applies to every
athlete, not just the one who contacted you.</p>
<p class="quiet">If you receive anything further, reply to it and it will be
dealt with directly.</p>`);
}

/** Shown for a token that is not recognised, without saying which it was. */
export function renderUnsubscribeUnknown() {
  return SHELL('Unsubscribe — Thriv3', `
<h1>This link is no longer active</h1>
<p>It may already have been used, or the outreach it belonged to may have
ended. Either way you will not be contacted through it again.</p>
<p class="quiet">To be certain, reply to the email you received and ask to be
removed.</p>`);
}

/**
 * The privacy notice.
 *
 * Written because the profile page footer already promised one — "described in
 * our privacy notice" — and there was no notice and no link. A dangling
 * reference to a document that does not exist is worse than saying nothing:
 * it claims a disclosure has been made when it has not.
 */
export function renderPrivacyNotice({ senderIdentity, postalAddress, contactEmail } = {}) {
  const who = senderIdentity || 'Thriv3';
  return SHELL('Privacy notice — Thriv3', `
<h1>Privacy notice</h1>
<p>This page explains what ${who} records when a coach opens an athlete's
profile, and why.</p>

<h2>What is recorded</h2>
<ul>
  <li>That a profile link was opened, and when.</li>
  <li>Which sections of the page were viewed, and which parts of the highlight
      film were watched.</li>
  <li>An opaque token identifying which outreach the link came from.</li>
</ul>

<h2>What is not recorded</h2>
<ul>
  <li>No name, email address or organisation is stored on the page you opened.
      The token is a random string and carries no identity of its own.</li>
  <li>No advertising or analytics service is involved. Nothing is shared with
      any third party.</li>
  <li>No cookies are set.</li>
</ul>

<h2>Why</h2>
<p>So the athlete knows their material reached you. Coaches rarely reply to
every message, and without this an athlete cannot tell an unread email from a
considered no.</p>

<h2>Your choices</h2>
<p>You can opt out of all future contact using the link at the foot of any
email you have received. It applies across every athlete, not just the one who
wrote to you. You may also ask for the record of your visits to be deleted, by
replying to the email or writing to the address below.</p>

<h2>Contact</h2>
<p>${who}${contactEmail ? ` — <a href="mailto:${contactEmail}">${contactEmail}</a>` : ''}<br>
${postalAddress || ''}</p>`);
}
