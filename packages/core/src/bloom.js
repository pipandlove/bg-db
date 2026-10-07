/**
 * Small deterministic Bloom filter (spec section 7: per-shard player filter). The same items always give the
 * same bytes, so sealed shards produce identical output when rebuilt.
 * Serialized form: { type:'bloom', bits, hashes, data:<base64> }.
 */
const fnv = (str, seed) => {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};
const positions = (item, bits, hashes) => {
  const h1 = fnv(item, 0);
  const h2 = fnv(item, 0x9e3779b9) | 1;
  const out = [];
  for (let i = 0; i < hashes; i++) out.push(((h1 + Math.imul(i, h2)) >>> 0) % bits);
  return out;
};
const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export function makeBloom(items, { bitsPerItem = 10, hashes = 5, minBits = 256 } = {}) {
  const unique = [...new Set(items)].sort();
  const bits = Math.max(minBits, Math.ceil((unique.length * bitsPerItem) / 8) * 8);
  const bytes = new Uint8Array(bits / 8);
  for (const it of unique) for (const p of positions(it, bits, hashes)) bytes[p >> 3] |= 1 << (p & 7);
  return { type: 'bloom', bits, hashes, data: toB64(bytes) };
}

/** true = possibly present, false = definitely absent */
export function bloomHas(bloom, item) {
  const bytes = fromB64(bloom.data);
  return positions(item, bloom.bits, bloom.hashes).every((p) => (bytes[p >> 3] >> (p & 7)) & 1);
}
