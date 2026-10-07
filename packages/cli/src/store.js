/**
 * Reading the repository's data folder: configuration, shards and the sidecar metadata of every match.
 * Layout of a shard folder (spec section 5): shard.json, matches/<h2>/<hash16>.mat, matches/<h2>/<hash16>.meta.json
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const DEFAULT_CONFIG = {
  name: 'BGDB',
  license: 'CC0-1.0',
  repository: null,                // "owner/name" on GitHub: used by the contribute page to link to the upload page and to the issue form
  siteUrl: null,                   // the site of the database (bg-db's Pages): the ingest links the matches it added there in its answer to the contributor
  defaultBranch: 'master',
  sealPolicy: { maxMatches: 5000, maxMB: 300, maxAttachmentKB: 2048 },   // 5 000: the open shard, read in full at each build, stays small (decision 0024)
  videoHosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'],
  capabilities: ['catalog'],
  externalShards: [],              // sealed shards that live in another repository: [{id, base: "https://.../data/0001/", matches?, manifestHash?}]
  // a data repository among several (decision 0024)
  firstShard: null,                // the number of this repository's first shard (shard numbers are global: an earlier repository used those below it)
  repoPolicy: { warnMB: 800, stopMB: 950 },   // the ingest warns above warnMB, and adds nothing above stopMB (GitHub: about 1 GB per repository and per Pages site)
  closed: false,                   // true: this repository takes no more contributions (the review says "closed"), and opens no new shard
};

/** the external shards of the configuration, checked: a wrong entry would break the site for everybody */
export function checkExternalShards(list) {
  const seen = new Set();
  for (const e of list ?? []) {
    if (!e || !/^\d{4,}$/.test(e.id ?? '')) throw new Error(`externalShards: "${e?.id}" is not a shard id (four or more digits)`);
    if (seen.has(e.id)) throw new Error(`externalShards: shard ${e.id} is listed twice`);
    seen.add(e.id);
    if (typeof e.base !== 'string' || !/^https?:\/\/[^\s?#]+\/$/.test(e.base)) throw new Error(`externalShards: the base of shard ${e.id} must be an absolute address ending with "/" (for example https://user.github.io/repo/data/${e.id}/)`);
    if (e.status !== undefined && e.status !== 'sealed') throw new Error(`externalShards: shard ${e.id} must be sealed (an open shard stays in this repository)`);
  }
  return list ?? [];
}

export function loadConfig(file = 'bgdb.config.json') {
  if (!fs.existsSync(file)) return structuredClone(DEFAULT_CONFIG);
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  const config = { ...DEFAULT_CONFIG, ...c, sealPolicy: { ...DEFAULT_CONFIG.sealPolicy, ...(c.sealPolicy ?? {}) }, repoPolicy: { ...DEFAULT_CONFIG.repoPolicy, ...(c.repoPolicy ?? {}) } };
  checkExternalShards(config.externalShards);
  if (config.firstShard !== null && !(Number.isInteger(config.firstShard) && config.firstShard >= 1)) throw new Error(`${file}: "firstShard" must be a whole number from 1 (the number of this repository's first shard)`);
  const { warnMB, stopMB } = config.repoPolicy;
  if (!(warnMB > 0 && stopMB > warnMB)) throw new Error(`${file}: "repoPolicy" needs 0 < warnMB < stopMB (in MB)`);
  if (typeof config.closed !== 'boolean') throw new Error(`${file}: "closed" must be true or false`);
  return config;
}

/**
 * The number of the next shard to open. Shard numbers are global across the data repositories (decision 0024): the next one comes after every
 * number this repository knows of: its own shards, the hash files of shards that live elsewhere (copied from earlier repositories), externalShards.
 * firstShard sets where a new repository starts; it must not reuse a number known from elsewhere.
 */
export function nextShardNumber(shards, dataDir, config) {
  const local = Math.max(0, ...shards.map((s) => parseInt(s.id, 10)));
  const elsewhere = Math.max(0, ...readHashFiles(dataDir).map((f) => parseInt(f.shard, 10)), ...(config.externalShards ?? []).map((e) => parseInt(e.id, 10)));
  if (config.firstShard !== null && config.firstShard !== undefined && config.firstShard <= elsewhere) {
    throw new Error(`"firstShard" is ${shardIdOf(config.firstShard)}, but shard ${shardIdOf(elsewhere)} is already known from another repository (data/hashes or externalShards): shard numbers are global, set firstShard to ${elsewhere + 1} or more`);
  }
  return Math.max(local + 1, elsewhere + 1, config.firstShard ?? 1);
}

/**
 * How big the repository is, as GitHub sees it: the larger of the data folder (what Pages publishes) and the packed git history of the
 * repository that holds it (what GitHub counts; null outside a git repository).
 * @returns {{mb:number, dataMB:number, gitMB:number|null}}
 */
export function repoSize(dataDir) {
  let bytes = 0;
  const rec = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) rec(p); else bytes += fs.statSync(p).size;
    }
  };
  rec(dataDir);
  const dataMB = bytes / (1024 * 1024);
  let gitMB = null;
  const r = fs.existsSync(dataDir) ? spawnSync('git', ['-C', dataDir, 'count-objects', '-v'], { encoding: 'utf8' }) : null;
  if (r && r.status === 0) {
    const kib = (k) => parseInt((r.stdout.match(new RegExp(`^${k}: (\\d+)`, 'm')) ?? [])[1] ?? '0', 10);
    gitMB = (kib('size') + kib('size-pack')) / 1024;
  }
  return { mb: Math.max(dataMB, gitMB ?? 0), dataMB, gitMB };
}

/** ok, warn (time to prepare the next repository) or stop (add nothing more), for a size in MB */
export function repoState(mb, policy) {
  return mb >= policy.stopMB ? 'stop' : mb >= policy.warnMB ? 'warn' : 'ok';
}

export const shardIdOf = (n) => String(n).padStart(4, '0');

/** @returns {{id:string, dir:string, info:object}[]} sorted by id */
export function listShards(dataDir) {
  if (!fs.existsSync(dataDir)) return [];
  return fs.readdirSync(dataDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4,}$/.test(e.name))
    .map((e) => {
      const dir = path.join(dataDir, e.name);
      const f = path.join(dir, 'shard.json');
      const info = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { schema: '1.0', id: e.name, status: 'open', formats: ['mat+meta', 'bgdb-json'], counts: { matches: 0, games: 0 } };
      return { id: e.name, dir, info };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function writeShardInfo(shard) {
  fs.mkdirSync(shard.dir, { recursive: true });
  const i = shard.info;
  const out = { schema: i.schema ?? '1.0', id: shard.id, status: i.status, formats: i.formats ?? ['mat+meta', 'bgdb-json'], counts: i.counts };
  if (i.integrity) out.integrity = i.integrity;
  fs.writeFileSync(path.join(shard.dir, 'shard.json'), JSON.stringify(out, null, 2) + '\n');
}

export function attachmentPath(shardDir, hash, ext) {
  return path.join(shardDir, 'attachments', hash.slice(0, 2), `${hash}.${ext}`);
}

export function matchPaths(shardDir, hash) {
  const base = path.join(shardDir, 'matches', hash.slice(0, 2), hash);
  return { mat: `${base}.mat`, meta: `${base}.meta.json` };
}

/** All sidecar records of a shard, sorted by id. */
export function readMetas(shardDir) {
  const root = path.join(shardDir, 'matches');
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(root, d.name))) {
      if (f.endsWith('.meta.json')) {
        const meta = JSON.parse(fs.readFileSync(path.join(root, d.name, f), 'utf8'));
        out.push({ hash: f.slice(0, -'.meta.json'.length), meta });
      }
    }
  }
  return out.sort((a, b) => a.meta.id.localeCompare(b.meta.id));
}

/** one line per match in data/hashes/<shard>.tsv: "<content hash>\t<id>" (what is needed to recognise a duplicate of a match whose shard lives elsewhere) */
export const hashFilePath = (dataDir, shardId) => path.join(dataDir, 'hashes', `${shardId}.tsv`);

export function writeHashFile(dataDir, shardId, metas) {
  const f = hashFilePath(dataDir, shardId);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, metas.map((m) => `${m.meta.contentHash}\t${m.meta.id}\n`).join(''));
  return f;
}

function readHashFiles(dataDir) {
  const dir = path.join(dataDir ?? '', 'hashes');
  if (!dataDir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^\d{4,}\.tsv$/.test(f)).sort().map((f) => ({
    shard: f.slice(0, -4),
    entries: fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t')),
  }));
}

/** Index of every known content hash across all shards, local or moved away (used for duplicate and collision detection). */
export function loadHashIndex(shards, dataDir) {
  const byFull = new Map();
  const byPrefix = new Map();
  const local = new Set(shards.map((s) => s.id));
  for (const s of shards) {
    for (const { hash, meta } of readMetas(s.dir)) {
      byFull.set(meta.contentHash, meta.id);
      byPrefix.set(hash, meta.contentHash);
    }
  }
  for (const f of readHashFiles(dataDir)) {
    if (local.has(f.shard)) continue;                                     // the shard is here: its own files are the truth
    for (const [full, id] of f.entries) {
      byFull.set(full, id);
      byPrefix.set(id.split('/')[1], full);
    }
  }
  return { byFull, byPrefix };
}

/**
 * A digest of every file of a shard (matches and attachments): sha256 over the sorted lines "<relative path> <sha256 of the file>".
 * It is recorded when a shard is sealed, and checked at every build instead of reading every match again.
 */
export function treeDigest(shardDir) {
  const files = [];
  const rec = (dir, rel) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) rec(path.join(dir, e.name), `${rel}${e.name}/`); else files.push(`${rel}${e.name}`);
    }
  };
  rec(path.join(shardDir, 'matches'), 'matches/');
  rec(path.join(shardDir, 'attachments'), 'attachments/');
  files.sort();
  const h = crypto.createHash('sha256');
  for (const f of files) h.update(`${f}\t${crypto.createHash('sha256').update(fs.readFileSync(path.join(shardDir, f))).digest('hex')}\n`);
  return { algorithm: 'sha256-tree', files: files.length, digest: h.digest('hex') };
}
