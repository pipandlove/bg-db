/**
 * The search query language of the site (spec section 9):
 *   player:smith  player:"Dale Henderson"   either side; two players = a match between them
 *   event:"world championship"              part of the event name
 *   round:final  round:"match 2"            part of the round name
 *   year:2019  year:2019..2024  year:..2020 one year or a range
 *   len:7  len:5..9  len:money              match length (money = money game)
 *   has:cube,gammon,resign,analysis,attachment,video,illegal
 *   anything else                           words that must appear in a player or event name
 * Accents and case are ignored. The query is the single source of truth: the filter controls only rewrite it,
 * and it is kept in the URL (#q=...) so that a result list can be shared.
 */
import { normalizeName } from '../lib/core/names.js';

export const FLAG_BITS = { gammon: 1, cube: 2, analysis: 4, resign: 8, attachment: 16, video: 32, illegal: 64 };
export const FLAG_LABELS = { gammon: 'gammon', cube: 'cube', analysis: 'analysis', resign: 'resigned', attachment: 'files', video: 'video', illegal: 'illegal play' };
export const FLAG_HELP = {
  gammon: 'a gammon or backgammon occurred', cube: 'the cube was turned', analysis: 'an analysed file is attached',
  resign: 'a game ended by resignation', attachment: 'an original SGF or XG file is attached', video: 'has a video link',
  illegal: 'an illegal play was made in the match and is kept as played',
};

/** Split into {key, value} tokens; quotes group words: player:"Dale Henderson". key is null for bare words. */
export function tokenize(q) {
  const s = String(q ?? '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    let key = null;
    const m = s.slice(i).match(/^([A-Za-z]+):/);
    if (m) { key = m[1].toLowerCase(); i += m[0].length; }
    let value;
    if (s[i] === '"') {
      i++;
      const j = s.indexOf('"', i);
      if (j < 0) { value = s.slice(i); i = s.length; } else { value = s.slice(i, j); i = j + 1; }
    } else {
      const m2 = s.slice(i).match(/^\S*/);
      value = m2[0];
      i += value.length;
    }
    out.push({ key, value });
  }
  return out;
}

function parseRange(v, allowMoney) {
  const s = v.trim().toLowerCase();
  if (allowMoney && s === 'money') return { min: 0, max: 0 };
  let m = s.match(/^(\d+)$/);
  if (m) return { min: +m[1], max: +m[1] };
  m = s.match(/^(\d*)\.\.(\d*)$/);
  if (m && (m[1] || m[2])) return { min: m[1] ? +m[1] : null, max: m[2] ? +m[2] : null };
  return null;
}

/** @returns {{text:string[], player:string[], event:string[], round:string[], year:object|null, len:object|null, has:string[], errors:string[]}} */
export function parseQuery(q) {
  const f = { text: [], player: [], event: [], round: [], year: null, len: null, has: [], errors: [] };
  for (const { key, value } of tokenize(q)) {
    if (key === null) { if (value) f.text.push(value); continue; }
    if (key === 'player' || key === 'vs') { if (value) f.player.push(value); continue; }
    if (key === 'event') { if (value) f.event.push(value); continue; }
    if (key === 'round') { if (value) f.round.push(value); continue; }
    if (key === 'year' || key === 'len') {
      const r = parseRange(value, key === 'len');
      if (r) f[key] = r; else f.errors.push(`"${key}:${value}" is not a number or a range such as ${key === 'year' ? '2019..2024' : '5..9'}`);
      continue;
    }
    if (key === 'has') {
      for (const part of value.split(',')) {
        const k = part.trim().toLowerCase();
        if (!k) continue;
        if (!(k in FLAG_BITS)) f.errors.push(`unknown flag "${k}" (use ${Object.keys(FLAG_BITS).join(', ')})`);
        else if (!f.has.includes(k)) f.has.push(k);
      }
      continue;
    }
    f.errors.push(`unknown filter "${key}:"`);
  }
  f.has.sort((a, b) => FLAG_BITS[a] - FLAG_BITS[b]);
  return f;
}

export const quote = (v) => (/[\s"]/.test(v) || v === '' ? `"${v.replace(/"/g, '')}"` : v);
const rangeText = (r, money) => {
  if (money && r.min === 0 && r.max === 0) return 'money';
  if (r.min !== null && r.min === r.max) return String(r.min);
  return `${r.min ?? ''}..${r.max ?? ''}`;
};

/** The normal text form of a filter (what the filter controls write into the search box). */
export function formatQuery(f) {
  const t = [];
  for (const p of f.player) t.push(`player:${quote(p)}`);
  for (const e of f.event) t.push(`event:${quote(e)}`);
  for (const r of f.round) t.push(`round:${quote(r)}`);
  if (f.year) t.push(`year:${rangeText(f.year, false)}`);
  if (f.len) t.push(`len:${rangeText(f.len, true)}`);
  if (f.has.length) t.push(`has:${f.has.join(',')}`);
  for (const w of f.text) t.push(quote(w));
  return t.join(' ');
}

const inRange = (v, r) => (r.min === null || v >= r.min) && (r.max === null || v <= r.max);

/** @returns {(row:object)=>boolean} rows come from catalog.js (decodeCatalog) */
export function makePredicate(f) {
  const players = f.player.map(normalizeName).filter(Boolean);
  const events = f.event.map(normalizeName).filter(Boolean);
  const rounds = f.round.map(normalizeName).filter(Boolean);
  const words = f.text.map(normalizeName).filter(Boolean);
  const need = f.has.reduce((a, k) => a | FLAG_BITS[k], 0);
  return (r) => {
    if (f.year && (r.year === null || !inRange(r.year, f.year))) return false;
    if (f.len && !inRange(r.len, f.len)) return false;
    if (need && (r.flags & need) !== need) return false;
    for (const e of events) if (!r.eventNorm.includes(e)) return false;
    for (const x of rounds) if (!r.roundNorm.includes(x)) return false;
    if (players.length === 1) {
      if (!r.n0.includes(players[0]) && !r.n1.includes(players[0])) return false;
    } else if (players.length === 2) {
      const [a, b] = players;
      if (!((r.n0.includes(a) && r.n1.includes(b)) || (r.n0.includes(b) && r.n1.includes(a)))) return false;
    } else if (players.length > 2) return false;
    for (const w of words) if (!r.hay.includes(w)) return false;
    return true;
  };
}

/** The word being typed at the end of the search box, for suggestions. */
export function currentToken(text) {
  let inQuote = false;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inQuote = !inQuote;
    if (!inQuote && /\s/.test(c)) start = -1;
    else if (start < 0) start = i;
  }
  if (start < 0) return null;
  const raw = text.slice(start);
  const m = raw.match(/^([A-Za-z]+):(.*)$/s);
  const key = m ? m[1].toLowerCase() : null;
  const value = (m ? m[2] : raw).replace(/^"/, '').replace(/"$/, '');
  return { start, key, value };
}
