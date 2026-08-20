/**
 * Palette 1 stylesheet, ported verbatim from the validated reference
 * implementation (docs/soccer-profile-tracked.html). Black builds the
 * environment, white carries the information, gold signals what matters —
 * do not redistribute the three colours.
 */
export const PROFILE_CSS = `

  :root {
    /* Palette 1 design tokens */
    --gold:            #F2B705;
    --white:           #FFFFFF;
    --charcoal:        #5A5A5A;
    --canvas:          #0B0E12;
    --surface:         #11151A;
    --surface-elevated:#171B20;
    --border:          #30353B;
    --text-primary:    #FFFFFF;
    --text-secondary:  #A8ADB5;
    --accent-soft:     rgba(242, 183, 5, 0.12);

    --display: "Archivo", system-ui, sans-serif;
    --body: "Inter", system-ui, sans-serif;
    --mono: "JetBrains Mono", ui-monospace, monospace;
  }

  * { box-sizing: border-box; }

  html, body {
    margin: 0;
    background: var(--canvas);
    color: var(--text-primary);
    font-family: var(--body);
    -webkit-font-smoothing: antialiased;
  }

  .wrap { max-width: 1020px; margin: 0 auto; padding: 0 22px 88px; }

  /* ---------- navigation ---------- */
  .topbar {
    display: flex; align-items: center; justify-content: space-between;
    gap: 18px; padding: 26px 0 30px;
  }
  .wordmark {
    font-family: var(--display); font-size: 21px;
    font-variation-settings: "wdth" 108, "wght" 800;
    letter-spacing: -0.01em; color: var(--white);
  }
  .wordmark span { color: var(--gold); }

  .addressed {
    font-family: var(--mono); font-size: 10px; color: var(--charcoal);
    letter-spacing: 0.06em; text-align: right; line-height: 1.7;
  }
  .addressed strong { color: var(--text-secondary); font-weight: 500; }

  /* ---------- section scaffolding ---------- */
  .section { margin-top: 64px; }
  .section-head {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 14px; flex-wrap: wrap;
    padding-bottom: 14px; margin-bottom: 22px;
    border-bottom: 1px solid var(--border);
  }
  h2 {
    margin: 0; font-family: var(--mono); font-size: 11px; font-weight: 700;
    letter-spacing: 0.2em; text-transform: uppercase; color: var(--text-primary);
  }
  .section-meta {
    font-family: var(--mono); font-size: 10px; color: var(--charcoal);
    letter-spacing: 0.04em;
  }

  /* ---------- 1 · identity ---------- */
  .badges { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 26px; }
  .badge {
    font-family: var(--mono); font-size: 9.5px; font-weight: 500;
    letter-spacing: 0.14em; text-transform: uppercase;
    padding: 6px 10px; border: 1px solid var(--border); color: var(--text-secondary);
  }
  .badge.status {
    color: var(--gold); border-color: var(--gold); background: var(--accent-soft);
    font-weight: 700;
  }

  h1 {
    margin: 0; font-family: var(--display);
    font-size: clamp(46px, 9.5vw, 92px); line-height: 0.87;
    font-variation-settings: "wdth" 104, "wght" 800;
    letter-spacing: -0.03em; color: var(--white);
  }

  .role {
    margin-top: 24px; display: grid; gap: 1px;
    background: var(--border); border: 1px solid var(--border);
    grid-template-columns: 1fr;
  }
  /* auto-fit rather than a fixed four: an athlete with two facts should not
     leave two dead cells beside them. */
  @media (min-width: 720px) { .role { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); } }
  .role-item { background: var(--surface); padding: 15px 17px; }
  .role-item dt {
    font-family: var(--mono); font-size: 9px; letter-spacing: 0.15em;
    text-transform: uppercase; color: var(--charcoal); margin-bottom: 8px;
  }
  .role-item dd {
    margin: 0; font-size: 14.5px; font-weight: 500; color: var(--text-primary);
    line-height: 1.35;
  }

  /* ---------- 2 · film ---------- */
  .player-frame {
    position: relative; aspect-ratio: 16 / 9; width: 100%;
    background: #000; border: 1px solid var(--border);
  }
  .player-frame iframe { width: 100%; height: 100%; border: 0; display: block; }

  .chapters {
    display: grid; gap: 1px; background: var(--border);
    border: 1px solid var(--border); border-top: 0;
  }
  @media (min-width: 660px) { .chapters { grid-template-columns: 1fr 1fr; } }
  .chapter {
    display: flex; align-items: center; gap: 13px; text-align: left;
    background: var(--surface); border: 0; border-left: 2px solid transparent;
    cursor: pointer; font-family: var(--body); font-size: 13.5px;
    color: var(--text-secondary); padding: 14px 16px;
    transition: background .14s ease, color .14s ease, border-color .14s ease;
  }
  .chapter:hover { background: var(--surface-elevated); color: var(--text-primary); }
  .chapter.active {
    border-left-color: var(--gold); background: var(--accent-soft);
    color: var(--text-primary);
  }
  .chapter time {
    font-family: var(--mono); font-size: 11px; font-weight: 500;
    color: var(--charcoal); flex-shrink: 0;
  }
  .chapter.active time, .chapter:hover time { color: var(--gold); }

  /* ---------- 3 · attributes ---------- */
  .stat-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr));
    gap: 1px; background: var(--border); border: 1px solid var(--border);
  }
  .stat { background: var(--surface); padding: 17px 18px; }
  .stat dt {
    font-family: var(--mono); font-size: 9px; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--charcoal); margin-bottom: 10px;
  }
  .stat dd {
    margin: 0; font-family: var(--display); font-size: 25px;
    font-variation-settings: "wdth" 98, "wght" 700;
    line-height: 1; color: var(--text-primary);
  }
  .stat dd em {
    font-style: normal; font-size: 11px; font-family: var(--mono);
    color: var(--charcoal); margin-left: 2px;
    font-variation-settings: normal;
  }
  /* gold reserved for the two numbers a coach scans for first */
  .stat.key dd { color: var(--gold); }

  .subhead {
    font-family: var(--mono); font-size: 9.5px; font-weight: 500;
    letter-spacing: 0.18em; text-transform: uppercase; color: var(--charcoal);
    margin: 34px 0 13px;
  }

  /* ---------- 4 · academics + contact ---------- */
  .split { display: grid; gap: 20px; grid-template-columns: 1fr; }
  @media (min-width: 720px) { .split { grid-template-columns: 1fr 1fr; } }

  .card {
    background: var(--surface); border: 1px solid var(--border); padding: 24px;
    transition: border-color .15s ease;
  }
  .card:hover { border-color: var(--charcoal); }
  .card h3 {
    margin: 0 0 18px; font-family: var(--mono); font-size: 9.5px; font-weight: 700;
    letter-spacing: 0.18em; text-transform: uppercase; color: var(--charcoal);
  }
  .row {
    display: flex; justify-content: space-between; align-items: baseline;
    gap: 16px; padding: 11px 0; border-bottom: 1px solid var(--border);
    font-size: 13.5px;
  }
  .row:last-child { border-bottom: 0; padding-bottom: 0; }
  .row dt { color: var(--text-secondary); }
  .row dd {
    margin: 0; font-family: var(--mono); font-size: 12px;
    color: var(--text-primary); text-align: right;
  }
  .card a {
    color: var(--text-primary); text-decoration: none;
    border-bottom: 1px solid var(--border);
    transition: color .14s ease, border-color .14s ease;
  }
  .card a:hover, .card a:focus-visible { color: var(--gold); border-bottom-color: var(--gold); }

  /* ---------- 5 · evaluation ---------- */
  .prose { max-width: 68ch; }
  .prose p {
    line-height: 1.75; color: var(--text-secondary); margin: 0 0 18px; font-size: 15.5px;
  }
  .prose p:last-child { margin-bottom: 0; }
  .prose strong { color: var(--text-primary); font-weight: 600; }

  footer {
    margin-top: 70px; padding-top: 24px; border-top: 1px solid var(--border);
    font-family: var(--mono); font-size: 10px; color: var(--charcoal); line-height: 1.9;
  }
  footer .wordmark { font-size: 13px; display: inline; }

  /* ---------- debug panel (development only) ---------- */
  #debug {
    position: fixed; right: 16px; bottom: 16px; width: 296px; max-width: calc(100vw - 32px);
    background: var(--surface-elevated); border: 1px solid var(--gold);
    font-family: var(--mono); font-size: 10.5px; color: var(--text-primary);
    z-index: 50; display: none;
  }
  #debug.on { display: block; }
  #debug header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 10px 12px; border-bottom: 1px solid var(--border);
    color: var(--gold); letter-spacing: 0.16em; font-size: 9px; font-weight: 700;
  }
  #debug header button {
    background: none; border: 0; color: var(--charcoal); cursor: pointer;
    font-family: var(--mono); font-size: 15px; line-height: 1; padding: 0;
  }
  .gauge { padding: 12px; border-bottom: 1px solid var(--border); }
  .gauge-row {
    display: flex; justify-content: space-between; padding: 3px 0;
    color: var(--text-secondary);
  }
  .gauge-row b { font-weight: 700; color: var(--gold); }
  .bar { height: 4px; background: var(--border); margin-top: 10px; }
  .bar i { display: block; height: 100%; width: 0; background: var(--gold); transition: width .2s ease; }
  #log { max-height: 136px; overflow-y: auto; padding: 10px 12px; line-height: 1.8; }
  #log div { color: var(--charcoal); }
  #log div b { color: var(--text-primary); font-weight: 500; }

  #debug-toggle {
    position: fixed; right: 16px; bottom: 16px; z-index: 49;
    background: var(--surface-elevated); color: var(--text-secondary);
    border: 1px solid var(--border);
    font-family: var(--mono); font-size: 9px; letter-spacing: 0.14em;
    padding: 10px 13px; cursor: pointer; transition: border-color .15s ease, color .15s ease;
  }
  #debug-toggle:hover { border-color: var(--gold); color: var(--gold); }

  :focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;
