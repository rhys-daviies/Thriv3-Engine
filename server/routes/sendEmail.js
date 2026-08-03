/**
 * Stubbed per project scope: no real SMTP sender is wired up. Logs the
 * outgoing email server-side and returns a single mailto: link (To + CC)
 * so the caller can hand off to the user's mail client.
 */
export async function sendEmailStub({ to, cc = [], subject, body }) {
  const ccList = (cc || []).filter(Boolean);
  console.log(`\n[SendEmail stub] To: ${to}${ccList.length ? `\nCc: ${ccList.join(', ')}` : ''}\nSubject: ${subject}\n---\n${body}\n---\n`);

  const params = [];
  if (ccList.length) params.push(`cc=${ccList.map(encodeURIComponent).join(',')}`);
  params.push(`subject=${encodeURIComponent(subject)}`);
  params.push(`body=${encodeURIComponent(body)}`);

  const mailto = `mailto:${encodeURIComponent(to)}?${params.join('&')}`;
  return { status: 'logged', mailto };
}
