/**
 * bgdb ingest: move validated matches from inbox/ into the open shard (spec 10.2 - 10.7).
 *
 * A contribution is a GROUP of files that share a base name (spec ATT-01):
 *   name.mat | name.txt   the match as text (preferred)
 *   name.sgf              GNU Backgammon SGF (may carry analysis): kept as an attachment; also usable as the match itself
 *   name.xg               eXtreme Gammon file (binary, analysis): kept as an attachment (not verifiable yet)
 *   name.bgdb.json        optional extras: { "links": [{url,title?,game?,time?}], "tags": [...], "event", "round", "date" (reviewed values, decision 0022) }
 * A video link can also be written in the text header: ; [Video "https://youtu.be/..."]
 *
 *   - invalid groups stay in the inbox and are reported with their errors
 *   - duplicates are skipped and removed from the inbox; what they bring (links, tags, files, a reviewed event or round) enriches the stored match
 *   - a match that the list could not tell apart from another one (same players, date, event, round and length) is added with a warning
 *   - two transcriptions of one match (the same rolls almost everywhere, decision 0023): the only best one is kept, the others are
 *     "superseded" (skipped and removed from the inbox, like duplicates); what they know and it does not (event, round, date) is kept
 *   - the open shard is sealed and the next one created at sealPolicy.maxMatches or maxMB; sealed shards are never written
 *   - shard numbers are global across data repositories; above repoPolicy.stopMB, or when the repository is closed and its open shard is full,
 *     nothing more is added: the matches wait in the inbox for the next repository (decision 0024)
 */
import fs from 'node:fs';
import path from 'node:path';
import { groupFiles, analyzeGroup, buildMeta, sha256Hex, displayKey, CANONICAL_VERSION } from '@bg-db/core';
import { listShards, writeShardInfo, matchPaths, attachmentPath, loadHashIndex, shardIdOf, treeDigest, readMetas, nextShardNumber, repoSize, repoState } from './store.js';
import { enrichMatch, readLocalMeta, listEnrichments, currentMeta, ID_RE } from './enrich.js';
import { reconcileInbox } from './reconcile.js';

/** All files of a folder (recursively), read as bytes and grouped by directory + base name. Files that are not part of a contribution are ignored. */
export function collectGroups(dir) {
  const entries = [];
  const rec = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) rec(p); else entries.push({ name: e.name, dir: d, path: p });
    }
  };
  rec(dir);
  const groups = groupFiles(entries);
  for (const g of groups) for (const list of Object.values(g.files)) for (const e of list) e.bytes = new Uint8Array(fs.readFileSync(e.path));
  return groups;
}

const allEntries = (g) => Object.values(g.files).flat();

/** the stored matches as the list shows them (players, length, and event, round and date with their corrections) */
export function storedMatches(shards, dataDir) {
  const fixes = new Map(listEnrichments(dataDir).filter((e) => e.record.meta).map((e) => [e.id, e.record]));
  const out = [];
  for (const s of shards) {
    if (!s.dir || !fs.existsSync(s.dir)) continue;
    for (const { hash, meta } of readMetas(s.dir)) {
      out.push({ id: meta.id, players: meta.sides.map((x) => x.name), matchLength: meta.matchLength, ...currentMeta(meta, fixes.get(meta.id)), dir: s.dir, hash, meta });
    }
  }
  return out;
}

/**
 * @param {{inbox:string, data:string, config:object, contributor?:string, submittedAt?:string, dryRun?:boolean, maxMatches?:number, maxMB?:number,
 *          onStart?:(groups:number)=>void, onStep?:(text:string)=>void, onResult?:(result:object)=>void}} o
 *   onStart, onResult: progress, called before the first group and after each one (a long ingest shows what it does as it goes)
 */
export function ingest(o) {
  const policy = o.config.sealPolicy;
  const maxMatches = o.maxMatches ?? policy.maxMatches;
  const maxBytes = (o.maxMB ?? policy.maxMB) * 1024 * 1024;
  const submittedAt = o.submittedAt ?? new Date().toISOString().slice(0, 10);
  const shards = listShards(o.data);
  const opens = shards.filter((s) => s.info.status === 'open');
  if (opens.length > 1) throw new Error(`More than one open shard (${opens.map((s) => s.id).join(', ')}): only one may be open (SH-01)`);
  let open = opens[0];
  const newShard = (n) => {
    const id = shardIdOf(n);
    const s = { id, dir: path.join(o.data, id), info: { schema: '1.0', status: 'open', counts: { matches: 0, games: 0, bytes: 0 } } };
    shards.push(s);
    if (!o.dryRun) writeShardInfo(s);
    return s;
  };
  if (!open && !o.config.closed) open = newShard(nextShardNumber(shards, o.data, o.config));
  // the size of the repository (decision 0024): measured once, then followed as matches are added, so that a large import stops in time
  const policy2 = o.config.repoPolicy;
  const size = repoSize(o.data);
  let addedMB = 0;
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const repo = () => ({ mb: r3(size.mb + addedMB), dataMB: r3(size.dataMB + addedMB), gitMB: size.gitMB === null ? null : r3(size.gitMB), ...policy2, state: repoState(size.mb + addedMB, policy2), closed: o.config.closed });
  const { byFull, byPrefix } = loadHashIndex(shards, o.data);
  const stored = storedMatches(shards, o.data);
  const shown = new Map();                                       // display key -> id: to warn about a new match that looks the same as another
  for (const m of stored) if (!shown.has(displayKey(m))) shown.set(displayKey(m), m.id);
  const report = { results: [], added: 0, duplicates: 0, enriched: 0, errors: 0, partial: 0, superseded: 0, waiting: 0, sealed: [], repo: null };
  const push = (r) => { report.results.push(r); o.onResult?.(r); };

  const groups = collectGroups(o.inbox);
  o.onStart?.(groups.length);
  o.onStep?.('looking for transcriptions of the same match (the copies found are read in full: about a minute for thousands of files)');
  const recon = reconcileInbox(groups, { stored, config: o.config });
  const tieOf = new Map();                                       // group key -> the other transcriptions, when nobody can rank them
  for (const t of recon.ties) for (const m of t.members) if (m.key) tieOf.set(m.key, { others: t.members.filter((x) => x !== m).map((x) => x.label), t });
  for (const g of groups) {
    const files = allEntries(g).map((e) => e.path);
    // another transcription of a match that a better file gives (decision 0023): skipped, like a duplicate
    const sup = recon.superseded.get(g.key);
    if (sup) {
      let corrected = [];
      if (sup.fix && ID_RE.test(sup.by)) {
        const e = enrichMatch({ data: o.data, id: sup.by, meta: readLocalMeta(o.data, sup.by), fix: sup.fix, contributor: o.contributor, date: submittedAt, dryRun: o.dryRun });
        corrected = Object.keys(e.added.meta ?? {});
      }
      report.superseded++;
      push({ file: files[0], files, status: 'superseded', ...sup, corrected });
      if (!o.dryRun) for (const f of files) fs.rmSync(f);
      continue;
    }
    const kept = recon.keep.get(g.key);
    const res = analyzeGroup(g, { config: o.config, known: byFull, salvage: !!o.salvage, fill: kept?.fill });
    for (const n of kept?.notes ?? []) res.warnings.push({ severity: 'warning', code: 'V-COPY', message: n[0].toUpperCase() + n.slice(1) });
    const tie = tieOf.get(g.key);
    if (tie) {
      res.warnings.push({ severity: 'warning', code: 'V-COPY', message: `Another transcription of this match is ${tie.others.join(', ')} (${(tie.t.ratio * 100).toFixed(1)}% of the rolls in common; first difference: ${tie.t.diff}), and nothing tells which one is right`, hint: 'Choose in the review sheet of "bgdb meta" (reject in the column action), or keep both.' });
    }
    const primaryPath = res.primary?.entry.path ?? files[0];

    if (res.status === 'error') { report.errors++; push({ file: primaryPath, files, status: 'error', errors: res.errors }); continue; }
    if (res.status === 'partial') {
      // it can only be added partially, and nobody accepted that: it stays in the inbox (decision 0021)
      report.partial++;
      push({ file: primaryPath, files, status: 'partial', base: g.base, notes: res.partial.notes, errors: res.partial.errors });
      continue;
    }
    if (res.status === 'duplicate') {
      // a duplicate that brings something (a video link, tags, an SGF or XG file) enriches the existing match; otherwise it is only skipped
      let enrichment = null;
      const fix = res.sidecar?.meta ?? {};
      if (ID_RE.test(res.duplicateOf ?? '') && (res.links.length || res.tags.length || res.attachments.length || Object.keys(fix).length)) {
        enrichment = enrichMatch({
          data: o.data, id: res.duplicateOf, meta: readLocalMeta(o.data, res.duplicateOf), links: res.links, tags: res.tags, attachments: res.attachments, fix,
          contributor: o.contributor, date: submittedAt, dryRun: o.dryRun,
        });
      }
      if (enrichment && !enrichment.nothing) {
        report.enriched++;
        push({ file: primaryPath, files, status: 'enriched', id: res.duplicateOf, added: enrichment.added, skipped: enrichment.skipped, warnings: res.warnings });
      } else {
        report.duplicates++;
        push({ file: primaryPath, files, status: 'duplicate', of: res.duplicateOf, extrasIgnored: false, skipped: enrichment?.skipped ?? [] });
      }
      if (!o.dryRun) for (const f of files) fs.rmSync(f);
      continue;
    }

    // the repository is full, or closed with no room left in its open shard: the match waits in the inbox for the next repository
    const shardFull = open && open.info.counts.matches > 0 && (open.info.counts.matches >= maxMatches || (open.info.counts.bytes ?? 0) >= maxBytes);
    const why = repoState(size.mb + addedMB, policy2) === 'stop' ? `this data repository is at ${repo().mb} MB, above ${policy2.stopMB} MB: the next repository takes the new matches`
      : o.config.closed && (!open || shardFull) ? 'this data repository is closed and its last shard is full: the next repository takes the new matches' : null;
    if (why) { report.waiting++; push({ file: primaryPath, files, status: 'waiting', reason: why }); continue; }
    // seal the open shard if it is full
    if (shardFull) {
      open.info.status = 'sealed';
      if (!o.dryRun) { open.info.integrity = treeDigest(open.dir); writeShardInfo(open); }   // the digest is what lets the build trust a sealed shard without reading every match again
      report.sealed.push(open.id);
      open = newShard(nextShardNumber(shards, o.data, o.config));
    }

    // identifier, metadata, files
    const { full, match, normalised, attachments: atts } = res;
    let len = 16;                                                 // ID-04: extend the prefix on a collision
    while (byPrefix.has(full.slice(0, len)) && byPrefix.get(full.slice(0, len)) !== full) len += 2;
    const hash = full.slice(0, len);
    const id = `${open.id}/${hash}`;
    const attMeta = atts.map((a) => ({
      kind: a.kind, file: `${hash}.${a.kind}`, bytes: a.bytes.length, sha256: sha256Hex(a.bytes),
      verified: a.verified, analysis: a.analysis, engine: a.engine,
    }));
    // the list must be able to tell it apart from the others (decision 0022): a warning, never a refusal (spec CTB-13)
    const key = displayKey(match);
    const twin = shown.get(key);
    if (twin) res.warnings.push({ severity: 'warning', code: 'V-META', message: `Nothing tells it apart from ${twin} in the list (same players, date, event, round and length)`, hint: 'Give its round (or event) in its .bgdb.json; "bgdb meta" proposes them from the file names. Once stored: bgdb enrich <id> --round ...' });
    else shown.set(key, id);
    const codes = [...new Set(res.warnings.map((w) => w.code))].sort();
    const meta = buildMeta(match, {
      id, contentHash: full, canonicalVersion: CANONICAL_VERSION, originalHash: res.originalHash,
      contributor: o.contributor ?? null, submittedAt, license: o.config.license, warnings: codes, attachments: attMeta, links: res.links,
    });
    meta.tags = res.tags;
    const metaText = JSON.stringify(meta, null, 2) + '\n';
    const written = Buffer.byteLength(normalised) + Buffer.byteLength(metaText) + atts.reduce((n, a) => n + a.bytes.length, 0);

    if (!o.dryRun) {
      const p = matchPaths(open.dir, hash);
      fs.mkdirSync(path.dirname(p.mat), { recursive: true });
      fs.writeFileSync(p.mat, normalised);
      fs.writeFileSync(p.meta, metaText);
      for (const a of atts) {
        const ap = attachmentPath(open.dir, hash, a.kind);
        fs.mkdirSync(path.dirname(ap), { recursive: true });
        fs.writeFileSync(ap, a.bytes);
      }
      for (const f of files) fs.rmSync(f);
    }
    open.info.counts.matches++;
    open.info.counts.games += match.games.length;
    open.info.counts.bytes = (open.info.counts.bytes ?? 0) + written;
    addedMB += written / (1024 * 1024);
    if (!o.dryRun) writeShardInfo(open);
    byFull.set(full, id);
    byPrefix.set(hash, full);
    report.added++;
    push({
      file: primaryPath, files, status: 'added', id, ...(res.partial ? { partial: true } : {}),
      warnings: [...res.warnings, ...res.infos.map((i) => ({ ...i, severity: 'info' }))], attachments: attMeta.map((a) => a.kind), links: res.links.length,
    });
  }
  report.repo = repo();
  return report;
}
