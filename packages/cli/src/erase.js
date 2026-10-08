/**
 * bgdb erase: remove a match from the database at a player's request, or for another logged reason (decision 0025, spec CR-02, SH-03).
 *
 * In the data folder of this repository it removes what it holds of the match: its files in a local shard (the .mat, the .meta.json and the
 * attachments; a sealed shard gets the digest of its files recorded again), its enrichment, and its line in the hash files (data/hashes/).
 * The content hash goes to data/erased.tsv with the date and the reason, never a name: check, review and ingest then refuse the same match
 * if it is sent again, in any notation or format, and the next build drops it from the site. The git history is not rewritten here
 * (docs/data-repositories.md says how).
 */
import fs from 'node:fs';
import path from 'node:path';
import { listShards, matchPaths, attachmentPath, writeShardInfo, treeDigest, readErased, erasedFilePath, ERASE_REASONS, ERASED_HEADER } from './store.js';
import { enrichmentPaths, ID_RE } from './enrich.js';

/** remove a file and the folders it leaves empty, up to (not including) stop */
function removeFile(f, stop, removed) {
  if (!fs.existsSync(f)) return 0;
  const size = fs.statSync(f).size;
  fs.rmSync(f);
  removed.push(f);
  for (let d = path.dirname(f); d.startsWith(stop + path.sep) && fs.existsSync(d) && fs.readdirSync(d).length === 0; d = path.dirname(d)) fs.rmdirSync(d);
  return size;
}

/**
 * @param {{data:string, id:string, reason:string, date?:string, dryRun?:boolean}} o
 * @returns {{ok:boolean, error?:string, id?:string, contentHash?:string, removed?:string[], shard?:{id:string, status:string}|null, hashFiles?:string[]}}
 */
export function eraseMatch(o) {
  const date = o.date ?? new Date().toISOString().slice(0, 10);
  if (!ERASE_REASONS.includes(o.reason)) return { ok: false, error: `--reason must be one of: ${ERASE_REASONS.join(', ')}` };
  const m = String(o.id ?? '').match(ID_RE);
  if (!m) return { ok: false, error: `"${o.id}" is not a match id (shard/hash, for example 0001/21acddbb70ed09d5)` };
  const [, shardId, hash] = m;
  const data = path.resolve(o.data);
  const removed = [];
  let contentHash = null;

  // 1. the match in a local shard
  const shard = listShards(data).find((s) => s.id === shardId);
  const p = shard ? matchPaths(shard.dir, hash) : null;
  let meta = null;
  if (p && fs.existsSync(p.meta)) {
    meta = JSON.parse(fs.readFileSync(p.meta, 'utf8'));
    contentHash = meta.contentHash;
  }

  // 2. the hash files: the match of a shard that lives in another repository
  const hashFiles = [];
  const hashDir = path.join(data, 'hashes');
  const hashEdits = [];
  if (fs.existsSync(hashDir)) {
    for (const f of fs.readdirSync(hashDir).filter((x) => x.endsWith('.tsv')).sort()) {
      const file = path.join(hashDir, f);
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      const keep = lines.filter((l) => l.split('\t')[1] !== o.id);
      if (keep.length === lines.length) continue;
      contentHash ??= lines.find((l) => l.split('\t')[1] === o.id).split('\t')[0];
      hashFiles.push(file);
      hashEdits.push([file, keep]);
    }
  }
  const erased = readErased(data);
  const before = [...erased.values()].find((x) => x.id === o.id) ?? (contentHash && erased.get(contentHash));
  if (before) return { ok: false, error: `${o.id} was already erased (${before.date}, ${before.reason})` };
  if (!contentHash) return { ok: false, error: `No match ${o.id} in ${o.data}/ (neither in a shard here nor in the hash files)` };
  if (o.dryRun) return { ok: true, id: o.id, contentHash, removed: [], shard: meta ? { id: shard.id, status: shard.info.status } : null, hashFiles, dryRun: true };

  // 3. remove: the files of the match, then its enrichment
  if (meta) {
    let bytes = 0;
    bytes += removeFile(p.mat, shard.dir, removed);
    bytes += removeFile(p.meta, shard.dir, removed);
    for (const a of meta.attachments ?? []) bytes += removeFile(attachmentPath(shard.dir, hash, a.kind), shard.dir, removed);
    const c = shard.info.counts ?? { matches: 1, games: 0 };
    c.matches = Math.max(0, c.matches - 1);
    c.games = Math.max(0, c.games - (meta.games?.length ?? 0));
    if (c.bytes !== undefined) c.bytes = Math.max(0, c.bytes - bytes);
    shard.info.counts = c;
    // a sealed shard changes only by a logged erasure (spec SH-03): its digest is recorded again, so that the build still trusts it
    if (shard.info.status === 'sealed') shard.info.integrity = treeDigest(shard.dir);
    writeShardInfo(shard);
  }
  const e = enrichmentPaths(data, o.id);
  if (fs.existsSync(e.dir)) {
    for (const f of fs.readdirSync(e.dir).filter((x) => x.startsWith(`${hash}.`))) removeFile(path.join(e.dir, f), path.join(data, 'enrichments'), removed);
  }
  for (const [file, keep] of hashEdits) fs.writeFileSync(file, keep.map((l) => `${l}\n`).join(''));

  // 4. the erasure list
  const f = erasedFilePath(data);
  fs.appendFileSync(f, `${fs.existsSync(f) ? '' : ERASED_HEADER}${contentHash}\t${o.id}\t${date}\t${o.reason}\n`);
  return { ok: true, id: o.id, contentHash, removed, shard: meta ? { id: shard.id, status: shard.info.status } : null, hashFiles };
}
