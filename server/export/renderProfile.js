import { describeAttributes } from '../../shared/sportProfiles.js';
import { positionLabel } from '../../shared/positions.js';
import { formatTimecode } from '../../shared/timecode.js';
import { PROFILE_CSS } from './styles.js';
import { TRACKER_JS } from './tracker.js';
import { classYearOf } from '../../shared/athlete.js';

/**
 * Renders one athlete into a self-contained public profile page.
 *
 * The page carries NO coach data. It reads the ?ref= token from the query
 * string and echoes it back to the collector; coach identity is resolved on
 * our own machine and never published. Anyone holding the link sees the page,
 * so nothing goes on it beyond what the representation agreement covers.
 */

const REQUIRED_CORE = [
  { key: 'full_name', label: 'name', test: (a) => present(a.full_name) },
  { key: 'position', label: 'position', test: (a) => present(a.position) },
  // Reads the resolver, not the column: the form asks for recruiting class
  // year and this used to demand graduation_year, so an athlete could be
  // created, matched and drafted and then fail to publish on a field nothing
  // had asked them for.
  // Named for the field the form actually asks for. "class year" was
  // ambiguous while there were two of them, and the publish card prints this
  // string straight to the operator — "needs class year" sent you looking for
  // a field that no longer exists.
  { key: 'recruiting_class_year', label: 'recruiting class year', test: (a) => present(classYearOf(a)) },
  { key: 'video_id', label: 'video', test: (a) => present(a.video_id) },
  { key: 'email', label: 'contact email', test: (a) => present(a.email) },
];

function present(value) {
  return value !== null && value !== undefined && value !== '';
}

function chaptersOf(athlete) {
  const raw = athlete.video_chapters;
  const list = typeof raw === 'string' ? safeJson(raw, []) : raw || [];
  return list
    .filter((c) => c && Number.isFinite(Number(c.t)) && present(c.label))
    .map((c) => ({ t: Number(c.t), label: String(c.label) }))
    .sort((a, b) => a.t - b.t);
}

function safeJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Returns the list of missing required-core items. Export refuses while this
 * is non-empty — a half-populated page sent to a college coach is worse than
 * no page at all.
 */
/** What a profile needs before it can be generated, for anything that lists them. */
export const REQUIRED_CORE_LABELS = REQUIRED_CORE.map((item) => item.label);

export function checkRequiredCore(athlete) {
  return REQUIRED_CORE.filter((item) => !item.test(athlete)).map((item) => item.label);
}

// --- fragment builders. Each returns '' when it has nothing to show, so a
// --- missing value omits its row or block entirely rather than rendering "N/A".

function row(label, value, { href = null, mono = true } = {}) {
  if (!present(value)) return '';
  const inner = href ? `<a href="${esc(href)}">${esc(value)}</a>` : esc(value);
  return `<div class="row"><dt>${esc(label)}</dt><dd${mono ? '' : ' style="font-family:var(--body)"'}>${inner}</dd></div>`;
}

function card(title, rows) {
  const body = rows.filter(Boolean).join('\n          ');
  if (!body) return '';
  return `<div class="card">
        <h3>${esc(title)}</h3>
        <dl style="margin:0">
          ${body}
        </dl>
      </div>`;
}

function badges(athlete) {
  const items = [];
  if (present(athlete.commitment_status)) {
    items.push(`<span class="badge status">${esc(athlete.commitment_status)}</span>`);
  }
  items.push(`<span class="badge">Class of ${esc(classYearOf(athlete))}</span>`);
  if (present(athlete.ncaa_eligibility_id)) items.push('<span class="badge">NCAA ID verified</span>');
  if (present(athlete.nationality)) items.push(`<span class="badge">${esc(athlete.nationality)}</span>`);
  return `<div class="badges">${items.join('\n      ')}</div>`;
}

function roleGrid(athlete) {
  const items = [
    ['Position', [athlete.position, athlete.secondary_position !== 'None' ? athlete.secondary_position : null].filter(present).join(' / ')],
    ['Current club', athlete.club_name],
    ['Nationality', athlete.nationality],
    ['Available', present(classYearOf(athlete)) ? `${classYearOf(athlete)} entry` : null],
  ]
    .filter(([, value]) => present(value))
    .map(([label, value]) => `<div class="role-item"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`);
  return items.length ? `<dl class="role">${items.join('\n      ')}</dl>` : '';
}

function filmSection(athlete, chapters) {
  // Chapters are optional. A highlight reel is already the edit — labelled
  // clips only earn their place on longer footage a coach needs to navigate.
  // With none, the strip is omitted rather than rendered as an empty bordered
  // box under the player.
  const chapterList = chapters.length
    ? `

    <div class="chapters">
      ${chapters
        .map(
          (c) =>
            `<button class="chapter" data-t="${c.t}" data-label="${esc(c.label)}">`
            + `<time>${formatTimecode(c.t)}</time>${esc(c.label)}</button>`
        )
        .join('\n      ')}
    </div>`
    : '';

  const parts = [];
  if (present(athlete.updated_date)) {
    parts.push(`Updated ${new Date(athlete.updated_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`);
  }
  if (chapters.length) parts.push(`${chapters.length} clip${chapters.length === 1 ? '' : 's'}`);
  const meta = parts.join(' · ');

  return `<section class="section">
    <div class="section-head">
      <h2>Highlight Film</h2>
      ${meta ? `<div class="section-meta">${esc(meta)}</div>` : ''}
    </div>

    <div class="player-frame">
      <div id="yt-player"></div>
    </div>${chapterList}
  </section>`;
}

function attributesSection(athlete) {
  const groups = describeAttributes(athlete.sport, athlete.sport_attributes);
  const physical = [
    ['Height', athlete.height_cm, 'cm'],
    ['Weight', athlete.weight_kg, 'kg'],
  ].filter(([, value]) => present(value));

  if (groups.length === 0 && physical.length === 0) return '';

  const blocks = [];

  if (physical.length || groups.length) {
    const first = groups[0];
    const stats = [
      ...physical.map(([label, value, unit]) => statCell(label, value, unit, false)),
      ...(first ? first.fields.map((f) => statCell(f.label, f.value, f.unit, f.emphasis)) : []),
    ];
    blocks.push(
      `<div class="subhead">${esc(first ? first.label : 'Physical')}</div>`
      + `\n    <dl class="stat-grid">${stats.join('')}</dl>`
    );
  }

  for (const group of groups.slice(1)) {
    const stats = group.fields.map((f) => statCell(f.label, f.value, f.unit, f.emphasis));
    blocks.push(`<div class="subhead">${esc(group.label)}</div>\n    <dl class="stat-grid">${stats.join('')}</dl>`);
  }

  return `<section class="section">
    <div class="section-head">
      <h2>Player Attributes</h2>
    </div>

    ${blocks.join('\n\n    ')}
  </section>`;
}

function statCell(label, value, unit, emphasis) {
  const unitMarkup = unit ? `<em>${esc(unit)}</em>` : '';
  return `<div class="stat${emphasis ? ' key' : ''}"><dt>${esc(label)}</dt><dd>${esc(value)}${unitMarkup}</dd></div>`;
}

function academicsAndContact(athlete) {
  const academics = card('Academic record', [
    row('GPA', athlete.gpa),
    row('SAT', athlete.sat_score),
    row('ACT', athlete.act_score),
    row('NCAA Eligibility ID', athlete.ncaa_eligibility_id),
    row('Intended major', athlete.intended_major),
  ]);

  const contact = card('Contact', [
    row('Athlete', athlete.full_name, { href: `mailto:${athlete.email}` }),
    row('Guardian', athlete.guardian_name, athlete.guardian_email ? { href: `mailto:${athlete.guardian_email}` } : {}),
    row('Club coach', athlete.club_coach_name, athlete.club_coach_email ? { href: `mailto:${athlete.club_coach_email}` } : {}),
    row('Phone', athlete.phone),
    row('Time zone', athlete.time_zone),
    row('Best contact window', athlete.best_contact_window),
  ]);

  if (!academics && !contact) return '';
  return `<section class="section">
    <div class="section-head">
      <h2>Academics &amp; Contact</h2>
      <div class="section-meta">Eligibility documents available on request</div>
    </div>

    <div class="split">
      ${[academics, contact].filter(Boolean).join('\n\n      ')}
    </div>
  </section>`;
}

function evaluationSection(athlete) {
  if (!present(athlete.evaluation)) return '';
  const paragraphs = String(athlete.evaluation)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join('\n      ');

  return `<section class="section">
    <div class="section-head">
      <h2>Evaluation</h2>
      <div class="section-meta">Independent assessment · Thriv3 analyst</div>
    </div>

    <div class="prose">
      ${paragraphs}
    </div>
  </section>`;
}

export function renderProfile(athlete, { endpoint = '/api/track', dryRun = false } = {}) {
  const missing = checkRequiredCore(athlete);
  if (missing.length) {
    throw new Error(
      `Cannot export "${athlete.full_name || athlete.id}" — missing required core: ${missing.join(', ')}`
    );
  }

  const chapters = chaptersOf(athlete);
  const config = {
    videoId: athlete.video_id,
    athleteId: athlete.id,
    endpoint,
    dryRun,
    // Server-rendered prior qualified visits are not knowable in a static
    // file. Visit numbering is authoritative at the rollup layer, which counts
    // distinct sessions containing visit_qualified.
    priorVisits: 0,
  };

  const title = `${athlete.full_name} — ${positionLabel(athlete.position)} — Class of ${classYearOf(athlete)} — Thriv3`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75..125,400..900&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>${PROFILE_CSS}</style>
</head>
<body>

<div class="wrap">

  <nav class="topbar">
    <div class="wordmark">Thriv<span>3</span></div>
  </nav>

  <section>
    ${badges(athlete)}

    <h1>${esc(athlete.full_name).replace(/\s+(?=\S+$)/, '<br>')}</h1>

    ${roleGrid(athlete)}
  </section>

  ${filmSection(athlete, chapters)}

  ${attributesSection(athlete)}

  ${academicsAndContact(athlete)}

  ${evaluationSection(athlete)}

  <footer>
    Shared by ${esc(athlete.full_name)} via <span class="wordmark">Thriv<span>3</span></span>. This page
    records which film segments are viewed so the athlete knows their material reached you —
    see the <a href="/privacy">privacy notice</a>. Reply directly to the contacts above.
  </footer>
</div>

<button id="debug-toggle" type="button">Show tracking</button>

<div id="debug" aria-live="polite">
  <header>
    <span>ENGAGEMENT SIGNAL</span>
    <button type="button" id="debug-close" aria-label="Hide tracking panel">&times;</button>
  </header>
  <div class="gauge">
    <div class="gauge-row"><span>Visit</span><b id="g-visit">#1</b></div>
    <div class="gauge-row"><span>Status</span><b id="g-qual">unverified</b></div>
    <div class="gauge-row"><span>Coverage</span><b id="g-cov">0%</b></div>
    <div class="gauge-row"><span>Watched</span><b id="g-sec">0s</b></div>
    <div class="gauge-row"><span>Rewinds</span><b id="g-rew">0</b></div>
    <div class="gauge-row"><span>Skips</span><b id="g-skip">0</b></div>
    <div class="bar"><i id="g-bar"></i></div>
  </div>
  <div id="log"><div>Waiting for playback…</div></div>
</div>

<script>
const CONFIG = Object.assign(
  ${JSON.stringify(config, null, 2).replace(/</g, '\\u003c')},
  { token: new URLSearchParams(location.search).get("ref") || null }
);
${TRACKER_JS}
</script>
</body>
</html>
`;
}
