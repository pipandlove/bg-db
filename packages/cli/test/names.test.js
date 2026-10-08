/**
 * Decision 0025 beyond the Contribute page: the names a data repository accepts (V-HANDLE, V-ORIGIN), `bgdb hide-names`, `bgdb erase`
 * and the erasure list (V-ERASED), and the "submitted by" search.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { analyzeGroup, isPseudonym } from '@bgdb/core';
import { main } from '../src/cli.js';
import { FIXTURES } from '../../core/test/helpers.js';

const REPO = path.resolve(FIXTURES, '..');
const capture = () => { const lines = []; return { lines, io: { out: (s) => lines.push(s), err: (s) => lines.push(s) } }; };
const FIX = {
  linnet: 'backgammon-studio/tester_-_Linnet14_7pt_Backgammon_Studio_2026_10_01_09_38_41.txt',
  cardinal: 'backgammon-studio/tester_-_Cardinal_5pt_Backgammon_Studio_2026_09_22_14_49_23.txt',
  vireo: 'opengammon/vireo_vs_tester_2026-09-30.mat',
  chText: 'choue-net/chouehandle-vs-Bot-all-games-s4020-2026-10-04.txt',
  chSgf: 'choue-net/chouehandle-vs-Bot-all-games-s4020-2026-10-04.sgf',
};
const ID_LINNET = '0001/2359e4c944b8d130';
const bytes = (rel) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, rel)));

function ws(config = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-names-'));
  const a = (rel) => path.join(root, rel);
  fs.mkdirSync(a('inbox'));
  const cfg = a('bgdb.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ name: 'T', license: 'CC0-1.0', ...config }));
  const run = async (...args) => { const c = capture(); const code = await main(args, c.io); return { code, text: c.lines.join('\n') }; };
  return {
    root, a, cfg, run,
    put: (key, name2 = path.basename(FIX[key])) => fs.copyFileSync(path.join(FIXTURES, FIX[key]), a(`inbox/${name2}`)),
    side: (key, json) => fs.writeFileSync(a(`inbox/${path.basename(FIX[key]).replace(/\.[^.]+$/, '')}.bgdb.json`), JSON.stringify(json)),
    ingest: (...x) => run('ingest', '--inbox', a('inbox'), '--data', a('data'), '--config', cfg, '--date', '2026-10-08', ...x),
    build: (...x) => run('build', '--data', a('data'), '--out', a('dist'), '--site', path.join(REPO, 'site'), '--config', cfg, ...x),
    erase: (...x) => run('erase', ...x, '--data', a('data'), '--date', '2026-10-09'),
    meta: (id) => JSON.parse(fs.readFileSync(a(`data/${id.split('/')[0]}/matches/${id.split('/')[1].slice(0, 2)}/${id.split('/')[1]}.meta.json`), 'utf8')),
  };
}
const shardJson = (w, id) => JSON.parse(fs.readFileSync(w.a(`data/${id}/shard.json`), 'utf8'));
const catalogOf = (w, shard) => {
  const m = JSON.parse(fs.readFileSync(w.a(`dist/data/${shard}/manifest.json`), 'utf8'));
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(w.a(`dist/data/${shard}/${m.files[0].path}`))).toString('utf8'));
};

// ------------------------------------------------------------------------------------------------ names a data repository accepts

test('names "pseudonyms": a match with the names of its file is refused (V-HANDLE); over the board it keeps them, and says so', async () => {
  const w = ws({ names: 'pseudonyms' });
  w.put('linnet');
  let r = await w.ingest();
  assert.equal(r.code, 1, r.text);
  assert.match(r.text, /V-HANDLE: 2 players of this match are named as in the file \("te…"\)/);
  assert.match(r.text, /how to fix: Send it from the Contribute page/);
  w.side('linnet', { origin: 'otb' });
  r = await w.ingest();
  assert.equal(r.code, 0, r.text);
  assert.equal(w.meta(ID_LINNET).provenance.origin, 'otb');
  assert.deepEqual(w.meta(ID_LINNET).sides.map((s) => s.name), ['tester', 'Linnet14']);
});

test('names "as-is" (the default of the tools) keeps names; --origin otb marks a whole archive; a stored online match has no origin', async () => {
  const w = ws();
  w.put('cardinal');
  assert.equal((await w.ingest()).code, 0);
  w.put('linnet');
  const r = await w.ingest('--origin', 'otb');
  assert.equal(r.code, 0, r.text);
  assert.equal(w.meta(ID_LINNET).provenance.origin, 'otb');
  const cardinal = fs.readdirSync(w.a('data/0001/matches'), { recursive: true }).find((f) => f.endsWith('.meta.json') && !f.includes('2359e4'));
  assert.equal(JSON.parse(fs.readFileSync(w.a(`data/0001/matches/${cardinal}`), 'utf8')).provenance.origin, undefined);
  assert.equal((await w.ingest('--origin', 'maybe')).code, 2);
});

test('over the board, but the file names an online platform: refused (V-ORIGIN)', async () => {
  const w = ws({ names: 'pseudonyms' });
  w.put('vireo');
  w.side('vireo', { origin: 'otb' });
  const r = await w.ingest();
  assert.equal(r.code, 1);
  assert.match(r.text, /V-ORIGIN: The match is declared as played over the board, but the file names an online platform \("OpenGammon"\)/);
});

test('V-HANDLE also covers the files that would enrich a stored match: an SGF with the names of its file is refused', () => {
  const config = { names: 'pseudonyms' };
  const text = analyzeGroup({ base: 'c', files: { txt: [{ name: 'c.txt', bytes: bytes(FIX.chText) }] } }, { config: {} });
  const known = new Map([[text.full, '0001/8787802c5abd114b']]);
  const r = analyzeGroup({ base: 'c', files: { sgf: [{ name: 'c.sgf', bytes: bytes(FIX.chSgf) }] } }, { config, known });
  assert.equal(r.status, 'error');
  assert.equal(r.errors[0].code, 'V-HANDLE');
  const plain = analyzeGroup({ base: 'c', files: { sgf: [{ name: 'c.sgf', bytes: bytes(FIX.chSgf) }] } }, { config: {}, known });
  assert.equal(plain.status, 'duplicate', 'names as they are: the SGF enriches the match as before');
});

test('the sidecar key "origin": otb or online, anything else is ignored with a warning', () => {
  const g = (json) => ({ base: 'l', files: { txt: [{ name: 'l.txt', bytes: bytes(FIX.linnet) }], side: [{ name: 'l.bgdb.json', bytes: new TextEncoder().encode(JSON.stringify(json)) }] } });
  assert.equal(analyzeGroup(g({ origin: 'otb' }), { config: {} }).origin, 'otb');
  assert.equal(analyzeGroup(g({ origin: 'online' }), { config: { names: 'pseudonyms' } }).errors[0].code, 'V-HANDLE');
  const odd = analyzeGroup(g({ origin: 'club' }), { config: {} });
  assert.equal(odd.origin, null);
  assert.ok(odd.warnings.some((x) => x.code === 'V-META' && /"origin" can only be/.test(x.message)));
});

// ------------------------------------------------------------------------------------------------ bgdb hide-names

test('hide-names: the files written carry pseudonyms only (the same with the same key), a new key file is made, and a data repository takes them', async () => {
  const w = ws({ names: 'pseudonyms' });
  const key = w.a('my-key.txt');
  const src = w.a('mine');
  fs.mkdirSync(src);
  fs.copyFileSync(path.join(FIXTURES, FIX.chText), path.join(src, 'c.txt'));
  fs.copyFileSync(path.join(FIXTURES, FIX.chSgf), path.join(src, 'c.sgf'));
  fs.copyFileSync(path.join(FIXTURES, FIX.vireo), path.join(src, 'v.mat'));
  let r = await w.run('hide-names', src, '--key-file', key, '--out', w.a('inbox'));
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /created a new names key/);
  assert.match(fs.readFileSync(key, 'utf8'), /^bgdb-key-1:[0-9a-f]{64}$/m);
  const written = fs.readdirSync(w.a('inbox')).sort();
  assert.equal(written.length, 3, written.join(', '));
  assert.ok(written.every((f) => /^[a-z]+-[a-z]+-[0-9a-f]{4}-vs-[a-z]+-[a-z]+-[0-9a-f]{4}-/.test(f)), written.join(', '));
  for (const f of written) {
    const t = fs.readFileSync(w.a(`inbox/${f}`), 'latin1');
    assert.ok(!/chouehandle|vireo|tester|OpenGammon|choue\.net/i.test(t), `${f} still names someone or the platform`);
  }
  // the same key again: the same names
  r = await w.run('hide-names', src, '--key-file', key, '--out', w.a('again'));
  assert.doesNotMatch(r.text, /created/);
  assert.deepEqual(fs.readdirSync(w.a('again')).sort(), written);
  r = await w.ingest();
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /2 added/);
  assert.match(r.text, /\+ sgf/);
  // a file that is not a key
  fs.writeFileSync(w.a('bad.txt'), 'nothing');
  assert.equal((await w.run('hide-names', src, '--key-file', w.a('bad.txt'), '--out', w.a('x'))).code, 2);
  assert.equal((await w.run('hide-names', src, '--out', w.a('x'))).code, 2);
});

// ------------------------------------------------------------------------------------------------ bgdb erase

test('erase: the files, the enrichment and the counts go; data/erased.tsv names no one; the same match is refused when sent again; the build drops it', async () => {
  const w = ws();
  w.put('linnet');
  w.put('cardinal');
  assert.equal((await w.ingest('--contributor', 'alice')).code, 0);
  assert.equal((await w.run('enrich', ID_LINNET, '--link', 'https://youtu.be/dQw4w9WgXcQ', '--data', w.a('data'), '--config', w.cfg)).code, 0);
  const metaText = fs.readFileSync(w.a(`data/0001/matches/23/2359e4c944b8d130.meta.json`), 'utf8');
  assert.equal((await w.erase(ID_LINNET)).code, 2, 'a reason is required');
  assert.equal((await w.erase(ID_LINNET, '--reason', 'whim')).code, 1);
  let r = await w.erase(ID_LINNET, '--reason', 'player-request', '--dry-run');
  assert.equal(r.code, 0);
  assert.match(r.text, /would be erased: its files in shard 0001/);
  assert.ok(fs.existsSync(w.a('data/0001/matches/23/2359e4c944b8d130.mat')), 'a dry run removes nothing');
  r = await w.erase(ID_LINNET, '--reason', 'player-request');
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /0001\/2359e4c944b8d130 erased: its files in shard 0001/);
  assert.ok(!fs.existsSync(w.a('data/0001/matches/23')), 'its files and its empty folder are gone');
  assert.ok(!fs.existsSync(w.a('data/enrichments/0001/23')), 'its enrichment is gone');
  assert.equal(shardJson(w, '0001').counts.matches, 1);
  const list = fs.readFileSync(w.a('data/erased.tsv'), 'utf8');
  assert.match(list, /^# matches removed/);
  assert.match(list, /\n2359e4c944b8d130[0-9a-f]{48}\t0001\/2359e4c944b8d130\t2026-10-09\tplayer-request\n$/);
  assert.ok(!/tester|Linnet/i.test(list), 'no name in the list');
  assert.match((await w.erase(ID_LINNET, '--reason', 'player-request')).text, /already erased \(2026-10-09, player-request\)/);
  // sent again, under another file name: refused
  w.put('linnet', 'again.txt');
  r = await w.ingest();
  assert.equal(r.code, 1);
  assert.match(r.text, /V-ERASED: This match was removed from the database \(player-request, 2026-10-09\) and cannot be added again/);
  const rv = await w.run('review', '--inbox', w.a('inbox'), '--data', w.a('data'), '--config', w.cfg);
  assert.match(rv.text, /V-ERASED/);
  // the build publishes the other match only, and refuses an erased match whose files came back
  r = await w.build();
  assert.equal(r.code, 0, r.text);
  assert.equal(catalogOf(w, '0001').count, 1);
  fs.mkdirSync(w.a('data/0001/matches/23'), { recursive: true });
  fs.writeFileSync(w.a('data/0001/matches/23/2359e4c944b8d130.meta.json'), metaText);
  fs.copyFileSync(path.join(FIXTURES, FIX.linnet), w.a('data/0001/matches/23/2359e4c944b8d130.mat'));
  r = await w.build();
  assert.equal(r.code, 1);
  assert.match(r.text, /0001\/2359e4c944b8d130: it was erased \(data\/erased\.tsv\), but its files are in shard 0001 again/);
});

test('erase in a sealed shard: its digest is recorded again, so the build still trusts it', async () => {
  const w = ws();
  w.put('linnet');
  w.put('cardinal');
  assert.equal((await w.ingest('--max-matches', '2')).code, 0);
  w.put('vireo');
  assert.equal((await w.ingest('--max-matches', '2')).code, 0);
  const sealed = shardJson(w, '0001');
  assert.equal(sealed.status, 'sealed');
  const r = await w.erase(ID_LINNET, '--reason', 'rights');
  assert.match(r.text, /sealed: its digest recorded again/);
  const s = shardJson(w, '0001');
  assert.equal(s.status, 'sealed');
  assert.equal(s.counts.matches, 1);
  assert.ok(s.counts.bytes < sealed.counts.bytes);
  assert.notEqual(s.integrity.digest, sealed.integrity.digest);
  const b = await w.build();
  assert.equal(b.code, 0, b.text);
  assert.match(b.text, /1 trusted by their seal/);
  assert.doesNotMatch(b.text, /differ from the digest/);
});

test('erase of a match whose shard lives in another data repository: its hash line goes, the list keeps it, and the command says to run it there too', async () => {
  const w = ws();
  const full = `abcdef0123456789${'0'.repeat(48)}`;
  fs.mkdirSync(w.a('data/hashes'), { recursive: true });
  fs.writeFileSync(w.a('data/hashes/0003.tsv'), `${full}\t0003/abcdef0123456789\n${'1'.repeat(64)}\t0003/1111111111111111\n`);
  const r = await w.erase('0003/abcdef0123456789', '--reason', 'legal');
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /its line in 0003\.tsv/);
  assert.match(r.text, /run the same command there too/);
  assert.equal(fs.readFileSync(w.a('data/hashes/0003.tsv'), 'utf8'), `${'1'.repeat(64)}\t0003/1111111111111111\n`);
  assert.match(fs.readFileSync(w.a('data/erased.tsv'), 'utf8'), new RegExp(`${full}\t0003/abcdef0123456789\t2026-10-09\tlegal`));
  assert.match((await w.erase('0003/ffffffffffffffff', '--reason', 'legal')).text, /No match 0003\/ffffffffffffffff/);
  assert.equal((await w.erase('nonsense', '--reason', 'legal')).code, 1);
});

// ------------------------------------------------------------------------------------------------ submitted by

test('"submitted by": the catalog names the contributor, the search takes by:login, and the match page links to it', async () => {
  const w = ws();
  w.put('linnet');
  assert.equal((await w.ingest('--contributor', 'Alice')).code, 0);
  w.put('cardinal');
  assert.equal((await w.ingest()).code, 0);
  assert.equal((await w.build()).code, 0);
  const c = catalogOf(w, '0001');
  assert.deepEqual(c.dict.contributors, ['Alice']);
  const site = (f) => import(pathToFileURL(w.a(`dist/js/${f}`)).href);
  const [cat, q] = [await site('catalog.js'), await site('query.js')];
  const rows = cat.decodeCatalog(c, '0001');
  const f = q.parseQuery('by:@alice');
  assert.deepEqual(f.by, ['alice']);
  assert.equal(q.formatQuery(f), 'by:alice');
  assert.deepEqual(rows.filter(q.makePredicate(f)).map((x) => x.id), [ID_LINNET], 'any case, the whole login');
  assert.equal(rows.filter(q.makePredicate(q.parseQuery('by:ali'))).length, 0);
  assert.match(fs.readFileSync(w.a('dist/js/app.js'), 'utf8'), /#q=\$\{encodeQ\(`by:\$\{meta\.provenance\.contributor\}`\)\}/);
  assert.ok(isPseudonym('quick-skunk-a63a'));
});
