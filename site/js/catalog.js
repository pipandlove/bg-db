/**
 * Loading the database in the browser: sources -> registries -> shards -> compressed catalogs (spec sections 7 and 8).
 * sources.json lists the data repositories the site reads (decision 0024); without it, the registry next to the page is the only source.
 * All URLs are resolved against the page, so the site works under any path (GitHub Pages sub-folders included).
 */
import { normalizeName } from '../lib/core/names.js';
import { checkSources, mergeEnrichment } from '../lib/core/sources.js';
import { FLAG_BITS } from './query.js';

export class LoadError extends Error {
  constructor(message, status = null) { super(message); this.status = status; }
}

async function getBytes(url, fetchImpl, init) {
  let r;
  try { r = await fetchImpl(url, init); } catch (e) { throw new LoadError(`${url}: ${e.message}`); }
  if (!r.ok) throw new LoadError(`${url}: HTTP ${r.status}`, r.status);
  return new Uint8Array(await r.arrayBuffer());
}

export async function fetchText(url, fetchImpl = fetch, init) {
  return new TextDecoder().decode(await getBytes(url, fetchImpl, init));
}

export async function fetchJson(url, fetchImpl = fetch, init) {
  const bytes = await getBytes(url, fetchImpl, init);
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new LoadError(`${url}: not valid JSON`); }
}

/** JSON that is gzip-compressed on disk. If a server already decoded it, plain JSON is accepted too. */
export async function fetchGzJson(url, fetchImpl = fetch) {
  const bytes = await getBytes(url, fetchImpl);
  let text;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  else text = new TextDecoder().decode(bytes);
  try { return JSON.parse(text); } catch { throw new LoadError(`${url}: not valid JSON`); }
}

/** Columnar catalog -> one object per match, with the strings the search needs already normalised. */
export function decodeCatalog(cat, shardId) {
  const c = cat.cols;
  const rows = new Array(cat.count);
  for (let i = 0; i < cat.count; i++) {
    const p0 = cat.dict.players[c.p0[i]] ?? '';
    const p1 = cat.dict.players[c.p1[i]] ?? '';
    const event = c.ev[i] >= 0 ? cat.dict.events[c.ev[i]] : '';
    const round = c.rd && c.rd[i] >= 0 ? cat.dict.rounds[c.rd[i]] : '';          // catalogs of version 1 have no rounds
    const date = c.date[i] || '';
    const n0 = normalizeName(p0);
    const n1 = normalizeName(p1);
    const eventNorm = normalizeName(event);
    const roundNorm = normalizeName(round);
    rows[i] = {
      shard: shardId, hash: c.id[i], id: `${shardId}/${c.id[i]}`,
      p0, p1, n0, n1, event, eventNorm, round, roundNorm, hay: `${n0} ${n1} ${eventNorm} ${roundNorm}`,
      len: c.len[i], date, year: /^\d{4}/.test(date) ? +date.slice(0, 4) : null,
      games: c.n[i], s0: c.s0[i], s1: c.s1[i], win: c.win[i], flags: c.fl[i],
    };
  }
  return rows;
}

/**
 * Apply the enrichments (video links, tags and files added to matches that were already in the database, corrections of their event, round
 * and date) on top of the rows read from the shards: the flags of the rows change, so that "has:video" and the tags of the list include them,
 * and corrected values replace those of the catalog. Sealed shards are never changed by an enrichment.
 */
export function applyEnrichments(rows, items) {
  for (const r of rows) {
    const e = items[r.id];
    if (!e) continue;
    if (e.meta) {
      if ('event' in e.meta) { r.event = e.meta.event ?? ''; r.eventNorm = normalizeName(r.event); }
      if ('round' in e.meta) { r.round = e.meta.round ?? ''; r.roundNorm = normalizeName(r.round); }
      if ('date' in e.meta) { r.date = e.meta.date ?? ''; r.year = /^\d{4}/.test(r.date) ? +r.date.slice(0, 4) : null; }
      r.hay = `${r.n0} ${r.n1} ${r.eventNorm} ${r.roundNorm}`;
    }
    if (e.links?.length) r.flags |= FLAG_BITS.video;
    if (e.attachments?.length) r.flags |= FLAG_BITS.attachment;
    if (e.attachments?.some((a) => a.analysis === true)) r.flags |= FLAG_BITS.analysis;
    r.enriched = true;
  }
  return rows;
}

/** newest first, undated last; on the same day by event, then by round in natural order (Round 2 before Round 10), then by id */
export function compareRows(a, b) {
  if (a.date !== b.date) {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date < b.date ? 1 : -1;
  }
  const byEvent = a.event.localeCompare(b.event);
  if (byEvent) return byEvent;
  const byRound = a.round.localeCompare(b.round, 'en', { numeric: true });
  if (byRound) return byRound;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The data repositories to read: sources.json next to the page, or, when there is none, the registry next to the page alone.
 * Sources in the state "next" (created, not used yet) are not read.
 * @returns {Promise<{sources:{name:string, url:string, state:string, repository:string|null, defaultBranch:string|null}[], name:string|null, license:string|null, fromFile:boolean}>}
 */
export async function loadSources(base, fetchImpl = fetch) {
  const url = new URL('sources.json', base).href;
  let j;
  try { j = await fetchJson(url, fetchImpl, { cache: 'no-cache' }); } catch (e) {
    if (e.status !== 404) throw e;
    return { sources: [{ name: 'this site', url: new URL('./', base).href, state: 'current', repository: null, defaultBranch: null }], name: null, license: null, fromFile: false };
  }
  const c = checkSources(j);
  if (!c.ok) throw new LoadError(`${url}: ${c.errors[0]}`);
  return { sources: c.sources.filter((s) => s.state !== 'next').map((s) => ({ ...s, url: new URL(s.url, url).href })), name: c.name, license: c.license, fromFile: true };
}

/**
 * @param {{base:string, fetchImpl?:typeof fetch}} o  base = URL of the page (sources.json, or the registry, is next to it)
 * @returns {Promise<{registry:object, registryUrl:string, sources:object[], enrichments:object, shards:object[], rows:object[], players:object[], events:string[], lengths:number[], years:number[], errors:string[]}>}
 *   registry: the registry of the current source, with the name and licence of sources.json, the repository that takes contributions,
 *   and the shards of every source (their base made absolute)
 */
export async function loadAll({ base, fetchImpl = fetch }) {
  const plan = await loadSources(base, fetchImpl);
  const errors = [];
  // every source's registry; a source that cannot be read is a notice, unless it is the only one
  const regs = await Promise.all(plan.sources.map(async (src) => {
    const registryUrl = new URL('registry.json', src.url).href;
    try { return { src, registryUrl, registry: await fetchJson(registryUrl, fetchImpl, { cache: 'no-cache' }) }; } catch (e) {
      if (plan.sources.length === 1) throw e;
      errors.push(`The data of ${src.name} could not be loaded (${e.message}); results may be incomplete.`);
      return null;
    }
  }));
  const read = regs.filter(Boolean);
  if (read.length === 0) throw new LoadError('none of the data repositories could be loaded');
  const cur = read.find((r) => r.src.state === 'current') ?? read[read.length - 1];

  // the shards of every source, in the order of the sources; a shard number is global, so a second listing of it is a mistake
  const listed = [];
  const seen = new Map();
  for (const { src, registryUrl, registry } of read) {
    for (const s of registry.shards ?? []) {
      if (seen.has(s.id)) { errors.push(`Shard ${s.id} is listed by ${seen.get(s.id)} and by ${src.name}; the second listing is ignored.`); continue; }
      seen.set(s.id, src.name);
      listed.push({ ...s, base: new URL(s.base, registryUrl).href, source: src.name });
    }
  }
  listed.sort((a, b) => (a.id < b.id ? -1 : 1));
  const loaded = await Promise.all(listed.map(async (s) => {
    try {
      // shard.json names the catalog of the moment, so it is revalidated like the registry (spec CL-02): GitHub Pages lets a browser keep
      // it ten minutes, and a stale copy hid the matches just added (2026-10-08). The catalog's name holds its hash, so it can be kept.
      const info = await fetchJson(new URL('shard.json', s.base).href, fetchImpl, { cache: 'no-cache' });
      const cat = await fetchGzJson(new URL(info.indexes.catalog, s.base).href, fetchImpl);
      return { id: s.id, base: s.base, source: s.source, info, rows: decodeCatalog(cat, s.id) };
    } catch (e) {
      errors.push(`Shard ${s.id} could not be loaded (${e.message}); results may be incomplete.`);   // spec CL-20
      return null;
    }
  }));
  const shards = loaded.filter(Boolean);
  const rows = shards.flatMap((s) => s.rows);

  // the enrichments of every source, merged in the order of the sources (a correction made in a later repository wins);
  // each attachment gets the absolute address of its file, which lives next to the registry that lists it
  const overlays = await Promise.all(read.map(async ({ src, registryUrl, registry }) => {
    if (!registry.overlays?.enrichments) return {};
    try {
      const items = (await fetchGzJson(new URL(registry.overlays.enrichments, registryUrl).href, fetchImpl)).items ?? {};
      for (const e of Object.values(items)) for (const a of e.attachments ?? []) a.href = new URL(a.url, registryUrl).href;
      return items;
    } catch (e) {
      errors.push(`The video links and files added to existing matches${read.length > 1 ? ` (${src.name})` : ''} could not be loaded (${e.message}); they are missing from the pages.`);
      return {};
    }
  }));
  const enrichments = {};
  for (const items of overlays) for (const [id, e] of Object.entries(items)) enrichments[id] = mergeEnrichment(enrichments[id], e);

  const registry = {
    ...cur.registry,
    name: plan.name ?? cur.registry.name, license: plan.license ?? cur.registry.license,
    repository: cur.src.repository ?? cur.registry.repository ?? null, defaultBranch: cur.src.repository ? cur.src.defaultBranch : cur.registry.defaultBranch,
    shards: listed,
  };
  delete registry.overlays;
  applyEnrichments(rows, enrichments);
  rows.sort(compareRows);                                          // after the corrections, which can change the date, event or round

  const playerCount = new Map();
  const display = new Map();
  const events = new Set();
  const lengths = new Set();
  let minYear = null;
  let maxYear = null;
  for (const r of rows) {
    for (const [raw, norm] of [[r.p0, r.n0], [r.p1, r.n1]]) {
      if (!norm) continue;
      playerCount.set(norm, (playerCount.get(norm) ?? 0) + 1);
      if (!display.has(norm)) display.set(norm, raw);
    }
    if (r.event) events.add(r.event);
    lengths.add(r.len);
    if (r.year !== null) { minYear = minYear === null ? r.year : Math.min(minYear, r.year); maxYear = maxYear === null ? r.year : Math.max(maxYear, r.year); }
  }
  const players = [...playerCount].map(([norm, count]) => ({ norm, name: display.get(norm), count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    registry, registryUrl: cur.registryUrl, sources: read.map((r) => r.src), enrichments, shards, rows, players,
    events: [...events].sort((a, b) => a.localeCompare(b)),
    lengths: [...lengths].sort((a, b) => a - b),
    years: [minYear, maxYear], errors,
  };
}

/** Players matching what is being typed: names starting with it first, then names containing it. */
export function suggestPlayers(players, fragment, limit = 8) {
  const f = normalizeName(fragment);
  if (f.length < 2) return [];
  const starts = [];
  const contains = [];
  for (const p of players) {
    const i = p.norm.indexOf(f);
    if (i === 0 || p.norm.split(' ').some((w) => w.startsWith(f))) starts.push(p);
    else if (i > 0) contains.push(p);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

export function suggestEvents(events, fragment, limit = 8) {
  const f = normalizeName(fragment);
  if (f.length < 2) return [];
  return events.filter((e) => normalizeName(e).includes(f)).slice(0, limit);
}
