/**
 * Enrichment: adding links, tags and attachments to a match that is already in the database, and correcting its event, round and date
 * (decision 0022), without touching its shard.
 * Sealed shards are never edited (spec SH-03): an enrichment is a small record in data/enrichments/<shard>/<h2>/<hash>.json (and the
 * attachment files next to it). `build` publishes all of them as one overlay file, and the site applies it on top of the shards.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { analyzeGroup, normalizeVideoLink, TAG_RE, META_KEYS, parseSidecar } from '@bg-db/core';
import { listShards, loadHashIndex, matchPaths, readMetas } from './store.js';

export const ID_RE = /^(\d{4,})\/([0-9a-f]{16,64})$/;
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

export function enrichmentPaths(dataDir, id) {
  const [, shard, hash] = id.match(ID_RE);
  const dir = path.join(dataDir, 'enrichments', shard, hash.slice(0, 2));
  return { dir, json: path.join(dir, `${hash}.json`), file: (kind) => path.join(dir, `${hash}.${kind}`), shard, hash };
}

export function readEnrichment(dataDir, id) {
  const p = enrichmentPaths(dataDir, id);
  return fs.existsSync(p.json) ? JSON.parse(fs.readFileSync(p.json, 'utf8')) : null;
}

/** every enrichment of the repository, sorted by id */
export function listEnrichments(dataDir) {
  const root = path.join(dataDir, 'enrichments');
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const s of fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    for (const d of fs.readdirSync(path.join(root, s.name), { withFileTypes: true }).filter((e) => e.isDirectory())) {
      for (const f of fs.readdirSync(path.join(root, s.name, d.name)).filter((x) => x.endsWith('.json'))) {
        const record = JSON.parse(fs.readFileSync(path.join(root, s.name, d.name, f), 'utf8'));
        out.push({ id: record.id, record });
      }
    }
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** the sidecar of a match that is in a local shard, or null */
export function readLocalMeta(dataDir, id) {
  const m = id.match(ID_RE);
  if (!m) return null;
  const p = matchPaths(path.join(dataDir, m[1]), m[2]);
  return fs.existsSync(p.meta) ? JSON.parse(fs.readFileSync(p.meta, 'utf8')) : null;
}

const sameLink = (a, b) => a.url === b.url && (a.game ?? null) === (b.game ?? null);

/** the event, round and date a match shows now: its own sidecar, corrected by its enrichment */
export function currentMeta(meta, record) {
  const out = {};
  for (const k of META_KEYS) out[k] = record?.meta && k in record.meta ? record.meta[k] : meta?.[k] ?? null;
  return out;
}

/**
 * What would be added to a match, given what it already has (its own sidecar and earlier enrichments).
 * @returns {{links:object[], tags:string[], attachments:object[], meta:object, skipped:string[]}}
 */
export function diffEnrichment({ meta, record }, { links = [], tags = [], attachments = [], fix = {} }) {
  const haveLinks = [...(meta?.links ?? []), ...(record?.links ?? [])];
  const haveTags = new Set([...(meta?.tags ?? []), ...(record?.tags ?? [])]);
  const haveKinds = new Set([...(meta?.attachments ?? []), ...(record?.attachments ?? [])].map((a) => a.kind));
  const skipped = [];
  const out = { links: [], tags: [], attachments: [], meta: {}, skipped };
  const now = currentMeta(meta, record);
  for (const k of META_KEYS) if (k in fix && (fix[k] ?? null) !== now[k]) out.meta[k] = fix[k] ?? null;
  for (const l of links) if (!haveLinks.some((x) => sameLink(x, l)) && !out.links.some((x) => sameLink(x, l))) out.links.push(l);
  for (const t of tags) if (!haveTags.has(t) && !out.tags.includes(t)) out.tags.push(t);
  for (const a of attachments) {
    if (haveKinds.has(a.kind) || out.attachments.some((x) => x.kind === a.kind)) skipped.push(`the match already has a ${a.kind.toUpperCase()} file, so ${a.name ?? 'the new one'} was not added`);
    else out.attachments.push(a);
  }
  return out;
}

/**
 * Write the enrichment of a match (merging with an earlier one).
 * @param {{data:string, id:string, meta?:object|null, links?:object[], tags?:string[], attachments?:{kind:string, bytes:Uint8Array, verified:boolean, analysis:boolean|null, engine:string|null, name?:string}[],
 *          fix?:{event?:string|null, round?:string|null, date?:string|null}, contributor?:string|null, date?:string, dryRun?:boolean}} o
 *   fix: corrections of the event, round or date (null = none); they replace the values of the match and of earlier corrections
 * @returns {{id:string, added:{links:object[], tags:string[], attachments:string[], meta:object}, skipped:string[], nothing:boolean}}
 */
export function enrichMatch(o) {
  const record = readEnrichment(o.data, o.id) ?? { schema: '1.0', id: o.id, links: [], tags: [], attachments: [] };
  const diff = diffEnrichment({ meta: o.meta ?? readLocalMeta(o.data, o.id), record }, { links: o.links, tags: o.tags, attachments: o.attachments, fix: o.fix });
  const nothing = !diff.links.length && !diff.tags.length && !diff.attachments.length && !Object.keys(diff.meta).length;
  const result = { id: o.id, added: { links: diff.links, tags: diff.tags, attachments: diff.attachments.map((a) => a.kind), meta: diff.meta }, skipped: diff.skipped, nothing };
  if (nothing || o.dryRun) return result;
  const p = enrichmentPaths(o.data, o.id);
  fs.mkdirSync(p.dir, { recursive: true });
  record.links.push(...diff.links);
  record.tags.push(...diff.tags);
  if (Object.keys(diff.meta).length) record.meta = { ...record.meta, ...diff.meta };
  for (const a of diff.attachments) {
    fs.writeFileSync(p.file(a.kind), a.bytes);
    record.attachments.push({ kind: a.kind, file: `${p.hash}.${a.kind}`, bytes: a.bytes.length, sha256: sha256(a.bytes), verified: a.verified, analysis: a.analysis, engine: a.engine });
  }
  record.contributors = [...new Set([...(record.contributors ?? []), ...(o.contributor ? [o.contributor] : [])])];
  record.updatedAt = o.date ?? new Date().toISOString().slice(0, 10);
  fs.writeFileSync(p.json, `${JSON.stringify(record, null, 2)}\n`);
  return result;
}

/** find a match by its id ("0001/abcd...") or by the start of its hash (at least 8 characters) */
export function findMatch(dataDir, ref) {
  const shards = listShards(dataDir);
  const { byFull } = loadHashIndex(shards, dataDir);
  const ids = [...new Set(byFull.values())];
  const wanted = String(ref).toLowerCase();
  const hits = ids.filter((id) => (ID_RE.test(wanted) ? id === wanted : wanted.length >= 8 && id.split('/')[1].startsWith(wanted)));
  if (hits.length === 0) return { error: `No match "${ref}" in the database. Give its id (for example 0001/2359e4c944b8d130) or at least 8 characters of its hash.` };
  if (hits.length > 1) return { error: `"${ref}" matches ${hits.length} matches: ${hits.slice(0, 4).join(', ')}. Give more characters.` };
  const id = hits[0];
  const full = [...byFull].find(([, v]) => v === id)[0];
  return { id, full, meta: readLocalMeta(dataDir, id), local: shards.some((s) => id.startsWith(`${s.id}/`)) };
}

/**
 * `bgdb enrich`: validate what the contributor gives and enrich the match.
 * @param {{data:string, config:object, ref:string, link?:string, title?:string, game?:number, time?:string|number, tags?:string, sgf?:Uint8Array, xg?:Uint8Array,
 *          event?:string, round?:string, matchDate?:string, contributor?:string, date?:string, dryRun?:boolean}} o
 *   event, round, matchDate: corrections ("" = none)
 * @returns {{ok:boolean, errors:string[], warnings:string[], result?:object}}
 */
export function enrichByRef(o) {
  const errors = [];
  const warnings = [];
  const found = findMatch(o.data, o.ref);
  if (found.error) return { ok: false, errors: [found.error], warnings };
  const links = [];
  if (o.link) {
    const r = normalizeVideoLink({ url: o.link, title: o.title, game: o.game, time: o.time }, { hosts: o.config.videoHosts });
    if (r.ok) links.push(r.link); else errors.push(`The video link was not used: ${r.reason}.`);
  }
  const tags = [];
  for (const t of String(o.tags ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    if (TAG_RE.test(t)) tags.push(t); else errors.push(`The tag "${t}" is not valid (lower-case letters, digits and "-", at most 31 characters).`);
  }
  const attachments = [];
  const maxBytes = (o.config.sealPolicy?.maxAttachmentKB ?? 2048) * 1024;
  if (o.sgf) {
    if (o.sgf.length > maxBytes) errors.push(`The SGF file is larger than ${o.config.sealPolicy.maxAttachmentKB} KB.`);
    else {
      const res = analyzeGroup({ base: 'sgf', files: { sgf: [{ name: 'the SGF file', bytes: o.sgf }] } }, { config: o.config, known: new Map([[found.full, found.id]]) });
      if (res.status === 'error') errors.push(`The SGF file cannot be read: ${res.errors[0].message}`);
      else if (res.status === 'new') errors.push(`The SGF file is not the match ${found.id} (it describes another match).`);
      else attachments.push(...res.attachments.map((a) => ({ ...a, name: 'the SGF file' })));
    }
  }
  if (o.xg) {
    if (o.xg.length > maxBytes) errors.push(`The XG file is larger than ${o.config.sealPolicy.maxAttachmentKB} KB.`);
    else if (String.fromCharCode(...o.xg.subarray(0, 4)) !== 'RGMH') errors.push('The XG file is not an eXtreme Gammon file (it does not start with "RGMH").');
    else {
      const res = analyzeGroup({ base: 'xg', files: { xg: [{ name: 'the XG file', bytes: o.xg }] } }, { config: o.config, known: new Map([[found.full, found.id]]) });
      if (res.status === 'new') errors.push(`The XG file is not the match ${found.id} (it describes another match).`);
      else if (res.status === 'duplicate') attachments.push(...res.attachments.map((a) => ({ ...a, name: 'the XG file' })));
      else {                                                         // a variant of the format that the reader does not know: kept unchecked
        warnings.push(`The XG file could not be read (${res.errors[0].message}); it is kept unchecked.`);
        attachments.push({ kind: 'xg', name: 'the XG file', bytes: o.xg, verified: false, analysis: null, engine: 'eXtreme Gammon' });
      }
    }
  }
  // corrections: checked as the same keys of a .bgdb.json sidecar
  const given = Object.fromEntries([['event', o.event], ['round', o.round], ['date', o.matchDate]].filter(([, v]) => v !== undefined));
  const fixWarnings = [];
  const fix = Object.keys(given).length ? parseSidecar('the correction', new TextEncoder().encode(JSON.stringify(given)), o.config, fixWarnings).meta : {};
  for (const w of fixWarnings) errors.push(w.message.replace(/^the correction: /, ''));
  if (!links.length && !tags.length && !attachments.length && !Object.keys(fix).length && !errors.length) errors.push('Nothing to add: give --link, --tags, --sgf, --xg, --event, --round or --match-date.');
  if (errors.length) return { ok: false, errors, warnings };
  const result = enrichMatch({ data: o.data, id: found.id, meta: found.meta, links, tags, attachments, fix, contributor: o.contributor, date: o.date, dryRun: o.dryRun });
  return { ok: true, errors, warnings: result.skipped, result };
}

export { readMetas };
