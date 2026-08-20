import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { OUTLOOK_FROM_ADDRESS } from './config.js';

const run = promisify(execFile);

/**
 * Hands a message to the Outlook desktop app over AppleScript.
 *
 * Chosen over Graph and SMTP because it needs no OAuth, no Azure app
 * registration and no stored credentials — it drives the copy of Outlook the
 * user is already signed into. Values are passed as argv rather than
 * interpolated into the script, so a quote or newline in an email body cannot
 * break out into AppleScript.
 *
 * On the From address: `sender` is honoured by classic Outlook, but the New
 * Outlook build ignores it and uses the default account instead — and does so
 * silently. Sending recruiting mail from the wrong address is not a failure
 * worth discovering later, so the script reads back which account the composed
 * message is actually on and the caller compares it against what was asked for.
 */

const SCRIPT = `on run argv
  set theTo to item 1 of argv
  set theSubject to item 2 of argv
  set theBody to item 3 of argv
  set shouldSend to (item 4 of argv is "send")
  set fromAddress to item 5 of argv

  tell application "Microsoft Outlook"
    if fromAddress is "" then
      set msg to make new outgoing message with properties {subject:theSubject, content:theBody}
    else
      set msg to make new outgoing message with properties {subject:theSubject, content:theBody, sender:{address:fromAddress}}
    end if
    make new to recipient at msg with properties {email address:{address:theTo}}

    -- Opening it is also the only way to observe which account Outlook picked:
    -- the compose window is titled "<subject> • <account address>".
    open msg
    set actualFrom to ""
    try
      repeat with i from (count of windows) to 1 by -1
        set windowName to name of window i
        if windowName contains theSubject then
          set AppleScript's text item delimiters to " • "
          set parts to text items of windowName
          if (count of parts) > 1 then set actualFrom to last item of parts
          set AppleScript's text item delimiters to ""
          exit repeat
        end if
      end repeat
    end try

    if shouldSend then send msg
    return actualFrom
  end tell
end run`;

export function isOutlookAvailable() {
  return process.platform === 'darwin';
}

export async function composeInOutlook({ to, subject, body, send = false, from = OUTLOOK_FROM_ADDRESS }) {
  if (!isOutlookAvailable()) {
    throw new Error('Outlook automation is only available on macOS');
  }
  try {
    const { stdout } = await run(
      'osascript',
      ['-e', SCRIPT, to, subject, body, send ? 'send' : 'draft', from || ''],
      { timeout: 30_000 }
    );
    const actualFrom = stdout.trim();
    return {
      ok: true,
      sent: send,
      from: actualFrom || null,
      // Null when Outlook would not tell us; only a definite mismatch warns.
      fromMatches: !from || !actualFrom ? null : actualFrom.toLowerCase() === from.toLowerCase(),
    };
  } catch (err) {
    const detail = (err.stderr || err.message || '').trim();
    // -1743 is macOS refusing automation until the user grants permission in
    // System Settings > Privacy & Security > Automation.
    if (detail.includes('-1743') || detail.toLowerCase().includes('not authorised') || detail.toLowerCase().includes('not authorized')) {
      throw new Error(
        'macOS has not granted this app permission to control Outlook. '
        + 'Approve the prompt, or enable it under System Settings > Privacy & Security > Automation.'
      );
    }
    if (detail.includes("Can't get application") || detail.includes('-600')) {
      throw new Error('Outlook does not appear to be running. Open Microsoft Outlook and try again.');
    }
    throw new Error(detail || 'Outlook automation failed');
  }
}
