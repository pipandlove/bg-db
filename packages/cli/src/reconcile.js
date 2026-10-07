/**
 * Copies of one match among the files of an inbox and the stored matches (decision 0023): the rolls are compared, the copies are ranked,
 * and the only best one is kept. Used by `bgdb ingest` (which acts on it) and by `bgdb meta` (which shows it in the review sheet).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  parseMatchBytes, readMatchBytes, contentHash, rollTokens, compareRolls, diffText, sameMatchClusters, keeperOf, RANK_TEXT,
  cleanHeaderMetadata, parseSidecar, normalizeName, sha256Hex, decodeText, META_KEYS,
} from '@bg-db/core';
import { matchPaths } from './store.js';

/**
 * A fingerprint of the moves of a file: its text without the header lines (";" and "[...]" tags), line endings and spaces normalised.
 * Two files that differ only by their headers (a server's match number, a site name) are copies of one match. A binary file: its bytes.
 */
export function movesFingerprint(bytes, format) {
  if (format === 'xg') return sha256Hex(bytes);
  const body = decodeText(bytes).text.replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l && !l.startsWith(';') && !/^\[[^\]]*\]$/.test(l));
  return sha256Hex(body.join('\n'));
}

const primaryOf = (g) => [...(g.files.mat ?? []), ...(g.files.txt ?? [])][0] ?? g.files.sgf?.[0] ?? g.files.xg?.[0] ?? null;

/** rank of a file: 3 valid, 2 valid only by salvage, 1 refused; and its identity when it can be read */
function rankFile(bytes, illegal) {
  let r = readMatchBytes(bytes, { illegal });
  if (r.ok) return { rank: 3, hash: contentHash(r.match) };
  r = readMatchBytes(bytes, { illegal, salvage: true });
  return r.ok ? { rank: 2, hash: contentHash(r.match) } : { rank: 1, hash: null };
}

/**
 * @param {object[]} groups the groups of the inbox (collectGroups)
 * @param {{stored?:{id:string, players:string[], matchLength:number, date:string|null, event:string|null, round:string|null, dir:string, hash:string, meta:object}[], config?:object, label?:(g:object)=>string}} o
 * @returns {{superseded:Map<string, {by:string, byStored:boolean, ratio:number, diff:string, rank:number, keeperRank:number, fix:object|null}>,
 *            keep:Map<string, {fill:object, notes:string[]}>, ties:{members:{key:string|null, id:string, label:string, rank:number}[], ratio:number, diff:string}[]}}
 *   maps are keyed by the group key; ties: copies that nobody can rank (both valid but different), left to a person
 */
export function reconcileInbox(groups, o = {}) {
  const label = o.label ?? ((g) => path.basename(primaryOf(g)?.name ?? g.base));
  const entries = [];
  const info = new Map();                                        // entry id -> what is known of it
  for (const g of groups) {
    const p = primaryOf(g);
    if (!p) continue;
    const r = parseMatchBytes(p.bytes);
    if (!r.ok) continue;
    const side = g.files.side?.length ? parseSidecar(g.files.side[0].name, g.files.side[0].bytes, o.config ?? {}, []) : { meta: {}, illegal: [] };
    const h = cleanHeaderMetadata(r.match);
    const meta = { date: r.match.date ?? null, event: h.event, round: h.round, ...side.meta };
    const id = `inbox:${g.key}`;
    entries.push({ id, tokens: rollTokens(r.match) });
    info.set(id, { kind: 'inbox', group: g, key: g.key, label: label(g), bytes: p.bytes, fp: movesFingerprint(p.bytes, r.format), illegal: side.illegal ?? [], meta });
  }
  // stored matches with the same players and length as a file of the inbox
  const keys = new Set(entries.map((e) => e.tokens.key).filter(Boolean));
  for (const s of o.stored ?? []) {
    const k = `${s.players.map(normalizeName).sort().join(' / ')} | ${s.matchLength}`;
    if (!keys.has(k)) continue;
    const file = matchPaths(s.dir, s.hash).mat;
    if (!fs.existsSync(file)) continue;
    const r = parseMatchBytes(new Uint8Array(fs.readFileSync(file)));
    if (!r.ok) continue;
    const id = `stored:${s.id}`;
    entries.push({ id, tokens: rollTokens(r.match) });
    info.set(id, { kind: 'stored', label: s.id, storedId: s.id, rank: s.meta.games.some((x) => x.resultOnly) ? 2 : 3, hash: s.meta.contentHash, meta: { date: s.date, event: s.event, round: s.round } });
  }

  const out = { superseded: new Map(), keep: new Map(), ties: [] };
  const tokensOf = new Map(entries.map((e) => [e.id, e.tokens]));
  for (const c of sameMatchClusters(entries)) {
    // rank the members (only these files are read in full); copies with the same identity are one member (the ingest skips them anyway)
    const members = [];
    const seen = new Set();
    const rankedByFp = new Map();                                // the same text is ranked once
    for (const id of c.members.sort((a, b) => (a.startsWith('stored:') ? -1 : 0) - (b.startsWith('stored:') ? -1 : 0) || (a < b ? -1 : 1))) {
      const x = info.get(id);
      if (x.kind === 'inbox' && x.rank === undefined) {
        if (!rankedByFp.has(x.fp)) rankedByFp.set(x.fp, rankFile(x.bytes, x.illegal));
        Object.assign(x, rankedByFp.get(x.fp));
      }
      if (x.hash && seen.has(x.hash)) continue;
      if (x.hash) seen.add(x.hash);
      members.push({ id, rank: x.rank });
    }
    if (members.length < 2) continue;
    const keeper = keeperOf(members);
    const cmp = (a, b) => compareRolls(tokensOf.get(a), tokensOf.get(b));
    if (!keeper) {
      if (Math.max(...members.map((m) => m.rank)) > 1) {
        const first = cmp(members[0].id, members[1].id);
        out.ties.push({ members: members.map((m) => ({ key: info.get(m.id).key ?? null, id: m.id, label: info.get(m.id).label, rank: m.rank })), ratio: first.ratio, diff: diffText(first.diff) });
      }
      continue;
    }
    const k = info.get(keeper);
    const fill = {};                                             // what the copies know and the kept one does not
    for (const m of members) if (m.id !== keeper) for (const f of META_KEYS) if (!k.meta[f] && !fill[f] && info.get(m.id).meta[f]) fill[f] = info.get(m.id).meta[f];
    const notes = [];
    let fixGiven = false;
    for (const m of members) {
      if (m.id === keeper) continue;
      const x = info.get(m.id);
      const c2 = cmp(m.id, keeper);
      if (x.kind === 'inbox') {
        // a stored keeper is corrected (enrichment) by the first copy that brings something
        const fix = k.kind === 'stored' && !fixGiven && Object.keys(fill).length ? fill : null;
        if (fix) fixGiven = true;
        out.superseded.set(x.key, { by: k.label, byStored: k.kind === 'stored', ratio: c2.ratio, diff: diffText(c2.diff), rank: m.rank, keeperRank: k.rank, fix });
      } else {
        notes.push(`it is another transcription of ${x.storedId} (${RANK_TEXT[x.rank]}), which stays in the database: withdrawing a stored match is not possible yet`);
      }
    }
    if (k.kind === 'inbox') out.keep.set(k.key, { fill, notes });
  }
  return out;
}
