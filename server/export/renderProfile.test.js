import { describe, it, expect } from 'vitest';
import { renderProfile, checkRequiredCore } from './renderProfile.js';

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
    ['class year', { graduation_year: null }, 'class year'],
    ['video', { video_id: null }, 'video'],
    ['contact email', { email: null }, 'contact email'],
  ])('reports a missing %s', (_label, override, expected) => {
    expect(checkRequiredCore({ ...COMPLETE, ...override })).toContain(expected);
  });

  it('requires at least three chapters', () => {
    expect(checkRequiredCore({ ...COMPLETE, video_chapters: COMPLETE.video_chapters.slice(0, 2) }))
      .toContain('at least 3 film chapters');
    expect(checkRequiredCore(COMPLETE)).toEqual([]);
  });

  it('ignores malformed chapter entries when counting', () => {
    const chapters = [{ t: 1, label: 'a' }, { t: 2 }, { label: 'c' }, { t: 4, label: 'd' }];
    expect(checkRequiredCore({ ...COMPLETE, video_chapters: chapters }))
      .toContain('at least 3 film chapters');
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
