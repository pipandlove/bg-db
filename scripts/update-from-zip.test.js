import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { main, plan, findSourceRoot } from './update-from-zip.mjs';

const write = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const capture = () => { const out = []; return { out, io: { out: (s) => out.push(s), err: (s) => out.push(s) } }; };

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
  const repo = path.join(tmp, 'repo');
  const src = path.join(tmp, 'zip', 'bgdb');            // zip with a top-level folder
  for (const r of [repo, src]) write(r, 'package.json', '{"name":"bgdb"}');
  write(repo, 'a.js', 'old\n'); write(src, 'a.js', 'new\n');
  write(repo, 'same.js', 'x\r\ny\r\n'); write(src, 'same.js', 'x\ny\n');       // only line endings differ
  write(src, 'added/b.js', 'b\n');
  write(repo, 'gone.js', 'bye\n');
  write(repo, 'data/0001/m.mat', 'MY MATCH\n'); write(src, 'data/0001/m.mat', 'placeholder\n');
  write(src, 'data/0001/shard.json', '{}\n');
  write(repo, 'inbox/mine.mat', 'mine\n');
  write(repo, 'node_modules/x/index.js', 'dep\n');
  write(repo, 'keep/local.txt', 'local\n'); write(src, 'keep/local.txt', 'upstream\n');
  write(repo, '.updateignore', '# my files\nkeep/\n');
  return { tmp, repo, src, zipTop: path.join(tmp, 'zip') };
}

test('plan: classifies files, ignores line endings, protects data/, inbox/ and .updateignore', () => {
  const { repo, src } = setup();
  const p = plan(src, repo);
  assert.deepEqual(p.add, ['added/b.js', 'data/0001/shard.json']);
  assert.deepEqual(p.change, ['a.js']);
  assert.ok(p.same.includes('same.js'));
  assert.deepEqual(p.remove, ['gone.js']);
  assert.ok(p.keptLocal.includes('data/0001/m.mat') && p.keptLocal.includes('inbox/mine.mat'));
  assert.ok(p.ignored.includes('keep/local.txt'));
});

test('dry run writes nothing', () => {
  const { repo, zipTop } = setup();
  const { io, out } = capture();
  assert.equal(main([zipTop, '--repo', repo], io), 0);
  assert.equal(read(repo, 'a.js'), 'old\n');
  assert.match(out.join('\n'), /DRY RUN/);
});

test('apply copies new and changed files, keeps the rest, finds the top-level folder of the zip', () => {
  const { repo, zipTop, src } = setup();
  assert.equal(findSourceRoot(zipTop), src);
  assert.equal(main([zipTop, '--repo', repo, '--apply']), 0);
  assert.equal(read(repo, 'a.js'), 'new\n');
  assert.equal(read(repo, 'added/b.js'), 'b\n');
  assert.equal(read(repo, 'gone.js'), 'bye\n', 'not deleted without --delete');
  assert.equal(read(repo, 'data/0001/m.mat'), 'MY MATCH\n', 'user data never overwritten');
  assert.equal(read(repo, 'data/0001/shard.json'), '{}\n', 'missing data files are added');
  assert.equal(read(repo, 'keep/local.txt'), 'local\n');
  assert.ok(fs.existsSync(path.join(repo, 'node_modules/x/index.js')));
});

test('--delete removes files that disappeared upstream, but never data/ or inbox/', () => {
  const { repo, zipTop } = setup();
  main([zipTop, '--repo', repo, '--apply', '--delete']);
  assert.ok(!fs.existsSync(path.join(repo, 'gone.js')));
  assert.ok(fs.existsSync(path.join(repo, 'inbox/mine.mat')));
  assert.ok(fs.existsSync(path.join(repo, 'data/0001/m.mat')));
});

test('refuses a different project and a non-project folder', () => {
  const { repo, zipTop, src } = setup();
  write(src, 'package.json', '{"name":"other"}');
  const { io, out } = capture();
  assert.equal(main([zipTop, '--repo', repo, '--apply'], io), 2);
  assert.match(out.join('\n'), /Wrong folder/);
  assert.equal(main([os.tmpdir() + '/does-not-exist', '--repo', repo], capture().io), 2);
});

test('with git: a dirty working tree blocks --apply unless --force', (t) => {
  const { repo, zipTop } = setup();
  try {
    const g = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: repo, stdio: 'ignore' });
    g('init'); g('add', '-A'); g('commit', '-m', 'init');
    write(repo, 'dirty.txt', 'uncommitted\n');
  } catch { t.skip('git not available'); return; }
  const { io, out } = capture();
  assert.equal(main([zipTop, '--repo', repo, '--apply'], io), 3);
  assert.match(out.join('\n'), /uncommitted changes/);
  assert.equal(read(repo, 'a.js'), 'old\n');
  assert.equal(main([zipTop, '--repo', repo, '--apply', '--force'], capture().io), 0);
  assert.equal(read(repo, 'a.js'), 'new\n');
});
