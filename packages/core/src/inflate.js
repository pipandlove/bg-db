/**
 * A small synchronous inflate (RFC 1951) and zlib (RFC 1950) reader, after the reference "puff" decoder. It lets the core library read the
 * compressed streams inside an eXtreme Gammon file in the browser and in Node alike, without a dependency and without the asynchronous
 * browser API. Tested against node:zlib.
 */
import { BgdbError } from './errors.js';

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

const bad = (msg) => new BgdbError('V-FORMAT', `The compressed data is damaged (${msg})`);

function huffman(lengths, n) {
  const count = new Uint16Array(16);
  const symbol = new Uint16Array(n);
  for (let i = 0; i < n; i++) count[lengths[i]]++;
  const offs = new Uint16Array(16);
  for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + count[len];
  for (let i = 0; i < n; i++) if (lengths[i] !== 0) symbol[offs[lengths[i]]++] = i;
  return { count, symbol };
}

let FIXED = null;
function fixedTables() {
  if (FIXED) return FIXED;
  const l = new Uint8Array(288);
  for (let i = 0; i < 144; i++) l[i] = 8;
  for (let i = 144; i < 256; i++) l[i] = 9;
  for (let i = 256; i < 280; i++) l[i] = 7;
  for (let i = 280; i < 288; i++) l[i] = 8;
  FIXED = { lit: huffman(l, 288), dist: huffman(new Uint8Array(30).fill(5), 30) };
  return FIXED;
}

/**
 * @param {Uint8Array} src
 * @param {number} [start] offset of the raw deflate data
 * @param {number} [maxOut] refuse to produce more bytes than this (a small archive that expands enormously)
 * @returns {{out:Uint8Array, end:number}} end = offset of the first byte after the data
 */
export function inflateRaw(src, start = 0, maxOut = Infinity) {
  let pos = start;
  let bitBuf = 0;
  let bitCnt = 0;
  let out = new Uint8Array(Math.max(1024, (src.length - start) * 4));
  let outPos = 0;
  const bits = (need) => {
    let v = bitBuf;
    while (bitCnt < need) {
      if (pos >= src.length) throw bad('unexpected end');
      v |= src[pos++] << bitCnt;
      bitCnt += 8;
    }
    bitBuf = v >>> need;
    bitCnt -= need;
    return v & ((1 << need) - 1);
  };
  const decode = (h) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= bits(1);
      const c = h.count[len];
      if (code - c < first) return h.symbol[index + (code - first)];
      index += c;
      first += c;
      first <<= 1;
      code <<= 1;
    }
    throw bad('bad code');
  };
  const ensure = (n) => {
    if (outPos + n <= out.length) return;
    if (outPos + n > maxOut) throw bad(`more than ${maxOut} bytes`);
    const bigger = new Uint8Array(Math.max(out.length * 2, outPos + n));
    bigger.set(out.subarray(0, outPos));
    out = bigger;
  };
  const codes = (lit, dist) => {
    for (;;) {
      let sym = decode(lit);
      if (sym < 256) { ensure(1); out[outPos++] = sym; continue; }
      if (sym === 256) return;
      sym -= 257;
      if (sym >= 29) throw bad('bad length');
      const len = LBASE[sym] + bits(LEXT[sym]);
      const ds = decode(dist);
      if (ds >= 30) throw bad('bad distance');
      const d = DBASE[ds] + bits(DEXT[ds]);
      if (d > outPos) throw bad('distance too far');
      ensure(len);
      for (let i = 0; i < len; i++) { out[outPos] = out[outPos - d]; outPos++; }
    }
  };

  let last;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitBuf = 0; bitCnt = 0;
      if (pos + 4 > src.length) throw bad('unexpected end');
      const len = src[pos] | (src[pos + 1] << 8);
      if ((len ^ 0xffff) !== (src[pos + 2] | (src[pos + 3] << 8))) throw bad('stored block length');
      pos += 4;
      if (pos + len > src.length) throw bad('unexpected end');
      ensure(len);
      out.set(src.subarray(pos, pos + len), outPos);
      outPos += len; pos += len;
    } else if (type === 1) {
      const f = fixedTables();
      codes(f.lit, f.dist);
    } else if (type === 2) {
      const nlen = bits(5) + 257;
      const ndist = bits(5) + 1;
      const ncode = bits(4) + 4;
      if (nlen > 286 || ndist > 30) throw bad('too many codes');
      const lengths = new Uint8Array(320);
      for (let i = 0; i < ncode; i++) lengths[ORDER[i]] = bits(3);
      const lencode = huffman(lengths.subarray(0, 19), 19);
      let idx = 0;
      const all = new Uint8Array(320);
      while (idx < nlen + ndist) {
        let sym = decode(lencode);
        if (sym < 16) all[idx++] = sym;
        else {
          let len = 0;
          let rep;
          if (sym === 16) { if (idx === 0) throw bad('repeat with nothing before'); len = all[idx - 1]; rep = 3 + bits(2); }
          else if (sym === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          if (idx + rep > nlen + ndist) throw bad('too many lengths');
          while (rep--) all[idx++] = len;
        }
      }
      if (all[256] === 0) throw bad('no end-of-block code');
      codes(huffman(all.subarray(0, nlen), nlen), huffman(all.subarray(nlen, nlen + ndist), ndist));
    } else throw bad('bad block type');
  } while (!last);
  return { out: out.slice(0, outPos), end: pos };
}

/** a zlib stream (2-byte header, deflate data, 4-byte checksum) that starts at `start` */
export function inflateZlib(src, start = 0) {
  const cmf = src[start];
  const flg = src[start + 1];
  if (cmf === undefined || (cmf & 0x0f) !== 8 || ((cmf << 8) | flg) % 31 !== 0 || (flg & 0x20)) throw bad('not a zlib stream');
  const r = inflateRaw(src, start + 2);
  return { out: r.out, end: Math.min(src.length, r.end + 4) };
}
