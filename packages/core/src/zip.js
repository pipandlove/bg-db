/**
 * Reading a ZIP archive of match files: the Contribute page hands its files over as a ZIP, and contributors upload it as it is.
 * Only what such an archive needs: stored and deflated entries, read from the central directory, each checked against its CRC32.
 * The archive is data from a stranger, so it is read defensively: limits on the number of entries and on the sizes (a small archive must
 * not expand into gigabytes), no encrypted or ZIP64 entries, and only a plain file name is kept from each entry (no folders, no "..").
 */
import { inflateRaw } from './inflate.js';

export const ZIP_LIMITS = { maxEntries: 500, maxEntryBytes: 10 * 1024 * 1024, maxTotalBytes: 50 * 1024 * 1024 };

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** names that archivers add and that are never part of a contribution */
const NOISE = /(^|\/)(__MACOSX\/|\.DS_Store$|Thumbs\.db$|desktop\.ini$)/i;

/**
 * @param {Uint8Array} bytes
 * @param {Partial<typeof ZIP_LIMITS>} [limits]
 * @returns {{ok:boolean, error?:string, entries:{name:string, bytes:Uint8Array}[], skipped:string[]}}
 *   entries: the files, by their plain name; skipped: folders and archiver noise left out. error: why the archive cannot be used (then no entry).
 */
export function readZip(bytes, limits = {}) {
  const L = { ...ZIP_LIMITS, ...limits };
  const fail = (error) => ({ ok: false, error, entries: [], skipped: [] });
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o) => dv.getUint16(o, true);
  const u32 = (o) => dv.getUint32(o, true);
  // the end of central directory record: the last 22 bytes, or earlier when the archive has a comment
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (u32(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return fail('it is not a ZIP archive');
  const count = u16(eocd + 10);
  const cdSize = u32(eocd + 12);
  const cdStart = u32(eocd + 16);
  if (count === 0xffff || cdStart === 0xffffffff) return fail('it is a ZIP64 archive, which is not read');
  if (count > L.maxEntries) return fail(`it holds ${count} entries (at most ${L.maxEntries})`);
  if (cdStart + cdSize > eocd) return fail('its directory is damaged');
  const entries = [];
  const skipped = [];
  const seen = new Set();
  let total = 0;
  let p = cdStart;
  for (let n = 0; n < count; n++) {
    if (p + 46 > eocd || u32(p) !== 0x02014b50) return fail('its directory is damaged');
    const flags = u16(p + 8);
    const method = u16(p + 10);
    const crc = u32(p + 16);
    const csize = u32(p + 20);
    const size = u32(p + 24);
    const nameLen = u16(p + 28);
    const extraLen = u16(p + 30);
    const commentLen = u16(p + 32);
    const local = u32(p + 42);
    const rawName = bytes.subarray(p + 46, p + 46 + nameLen);
    // bit 11: the name is UTF-8; otherwise the old DOS code page, read as Latin-1 (match file names are plain anyway)
    const name = flags & 0x800 ? new TextDecoder('utf-8', { fatal: false }).decode(rawName) : String.fromCharCode(...rawName);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || NOISE.test(name)) { skipped.push(name); continue; }
    if (flags & 1) return fail(`${name} is encrypted`);
    if (csize === 0xffffffff || size === 0xffffffff || local === 0xffffffff) return fail('it is a ZIP64 archive, which is not read');
    const base = name.split(/[\\/]/).pop();
    if (!base || base === '.' || base === '..' || /[\u0000-\u001f]/.test(base)) return fail(`an entry has an unusable name (${JSON.stringify(name)})`);
    if (seen.has(base)) return fail(`two entries are named ${base}`);
    seen.add(base);
    if (size > L.maxEntryBytes) return fail(`${base} is ${size} bytes (at most ${L.maxEntryBytes})`);
    total += size;
    if (total > L.maxTotalBytes) return fail(`its files add up to more than ${L.maxTotalBytes} bytes`);
    if (local + 30 > bytes.length || u32(local) !== 0x04034b50) return fail(`${base}: its data is damaged`);
    const start = local + 30 + u16(local + 26) + u16(local + 28);
    if (start + csize > bytes.length) return fail(`${base}: its data is cut short`);
    const raw = bytes.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) {
      try { data = inflateRaw(raw, 0, size).out; } catch { return fail(`${base}: its compressed data is damaged`); }
    } else return fail(`${base} uses a compression method that is not read (${method})`);
    if (data.length !== size || crc32(data) !== crc) return fail(`${base}: its data is damaged (the checksum does not match)`);
    entries.push({ name: base, bytes: data });
  }
  return { ok: true, entries, skipped };
}
