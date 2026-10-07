/**
 * Video links (spec LNK-01..LNK-05): only https links to YouTube are accepted. A link is reduced to
 * the video id and re-built in a canonical form, so nothing else from the submitted URL is ever stored or followed.
 */
export const DEFAULT_VIDEO_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'];

const ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** "90", "90s", "1m30s", "1h2m3s" -> seconds, or null */
export function parseVideoTime(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const m = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return (parseInt(m[1] ?? '0', 10) * 3600) + (parseInt(m[2] ?? '0', 10) * 60) + parseInt(m[3] ?? '0', 10);
}

/**
 * @param {string|{url:string,title?:string,game?:number,time?:number|string}} input
 * @param {{hosts?:string[]}} [opts]
 * @returns {{ok:true, link:object}|{ok:false, reason:string}}
 */
export function normalizeVideoLink(input, { hosts = DEFAULT_VIDEO_HOSTS } = {}) {
  const src = typeof input === 'string' ? { url: input } : (input ?? {});
  if (typeof src.url !== 'string' || src.url.trim() === '') return { ok: false, reason: 'the link is empty' };
  let u;
  try { u = new URL(src.url.trim()); } catch { return { ok: false, reason: `"${String(src.url).slice(0, 60)}" is not a valid link` }; }
  if (u.protocol !== 'https:') return { ok: false, reason: 'only https links are accepted' };
  if (u.username || u.password) return { ok: false, reason: 'links with a user name or password are not accepted' };
  const host = u.hostname.toLowerCase();
  if (!hosts.includes(host)) return { ok: false, reason: `only YouTube links are accepted (not ${host})` };

  let id = null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be') id = parts[0] ?? null;
  else if (parts[0] === 'watch') id = u.searchParams.get('v');
  else if (['shorts', 'live', 'embed', 'v'].includes(parts[0])) id = parts[1] ?? null;
  if (!id || !ID_RE.test(id)) return { ok: false, reason: 'the link does not point to a single YouTube video' };

  const hashTime = (u.hash.match(/^#t=(.+)$/) ?? [])[1];
  const time = parseVideoTime(src.time ?? u.searchParams.get('t') ?? u.searchParams.get('start') ?? hashTime);
  const link = { type: 'video', provider: 'youtube', id, url: `https://www.youtube.com/watch?v=${id}${time ? `&t=${time}s` : ''}` };
  if (time) link.time = time;
  if (typeof src.title === 'string') {
    const t = src.title.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (t) link.title = t;
  }
  if (Number.isInteger(src.game) && src.game >= 1) link.game = src.game;
  return { ok: true, link };
}
