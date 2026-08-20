/**
 * The neutral page shown when a link is no longer live.
 *
 * Brief §7: a revoked token renders this — not a 404, and not the profile.
 * It carries no athlete name, no school and no hint about which of the
 * possible reasons applies, so it cannot be used to work out whether a given
 * slug ever existed or who it belonged to. Every non-serving case returns it
 * with a 200 for the same reason.
 */
export function renderRevokedPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Profile unavailable — Thriv3</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..125,400..900&family=Inter:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --gold: #F2B705; --canvas: #0B0E12; --surface: #11151A;
    --border: #30353B; --text-primary: #FFFFFF; --text-secondary: #A8ADB5;
    --charcoal: #5A5A5A;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; min-height: 100vh; background: var(--canvas); color: var(--text-primary);
    font-family: "Inter", system-ui, sans-serif; -webkit-font-smoothing: antialiased;
  }
  .shell {
    min-height: 100vh; display: flex; flex-direction: column;
    align-items: center; justify-content: center; padding: 32px; text-align: center;
  }
  .wordmark {
    font-family: "Archivo", system-ui, sans-serif; font-size: 21px;
    font-variation-settings: "wdth" 108, "wght" 800; letter-spacing: -0.01em;
    margin-bottom: 40px;
  }
  .wordmark span { color: var(--gold); }
  .card {
    background: var(--surface); border: 1px solid var(--border);
    padding: 40px 36px; max-width: 460px;
  }
  h1 {
    margin: 0 0 14px; font-family: "Archivo", system-ui, sans-serif;
    font-size: 24px; font-variation-settings: "wdth" 104, "wght" 700;
    letter-spacing: -0.01em;
  }
  p { margin: 0; color: var(--text-secondary); font-size: 14.5px; line-height: 1.7; }
  footer {
    margin-top: 36px; font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: 10px; color: var(--charcoal); letter-spacing: 0.04em;
  }
</style>
</head>
<body>
  <div class="shell">
    <div class="wordmark">Thriv<span>3</span></div>
    <div class="card">
      <h1>This profile is no longer shared</h1>
      <p>
        The link you followed is not active. If it was sent to you recently and you
        think it should still work, replying to that message is the quickest way to
        reach the athlete's representative.
      </p>
    </div>
    <footer>Thriv3 · athlete representation</footer>
  </div>
</body>
</html>
`;
}
