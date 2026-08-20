const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PATH_PREFIXES = ['embed', 'v', 'shorts', 'live'];

/**
 * Pulls the 11-character video ID out of whatever shape of YouTube URL is on
 * the athlete record. Handles youtu.be, &t= offsets, playlist and index
 * params, /embed/, /shorts/, /live/, youtube-nocookie, and a bare ID.
 * Returns null for anything that does not resolve to a single video —
 * notably a playlist URL with no v= param.
 */
export function extractVideoId(input) {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;
  if (VIDEO_ID.test(raw)) return raw;

  let url;
  try {
    url = new URL(raw.includes('://') ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be') {
    return VIDEO_ID.test(parts[0] || '') ? parts[0] : null;
  }
  if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'youtube-nocookie.com') {
    return null;
  }

  const v = url.searchParams.get('v');
  if (v && VIDEO_ID.test(v)) return v;

  if (PATH_PREFIXES.includes(parts[0]) && VIDEO_ID.test(parts[1] || '')) {
    return parts[1];
  }
  return null;
}
