/** Small display helpers (no DOM, testable in Node). */

export const lengthText = (len) => (len === 0 ? 'Money' : `${len} pt`);
export const dateText = (d) => d || '–';

/** seconds -> "1:35" or "1:02:03" */
export function timeLabel(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/**
 * Defence in depth: the ingestion already rebuilds video links, but the data comes from pull requests, so the
 * browser only ever links to this exact shape.
 */
const VIDEO_RE = /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}(&t=\d{1,6}s)?$/;
export const safeVideoUrl = (link) => (link && typeof link.url === 'string' && VIDEO_RE.test(link.url) ? link.url : null);

export const SHARD_ID_RE = /^\d{4,}$/;
export const HASH_RE = /^[0-9a-f]{16,64}$/;

/** "0001/2359e4c944b8d130" -> {shard, hash} or null */
export function parseMatchId(id) {
  const m = String(id ?? '').match(/^(\d{4,})\/([0-9a-f]{16,64})$/);
  return m ? { shard: m[1], hash: m[2] } : null;
}

/** URLs of the files of a match, built from the shard base URL (which ends with "/") */
export function matchFiles(shardBase, hash) {
  const dir = `${shardBase}matches/${hash.slice(0, 2)}/${hash}`;
  return { meta: `${dir}.meta.json`, mat: `${dir}.mat` };
}
export const attachmentUrl = (shardBase, hash, kind) => `${shardBase}attachments/${hash.slice(0, 2)}/${hash}.${kind === 'xg' ? 'xg' : 'sgf'}`;

export const HOW_TEXT = { bearOff: 'borne off', drop: 'cube dropped', resign: 'resigned' };
export const KIND_TEXT = { single: 'single game', gammon: 'gammon', backgammon: 'backgammon' };

export function resultText(result, sides, matchLength) {
  if (!result) return 'unknown';
  const [a, b] = result.score;
  const p = result.partial;
  const n = p?.gaps?.length ?? 0;
  const from = !p ? '' : n
    ? ` (an excerpt: ${[...(p.startScore ? [`recorded from ${p.startScore.join('–')}`] : []), `${n} gap${n === 1 ? '' : 's'}`].join(', ')})`
    : ` (a fragment: recorded from ${p.startScore.join('–')})`;
  if (!result.finished) return `unfinished, ${a}–${b}${from}`;
  const w = result.winner === 0 ? sides[0].name : sides[1].name;
  return (matchLength === 0 ? `${w} won (${a}–${b})` : `${w} won ${Math.max(a, b)}–${Math.min(a, b)}`) + from;
}

export const rulesText = (rules) => {
  const on = (v, name) => (v === true ? [name] : []);
  const out = [...on(rules.crawford, 'Crawford'), ...on(rules.jacoby, 'Jacoby'), ...on(rules.beaver, 'beaver')];
  return out.length ? out.join(', ') : '–';
};

export const LICENSE_LINKS = { 'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/' };
