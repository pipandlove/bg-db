/**
 * GNU Backgammon ID encoder/decoder: "<PositionID(14)>:<MatchID(12)>".
 * See docs/formats/gnubgid.md.
 *
 * Position ID: 80 bits = 10 bytes. Bits 0..39 = the player NOT on roll, bits 40..79 = the player on
 * roll, each from its own perspective. For each of the 25 zones (own points 1..24, then the bar) write
 * one 1-bit per checker followed by one 0-bit. Unused bits are zero. Bit k of the stream is bit (k % 8)
 * (LSB first) of byte floor(k / 8). Bytes are written in standard Base64 (padding removed).
 *
 * Match ID: 66 bits = 9 bytes (little-endian bit fields):
 *   0-3 cube exponent | 4-5 cube owner (0/1 = player, 3 = centred) | 6 player on roll | 7 Crawford
 *   8-10 game state (1 = playing) | 11 turn owner | 12 doubled | 13-14 resign | 15-17 die 1 | 18-20 die 2
 *   21-35 match length | 36-50 score of player 0 | 51-65 score of player 1
 * In this library gnubg player index = side index.
 */
import { emptyPosition } from './rules.js';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToB64(bytes, nChars) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  return out.slice(0, nChars);
}

function b64ToBytes(str, nChars, nBytes) {
  if (str.length !== nChars) throw new Error(`GNUBGID: expected ${nChars} characters but found ${str.length}`);
  const bytes = new Array(nBytes).fill(0);
  let bitPos = 0;
  for (const ch of str) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error(`GNUBGID: invalid character "${ch}"`);
    for (let b = 5; b >= 0; b--, bitPos++) {
      const byteIdx = bitPos >> 3;
      if (byteIdx < nBytes && (v >> b) & 1) bytes[byteIdx] |= 1 << (7 - (bitPos & 7));
    }
  }
  return bytes;
}

const getBit = (bytes, k) => (bytes[k >> 3] >> (k & 7)) & 1;
const setBit = (bytes, k) => { bytes[k >> 3] |= 1 << (k & 7); };
function readInt(bytes, start, len) {
  let v = 0;
  for (let i = 0; i < len; i++) if (getBit(bytes, start + i)) v |= 1 << i;
  return v;
}
function writeInt(bytes, start, len, value) {
  for (let i = 0; i < len; i++) if ((value >> i) & 1) setBit(bytes, start + i);
}

function encodeSide(bytes, startBit, own) {
  let k = startBit;
  const zones = [...own.slice(1, 25), own[25]]; // points 1..24 then bar
  for (const n of zones) {
    for (let i = 0; i < n; i++) setBit(bytes, k++);
    k++; // separator 0
  }
}

function decodeSide(bytes, startBit) {
  const own = new Array(26).fill(0);
  let zone = 0;
  for (let k = startBit; k < startBit + 40 && zone < 25; k++) {
    if (getBit(bytes, k)) own[zone === 24 ? 25 : zone + 1]++;
    else zone++;
  }
  return own;
}

/** @param {object} pos @param {{onRoll:number, cube?:number, cubeOwner?:number|null, dice?:number[]|null,
 *   score?:number[], matchLength?:number, crawford?:boolean}} ctx */
export function toPositionId(pos, onRoll) {
  const bytes = new Array(10).fill(0);
  encodeSide(bytes, 0, pos.c[1 - onRoll]);
  encodeSide(bytes, 40, pos.c[onRoll]);
  return bytesToB64(bytes, 14);
}

export function toMatchId(ctx) {
  const bytes = new Array(9).fill(0);
  const exp = Math.log2(ctx.cube ?? 1);
  if (!Number.isInteger(exp) || exp > 15) throw new RangeError('Invalid cube value');
  writeInt(bytes, 0, 4, exp);
  writeInt(bytes, 4, 2, ctx.cubeOwner == null ? 3 : ctx.cubeOwner);
  writeInt(bytes, 6, 1, ctx.onRoll);
  writeInt(bytes, 7, 1, ctx.crawford ? 1 : 0);
  writeInt(bytes, 8, 3, 1); // playing
  writeInt(bytes, 11, 1, ctx.onRoll);
  if (ctx.dice) { writeInt(bytes, 15, 3, ctx.dice[0]); writeInt(bytes, 18, 3, ctx.dice[1]); }
  writeInt(bytes, 21, 15, ctx.matchLength ?? 0);
  const sc = ctx.score ?? [0, 0];
  writeInt(bytes, 36, 15, sc[0]);
  writeInt(bytes, 51, 15, sc[1]);
  return bytesToB64(bytes, 12);
}

export function toGnubgId(pos, ctx) {
  return `${toPositionId(pos, ctx.onRoll)}:${toMatchId(ctx)}`;
}

/** Decode "<positionId>" or "<positionId>:<matchId>". Without a match ID, side 1 is assumed on roll. */
export function parseGnubgId(str) {
  const s = str.trim().replace(/^.*?ID[:=]\s*/i, '');
  const [posStr, matchStr] = s.split(':');
  const pb = b64ToBytes(posStr, 14, 10);
  let onRoll = 1;
  let ctx = { cube: 1, cubeOwner: null, dice: null, score: [0, 0], matchLength: 0, crawford: false };
  if (matchStr) {
    const mb = b64ToBytes(matchStr, 12, 9);
    onRoll = readInt(mb, 6, 1);
    const own = readInt(mb, 4, 2);
    const d1 = readInt(mb, 15, 3);
    const d2 = readInt(mb, 18, 3);
    ctx = {
      cube: 2 ** readInt(mb, 0, 4),
      cubeOwner: own === 3 ? null : own,
      dice: d1 && d2 ? [d1, d2] : null,
      score: [readInt(mb, 36, 15), readInt(mb, 51, 15)],
      matchLength: readInt(mb, 21, 15),
      crawford: readInt(mb, 7, 1) === 1,
    };
  }
  const pos = emptyPosition();
  pos.c[1 - onRoll] = decodeSide(pb, 0);
  pos.c[onRoll] = decodeSide(pb, 40);
  for (const side of [0, 1]) {
    let on = 0;
    for (let p = 1; p <= 25; p++) on += pos.c[side][p];
    pos.off[side] = 15 - on;
  }
  return { pos, ctx: { ...ctx, onRoll } };
}
