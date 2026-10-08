/**
 * bgdb hide-names: what the Contribute page does to the names, for a contributor who sends a pull request by hand (decision 0025). The files
 * of each match are checked, then written to another folder with the names replaced by the pseudonyms of the contributor's names key (the
 * same key file as the page's, so the same opponent gets the same name), without the platform, the time of day, the event, the round, the
 * ratings and the remarks. The original files are not changed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { groupFiles, analyzeGroup, hideNames, namer, parseKey, newKey, keyFileText, keyFingerprint } from '@bgdb/core';

const slug = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'match';

/**
 * The key of a key file; a file that does not exist yet is created with a new key.
 * @returns {{key?:Uint8Array, created?:boolean, error?:string}}
 */
export function loadKeyFile(file) {
  if (!fs.existsSync(file)) {
    const key = newKey();
    fs.writeFileSync(file, keyFileText(key), { mode: 0o600 });
    return { key, created: true };
  }
  const key = parseKey(fs.readFileSync(file, 'utf8'));
  return key ? { key, created: false } : { error: `${file} is not a names key: it should hold a line that starts with "bgdb-key-1:"` };
}

/**
 * @param {{files:string[], key:Uint8Array, out:string, config:object}} o files: paths of match files and their .bgdb.json
 * @returns {Promise<{key:string, results:{base:string, status:string, written?:string[], players?:string[], notes?:string[], errors?:object[]}[]}>}
 */
export async function hideNamesInFiles(o) {
  const nameOf = namer(o.key);
  const entries = o.files.map((f) => ({ name: path.basename(f), dir: path.dirname(f), bytes: new Uint8Array(fs.readFileSync(f)) }));
  const taken = new Set();
  const results = [];
  for (const g of groupFiles(entries)) {
    const res = analyzeGroup(g, { config: o.config });
    if (res.status !== 'new' && res.status !== 'partial') { results.push({ base: g.base, status: res.status, errors: res.errors }); continue; }
    let hidden;
    try { hidden = await hideNames(res, nameOf); } catch (e) { results.push({ base: g.base, status: 'error', errors: [{ code: 'V-HANDLE', message: e.message }] }); continue; }
    const stem = `${slug(hidden.players[0])}-vs-${slug(hidden.players[1])}-${res.summary.date ?? 'undated'}`;
    let base = stem;
    for (let n = 2; taken.has(base); n++) base = `${stem}-${n}`;
    taken.add(base);
    fs.mkdirSync(o.out, { recursive: true });
    const written = [];
    const put = (name, bytes) => { fs.writeFileSync(path.join(o.out, name), bytes); written.push(name); };
    put(`${base}.mat`, hidden.normalised);
    for (const a of hidden.attachments) put(`${base}${a.ext}`, a.bytes);
    // what the sidecar adds and does not name anybody: links, tags, the acceptance of a partial match
    const sc = res.sidecar ?? {};
    const json = {};
    if (sc.accept) json.accept = sc.accept;
    if (sc.links?.length) json.links = sc.links;
    if (sc.tags?.length) json.tags = sc.tags;
    if (Object.keys(json).length) put(`${base}.bgdb.json`, `${JSON.stringify(json, null, 2)}\n`);
    results.push({ base: g.base, status: res.status, written, players: hidden.players, notes: hidden.notes });
  }
  return { key: keyFingerprint(o.key), results };
}
