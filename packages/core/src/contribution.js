/**
 * One contribution = a GROUP of files that share a base name (spec ATT-01):
 *   name.mat | name.txt   the match as text (preferred)
 *   name.sgf              GNU Backgammon SGF (may carry analysis): kept as an attachment; also usable as the match itself
 *   name.xg               eXtreme Gammon file (binary, with analysis): read like the others (it can be the match itself) and kept as an attachment
 *   name.bgdb.json        optional extras: { "links": [...], "tags": [...], "illegal": [...], "accept": "partial", "event", "round", "date" }
 *
 * `analyzeGroup` is the single check used everywhere: by `bgdb ingest`, by the pull-request review, and by the "contribute" page in the
 * browser (spec EAS-04: one validator, two runtimes). It does no input/output: files come in as bytes.
 */
import { decodeText } from './text.js';
import { readMatch, readMatchBytes } from './read.js';
import { contentHash } from './identity.js';
import { writeMat } from './mat-writer.js';
import { normalizeVideoLink } from './links.js';
import { sha256Hex } from './sha256.js';
import { cleanHeaderMetadata } from './metadata.js';

export const TAG_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;
const KINDS = { '.mat': 'mat', '.txt': 'txt', '.sgf': 'sgf', '.xg': 'xg' };
const DEFAULT_MAX_TEXT_KB = 4096;

/** {base, kind} of a file name, or null for a file that is not part of a contribution */
export function fileKind(name) {
  const lower = String(name).toLowerCase();
  if (lower.endsWith('.bgdb.json')) return { base: name.slice(0, -'.bgdb.json'.length), kind: 'side' };
  const dot = lower.lastIndexOf('.');
  const kind = dot > 0 ? KINDS[lower.slice(dot)] : undefined;
  return kind ? { base: name.slice(0, dot), kind } : null;
}

/**
 * Group files by directory + base name.
 * @param {{name:string, dir?:string}[]} entries any objects with a name (they are returned as they are)
 * @returns {{key:string, base:string, dir:string, files:Record<string, object[]>}[]}
 */
export function groupFiles(entries) {
  const groups = new Map();
  for (const e of entries) {
    const k = fileKind(e.name);
    if (!k) continue;
    const dir = e.dir ?? '';
    const key = `${dir}/${k.base}`;
    if (!groups.has(key)) groups.set(key, { key, base: k.base, dir, files: {} });
    (groups.get(key).files[k.kind] ??= []).push(e);
  }
  return [...groups.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** the notes of salvage: what was left out, or kept by its result only */
const SALVAGE_NOTE = /the moves cannot be read|the file stops in the middle of this game/;
const err = (code, message, hint) => ({ severity: 'error', code, message, ...(hint ? { hint } : {}) });
const warn = (code, message, hint) => ({ severity: 'warning', code, message, ...(hint ? { hint } : {}) });
const text = (bytes) => decodeText(bytes).text;
const info = (code, message) => ({ severity: 'info', code, message });
export const META_KEYS = ['event', 'round', 'date'];
const DATE_RE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;

/** a reviewed value of the sidecar (decision 0022): a short text, or null for "none" */
function metaValue(k, v) {
  if (v === null) return { ok: true, value: null };
  if (typeof v !== 'string') return { ok: false };
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) return { ok: true, value: null };
  if (t.length > 120 || /[\u0000-\u001f]/.test(t)) return { ok: false };
  if (k === 'date' && !DATE_RE.test(t)) return { ok: false };
  return { ok: true, value: t };
}

/** the optional name.bgdb.json: links, tags, declared illegal plays, the acceptance of a partial match, and reviewed event, round and date */
export function parseSidecar(name, bytes, config, warnings) {
  let j;
  try { j = JSON.parse(text(bytes)); } catch (e) {
    return { error: err('V-FORMAT', `${name} is not valid JSON (${e.message})`, 'The file must look like {"links": [{"url": "https://youtu.be/..."}], "tags": ["final"]}.') };
  }
  const out = { links: [], tags: [], illegal: [], accept: null, meta: {} };
  if (j?.accept !== undefined) {
    if (j.accept === 'partial') out.accept = 'partial';                 // the contributor agrees that the match is added partially (decision 0021)
    else warnings.push(warn('V-META', `${name}: "accept" can only be "partial"; it was ignored`));
  }
  for (const k of META_KEYS) {
    if (j?.[k] === undefined) continue;
    const r = metaValue(k, j[k]);
    if (r.ok) out.meta[k] = r.value;
    else warnings.push(warn('V-META', `${name}: "${k}" was ignored (${k === 'date' ? 'a date is written 2025-07-26, 2025-07 or 2025' : 'a text of at most 120 characters, or null'})`));
  }
  for (const k of Object.keys(j ?? {})) if (!['links', 'tags', 'illegal', 'accept', ...META_KEYS].includes(k)) warnings.push(warn('V-META', `${name}: the key "${k}" is not used and was ignored`));
  for (const l of Array.isArray(j?.links) ? j.links : []) {
    const r = normalizeVideoLink(l, { hosts: config.videoHosts });
    if (r.ok) out.links.push(r.link); else warnings.push(warn('V-LINK', `A video link was ignored: ${r.reason}`, 'Use an https link to a YouTube video.'));
  }
  for (const t of Array.isArray(j?.tags) ? j.tags : []) {
    if (typeof t === 'string' && TAG_RE.test(t)) out.tags.push(t); else warnings.push(warn('V-META', `The tag ${JSON.stringify(t)} was ignored (lower-case letters, digits and "-", at most 31 characters)`));
  }
  for (const d of Array.isArray(j?.illegal) ? j.illegal : []) {
    if (d && Number.isInteger(d.game) && d.game >= 1 && Number.isInteger(d.row) && d.row >= 1 && (d.player === undefined || typeof d.player === 'string')) out.illegal.push({ game: d.game, row: d.row, player: d.player ?? null });
    else warnings.push(warn('V-META', `${name}: an "illegal" entry was ignored (it must look like {"game": 6, "row": 19, "player": "Name"})`));
  }
  return out;
}

/** Attachments of a group. A problem with an attachment never blocks the match: it is a warning. */
function attachments(group, primary, config, full, warnings, readOpts) {
  const out = [];
  const maxBytes = (config.sealPolicy?.maxAttachmentKB ?? 2048) * 1024;
  const candidates = [];
  if (primary.kind === 'sgf') candidates.push({ kind: 'sgf', entry: primary.entry });
  else for (const e of group.files.sgf ?? []) candidates.push({ kind: 'sgf', entry: e });
  if (primary.kind === 'xg') candidates.push({ kind: 'xg', entry: primary.entry });
  else for (const e of group.files.xg ?? []) candidates.push({ kind: 'xg', entry: e });

  for (const c of candidates.slice(0, 2)) {                      // at most one of each kind
    const name = c.entry.name;
    if (out.some((o) => o.kind === c.kind)) { warnings.push(warn('V-ATTACH', `Only one ${c.kind.toUpperCase()} file per match is kept; ${name} was ignored`)); continue; }
    const bytes = c.entry.bytes;
    if (bytes.length > maxBytes) { warnings.push(warn('V-FILE', `${name} is ${Math.round(bytes.length / 1024)} KB, above the limit of ${config.sealPolicy?.maxAttachmentKB ?? 2048} KB: it was not kept`)); continue; }
    if (c.kind === 'sgf') {
      const r = readMatchBytes(bytes, readOpts);
      if (!r.ok) { warnings.push(warn('V-ATTACH', `${name} could not be read and was not kept: ${r.errors[0].message}`)); continue; }
      if (contentHash(r.match) !== full) { warnings.push(warn('V-ATTACH', `${name} does not describe the same match as the text file, so it was not kept`, 'Check that both files come from the same match.')); continue; }
      const an = r.match.provenance.analysis ?? { present: false, engine: null };
      out.push({ kind: 'sgf', name, bytes, verified: true, analysis: an.present, engine: an.engine, results: r.match.games.map((x) => [x.result.winner, x.result.points]), sides: r.match.sides.map((s) => s.name) });
    } else {
      if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'RGMH') { warnings.push(warn('V-ATTACH', `${name} is not an eXtreme Gammon file (it does not start with "RGMH") and was not kept`)); continue; }
      const r = readMatchBytes(bytes, readOpts);
      if (!r.ok) {
        // a file of a variant this reader does not know: it is kept as it is, unverified, as before the reader existed
        warnings.push(warn('V-ATTACH', `${name} could not be read (${r.errors[0].message}); it is kept unchecked`));
        out.push({ kind: 'xg', name, bytes, verified: false, analysis: null, engine: 'eXtreme Gammon' });
        continue;
      }
      if (contentHash(r.match) !== full) { warnings.push(warn('V-ATTACH', `${name} does not describe the same match as the text file, so it was not kept`, 'Check that both files come from the same match.')); continue; }
      const an = r.match.provenance.analysis ?? { present: false, engine: null };
      out.push({ kind: 'xg', name, bytes, verified: true, analysis: an.present, engine: an.engine, results: r.match.games.map((x) => [x.result.winner, x.result.points]), sides: r.match.sides.map((s) => s.name) });
    }
  }
  return out;
}

/**
 * Check one group of files.
 * @param {{base:string, files:Record<string,{name:string, bytes:Uint8Array}[]>}} group
 * @param {{config:{videoHosts?:string[], sealPolicy?:object}, known?:{get(fullHash:string):string|undefined}, salvage?:boolean, fill?:object}} ctx
 *   fill: event, round or date to use when the file has none (taken from another transcription of the match, decision 0023)
 *   known: what is already in the database (a Map from full content hash to match id works; so does any object with get())
 * @returns {{status:'new'|'duplicate'|'partial'|'error', errors:object[], warnings:object[], infos:object[], base:string, [k:string]:any}}
 */
export function analyzeGroup(group, ctx) {
  const { config, known } = ctx;
  const warnings = [];
  const base = { base: group.base, warnings, infos: [] };
  const fail = (errors) => ({ ...base, status: 'error', errors });

  // 1. the primary file: the match as text, else the SGF
  const texts = [...(group.files.mat ?? []), ...(group.files.txt ?? [])];
  if (texts.length > 1) return fail([err('V-FORMAT', `Several text files share the name "${group.base}": ${texts.map((t) => t.name).join(', ')}`, 'Keep one text version per match.')]);
  let primary;
  if (texts.length === 1) primary = { kind: 'text', entry: texts[0] };
  else if (group.files.sgf?.length) primary = { kind: 'sgf', entry: group.files.sgf[0] };
  else if (group.files.xg?.length) primary = { kind: 'xg', entry: group.files.xg[0] };
  else return fail([err('V-FORMAT', `"${group.base}.bgdb.json" has no match file next to it`, `Add "${group.base}.txt", "${group.base}.mat" or "${group.base}.sgf".`)]);
  const maxText = (primary.kind === 'xg' ? 16 * 1024 : (config.sealPolicy?.maxTextKB ?? DEFAULT_MAX_TEXT_KB)) * 1024;
  if (primary.entry.bytes.length > maxText) return fail([err('V-FILE', `${primary.entry.name} is ${Math.round(primary.entry.bytes.length / 1024)} KB, above the limit of ${maxText / 1024} KB`, 'A match file is a few KB: this is probably not a match.')]);

  // 2. optional extras: sidecar JSON (read first: it can declare plays that were made although illegal)
  let sc = { links: [], tags: [], illegal: [], meta: {} };
  if (group.files.side?.length) {
    sc = parseSidecar(group.files.side[0].name, group.files.side[0].bytes, config, warnings);
    if (sc.error) return fail([sc.error]);
  }
  let readOpts = { videoHosts: config.videoHosts, illegal: sc.illegal };

  // 3. the match itself. When it fails, salvage tells what could be kept (decision 0021): that is a partial match, added only when the
  // contributor accepts it ("accept": "partial" in the sidecar) or when an archive is imported with --salvage
  const matchText = primary.kind === 'xg' ? null : text(primary.entry.bytes);
  let r = readMatchBytes(primary.entry.bytes, readOpts);
  let partial = null;
  if (!r.ok) {
    const s = readMatchBytes(primary.entry.bytes, { ...readOpts, salvage: true });
    if (!s.ok) return fail(r.errors);
    partial = { accepted: !!ctx.salvage || sc.accept === 'partial', notes: s.warnings.filter((w) => SALVAGE_NOTE.test(w.message)), errors: r.errors };
    readOpts = { ...readOpts, salvage: true };
    r = s;
  }
  warnings.push(...r.warnings);
  base.infos = [...r.infos];
  // event and round: the headers cleaned (decision 0022), then what the contributor reviewed in the sidecar
  const h = cleanHeaderMetadata(r.match);
  r.match.event = h.event;
  r.match.round = h.round;
  for (const n of h.notes) base.infos.push(info('V-META', n));
  for (const [k, v] of Object.entries(sc.meta)) r.match[k] = v;
  // what another transcription of this match knows and this file does not (decision 0023)
  for (const [k, v] of Object.entries(ctx.fill ?? {})) {
    if (r.match[k] || !v) continue;
    r.match[k] = v;
    base.infos.push(info('V-COPY', `The ${k} "${v}" was taken from another transcription of this match`));
  }
  const full = contentHash(r.match);
  const links = r.match.links ?? [];
  for (const l of sc.links) if (!links.some((x) => x.url === l.url && x.game === l.game)) links.push(l);
  const summary = {
    players: r.match.sides.map((s) => s.name), matchLength: r.match.matchLength, date: r.match.date ?? null, event: r.match.event ?? null, round: r.match.round ?? null,
    games: r.match.games.length, result: r.match.result ?? null,
  };
  const common = { ...base, match: r.match, full, hash16: full.slice(0, 16), summary, links, tags: sc.tags, sidecar: sc, primary, ...(partial ? { partial } : {}) };

  // 4. already in the database?
  const dup = known?.get(full);
  if (dup !== undefined) {
    // what comes with it (links, tags, an SGF or XG file) can enrich the existing match: attachments are prepared here as well
    const extra = attachments(group, primary, config, full, warnings, readOpts);
    const sgfAsPrimary = primary.kind === 'sgf';
    const extrasIgnored = !!((group.files.sgf?.length && !sgfAsPrimary) || group.files.xg?.length || group.files.side?.length || links.length || (sgfAsPrimary && extra.length));
    return { ...common, status: 'duplicate', duplicateOf: dup, extrasIgnored, attachments: extra, errors: [] };
  }

  // 5. a partial match the contributor has not accepted: nothing is added; they get what would be stored, to look at it and decide
  if (partial && !partial.accepted) return { ...common, status: 'partial', errors: [], text: matchText, attachments: [], normalised: writeMat(r.match) };

  // 6. attachments, and the check that an SGF agrees with the text on the points
  const atts = attachments(group, primary, config, full, warnings, readOpts);
  for (const a of atts) {
    if (a.results && primary.kind === 'text') {                      // an SGF or an XG file read from the same match: the points are compared
      const mine = r.match.games.map((x) => [x.result.winner, x.result.points]);
      const sameOrder = a.sides[0] === r.match.sides[0].name;
      const theirs = a.results.map(([w, p]) => [sameOrder ? w : 1 - w, p]);
      const diff = mine.findIndex((m, i) => !theirs[i] || m[0] !== theirs[i][0] || m[1] !== theirs[i][1]);
      if (diff >= 0) warnings.push(warn('V-ATTACH', `The SGF and the text disagree on the points of game ${diff + 1} (text: ${mine[diff][1]}, SGF: ${theirs[diff]?.[1]}); the text value is used`));
    }
  }

  // 7. the normalised file must read back to the same match (safety net)
  const normalised = writeMat(r.match);
  const back = readMatch(normalised);
  if (!back.ok || contentHash(back.match) !== full) return fail([err('V-INTERNAL', 'The normalised file does not read back to the same match (please report this file).')]);

  return { ...common, status: 'new', errors: [], text: matchText, originalHash: sha256Hex(matchText ?? primary.entry.bytes), attachments: atts, normalised };
}
