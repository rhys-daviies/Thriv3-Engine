import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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
 * Default behaviour creates the message and opens it for review. Sending is
 * an explicit opt-in per call: nothing leaves the machine unless the caller
 * asked for it.
 */

const SCRIPT = `on run argv
  set theTo to item 1 of argv
  set theSubject to item 2 of argv
  set theBody to item 3 of argv
  set shouldSend to (item 4 of argv is "send")

  tell application "Microsoft Outlook"
    set msg to make new outgoing message with properties {subject:theSubject, content:theBody}
    make new to recipient at msg with properties {email address:{address:theTo}}
    if shouldSend then
      send msg
    else
      open msg
    end if
    -- Outlook's message id does not coerce to a plain value, and nothing here
    -- needs it; report the outcome instead.
    return "ok"
  end tell
end run`;

export function isOutlookAvailable() {
  return process.platform === 'darwin';
}

export async function composeInOutlook({ to, subject, body, send = false }) {
  if (!isOutlookAvailable()) {
    throw new Error('Outlook automation is only available on macOS');
  }
  try {
    await run('osascript', ['-e', SCRIPT, to, subject, body, send ? 'send' : 'draft'], { timeout: 30_000 });
    return { ok: true, sent: send };
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
