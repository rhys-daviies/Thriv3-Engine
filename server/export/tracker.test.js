import { describe, it, expect } from 'vitest';
import { openProfile } from './trackerHarness.js';

/**
 * Brief §12 acceptance tests for the client tracker, run against a page
 * rendered exactly as the generator produces it.
 */

describe('bot simulation — the most important test in the suite', () => {
  it('does not qualify a page that is loaded and never touched', () => {
    const page = openProfile();

    // A minute of nothing, which is what a Defender Safe Links pre-fetch or an
    // Apple Mail pre-load looks like.
    page.advance(60_000);

    expect(page.has('visit_start')).toBe(true);
    expect(page.has('visit_qualified')).toBe(false);
    expect(page.has('play_start')).toBe(false);
  });

  it('does not qualify on dwell alone, however long', () => {
    const page = openProfile();
    page.advance(600_000);
    expect(page.has('visit_qualified')).toBe(false);
  });

  it('does not qualify on an interaction that arrives too early to be human dwell', () => {
    const page = openProfile();
    page.interact('pointerdown');
    page.interact('scroll');
    expect(page.has('visit_qualified')).toBe(false);
  });

  it('reports the session as unqualified when a scanner closes the page', () => {
    const page = openProfile();
    page.advance(60_000);
    page.close();

    const end = page.last('session_end');
    expect(end.qualified).toBe(false);
    expect(end.played).toBe(false);
  });

  it('still emits visit_start, so the funnel knows the link was fetched', () => {
    const page = openProfile();
    expect(page.sent()).toEqual(['visit_start']);
  });
});

describe('qualification — what a human does', () => {
  it('qualifies the moment the video is played', () => {
    const page = openProfile();
    page.play();

    expect(page.has('visit_qualified')).toBe(true);
    expect(page.last('visit_qualified').reason).toBe('video_play');
  });

  it('qualifies on dwell past ten seconds combined with an interaction', () => {
    const page = openProfile();
    page.advanceClock(11_000);
    page.interact('pointerdown');

    expect(page.has('visit_qualified')).toBe(true);
    expect(page.last('visit_qualified').reason).toBe('dwell_and_interaction');
  });

  it('qualifies only once, however much happens afterwards', () => {
    const page = openProfile();
    page.play();
    page.advanceClock(20_000);
    page.interact('pointerdown');
    page.playThrough(0, 30);

    expect(page.sent().filter((e) => e === 'visit_qualified')).toHaveLength(1);
  });

  it('treats a chapter jump as intent and records the clip label', () => {
    const page = openProfile();
    page.document.querySelectorAll('.chapter')[1].dispatchEvent(
      new page.window.Event('click', { bubbles: true })
    );

    const jump = page.last('chapter_jump');
    expect(jump.label).toBe('Half-turn');
    expect(jump.toSeconds).toBe(66);
  });
});

describe('scrub resistance', () => {
  it('does not credit a seek to the end as a full view', () => {
    const page = openProfile({ duration: 240 });
    page.play();
    page.tick(1);

    // Drag the scrubber from the start to the last few seconds.
    page.seekTo(238);
    page.tick(238);
    page.tick(239);

    expect(page.coverage()).toBeLessThanOrEqual(5);
    expect(page.skips()).toBe(1);
  });

  it('counts only the seconds genuinely played', () => {
    const page = openProfile({ duration: 240 });
    page.play();
    page.playThrough(0, 60);

    // 61 of 240 seconds is roughly a quarter.
    expect(page.coverage()).toBeGreaterThanOrEqual(24);
    expect(page.coverage()).toBeLessThanOrEqual(27);
  });

  it('does not double-count a section watched twice', () => {
    const page = openProfile({ duration: 240 });
    page.play();
    page.playThrough(0, 60);
    const once = page.coverage();

    page.seekTo(0);
    page.tick(0);
    page.playThrough(0, 60);

    expect(page.coverage()).toBe(once);
  });

  it('separates a backward jump as a rewind from a forward jump as a skip', () => {
    const page = openProfile({ duration: 240 });
    page.play();
    page.playThrough(0, 100);

    page.seekTo(200);
    page.tick(200);
    expect(page.skips()).toBe(1);
    expect(page.rewinds()).toBe(0);

    page.seekTo(20);
    page.tick(20);
    expect(page.rewinds()).toBe(1);
    expect(page.skips()).toBe(1);
  });

  it('reports coverage ranges describing where the reel was watched', () => {
    const page = openProfile({ duration: 240 });
    page.play();
    page.playThrough(0, 40);
    page.close();

    const ranges = page.last('session_end').coverageRanges;
    expect(ranges).toEqual([[0, 40]]);
  });

  it('reports two ranges when a middle section is skipped', () => {
    const page = openProfile({ duration: 240 });
    page.play();
    page.playThrough(0, 20);
    page.seekTo(100);
    page.tick(100);
    page.playThrough(100, 120);
    page.close();

    const ranges = page.last('session_end').coverageRanges;
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toEqual([0, 20]);
    expect(ranges[1][0]).toBeGreaterThanOrEqual(100);
  });
});

describe('final flush on close', () => {
  it('delivers session_end by sendBeacon, which survives the page closing', () => {
    const page = openProfile();
    page.play();
    page.playThrough(0, 30);
    page.close();

    const final = page.events[page.events.length - 1];
    expect(final.via).toBe('sendBeacon');
    expect(JSON.parse(final.body).event).toBe('session_end');
  });

  it('carries the final totals', () => {
    const page = openProfile({ duration: 240 });
    page.play();
    page.playThrough(0, 60);
    page.close();

    const end = page.last('session_end');
    expect(end.watchedSeconds).toBe(61);
    expect(end.qualified).toBe(true);
    expect(end.played).toBe(true);
  });

  it('falls back to fetch with keepalive where sendBeacon is unavailable', () => {
    const page = openProfile();
    page.play();
    delete page.window.navigator.sendBeacon;
    page.close();

    const final = page.events[page.events.length - 1];
    expect(final.via).toBe('fetch');
    expect(final.keepalive).toBe(true);
    expect(JSON.parse(final.body).event).toBe('session_end');
  });

  it('flushes once, not once per close signal', () => {
    const page = openProfile();
    page.play();
    page.close();
    page.close();
    page.window.document.dispatchEvent(new page.window.Event('visibilitychange'));

    expect(page.sent().filter((e) => e === 'session_end')).toHaveLength(1);
  });
});

describe('what the page sends', () => {
  it('echoes the ?ref= token from the URL and never a baked-in one', () => {
    const token = 'b'.repeat(32);
    const page = openProfile({ token });
    expect(page.last('visit_start').token).toBe(token);
  });

  it('keeps one session id across every event', () => {
    const page = openProfile();
    page.play();
    page.playThrough(0, 30);
    page.close();

    const ids = new Set(page.payloads().map((p) => p.sessionId));
    expect(ids.size).toBe(1);
  });

  it('posts to the endpoint the generator was configured with', () => {
    const page = openProfile();
    expect(page.events[0].url).toBe('https://collector.test/api/track');
  });
});
