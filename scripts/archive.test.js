import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runStep, parseArgs, layout, commandLines } from './archive.mjs';
import { FIXTURES } from '../packages/core/test/helpers.js';

const FILES = ['xg-text/me-XG_Roller__03-10-2026.txt', 'xg-text/me-XG_Roller__03-10-2026__2.txt', 'extmatchdb/galaxy-resign-without-marker_7pt.txt'];

async function step(dir, name, extra = {}) {
  const lines = [];
  const code = await runStep({ dir, step: name, out: (s) => lines.push(s), ...extra });
  return { code, text: lines.join('\n') };
}

test('archive steps: init, dry-run, review, apply, ingest (compared with the dry run), build, status, reset', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-archive-'));
  const L = layout(dir);
  assert.match((await step(dir, 'dry-run', { contributor: 'tester' })).text, /run the step "init" first/);

  let r = await step(dir, 'init', { contributor: 'tester' });
  assert.match(r.text, /Put the archive in source\//);
  for (const f of FILES) fs.copyFileSync(path.join(FIXTURES, f), path.join(L.source, path.basename(f)));
  r = await step(dir, 'init');
  assert.match(r.text, /copied 3 file\(s\) from source\/ to inbox\/[\s\S]*contributor: tester/, 'the contributor is remembered');

  r = await step(dir, 'dry-run');
  assert.equal(r.code, 0);
  assert.match(r.text, /3 added, 0 enriched, 0 duplicate\(s\), 0 with errors/);
  assert.match(fs.readFileSync(L.dryLog, 'utf8'), /3 added/, 'the output is also in the log');
  assert.match(r.text, /Next: .* review/);

  r = await step(dir, 'review');
  assert.equal(r.code, 0);
  assert.ok(fs.existsSync(L.sheet));
  r = await step(dir, 'apply');
  assert.equal(r.code, 0);
  assert.match(r.text, /What is left:/);
  assert.ok(fs.existsSync(L.left));

  r = await step(dir, 'ingest');
  assert.equal(r.code, 0);
  assert.match(r.text, /Same counts as the dry run\./);
  assert.match(fs.readFileSync(L.ingestLog, 'utf8'), /3 added/);
  assert.equal(fs.readdirSync(L.inbox).filter((f) => f.endsWith('.txt')).length, 0, 'the ingest emptied the inbox');

  r = await step(dir, 'build');
  assert.equal(r.code, 0, r.text);
  assert.ok(fs.existsSync(path.join(L.dist, 'registry.json')));
  assert.ok(fs.existsSync(path.join(L.dist, 'index.html')), 'the site of the repository is copied');
  assert.match((await step(dir, 'status')).text, /dist\/ built[\s\S]*Next: .* serve/);

  r = await step(dir, 'reset');
  assert.equal(r.code, 1, 'reset asks for --yes');
  assert.ok(fs.existsSync(L.dist), 'nothing erased without --yes');
  r = await step(dir, 'reset', { yes: true });
  assert.equal(r.code, 0);
  assert.deepEqual([fs.existsSync(L.dist), fs.existsSync(L.sheet), fs.existsSync(L.dryLog), fs.readdirSync(L.data).length, fs.readdirSync(L.inbox).length], [false, false, false, 0, 3]);
  assert.equal(fs.readdirSync(L.source).length, 3, 'source/ is never touched');
  assert.match((await step(dir, 'status')).text, /dry run: not run[\s\S]*Next: .* dry-run/);
});

test('archive: the plain commands with the folder filled in; options', () => {
  const L = layout('/w');
  const lines = commandLines(L, 'me').map(([, l]) => l).join('\n');
  assert.match(lines, /ingest --inbox \/w\/inbox --data \/w\/data --salvage --contributor me --dry-run 2>&1 \| tee \/w\/dry-run\.log/);
  assert.match(lines, /build --data \/w\/data --out \/w\/dist/);
  assert.deepEqual(parseArgs(['/w', 'reset', '--yes', '--contributor', 'me']), { dir: '/w', step: 'reset', yes: true, contributor: 'me' });
});
