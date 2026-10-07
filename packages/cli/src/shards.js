/**
 * Maintenance of shards: checking them in full, recording the digest of a sealed shard, and moving a sealed shard to another repository.
 */
import fs from 'node:fs';
import path from 'node:path';
import { listShards, readMetas, writeShardInfo, treeDigest, writeHashFile, checkExternalShards } from './store.js';
import { verifyMatch, verifyAttachments } from './build.js';

/**
 * Read every match of the shards in full (parse, validate, compare with the sidecar, check the attachments).
 * With `record`, a sealed shard without errors gets the digest of its files recorded in shard.json: later builds then trust it.
 * @returns {{id:string, status:string, matches:number, errors:string[], recorded:boolean}[]}
 */
export function verifyShards({ data, shard = null, record = false }) {
  const out = [];
  for (const s of listShards(data)) {
    if (shard && s.id !== shard) continue;
    const metas = readMetas(s.dir);
    const errors = [];
    for (const { hash, meta } of metas) {
      const bad = verifyMatch(s.dir, hash, meta);
      if (bad) errors.push(bad);
      errors.push(...verifyAttachments(s.dir, hash, meta));
    }
    let recorded = false;
    if (record && s.info.status === 'sealed' && errors.length === 0) { s.info.integrity = treeDigest(s.dir); writeShardInfo(s); recorded = true; }
    out.push({ id: s.id, status: s.info.status, matches: metas.length, errors, recorded });
  }
  return out;
}

/**
 * Move a sealed shard to the data folder of another repository: verify it, keep the hashes of its matches here (so that duplicates are still
 * recognised), copy it, and optionally remove it here and list it in the configuration as an external shard.
 * @returns {{ok:boolean, error?:string, entry?:object, hashFile?:string, copiedTo?:string, removed?:boolean}}
 */
export function splitShard({ data, id, to, base, remove = false, configFile = 'bgdb.config.json' }) {
  const shard = listShards(data).find((s) => s.id === id);
  if (!shard) return { ok: false, error: `No shard ${id} in ${data}/.` };
  if (shard.info.status !== 'sealed') return { ok: false, error: `Shard ${id} is ${shard.info.status}: only a sealed shard can be moved (the open shard stays here).` };
  try { checkExternalShards([{ id, base, status: 'sealed' }]); } catch (e) { return { ok: false, error: e.message }; }
  const [v] = verifyShards({ data, shard: id, record: true });
  if (v.errors.length) return { ok: false, error: `Shard ${id} has ${v.errors.length} error(s), it was not moved: ${v.errors[0]}` };
  const dest = path.join(to, id);
  if (fs.existsSync(dest) && fs.readdirSync(dest).length) return { ok: false, error: `${dest} already exists and is not empty.` };
  const metas = readMetas(shard.dir);
  const hashFile = writeHashFile(data, id, metas);
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(shard.dir, dest, { recursive: true });
  const entry = { id, base, status: 'sealed', matches: metas.length };
  let removed = false;
  if (remove) {
    const cfg = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
    cfg.externalShards = [...(cfg.externalShards ?? []).filter((e) => e.id !== id), entry].sort((a, b) => (a.id < b.id ? -1 : 1));
    fs.writeFileSync(configFile, `${JSON.stringify(cfg, null, 2)}\n`);
    fs.rmSync(shard.dir, { recursive: true, force: true });
    removed = true;
  }
  return { ok: true, entry, hashFile, copiedTo: dest, removed };
}

/**
 * Seal the open shard of a data folder at whatever size it has reached, when its repository stops taking matches (switch-data-repo,
 * decision 0024): every match is read in full first, then the digest of its files is recorded. An open shard with no match is removed
 * instead, so that its number is free for the next repository.
 * @returns {{ok:boolean, error?:string, sealed:string|null, removed:string|null, matches:number}}
 */
export function sealOpenShard({ data }) {
  const open = listShards(data).filter((s) => s.info.status === 'open');
  if (open.length === 0) return { ok: true, sealed: null, removed: null, matches: 0 };
  if (open.length > 1) return { ok: false, error: `${data}/ has ${open.length} open shards (${open.map((s) => s.id).join(', ')}): there must be one`, sealed: null, removed: null, matches: 0 };
  const s = open[0];
  const [v] = verifyShards({ data, shard: s.id });
  if (v.errors.length) return { ok: false, error: `shard ${s.id} has ${v.errors.length} error(s), it was not sealed: ${v.errors[0]}`, sealed: null, removed: null, matches: v.matches };
  if (v.matches === 0) { fs.rmSync(s.dir, { recursive: true, force: true }); return { ok: true, sealed: null, removed: s.id, matches: 0 }; }
  s.info.status = 'sealed';
  s.info.integrity = treeDigest(s.dir);
  writeShardInfo(s);
  return { ok: true, sealed: s.id, removed: null, matches: v.matches };
}
