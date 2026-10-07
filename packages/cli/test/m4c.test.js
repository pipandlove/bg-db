import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { main } from '../src/cli.js';
import { createStaticServer } from '../src/serve.js';
import { treeDigest, checkExternalShards, loadConfig } from '../src/store.js';
import { FIXTURES } from '../../core/test/helpers.js';

const REPO = path.resolve(FIXTURES, '..');
const capture = () => { const lines = []; return { lines, io: { out: (s) => lines.push(s), err: (s) => lines.push(s) } }; };
const FIX = {
  linnet: 'backgammon-studio/tester_-_Linnet14_7pt_Backgammon_Studio_2026_10_01_09_38_41.txt',
  cardinal: 'backgammon-studio/tester_-_Cardinal_5pt_Backgammon_Studio_2026_09_22_14_49_23.txt',
  vireo: 'opengammon/vireo_vs_tester_2026-09-30.mat',
  chText: 'choue-net/chouehandle-vs-Bot-all-games-s4020-2026-10-04.txt',
  chSgf: 'choue-net/chouehandle-vs-Bot-all-games-s4020-2026-10-04.sgf',
  otherSgf: 'gnubg-sgf/2026-01-22T18-31-58-avocet-tester.sgf',
  xg: 'xg-binary/Sir_Plover_vs_tester_2026-08-03.xg',
  sgMat: 'opengammon/Sir_Plover_vs_tester_2026-08-03.mat',
};
const ID_LINNET = '0001/2359e4c944b8d130';
const ID_CH = '0001/8787802c5abd114b';

/** a config file with nothing but a name and a licence: what loadConfig fills in is the default */
function w0() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-cfg-')); const f = path.join(d, 'c.json'); fs.writeFileSync(f, JSON.stringify({ name: 'T', license: 'CC0-1.0' })); return f; }

function ws(name = 'ws') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `bgdb-${name}-`));
  const a = (rel) => path.join(root, rel);
  fs.mkdirSync(a('inbox'));
  const cfg = a('bgdb.config.json');
  fs.writeFileSync(cfg, JSON.stringify({ name: 'T', license: 'CC0-1.0' }));
  const run = async (...args) => { const c = capture(); const code = await main(args, c.io); return { code, text: c.lines.join('\n') }; };
  return {
    root, a, cfg, run,
    put: (key, name2 = path.basename(FIX[key])) => fs.copyFileSync(path.join(FIXTURES, FIX[key]), a(`inbox/${name2}`)),
    ingest: (...x) => run('ingest', '--inbox', a('inbox'), '--data', a('data'), '--config', cfg, '--date', '2026-10-04', ...x),
    build: (out = 'dist', ...x) => run('build', '--data', a('data'), '--out', a(out), '--site', path.join(REPO, 'site'), '--config', cfg, ...x),
    enrich: (...x) => run('enrich', ...x, '--data', a('data'), '--config', cfg, '--date', '2026-10-05'),
  };
}
const tree = (dir) => { const o = {}; const rec = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) rec(p); else o[path.relative(dir, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } }; rec(dir); return o; };
const gunzip = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8'));
const loadSite = (dist, file) => import(pathToFileURL(path.join(dist, file)).href);

// ------------------------------------------------------------------------------------------------ enrichment

test('enrich: a video link and tags are added to an existing match; the shard is not touched; doing it twice adds nothing', async () => {
  const w = ws();
  w.put('linnet');
  await w.ingest();
  const before = tree(w.a('data/0001'));
  const r = await w.enrich(ID_LINNET, '--link', 'https://youtu.be/dQw4w9WgXcQ?t=95', '--title', 'Game 2', '--game', '2', '--tags', 'final, online', '--contributor', 'alice');
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /0001\/2359e4c944b8d130: added 1 video link\(s\), 2 tag\(s\)/);
  assert.deepEqual(tree(w.a('data/0001')), before, 'the shard is exactly as it was');
  const rec = JSON.parse(fs.readFileSync(w.a('data/enrichments/0001/23/2359e4c944b8d130.json'), 'utf8'));
  assert.deepEqual([rec.id, rec.tags, rec.contributors, rec.updatedAt], [ID_LINNET, ['final', 'online'], ['alice'], '2026-10-05']);
  assert.deepEqual([rec.links[0].id, rec.links[0].time, rec.links[0].game, rec.links[0].title], ['dQw4w9WgXcQ', 95, 2, 'Game 2']);
  const again = await w.enrich(ID_LINNET, '--link', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=95s', '--title', 'Game 2', '--game', '2', '--tags', 'final');
  assert.equal(again.code, 0);
  assert.match(again.text, /nothing new to add/);
  const more = await w.enrich(ID_LINNET, '--tags', 'semi-final', '--link', 'https://youtu.be/abcdefghijk');
  assert.match(more.text, /added 1 video link\(s\), 1 tag\(s\)/);
  assert.deepEqual(JSON.parse(fs.readFileSync(w.a('data/enrichments/0001/23/2359e4c944b8d130.json'), 'utf8')).tags, ['final', 'online', 'semi-final']);
});

test('enrich: the match can be named by the start of its hash; wrong, ambiguous or missing input is refused with a way out', async () => {
  const w = ws();
  w.put('linnet'); w.put('vireo');
  await w.ingest();
  assert.equal((await w.enrich('2359e4c9', '--tags', 'x')).code, 0, 'eight characters are enough');
  const short = await w.enrich('2359', '--tags', 'x');
  assert.equal(short.code, 1);
  assert.match(short.text, /No match "2359"/);
  assert.match((await w.enrich('0001/ffffffffffffffff', '--tags', 'x')).text, /No match/);
  assert.match((await w.enrich(ID_LINNET)).text, /Nothing to add/);
  const bad = await w.enrich(ID_LINNET, '--link', 'http://youtu.be/dQw4w9WgXcQ', '--tags', 'Bad Tag');
  assert.equal(bad.code, 1);
  assert.match(bad.text, /only https links are accepted/);
  assert.match(bad.text, /The tag "bad tag" is not valid/);
  assert.equal((await w.run('enrich', '--data', w.a('data'))).code, 2, 'usage');
  assert.ok(!fs.existsSync(w.a('data/enrichments/0001/ff')), 'nothing was written for refused input');
});

test('enrich: an SGF is checked against the match (the same match, with analysis), a file of another match or a bad XG file is refused', async () => {
  const w = ws();
  w.put('chText', 'c.txt');
  await w.ingest();
  const sgf = path.join(FIXTURES, FIX.chSgf);
  const ok = await w.enrich(ID_CH, '--sgf', sgf);
  assert.equal(ok.code, 0, ok.text);
  assert.match(ok.text, /added sgf/);
  const rec = JSON.parse(fs.readFileSync(w.a('data/enrichments/0001/87/8787802c5abd114b.json'), 'utf8'));
  assert.deepEqual([rec.attachments[0].kind, rec.attachments[0].verified, rec.attachments[0].analysis, rec.attachments[0].engine], ['sgf', true, true, 'GNU Backgammon:1.08.003']);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(w.a('data/enrichments/0001/87/8787802c5abd114b.sgf'))).digest('hex'), rec.attachments[0].sha256);
  const second = await w.enrich(ID_CH, '--sgf', sgf);
  assert.match(second.text, /nothing new/);
  const other = await w.enrich(ID_CH, '--sgf', path.join(FIXTURES, FIX.otherSgf));
  assert.equal(other.code, 1);
  assert.match(other.text, /is not the match 0001\/8787802c5abd114b/);
  const notXg = path.join(w.root, 'fake.xg'); fs.writeFileSync(notXg, 'hello');
  assert.match((await w.enrich(ID_CH, '--xg', notXg)).text, /not an eXtreme Gammon file/);
  const otherXg = await w.enrich(ID_CH, '--xg', path.join(FIXTURES, FIX.xg));
  assert.equal(otherXg.code, 1);
  assert.match(otherXg.text, /is not the match 0001\/8787802c5abd114b/);
  assert.deepEqual(JSON.parse(fs.readFileSync(w.a('data/enrichments/0001/87/8787802c5abd114b.json'), 'utf8')).attachments.map((a) => [a.kind, a.verified, a.analysis]), [['sgf', true, true]]);
  const dry = await w.enrich(ID_CH, '--tags', 'dry', '--dry-run');
  assert.match(dry.text, /would add/);
  assert.ok(!JSON.parse(fs.readFileSync(w.a('data/enrichments/0001/87/8787802c5abd114b.json'), 'utf8')).tags.includes('dry'));
});

test('enrich: an XG file of the same match is read, verified (analysis detected) and attached', async () => {
  const w = ws();
  w.put('sgMat');
  const r = await w.ingest();
  const id = r.text.match(/added\s+(0001\/[0-9a-f]{16})/)[1];
  const ok = await w.enrich(id, '--xg', path.join(FIXTURES, FIX.xg));
  assert.equal(ok.code, 0, ok.text);
  assert.match(ok.text, /added xg/);
  const [shard, hash] = id.split('/');
  const rec = JSON.parse(fs.readFileSync(w.a(`data/enrichments/${shard}/${hash.slice(0, 2)}/${hash}.json`), 'utf8'));
  assert.deepEqual(rec.attachments.map((a) => [a.kind, a.verified, a.analysis, a.engine]), [['xg', true, true, 'eXtreme Gammon']]);
});

test('ingest: an SGF submitted for a match that is already there is added to it (the duplicate becomes an enrichment)', async () => {
  const w = ws();
  w.put('chText', 'c.txt');
  await w.ingest();
  w.put('chSgf', 'later.sgf');
  const r = await w.ingest();
  assert.match(r.text, /enriched\s+0001\/8787802c5abd114b .*\+ sgf/);
  assert.equal(fs.existsSync(w.a('data/enrichments/0001/87/8787802c5abd114b.sgf')), true);
  assert.equal(fs.readdirSync(w.a('inbox')).length, 0);
  // a second SGF for the same match is not added again
  w.put('chSgf', 'again.sgf');
  const again = await w.ingest();
  assert.match(again.text, /duplicate\s+already in the database/);
  assert.match(again.text, /the match already has a SGF file/);
});

test('build publishes the enrichments as one overlay with their files, and checks them', async () => {
  const w = ws();
  w.put('chText', 'c.txt'); w.put('linnet');
  await w.ingest();
  await w.enrich(ID_CH, '--sgf', path.join(FIXTURES, FIX.chSgf), '--link', 'https://youtu.be/dQw4w9WgXcQ');
  await w.enrich(ID_LINNET, '--tags', 'final');
  const r = await w.build();
  assert.equal(r.code, 0, r.text);
  const reg = JSON.parse(fs.readFileSync(w.a('dist/registry.json'), 'utf8'));
  assert.match(reg.overlays.enrichments, /^overlays\/enrichments\.[0-9a-f]{8}\.json\.gz$/);
  const ov = gunzip(w.a(`dist/${reg.overlays.enrichments}`));
  assert.deepEqual(Object.keys(ov.items).sort(), [ID_LINNET, ID_CH]);
  const e = ov.items[ID_CH];
  assert.equal(e.links[0].id, 'dQw4w9WgXcQ');
  assert.deepEqual([e.attachments[0].kind, e.attachments[0].url, e.attachments[0].analysis], ['sgf', 'overlays/files/0001/87/8787802c5abd114b.sgf', true]);
  assert.equal(fs.existsSync(w.a('dist/overlays/files/0001/87/8787802c5abd114b.sgf')), true);
  assert.equal(fs.existsSync(w.a('dist/data/0001/attachments')), false, 'the shard published without attachments: it has none');
  // a stale record and a damaged file stop the build
  fs.mkdirSync(w.a('data/enrichments/0001/ff'), { recursive: true });
  fs.writeFileSync(w.a('data/enrichments/0001/ff/ffffffffffffffff.json'), JSON.stringify({ id: '0001/ffffffffffffffff', links: [], tags: ['x'], attachments: [] }));
  assert.match((await w.build()).text, /enrichment of 0001\/ffffffffffffffff: no such match in the database/);
  fs.rmSync(w.a('data/enrichments/0001/ff'), { recursive: true });
  fs.appendFileSync(w.a('data/enrichments/0001/87/8787802c5abd114b.sgf'), 'tampered');
  const bad = await w.build();
  assert.equal(bad.code, 1);
  assert.match(bad.text, /the SGF file does not match its recorded hash/);
});

test('an enrichment of a match in a sealed shard changes neither the shard nor what is published for it: only the overlay is new', async () => {
  const w = ws();
  w.put('chText', 'c.txt'); w.put('linnet');
  await w.ingest('--max-matches', '1');                       // shard 0001 sealed with one match, 0002 open
  const sealed = JSON.parse(fs.readFileSync(w.a('data/0001/shard.json'), 'utf8'));
  assert.equal(sealed.status, 'sealed');
  const sealedBefore = tree(w.a('data/0001'));
  await w.build('dist0');
  assert.equal(JSON.parse(fs.readFileSync(w.a('dist0/registry.json'), 'utf8')).overlays.enrichments, undefined, 'no enrichment, no overlay');
  const id = ID_CH;                                           // the first match ingested is the one in the sealed shard
  assert.ok(fs.existsSync(w.a('data/0001/matches/87/8787802c5abd114b.mat')));
  assert.equal((await w.enrich(id, '--link', 'https://youtu.be/dQw4w9WgXcQ', '--sgf', path.join(FIXTURES, FIX.chSgf))).code, 0);
  assert.deepEqual(tree(w.a('data/0001')), sealedBefore, 'a sealed shard is never edited by an enrichment');
  await w.build('dist1');
  assert.deepEqual(tree(w.a('dist1/data/0001')), tree(w.a('dist0/data/0001')), 'what is published for the sealed shard is byte for byte the same');
  assert.match(JSON.parse(fs.readFileSync(w.a('dist1/registry.json'), 'utf8')).overlays.enrichments, /^overlays\/enrichments\./);
});

test('loadAll over HTTP: the overlay is fetched and applied to the rows, the match page data is merged', async () => {
  const w = ws();
  w.put('chText', 'c.txt'); w.put('linnet');
  await w.ingest();
  await w.enrich(ID_LINNET, '--link', 'https://youtu.be/dQw4w9WgXcQ', '--tags', 'final');
  await w.enrich(ID_CH, '--sgf', path.join(FIXTURES, FIX.chSgf));
  await w.build();
  const dist = w.a('dist');
  const server = createStaticServer(dist);
  await new Promise((r) => server.listen(0, r));
  try {
    const base = `http://localhost:${server.address().port}/`;
    const [cat, query] = [await loadSite(dist, 'js/catalog.js'), await loadSite(dist, 'js/query.js')];
    const M = await cat.loadAll({ base });
    assert.deepEqual(M.errors, []);
    const find = (s) => M.rows.filter(query.makePredicate(query.parseQuery(s))).map((r) => r.id);
    assert.deepEqual(find('has:video'), [ID_LINNET], 'the video was added after the match: the list knows');
    assert.deepEqual(find('has:analysis'), [ID_CH]);
    assert.equal(find('has:attachment').includes(ID_CH), true);
    assert.equal(M.rows.find((r) => r.id === ID_LINNET).enriched, true);
    assert.equal(M.enrichments[ID_CH].attachments[0].url, 'overlays/files/0001/87/8787802c5abd114b.sgf');
    assert.equal((await fetch(new URL(M.enrichments[ID_CH].attachments[0].url, M.registryUrl))).status, 200);
    assert.equal(M.enrichments[ID_CH].attachments[0].href, new URL(M.enrichments[ID_CH].attachments[0].url, M.registryUrl).href, 'its absolute address, next to the registry that lists it');
    // a failing overlay is a notice, not a failure of the whole site
    const broken = await cat.loadAll({ base, fetchImpl: async (u, i) => (String(u).includes('overlays/enrichments') ? new Response('', { status: 500 }) : fetch(u, i)) });
    assert.match(broken.errors[0], /video links and files added to existing matches could not be loaded/);
    assert.equal(broken.rows.length, 2);
    // rows alone: the pure function
    const rows = [{ id: 'x', flags: 0 }, { id: 'y', flags: 1 }];
    cat.applyEnrichments(rows, { x: { links: [{}], attachments: [{ analysis: true }] } });
    assert.deepEqual(rows.map((r) => r.flags), [32 | 16 | 4, 1]);
  } finally { server.close(); }
});

// ------------------------------------------------------------------------------------------------ sealing, integrity, faster build

test('a sealed shard records the digest of its files; the build then trusts it and reads only the open shard', async () => {
  const w = ws();
  w.put('linnet'); w.put('vireo'); w.put('cardinal');
  await w.ingest('--max-matches', '2');
  const s1 = JSON.parse(fs.readFileSync(w.a('data/0001/shard.json'), 'utf8'));
  assert.equal(s1.status, 'sealed');
  assert.deepEqual([s1.integrity.algorithm, s1.integrity.files, s1.integrity.digest.length], ['sha256-tree', 4, 64]);
  assert.deepEqual(treeDigest(w.a('data/0001')), s1.integrity);
  assert.equal(JSON.parse(fs.readFileSync(w.a('data/0002/shard.json'), 'utf8')).integrity, undefined, 'the open shard has none');
  const r = await w.build();
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /built 2 shard\(s\), 3 match\(es\) .*\(1 read in full, 0 checked by an earlier build, 2 trusted by their seal\)/);
});

test('shards are sealed at 5 000 matches by default; an open shard already above a lowered limit is sealed as it is at the next ingest', async () => {
  assert.equal(loadConfig(w0()).sealPolicy.maxMatches, 5000);
  assert.equal(JSON.parse(fs.readFileSync(path.join(REPO, 'bgdb.config.json'), 'utf8')).sealPolicy.maxMatches, 5000, 'the project config says the same');
  const w = ws();
  w.put('linnet'); w.put('vireo');
  await w.ingest();
  assert.equal(JSON.parse(fs.readFileSync(w.a('data/0001/shard.json'), 'utf8')).status, 'open');
  w.put('cardinal');
  const r = await w.ingest('--max-matches', '1');
  assert.equal(r.code, 0, r.text);
  const s1 = JSON.parse(fs.readFileSync(w.a('data/0001/shard.json'), 'utf8'));
  assert.deepEqual([s1.status, s1.counts.matches, !!s1.integrity], ['sealed', 2, true], 'sealed with the 2 matches it had');
  assert.equal(JSON.parse(fs.readFileSync(w.a('data/0002/shard.json'), 'utf8')).counts.matches, 1, 'the new match opens shard 0002');
});

test('a change inside a sealed shard is caught by the build, then every match is read to name the damage', async () => {
  const w = ws();
  w.put('linnet'); w.put('vireo');
  await w.ingest('--max-matches', '2');
  w.put('cardinal');
  await w.ingest('--max-matches', '2');
  const mat = path.join(w.a('data/0001/matches/23'), '2359e4c944b8d130.mat');
  fs.writeFileSync(mat, fs.readFileSync(mat, 'utf8').replace('24/23', '24/22'));
  const r = await w.build();
  assert.equal(r.code, 1);
  assert.match(r.text, /shard 0001: it is sealed but its files differ from the digest recorded when it was sealed/);
  assert.match(r.text, /error: 0001\/2359e4c944b8d130/);
  assert.match(r.text, /\(3 read in full, 0 checked by an earlier build, 0 trusted by their seal\)/);
});

test('a sealed shard without a digest is read in full once (with a note); verify --record stores the digest and the next build is fast', async () => {
  const w = ws();
  w.put('linnet'); w.put('vireo'); w.put('cardinal');
  await w.ingest('--max-matches', '2');
  const f = w.a('data/0001/shard.json');
  const info = JSON.parse(fs.readFileSync(f, 'utf8'));
  delete info.integrity;
  fs.writeFileSync(f, JSON.stringify(info));
  const slow = await w.build();
  assert.match(slow.text, /note: shard 0001 is sealed without an integrity record/);
  assert.match(slow.text, /\(3 read in full, 0 checked by an earlier build, 0 trusted by their seal\)/);
  const v = await w.run('verify', '--data', w.a('data'), '--record');
  assert.equal(v.code, 0, v.text);
  assert.match(v.text, /shard 0001 \(sealed\): 2 match\(es\), 0 error\(s\), digest recorded/);
  assert.match(v.text, /shard 0002 \(open\): 1 match\(es\), 0 error\(s\)\n?$/m);
  assert.match((await w.build()).text, /\(0 read in full, 1 checked by an earlier build, 2 trusted by their seal\)/);
});

test('build cache: a second build reads only what changed; the output is the same with or without the cache', async () => {
  const w = ws();
  w.put('linnet'); w.put('vireo');
  await w.ingest();
  const first = await w.build();
  assert.match(first.text, /\(2 read in full, 0 checked by an earlier build, 0 trusted by their seal\)/);
  const cacheFile = w.a('.bgdb-cache/build.json');
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(cacheFile, 'utf8')).entries).length, 2, 'the cache lives next to the data folder');
  const again = await w.build();
  assert.match(again.text, /\(0 read in full, 2 checked by an earlier build, 0 trusted by their seal\)/);
  w.put('cardinal');
  await w.ingest();
  const added = await w.build();
  assert.match(added.text, /\(1 read in full, 2 checked by an earlier build, 0 trusted by their seal\)/, 'only the new match is read');
  const cold = await w.build('dist-cold', '--no-cache');
  assert.match(cold.text, /\(3 read in full, 0 checked by an earlier build, 0 trusted by their seal\)/);
  assert.deepEqual(tree(w.a('dist')), tree(w.a('dist-cold')), 'byte-identical output');
});

test('an excerpt whose games are numbered with holes (1, 2, 6, 10) is ingested, then built without error', async () => {
  const w = ws();
  const text = fs.readFileSync(path.join(FIXTURES, 'extmatchdb/excerpt-games-missing_19pt.mat'), 'utf8').replace(/^ Game 3(\r?)$/m, ' Game 6$1').replace(/^ Game 4(\r?)$/m, ' Game 10$1');
  fs.writeFileSync(w.a('inbox/excerpt.mat'), text);
  const i = await w.ingest();
  assert.match(i.text, /1 added/, i.text);
  const r = await w.build();
  assert.equal(r.code, 0, r.text);
  const metaFile = fs.readdirSync(w.a('data/0001/matches'), { recursive: true }).find((f) => f.endsWith('.meta.json'));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w.a('data/0001/matches'), metaFile), 'utf8')).result.partial.gaps.map((g) => g.before), [6, 10]);
});

test('build cache: a match file changed since it was cached is read again and the damage is caught', async () => {
  const w = ws();
  w.put('linnet'); w.put('vireo');
  await w.ingest();
  assert.equal((await w.build()).code, 0);
  const mat = path.join(w.a('data/0001/matches/23'), '2359e4c944b8d130.mat');
  const original = fs.readFileSync(mat);
  fs.writeFileSync(mat, original.toString('utf8').replace('24/23', '24/22'));
  const r = await w.build();
  assert.equal(r.code, 1);
  assert.match(r.text, /error: 0001\/2359e4c944b8d130/);
  assert.match(r.text, /\(1 read in full, 1 checked by an earlier build, 0 trusted by their seal\)/);
  const meta = path.join(w.a('data/0001/matches/23'), '2359e4c944b8d130.meta.json');
  fs.writeFileSync(mat, original);
  assert.equal((await w.build()).code, 0, 'repaired: valid again');
  const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
  m.result.winner = 1 - m.result.winner;
  fs.writeFileSync(meta, JSON.stringify(m));
  const r2 = await w.build();
  assert.equal(r2.code, 1, 'a change of the recorded result is not hidden by the cache');
  assert.match(r2.text, /the result in the file differs from the metadata/);
});

test('build cache: dropped when the code of packages/core changes; kept out of the output folder; --cache chooses the file', async () => {
  const w = ws();
  w.put('linnet');
  await w.ingest();
  await w.build();
  const cacheFile = w.a('.bgdb-cache/build.json');
  const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  fs.writeFileSync(cacheFile, JSON.stringify({ ...c, version: 'an older core' }));
  assert.match((await w.build()).text, /\(1 read in full, 0 checked by an earlier build/);
  fs.writeFileSync(cacheFile, '{ not json');
  assert.match((await w.build()).text, /\(1 read in full, 0 checked by an earlier build/, 'an unreadable cache is ignored');
  const inside = await w.build('dist', '--cache', w.a('dist/cache.json'));
  assert.equal(inside.code, 2);
  assert.match(inside.text, /Refusing to keep the build cache .* inside the output folder/);
  const own = w.a('elsewhere/c.json');
  await w.build('dist', '--cache', own);
  assert.match((await w.build('dist', '--cache', own)).text, /\(0 read in full, 1 checked by an earlier build/);
});

test('verify: reads every match in full, names the damaged ones, exits 1; --shard limits it; a damaged shard is not given a digest', async () => {
  const w = ws();
  w.put('linnet'); w.put('vireo');
  await w.ingest('--max-matches', '2');
  assert.equal((await w.run('verify', '--data', w.a('data'))).code, 0);
  const meta = path.join(w.a('data/0001/matches/23'), '2359e4c944b8d130.meta.json');
  const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
  m.result.winner = 1 - m.result.winner;
  fs.writeFileSync(meta, JSON.stringify(m));
  const r = await w.run('verify', '--data', w.a('data'), '--record');
  assert.equal(r.code, 1);
  assert.match(r.text, /error: 0001\/2359e4c944b8d130: the result in the file differs from the metadata/);
  assert.ok(!/digest recorded/.test(r.text));
  assert.equal((await w.run('verify', '--data', w.a('data'), '--shard', '0009')).text, 'no shard found');
});

test('the sealing digest does not change when an enrichment is added to a match of the sealed shard', async () => {
  const w = ws();
  w.put('linnet'); w.put('vireo');
  await w.ingest('--max-matches', '1');
  const before = JSON.parse(fs.readFileSync(w.a('data/0001/shard.json'), 'utf8')).integrity.digest;
  const id = JSON.parse(fs.readFileSync(path.join(w.a('data/0001/matches'), fs.readdirSync(w.a('data/0001/matches'))[0], fs.readdirSync(path.join(w.a('data/0001/matches'), fs.readdirSync(w.a('data/0001/matches'))[0])).find((x) => x.endsWith('meta.json'))), 'utf8')).id;
  assert.equal((await w.enrich(id, '--tags', 'x')).code, 0);
  assert.equal(treeDigest(w.a('data/0001')).digest, before);
  const r = await w.build();
  assert.match(r.text, /\(1 read in full, 0 checked by an earlier build, 1 trusted by their seal\)/);
});

// ------------------------------------------------------------------------------------------------ external shards and split

test('externalShards: checked when the configuration is read, listed in the registry, never copied; a local clash is refused', async () => {
  assert.throws(() => checkExternalShards([{ id: 'x', base: 'https://a/b/' }]), /not a shard id/);
  assert.throws(() => checkExternalShards([{ id: '0001', base: 'data/0001/' }]), /absolute address ending with "\/"/);
  assert.throws(() => checkExternalShards([{ id: '0001', base: 'https://a.example/data/0001' }]), /ending with "\/"/);
  assert.throws(() => checkExternalShards([{ id: '0001', base: 'https://a/b/' }, { id: '0001', base: 'https://c/d/' }]), /listed twice/);
  assert.throws(() => checkExternalShards([{ id: '0001', base: 'https://a/b/', status: 'open' }]), /must be sealed/);
  assert.equal(checkExternalShards([{ id: '0001', base: 'https://a.example/b/data/0001/' }]).length, 1);
  const w = ws();
  w.put('linnet');
  await w.ingest();
  fs.writeFileSync(w.cfg, JSON.stringify({ name: 'T', externalShards: [{ id: '0001', base: 'https://a.example/data/0001/' }] }));
  const clash = await w.build();
  assert.equal(clash.code, 2);
  assert.match(clash.text, /Shard 0001 is both a folder of .* and listed in externalShards/);
  fs.writeFileSync(w.cfg, JSON.stringify({ name: 'T', externalShards: [{ id: '0007', base: 'https://a.example/data/0007/', matches: 12, manifestHash: 'abcd' }] }));
  const ok = await w.build();
  assert.equal(ok.code, 0, ok.text);
  const reg = JSON.parse(fs.readFileSync(w.a('dist/registry.json'), 'utf8'));
  assert.deepEqual(reg.shards.map((s) => [s.id, s.external ?? false, s.base]), [['0001', false, 'data/0001/'], ['0007', true, 'https://a.example/data/0007/']]);
  assert.equal(fs.existsSync(w.a('dist/data/0007')), false, 'an external shard is not copied');
  fs.writeFileSync(w.cfg, '{ "externalShards": [{"id": "1", "base": "x"}] }');
  assert.throws(() => loadConfig(w.cfg), /not a shard id/);
});

test('split: a sealed shard moves to another repository; its hashes stay (duplicates are still recognised, enrichment still works); the hub lists it as external', async () => {
  const hub = ws('hub');
  hub.put('linnet'); hub.put('vireo'); hub.put('cardinal');
  await hub.ingest('--max-matches', '2');
  const dataRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-datarepo-'));
  // refused cases
  assert.match((await hub.run('split', '0002', '--to', path.join(dataRepo, 'data'), '--base', 'https://a.example/data/0002/', '--data', hub.a('data'), '--config', hub.cfg)).text, /Shard 0002 is open: only a sealed shard can be moved/);
  assert.match((await hub.run('split', '0009', '--to', dataRepo, '--base', 'https://a.example/x/', '--data', hub.a('data'), '--config', hub.cfg)).text, /No shard 0009/);
  assert.match((await hub.run('split', '0001', '--to', dataRepo, '--base', 'relative/', '--data', hub.a('data'), '--config', hub.cfg)).text, /absolute address/);
  assert.equal((await hub.run('split', '0001')).code, 2, 'usage');
  assert.ok(!fs.existsSync(path.join(dataRepo, '0001')), 'nothing was copied by a refused split');

  // 1. the data repository publishes its own files
  const dataFolder = path.join(dataRepo, 'data');
  const keep = await hub.run('split', '0001', '--to', dataFolder, '--base', 'http://placeholder.example/data/0001/', '--data', hub.a('data'), '--config', hub.cfg);
  assert.equal(keep.code, 0, keep.text);
  assert.match(keep.text, /still here\. To finish: add this to "externalShards"/);
  assert.ok(fs.existsSync(hub.a('data/0001')), 'without --remove the shard stays');
  assert.match((await hub.run('split', '0001', '--to', dataFolder, '--base', 'http://placeholder.example/data/0001/', '--data', hub.a('data'), '--config', hub.cfg)).text, /already exists and is not empty/);
  fs.rmSync(path.join(dataFolder, '0001'), { recursive: true });
  fs.rmSync(hub.a('data/hashes'), { recursive: true });

  const dataServerPort = await new Promise((resolve) => { const s = createStaticServer(path.join(dataRepo, 'dist')); s.listen(0, () => resolve([s, s.address().port])); }).then(([s, p]) => { s.close(); return p; });
  const base = `http://localhost:${dataServerPort}/data/0001/`;
  const moved = await hub.run('split', '0001', '--to', dataFolder, '--base', base, '--remove', '--data', hub.a('data'), '--config', hub.cfg);
  assert.equal(moved.code, 0, moved.text);
  assert.match(moved.text, /removed here and listed in .* as external/);
  assert.equal(fs.existsSync(hub.a('data/0001')), false);
  assert.equal(fs.readFileSync(hub.a('data/hashes/0001.tsv'), 'utf8').trim().split('\n').length, 2, 'one line per match');
  assert.match(fs.readFileSync(hub.a('data/hashes/0001.tsv'), 'utf8'), /^[0-9a-f]{64}\t0001\/[0-9a-f]{16}$/m);
  assert.deepEqual(JSON.parse(fs.readFileSync(hub.cfg, 'utf8')).externalShards, [{ id: '0001', base, status: 'sealed', matches: 2 }]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataFolder, '0001/shard.json'), 'utf8')).integrity.files, 4);

  // 2. duplicates of moved matches are still recognised, and a moved match can be enriched
  hub.put('linnet', 'again.txt');
  const dup = await hub.ingest();
  assert.match(dup.text, /duplicate\s+already in the database as 0001\/2359e4c944b8d130/);
  const en = await hub.enrich(ID_LINNET, '--tags', 'moved');
  assert.equal(en.code, 0, en.text);
  assert.ok(fs.existsSync(hub.a('data/enrichments/0001/23/2359e4c944b8d130.json')));
  hub.put('linnet', 'with-link.txt');
  fs.writeFileSync(hub.a('inbox/with-link.bgdb.json'), JSON.stringify({ links: [{ url: 'https://youtu.be/dQw4w9WgXcQ' }] }));
  assert.match((await hub.ingest()).text, /enriched\s+0001\/2359e4c944b8d130/);

  // 3. the data repository builds its own site files; the hub lists them; the browser code loads both
  const dataRepoBuild = await main(['build', '--data', dataFolder, '--out', path.join(dataRepo, 'dist'), '--config', path.join(dataRepo, 'none.json')], capture().io);
  assert.equal(dataRepoBuild, 0);
  assert.match(fs.readFileSync(path.join(dataRepo, 'dist/data/0001/shard.json'), 'utf8'), /"matches": 2/);
  const hubBuild = await hub.build();
  assert.equal(hubBuild.code, 0, hubBuild.text);
  assert.equal(fs.existsSync(hub.a('dist/data/0001')), false, 'the hub does not copy the moved shard');
  const reg = JSON.parse(fs.readFileSync(hub.a('dist/registry.json'), 'utf8'));
  assert.deepEqual(reg.shards.map((s) => [s.id, s.external ?? false]), [['0001', true], ['0002', false]]);

  const dataServer = createStaticServer(path.join(dataRepo, 'dist'));
  await new Promise((r) => dataServer.listen(dataServerPort, r));
  const hubServer = createStaticServer(hub.a('dist'));
  await new Promise((r) => hubServer.listen(0, r));
  try {
    const cat = await loadSite(hub.a('dist'), 'js/catalog.js');
    const M = await cat.loadAll({ base: `http://localhost:${hubServer.address().port}/` });
    assert.deepEqual(M.errors, []);
    assert.equal(M.rows.length, 3, 'two matches from the other repository and one from the hub');
    assert.deepEqual(M.shards.map((s) => s.id), ['0001', '0002']);
    assert.ok(M.shards[0].base.startsWith(`http://localhost:${dataServerPort}/`), 'the moved shard is loaded from its own address');
    assert.equal(M.rows.find((r) => r.id === ID_LINNET).enriched, true, 'an enrichment applies to a match of the other repository');
    const files = (await import(pathToFileURL(path.join(hub.a('dist'), 'js/format.js')).href)).matchFiles(M.shards[0].base, '2359e4c944b8d130');
    assert.equal((await fetch(files.mat)).status, 200);
    assert.equal((await fetch(files.meta)).headers.get('access-control-allow-origin'), '*');
  } finally { dataServer.close(); hubServer.close(); }
});

// ------------------------------------------------------------------------------------------------ sources.json (decision 0024)

test('sources.json: the site reads several data repositories, sends contributions to the current one, merges their enrichments', async () => {
  // bg-db-data-1 (archived): shard 0001
  const d1 = ws('data1');
  d1.put('linnet'); d1.put('vireo');
  assert.equal((await d1.ingest()).code, 0);
  assert.equal((await d1.build('dist', '--site', d1.a('no-site'))).code, 0);
  // bg-db-data-2 (current): its first shard is 0002; it knows the matches of data-1 by their hash file, and corrects one of them
  const d2 = ws('data2');
  fs.mkdirSync(d2.a('data/0002'), { recursive: true });
  fs.writeFileSync(d2.a('data/0002/shard.json'), JSON.stringify({ schema: '1.0', id: '0002', status: 'open', counts: { matches: 0, games: 0 } }));
  fs.mkdirSync(d2.a('data/hashes'));
  const metas = fs.readdirSync(d1.a('data/0001/matches'), { recursive: true }).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(d1.a('data/0001/matches'), f), 'utf8')));
  fs.writeFileSync(d2.a('data/hashes/0001.tsv'), metas.map((m) => `${m.contentHash}\t${m.id}\n`).sort().join(''));
  d2.put('cardinal');
  assert.match((await d2.ingest()).text, /added\s+0002\//);
  assert.equal((await d2.enrich(ID_LINNET, '--event', 'Corrected Open', '--tags', 'final')).code, 0);
  assert.equal((await d2.build('dist', '--site', d2.a('no-site'))).code, 0);

  const servers = [];
  const serve = async (dir) => { const s = createStaticServer(dir); await new Promise((r) => s.listen(0, r)); servers.push(s); return `http://localhost:${s.address().port}/`; };
  try {
    const [u1, u2] = [await serve(d1.a('dist')), await serve(d2.a('dist'))];
    // the tools repository: the site and sources.json, no data
    const tools = ws('tools');
    const sources = {
      schema: '1.0', name: 'BGDB', license: 'CC0-1.0', sources: [
        { name: 'bg-db-data-1', url: u1, repository: 'owner/bg-db-data-1', state: 'archived' },
        { name: 'bg-db-data-2', url: u2, repository: 'owner/bg-db-data-2', defaultBranch: 'main', state: 'current' },
        { name: 'bg-db-data-3', url: 'https://owner.github.io/bg-db-data-3/', repository: 'owner/bg-db-data-3', state: 'next' },
      ],
    };
    fs.writeFileSync(tools.a('sources.json'), JSON.stringify(sources));
    const tb = await tools.build('dist', '--sources', tools.a('sources.json'));
    assert.equal(tb.code, 0, tb.text);
    assert.deepEqual(JSON.parse(fs.readFileSync(tools.a('dist/sources.json'), 'utf8')), sources, 'published as it is');
    const ut = await serve(tools.a('dist'));

    const cat = await loadSite(tools.a('dist'), 'js/catalog.js');
    const requested = [];
    const M = await cat.loadAll({ base: ut, fetchImpl: (u, i) => { requested.push(String(u)); return fetch(u, i); } });
    assert.deepEqual(M.errors, []);
    assert.deepEqual(M.sources.map((s) => s.name), ['bg-db-data-1', 'bg-db-data-2'], 'the "next" repository is not read');
    assert.ok(!requested.some((u) => u.includes('bg-db-data-3')));
    assert.deepEqual(M.shards.map((s) => [s.id, s.source]), [['0001', 'bg-db-data-1'], ['0002', 'bg-db-data-2']]);
    assert.equal(M.rows.length, 3);
    assert.ok(M.shards[0].base.startsWith(u1) && M.shards[1].base.startsWith(u2), 'each shard is loaded from its own repository');
    assert.deepEqual([M.registry.name, M.registry.repository, M.registry.defaultBranch], ['BGDB', 'owner/bg-db-data-2', 'main'], 'contributions go to the current repository');
    const linnet = M.rows.find((r) => r.id === ID_LINNET);
    assert.deepEqual([linnet.event, linnet.enriched], ['Corrected Open', true], 'a correction made in the current repository applies to a match of the archived one');
    const contrib = await loadSite(tools.a('dist'), 'js/contribute-model.js');
    assert.equal(contrib.issueFormLink(M.registry, []), 'https://github.com/owner/bg-db-data-2/issues/new?template=submit-match.yml&title=Matches', 'the submission form of the current repository');

    // one repository down: a notice, the others are still read
    const down = await cat.loadAll({ base: ut, fetchImpl: (u, i) => (String(u).startsWith(u1) ? Promise.resolve(new Response('', { status: 503 })) : fetch(u, i)) });
    assert.match(down.errors.join(), /The data of bg-db-data-1 could not be loaded/);
    assert.deepEqual(down.shards.map((s) => s.id), ['0002']);
    // a shard number listed by two repositories: the first listing is kept, the mistake is named
    const twice = await cat.loadAll({ base: ut, fetchImpl: async (u, i) => {
      const r = await fetch(u, i);
      if (!String(u).startsWith(u2) || !String(u).endsWith('registry.json')) return r;
      const reg = await r.json();
      reg.shards.push({ ...reg.shards[0], id: '0001' });
      return new Response(JSON.stringify(reg));
    } });
    assert.match(twice.errors.join(), /Shard 0001 is listed by bg-db-data-1 and by bg-db-data-2; the second listing is ignored/);
    // a broken sources.json stops the site with the reason, rather than showing part of the database
    await assert.rejects(cat.loadAll({ base: ut, fetchImpl: (u, i) => (String(u).endsWith('sources.json') ? Promise.resolve(new Response(JSON.stringify({ ...sources, sources: [] }))) : fetch(u, i)) }), /at least one data repository/);
  } finally { for (const s of servers) s.close(); }
});

test('build --sources: the list is checked before anything is published', async () => {
  const w = ws();
  fs.writeFileSync(w.a('s.json'), JSON.stringify({ schema: '1.0', sources: [{ name: 'a', url: 'https://x.example/a/', state: 'archived' }] }));
  const r = await w.build('dist', '--sources', w.a('s.json'));
  assert.equal(r.code, 2);
  assert.match(r.text, /s\.json: exactly one source must be "current"/);
  assert.match((await w.build('dist', '--sources', w.a('missing.json'))).text, /missing\.json: no such file/);
  fs.writeFileSync(w.a('bad.json'), '{');
  assert.match((await w.build('dist', '--sources', w.a('bad.json'))).text, /bad\.json: not valid JSON/);
  assert.equal(fs.existsSync(w.a('dist/sources.json')), false);
});
