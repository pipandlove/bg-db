/**
 * Player pseudonyms (decision 0025): the key, the names it gives, and the rewriting of .mat, .sgf and .xg files. The identity of a match
 * never changes, and the old names must be gone from every byte that is sent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURES } from './helpers.js';
import {
  hmacSha256, pseudonym, namer, isPseudonym, newKey, keyFileText, parseKey, keyFingerprint, WORDS,
  pseudonymizeMatch, rewriteSgf, rewriteXg, writeMat, readMatch, readMatchBytes, contentHash,
} from '../src/index.js';

const KEY = new Uint8Array(32).fill(7);
const OTHER = new Uint8Array(32).fill(8);
const hex = (b) => Buffer.from(b).toString('hex');
const has = (bytes, s) => Buffer.from(bytes).includes(Buffer.from(s, 'latin1')) || Buffer.from(bytes).includes(Buffer.from(s, 'utf16le'));

test('HMAC-SHA-256 matches RFC 4231 (test case 2)', () => {
  const mac = hmacSha256(new TextEncoder().encode('Jefe'), new TextEncoder().encode('what do ya want for nothing?'));
  assert.equal(hex(mac), '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
});

test('a pseudonym: stable for one key, different with another, the same for the same handle written differently', () => {
  assert.equal(WORDS.adjectives.length, 64);
  assert.equal(WORDS.animals.length, 64);
  assert.equal(new Set(WORDS.adjectives).size, 64);
  assert.equal(new Set(WORDS.animals).size, 64);
  const a = pseudonym(KEY, 'Sir_Plover');
  assert.match(a, /^[a-z]+-[a-z]+-[0-9a-f]{4}$/);
  assert.ok(isPseudonym(a));
  assert.ok(isPseudonym(`anon-${a}`), 'the names of the first release (tools v11) had the prefix "anon-"');
  assert.ok(!isPseudonym('blue-sky-12ab'), 'words outside the lists: a handle that looks like a pseudonym');
  assert.ok(!isPseudonym('Hadar'));
  assert.equal(pseudonym(KEY, 'Sir_Plover'), a, 'stable');
  assert.equal(pseudonym(KEY, ' sir_plover '), a, 'normalised as for search');
  assert.notEqual(pseudonym(OTHER, 'Sir_Plover'), a, 'another key, another name');
  assert.notEqual(pseudonym(KEY, 'tester'), a);
  const n = namer(KEY);
  assert.equal(n('Sir_Plover'), a);
  assert.equal(n(a), a, 'a name that is already a pseudonym is kept (a match sent again)');
  assert.equal(n(null), null);
});

test('the key file reads back, and a fingerprint names the key without showing it', () => {
  const k = newKey();
  assert.equal(k.length, 32);
  const text = keyFileText(k);
  assert.match(text, /^bgdb-key-1:[0-9a-f]{64}$/m);
  assert.deepEqual(parseKey(text), k);
  assert.deepEqual(parseKey(hex(k)), k, 'the 64 characters alone');
  assert.equal(parseKey('hello'), null);
  assert.equal(keyFingerprint(k).length, 8);
});

test('a text match: names replaced, the platform, the time, the event, the ratings and the remarks left out, the identity unchanged', () => {
  const file = path.join(FIXTURES, 'opengammon', 'Sir_Plover_vs_tester_2026-08-03.mat');
  const r = readMatch(fs.readFileSync(file, 'utf8'));
  assert.ok(r.ok);
  const text = writeMat(pseudonymizeMatch(r.match, namer(KEY)));
  const back = readMatch(text);
  assert.ok(back.ok, JSON.stringify(back.errors));
  assert.equal(contentHash(back.match), contentHash(r.match));
  assert.deepEqual(back.match.sides.map((s) => s.name), [pseudonym(KEY, r.match.sides[0].name), pseudonym(KEY, r.match.sides[1].name)]);
  assert.equal(back.match.date, r.match.date);
  for (const gone of ['Sir_Plover', 'tester', 'OpenGammon', 'EventTime', 'Event "', 'Remark', 'Match ID']) assert.ok(!text.includes(gone), gone);
});

test('an SGF file: names replaced, platform, place and event dropped, analysis kept, the identity unchanged', () => {
  for (const f of ['gnubg-sgf/2026-01-20T15-36-47-bluetailedgrebe1-tester.sgf', 'choue-net/chouehandle-vs-Bot-all-games-s4020-2026-10-04.sgf']) {
    const t = fs.readFileSync(path.join(FIXTURES, f), 'utf8');
    const a = readMatch(t);
    const out = rewriteSgf(t, namer(KEY));
    const b = readMatch(out);
    assert.ok(b.ok, f);
    assert.equal(contentHash(b.match), contentHash(a.match), f);
    assert.deepEqual(b.match.sides.map((s) => s.name), a.match.sides.map((s) => pseudonym(KEY, s.name)), f);
    assert.deepEqual(b.match.provenance.analysis?.present, a.match.provenance.analysis?.present, `${f}: the analysis stays`);
    for (const gone of [...a.match.sides.map((s) => s.name), 'backgammonhub', 'choue.net', 'Online match']) assert.ok(!out.includes(gone), `${f}: ${gone}`);
  }
});

test('an XG file: names replaced in every field, platform and time gone, the same match, the same pseudonyms as its SGF twin', async () => {
  const dir = path.join(FIXTURES, 'xg-binary');
  const nameOf = namer(KEY);
  for (const f of fs.readdirSync(dir)) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(dir, f)));
    const a = readMatchBytes(bytes);
    const out = await rewriteXg(bytes, nameOf);
    const b = readMatchBytes(out);
    assert.ok(b.ok, f);
    assert.equal(contentHash(b.match), contentHash(a.match), f);
    assert.deepEqual(b.match.sides.map((s) => s.name), a.match.sides.map((s) => nameOf(s.name)), f);
    assert.equal(b.match.provenance.site, null, `${f}: no platform`);
    assert.equal(b.match.time, '00:00', `${f}: the time of day is gone`);
    assert.equal(b.match.date, a.match.date, `${f}: the date stays`);
    for (const gone of [...a.match.sides.map((s) => s.name).filter((s) => s.length >= 3), ...(a.match.provenance.site && !/gammon$/i.test(a.match.provenance.site) ? [a.match.provenance.site] : []), 'Played on']) {
      assert.ok(!has(out.subarray(0, 8232), gone), `${f}: "${gone}" left in the header`);
    }
  }
  // the end of an older, longer name that XG leaves behind a player's name is cleared with the field
  const twin = new Uint8Array(fs.readFileSync(path.join(dir, '2026-01-20T15-36-47-bluetailedgrebe1-tester.xg')));
  const out = await rewriteXg(twin, nameOf);
  const { inflateZlib } = await import('../src/inflate.js');
  const streams = [];
  for (let o = 8232; o < out.length - 2; o++) if (out[o] === 0x78 && out[o + 1] === 0x9c) { try { streams.push(inflateZlib(out, o).out); } catch { /* not a stream */ } }
  assert.ok(streams.length >= 2);
  for (const s of streams) assert.ok(!has(s, 'kittiwake'), 'the leftover handle is gone');
  // the same player in the XG and the SGF of the same match
  const sgf = readMatch(rewriteSgf(fs.readFileSync(path.join(FIXTURES, 'gnubg-sgf/2026-01-20T15-36-47-bluetailedgrebe1-tester.sgf'), 'utf8'), nameOf));
  assert.deepEqual(new Set(readMatchBytes(out).match.sides.map((s) => s.name)), new Set(sgf.match.sides.map((s) => s.name)));
});

test('an XG file that is not an archive of the known layout is refused, never sent half-rewritten', async () => {
  const bytes = new Uint8Array(fs.readFileSync(path.join(FIXTURES, 'xg-binary', 'tester_vs_jackdaw1_2026-08-18.xg')));
  const damaged = bytes.slice();
  damaged[damaged.length - 100] ^= 0xff;
  await assert.rejects(() => rewriteXg(damaged, namer(KEY)), /checksum|damaged|not/);
  await assert.rejects(() => rewriteXg(new TextEncoder().encode('RGMH but nothing else'), namer(KEY)), /not an eXtreme Gammon file/);
});
