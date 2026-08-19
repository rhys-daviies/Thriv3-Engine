/**
 * Client tracker, ported from the validated reference implementation.
 * Implements brief §8 (event vocabulary and the qualification gate) and §9
 * (coverage not position, seeks detected separately, sendBeacon flush).
 *
 * Two deliberate changes from the reference:
 *   - CONFIG is injected by the generator rather than hard-coded.
 *   - chapter_jump reads its label from data-label. The reference used
 *     textContent, which concatenated the <time> element into the label
 *     ("0:181v1 isolation...") and would have corrupted chapter ranking.
 */
export const TRACKER_JS = `

/* ============================================================================
   CONFIG — server-renders this from the ?ref= token
   ========================================================================= */
/* CONFIG is injected above by the generator. */

/* ----------------------------------------------------------------------------
   SESSION — one per page load. A "return visit" is a second qualified session
   on the same token. Sessions only count once a human proves they are present,
   which is what keeps security scanners out of the numbers.
   ------------------------------------------------------------------------- */
const SESSION = {
  id: (crypto.randomUUID ? crypto.randomUUID()
                         : Date.now() + "-" + Math.random().toString(36).slice(2)),
  startedAt: Date.now(),
  visitNumber: CONFIG.priorVisits + 1,
  qualified: false,
  interactions: 0,
  dwell() { return Math.round((Date.now() - this.startedAt) / 1000); }
};

/* ============================================================================
   TRACKER
   ============================================================================
   Measures *coverage* (which seconds were genuinely played) rather than
   playhead position, so scrubbing to the end does not register as a full view.
   ========================================================================= */
const Tracker = (() => {
  const BUCKET = 1;        // seconds per coverage bucket
  const POLL   = 400;      // ms between samples
  const SEEK   = 2.5;      // seconds of jump that counts as a seek
  const MILES  = [10, 25, 50, 75, 95];

  let player, duration = 0, timer = null;
  const watched = new Set();
  const fired   = new Set();
  let lastTime = 0, rewinds = 0, skips = 0, started = false;

  const coverage = () =>
    duration ? Math.min(100, Math.round((watched.size * BUCKET / duration) * 100)) : 0;

  function send(type, extra = {}) {
    const payload = {
      token: CONFIG.token,
      athleteId: CONFIG.athleteId,
      sessionId: SESSION.id,
      visitNumber: SESSION.visitNumber,
      dwellSeconds: SESSION.dwell(),
      event: type,
      coveragePct: coverage(),
      watchedSeconds: watched.size * BUCKET,
      durationSeconds: Math.round(duration),
      rewinds, skips,
      ts: new Date().toISOString(),
      ...extra
    };
    UI.log(type, payload);
    if (CONFIG.dryRun) return;

    const body = JSON.stringify(payload);
    // sendBeacon survives the page being closed — critical for the final flush
    if (navigator.sendBeacon) {
      navigator.sendBeacon(CONFIG.endpoint, new Blob([body], { type: "application/json" }));
    } else {
      fetch(CONFIG.endpoint, {
        method: "POST", body, keepalive: true,
        headers: { "Content-Type": "application/json" }
      }).catch(() => {});
    }
  }

  function sample() {
    if (!player || player.getPlayerState() !== YT.PlayerState.PLAYING) return;
    const t = player.getCurrentTime();
    if (!duration) duration = player.getDuration() || 0;

    const delta = t - lastTime;
    if (delta < -SEEK) rewinds++;                       // went back to rewatch
    else if (delta > SEEK) skips++;                     // jumped forward
    else watched.add(Math.floor(t / BUCKET));           // genuine playback

    lastTime = t;
    UI.markChapter(t);

    const cov = coverage();
    for (const m of MILES) {
      if (cov >= m && !fired.has(m)) { fired.add(m); send("coverage_" + m); }
    }
    UI.update(cov, watched.size, rewinds, skips);
  }

  function onState(e) {
    if (e.data === YT.PlayerState.PLAYING) {
      if (!started) {
        started = true;
        duration = player.getDuration() || 0;
        qualify("video_play");            // pressing play is proof of a human
        send("play_start");
      }
      if (!timer) timer = setInterval(sample, POLL);
    } else {
      clearInterval(timer); timer = null;
      if (e.data === YT.PlayerState.ENDED) send("ended");
      else if (e.data === YT.PlayerState.PAUSED && started) send("pause");
    }
  }

  /* --------------------------------------------------------------------------
     A session becomes a real "visit" only when a human proves they are here:
     either they press play, or they linger AND interact with the page.
     Safe Links and other scanners fetch the HTML but do neither, so they
     never qualify and never pollute the visit count.
     ----------------------------------------------------------------------- */
  function qualify(reason) {
    if (SESSION.qualified) return;
    SESSION.qualified = true;
    send("visit_qualified", { reason, returning: SESSION.visitNumber > 1 });
    UI.badge();
  }

  function watchForHuman() {
    ["pointerdown", "keydown", "scroll", "touchstart"].forEach(evt =>
      addEventListener(evt, () => {
        SESSION.interactions++;
        if (SESSION.dwell() >= 10) qualify("dwell_and_interaction");
      }, { passive: true })
    );
    setTimeout(() => {
      if (SESSION.interactions > 0) qualify("dwell_and_interaction");
    }, 12000);
  }

  function flush() {
    send("session_end", {
      reason: "unload",
      qualified: SESSION.qualified,
      played: started
    });
  }

  return {
    init() {
      player = new YT.Player("yt-player", {
        videoId: CONFIG.videoId,
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, enablejsapi: 1 },
        events: {
          onReady: () => { duration = player.getDuration() || 0; UI.log("ready", {}); },
          onStateChange: onState
        }
      });

      // Chapter buttons — a coach jumping straight to a clip is real intent,
      // and tells you what they are evaluating for
      document.querySelectorAll(".chapter").forEach(btn => {
        btn.addEventListener("click", () => {
          const t = Number(btn.dataset.t);
          player.seekTo(t, true); player.playVideo();
          lastTime = t;
          send("chapter_jump", { toSeconds: t, label: btn.dataset.label });
        });
      });

      watchForHuman();
      send("visit_start", { returning: SESSION.visitNumber > 1 });

      // Fire once, whichever comes first
      let done = false;
      const once = () => { if (!done) { done = true; flush(); } };
      addEventListener("pagehide", once);
      addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") once();
      });
    }
  };
})();

/* ---------- debug panel + active-chapter state ---------- */
const UI = {
  chapters: [...document.querySelectorAll(".chapter")]
    .map(el => ({ el, t: Number(el.dataset.t) }))
    .sort((a, b) => a.t - b.t),

  markChapter(time) {
    let current = null;
    for (const c of this.chapters) { if (time >= c.t - 1) current = c; }
    this.chapters.forEach(c => c.el.classList.toggle("active", c === current));
  },

  badge() {
    document.getElementById("g-qual").textContent =
      SESSION.visitNumber > 1 ? "RETURN VISIT" : "verified human";
  },

  update(cov, secs, rew, skip) {
    document.getElementById("g-cov").textContent  = cov + "%";
    document.getElementById("g-sec").textContent  = secs + "s";
    document.getElementById("g-rew").textContent  = rew;
    document.getElementById("g-skip").textContent = skip;
    document.getElementById("g-bar").style.width  = cov + "%";
  },

  log(type, payload) {
    const el = document.getElementById("log");
    if (el.dataset.clean !== "1") { el.innerHTML = ""; el.dataset.clean = "1"; }
    const row = document.createElement("div");
    const time = new Date().toLocaleTimeString([], { hour12: false });
    row.innerHTML = time + " <b>" + type + "</b> " +
      (payload.coveragePct !== undefined ? payload.coveragePct + "%" : "");
    el.prepend(row);
  }
};

document.getElementById("g-visit").textContent = "#" + SESSION.visitNumber;

document.getElementById("debug-toggle").addEventListener("click", () => {
  document.getElementById("debug").classList.add("on");
  document.getElementById("debug-toggle").style.display = "none";
});
document.getElementById("debug-close").addEventListener("click", () => {
  document.getElementById("debug").classList.remove("on");
  document.getElementById("debug-toggle").style.display = "block";
});

/* ---------- boot YouTube IFrame API ---------- */
window.onYouTubeIframeAPIReady = () => Tracker.init();
(function () {
  const s = document.createElement("script");
  s.src = "https://www.youtube.com/iframe_api";
  document.head.appendChild(s);
})();
`;
