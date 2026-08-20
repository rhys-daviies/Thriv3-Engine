import { JSDOM } from 'jsdom';
import { renderProfile } from './renderProfile.js';

/**
 * Runs a generated profile page's real tracker in jsdom, against a fake
 * YouTube player and a controllable clock.
 *
 * The point is to test what actually ships. The tracker is embedded in the
 * exported HTML, so these tests render a page exactly as the generator would,
 * then drive it — rather than testing a copy of the logic that could drift
 * from the file a coach opens.
 */

const ATHLETE = {
  id: 'ath-test',
  full_name: 'Nikau Brennan',
  position: 'Left Winger',
  graduation_year: 2027,
  email: 'athlete@example.com',
  video_id: 'aqz-KE-bpKQ',
  sport: 'mens-soccer',
  video_chapters: [
    { t: 18, label: '1v1 isolation' },
    { t: 66, label: 'Half-turn' },
    { t: 122, label: 'Counter-press' },
  ],
};

export function openProfile({ athlete = ATHLETE, token = 'a'.repeat(32), duration = 240 } = {}) {
  const html = renderProfile(athlete, { endpoint: 'https://collector.test/api/track' });

  const events = [];
  const clock = { offset: 0 };
  const timers = [];
  const intervals = [];
  let state = -1;      // YT.PlayerState.UNSTARTED
  let currentTime = 0;
  let onStateChange = null;
  let onReady = null;

  const dom = new JSDOM(html, {
    url: `https://pages.test/p/slug.html?ref=${token}`,
    runScripts: 'dangerously',
    beforeParse(window) {
      // Blob contents cannot be read synchronously, and sendBeacon is handed
      // one — keep the source text on the way in so assertions stay simple.
      const RealBlob = window.Blob;
      window.Blob = class TrackedBlob extends RealBlob {
        constructor(parts, options) {
          super(parts, options);
          this.sourceText = parts.join('');
        }
      };

      // Capture what the tracker sends, over both delivery paths.
      window.navigator.sendBeacon = (url, blob) => {
        events.push({ via: 'sendBeacon', url, body: blob.sourceText, contentType: blob.type });
        return true;
      };
      window.fetch = (url, opts) => {
        events.push({ via: 'fetch', url, body: opts?.body, keepalive: opts?.keepalive });
        return Promise.resolve({ ok: true });
      };

      // Dwell is measured with Date.now, so the clock has to move under our
      // control too — otherwise a test that means "sixty seconds later" runs
      // in a millisecond and proves nothing.
      const RealDate = window.Date;
      window.Date = class ControlledDate extends RealDate {
        constructor(...args) {
          super(...(args.length ? args : [RealDate.now() + clock.offset]));
        }
        static now() {
          return RealDate.now() + clock.offset;
        }
      };

      // A clock we drive, so the 12-second qualification timer and the 400ms
      // poll are deterministic rather than a race.
      window.setTimeout = (fn, ms) => timers.push({ fn, ms }) - 1;
      window.clearTimeout = (id) => { if (timers[id]) timers[id] = null; };
      window.setInterval = (fn, ms) => intervals.push({ fn, ms }) - 1;
      window.clearInterval = (id) => { if (intervals[id]) intervals[id] = null; };

      const player = {
        getPlayerState: () => state,
        getCurrentTime: () => currentTime,
        getDuration: () => duration,
        seekTo: (t) => { currentTime = t; },
        playVideo: () => { state = 1; },
      };

      window.YT = {
        PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
        Player: function Player(_el, opts) {
          onReady = opts.events.onReady;
          onStateChange = opts.events.onStateChange;
          return player;
        },
      };

      // The page appends the real IFrame API script tag. jsdom does not fetch
      // external resources by default, so it is inert and the YT stub above
      // stands in for what it would have provided.
    },
  });

  const { window } = dom;
  window.onYouTubeIframeAPIReady();
  if (onReady) onReady();

  const api = {
    window,
    document: window.document,
    events,

    /** Event names sent so far, in order. */
    sent: () => events.map((e) => JSON.parse(String(e.body)).event),
    payloads: () => events.map((e) => JSON.parse(String(e.body))),
    last: (name) => {
      const hit = [...events].reverse().find((e) => JSON.parse(String(e.body)).event === name);
      return hit ? JSON.parse(String(hit.body)) : null;
    },
    has: (name) => api.sent().includes(name),

    /** Moves wall-clock time forward without running any timers. */
    advanceClock(ms) {
      clock.offset += ms;
    },

    /** Moves time forward and runs any timeout whose delay has elapsed. */
    advance(ms) {
      clock.offset += ms;
      for (let i = 0; i < timers.length; i++) {
        const timer = timers[i];
        if (timer && timer.ms <= ms) {
          timers[i] = null;
          timer.fn();
        }
      }
    },

    play() {
      state = 1;
      onStateChange({ data: 1 });
    },
    pause() {
      state = 2;
      onStateChange({ data: 2 });
    },
    end() {
      state = 0;
      onStateChange({ data: 0 });
    },
    /** Advances the playhead and runs the poll, as real playback would. */
    tick(toSeconds) {
      currentTime = toSeconds;
      for (const interval of intervals) if (interval) interval.fn();
    },
    /** Plays continuously from a to b, one poll per second. */
    playThrough(from, to) {
      for (let t = from; t <= to; t++) api.tick(t);
    },
    seekTo(seconds) {
      currentTime = seconds;
    },
    interact(type = 'pointerdown') {
      window.dispatchEvent(new window.Event(type));
    },
    close() {
      window.dispatchEvent(new window.Event('pagehide'));
    },
    coverage: () => Number(window.document.getElementById('g-cov').textContent.replace('%', '')),
    rewinds: () => Number(window.document.getElementById('g-rew').textContent),
    skips: () => Number(window.document.getElementById('g-skip').textContent),
  };

  return api;
}
