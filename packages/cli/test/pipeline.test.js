import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { main } from '../src/cli.js';
import { FIXTURES } from '../../core/test/helpers.js';
import { sha256Hex, bloomHas, normalizeName, readMatch, toBgdbJson } from '@bgdb/core';

const capture = () => { const lines = []; return { lines, io: { out: (s) => lines.push(s), err: (s) => lines.push(s) } }; };
const FILES = {
  a: 'opengammon/vireo_vs_tester_2026-09-30.mat',
  b: 'backgammon-studio/tester_-_Linnet14_7pt_Backgammon_Studio_2026_10_01_09_38_41.txt',
  c: 'gnubg-sgf/2026-01-20T15-36-47-bluetailedgrebe1-tester.sgf',
  d: 'xg-text/me-XG_Roller__03-10-2026__3.txt',
};

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-pipe-'));
  fs.mkdirSync(path.join(root, 'inbox'));
  fs.mkdirSync(path.join(root, 'site'));
  fs.writeFileSync(path.join(root, 'site/index.html'), '<h1>x</h1>');
  const a = (rel) => path.join(root, rel);
  const drop = (key, name = path.basename(FILES[key])) => fs.copyFileSync(path.join(FIXTURES, FILES[key]), a(`inbox/${name}`));
  const run = (cmd, ...args) => { const c = capture(); return main([cmd, ...args], c.io).then((code) => ({ code, text: c.lines.join('\n') })); };
  const ingest = (...extra) => run('ingest', '--inbox', a('inbox'), '--data', a('data'), '--date', '2026-10-04', '--contributor', 'tester', '--config', a('none.json'), ...extra);
  const build = (out) => run('build', '--data', a('data'), '--out', a(out), '--site', a('site'), '--config', a('none.json'));
  return { root, a, drop, ingest, build };
}

/** what the browser does with a published match: read the .mat, add the sidecar, derive the replay data */
const replayOf = (base, hash) => {
  const dir = path.join(base, 'matches', hash.slice(0, 2), hash);
  const meta = JSON.parse(fs.readFileSync(`${dir}.meta.json`, 'utf8'));
  const r = readMatch(fs.readFileSync(`${dir}.mat`, 'utf8'));
  assert.equal(r.ok, true);
  return toBgdbJson(r.match, meta);
};

const tree = (dir) => {
  const out = {};
  const rec = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) rec(p); else out[path.relative(dir, p)] = sha256Hex(new Uint8Array(fs.readFileSync(p))); } };
  rec(dir);
  return out;
};

test('ingest: valid files are filed in the open shard, the inbox is emptied, metadata is complete', async () => {
  const w = workspace();
  w.drop('a'); w.drop('b'); w.drop('c');
  const r = await w.ingest();
  assert.equal(r.code, 0);
  assert.match(r.text, /3 added, 0 enriched, 0 duplicate\(s\), 0 with errors/);
  assert.equal(fs.readdirSync(w.a('inbox')).length, 0);
  const shard = JSON.parse(fs.readFileSync(w.a('data/0001/shard.json'), 'utf8'));
  assert.deepEqual([shard.status, shard.counts.matches, shard.counts.games], ['open', 3, 4 + 3 + 2]);
  const meta = JSON.parse(fs.readFileSync(w.a('data/0001/matches/23/2359e4c944b8d130.meta.json'), 'utf8'));
  assert.equal(meta.id, '0001/2359e4c944b8d130');
  assert.equal(meta.contentHash.length, 64);
  assert.deepEqual(meta.sides.map((s) => s.name), ['tester', 'Linnet14']);
  assert.deepEqual(meta.result, { winner: 0, score: [10, 4], finished: true });
  assert.equal(meta.provenance.contributor, 'tester');
  assert.equal(meta.provenance.submittedAt, '2026-10-04');
  assert.equal(meta.provenance.originalFormat, 'mat');
  assert.equal(meta.provenance.originalHash.length, 64);
  assert.ok(!('siteMatchId' in meta.provenance), 'site match ids are never stored');
  assert.equal(meta.provenance.license, 'CC0-1.0');
  assert.equal(meta.games.length, 3);
  assert.ok(fs.existsSync(w.a('data/0001/matches/23/2359e4c944b8d130.mat')));
});

test('ingest: a duplicate (even under another file name) is skipped and removed; a file that could only be added partially stays', async () => {
  const w = workspace();
  w.drop('b');
  await w.ingest();
  w.drop('b', 'same-match-other-name.txt');
  fs.writeFileSync(w.a('inbox/broken.mat'), fs.readFileSync(path.join(FIXTURES, FILES.a), 'utf8').replace('52: 24/22 13/8', '52: 24/22 13/7'));
  const r = await w.ingest();
  assert.equal(r.code, 1);
  assert.match(r.text, /duplicate\s+already in the database as 0001\/2359e4c944b8d130/);
  assert.match(r.text, /PARTIAL\s+broken\.mat stays in the inbox/, 'one game cannot be read: it could only be added partially, and nobody accepted that');
  assert.match(r.text, /how to fix/);
  assert.deepEqual(fs.readdirSync(w.a('inbox')), ['broken.mat']);
  assert.equal(JSON.parse(fs.readFileSync(w.a('data/0001/shard.json'), 'utf8')).counts.matches, 1);
});

test('ingest: a copy with a typo of a stored match is superseded by it (decision 0023), not left waiting in the inbox', async () => {
  const w = workspace();
  w.drop('a');
  await w.ingest();
  fs.writeFileSync(w.a('inbox/broken.mat'), fs.readFileSync(path.join(FIXTURES, FILES.a), 'utf8').replace('52: 24/22 13/8', '52: 24/22 13/7'));
  const r = await w.ingest();
  assert.equal(r.code, 0);
  assert.match(r.text, /superseded broken\.mat: another transcription of 0001\/2e0a5065ce94414f \(in the database\), 100\.0% of the rolls in common/);
  assert.match(r.text, /kept: valid; this one: valid only by salvage/);
  assert.match(r.text, /0 added, 0 enriched, 0 duplicate\(s\), 0 with errors, 1 superseded by a better transcription/);
  assert.deepEqual(fs.readdirSync(w.a('inbox')), []);
});

test('ingest --dry-run writes nothing', async () => {
  const w = workspace();
  w.drop('a');
  const r = await w.ingest('--dry-run');
  assert.equal(r.code, 0);
  assert.match(r.text, /dry run/);
  assert.equal(fs.readdirSync(w.a('inbox')).length, 1);
  assert.ok(!fs.existsSync(w.a('data/0001/matches')));
});

test('sealing: the open shard is sealed at the limit and a new one opens; sealed shards are never written again', async () => {
  const w = workspace();
  w.drop('a'); w.drop('b'); w.drop('c');
  const r = await w.ingest('--max-matches', '2');
  assert.match(r.text, /shard 0001 is full: sealed/);
  const s1 = JSON.parse(fs.readFileSync(w.a('data/0001/shard.json'), 'utf8'));
  const s2 = JSON.parse(fs.readFileSync(w.a('data/0002/shard.json'), 'utf8'));
  assert.deepEqual([s1.status, s1.counts.matches, s2.status, s2.counts.matches], ['sealed', 2, 'open', 1]);
  const before = tree(w.a('data/0001'));
  w.drop('d');
  await w.ingest('--max-matches', '2');
  assert.deepEqual(tree(w.a('data/0001')), before, 'sealed shard untouched');
  assert.equal(JSON.parse(fs.readFileSync(w.a('data/0002/shard.json'), 'utf8')).counts.matches, 2);
});

test('build: registry, shard summary, manifest and catalog are consistent', async () => {
  const w = workspace();
  w.drop('a'); w.drop('b'); w.drop('c'); w.drop('d');
  await w.ingest();
  const r = await w.build('dist');
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /built 1 shard\(s\), 4 match\(es\)/);
  assert.ok(fs.existsSync(w.a('dist/index.html')), 'site copied');

  const reg = JSON.parse(fs.readFileSync(w.a('dist/registry.json'), 'utf8'));
  assert.equal(reg.shards[0].base, 'data/0001/');
  const base = w.a('dist/data/0001');
  const shard = JSON.parse(fs.readFileSync(path.join(base, 'shard.json'), 'utf8'));
  const manifestText = fs.readFileSync(path.join(base, 'manifest.json'), 'utf8');
  assert.equal(reg.shards[0].manifestHash, sha256Hex(manifestText).slice(0, 16));
  assert.equal(shard.counts.matches, 4);
  assert.deepEqual(shard.summary.matchLengths, { 0: 1, 3: 1, 5: 1, 7: 1 });
  assert.deepEqual(shard.summary.dateRange, ['2026-01-20', '2026-10-03']);
  assert.equal(bloomHas(shard.summary.playerFilter, normalizeName('Linnet14')), true);
  assert.equal(bloomHas(shard.summary.playerFilter, normalizeName('nobody-here')), false);

  const manifest = JSON.parse(manifestText);
  const f = manifest.files[0];
  const bytes = fs.readFileSync(path.join(base, f.path));
  assert.equal(sha256Hex(new Uint8Array(bytes)), f.hash);
  assert.equal(bytes.length, f.size);
  assert.ok(f.path.includes(f.hash.slice(0, 8)), 'named by its hash');
  assert.equal(bytes[9], 3, 'gzip OS byte normalised');

  const cat = JSON.parse(zlib.gunzipSync(bytes).toString('utf8'));
  assert.equal(cat.count, 4);
  assert.equal(cat.cols.date[0], '2026-10-03', 'newest first');
  const i = cat.cols.id.indexOf('2359e4c944b8d130');
  assert.equal(cat.dict.players[cat.cols.p0[i]], 'tester');
  assert.equal(cat.dict.players[cat.cols.p1[i]], 'Linnet14');
  assert.deepEqual([cat.cols.len[i], cat.cols.n[i], cat.cols.s0[i], cat.cols.s1[i], cat.cols.win[i]], [7, 3, 10, 4, 0]);
  assert.equal(cat.cols.fl[i] & 2, 2, 'cube was used');
  const j = cat.cols.id.indexOf('273ec87560b78b40');
  assert.equal(cat.cols.fl[j] & 8, 8, 'ended by resignation');
  assert.equal(cat.cols.len[j], 0, 'money game');

  assert.ok(!fs.existsSync(path.join(base, 'matches/23/2359e4c944b8d130.json')), 'no replay JSON is published: the browser derives it from the .mat');
  const replay = replayOf(base, '2359e4c944b8d130');
  assert.equal(replay.games.length, 3);
  assert.deepEqual(replay.games[0].actions[0], { s: 0, k: 'm', d: [6, 5], m: [[24, 13, 0]] });
});

test('build is deterministic and a sealed shard keeps the same bytes when a later shard changes', async () => {
  const w = workspace();
  w.drop('a'); w.drop('b'); w.drop('c');
  await w.ingest('--max-matches', '2');
  await w.build('dist1');
  await w.build('dist2');
  assert.deepEqual(tree(w.a('dist1')), tree(w.a('dist2')), 'two builds are byte-identical');
  w.drop('d');
  await w.ingest('--max-matches', '2');
  await w.build('dist3');
  const sub = (t, p) => Object.fromEntries(Object.entries(t).filter(([k]) => k.startsWith(p)));
  assert.deepEqual(sub(tree(w.a('dist3')), path.join('data', '0001')), sub(tree(w.a('dist1')), path.join('data', '0001')));
  assert.notDeepEqual(sub(tree(w.a('dist3')), path.join('data', '0002')), sub(tree(w.a('dist1')), path.join('data', '0002')));
});

test('build refuses a damaged match file and an unsafe output folder', async () => {
  const w = workspace();
  w.drop('a');
  await w.ingest();
  const f = w.a('data/0001/matches/2e/2e0a5065ce94414f.mat');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('24/22', '24/21'));
  const r = await w.build('dist');
  assert.equal(r.code, 1);
  assert.match(r.text, /error: 0001\/2e0a5065ce94414f/);
  const bad = await main(['build', '--data', w.a('data'), '--out', w.root, '--site', w.a('site'), '--config', w.a('none.json')], capture().io);
  assert.equal(bad, 2);
});

// ---- companion files, video links, attachments (spec section 10.3: groups of files with a shared base name)
const CH = 'choue-net/chouehandle-vs-Bot-all-games-s4020-2026-10-04';
const put = (w, rel, name) => fs.copyFileSync(path.join(FIXTURES, rel), w.a(`inbox/${name ?? path.basename(rel)}`));
const metaOf = (w, hash, shard = '0001') => JSON.parse(fs.readFileSync(w.a(`data/${shard}/matches/${hash.slice(0, 2)}/${hash}.meta.json`), 'utf8'));

test('a text file with its analysed SGF: both are one contribution, the SGF is kept as a verified attachment', async () => {
  const w = workspace();
  put(w, `${CH}.txt`); put(w, `${CH}.sgf`);
  const r = await w.ingest();
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /added\s+0001\/8787802c5abd114b .*\+ sgf/);
  assert.match(r.text, /V-SCORE: Game 2: the site records 4 points for a resignation, which is impossible with the cube at 1/);
  assert.ok(!/V-ATTACH/.test(r.text), 'the text and the SGF now agree on the points');
  assert.match(r.text, /1 added, 0 enriched, 0 duplicate\(s\), 0 with errors/);
  assert.equal(fs.readdirSync(w.a('inbox')).length, 0, 'every file of the group left the inbox');
  const m = metaOf(w, '8787802c5abd114b');
  assert.equal(m.attachments.length, 1);
  assert.deepEqual([m.attachments[0].kind, m.attachments[0].verified, m.attachments[0].analysis, m.attachments[0].engine], ['sgf', true, true, 'GNU Backgammon:1.08.003']);
  const kept = fs.readFileSync(w.a('data/0001/attachments/87/8787802c5abd114b.sgf'));
  assert.equal(sha256Hex(new Uint8Array(kept)), m.attachments[0].sha256);
  assert.equal(kept.length, m.attachments[0].bytes);
  assert.ok(JSON.parse(fs.readFileSync(w.a('data/0001/shard.json'), 'utf8')).counts.bytes > kept.length, 'shard size counts the attachment');
});

test('an SGF alone is the match and is kept as its own attachment (without analysis when it has none)', async () => {
  const w = workspace();
  put(w, 'gnubg-sgf/2026-01-22T18-31-58-avocet-tester.sgf');
  const r = await w.ingest();
  assert.equal(r.code, 0, r.text);
  const hash = r.text.match(/0001\/([0-9a-f]{16})/)[1];
  const a = metaOf(w, hash).attachments[0];
  assert.deepEqual([a.kind, a.verified, a.analysis], ['sgf', true, false]);
});

test('an SGF of another match is not attached; the match itself is still ingested, with a warning', async () => {
  const w = workspace();
  put(w, FILES.b, 'twin.txt');
  put(w, 'gnubg-sgf/2026-01-20T15-36-47-bluetailedgrebe1-tester.sgf', 'twin.sgf');
  const r = await w.ingest();
  assert.equal(r.code, 0);
  assert.match(r.text, /V-ATTACH: twin\.sgf does not describe the same match/);
  assert.deepEqual(metaOf(w, '2359e4c944b8d130').attachments, []);
  assert.ok(!fs.existsSync(w.a('data/0001/attachments')));
});

test('an XG file is read and verified against its text version; an XG file saved in the middle of a game is refused with a way out', async () => {
  const w = workspace();
  put(w, 'opengammon/Sir_Plover_vs_tester_2026-08-03.mat', 'sg.mat');
  put(w, 'xg-binary/Sir_Plover_vs_tester_2026-08-03.xg', 'sg.xg');
  put(w, 'invalid/xg-saved-in-the-middle-of-a-game.xg', 'lonely.xg');
  const r = await w.ingest();
  assert.equal(r.code, 1);
  assert.match(r.text, /ERROR\s+lonely\.xg stays in the inbox/);
  assert.match(r.text, /has no end: the file was saved in the middle of a game/);
  assert.match(r.text, /how to fix: Finish the game in eXtreme Gammon/);
  assert.deepEqual(fs.readdirSync(w.a('inbox')), ['lonely.xg']);
  const hash = r.text.match(/added\s+0001\/([0-9a-f]{16})/)[1];
  const a = metaOf(w, hash).attachments[0];
  assert.deepEqual([a.kind, a.verified, a.analysis, a.engine], ['xg', true, true, 'eXtreme Gammon']);
  assert.ok(fs.existsSync(w.a(`data/0001/attachments/${hash.slice(0, 2)}/${hash}.xg`)));
});

test('an XG file alone is the match: it is read, validated, and kept as its own verified attachment', async () => {
  const w = workspace();
  put(w, 'xg-binary/me-XG_Roller__03-10-2026.xg', 'roller.xg');
  const r = await w.ingest();
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /added\s+0001\/ef7b2bfb0cf20aa6/, 'the same identifier as its text export');
  const a = metaOf(w, 'ef7b2bfb0cf20aa6').attachments[0];
  assert.deepEqual([a.kind, a.verified, a.analysis], ['xg', true, true]);
  assert.equal(fs.readdirSync(w.a('inbox')).length, 0);
});

test('the same match as .xg and as text is one match, whichever arrives first', async () => {
  const w = workspace();
  put(w, 'xg-text/me-XG_Roller__03-10-2026.txt', 'a.txt');
  await w.ingest();
  put(w, 'xg-binary/me-XG_Roller__03-10-2026.xg', 'b.xg');
  const r = await w.ingest();
  assert.match(r.text, /enriched\s+0001\/ef7b2bfb0cf20aa6 .*\+ xg/);
  assert.equal(fs.existsSync(w.a('data/enrichments/0001/ef/ef7b2bfb0cf20aa6.xg')), true);
});

test('a file named .xg that is not an XG file, and an attachment above the size limit, are skipped with a warning', async () => {
  const w = workspace();
  put(w, FILES.b, 'm.txt');
  fs.writeFileSync(w.a('inbox/m.xg'), 'this is not an xg file');
  const r = await w.ingest();
  assert.equal(r.code, 0);
  assert.match(r.text, /V-ATTACH: m\.xg is not an eXtreme Gammon file/);
  const w2 = workspace();
  fs.writeFileSync(w2.a('big.json'), JSON.stringify({ name: 'x', license: 'CC0-1.0', sealPolicy: { maxMatches: 20000, maxMB: 300, maxAttachmentKB: 100 } }));
  put(w2, `${CH}.txt`, 'm.txt'); put(w2, `${CH}.sgf`, 'm.sgf');
  const c = capture();
  const code = await main(['ingest', '--inbox', w2.a('inbox'), '--data', w2.a('data'), '--config', w2.a('big.json'), '--date', '2026-10-04'], c.io);
  assert.equal(code, 0);
  assert.match(c.lines.join('\n'), /V-FILE: m\.sgf is 165 KB, above the limit of 100 KB/);
  assert.deepEqual(metaOf(w2, '8787802c5abd114b').attachments, []);
});

test('video links: from the match header and from the .bgdb.json sidecar, validated; tags checked', async () => {
  const w = workspace();
  const base = fs.readFileSync(path.join(FIXTURES, FILES.b), 'utf8');
  fs.writeFileSync(w.a('inbox/final.txt'), `; [Video "https://youtu.be/dQw4w9WgXcQ?t=95"]\n${base}`);
  fs.writeFileSync(w.a('inbox/final.bgdb.json'), JSON.stringify({
    links: [{ url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Game 2', game: 2 }, { url: 'http://youtu.be/dQw4w9WgXcQ' }, { url: 'https://example.com/v' }],
    tags: ['final', 'Not Valid'], unknown: true,
  }));
  const r = await w.ingest();
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /2 video link\(s\)/);
  assert.match(r.text, /V-LINK: A video link was ignored: only https links are accepted/);
  assert.match(r.text, /V-LINK: A video link was ignored: only YouTube links are accepted \(not example\.com\)/);
  assert.match(r.text, /V-META: The tag "Not Valid" was ignored/);
  assert.match(r.text, /V-META: final\.bgdb\.json: the key "unknown" is not used/);
  const m = metaOf(w, '2359e4c944b8d130');
  assert.deepEqual(m.links.map((l) => [l.id, l.time ?? null, l.game ?? null, l.title ?? null]), [['dQw4w9WgXcQ', 95, null, null], ['abcdefghijk', null, 2, 'Game 2']]);
  assert.deepEqual(m.tags, ['final']);
  assert.equal(fs.readdirSync(w.a('inbox')).length, 0);
});

test('a broken sidecar, two text versions, and a sidecar without a match are refused and stay in the inbox', async () => {
  const w = workspace();
  put(w, FILES.b, 'a.txt'); fs.writeFileSync(w.a('inbox/a.bgdb.json'), '{ nope');
  put(w, FILES.b, 'b.txt'); put(w, FILES.b, 'b.mat');
  fs.writeFileSync(w.a('inbox/c.bgdb.json'), '{}');
  const r = await w.ingest();
  assert.equal(r.code, 1);
  assert.match(r.text, /a\.bgdb\.json is not valid JSON/);
  assert.match(r.text, /Several text files share the name "b"/);
  assert.match(r.text, /"c\.bgdb\.json" has no match file next to it/);
  assert.equal(fs.readdirSync(w.a('inbox')).length, 5, 'nothing was removed');
});

const work2 = () => workspace();

test('a duplicate with extra files enriches the existing match instead of being skipped (the sealed or open shard is not touched)', async () => {
  const w = work2();
  put(w, FILES.b, 'one.txt');
  await w.ingest();
  const before = tree(w.a('data/0001'));
  put(w, FILES.b, 'two.txt'); fs.writeFileSync(w.a('inbox/two.bgdb.json'), JSON.stringify({ links: [{ url: 'https://youtu.be/dQw4w9WgXcQ' }], tags: ['final'] }));
  const r = await w.ingest();
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /enriched\s+0001\/2359e4c944b8d130\s+\(two\.txt\)\s+\+ 1 video link\(s\), 1 tag\(s\)/);
  assert.match(r.text, /0 added, 1 enriched, 0 duplicate\(s\)/);
  assert.deepEqual(tree(w.a('data/0001')), before, 'the shard itself is unchanged');
  assert.deepEqual(metaOf(w, '2359e4c944b8d130').links, [], 'the sidecar is unchanged too');
  const rec = JSON.parse(fs.readFileSync(w.a('data/enrichments/0001/23/2359e4c944b8d130.json'), 'utf8'));
  assert.deepEqual([rec.links.map((l) => l.id), rec.tags, rec.id], [['dQw4w9WgXcQ'], ['final'], '0001/2359e4c944b8d130']);
  assert.equal(fs.readdirSync(w.a('inbox')).length, 0);
  // the same extras again: nothing new, so a plain duplicate
  put(w, FILES.b, 'three.txt'); fs.writeFileSync(w.a('inbox/three.bgdb.json'), JSON.stringify({ links: [{ url: 'https://youtu.be/dQw4w9WgXcQ' }] }));
  const again = await w.ingest();
  assert.match(again.text, /duplicate\s+already in the database as 0001\/2359e4c944b8d130/);
  assert.match(again.text, /0 added, 0 enriched, 1 duplicate\(s\)/);
});

test('sealing by size: the open shard is sealed once it is over maxMB', async () => {
  const w = workspace();
  put(w, `${CH}.txt`, 'a.txt'); put(w, `${CH}.sgf`, 'a.sgf');
  put(w, FILES.b, 'b.txt'); put(w, FILES.a, 'c.mat');
  const r = await w.ingest('--max-mb', '0.1');
  assert.match(r.text, /shard 0001 is full: sealed/);
  const s1 = JSON.parse(fs.readFileSync(w.a('data/0001/shard.json'), 'utf8'));
  assert.equal(s1.status, 'sealed');
  assert.ok(s1.counts.bytes >= 0.1 * 1024 * 1024);
  assert.equal(s1.counts.matches, 1, 'the analysed match filled it');
  assert.equal(JSON.parse(fs.readFileSync(w.a('data/0002/shard.json'), 'utf8')).counts.matches, 2);
});

test('build: attachments and links are published, flagged in the catalog, listed in the replay data; .nojekyll and only relative paths', async () => {
  const w = workspace();
  put(w, `${CH}.txt`); put(w, `${CH}.sgf`);
  put(w, 'opengammon/Sir_Plover_vs_tester_2026-08-03.mat', 'sg.mat'); put(w, 'xg-binary/Sir_Plover_vs_tester_2026-08-03.xg', 'sg.xg');
  fs.writeFileSync(w.a('inbox/sg.bgdb.json'), JSON.stringify({ links: [{ url: 'https://youtu.be/dQw4w9WgXcQ' }] }));
  await w.ingest();
  const r = await w.build('dist');
  assert.equal(r.code, 0, r.text);
  assert.ok(fs.existsSync(w.a('dist/.nojekyll')));
  assert.ok(fs.existsSync(w.a('dist/data/0001/attachments/87/8787802c5abd114b.sgf')));
  const reg = JSON.parse(fs.readFileSync(w.a('dist/registry.json'), 'utf8'));
  assert.ok(reg.shards.every((s) => !/^([a-z]+:)?\/\//.test(s.base) && !s.base.startsWith('/')), 'bases are relative: the site works under any URL path');
  const base = w.a('dist/data/0001');
  const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'));
  const cat = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(base, manifest.files[0].path))).toString('utf8'));
  const fl = (h) => cat.cols.fl[cat.cols.id.indexOf(h)];
  assert.equal(fl('8787802c5abd114b') & (4 | 16), 4 | 16, 'analysed SGF: analysis + attachment');
  assert.equal(fl('8787802c5abd114b') & 32, 0);
  const sg = cat.cols.id.find((h) => h !== '8787802c5abd114b');
  assert.equal(fl(sg) & (4 | 16 | 32), 4 | 16 | 32, 'XG: analysis + attachment + video');
  const replay = replayOf(base, sg);
  assert.equal(replay.links[0].id, 'dQw4w9WgXcQ');
  assert.deepEqual(replay.attachments, [{ kind: 'xg', file: `${sg}.xg`, verified: true, analysis: true }]);
});

test('build refuses a damaged or missing attachment', async () => {
  const w = workspace();
  put(w, `${CH}.txt`); put(w, `${CH}.sgf`);
  await w.ingest();
  const f = w.a('data/0001/attachments/87/8787802c5abd114b.sgf');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('chouehandle', 'someone-else'));
  const r = await w.build('dist');
  assert.equal(r.code, 1);
  assert.match(r.text, /SGF attachment does not match its recorded hash/);
  fs.rmSync(f);
  assert.match((await w.build('dist')).text, /SGF attachment is missing/);
});

// ---- illegal plays made in real matches (decision 0013)
const REMARKS = 'extmatchdb/illegal-play-declared-in-remarks_7pt.txt';
const withoutRemarks = () => fs.readFileSync(path.join(FIXTURES, REMARKS), 'utf8').split('\n').filter((l) => !/^;\s*[|+]/.test(l)).join('\n');

test('ingest: a match with a declared illegal play is stored with the play flagged, the remarks and the video link', async () => {
  const w = workspace();
  put(w, REMARKS);
  const r = await w.ingest();
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /V-ILLEGAL(?: line \d+)?: Game 6, move 19: Simon Lockwood played 11: 3\/2 1\/off\(2\)/);
  const hash = r.text.match(/added\s+0001\/([0-9a-f]{16})/)[1];
  const m = metaOf(w, hash);
  assert.deepEqual(m.illegalPlays.map((p) => [p.game, p.row, p.player, p.play]), [[6, 19, 'Simon Lockwood', '11: 3/2 1/off(2)']]);
  assert.deepEqual(m.remarks, ['Game 6, Move 19 of Simon Lockwood --> 11: 3/2 1/Off(2) was illegal']);
  assert.equal(m.links[0].id, 'dQw4w9WgXcQ');
  assert.ok(m.warnings.includes('V-ILLEGAL'));
});

test('ingest: without a declaration the match is refused, with a hint; the sidecar "illegal" entry declares it', async () => {
  const w = workspace();
  fs.writeFileSync(w.a('inbox/s.txt'), withoutRemarks());
  const refused = await w.ingest();
  assert.equal(refused.code, 1);
  assert.match(refused.text, /V-LEGAL line \d+: Game 6: the move 11: 3\/2 1\/off\(2\) is not legal for this roll/);
  assert.match(refused.text, /declare it/);
  assert.deepEqual(fs.readdirSync(w.a('inbox')), ['s.txt']);
  fs.writeFileSync(w.a('inbox/s.bgdb.json'), JSON.stringify({ illegal: [{ game: 6, row: 19, player: 'Simon Lockwood' }, { game: 'x' }] }));
  const ok = await w.ingest();
  assert.equal(ok.code, 0, ok.text);
  assert.match(ok.text, /V-META: s\.bgdb\.json: an "illegal" entry was ignored/);
  assert.match(ok.text, /V-ILLEGAL(?: line \d+)?: Game 6, move 19/);
  assert.equal(fs.readdirSync(w.a('inbox')).length, 0);
});

test('build: the illegal play is flagged in the catalog (64) and in the replay data; a stored match with such a play still passes the build check', async () => {
  const w = workspace();
  put(w, REMARKS);
  put(w, FILES.b, 'normal.txt');
  await w.ingest();
  const r = await w.build('dist');
  assert.equal(r.code, 0, r.text);
  const base = w.a('dist/data/0001');
  const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'));
  const cat = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(base, manifest.files[0].path))).toString('utf8'));
  const flags = Object.fromEntries(cat.cols.id.map((h, i) => [h, cat.cols.fl[i]]));
  assert.equal(flags['2359e4c944b8d130'] & 64, 0);
  const remarks = Object.keys(flags).find((h) => h !== '2359e4c944b8d130');
  assert.equal(flags[remarks] & 64, 64);
  const replay = replayOf(base, remarks);
  const marked = replay.games[5].actions.filter((a) => a.i === 1);
  assert.equal(marked.length, 1);
  assert.deepEqual(marked[0].d, [1, 1]);
  assert.equal(marked[0].m.length, 3);
  assert.equal(replay.illegalPlays[0].row, 19);
  assert.equal(replay.remarks.length, 1);
});
