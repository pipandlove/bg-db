/**
 * Player pseudonyms (decision 0025): the names of a match are replaced, before anything is sent, by names computed with the contributor's
 * own secret key. The same handle gives the same pseudonym in all the matches of one contributor, and a different one with another key, so
 * that nobody without the key can tie a pseudonym to an account on a platform. The platform itself, the time of day, the event, the round,
 * the ratings and the remarks go too (they help find the game on the platform); the date and the moves stay.
 *
 * Works unchanged in Node and in the browser (the Contribute page): WebCrypto for random keys, CompressionStream for the .xg rewrite.
 */
import { sha256Hex } from './sha256.js';
import { normalizeName } from './names.js';
import { inflateZlib } from './inflate.js';
import { crc32 } from './zip.js';
import { readMatch, readMatchBytes } from './read.js';
import { contentHash } from './identity.js';
import { writeMat } from './mat-writer.js';

export const KEY_BYTES = 32;
const KEY_TAG = 'bgdb-key-1';
const NAME_DOMAIN = 'bgdb-name-1\n';

const ADJECTIVES = [
  'amber', 'azure', 'bold', 'brave', 'brisk', 'calm', 'clever', 'cosmic', 'crimson', 'curious', 'daring', 'dusty', 'eager', 'early', 'fancy', 'gentle',
  'gilded', 'glad', 'golden', 'grand', 'happy', 'hardy', 'hidden', 'humble', 'icy', 'jolly', 'keen', 'kind', 'lively', 'lucky', 'lunar', 'mellow',
  'merry', 'misty', 'modest', 'nimble', 'noble', 'olive', 'patient', 'plucky', 'polar', 'proud', 'quick', 'quiet', 'rapid', 'rosy', 'royal', 'rustic',
  'sandy', 'silent', 'silver', 'sly', 'snowy', 'solar', 'steady', 'stormy', 'sunny', 'swift', 'tidy', 'vivid', 'wild', 'witty', 'zesty', 'velvet',
];
const ANIMALS = [
  'badger', 'bear', 'beaver', 'bison', 'boar', 'camel', 'cobra', 'cougar', 'coyote', 'crab', 'deer', 'dingo', 'dolphin', 'donkey', 'eel', 'elk',
  'ferret', 'fox', 'gecko', 'gibbon', 'goat', 'gopher', 'hare', 'hippo', 'horse', 'hyena', 'ibex', 'iguana', 'impala', 'jackal', 'jaguar', 'koala',
  'lemur', 'leopard', 'lion', 'llama', 'lynx', 'marmot', 'mink', 'mole', 'moose', 'newt', 'ocelot', 'okapi', 'orca', 'otter', 'panda', 'panther',
  'puma', 'rabbit', 'raccoon', 'seal', 'shark', 'skunk', 'sloth', 'tapir', 'tiger', 'toad', 'turtle', 'walrus', 'weasel', 'whale', 'wolf', 'zebra',
];
export const WORDS = { adjectives: ADJECTIVES, animals: ANIMALS };

// "anon-" was the prefix of the first release (tools v11): names written then are still pseudonyms
const PSEUDONYM_RE = /^(?:anon-)?([a-z]+)-([a-z]+)-[0-9a-f]{4}$/;
/** a name made by `pseudonym` (an adjective and an animal of the lists, four hex characters): a match sent again keeps it */
export function isPseudonym(name) {
  const m = String(name ?? '').match(PSEUDONYM_RE);
  return !!m && ADJECTIVES.includes(m[1]) && ANIMALS.includes(m[2]);
}

const hexToBytes = (hex) => Uint8Array.from(hex.match(/../g), (b) => parseInt(b, 16));
const bytesToHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const utf8 = (s) => new TextEncoder().encode(s);
const concat = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };

/** HMAC-SHA-256 (RFC 2104) @returns {Uint8Array} 32 bytes */
export function hmacSha256(key, message) {
  let k = key.length > 64 ? hexToBytes(sha256Hex(key)) : key;
  const block = new Uint8Array(64);
  block.set(k);
  const ipad = block.map((x) => x ^ 0x36);
  const opad = block.map((x) => x ^ 0x5c);
  k = null;
  const inner = hexToBytes(sha256Hex(concat(ipad, message)));
  return hexToBytes(sha256Hex(concat(opad, inner)));
}

/** a new random key (WebCrypto: the browser, Node 22) */
export function newKey() {
  return globalThis.crypto.getRandomValues(new Uint8Array(KEY_BYTES));
}

/** the text of the key file the contributor keeps; parseKey reads it back */
export function keyFileText(key) {
  return [
    'bgdb names key. Keep this file private, like a password.',
    'Load it on the Contribute page (on any computer) to give the players of your matches the same names as before.',
    '',
    `${KEY_TAG}:${bytesToHex(key)}`,
    '',
  ].join('\n');
}

/** @returns {Uint8Array|null} the key in a key file (or the 64 hex characters alone); null when there is none */
export function parseKey(text) {
  const m = String(text ?? '').match(new RegExp(`${KEY_TAG}:([0-9a-fA-F]{64})`)) ?? String(text ?? '').trim().match(/^([0-9a-fA-F]{64})$/);
  return m ? hexToBytes(m[1].toLowerCase()) : null;
}

export const keyToHex = bytesToHex;
export const keyFromHex = (hex) => (/^[0-9a-f]{64}$/.test(hex ?? '') ? hexToBytes(hex) : null);

/** a few characters that say which key is in use, without showing it (the start of its own hash) */
export const keyFingerprint = (key) => sha256Hex(concat(utf8('bgdb-key-fingerprint\n'), key)).slice(0, 8);

/**
 * The pseudonym of a handle: HMAC-SHA-256(key, normalised handle) turned into "<adjective>-<animal>-<4 hex>" (28 bits).
 * The handle is normalised as for search (case, accents, spaces), so "Sam " and "sam" get the same name.
 */
export function pseudonym(key, handle) {
  const h = hmacSha256(key, utf8(NAME_DOMAIN + normalizeName(handle)));
  return `${ADJECTIVES[h[0] & 63]}-${ANIMALS[h[1] & 63]}-${bytesToHex(h.subarray(2, 4))}`;
}

/** @returns {(name:string|null)=>string|null} the names of one key; a name that is already a pseudonym, or no name, is kept */
export function namer(key) {
  const memo = new Map();
  return (name) => {
    if (name === null || name === undefined || name === '' || isPseudonym(name)) return name ?? null;
    if (!memo.has(name)) memo.set(name, pseudonym(key, name));
    return memo.get(name);
  };
}

/**
 * The match with pseudonyms, and without what points to the platform or the game on it: the site, its match id, the time, the event, the
 * round, the ratings and the remarks (they often quote handles). Positions, dice, cube and results are unchanged, so is the identity.
 * The result is meant for writeMat, then read again (validation fills the rest).
 */
export function pseudonymizeMatch(match, nameOf) {
  return {
    ...match,
    sides: match.sides.map((s) => ({ name: nameOf(s.name ?? null) })),
    time: null, event: null, round: null, remarks: [],
    provenance: { ...match.provenance, site: null, siteMatchId: null },
  };
}

/**
 * A checked contribution (a result of analyzeGroup, status new or partial) as it will be sent, with pseudonyms: the normalised .mat written
 * from the match with the names replaced and the platform, time, event, round, ratings and remarks left out, read again to check that it is
 * the same match; the SGF and XG files rewritten the same way. The original files are never sent. An attachment that cannot be rewritten
 * cleanly is left out, with a note. Used by the Contribute page and by `bgdb hide-names`.
 * @returns {Promise<{match:object, normalised:string, players:string[], attachments:{kind:string, ext:string, bytes:Uint8Array}[], notes:string[]}>}
 */
export async function hideNames(res, nameOf) {
  const salvage = res.status === 'partial';
  const normalised = writeMat(pseudonymizeMatch(res.match, nameOf));
  const back = readMatch(normalised, { salvage });
  if (!back.ok || contentHash(back.match) !== res.full) throw new Error('the match with the new names does not read back to the same match (please report this file)');
  const attachments = [];
  const notes = [];
  // the attachments the check kept (the same match, verified); a partial match has none
  for (const a of res.attachments ?? []) {
    const label = `The ${a.kind.toUpperCase()} file ${a.name}`;
    if (!a.verified) { notes.push(`${label} was left out: it could not be read, so its names cannot be replaced.`); continue; }
    try {
      const bytes = a.kind === 'sgf' ? new TextEncoder().encode(rewriteSgf(new TextDecoder().decode(a.bytes), nameOf)) : await rewriteXg(a.bytes, nameOf);
      const r = readMatchBytes(bytes);
      if (!r.ok || contentHash(r.match) !== res.full) throw new Error('it no longer reads back to the same match');
      attachments.push({ kind: a.kind, ext: `.${a.kind}`, bytes });
    } catch (e) {
      notes.push(`${label} was left out: its names could not be replaced (${e.message}).`);
    }
  }
  return { match: back.match, normalised, players: back.match.sides.map((x) => x.name), attachments, notes };
}

// ---------------------------------------------------------------- SGF

/** SGF properties kept as they are; every other one is dropped (names of events, places, users, comments, ranks...) */
const SGF_KEEP = new Set(['FF', 'GM', 'CA', 'MI', 'RU', 'RE', 'GS', 'A', 'DA', 'LU', 'MR', 'GB', 'B', 'W', 'AE', 'AB', 'AW', 'PL', 'CO', 'CV', 'CR', 'DI']);
const PROGRAMS = /^(GNU Backgammon|eXtreme Gammon|BGBlitz|Backgammon Studio)/i;
const sgfValue = (v) => v.replace(/\\(.)/gs, '$1');
const sgfEscape = (v) => v.replace(/[\\\]]/g, (c) => `\\${c}`);

/**
 * An SGF file with pseudonyms (PB, PW), the date only (DT), the program kept when it is one (AP), and everything else that is not the game
 * or its analysis dropped.
 * @returns {string}
 */
export function rewriteSgf(text, nameOf) {
  let out = '';
  let i = 0;
  const n = text.length;
  const ws = (k) => { while (k < n && /\s/.test(text[k])) k++; return k; };
  while (i < n) {
    if (!/[A-Za-z]/.test(text[i])) { out += text[i++]; continue; }
    let j = i;
    while (j < n && /[A-Za-z]/.test(text[j])) j++;
    let k = ws(j);
    if (text[k] !== '[') { out += text.slice(i, j); i = j; continue; }
    const id = text.slice(i, j).replace(/[a-z]/g, '');                 // FF[4] style; old lower-case letters are ignored
    const values = [];
    while (text[k] === '[') {
      let v = '';
      k++;
      while (k < n && text[k] !== ']') { if (text[k] === '\\' && k + 1 < n) { v += text[k] + text[k + 1]; k += 2; } else v += text[k++]; }
      k++;
      values.push(v);
      const next = ws(k);
      if (text[next] === '[') k = next; else break;
    }
    i = k;
    if (id === 'PB' || id === 'PW') out += `${id}[${sgfEscape(nameOf(sgfValue(values[0])) ?? '')}]`;
    else if (id === 'DT') { const d = sgfValue(values[0]).match(/^\d{4}-\d{2}-\d{2}/); if (d) out += `DT[${d[0]}]`; }
    else if (id === 'AP') { if (PROGRAMS.test(sgfValue(values[0]))) out += `AP${values.map((v) => `[${v}]`).join('')}`; }
    else if (SGF_KEEP.has(id)) out += `${id}${values.map((v) => `[${v}]`).join('')}`;
  }
  return out;
}

// ---------------------------------------------------------------- XG

const HEADER = 8232;                    // the RGMH header: UTF-16 strings of 1024 characters at 40 (game name), 2088 (save name), 6184 (comments)
const IDX = 532;
const REC = 2560;
const RGMH_TEXTS = [40, 2088, 6184];
const RGMH_TEXT_BYTES = 2048;
// the match header (first record of temp.xg and of its copy temp.xgi), docs/formats/xg-binary.md
const P_NAMES = [9, 50];                // player names, Pascal strings of at most 40 bytes
const P_OTHER = [136, 283, 417];        // event, place (the platform), round: Pascal strings of at most 128 bytes
const U_NAMES = [880, 1138];            // player names, UTF-16, 129 characters
const U_OTHER = [1396, 1654, 1912, 2170]; // place, round, annotator, transcriber: UTF-16, 129 characters
const U_BYTES = 258;
const DATE_AT = 128;

const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const setU32 = (b, o, v) => { b[o] = v & 255; b[o + 1] = (v >>> 8) & 255; b[o + 2] = (v >>> 16) & 255; b[o + 3] = (v >>> 24) & 255; };

function readArchive(bytes) {
  if (bytes.length < HEADER + 36 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'RGMH') throw new Error('not an eXtreme Gammon file (no RGMH header)');
  const trailer = bytes.slice(bytes.length - 36);
  const regSize = u32(trailer, 12);
  const idxStart = bytes.length - 36 - regSize;
  const archStart = idxStart - u32(trailer, 16);
  if (archStart < HEADER || crc32(bytes.subarray(archStart, bytes.length - 36)) !== u32(trailer, 0)) throw new Error('the archive of the file does not match its checksum');
  const index = inflateZlib(bytes, idxStart).out;
  const count = u32(trailer, 4);
  if (index.length !== count * IDX) throw new Error('unexpected archive index size');
  const files = [];
  for (let k = 0; k < count; k++) {
    const rec = index.subarray(k * IDX, (k + 1) * IDX);
    const data = inflateZlib(bytes, archStart + u32(rec, 520)).out;
    if (data.length !== u32(rec, 512) || crc32(data) !== u32(rec, 524)) throw new Error(`file ${k} of the archive: its size or checksum does not match`);
    files.push({ rec, data });
  }
  return { head: bytes.slice(0, archStart), index, files, trailer };
}

async function deflateZlib(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const latin1 = (s) => Uint8Array.from(s, (c) => (c.charCodeAt(0) < 256 ? c.charCodeAt(0) : 63));
/** a Pascal string, decoded as the reader does (packages/core/src/xg.js), so that a name gets the same pseudonym in the .xg and in its text twin */
function pascalAt(b, o, max) {
  const bytes = b.subarray(o + 1, o + 1 + Math.min(b[o], max));
  let s;
  try { s = new TextDecoder('windows-1252').decode(bytes); } catch { s = String.fromCharCode(...bytes); }
  return s.replace(/\0.*$/s, '').trim();
}
function writePascal(b, o, max, s) { b.fill(0, o, o + 1 + max); const x = latin1(s).subarray(0, max); b[o] = x.length; b.set(x, o + 1); }
function writeUtf16(b, o, chars, s) { b.fill(0, o, o + chars * 2); for (let i = 0; i < Math.min(s.length, chars - 1); i++) { const c = s.charCodeAt(i); b[o + 2 * i] = c & 255; b[o + 2 * i + 1] = c >> 8; } }
/** a Pascal string with printable characters only: what a text field looks like (checked before a field is blanked) */
const looksPascal = (b, o, max) => b[o] <= max && [...b.subarray(o + 1, o + 1 + b[o])].every((c) => c >= 32);
/** a UTF-16 text that ends within its field */
function looksUtf16(b, o, chars) {
  for (let i = 0; i < chars; i++) { const c = b[o + 2 * i] | (b[o + 2 * i + 1] << 8); if (c === 0) return true; if (c < 32) return false; }
  return false;
}

/** whole-token occurrences of a text (latin1 and UTF-16, any case) in bytes; letters, digits and "_" make a token */
function contains(bytes, s) {
  const word = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
  const low = (c) => (c >= 65 && c <= 90 ? c + 32 : c);
  for (const step of [1, 2]) {
    const pat = [...latin1(s.toLowerCase())];
    const L = pat.length * step;
    for (let i = 0; i + L <= bytes.length; i++) {
      let ok = true;
      for (let j = 0; j < pat.length && ok; j++) ok = low(bytes[i + j * step]) === pat[j] && (step === 1 || bytes[i + j * step + 1] === 0);
      if (!ok) continue;
      const before = i >= step ? bytes[i - step] : 0;
      const after = i + L < bytes.length ? bytes[i + L] : 0;
      if (!word(before) && !word(after)) return true;
    }
  }
  return false;
}

/**
 * An .xg file with pseudonyms: the player names written in their fields (the whole field is cleared: XG leaves the end of an older,
 * longer name behind the new one), the event, the place (the platform), the round, the annotator, the transcriber, the game name and the
 * comments of the header blanked, and the time of day removed from the date. Each file of the archive is compressed again and the index and
 * checksums recomputed. The old names must then be gone from the whole file, or nothing is returned.
 * @returns {Promise<Uint8Array>}
 * @throws {Error} the file is of an unknown layout, or a name is still in it
 */
export async function rewriteXg(bytes, nameOf) {
  const { head, index, files, trailer } = readArchive(bytes);
  const gone = new Set();                                       // what must not be found anywhere afterwards
  for (const o of RGMH_TEXTS) head.fill(0, o, o + RGMH_TEXT_BYTES);
  let headers = 0;
  for (const { data } of files) {
    if (data.length < REC || data[8] !== 0) continue;            // only the match header (record type 0)
    const names = P_NAMES.map((o) => pascalAt(data, o, 40));
    if (!names[0] && !names[1]) continue;
    headers++;
    for (const [i, o] of P_NAMES.entries()) {
      const fresh = nameOf(names[i] || null) ?? '';
      if (names[i] && names[i] !== fresh) gone.add(names[i]);
      writePascal(data, o, 40, fresh);
    }
    for (const [i, o] of U_NAMES.entries()) {
      const old = String.fromCharCode(...new Uint16Array(data.slice(o, o + U_BYTES).buffer)).replace(/\0.*$/s, '');
      if (old && old !== nameOf(old)) gone.add(old);
      writeUtf16(data, o, U_BYTES / 2, nameOf(names[i] || null) ?? '');
    }
    for (const o of P_OTHER) {
      if (!looksPascal(data, o, 128)) continue;
      const old = pascalAt(data, o, 128);
      if (old.length >= 3 && !PROGRAMS.test(old)) gone.add(old);          // "eXtreme Gammon" is written in many places of every file
      writePascal(data, o, 128, '');
    }
    for (const o of U_OTHER) if (looksUtf16(data, o, U_BYTES / 2)) writeUtf16(data, o, U_BYTES / 2, '');
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const day = dv.getFloat64(DATE_AT, true);
    if (day > 20000 && day < 80000) dv.setFloat64(DATE_AT, Math.floor(day), true);
  }
  if (!headers) throw new Error('the players of this eXtreme Gammon file could not be found');

  const parts = [];
  let start = 0;
  for (const { rec, data } of files) {
    const comp = await deflateZlib(data);
    setU32(rec, 516, comp.length);
    setU32(rec, 520, start);
    setU32(rec, 524, crc32(data));
    parts.push(comp);
    start += comp.length;
  }
  const idxComp = await deflateZlib(index);
  const total = head.length + start + idxComp.length + 36;
  const out = new Uint8Array(total);
  out.set(head, 0);
  let p = head.length;
  for (const c of parts) { out.set(c, p); p += c.length; }
  out.set(idxComp, p);
  p += idxComp.length;
  setU32(trailer, 0, crc32(out.subarray(head.length, p)));
  setU32(trailer, 12, idxComp.length);
  setU32(trailer, 16, start);
  out.set(trailer, p);

  // the safety net: the old names and the platform must be gone from the header and from every file of the archive
  const probe = [...gone].filter((s) => s.trim().length >= 3);
  for (const s of probe) {
    if (contains(out.subarray(0, HEADER), s) || files.some(({ data }) => contains(data, s))) throw new Error(`a name ("${s.slice(0, 2)}…") is still in the file after the rewrite`);
  }
  return out;
}
