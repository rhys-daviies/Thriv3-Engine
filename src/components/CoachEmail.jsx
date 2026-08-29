import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

/**
 * A coach's address, visible and copyable — and deliberately not a mail link.
 *
 * This used to be `<a href="mailto:…">`. One click opened the operator's own
 * mail client with the coach in the To field, and any message sent from there
 * bypassed every guarantee the outreach path exists to provide: no suppression
 * check, so somebody who had opted out could be written to again; no per-inbox
 * send cap; no tracking token, so the engagement data would show the coach as
 * never contacted; and no evidence derived or logged, so the personalisation
 * measurement would be quietly wrong about its own denominator.
 *
 * The address is still shown in full and is one click from the clipboard —
 * looking a contact up is a legitimate thing to want. What is gone is the
 * one-click route to sending outside the system. Coach outreach goes through
 * `sendOutreach`, which is the only place all five checks live.
 */
export default function CoachEmail({ email, className = '' }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  // Cleared on unmount: the card can be closed inside the two seconds, and a
  // setState afterwards is a React warning nobody will chase down.
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused (insecure origin, denied permission).
      // Selecting the text is the fallback, and the address is already on
      // screen — so this stays silent rather than throwing an error at
      // somebody who only wanted to read it.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={copied ? 'Copied' : `Copy ${email}`}
      aria-label={copied ? `${email} copied to clipboard` : `Copy ${email}`}
      className={`group inline-flex max-w-full items-center gap-1 rounded text-accent hover:underline ${className}`}
    >
      <span className="truncate">{email}</span>
      {copied
        ? <Check className="h-3 w-3 shrink-0 text-emerald-500" aria-hidden="true" />
        : <Copy className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" aria-hidden="true" />}
      <span className="sr-only" role="status">{copied ? 'Copied' : ''}</span>
    </button>
  );
}
