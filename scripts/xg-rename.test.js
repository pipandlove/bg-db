import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rewriteXg, leftovers, main } from './xg-rename.mjs';
import { parseXg, validateMatch, contentHash } from '../packages/core/src/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const XG = path.join(REPO, 'fixtures/xg-binary/Sir_Plover_vs_tester_2026-08-03.xg');
const PAIRS = [['tester', 'abcdef'], ['Sir_Plover', 'Mr_Example']];
const capture = () => { const out = []; return { out, io: { out: (s) => out.push(s), err: (s) => out.push(s) } }; };
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xgr-'));

test('rewriteXg: the names change everywhere, the match and its identity do not, and the result is a valid archive', () => {
  const orig = fs.readFileSync(XG);
  const { bytes, replaced } = rewriteXg(orig, PAIRS);
  assert.ok(replaced >= 6, `${replaced} replaced`);
  const a = parseXg(orig);
  const b = parseXg(bytes);
  assert.deepEqual(b.sides.map((s) => s.name), ['abcdef', 'Mr_Example']);
  assert.equal(contentHash(validateMatch(b).match), contentHash(validateMatch(a).match));
  assert.deepEqual(leftovers(bytes, PAIRS.map(([x]) => x)), []);
  assert.deepEqual(leftovers(orig, PAIRS.map(([x]) => x)).length > 0, true, 'the check does see names');
  assert.equal(rewriteXg(bytes, []).replaced, 0, 'sizes and CRCs of the rewritten file check out when read again');
});

test('rewriteXg: a pseudonym of another length or a damaged file is refused', () => {
  assert.throws(() => rewriteXg(fs.readFileSync(XG), [['tester', 'abc']]), /same length/);
  const broken = Buffer.from(fs.readFileSync(XG));
  broken[broken.length - 100] ^= 0xff;
  assert.throws(() => rewriteXg(broken, PAIRS), /CRC/);
});

test('main: dry run by default, --write rewrites, and a mapping inside the repository is refused', () => {
  const dir = tmpDir();
  const xg = path.join(dir, 'm.xg');
  fs.copyFileSync(XG, xg);
  const map = path.join(dir, 'names.json');
  fs.writeFileSync(map, JSON.stringify(Object.fromEntries(PAIRS)));

  let c = capture();
  assert.equal(main(['--map', map, xg], c.io), 0);
  assert.match(c.out.join('\n'), /WOULD .* name\(s\)[\s\S]*Dry run/);
  assert.deepEqual(fs.readFileSync(xg), fs.readFileSync(XG));

  c = capture();
  assert.equal(main(['--map', map, xg, '--write'], c.io), 0);
  assert.deepEqual(parseXg(fs.readFileSync(xg)).sides.map((s) => s.name), ['abcdef', 'Mr_Example']);

  c = capture();
  assert.equal(main(['--map', map, xg], c.io, dir), 2, 'a mapping inside the repository');
  assert.match(c.out.join('\n'), /outside the repository/);
  assert.equal(main([xg], capture().io), 2, 'no mapping');
});
