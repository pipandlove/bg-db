import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeText, readMatchBytes, matchHash16 } from '../src/index.js';
import { read } from './helpers.js';

/** Windows-1252 bytes of a string made of characters that encoding has (Latin-1, plus the curly quotes and dashes of 0x80-0x9F) */
const CP1252_EXTRA = { '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97 };
const cp1252 = (s) => Uint8Array.from([...s].map((c) => CP1252_EXTRA[c] ?? c.charCodeAt(0)));

test('decodeText: UTF-8, Windows-1252 and UTF-16 with a byte order mark', () => {
  assert.deepEqual(decodeText(new TextEncoder().encode('Sürmeyan')), { text: 'Sürmeyan', encoding: 'utf-8' });
  assert.deepEqual(decodeText(cp1252('Sürmeyan – ‘Rome’')), { text: 'Sürmeyan – ‘Rome’', encoding: 'windows-1252' });
  const le = Uint8Array.from([0xff, 0xfe, ...[...'Grandell'].flatMap((c) => [c.charCodeAt(0), 0])]);
  assert.deepEqual(decodeText(le), { text: 'Grandell', encoding: 'utf-16le' });
  assert.equal(decodeText(Uint8Array.from([0xef, 0xbb, 0xbf, 0x41])).encoding, 'utf-8', 'a UTF-8 byte order mark');
});

test('a match file in Windows-1252: the names are read right, the identity does not change, and the file says how it was read', () => {
  const text = read('extmatchdb/galaxy-resign-without-marker_7pt.txt').replace(/Dale Henderson/g, 'Dale Hündérson');
  const utf8 = readMatchBytes(new TextEncoder().encode(text));
  const latin = readMatchBytes(cp1252(text));
  assert.equal(latin.ok, true, JSON.stringify(latin.errors));
  assert.ok(latin.match.sides.some((s) => s.name === 'Dale Hündérson'), JSON.stringify(latin.match.sides));
  assert.equal(matchHash16(latin.match), matchHash16(utf8.match));
  assert.equal(latin.encoding, 'windows-1252');
  assert.ok(latin.infos.some((d) => /not UTF-8: it was read as Windows-1252/.test(d.message)));
  assert.equal(utf8.encoding, undefined, 'nothing to say for a UTF-8 file');
  const le = Uint8Array.from([0xff, 0xfe, ...[...text].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]);
  assert.equal(matchHash16(readMatchBytes(le).match), matchHash16(utf8.match), 'UTF-16');
});
