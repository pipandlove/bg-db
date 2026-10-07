/**
 * The Contribute page's ZIP, uploaded as it is into inbox/: read by the core (defensively), reviewed in place, unpacked by the ingest.
 * The rights statement the page writes into the ZIP counts like the ticked box of a pull request description.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { readZip, ZIP_LIMITS } from '@bg-db/core';
import { reviewInbox, classify } from '../src/review.js';
import { ingest } from '../src/ingest.js';
import { FIXTURES } from '../../core/test/helpers.js';

// the site modules import ../lib/core: load them from a built copy
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-zip-site-'));
fs.cpSync(path.join(FIXTURES, '..', 'site', 'js'), path.join(tmp, 'js'), { recursive: true });
fs.cpSync(path.join(FIXTURES, '..', 'packages', 'core', 'src'), path.join(tmp, 'lib', 'core'), { recursive: true });
const { makeZip, crc32 } = await import(pathToFileURL(path.join(tmp, 'js', 'zip.js')).href);
const cm = await import(pathToFileURL(path.join(tmp, 'js', 'contribute-model.js')).href);

const config = { videoHosts: ['youtube.com', 'www.youtube.com', 'youtu.be'], sealPolicy: { maxMatches: 5000, maxMB: 300, maxAttachmentKB: 2048 }, repoPolicy: { warnMB: 800, stopMB: 950 }, closed: false, externalShards: [], firstShard: null };
const bytes = (rel) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, rel)));
const CH = 'choue-net/chouehandle-vs-Bot-all-games-s4020-2026-10-04';
const FOX = 'foxamon/tester_vs_Osprey12_2026-08-10.mat';
const UNTICKED = '- [ ] I have the right to share these matches under the CC0 public-domain dedication';

/** the ZIP the Contribute page makes for these fixtures (the rights box ticked there) */
function pageZip(rels) {
  const items = cm.prepare(rels.map((r) => ({ name: path.basename(r), bytes: bytes(r) })), { config, known: new Map() });
  return makeZip(cm.packageFiles(items, () => ({ links: [], tags: [] }), 'CC0-1.0'));
}

/** a ZIP with deflated entries, as an archiver of the operating system makes it (with a folder, as when one zips a folder) */
function deflatedZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name);
    const comp = zlib.deflateRawSync(f.bytes);
    const crc = f.crc ?? crc32(f.bytes);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(f.flags ?? 0, 6); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(f.size ?? f.bytes.length, 22); h.writeUInt16LE(name.length, 26);
    parts.push(h, name, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(f.flags ?? 0, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(f.size ?? f.bytes.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, end]));
}

function inbox(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-zip-'));
  const a = (rel) => path.join(root, rel);
  fs.mkdirSync(a('inbox'));
  fs.writeFileSync(a('inbox/README.md'), '# inbox\n');
  for (const [name, data] of Object.entries(files)) fs.writeFileSync(a(`inbox/${name}`), data);
  return { root, a, review: () => reviewInbox({ inbox: a('inbox'), data: a('data'), config }) };
}

// ------------------------------------------------------------------------------------------------ reading

test('readZip: the stored entries of the page and the deflated entries of an archiver, by their plain names; folders and archiver noise left out', () => {
  const page = readZip(pageZip([FOX]));
  assert.equal(page.ok, true, page.error);
  assert.deepEqual(page.entries.map((e) => e.name).sort(), ['CONTRIBUTION.md', 'tester-vs-Osprey12-undated.mat']);
  const os_ = readZip(deflatedZip([
    { name: 'matches/', bytes: new Uint8Array() },
    { name: 'matches/fox.mat', bytes: bytes(FOX) },
    { name: '__MACOSX/matches/._fox.mat', bytes: new Uint8Array([1, 2]) },
    { name: 'matches/.DS_Store', bytes: new Uint8Array([3]) },
  ]));
  assert.equal(os_.ok, true, os_.error);
  assert.deepEqual(os_.entries.map((e) => e.name), ['fox.mat']);
  assert.deepEqual(os_.entries[0].bytes, bytes(FOX), 'inflated exactly');
  assert.deepEqual(os_.skipped.sort(), ['__MACOSX/matches/._fox.mat', 'matches/', 'matches/.DS_Store']);
});

test('readZip refuses what it should: not a ZIP, damaged data, encryption, two files of one name, unusable names, too many or too large entries', () => {
  const one = (f) => readZip(deflatedZip([{ name: 'a.mat', bytes: bytes(FOX), ...f }]));
  assert.match(readZip(new TextEncoder().encode('not a zip at all, just text')).error, /not a ZIP archive/);
  assert.match(one({ crc: 12345 }).error, /checksum does not match/);
  assert.match(one({ flags: 1 }).error, /a\.mat is encrypted/);
  assert.match(readZip(deflatedZip([{ name: 'x/a.mat', bytes: bytes(FOX) }, { name: 'y/a.mat', bytes: bytes(FOX) }])).error, /two entries are named a\.mat/);
  assert.match(readZip(deflatedZip([{ name: '../..', bytes: bytes(FOX) }])).error, /unusable name/);
  const traversal = readZip(deflatedZip([{ name: '../../etc/evil.mat', bytes: bytes(FOX) }]));
  assert.deepEqual(traversal.entries.map((e) => e.name), ['evil.mat'], 'only the plain name is kept: nothing can be written outside the inbox');
  const many = Array.from({ length: 4 }, (_, i) => ({ name: `m${i}.mat`, bytes: bytes(FOX) }));
  assert.match(readZip(deflatedZip(many), { maxEntries: 3 }).error, /4 entries \(at most 3\)/);
  assert.match(readZip(deflatedZip([{ name: 'a.mat', bytes: bytes(FOX) }]), { maxEntryBytes: 100 }).error, /a\.mat is \d+ bytes \(at most 100\)/);
  assert.match(readZip(deflatedZip(many), { maxTotalBytes: bytes(FOX).length * 2 }).error, /add up to more than/);
  // a bomb: an entry that claims a small size but expands far beyond it is stopped while inflating
  const bomb = readZip(deflatedZip([{ name: 'b.mat', bytes: new Uint8Array(5_000_000), size: 1000 }]));
  assert.match(bomb.error, /b\.mat: its compressed data is damaged/);
  assert.ok(ZIP_LIMITS.maxTotalBytes >= 10 * 1024 * 1024);
});

// ------------------------------------------------------------------------------------------------ review

test('review: the page\'s ZIP uploaded as it is is ready, and its rights statement counts like the ticked box', () => {
  const w = inbox({ 'matches-for-bgdb.zip': pageZip([FOX, `${CH}.txt`, `${CH}.sgf`]) });
  const r = w.review();
  assert.equal(r.summary.groups, 2, 'two matches inside the archive (the text and its SGF are one)');
  assert.equal(r.summary.new, 2);
  assert.equal(r.rights, true);
  assert.ok(r.groups.every((g) => g.files.every((f) => f.startsWith('matches-for-bgdb.zip/'))), JSON.stringify(r.groups.map((g) => g.files)));
  const d = classify(r, { changed: ['inbox/matches-for-bgdb.zip'], body: UNTICKED });
  assert.deepEqual([d.verdict, d.autoMerge], ['ready', true], d.reasons.join('; '));
  assert.ok(fs.existsSync(w.a('inbox/matches-for-bgdb.zip')), 'a review writes nothing');
});

test('review: without any rights statement the box is still asked for; a ZIP that cannot be read needs a fix, with how', () => {
  const plain = inbox({ 'fox.mat': bytes(FOX) });
  assert.equal(plain.review().rights, false);
  assert.match(classify(plain.review(), { body: UNTICKED }).reasons.join(), /rights box/);
  const broken = inbox({ 'matches.zip': new TextEncoder().encode('PK but not really') });
  const r = broken.review();
  const d = classify(r, { changed: ['inbox/matches.zip'], body: UNTICKED.replace('[ ]', '[x]') });
  assert.equal(d.verdict, 'needs-fix');
  assert.equal(r.groups[0].files[0], 'matches.zip');
  assert.match(r.groups[0].errors[0].message, /matches\.zip cannot be read: it is not a ZIP archive/);
  assert.match(r.groups[0].errors[0].hint, /unzip it first/);
});

test('an older ZIP of the page (README.txt inside) and a CONTRIBUTION.md uploaded loose are notes, never matches', () => {
  const old = makeZip([{ name: 'README.txt', bytes: 'Put these files in the "inbox" folder...' }, { name: 'fox.mat', bytes: bytes(FOX) }]);
  const r = inbox({ 'old.zip': old }).review();
  assert.deepEqual([r.summary.groups, r.summary.error, r.rights], [1, 0, false]);
  const loose = inbox({ 'fox.mat': bytes(FOX), 'CONTRIBUTION.md': `# x\n\n${cm.rightsLine('CC0-1.0')}\n` }).review();
  assert.deepEqual([loose.summary.groups, loose.rights], [1, true]);
});

// ------------------------------------------------------------------------------------------------ ingest

test('ingest: a dry run reads the ZIP in place; the real ingest unpacks it, files the matches, and leaves only the inbox\'s README', () => {
  const w = inbox({ 'matches-for-bgdb.zip': pageZip([FOX, `${CH}.txt`, `${CH}.sgf`]), 'broken.zip': new TextEncoder().encode('nope') });
  const dry = ingest({ inbox: w.a('inbox'), data: w.a('data'), config, contributor: 't', submittedAt: '2026-10-07', dryRun: true });
  assert.deepEqual([dry.added, dry.errors], [2, 1]);
  assert.ok(fs.existsSync(w.a('inbox/matches-for-bgdb.zip')), 'a dry run changes nothing');
  const r = ingest({ inbox: w.a('inbox'), data: w.a('data'), config, contributor: 't', submittedAt: '2026-10-07' });
  assert.deepEqual([r.added, r.errors], [2, 1]);
  assert.match(r.results.find((x) => x.status === 'error').errors[0].message, /broken\.zip cannot be read/);
  assert.equal(r.results.filter((x) => x.status === 'added').reduce((n, x) => n + (x.attachments?.length ?? 0), 0), 1, 'the SGF went with its match');
  assert.deepEqual(fs.readdirSync(w.a('inbox')).sort(), ['README.md', 'broken.zip'], 'the archive, its folder and its note are gone; what cannot be read stays');
  const again = ingest({ inbox: w.a('inbox'), data: w.a('data'), config, contributor: 't', submittedAt: '2026-10-07' });
  assert.equal(again.added, 0);
});
