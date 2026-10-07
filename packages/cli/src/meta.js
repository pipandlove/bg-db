/**
 * bgdb meta: the review of event, round and date before an ingest (decision 0022, spec CTB-13).
 *
 *   bgdb meta [--inbox inbox] [--data data] [--sheet meta-review.tsv]   writes the review sheet: what the file names propose, and the groups
 *                                                                       of matches that nothing tells apart (headers cleaned, sidecars applied)
 *   bgdb meta [--inbox inbox] --apply meta-review.tsv                   writes the values of the sheet, as reviewed, into the .bgdb.json sidecars
 *
 * Values the headers give are applied automatically by the ingest; only what comes from elsewhere (the file name, the order of play) is
 * reviewed. The sheet is tab-separated text: open it in a spreadsheet or an editor, change the columns date, event and round, save it as it is.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseMatchBytes, readMatchBytes, contentHash, cleanHeaderMetadata, nameMetadata, planMetadata, parseSidecar, sha256Hex, decodeText, META_KEYS, RANK_TEXT } from '@bg-db/core';
import { collectGroups, storedMatches } from './ingest.js';
import { reconcileInbox, movesFingerprint } from './reconcile.js';
import { listShards } from './store.js';

export const SHEET_COLUMNS = ['status', 'action', 'group', 'file', 'players', 'length', 'date', 'time', 'event', 'round', 'from', 'note'];
const EDITABLE = ['date', 'event', 'round'];

const primaryOf = (g) => [...(g.files.mat ?? []), ...(g.files.txt ?? [])][0] ?? g.files.sgf?.[0] ?? g.files.xg?.[0] ?? null;

function readSidecarJson(entry) {
  if (!entry) return {};
  try { return JSON.parse(new TextDecoder().decode(entry.bytes)); } catch { return null; }
}

/**
 * The metadata of each match of the inbox: headers cleaned (what the ingest applies by itself), then the reviewed values of its sidecar.
 * @returns {{items:object[], skipped:string[]}}
 */
export function readInbox(inbox, config = {}) {
  const items = [];
  const skipped = [];
  for (const g of collectGroups(inbox)) {
    const primary = primaryOf(g);
    if (!primary) continue;
    const file = path.relative(inbox, primary.path).split(path.sep).join('/');
    const r = parseMatchBytes(primary.bytes);
    if (!r.ok) { skipped.push(`${file}: ${r.error}`); continue; }
    const m = r.match;
    const h = cleanHeaderMetadata(m);
    const auto = { date: m.date ?? null, event: h.event, round: h.round };
    let meta = {};
    if (g.files.side?.length) meta = parseSidecar(g.files.side[0].name, g.files.side[0].bytes, config, []).meta ?? {};
    items.push({
      file, base: g.base, group: g, players: m.sides.map((s) => s.name), matchLength: m.matchLength, time: m.time ?? null,
      auto, ...auto, ...meta, name: nameMetadata(g.base, m), moves: movesFingerprint(primary.bytes, r.format),
    });
  }
  return { items, skipped };
}

const cell = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ');

/** the identity of a match (as the ingest computes it, with --salvage), or null when it cannot be read */
function matchId(bytes) {
  let r = readMatchBytes(bytes);
  if (!r.ok) r = readMatchBytes(bytes, { salvage: true });
  return r.ok ? contentHash(r.match) : null;
}

const pct = (r) => `${(r * 100).toFixed(1)}%`;

/** the review sheet of an inbox */
export function writeSheet({ inbox, data, sheet, config }) {
  const { items: all, skipped } = readInbox(inbox, config);
  const stored = data && fs.existsSync(data) ? storedMatches(listShards(data), data) : [];
  // transcriptions of one match (decision 0023): the ingest keeps the best one by itself; when none is better, a person chooses
  const recon = reconcileInbox(all.map((it) => it.group), { stored, config, label: (g) => all.find((it) => it.group === g)?.file ?? g.base });
  const items = all.filter((it) => !recon.superseded.has(it.group.key));
  let plan = planMetadata(items, stored);
  // matches that nothing tells apart may still be one match transcribed twice (another layout, other spaces): only for them, the identity
  // is computed as the ingest does it (it reads every move, so it is slow, but these are few)
  const same = new Set(plan.rows.filter((r) => r.status === 'same').map((r) => r.file));
  if (same.size) {
    for (const it of items) {
      if (!same.has(it.file)) continue;
      const id = matchId(primaryOf(it.group).bytes);
      if (id) it.moves = `id:${id}`;
    }
    plan = planMetadata(items, stored);
  }
  const rows = plan.rows;
  const byFile = new Map(rows.map((r) => [r.file, r]));
  const itemOf = new Map(all.map((it) => [it.group.key, it]));
  const rowOf = (it, status, note) => {
    let r = byFile.get(it.file);
    if (!r) {
      r = { group: null, file: it.file, players: it.players, matchLength: it.matchLength, time: it.time, date: it.date ?? null, event: it.event ?? null, round: it.round ?? null, from: '' };
      rows.push(r);
      byFile.set(it.file, r);
    }
    r.status = status;
    r.note = [note, r.note].filter(Boolean).join('; ');
    return r;
  };
  let groupNo = plan.groups;
  for (const t of recon.ties) {
    groupNo++;
    for (const m of t.members) {
      const it = m.key && itemOf.get(m.key);
      if (!it) continue;
      const others = t.members.filter((x) => x !== m).map((x) => `${x.label}${x.key ? '' : ' (in the database)'}`).join(', ');
      rowOf(it, 'near-duplicate', `another transcription of ${others}: ${pct(t.ratio)} of the rolls in common, first difference: ${t.diff}; both are valid: put reject in the column action on the one to drop, or leave both`).group = groupNo;
    }
  }
  for (const [key, sup] of recon.superseded) {
    const it = itemOf.get(key);
    rowOf(it, 'superseded', `the ingest keeps ${sup.by}${sup.byStored ? ' (in the database)' : ''} (${RANK_TEXT[sup.keeperRank]}); this one is ${RANK_TEXT[sup.rank]}; ${pct(sup.ratio)} of the rolls in common, first difference: ${sup.diff}`);
  }
  const order = { same: 0, 'near-duplicate': 1, series: 2, name: 3, superseded: 4, duplicate: 5 };
  rows.sort((a, b) => order[a.status] - order[b.status] || (a.group ?? 0) - (b.group ?? 0) || a.file.localeCompare(b.file, 'en', { numeric: true }));

  const lines = [SHEET_COLUMNS.join('\t')];
  for (const r of rows) {
    lines.push([r.status, '', r.group ?? '', r.file, r.players.join(' vs '), r.matchLength, r.date, r.time, r.event, r.round, r.from, r.note].map(cell).join('\t'));
  }
  fs.writeFileSync(sheet, `${lines.join('\n')}\n`);
  const count = (st) => rows.filter((r) => r.status === st).length;
  return {
    files: all.length, rows: rows.length, same: count('same'), nearDuplicate: count('near-duplicate'), series: count('series'), name: count('name'),
    superseded: count('superseded'), duplicate: count('duplicate'), groups: groupNo, skipped,
  };
}

/** read a sheet: rows as objects keyed by column name */
export function readSheet(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], error: 'the sheet is empty' };
  const head = lines[0].split('\t').map((h) => h.trim().toLowerCase());
  for (const c of ['file', ...EDITABLE]) if (!head.includes(c)) return { rows: [], error: `the sheet has no column "${c}"` };
  return { rows: lines.slice(1).map((l) => { const v = l.split('\t'); return Object.fromEntries(head.map((h, i) => [h, (v[i] ?? '').trim()])); }) };
}

/**
 * Apply a reviewed sheet. A row whose column action says "reject" moves the files of that match out of the inbox, into the folder of
 * rejected files (with its reason in REASONS.md there); applying the same sheet again after a reset rejects them again. For the other rows,
 * the values are written into the sidecars: only what differs from the headers (the rest is applied by the ingest anyway); an empty cell
 * means "none".
 * @param {{inbox:string, sheet:string, config?:object, dryRun?:boolean, rejected?:string}} o  rejected: default "rejected" next to the inbox
 * @returns {{written:number, unchanged:number, rejected:number, errors:string[]}}
 */
export function applySheet({ inbox, sheet, config, dryRun = false, rejected }) {
  const parsed = readSheet(fs.readFileSync(sheet, 'utf8'));
  if (parsed.error) return { written: 0, unchanged: 0, rejected: 0, errors: [parsed.error] };
  const rejectDir = rejected ?? path.join(path.dirname(path.resolve(inbox)), 'rejected');
  const { items } = readInbox(inbox, config);
  const byFile = new Map(items.map((it) => [it.file, it]));
  const errors = [];
  let written = 0;
  let unchanged = 0;
  let rejectedCount = 0;
  const reasons = [];
  for (const row of parsed.rows) {
    const action = (row.action ?? '').toLowerCase();
    if (action && action !== 'reject') { errors.push(`${row.file}: the action "${row.action}" is not known (only "reject", or nothing)`); continue; }
    const it = byFile.get(row.file);
    if (action === 'reject') {
      if (!it) {
        if (fs.existsSync(path.join(rejectDir, path.basename(row.file)))) { unchanged++; continue; }   // rejected by an earlier apply
        errors.push(`${row.file}: no such match in ${inbox}`);
        continue;
      }
      rejectedCount++;
      reasons.push(`- ${row.file}: rejected in the review of ${path.basename(sheet)}${row.note ? ` (${row.note})` : ''}`);
      if (dryRun) continue;
      fs.mkdirSync(rejectDir, { recursive: true });
      for (const e of Object.values(it.group.files).flat()) fs.renameSync(e.path, path.join(rejectDir, path.basename(e.path)));
      continue;
    }
    if (!it) { errors.push(`${row.file}: no such match in ${inbox}`); continue; }
    const wanted = Object.fromEntries(EDITABLE.map((k) => [k, row[k] || null]));
    const check = [];
    const ok = parseSidecar('row', new TextEncoder().encode(JSON.stringify(wanted)), config, check);
    if (check.length) { errors.push(`${row.file}: ${check.map((w) => w.message.replace(/^row: /, '')).join('; ')}`); continue; }
    const sideEntry = it.group.files.side?.[0];
    const json = readSidecarJson(sideEntry);
    if (json === null) { errors.push(`${row.file}: its .bgdb.json is not valid JSON; fix it first`); continue; }
    const next = { ...json };
    for (const k of META_KEYS) {
      const v = ok.meta[k] ?? null;
      if (v === (it.auto[k] ?? null)) delete next[k]; else next[k] = v;
    }
    if (JSON.stringify(next) === JSON.stringify(json)) { unchanged++; continue; }
    written++;
    if (dryRun) continue;
    const target = sideEntry?.path ?? path.join(it.group.dir, `${it.group.base}.bgdb.json`);
    if (Object.keys(next).length) fs.writeFileSync(target, `${JSON.stringify(next, null, 2)}\n`);
    else if (sideEntry) fs.rmSync(target);
  }
  if (reasons.length && !dryRun) fs.appendFileSync(path.join(rejectDir, 'REASONS.md'), `${reasons.join('\n')}\n`);
  return { written, unchanged, rejected: rejectedCount, errors };
}
