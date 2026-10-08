import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { main } from '../src/cli.js';
import { createStaticServer } from '../src/serve.js';
import { FIXTURES } from '../../core/test/helpers.js';

const REPO = path.resolve(FIXTURES, '..');
const SITE = path.join(REPO, 'site');
const capture = () => ({ io: { out: () => {}, err: () => {} } });
const FILES = [
  'opengammon/vireo_vs_tester_2026-09-30.mat', 'opengammon/Sir_Plover_vs_tester_2026-08-03.mat', 'xg-binary/Sir_Plover_vs_tester_2026-08-03.xg',
  'backgammon-studio/tester_-_Linnet14_7pt_Backgammon_Studio_2026_10_01_09_38_41.txt', 'backgammon-studio/tester_-_Cardinal_5pt_Backgammon_Studio_2026_09_22_14_49_23.txt',
  'choue-net/chouehandle-vs-Bot-all-games-s4020-2026-10-04.txt', 'choue-net/chouehandle-vs-Bot-all-games-s4020-2026-10-04.sgf',
  'xg-text/me-XG_Roller__03-10-2026.txt', 'xg-text/me-XG_Roller__03-10-2026__3.txt',
  'extmatchdb/xg-text-crlf-empty-site_11pt.mat', 'extmatchdb/xg-text-transcriber-tag_7pt.txt',
  'extmatchdb/illegal-play-declared-in-remarks_7pt.txt',
];
let root; let dist; let server; let base; let q; let cat; let fmt; let M; let core;

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-site-'));
  fs.mkdirSync(path.join(root, 'inbox'));
  for (const f of FILES) fs.copyFileSync(path.join(FIXTURES, f), path.join(root, 'inbox', path.basename(f)));
  fs.writeFileSync(path.join(root, 'inbox/Sir_Plover_vs_tester_2026-08-03.bgdb.json'), JSON.stringify({ links: [{ url: 'https://youtu.be/dQw4w9WgXcQ?t=95', title: 'Game 2', game: 2 }] }));
  const cfg = path.join(root, 'none.json');
  assert.equal(await main(['ingest', '--inbox', path.join(root, 'inbox'), '--data', path.join(root, 'data'), '--config', cfg, '--date', '2026-10-04'], capture().io), 0);
  dist = path.join(root, 'dist');
  assert.equal(await main(['build', '--data', path.join(root, 'data'), '--out', dist, '--site', SITE, '--config', cfg], capture().io), 0);
  server = createStaticServer(dist);
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}/`;
  const load = (f) => import(pathToFileURL(path.join(dist, 'js', f)).href);          // the modules exactly as they ship
  [q, cat, fmt] = [await load('query.js'), await load('catalog.js'), await load('format.js')];
  core = await import(pathToFileURL(path.join(dist, 'lib/core/index.js')).href);
  M = await cat.loadAll({ base });
});
after(() => server?.close());

test('the client loads registry, shard and compressed catalog over HTTP and decodes every match', () => {
  assert.equal(M.rows.length, 10, '12 files = 10 matches (a match and its .xg or .sgf are a single contribution)');
  assert.equal(M.registry.shards.length, 1);
  assert.deepEqual(M.errors, []);
  assert.ok(M.rows[0].date >= M.rows[1].date, 'newest first');
  assert.deepEqual(M.lengths, [0, 5, 7, 11]);
  assert.deepEqual(M.years, [2021, 2026]);
  assert.ok(M.players.some((p) => p.name === 'tester' && p.count === 4));
  const r = M.rows.find((x) => x.hash === '8787802c5abd114b');
  assert.deepEqual([r.id, r.p0, r.p1, r.len, r.games, r.s0, r.s1, r.win], ['0001/8787802c5abd114b', 'chouehandle', 'Bot1', 7, 2, 0, 5, -1]);   // -1: the match is unfinished (5 of 7 points)
  assert.equal(r.n1, 'bot1');
  assert.equal(r.flags & (4 | 16), 4 | 16, 'analysed SGF attached');
});

test('the round is a column of the catalog; rows of the same day and event are in natural round order; catalogs of version 1 (no rounds) still load', () => {
  const r = M.rows.find((x) => x.hash.startsWith('4d6936fab50bad29'.slice(0, 4)) && x.event === 'Cup 2022 Final');
  assert.equal(r.round, 'Match 2');
  assert.equal(r.roundNorm, 'match 2');
  assert.ok(r.hay.includes('match 2'));
  assert.equal(M.rows.find((x) => x.p0 === 'vireo').round, '', 'no round: an empty string');
  const cup = M.rows.find((x) => x.event === 'Cup Fınal 2021');
  assert.equal(cup.round, '1');
  const mk = (id, round, event = 'E') => ({ id, round, event, date: '2024-01-01' });
  const sorted = [mk('c', 'Round 10'), mk('a', 'Round 2'), mk('b', 'Round 1'), mk('d', 'Match 1', 'D')].sort(cat.compareRows).map((x) => x.id);
  assert.deepEqual(sorted, ['d', 'b', 'a', 'c'], 'event first, then Round 1 < Round 2 < Round 10');
  const v1 = { schema: '1.0', type: 'catalog', version: 1, shard: '0001', count: 1, dict: { players: ['A', 'B'], events: ['E'] }, cols: { id: ['abcdef0123456789'], p0: [0], p1: [1], len: [3], date: ['2020-01-01'], ev: [0], n: [1], s0: [3], s1: [0], win: [0], fl: [0] } };
  const row = cat.decodeCatalog(v1, '0001')[0];
  assert.deepEqual([row.event, row.round, row.roundNorm], ['E', '', '']);
});

test('a catalog is built with the round column (version 2) and the contributor column (version 3)', async () => {
  const base = path.join(dist, 'data/0001');
  const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'));
  assert.equal(manifest.files[0].version, 3);
  const zlib = await import('node:zlib');
  const c = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(base, manifest.files[0].path))).toString('utf8'));
  assert.equal(c.version, 3);
  assert.equal(c.cols.by.length, c.count);
  assert.ok(c.cols.by.every((i) => i === -1 || c.dict.contributors[i]), 'each match names its contributor in the dictionary, or none');
  assert.ok(c.dict.rounds.includes('Match 2') && c.dict.rounds.includes('1') && c.dict.rounds.includes('Round 2'));
  assert.equal(c.cols.rd.length, c.count);
  assert.equal(c.cols.rd.filter((i) => i !== -1).length, 4, 'four matches name a round');
});

test('a catalog that a server already decoded (plain JSON) is accepted too', async () => {
  const plain = JSON.stringify({ schema: '1.0', type: 'catalog', version: 1, shard: '0001', count: 1, dict: { players: ['A', 'B'], events: [] }, cols: { id: ['abcdef0123456789'], p0: [0], p1: [1], len: [3], date: [''], ev: [-1], n: [1], s0: [3], s1: [0], win: [0], fl: [0] } });
  const fake = async () => new Response(plain);
  const got = await cat.fetchGzJson('http://x/y', fake);
  assert.equal(cat.decodeCatalog(got, '0009')[0].id, '0009/abcdef0123456789');
  await assert.rejects(() => cat.fetchJson('http://x/y', async () => new Response('nope', { status: 404 })), /HTTP 404/);
  await assert.rejects(() => cat.fetchJson('http://x/y', async () => new Response('<html>')), /not valid JSON/);
});

test('a shard that fails to load is skipped with a notice, the others still work (spec CL-20)', async () => {
  const f = async (url, init) => (String(url).includes('/data/0001/shard.json') ? new Response('', { status: 500 }) : fetch(url, init));
  const partial = await cat.loadAll({ base, fetchImpl: f });
  assert.equal(partial.rows.length, 0);
  assert.match(partial.errors[0], /Shard 0001 could not be loaded/);
});

test('the files that name the files of the moment are revalidated, the hashed files may come from the cache (spec CL-01, CL-02)', async () => {
  const seen = new Map();
  const f = async (url, init) => { seen.set(new URL(url).pathname.split('/').pop(), init?.cache ?? 'default'); return fetch(url, init); };
  await cat.loadAll({ base, fetchImpl: f });
  for (const name of ['sources.json', 'registry.json', 'shard.json']) if (seen.has(name)) assert.equal(seen.get(name), 'no-cache', name);
  assert.equal(seen.get('shard.json'), 'no-cache');      // a stale shard.json hid the matches just added (2026-10-08)
  const catalog = [...seen.keys()].find((n) => n.startsWith('catalog.'));
  assert.equal(seen.get(catalog), 'default');
});

test('all URLs are resolved against the page: the site works under any sub-path', async () => {
  const f = async (url, init) => fetch(String(url).replace('/sub/path/', '/'), init);
  const sub = await cat.loadAll({ base: `${base}sub/path/`, fetchImpl: f });
  assert.equal(sub.rows.length, 10);
});

test('query language: parsing, quoting, round trip', () => {
  const f = q.parseQuery('player:"Dale Henderson" event:final year:2019..2024 len:money has:cube,video,cube extra "two words"');
  assert.deepEqual([f.player, f.event, f.year, f.len, f.has, f.text, f.errors], [['Dale Henderson'], ['final'], { min: 2019, max: 2024 }, { min: 0, max: 0 }, ['cube', 'video'], ['extra', 'two words'], []]);
  assert.equal(q.formatQuery(f), 'player:"Dale Henderson" event:final year:2019..2024 len:money has:cube,video extra "two words"');
  assert.deepEqual(q.parseQuery('round:"match 2" round:final').round, ['match 2', 'final']);
  assert.equal(q.formatQuery(q.parseQuery('round:"match 2"')), 'round:"match 2"');
  assert.deepEqual(q.parseQuery('year:..2020 len:5..').year, { min: null, max: 2020 });
  assert.deepEqual(q.parseQuery('len:5..').len, { min: 5, max: null });
  assert.equal(q.formatQuery(q.parseQuery('year:2021')), 'year:2021');
  assert.equal(q.formatQuery(q.parseQuery('vs:abc')), 'player:abc');
  for (const bad of ['year:abc', 'len:..', 'has:nonsense', 'colour:red']) assert.equal(q.parseQuery(bad).errors.length, 1, bad);
  assert.deepEqual(q.tokenize('a:"b c" d'), [{ key: 'a', value: 'b c' }, { key: null, value: 'd' }]);
  assert.deepEqual(q.tokenize('player:"open quote'), [{ key: 'player', value: 'open quote' }]);
});

test('query language: searching the real catalog', () => {
  const find = (s) => M.rows.filter(q.makePredicate(q.parseQuery(s)));
  assert.equal(find('').length, 10);
  assert.equal(find('player:tester').length, 4);
  assert.equal(find('player:TESTER').length, 4, 'case is ignored');
  assert.equal(find('player:dale').length, 2);
  assert.equal(find('player:dale player:matthew').length, 2, 'two players: a match between them, in either order');
  assert.equal(find('player:dale player:linnet14').length, 0);
  assert.equal(find('player:a player:b player:c').length, 0);
  assert.equal(find('player:dale player:dale').length, 0, 'one person cannot play against themselves');
  assert.equal(find('len:money').length, 2);
  assert.equal(find('len:5..7').length, 7);
  assert.equal(find('year:2021').length, 1);
  assert.equal(find('year:2026..').length, 7, 'the undated match is excluded when a year is asked for');
  assert.equal(find('year:1990').length, 0);
  assert.equal(find('has:video').length, 2);
  assert.equal(find('has:illegal').length, 1, 'the match with an illegal play that was made');
  assert.equal(find('has:illegal player:simon').length, 1);
  assert.equal(find('has:analysis').length, 2, 'an analysed SGF and an analysed XG file');
  assert.equal(find('has:attachment').length, 2);
  assert.equal(find('has:analysis,video').length, 1, 'the XG match that has a video link');
  assert.equal(find('event:"cup"').length, 2);
  assert.equal(find('city').length, 1, 'bare words search names and events');
  assert.equal(find('round:"match 2"').length, 1, 'the round of a tournament match');
  assert.equal(find('round:1').length, 2, 'rounds "1" of the two Cup/Dale matches');
  assert.equal(find('round:"round 2"').length, 1, 'a Backgammon Studio tournament round');
  assert.equal(find('round:match event:"cup 2022"').length, 1);
  assert.equal(find('"match 2"').length, 1, 'a bare word also finds the round');
  assert.equal(find('round:nothing').length, 0);
  assert.equal(find('city dale').length, 1);
  assert.equal(find('player:bot1').length, 1);
  assert.equal(find('player:bot1 event:online').length, 0, 'the placeholder event "Online match" is left out at ingest (decision 0022)');
});

test('suggestions: players starting with the text come first, accents are ignored', () => {
  const s = cat.suggestPlayers(M.players, 'dal');
  assert.equal(s[0].name, 'Dale Henderson');
  assert.deepEqual(cat.suggestPlayers(M.players, 'd'), [], 'at least two characters');
  assert.ok(cat.suggestPlayers(M.players, 'hender').some((p) => p.name === 'Dale Henderson'), 'a word inside the name');
  assert.deepEqual(cat.suggestEvents(M.events, 'city').length, 1);
  const t = q.currentToken('player:tester player:"Dale Hen');
  assert.deepEqual([t.key, t.value, t.start], ['player', 'Dale Hen', 14]);
  assert.deepEqual(q.currentToken('abc de'), { start: 4, key: null, value: 'de' });
  assert.equal(q.currentToken('player:x '), null);
});

test('match page data: the metadata and the match file are served at the URLs the page builds; the replay data is derived from them with the shipped code', async () => {
  const row = M.rows.find((r) => r.hash === '8787802c5abd114b');
  const shard = M.shards.find((s) => s.id === row.shard);
  const files = fmt.matchFiles(shard.base, row.hash);
  assert.deepEqual(Object.keys(files).sort(), ['mat', 'meta']);
  const [meta, text] = await Promise.all([cat.fetchJson(files.meta), cat.fetchText(files.mat)]);
  assert.equal(meta.id, row.id);
  const parsed = core.readMatch(text);
  assert.equal(parsed.ok, true);
  const replay = core.toBgdbJson(parsed.match, meta);
  assert.equal(replay.games.length, 2);
  assert.deepEqual(replay.games[1].result, { winner: 1, points: 3, kind: 'single', how: 'resign', cube: 1 });
  const att = await fetch(fmt.attachmentUrl(shard.base, row.hash, 'sgf'));
  assert.equal(att.status, 200);
  assert.equal((await att.text()).slice(0, 4), '(;FF');
  assert.equal((await fetch(files.mat)).status, 200);
  assert.equal((await fetch(files.mat.replace(/\.mat$/, '.json'))).status, 404, 'no replay JSON is published');
  const sg = M.rows.find((r) => r.flags & 32);
  assert.equal((await fetch(fmt.attachmentUrl(shard.base, sg.hash, 'xg'))).status, 200);
});

test('format helpers: video links are only shown in the exact canonical shape', () => {
  const ok = { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=95s' };
  assert.equal(fmt.safeVideoUrl(ok), ok.url);
  assert.equal(fmt.safeVideoUrl({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  for (const bad of ['http://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://evil.example/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&x=1',
    'https://www.youtube.com.evil.example/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=short', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ"onmouseover="x']) {
    assert.equal(fmt.safeVideoUrl({ url: bad }), null, bad);
  }
  assert.equal(fmt.safeVideoUrl(null), null);
  assert.equal(fmt.safeVideoUrl({}), null);
  assert.deepEqual([fmt.timeLabel(95), fmt.timeLabel(3723), fmt.timeLabel(5)], ['1:35', '1:02:03', '0:05']);
  assert.deepEqual([fmt.lengthText(0), fmt.lengthText(7), fmt.dateText('')], ['Money', '7 pt', '–']);
  assert.deepEqual(fmt.parseMatchId('0001/2359e4c944b8d130'), { shard: '0001', hash: '2359e4c944b8d130' });
  for (const bad of ['', 'x', '0001/../../etc', '0001/ZZZ', '1/2359e4c944b8d130', null]) assert.equal(fmt.parseMatchId(bad), null, String(bad));
  assert.equal(fmt.resultText({ winner: 1, score: [3, 7], finished: true }, [{ name: 'A' }, { name: 'B' }], 7), 'B won 7–3');
  assert.equal(fmt.resultText({ winner: null, score: [0, 5], finished: false }, [{ name: 'A' }, { name: 'B' }], 7), 'unfinished, 0–5');
  assert.equal(fmt.resultText({ winner: 1, score: [3, 7], finished: true, partial: { startScore: [2, 5] } }, [{ name: 'A' }, { name: 'B' }], 7), 'B won 7–3 (a fragment: recorded from 2–5)');
  assert.equal(fmt.resultText({ winner: null, score: [9, 5], finished: false, partial: { startScore: [8, 4] } }, [{ name: 'A' }, { name: 'B' }], 17), 'unfinished, 9–5 (a fragment: recorded from 8–4)');
  assert.equal(fmt.rulesText({ crawford: true, jacoby: false, beaver: null }), 'Crawford');
});

test('the site is static and portable: relative URLs only, no inline script or style, every file it names exists, nothing external is loaded', () => {
  for (const page of ['index.html', 'contribute.html', 'guide.html']) for (const m of (() => {
    const html = fs.readFileSync(path.join(dist, page), 'utf8');
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), `${page}: no inline script`);
    assert.ok(!/<style/i.test(html) && !/\sstyle=/.test(html), `${page}: no inline style`);
    return [...html.matchAll(/\s(?:src|href)="([^"]+)"/g)];
  })()) {
    const u = m[1];
    if (u.startsWith('#') || u === 'https://github.com/signup') continue;      // GitHub's sign-up page: a link to leave, nothing is loaded from it
    assert.ok(!/^([a-z]+:)?\/\//i.test(u) && !u.startsWith('/'), `absolute URL in index.html: ${u}`);
    assert.ok(fs.existsSync(path.join(dist, u.split('#')[0])), `missing file: ${u}`);
  }
  const SKIP = new Set(fs.readdirSync(path.join(dist, 'js')).filter((f) => f.endsWith('.js')));
  for (const f of ['app.js', 'catalog.js', 'format.js', 'query.js', 'replay.js', 'replay-model.js', 'board.js', 'svg.js', 'dom.js', 'zip.js', 'contribute.js', 'contribute-model.js', 'steps.js', 'guide.js']) assert.ok(SKIP.has(f), `${f} ships`);
  for (const f of SKIP) {
    const raw = fs.readFileSync(path.join(dist, 'js', f), 'utf8');
    const src = raw.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');          // comments may mention what the code avoids
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(src), `${f} must not inject HTML or evaluate strings`);
    assert.ok(!/fetch\(\s*['"`]\//.test(src) && !/https?:\/\/(?!www\.youtube\.com|creativecommons\.org|www\.w3\.org\/2000\/svg|github\.com\/\$\{repo\}|github\.com\/signup|youtu\.be\/…)/.test(src), `${f} has an absolute URL (only the SVG namespace identifier and the link targets YouTube, Creative Commons, the database's GitHub repository and GitHub's sign-up page are allowed; a placeholder text may show a youtu.be address)`);
    for (const m of src.matchAll(/from '(\.[^']+)'/g)) assert.ok(fs.existsSync(path.resolve(path.join(dist, 'js'), m[1])), `${f} imports a missing module ${m[1]}`);
  }
  assert.ok(fs.existsSync(path.join(dist, 'lib/core/names.js')));
  const css = fs.readFileSync(path.join(dist, 'style.css'), 'utf8');
  assert.ok(!/url\(\s*['"]?https?:/.test(css) && !/@import/.test(css), 'the stylesheet loads nothing external');
});

test('the built site is served correctly over HTTP (what GitHub Pages would do)', async () => {
  for (const [url, type] of [['', 'text/html'], ['js/app.js', 'javascript'], ['style.css', 'text/css'], ['registry.json', 'json'], ['favicon.svg', 'svg']]) {
    const r = await fetch(base + url);
    assert.equal(r.status, 200, url);
    assert.ok((r.headers.get('content-type') ?? '').includes(type), `${url}: ${r.headers.get('content-type')}`);
  }
  assert.equal((await fetch(`${base}nothing-here`)).status, 404);
  assert.equal((await fetch(`${base}..%2f..%2fetc%2fpasswd`)).status === 200, false);
});

test('how to contribute: every step and every picture exists, each picture has the size its marks were measured on, and every mark lies inside it', async () => {
  const { STEPS, SHOTS } = await import(pathToFileURL(path.join(dist, 'js', 'steps.js')).href);
  assert.deepEqual(STEPS.map((s) => s.id), ['key', 'check', 'zip', 'form', 'send', 'wait'], 'the Contribute page puts its check and buttons into these steps');
  for (const st of STEPS) for (const n of st.shots) assert.ok(SHOTS[n], `${st.id}: picture ${n}`);
  for (const [name, s] of Object.entries(SHOTS)) {
    const png = fs.readFileSync(path.join(dist, s.src));
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [s.w, s.h], `${s.src}: a new screenshot must come with its size, and its marks measured again`);
    assert.ok(s.alt.length > 40, `${name}: a description for those who cannot see the picture`);
    for (const m of s.marks) {
      const [x, y, w, h] = m.box;
      assert.ok(x >= 0 && y >= 0 && x + w <= s.w && y + h <= s.h, `${name}: mark "${m.text}" lies outside the picture`);
    }
  }
  const html = fs.readFileSync(path.join(dist, 'guide.html'), 'utf8');
  assert.match(html, /<noscript>[\s\S]*Contribute page[\s\S]*Create[\s\S]*<\/noscript>/, 'without JavaScript, the steps in one paragraph');
});
