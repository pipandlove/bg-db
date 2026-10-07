import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, COMMANDS, progressBar } from '../src/cli.js';
import { FIXTURES } from '../../core/test/helpers.js';

const capture = () => { const lines = []; return { lines, io: { out: (s) => lines.push(s), err: (s) => lines.push(s) } }; };

test('check on a valid file prints the identifier and exits 0', async () => {
  const { lines, io } = capture();
  const code = await main(['check', path.join(FIXTURES, 'opengammon/vireo_vs_tester_2026-09-30.mat')], io);
  assert.equal(code, 0);
  assert.match(lines.join('\n'), /^OK\s+[0-9a-f]{16}\s+vireo vs tester\s+5pt/);
});

test('check on the fixture folder: every real match is valid', async () => {
  const { lines, io } = capture();
  const code = await main(['check', FIXTURES, '--recursive'], io);
  assert.equal(code, 0);
  assert.match(lines.join('\n'), /(\d+) file\(s\) checked, \1 valid, 0 with errors/);
});

test('check on a damaged file explains the problem and exits 1', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-'));
  const file = path.join(dir, 'broken.mat');
  fs.writeFileSync(file, fs.readFileSync(path.join(FIXTURES, 'opengammon/vireo_vs_tester_2026-09-30.mat'), 'utf8').replace('52: 24/22 13/8', '52: 24/22 13/7'));
  const { lines, io } = capture();
  assert.equal(await main(['check', file], io), 1);
  const text = lines.join('\n');
  assert.match(text, /V-LEGAL line \d+/);
  assert.match(text, /how to fix/);
});

test('check --json gives machine-readable reports', async () => {
  const { lines, io } = capture();
  await main(['check', path.join(FIXTURES, 'gnubg-sgf'), '--json'], io);
  const reports = JSON.parse(lines[0]);
  assert.equal(reports.length, 2);
  assert.ok(reports.every((r) => r.ok && r.id.length === 16));
});

test('no arguments prints usage', async () => {
  const { lines, io } = capture();
  assert.equal(await main(['check'], io), 2);
  assert.match(lines[0], /Usage/);
});

test('help lists every command and each command answers --help', async () => {
  const { lines, io } = capture();
  assert.equal(await main(['help'], io), 0);
  for (const name of Object.keys(COMMANDS)) {
    assert.ok(lines.join('\n').includes(name), `help mentions ${name}`);
    const one = capture();
    assert.equal(await main([name, '--help'], one.io), 0);
    assert.ok(one.lines[0].startsWith(`bgdb ${name}`), `${name} --help starts with its usage`);
  }
  const bad = capture();
  assert.equal(await main(['frobnicate'], bad.io), 2);
  assert.match(bad.lines.join('\n'), /Unknown command "frobnicate"/);
});

test('docs/commands.md documents every command (with its usage line) and every option', async () => {
  const doc = fs.readFileSync(path.join(FIXTURES, '../docs/commands.md'), 'utf8');
  for (const [name, c] of Object.entries(COMMANDS)) {
    assert.ok(doc.includes(`## bgdb ${name}`), `docs/commands.md has a section for ${name}`);
    assert.ok(doc.includes(c.usage), `docs/commands.md quotes the usage of ${name}`);
    for (const opt of c.usage.match(/--[a-z-]+/g) ?? []) assert.ok(doc.includes(opt), `docs/commands.md mentions ${opt}`);
  }
});

test('anonymize: dry run reports, --check fails when work remains, --write rewrites, .xg files are skipped', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-anon-'));
  const f = path.join(dir, 'a.mat');
  fs.writeFileSync(f, fs.readFileSync(path.join(FIXTURES, 'opengammon/vireo_vs_tester_2026-09-30.mat'), 'utf8').replace('"anonymized"', '"5g0afPBLdtDv4sss"'));
  fs.writeFileSync(path.join(dir, 'b.xg'), 'RGMH');
  const dry = capture();
  assert.equal(await main(['anonymize', dir], dry.io), 0);
  assert.match(dry.lines.join('\n'), /would change .*a\.mat .*5g0afPBLdtDv4sss/);
  assert.match(dry.lines.join('\n'), /skipped .*b\.xg/);
  assert.ok(fs.readFileSync(f, 'utf8').includes('5g0afPBLdtDv4sss'), 'dry run wrote nothing');
  assert.equal(await main(['anonymize', dir, '--check'], capture().io), 1);
  assert.equal(await main(['anonymize', dir, '--write'], capture().io), 0);
  assert.ok(!fs.readFileSync(f, 'utf8').includes('5g0afPBLdtDv4sss'));
  assert.equal(await main(['anonymize', dir, '--check'], capture().io), 0);
});

test('anonymize keeps every other byte of the file: a Windows-1252 file stays Windows-1252, a UTF-8 file stays UTF-8', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-anon-enc-'));
  const text = fs.readFileSync(path.join(FIXTURES, 'opengammon/vireo_vs_tester_2026-09-30.mat'), 'utf8').replace('"anonymized"', '"5g0afPBLdtDv4sss"');
  const latin = Buffer.from(text.replace(/vireo/g, 'vir\u00e9o'), 'latin1');           // é as the single byte 0xE9
  const utf8 = Buffer.from(text.replace(/vireo/g, 'vir\u00e9o'), 'utf8');               // é as 0xC3 0xA9
  fs.writeFileSync(path.join(dir, 'l.mat'), latin);
  fs.writeFileSync(path.join(dir, 'u.mat'), utf8);
  assert.equal(await main(['anonymize', dir, '--write'], capture().io), 0);
  const swap = (b) => Buffer.from(b.toString('latin1').replace('5g0afPBLdtDv4sss', 'anonymized'), 'latin1');
  assert.deepEqual(fs.readFileSync(path.join(dir, 'l.mat')), swap(latin));
  assert.deepEqual(fs.readFileSync(path.join(dir, 'u.mat')), swap(utf8));
});

test('build shows an ASCII progress bar: redrawn in place on a terminal, as lines elsewhere', async () => {
  assert.equal(progressBar(0, 4, 8), '[........]   0%  0/4');
  assert.equal(progressBar(3, 4, 8), '[######..]  75%  3/4');
  assert.equal(progressBar(4, 4, 8), '[########] 100%  4/4');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-bar-'));
  const inbox = path.join(dir, 'inbox');
  fs.mkdirSync(inbox);
  for (const f of ['opengammon/vireo_vs_tester_2026-09-30.mat']) fs.copyFileSync(path.join(FIXTURES, f), path.join(inbox, path.basename(f)));
  assert.equal(await main(['ingest', '--inbox', inbox, '--data', path.join(dir, 'data'), '--contributor', 'test'], capture().io), 0);
  const args = ['build', '--data', path.join(dir, 'data'), '--out', path.join(dir, 'dist')];
  const plain = capture();
  assert.equal(await main(args, plain.io), 0);
  assert.ok(plain.lines.includes('shard 0001 [##############################] 100%  1/1 matches checked'), plain.lines.join('\n'));
  const tty = capture();
  const written = [];
  assert.equal(await main(args, { ...tty.io, write: (s) => written.push(s) }), 0);
  assert.deepEqual(written, ['\rshard 0001 [##############################] 100%  1/1 matches checked\n']);
  assert.ok(!tty.lines.some((l) => l.includes('matches checked')), 'the bar is not also printed as a line');
});
