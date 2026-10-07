import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { allTextFixtures, FIXTURES } from '../../core/test/helpers.js';
import { groupFiles, analyzeGroup, fileKind, matchHash16, parseSidecar } from '@bg-db/core';

// the site modules import ../lib/core: load them from a built copy
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-contrib-'));
fs.cpSync(path.join(FIXTURES, '..', 'site', 'js'), path.join(tmp, 'js'), { recursive: true });
fs.cpSync(path.join(FIXTURES, '..', 'packages', 'core', 'src'), path.join(tmp, 'lib', 'core'), { recursive: true });
const load = (f) => import(pathToFileURL(path.join(tmp, 'js', f)).href);
const [cm, zip] = [await load('contribute-model.js'), await load('zip.js')];

const bytes = (rel) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, rel)));
const file = (rel, name = path.basename(rel)) => ({ name, bytes: bytes(rel) });
const config = { videoHosts: ['youtube.com', 'www.youtube.com', 'youtu.be'], sealPolicy: { maxAttachmentKB: 2048 } };
const CH = 'choue-net/chouehandle-vs-Bot-all-games-s4020-2026-10-04';
const LINNET = 'backgammon-studio/tester_-_Linnet14_7pt_Backgammon_Studio_2026_10_01_09_38_41.txt';

test('file names: the kind of each file and the base name that groups them', () => {
  assert.deepEqual(fileKind('Match 1.TXT'), { base: 'Match 1', kind: 'txt' });
  assert.deepEqual(fileKind('a.b.sgf'), { base: 'a.b', kind: 'sgf' });
  assert.deepEqual(fileKind('x.bgdb.json'), { base: 'x', kind: 'side' });
  assert.equal(fileKind('notes.pdf'), null);
  assert.equal(fileKind('.txt'), null);
  assert.equal(fileKind('other.json'), null);
  const g = groupFiles([{ name: 'm.txt' }, { name: 'm.sgf' }, { name: 'm.xg' }, { name: 'm.bgdb.json' }, { name: 'n.mat' }, { name: 'readme.md' }, { name: 'd.txt', dir: 'sub' }]);
  assert.deepEqual(g.map((x) => [x.dir, x.base, Object.keys(x.files).sort().join('+')]), [['', 'm', 'sgf+side+txt+xg'], ['', 'n', 'mat'], ['sub', 'd', 'txt']]);
});

test('the browser check is the same as the tools: every fixture is analysed to the same identifier, from bytes, with no file system', () => {
  for (const [rel] of allTextFixtures()) {
    const f = file(rel);
    const [item] = cm.prepare([f], { config, known: new Map() });
    assert.equal(item.res.status, 'new', rel);
    assert.equal(item.res.hash16, matchHash16(item.res.match));
    assert.ok(item.res.normalised.includes('Site "bgdb"'));
  }
});

test('prepare: new, duplicate of the database, duplicate inside the drop, an invalid file, grouping with the SGF', () => {
  const known = { get: (full) => (full.startsWith('2359e4c944b8d130') ? '0001/2359e4c944b8d130' : undefined) };
  const items = cm.prepare([
    file(LINNET, 'linnet.txt'), file('foxamon/tester_vs_Osprey12_2026-08-10.mat', 'a.mat'), file('foxamon/tester_vs_Osprey12_2026-08-10.mat', 'a-again.mat'),
    { name: 'bad.txt', bytes: new TextEncoder().encode('garbage') }, file(`${CH}.txt`, 'c.txt'), file(`${CH}.sgf`, 'c.sgf'),
  ], { config, known });
  const by = Object.fromEntries(items.map((i) => [i.group.base, i]));
  assert.equal(by.linnet.res.status, 'duplicate');
  assert.equal(by.linnet.res.duplicateOf, '0001/2359e4c944b8d130');
  assert.equal(by.a.res.status, 'new');
  assert.equal(by['a-again'].res.status, 'duplicate');
  assert.equal(by['a-again'].res.duplicateOf, '(earlier in this submission)');
  assert.equal(by.bad.res.status, 'error');
  assert.equal(by.bad.res.errors[0].code, 'V-FORMAT');
  assert.equal(by.c.res.status, 'new');
  assert.deepEqual(by.c.res.attachments.map((a) => [a.kind, a.verified, a.analysis]), [['sgf', true, true]]);
  assert.equal(by.c.res.warnings.some((w) => w.code === 'V-SCORE'), true);
  assert.equal(by.a.base, 'tester-vs-Osprey12-undated', 'no date in the file: "undated"');
  assert.equal(by.linnet.base, null, 'only new matches get a name');
  assert.equal(by.c.base, 'chouehandle-vs-Bot1-undated');
});

test('names of the files to send: players and date, made safe, unique inside one drop', () => {
  const items = cm.prepare([file('foxamon/tester_vs_Osprey12_2026-08-10.mat', 'a.mat')], { config, known: new Map() });
  assert.equal(items[0].base, 'tester-vs-Osprey12-undated');
  const [dated] = cm.prepare([file(LINNET, 'l.txt')], { config, known: new Map() });
  assert.equal(dated.base, 'tester-vs-Linnet14-2026-10-01');
  const twice = cm.prepare([file('foxamon/tester_vs_Osprey12_2026-08-10.mat', 'a.mat'), file(`${CH}.txt`, 'x.txt'), file(`${CH}.sgf`, 'x.sgf')], { config, known: new Map() });
  assert.equal(new Set(twice.filter((i) => i.base).map((i) => i.base)).size, 2);
  const evil = fs.readFileSync(path.join(FIXTURES, 'foxamon/tester_vs_Osprey12_2026-08-10.mat'), 'utf8').replaceAll('Osprey12', '../../etc/passwd "x" <b>');
  const [e] = cm.prepare([{ name: 'e.mat', bytes: new TextEncoder().encode(evil) }], { config, known: new Map() });
  assert.match(e.base, /^[\w-]+$/, `a safe file name: ${e.base}`);
  assert.ok(!e.base.includes('/') && !e.base.includes('..'));
});

test('extras typed on the page: a YouTube link and tags are validated with the rules of the tools', () => {
  const x = cm.parseExtras({ video: 'https://youtu.be/dQw4w9WgXcQ?t=95', tags: 'Final, semi-final , bad tag!, final' }, config);
  assert.deepEqual(x.links.map((l) => [l.id, l.time]), [['dQw4w9WgXcQ', 95]]);
  assert.deepEqual(x.tags, ['final', 'semi-final']);
  assert.equal(x.problems.length, 1);
  assert.match(x.problems[0], /bad tag!/);
  const bad = cm.parseExtras({ video: 'http://evil.example/x', tags: '' }, config);
  assert.deepEqual(bad.links, []);
  assert.match(bad.problems[0], /only https links are accepted/);
  assert.deepEqual(cm.parseExtras({}, config), { links: [], tags: [], problems: [] });
});

test('the files to hand over: renamed originals, a sidecar only when there is something to add, a README; duplicates and errors are left out', () => {
  const items = cm.prepare([file(`${CH}.txt`, 'c.txt'), file(`${CH}.sgf`, 'c.sgf'), file('foxamon/tester_vs_Osprey12_2026-08-10.mat', 'a.MAT'), { name: 'bad.txt', bytes: new TextEncoder().encode('x') }], { config, known: new Map() });
  const files = cm.packageFiles(items, (base) => (base.startsWith("chouehandle") ? cm.parseExtras({ video: 'https://youtu.be/dQw4w9WgXcQ', tags: 'online' }, config) : { links: [], tags: [] }));
  assert.deepEqual(files.map((f) => f.name).sort(), ['README.txt', 'chouehandle-vs-Bot1-undated.bgdb.json', 'chouehandle-vs-Bot1-undated.sgf', 'chouehandle-vs-Bot1-undated.txt', 'tester-vs-Osprey12-undated.mat']);
  const side = JSON.parse(files.find((f) => f.name.endsWith('.bgdb.json')).bytes);
  assert.deepEqual(side, { links: [{ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }], tags: ['online'] });
  assert.equal(cm.packageFiles([items.find((i) => i.res.status === 'error')]).length, 0, 'nothing to send for an invalid file');
  // what is handed over is accepted by the tools again: groups of the same name, the same identifier
  const regrouped = groupFiles(files.filter((f) => f.name !== 'README.txt').map((f) => ({ name: f.name, bytes: typeof f.bytes === 'string' ? new TextEncoder().encode(f.bytes) : f.bytes, dir: '' })));
  const re = regrouped.map((g) => analyzeGroup(g, { config, known: new Map() }));
  assert.deepEqual(re.map((r) => r.status), ['new', 'new']);
  assert.deepEqual(re.map((r) => r.hash16).sort(), items.filter((i) => i.res.status === 'new').map((i) => i.res.hash16).sort());
  assert.equal(re.find((r) => r.base.startsWith("chouehandle")).links.length, 1);
});

test('a declared illegal play survives the hand-over (the sidecar keeps the declaration)', () => {
  const text = fs.readFileSync(path.join(FIXTURES, 'extmatchdb/illegal-play-declared-in-remarks_7pt.txt'), 'utf8').split('\n').filter((l) => !/^;\s*[|+]/.test(l)).join('\n');
  const side = new TextEncoder().encode(JSON.stringify({ illegal: [{ game: 6, row: 19, player: 'Simon Lockwood' }] }));
  const items = cm.prepare([{ name: 's.txt', bytes: new TextEncoder().encode(text) }, { name: 's.bgdb.json', bytes: side }], { config, known: new Map() });
  assert.equal(items[0].res.status, 'new');
  const files = cm.packageFiles(items);
  assert.deepEqual(JSON.parse(files.find((f) => f.name.endsWith('.bgdb.json')).bytes).illegal, [{ game: 6, row: 19, player: 'Simon Lockwood' }]);
});

test('links to GitHub: the upload page, an issue for one small text match, and the reasons when the issue is not possible', () => {
  const reg = { repository: 'pipandlove/bg-db', defaultBranch: 'master' };
  const one = cm.prepare([file('xg-text/me-XG_Roller__03-10-2026__2.txt', 'a.txt')], { config, known: new Map() });
  const text = one[0].res.text;
  const l = cm.githubLinks(reg, one, text);
  assert.equal(l.upload, 'https://github.com/pipandlove/bg-db/upload/master/inbox');
  assert.ok(l.issue.startsWith('https://github.com/pipandlove/bg-db/issues/new?template=submit-match.yml&title=Match%3A%20me%20vs%20XG%20Roller%2B%202026-10-03&transcript='));
  assert.ok(l.issue.length <= cm.MAX_ISSUE_URL);
  assert.equal(decodeURIComponent(l.issue.split('&transcript=')[1]), text);
  assert.equal(l.issueWhy, null);
  const two = cm.prepare([file('foxamon/tester_vs_Osprey12_2026-08-10.mat', 'a.mat'), file(LINNET, 'b.txt')], { config, known: new Map() });
  const lin = cm.prepare([file(LINNET, 'b.txt')], { config, known: new Map() });
  assert.match(cm.githubLinks(reg, lin, lin[0].res.text).issueWhy, /too long/, 'a 7-point match is too long for an address: the ZIP is the way');
  assert.match(cm.githubLinks(reg, two, '').issueWhy, /one match at a time/);
  const withSgf = cm.prepare([file(`${CH}.txt`, 'c.txt'), file(`${CH}.sgf`, 'c.sgf')], { config, known: new Map() });
  assert.match(cm.githubLinks(reg, withSgf, withSgf[0].res.text).issueWhy, /SGF or XG/);
  const long = cm.prepare([file('extmatchdb/xg-text-crlf-empty-site_11pt.mat', 'd.mat')], { config, known: new Map() });
  assert.match(cm.githubLinks(reg, long, long[0].res.text).issueWhy, /too long/);
  assert.equal(cm.githubLinks({}, one, text), null, 'no repository known: no GitHub links');
  assert.equal(cm.githubLinks({ repository: 'not a repo' }, one, text), null);
  assert.equal(cm.githubLinks({ repository: 'a/b', defaultBranch: 'x y;z' }, one, text).upload, 'https://github.com/a/b/upload/master/inbox', 'an odd branch name is not put into the address');
});

test('the catalog rows give the lookup of what is already in the database (16 characters of the hash)', () => {
  const known = cm.knownFromRows([{ hash: '2359e4c944b8d130', id: '0001/2359e4c944b8d130' }]);
  assert.equal(known.get('2359e4c944b8d130aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), '0001/2359e4c944b8d130');
  assert.equal(known.get('ffffffffffffffffaaaaaaaa'), undefined);
});

test('a sidecar with problems is parsed with warnings, and a broken one is refused', () => {
  const w = [];
  const ok = parseSidecar('x.bgdb.json', new TextEncoder().encode(JSON.stringify({ links: [{ url: 'ftp://x' }], tags: ['ok', 'Not OK'], extra: 1, illegal: [{ game: 1 }] })), config, w);
  assert.deepEqual([ok.links, ok.tags, ok.illegal], [[], ['ok'], []]);
  assert.deepEqual(w.map((x) => x.code).sort(), ['V-LINK', 'V-META', 'V-META', 'V-META']);
  assert.equal(parseSidecar('x.bgdb.json', new TextEncoder().encode('{'), config, []).error.code, 'V-FORMAT');
});

// ---- ZIP
function readZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const end = u8.length - 22;
  assert.equal(dv.getUint32(end, true), 0x06054b50, 'end of central directory');
  const n = dv.getUint16(end + 10, true);
  let c = dv.getUint32(end + 16, true);
  const out = [];
  for (let i = 0; i < n; i++) {
    assert.equal(dv.getUint32(c, true), 0x02014b50);
    const crc = dv.getUint32(c + 16, true); const size = dv.getUint32(c + 24, true); const nl = dv.getUint16(c + 28, true); const off = dv.getUint32(c + 42, true);
    const name = new TextDecoder().decode(u8.subarray(c + 46, c + 46 + nl));
    assert.equal(dv.getUint32(off, true), 0x04034b50, 'local header');
    const lnl = dv.getUint16(off + 26, true);
    const data = u8.subarray(off + 30 + lnl, off + 30 + lnl + size);
    assert.equal(zip.crc32(data), crc, `crc of ${name}`);
    out.push({ name, data });
    c += 46 + nl;
  }
  return out;
}

test('the ZIP is valid: names, contents and checksums read back, deterministic, UTF-8 names, an empty file, binary data', () => {
  const bin = new Uint8Array(70000).map((_, i) => (i * 31) % 251);
  const z = zip.makeZip([{ name: 'a.txt', bytes: 'héllo\n' }, { name: 'dir/é.bin', bytes: bin }, { name: 'empty', bytes: new Uint8Array(0) }]);
  const back = readZip(z);
  assert.deepEqual(back.map((f) => f.name), ['a.txt', 'dir/é.bin', 'empty']);
  assert.equal(new TextDecoder().decode(back[0].data), 'héllo\n');
  assert.deepEqual(back[1].data, bin);
  assert.equal(back[2].data.length, 0);
  assert.deepEqual(zip.makeZip([{ name: 'a.txt', bytes: 'x' }]), zip.makeZip([{ name: 'a.txt', bytes: 'x' }]));
  assert.equal(zip.crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'the standard CRC-32 check value');
});

test('an unzip program reads the ZIP (if one is installed)', async (t) => {
  const { execFileSync } = await import('node:child_process');
  try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); } catch { t.skip('no unzip here'); return; }
  const f = path.join(tmp, 'x.zip');
  fs.writeFileSync(f, zip.makeZip([{ name: 'a.txt', bytes: 'hello\n' }, { name: 'b.bin', bytes: new Uint8Array([1, 2, 3, 255]) }]));
  assert.match(execFileSync('unzip', ['-t', f], { encoding: 'utf8' }), /No errors detected/);
  assert.equal(execFileSync('unzip', ['-p', f, 'a.txt'], { encoding: 'utf8' }), 'hello\n');
});
