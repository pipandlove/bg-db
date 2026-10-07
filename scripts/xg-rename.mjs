#!/usr/bin/env node
/**
 * Replace player names inside eXtreme Gammon .xg files (anonymising a fixture), keeping each file a valid XG archive.
 *
 *   node scripts/xg-rename.mjs --map <names.json> <file.xg>... [--write]
 *
 * names.json: [["Real Name", "Pseudonym"], ...] or {"Real Name": "Pseudonym", ...}. Each pseudonym must have the length of the name it
 * replaces (fixed-width fields stay as they are, and a text twin keeps its column alignment). The mapping holds real names: it is refused
 * when it lives inside the repository. Without --write, nothing is written: the command says what it would replace (decision 0010).
 *
 * Layout (docs/formats/xg-binary.md): the RGMH header (8232 bytes, UTF-16 strings such as the game title) and a thumbnail, then an archive of
 * zlib-compressed files, a compressed index and a 36-byte trailer.
 *   index record (532 bytes): name, path, uncompressed size @512, compressed size @516, start @520 (from the archive start), CRC32 of the
 *                             uncompressed file @524
 *   trailer: CRC32 of archive + compressed index @0, file count @4, version @8, compressed index size @12, archive size @16, the rest kept
 * The names sit in the header and in the first 2560-byte record of each file (Pascal strings at 9 and 50, UTF-16 at 880 and 1138): they are
 * replaced there only, so that a short name cannot match bytes of the analysis. Each file is recompressed, and the index and trailer recomputed.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HEADER = 8232;
const IDX = 532;
const REC = 2560;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const word = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;

/** replace whole-token occurrences of each name in buf (encoded as latin1 or utf16le), in place; @returns the number replaced */
function replaceIn(buf, pairs, enc) {
  const step = enc === 'utf16le' ? 2 : 1;
  const at = (i) => (step === 2 ? buf.readUInt16LE(i) : buf[i]);
  let n = 0;
  for (const [a, b] of pairs) {
    const A = Buffer.from(a, enc);
    const B = Buffer.from(b, enc);
    if (A.length !== B.length) throw new Error(`"${a}" and "${b}" do not have the same length`);
    for (let i = buf.indexOf(A); i >= 0; i = buf.indexOf(A, i + 1)) {
      if (i % step) continue;
      if ((i >= step && word(at(i - step))) || (i + A.length + step <= buf.length && word(at(i + A.length)))) continue;
      B.copy(buf, i);
      n++;
    }
  }
  return n;
}

/** the archive of an .xg file, checked against its own sizes and CRCs */
function readArchive(bytes) {
  const b = Buffer.from(bytes);
  if (b.length < HEADER + 36 || b.toString('latin1', 0, 4) !== 'RGMH') throw new Error('not an eXtreme Gammon file (no RGMH header)');
  const trailer = b.subarray(b.length - 36);
  const regSize = trailer.readUInt32LE(12);
  const idxStart = b.length - 36 - regSize;
  const archStart = idxStart - trailer.readUInt32LE(16);
  if (archStart < HEADER || zlib.crc32(b.subarray(archStart, b.length - 36)) !== trailer.readUInt32LE(0)) throw new Error('the archive CRC does not match: the file is damaged or of another layout');
  const index = Buffer.from(zlib.inflateSync(b.subarray(idxStart, idxStart + regSize)));
  const count = trailer.readUInt32LE(4);
  if (index.length !== count * IDX) throw new Error('unexpected archive index size');
  const files = [];
  for (let k = 0; k < count; k++) {
    const rec = index.subarray(k * IDX, (k + 1) * IDX);
    const s = archStart + rec.readUInt32LE(520);
    const data = Buffer.from(zlib.inflateSync(b.subarray(s, s + rec.readUInt32LE(516))));
    if (data.length !== rec.readUInt32LE(512) || zlib.crc32(data) !== rec.readUInt32LE(524)) throw new Error(`file ${k} of the archive: size or CRC does not match`);
    files.push({ rec, data });
  }
  return { head: Buffer.from(b.subarray(0, archStart)), index, files, trailer: Buffer.from(trailer) };
}

/**
 * @param {Uint8Array} bytes an .xg file
 * @param {Array<[string, string]>} pairs names and their pseudonyms (same length)
 * @returns {{bytes: Buffer, replaced: number}} the rewritten file
 */
export function rewriteXg(bytes, pairs) {
  pairs = [...pairs].sort((x, y) => y[0].length - x[0].length);           // "Dirk Smith" before "Smith"
  const { head, index, files, trailer } = readArchive(bytes);
  let replaced = replaceIn(head.subarray(0, HEADER), pairs, 'utf16le');
  const parts = [];
  let start = 0;
  for (const { rec, data } of files) {
    const first = data.subarray(0, Math.min(REC, data.length));
    replaced += replaceIn(first.subarray(0, 880), pairs, 'latin1') + replaceIn(first.subarray(880), pairs, 'utf16le');
    const comp = zlib.deflateSync(data, { level: 9 });
    rec.writeUInt32LE(comp.length, 516);
    rec.writeUInt32LE(start, 520);
    rec.writeUInt32LE(zlib.crc32(data), 524);
    parts.push(comp);
    start += comp.length;
  }
  const idxComp = zlib.deflateSync(index, { level: 9 });
  const body = Buffer.concat([...parts, idxComp]);
  trailer.writeUInt32LE(zlib.crc32(body), 0);
  trailer.writeUInt32LE(idxComp.length, 12);
  trailer.writeUInt32LE(start, 16);
  return { bytes: Buffer.concat([head, body, trailer]), replaced };
}

/** where the names still appear (whole tokens, latin1 or UTF-16) in the header and anywhere in the decompressed files; [] when none */
export function leftovers(bytes, names) {
  const { head, files } = readArchive(bytes);
  const probe = names.filter((a) => a.length >= 3).map((a) => [a, '\u0001'.repeat(a.length)]);   // shorter ones would match analysis bytes
  const found = [];
  for (const [where, buf] of [['header', head.subarray(0, HEADER)], ...files.map((f, k) => [`file ${k}`, f.data])]) {
    for (const enc of ['latin1', 'utf16le']) if (replaceIn(Buffer.from(buf), probe, enc)) found.push(`${where} (${enc})`);
  }
  return found;
}

export function readMap(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pairs = Array.isArray(raw) ? raw : Object.entries(raw);
  for (const p of pairs) {
    if (!Array.isArray(p) || p.length !== 2 || typeof p[0] !== 'string' || typeof p[1] !== 'string' || !p[0]) throw new Error(`${file}: each entry must be ["name", "pseudonym"]`);
    if (p[0].length !== p[1].length) throw new Error(`${file}: "${p[0]}" and "${p[1]}" do not have the same length`);
  }
  return pairs;
}

/** @returns {number} exit code: 0 done, 1 a file could not be rewritten cleanly, 2 bad usage */
export function main(argv, io = { out: (s) => console.log(s), err: (s) => console.error(s) }, repo = REPO) {
  const write = argv.includes('--write');
  const mi = argv.indexOf('--map');
  const files = argv.filter((a, i) => a !== '--write' && i !== mi && i !== mi + 1);
  if (mi < 0 || !argv[mi + 1] || files.length === 0) { io.err('Usage: node scripts/xg-rename.mjs --map <names.json> <file.xg>... [--write]'); return 2; }
  const mapFile = path.resolve(argv[mi + 1]);
  if (!path.relative(repo, mapFile).startsWith('..')) { io.err(`The mapping ${argv[mi + 1]} holds real names: keep it outside the repository.`); return 2; }
  let pairs;
  try { pairs = readMap(mapFile); } catch (e) { io.err(e.message); return 2; }
  let bad = 0;
  for (const f of files) {
    try {
      const { bytes, replaced } = rewriteXg(fs.readFileSync(f), pairs);
      const left = leftovers(bytes, pairs.map(([a]) => a));
      if (left.length) { bad++; io.out(`LEFT   ${f}: ${replaced} replaced, a name is still in ${left.join(', ')}; not written`); continue; }
      if (write && replaced) fs.writeFileSync(f, bytes);
      io.out(`${replaced ? (write ? 'DONE ' : 'WOULD') : 'NONE '}  ${f}: ${replaced} name(s)`);
    } catch (e) { bad++; io.out(`ERROR  ${f}: ${e.message}`); }
  }
  if (!write) io.out('\nDry run: nothing was written (add --write).');
  return bad ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
