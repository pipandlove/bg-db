import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { readMatch, readMatchBytes, contentHash, isXg, inflateZlib, inflateRaw } from '../src/index.js';
import { FIXTURES } from './helpers.js';

const bytes = (rel) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, rel)));
const text = (rel) => fs.readFileSync(path.join(FIXTURES, rel), 'utf8');

// every .xg fixture that has a text export of the same match: the binary file must give the very same match
const TWINS = {
  'me-XG_Roller__03-10-2026': 'xg-text/me-XG_Roller__03-10-2026.txt',
  'me-XG_Roller__03-10-2026__2': 'xg-text/me-XG_Roller__03-10-2026__2.txt',
  'me-XG_Roller__03-10-2026__3': 'xg-text/me-XG_Roller__03-10-2026__3.txt',
  'tester_vs_jackdaw1_2026-08-18': 'foxamon/tester_vs_jackdaw1_2026-08-18.mat',
  'tester_vs_Osprey12_2026-08-10': 'foxamon/tester_vs_Osprey12_2026-08-10.mat',
  'Sir_Plover_vs_tester_2026-08-03': 'opengammon/Sir_Plover_vs_tester_2026-08-03.mat',
  'toucanBG_vs_tester_2026-08-04': 'opengammon/toucanBG_vs_tester_2026-08-04.mat',
  '2026-01-20T15-36-47-bluetailedgrebe1-tester': 'gnubg-sgf/2026-01-20T15-36-47-bluetailedgrebe1-tester.sgf',
  '2026-01-22T18-31-58-avocet-tester': 'gnubg-sgf/2026-01-22T18-31-58-avocet-tester.sgf',
  'KR-TL_2026-10-08_jacoby-on': 'xg-text/KR-TL_2026-10-08_jacoby-on.txt',
  'KR-TL_2026-10-08_jacoby-off': 'xg-text/KR-TL_2026-10-08_jacoby-off.txt',
  'KR-TL_2026-10-08_resign-gammon': 'xg-text/KR-TL_2026-10-08_resign-gammon.txt',
};

for (const [name, twin] of Object.entries(TWINS)) {
  test(`xg: ${name} is the same match as its text twin (same identity, same games)`, () => {
    const x = readMatchBytes(bytes(`xg-binary/${name}.xg`));
    assert.equal(x.ok, true, JSON.stringify(x.errors));
    assert.equal(x.format, 'xg');
    const t = readMatch(text(twin));
    assert.equal(contentHash(x.match), contentHash(t.match));
    assert.deepEqual(x.match.games.map((g) => g.result.points), t.match.games.map((g) => g.result.points));
    assert.equal(x.match.provenance.analysis.present, true, 'these fixtures were analysed');
  });
}

test('xg: header fields (names, length, date, time, site) are read', () => {
  const r = readMatchBytes(bytes('xg-binary/tester_vs_jackdaw1_2026-08-18.xg'));
  assert.deepEqual(r.match.sides.map((s) => s.name), ['tester', 'jackdaw1']);
  assert.equal(r.match.matchLength, 5);
  assert.deepEqual([r.match.date, r.match.time], ['2026-08-18', '22:52']);
  assert.equal(r.match.provenance.site, 'Foxamon');
  const money = readMatchBytes(bytes('xg-binary/me-XG_Roller__03-10-2026.xg'));
  assert.equal(money.match.matchLength, 0);
  assert.equal(money.match.rules.jacoby, true);
});

test('xg: a bear-off with a bigger die than needed is stored as "from - die" (down to -6), not -1', () => {
  const r = readMatchBytes(bytes('xg-binary/KR-TL_2026-10-08_jacoby-on.xg'));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.ok(r.match.games[0].actions.some((a) => a.kind === 'move' && a.moves.some((m) => m.to === 0 && m.from < Math.max(...a.dice))));
});

test('money games and the Jacoby rule: a backgammon with the cube in the middle counts 1 with Jacoby, 3 without; a resigned gammon counts what was resigned', () => {
  for (const ext of ['xg-binary/KR-TL_2026-10-08_%.xg', 'xg-text/KR-TL_2026-10-08_%.txt']) {
    const game = (n) => {
      const f = ext.replace('%', n);
      const r = f.endsWith('.xg') ? readMatchBytes(bytes(f)) : readMatch(fs.readFileSync(path.join(FIXTURES, f), 'utf8'));
      assert.equal(r.ok, true, f);
      return [r.match.rules.jacoby, r.match.games[0].result, r.match.result.score];
    };
    assert.deepEqual(game('jacoby-on'), [true, { winner: 0, points: 1, kind: 'single', how: 'bearOff', cube: 1 }, [1, 0]], 'Jacoby: a backgammon with an unturned cube is a single game');
    assert.deepEqual(game('jacoby-off'), [false, { winner: 0, points: 3, kind: 'backgammon', how: 'bearOff', cube: 1 }, [3, 0]]);
    assert.deepEqual(game('resign-gammon'), [false, { winner: 0, points: 2, kind: 'single', how: 'resign', cube: 1 }, [2, 0]]);
  }
});

test('xg: a file saved in the middle of a game is refused with a sentence and a way out', () => {
  const r = readMatchBytes(bytes('invalid/xg-saved-in-the-middle-of-a-game.xg'));
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'V-FORMAT');
  assert.match(r.errors[0].message, /has no end/);
});

test('xg: damaged files give a V-FORMAT error, never an exception', () => {
  const good = bytes('xg-binary/me-XG_Roller__03-10-2026.xg');
  assert.equal(isXg(good), true);
  for (const cut of [8, 100, 5000, 16359, 20000, good.length - 3000]) {
    const r = readMatchBytes(good.subarray(0, cut));
    assert.equal(r.ok, false, `truncated at ${cut}`);
    assert.equal(r.errors[0].code, 'V-FORMAT');
  }
  const flipped = good.slice(); for (let i = 17000; i < 17040; i++) flipped[i] ^= 0xff;
  assert.equal(readMatchBytes(flipped).ok, false);
  assert.equal(readMatchBytes(new Uint8Array([0x52, 0x47, 0x4d, 0x48, 1, 0, 0, 0])).ok, false);
});

test('xg: bytes of a text file go through the text readers', () => {
  const r = readMatchBytes(new TextEncoder().encode(text('xg-text/me-XG_Roller__03-10-2026.txt')));
  assert.equal(r.ok, true);
  assert.equal(r.format, 'mat');
});

test('inflate: identical to node:zlib on synthetic data of every size and level, and reports where the stream ends', () => {
  for (const n of [0, 1, 5, 100, 1000, 70000]) for (const level of [0, 1, 6, 9]) {
    for (const src of [crypto.randomBytes(n), Buffer.from('backgammon '.repeat((n / 3) | 0))]) {
      const z = zlib.deflateSync(src, { level });
      const r = inflateZlib(new Uint8Array(z));
      assert.equal(Buffer.compare(Buffer.from(r.out), src), 0, `size ${n} level ${level}`);
      assert.equal(r.end, z.length);
    }
  }
  assert.throws(() => inflateZlib(new Uint8Array([1, 2, 3, 4])), /not a zlib stream/);
  assert.throws(() => inflateRaw(new Uint8Array([0xff, 0xff])), /damaged/);
});
