/**
 * bgdb build: produce the deployable site folder from data/ (spec sections 5 and 7).
 *
 *   <out>/registry.json
 *   <out>/data/<shard>/shard.json            identity + summary (date range, lengths, events, player Bloom filter)
 *   <out>/data/<shard>/manifest.json         index files with size and SHA-256
 *   <out>/data/<shard>/index/catalog.<h8>.json.gz
 *   <out>/data/<shard>/matches/<h2>/<hash>.{mat,meta.json}       (the replay data is derived from the .mat in the browser)
 *   <out>/data/<shard>/attachments/<h2>/<hash>.{sgf,xg}          original GNU Backgammon / eXtreme Gammon files
 *   <out>/overlays/enrichments.<h8>.json.gz  video links, tags and attachments added to existing matches, corrections of their event, round
 *                                            and date (applied by the site)
 *   <out>/overlays/files/...                 the attachments of those enrichments
 *   <out>/sources.json                       the data repositories the site reads (when --sources is given, decision 0024)
 *   <out>/.nojekyll                          so that GitHub Pages serves everything unchanged
 *   <out>/...                                the contents of site/ (when --site is given)
 *   <out>/lib/core/*.js                      a copy of packages/core/src, imported by the site as ES modules
 *
 * The output is deterministic: no timestamps, sorted keys and rows, gzip header normalised.
 * An open shard is read in full (every match is parsed and checked against its hash and result) so that a damaged shard cannot be published.
 * A sealed shard that still matches the digest recorded when it was sealed is trusted: its matches are not read again.
 * A match file already checked by an earlier build, with the same bytes, the same recorded hash and result, and the same code of
 * packages/core, is not read again either: the build cache (decision 0024) remembers it, outside the output folder.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { readMatch, contentHash, sha256Hex, normalizeName, makeBloom, checkSources } from '@bgdb/core';
import { listShards, readMetas, matchPaths, attachmentPath, treeDigest, checkExternalShards, loadHashIndex } from './store.js';
import { listEnrichments, enrichmentPaths } from './enrich.js';

const CORE_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../core/src');
export const CATALOG_VERSION = 2;       // 2: adds the round (dict.rounds, column rd); readers of version 1 ignore them
export const FLAG = { GAMMON: 1, CUBE: 2, ANALYSIS: 4, ABANDONED: 8, ATTACHMENT: 16, VIDEO: 32, ILLEGAL: 64 };

const gz = (text) => {
  const b = zlib.gzipSync(Buffer.from(text), { level: 9 });
  b[9] = 3;                                                       // header "OS" byte: same bytes on every platform
  return b;
};
const hex = (buf) => sha256Hex(new Uint8Array(buf));

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === '.DS_Store') continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

export function catalogFlags(meta) {
  let f = 0;
  for (const g of meta.games) {
    if (g.kind !== 'single') f |= FLAG.GAMMON;
    if (g.cube > 1) f |= FLAG.CUBE;
    if (g.how === 'resign' || g.how === 'forfeit') f |= FLAG.ABANDONED;   // 'forfeit' only in records written by version 0.2
  }
  const atts = meta.attachments ?? [];
  if (atts.length) f |= FLAG.ATTACHMENT;
  if (atts.some((a) => a.analysis === true)) f |= FLAG.ANALYSIS;
  if ((meta.links ?? []).length) f |= FLAG.VIDEO;
  if ((meta.illegalPlays ?? []).length) f |= FLAG.ILLEGAL;
  return f;
}

/** Columnar catalog (spec 7.2): dictionaries for repeated strings, one array per column. Newest first. */
export function buildCatalog(shardId, metas) {
  const rows = metas.slice().sort((a, b) => {
    const da = a.meta.date ?? '';
    const db = b.meta.date ?? '';
    if (da === db) return a.meta.id.localeCompare(b.meta.id);
    if (!da) return 1;                                            // undated matches last
    if (!db) return -1;
    return da < db ? 1 : -1;                                      // newest first
  });
  const dict = { players: [], events: [], rounds: [] };
  const index = { players: new Map(), events: new Map(), rounds: new Map() };
  const idx = (kind, v) => {
    if (v === null || v === undefined || v === '') return -1;
    if (!index[kind].has(v)) { index[kind].set(v, dict[kind].length); dict[kind].push(v); }
    return index[kind].get(v);
  };
  const cols = { id: [], p0: [], p1: [], len: [], date: [], ev: [], rd: [], n: [], s0: [], s1: [], win: [], fl: [] };
  for (const { hash, meta } of rows) {
    cols.id.push(hash);
    cols.p0.push(idx('players', meta.sides[0].name));
    cols.p1.push(idx('players', meta.sides[1].name));
    cols.len.push(meta.matchLength);
    cols.date.push(meta.date ?? '');
    cols.ev.push(idx('events', meta.event));
    cols.rd.push(idx('rounds', meta.round));
    cols.n.push(meta.games.length);
    cols.s0.push(meta.result?.score?.[0] ?? 0);
    cols.s1.push(meta.result?.score?.[1] ?? 0);
    cols.win.push(meta.result?.winner ?? -1);
    cols.fl.push(catalogFlags(meta));
  }
  return { schema: '1.0', type: 'catalog', version: CATALOG_VERSION, shard: shardId, count: rows.length, dict, cols };
}

export function shardSummary(metas) {
  const dates = metas.map((m) => m.meta.date).filter(Boolean).sort();
  const lengths = {};
  for (const { meta } of metas) lengths[meta.matchLength] = (lengths[meta.matchLength] ?? 0) + 1;
  const players = new Set();
  const events = new Set();
  for (const { meta } of metas) {
    for (const s of meta.sides) if (s.name) players.add(normalizeName(s.name));
    if (meta.event) events.add(meta.event);
  }
  return {
    dateRange: dates.length ? [dates[0], dates[dates.length - 1]] : null,
    matchLengths: Object.fromEntries(Object.keys(lengths).sort((a, b) => a - b).map((k) => [k, lengths[k]])),
    events: [...events].sort(),
    players: players.size,
    playerFilter: makeBloom([...players]),
    positionIndexPolicy: 'none',
  };
}

const json = (o) => JSON.stringify(o, null, 2) + '\n';
const fileSha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/** the enrichments of the repository as one overlay (applied by the site on top of the shards), plus the attachment files they bring */
function publishOverlays({ data, out, registry, errors, knownIds }) {
  const items = {};
  for (const { id, record } of listEnrichments(data)) {
    if (!knownIds.has(id)) { errors.push(`enrichment of ${id}: no such match in the database`); continue; }
    const p = enrichmentPaths(data, id);
    const atts = [];
    for (const a of record.attachments ?? []) {
      const from = p.file(a.kind);
      if (!fs.existsSync(from)) { errors.push(`enrichment of ${id}: the ${a.kind.toUpperCase()} file is missing`); continue; }
      if (fileSha(from) !== a.sha256) { errors.push(`enrichment of ${id}: the ${a.kind.toUpperCase()} file does not match its recorded hash`); continue; }
      const rel = `overlays/files/${p.shard}/${p.hash.slice(0, 2)}/${p.hash}.${a.kind}`;
      fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
      fs.copyFileSync(from, path.join(out, rel));
      atts.push({ kind: a.kind, url: rel, bytes: a.bytes, verified: a.verified, analysis: a.analysis, engine: a.engine });
    }
    items[id] = { links: record.links ?? [], tags: record.tags ?? [], attachments: atts, ...(record.meta ? { meta: record.meta } : {}) };
  }
  if (Object.keys(items).length === 0) return;
  const bytes = gz(JSON.stringify({ schema: '1.0', type: 'enrichments', version: 1, items }));
  const name = `overlays/enrichments.${hex(bytes).slice(0, 8)}.json.gz`;
  fs.mkdirSync(path.join(out, 'overlays'), { recursive: true });
  fs.writeFileSync(path.join(out, name), bytes);
  registry.overlays.enrichments = name;
}

/**
 * Check one match file against its sidecar, by reading it in full (parse + validate + hash). Returns an error text or null.
 */
export function verifyMatch(shardDir, hash, meta) {
  const p = matchPaths(shardDir, hash);
  const r = readMatch(fs.readFileSync(p.mat, 'utf8'));
  if (!r.ok) return `${meta.id}: ${r.errors[0].message}`;
  const full = contentHash(r.match);
  if (full !== meta.contentHash || !full.startsWith(hash)) return `${meta.id}: the match file does not match its recorded hash`;
  if (JSON.stringify(r.match.result) !== JSON.stringify(meta.result)) return `${meta.id}: the result in the file differs from the metadata`;
  return null;
}

/** Check the attachments of a match against their recorded hashes. Returns a list of error texts. */
export function verifyAttachments(shardDir, hash, meta) {
  const errs = [];
  for (const a of meta.attachments ?? []) {
    const from = attachmentPath(shardDir, hash, a.kind);
    if (!fs.existsSync(from)) errs.push(`${meta.id}: the ${a.kind.toUpperCase()} attachment is missing`);
    else if (fileSha(from) !== a.sha256) errs.push(`${meta.id}: the ${a.kind.toUpperCase()} attachment does not match its recorded hash`);
  }
  return errs;
}

/**
 * The build cache: what earlier builds checked in full, so that an open shard costs only the matches added since.
 * An entry is the digest of everything verifyMatch depends on (the match file's bytes, its recorded hash and result); the whole cache is
 * dropped when the code of packages/core (parsers, rules, identity) changes, or when CACHE_SCHEMA does (a change of verifyMatch).
 * Only matches that passed are remembered; the output of the build never depends on the cache.
 */
const CACHE_SCHEMA = 1;
let coreVersion = null;
function codeVersion() {
  if (coreVersion) return coreVersion;
  const h = crypto.createHash('sha256').update(`bgdb-build-cache ${CACHE_SCHEMA}\n`);
  for (const f of fs.readdirSync(CORE_SRC).sort()) h.update(`${f}\t${fileSha(path.join(CORE_SRC, f))}\n`);
  return (coreVersion = h.digest('hex'));
}
/** the default place of the cache: next to the data folder, never inside the output */
export const defaultCacheFile = (dataDir) => path.join(path.dirname(path.resolve(dataDir)), '.bgdb-cache', 'build.json');
export function matchCheckKey(shardDir, hash, meta) {
  const p = matchPaths(shardDir, hash);
  return crypto.createHash('sha256').update(fs.readFileSync(p.mat)).update(`\n${meta.contentHash}\n${JSON.stringify(meta.result)}`).digest('hex');
}
function loadCache(file) {
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (c.version === codeVersion() && c.entries && typeof c.entries === 'object') return new Map(Object.entries(c.entries));
  } catch { /* no cache, or an unreadable one: everything is read in full */ }
  return new Map();
}
function saveCache(file, entries) {
  const sorted = Object.fromEntries([...entries].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ version: codeVersion(), entries: sorted }) + '\n');
  fs.renameSync(tmp, file);
}

/**
 * Is a sealed shard unchanged since it was sealed? (the digest recorded at sealing against the files now)
 * @returns {'trusted'|'changed'|'unrecorded'}
 */
export function sealState(shard) {
  if (shard.info.status !== 'sealed' || !shard.info.integrity) return 'unrecorded';
  const d = treeDigest(shard.dir);
  return d.digest === shard.info.integrity.digest && d.files === shard.info.integrity.files ? 'trusted' : 'changed';
}

/**
 * @param {{data:string, out:string, site?:string, sources?:string, config:object, cache?:string|false, onProgress?:(p:{shard:string, done:number, total:number})=>void}} o
 *   cache: the cache file (default: defaultCacheFile(data)), or false for none. onProgress: after each match checked (read in full or found in the cache)
 * @returns {{shards:object[], matches:number, errors:string[], notes:string[], parsed:number, cached:number, trusted:number}}
 */
export function build(o) {
  const out = path.resolve(o.out);
  for (const guard of [o.data, o.site, '.'].filter(Boolean)) {
    const g = path.resolve(guard);
    if (out === g || g.startsWith(out + path.sep)) throw new Error(`Refusing to use "${o.out}" as the output folder: it contains "${guard}"`);
  }
  const shards = listShards(o.data);
  const external = checkExternalShards(o.config.externalShards);
  for (const e of external) if (shards.some((s) => s.id === e.id)) throw new Error(`Shard ${e.id} is both a folder of ${o.data}/ and listed in externalShards: remove one of them`);
  const errors = [];
  const notes = [];
  let parsed = 0;
  let cachedCount = 0;
  let trustedCount = 0;
  const cacheFile = o.cache === false ? null : path.resolve(o.cache ?? defaultCacheFile(o.data));
  if (cacheFile && (cacheFile === out || cacheFile.startsWith(out + path.sep))) throw new Error(`Refusing to keep the build cache "${cacheFile}" inside the output folder "${o.out}": it is deleted at every build`);
  const cache = cacheFile ? loadCache(cacheFile) : new Map();
  // the list of data repositories the site reads: checked here, so that a mistake never reaches the published site
  let sourcesText = null;
  if (o.sources) {
    let j;
    try { j = JSON.parse(fs.readFileSync(o.sources, 'utf8')); } catch (e) { throw new Error(`${o.sources}: ${e.code === 'ENOENT' ? 'no such file' : 'not valid JSON'}`); }
    const c = checkSources(j);
    if (!c.ok) throw new Error(`${o.sources}: ${c.errors.join('; ')}`);
    sourcesText = json(j);
  }
  const checked = new Map();                                      // what the cache will hold after this build: the matches checked now
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const registry = {
    schema: '1.0', name: o.config.name, license: o.config.license, repository: o.config.repository ?? null, defaultBranch: o.config.defaultBranch ?? 'master',
    videoHosts: o.config.videoHosts, capabilities: o.config.capabilities, sealPolicy: o.config.sealPolicy, shards: [], overlays: {},
  };
  let total = 0;

  for (const shard of shards) {
    const metas = readMetas(shard.dir);
    const base = path.join(out, 'data', shard.id);
    // a sealed shard whose files still match the digest recorded at sealing is trusted: no match is read again
    let state = sealState(shard);
    let trusted = state === 'trusted';
    if (state === 'changed') errors.push(`shard ${shard.id}: it is sealed but its files differ from the digest recorded when it was sealed (a sealed shard must not change); every match is checked below`);
    if (state === 'unrecorded' && shard.info.status === 'sealed') notes.push(`shard ${shard.id} is sealed without an integrity record, so every match was read again: run "bgdb verify --record" once to make the next builds faster`);
    for (const [i, { hash, meta }] of metas.entries()) {
      const p = matchPaths(shard.dir, hash);
      if (!trusted) {
        const id = `${shard.id}/${hash}`;
        const key = cacheFile ? matchCheckKey(shard.dir, hash, meta) : null;
        if (key && cache.get(id) === key) cachedCount++;
        else {
          parsed++;
          const bad = verifyMatch(shard.dir, hash, meta);
          if (bad) { errors.push(bad); o.onProgress?.({ shard: shard.id, done: i + 1, total: metas.length }); continue; }
        }
        if (key) checked.set(id, key);
        o.onProgress?.({ shard: shard.id, done: i + 1, total: metas.length });
        const badAtt = verifyAttachments(shard.dir, hash, meta);
        if (badAtt.length) { errors.push(...badAtt); continue; }
      } else trustedCount++;
      const q = matchPaths(base, hash);
      fs.mkdirSync(path.dirname(q.mat), { recursive: true });
      fs.copyFileSync(p.mat, q.mat);
      fs.copyFileSync(p.meta, q.meta);
      for (const a of meta.attachments ?? []) {
        const to = attachmentPath(base, hash, a.kind);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(attachmentPath(shard.dir, hash, a.kind), to);
      }
    }
    total += metas.length;

    const catalog = gz(JSON.stringify(buildCatalog(shard.id, metas)));
    const catalogName = `catalog.${hex(catalog).slice(0, 8)}.json.gz`;
    fs.mkdirSync(path.join(base, 'index'), { recursive: true });
    fs.writeFileSync(path.join(base, 'index', catalogName), catalog);
    const manifest = {
      schema: '1.0',
      files: [{ path: `index/${catalogName}`, type: 'catalog', version: CATALOG_VERSION, hash: hex(catalog), size: catalog.length, encoding: 'gzip' }],
    };
    const manifestText = json(manifest);
    fs.writeFileSync(path.join(base, 'manifest.json'), manifestText);
    const manifestHash = sha256Hex(manifestText).slice(0, 16);
    const counts = { matches: metas.length, games: metas.reduce((n, m) => n + m.meta.games.length, 0) };
    if (shard.info.counts?.bytes !== undefined) counts.bytes = shard.info.counts.bytes;
    fs.writeFileSync(path.join(base, 'shard.json'), json({
      schema: '1.0', id: shard.id, status: shard.info.status, formats: ['mat+meta'], counts,
      summary: shardSummary(metas), indexes: { catalog: `index/${catalogName}` }, manifest: 'manifest.json',
    }));
    registry.shards.push({ id: shard.id, base: `data/${shard.id}/`, status: shard.info.status, matches: counts.matches, manifestHash });
  }
  // shards that live in another repository are only listed: the browser loads them from their own address
  for (const e of external) registry.shards.push({ id: e.id, base: e.base, status: 'sealed', matches: e.matches ?? null, manifestHash: e.manifestHash ?? null, external: true });
  registry.shards.sort((a, b) => (a.id < b.id ? -1 : 1));

  publishOverlays({ data: o.data, out, registry, errors, knownIds: new Set(loadHashIndex(shards, o.data).byFull.values()) });
  fs.writeFileSync(path.join(out, 'registry.json'), json(registry));
  if (sourcesText) fs.writeFileSync(path.join(out, 'sources.json'), sourcesText);
  fs.writeFileSync(path.join(out, '.nojekyll'), '');                 // GitHub Pages: serve the files as they are (no Jekyll processing)
  if (o.site && fs.existsSync(o.site)) copyDir(o.site, out);
  copyDir(CORE_SRC, path.join(out, 'lib', 'core'));                  // the browser uses the same code as the tools (names, rules, parsers)
  if (cacheFile) saveCache(cacheFile, checked);
  return { shards: registry.shards, matches: total, errors, notes, parsed, cached: cachedCount, trusted: trustedCount };
}
