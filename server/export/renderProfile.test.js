import { describe, it, expect } from 'vitest';
import { renderProfile, checkRequiredCore, REQUIRED_CORE_LABELS } from './renderProfile.js';

const COMPLETE = {
  id: 'ath-1',
  full_name: 'Nikau Brennan',
  position: 'Left Winger',
  secondary_position: 'None',
  graduation_year: 2027,
  video_id: 'aqz-KE-bpKQ',
  email: 'athlete@example.com',
  sport: 'mens-soccer',
  video_chapters: [
    { t: 18, label: '1v1 isolation' },
    { t: 66, label: 'Half-turn under pressure' },
    { t: 122, label: 'Counter-press' },
  ],
};

describe('required core', () => {
  it('passes a complete athlete', () => {
    expect(checkRequiredCore(COMPLETE)).toEqual([]);
  });

  it.each([
    ['name', { full_name: '' }, 'name'],
    ['position', { position: null }, 'position'],
    ['class year', { graduation_year: null, recruiting_class_year: null }, 'recruiting class year'],
    ['video', { video_id: null }, 'video'],
    ['contact email', { email: null }, 'contact email'],
  ])('reports a missing %s', (_label, override, expected) => {
    expect(checkRequiredCore({ ...COMPLETE, ...override })).toContain(expected);
  });

  it('does not require chapters — a highlight reel is already the edit', () => {
    expect(checkRequiredCore({ ...COMPLETE, video_chapters: [] })).toEqual([]);
    expect(checkRequiredCore({ ...COMPLETE, video_chapters: undefined })).toEqual([]);
  });

  it('refuses to render rather than emitting a half-populated page', () => {
    expect(() => renderProfile({ ...COMPLETE, video_id: null }))
      .toThrow(/missing required core: video/);
  });
});

describe('rendered page', () => {
  const html = renderProfile(COMPLETE, { endpoint: 'https://collector.example/api/track' });

  it('stays out of search indexes', () => {
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it('carries no token — the page reads ?ref= at runtime', () => {
    expect(html).toContain('new URLSearchParams(location.search).get("ref")');
    expect(html).not.toMatch(/"token"\s*:\s*"[A-Za-z0-9]{32}"/);
  });

  it('injects the configured endpoint and leaves dry run off', () => {
    expect(html).toContain('https://collector.example/api/track');
    expect(html).toContain('"dryRun": false');
  });

  it('gives each chapter a clean data-label, free of the timecode', () => {
    expect(html).toContain('data-t="18" data-label="1v1 isolation"');
    expect(html).toContain('<time>0:18</time>1v1 isolation');
    expect(html).toContain('<time>2:02</time>');
  });

  it('orders chapters by timestamp regardless of input order', () => {
    const shuffled = renderProfile({
      ...COMPLETE,
      video_chapters: [{ t: 122, label: 'C' }, { t: 18, label: 'A' }, { t: 66, label: 'B' }],
    });
    expect(shuffled.indexOf('data-label="A"')).toBeLessThan(shuffled.indexOf('data-label="B"'));
    expect(shuffled.indexOf('data-label="B"')).toBeLessThan(shuffled.indexOf('data-label="C"'));
  });

  it('escapes athlete-supplied text', () => {
    const nasty = renderProfile({ ...COMPLETE, club_name: '<script>alert(1)</script>' });
    expect(nasty).not.toContain('<script>alert(1)</script>');
    expect(nasty).toContain('&lt;script&gt;');
  });
});

describe('chapters are optional', () => {
  it('omits the chapter strip entirely when there are none', () => {
    const html = renderProfile({ ...COMPLETE, video_chapters: [] });
    expect(html).not.toContain('class="chapters"');
    expect(html).toContain('Highlight Film');
    expect(html).toContain('id="yt-player"');
  });

  it('renders the strip as soon as there is one', () => {
    const html = renderProfile({ ...COMPLETE, video_chapters: [{ t: 18, label: 'Only clip' }] });
    expect(html).toContain('class="chapters"');
    expect(html).toContain('data-label="Only clip"');
  });

  it('drops malformed chapter entries rather than rendering them', () => {
    const html = renderProfile({
      ...COMPLETE,
      video_chapters: [{ t: 18, label: 'Good' }, { t: 20 }, { label: 'No time' }],
    });
    expect(html).toContain('data-label="Good"');
    expect((html.match(/class="chapter"/g) || [])).toHaveLength(1);
  });

  it('counts clips in the section meta, and omits the meta when there are none', () => {
    // Scoped to the film section — later sections carry their own meta line.
    const meta = (html) => {
      const section = html.slice(html.indexOf('<h2>Highlight Film</h2>'), html.indexOf('id="yt-player"'));
      return (section.match(/<div class="section-meta">([^<]*)<\/div>/) || [])[1] ?? null;
    };

    expect(meta(renderProfile({ ...COMPLETE, video_chapters: [{ t: 18, label: 'One' }] }))).toContain('1 clip');
    expect(meta(renderProfile(COMPLETE))).toContain('3 clips');
    expect(meta(renderProfile({ ...COMPLETE, video_chapters: [] }))).toBeNull();
  });
});

describe('missing values omit their block entirely', () => {
  it('drops the academic record card when there are no academics', () => {
    const html = renderProfile(COMPLETE);
    expect(html).not.toContain('Academic record');
    expect(html).not.toContain('N/A');
  });

  it('keeps the academic record card once a single field is present', () => {
    expect(renderProfile({ ...COMPLETE, gpa: 3.76 })).toContain('Academic record');
  });

  it('drops the evaluation section when there is no evaluation', () => {
    expect(renderProfile(COMPLETE)).not.toContain('<h2>Evaluation</h2>');
    expect(renderProfile({ ...COMPLETE, evaluation: 'Direct winger.' })).toContain('<h2>Evaluation</h2>');
  });

  it('drops the attributes section when there are no attributes at all', () => {
    expect(renderProfile(COMPLETE)).not.toContain('<h2>Player Attributes</h2>');
  });

  it('renders only the sport attributes that have values', () => {
    const html = renderProfile({ ...COMPLETE, sport_attributes: { goals: 11, preferred_foot: 'Right' } });
    expect(html).toContain('Goals');
    expect(html).toContain('Preferred foot');
    expect(html).not.toContain('Yo-Yo IR1');
    expect(html).not.toContain('Assists');
  });

  it('marks the emphasised metrics gold via the key class', () => {
    const html = renderProfile({ ...COMPLETE, sport_attributes: { goals: 11 } });
    expect(html).toContain('<div class="stat key"><dt>Goals</dt>');
  });
});

describe('academic record', () => {
  const base = {
    full_name: 'Test Athlete', position: 'Midfield', graduation_year: 2027,
    email: 'a@b.com', video_id: 'aqz-KE-bpKQ', video_chapters: '[]',
    public_slug: 'testslug', sport: 'mens-soccer',
  };
  const has = (html, label) => html.includes(`<dt>${label}</dt>`);

  // These three rendered here long before the form had any way to fill them,
  // so every athlete's page carried an academic record that could only ever
  // show GPA.
  it('shows GPA, SAT and ACT when they are set', () => {
    const html = renderProfile({ ...base, gpa: 3.6, sat_score: 1250, act_score: 27 }, { dryRun: true });
    expect(has(html, 'GPA')).toBe(true);
    expect(has(html, 'SAT')).toBe(true);
    expect(has(html, 'ACT')).toBe(true);
    expect(html).toContain('1250');
  });

  it('omits each row entirely when unset, rather than printing an empty one', () => {
    const html = renderProfile(base, { dryRun: true });
    expect(has(html, 'GPA')).toBe(false);
    expect(has(html, 'SAT')).toBe(false);
    expect(has(html, 'ACT')).toBe(false);
  });

  it('shows one test score without requiring the other', () => {
    const html = renderProfile({ ...base, sat_score: 1250 }, { dryRun: true });
    expect(has(html, 'SAT')).toBe(true);
    expect(has(html, 'ACT')).toBe(false);
  });
});

describe('class year, after the two fields merged', () => {
  const base = {
    full_name: 'Test Athlete', position: 'Midfield', email: 'a@b.com',
    video_id: 'aqz-KE-bpKQ', video_chapters: '[]', public_slug: 'x', sport: 'mens-soccer',
  };

  it('publishes on the recruiting class year alone', () => {
    expect(checkRequiredCore({ ...base, recruiting_class_year: 2027 })).toEqual([]);
    const html = renderProfile({ ...base, recruiting_class_year: 2027 }, { dryRun: true });
    expect(html).toContain('Class of 2027');
    expect(html).toContain('2027 entry');
  });

  // The trap this closes: the form asked for recruiting class year and the
  // export demanded graduation_year, so an athlete could be created, matched
  // and drafted, then fail to publish on a field nothing had asked for.
  it('no longer demands a graduation year the form does not ask for', () => {
    expect(checkRequiredCore({ ...base, recruiting_class_year: 2027 })).not.toContain('recruiting class year');
  });

  it('still publishes a record made before the field existed', () => {
    expect(checkRequiredCore({ ...base, graduation_year: 2026 })).toEqual([]);
    expect(renderProfile({ ...base, graduation_year: 2026 }, { dryRun: true })).toContain('Class of 2026');
  });

  it('prints the arrival year for a post-grad athlete, not the school one', () => {
    const html = renderProfile({ ...base, graduation_year: 2026, recruiting_class_year: 2027 }, { dryRun: true });
    expect(html).toContain('Class of 2027');
    expect(html).not.toContain('Class of 2026');
  });

  it('blocks when neither is set', () => {
    expect(checkRequiredCore(base)).toContain('recruiting class year');
  });
});

describe('the required-field list', () => {
  // It is printed to the operator by the publish card, the send path, the
  // export and the preflight. Anything restating it from memory drifts, which
  // is what the preflight had already done.
  it('names the field the form actually asks for', () => {
    expect(REQUIRED_CORE_LABELS).toContain('recruiting class year');
    expect(REQUIRED_CORE_LABELS).not.toContain('class year');
  });

  it('is exactly what checkRequiredCore reports for an empty record', () => {
    expect(checkRequiredCore({}).sort()).toEqual([...REQUIRED_CORE_LABELS].sort());
  });
});
