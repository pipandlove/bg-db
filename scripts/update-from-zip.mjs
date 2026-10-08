#!/usr/bin/env node
/**
 * Update a local repository from a folder extracted from a new bgdb.zip.
 *
 *   node scripts/update-from-zip.mjs <extracted-folder> [--repo <dir>] [--apply] [--delete] [--force]
 *
 * Default is a DRY RUN: it lists what would change and writes nothing.
 *   --apply   copy new and changed files into the repository
 *   --delete  also remove files that no longer exist in the new version
 *   --force   proceed even if the git working tree has uncommitted changes
 *   --repo    the repository to update (default: the current directory)
 *
 * Safety rules
 *   - .git/ and node_modules/ are never touched.
 *   - data/ and inbox/ (your matches) are ADD-ONLY: missing files are added, existing files are never
 *     overwritten or deleted.
 *   - Paths listed in a file named .updateignore at the repo root (one prefix per line, '#' comments)
 *     are never touched at all.
 *   - With git, the working tree must be clean (commit or stash first), so that `git diff` shows exactly what
 *     the update changed and `git checkout .` undoes it.
 *   - Line endings are ignored when comparing text files (CRLF vs LF does not count as a change).
 * No dependencies; Node.js >= 18.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const SKIP_DIRS = new Set(['.git', 'node_modules']);
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db']);
const ADD_ONLY = ['data/', 'inbox/'];

function walk(root) {
  const out = new Map();
  const rec = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) rec(path.join(dir, e.name), `${rel}${e.name}/`);
      } else if (e.isFile() && !SKIP_FILES.has(e.name)) out.set(`${rel}${e.name}`, path.join(dir, e.name));
    }
  };
  rec(root, '');
  return out;
}

const isText = (buf) => !buf.subarray(0, 8000).includes(0);
const normalize = (buf) => (isText(buf) ? Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1') : buf);
const same = (a, b) => {
  const x = fs.readFileSync(a);
  const y = fs.readFileSync(b);
  return x.equals(y) || normalize(x).equals(normalize(y));
};

/** If the folder contains a single sub-folder that holds package.json (the zip's top-level folder), use it. */
export function findSourceRoot(dir) {
  if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
  const subs = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name));
  const hits = subs.filter((e) => fs.existsSync(path.join(dir, e.name, 'package.json')));
  return hits.length === 1 ? path.join(dir, hits[0].name) : null;
}

const pkgName = (dir) => {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name; } catch { return null; }
};

function readIgnore(repo) {
  const f = path.join(repo, '.updateignore');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

/** Compute the plan without touching anything. */
export function plan(srcRoot, repo) {
  const src = walk(srcRoot);
  const dst = walk(repo);
  const ignore = readIgnore(repo);
  const ignored = (rel) => ignore.some((p) => rel === p || rel.startsWith(p.endsWith('/') ? p : `${p}/`) || rel.startsWith(p));
  const addOnly = (rel) => ADD_ONLY.some((p) => rel.startsWith(p));
  const res = { add: [], change: [], same: [], remove: [], keptLocal: [], ignored: [], src, dst };

  for (const [rel, abs] of src) {
    if (ignored(rel)) { res.ignored.push(rel); continue; }
    if (!dst.has(rel)) res.add.push(rel);
    else if (same(abs, dst.get(rel))) res.same.push(rel);
    else if (addOnly(rel)) res.keptLocal.push(rel);
    else res.change.push(rel);
  }
  for (const rel of dst.keys()) {
    if (src.has(rel) || ignored(rel) || rel === '.updateignore') continue;  // your own settings file is never removed
    if (addOnly(rel)) res.keptLocal.push(rel);
    else res.remove.push(rel);
  }
  for (const k of ['add', 'change', 'remove', 'keptLocal', 'ignored']) res[k].sort();
  return res;
}

export function apply(p, srcRoot, repo, { del }) {
  for (const rel of [...p.add, ...p.change]) {
    const to = path.join(repo, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(p.src.get(rel), to);
    const mode = fs.statSync(p.src.get(rel)).mode;
    fs.chmodSync(to, mode);
  }
  if (del) {
    for (const rel of p.remove) {
      fs.rmSync(path.join(repo, rel));
      let d = path.dirname(path.join(repo, rel));
      while (d !== repo && fs.existsSync(d) && fs.readdirSync(d).length === 0) { fs.rmdirSync(d); d = path.dirname(d); }
    }
  }
}

function git(repo, ...args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function main(argv, io = { out: console.log, err: console.error }) {
  const flags = new Set(argv.filter((a) => a.startsWith('--') && a !== '--repo'));
  const ri = argv.indexOf('--repo');
  const repo = path.resolve(ri >= 0 ? argv[ri + 1] : '.');
  const pos = argv.filter((a, i) => !a.startsWith('--') && !(ri >= 0 && i === ri + 1));
  if (pos.length !== 1) {
    io.err('Usage: node scripts/update-from-zip.mjs <extracted-folder> [--repo <dir>] [--apply] [--delete] [--force]');
    return 2;
  }
  if (!fs.existsSync(pos[0]) || !fs.statSync(pos[0]).isDirectory()) { io.err(`Not a folder: ${pos[0]}\nExtract the zip first, then pass the extracted folder.`); return 2; }
  const srcRoot = findSourceRoot(path.resolve(pos[0]));
  if (!srcRoot) { io.err('Cannot find the project inside that folder (no package.json at its top level or in a single sub-folder).'); return 2; }
  if (path.resolve(srcRoot) === repo) { io.err('The source and the repository are the same folder.'); return 2; }
  if (!fs.existsSync(repo)) { io.err(`Repository folder not found: ${repo}`); return 2; }
  const a = pkgName(srcRoot);
  const b = pkgName(repo);
  if (b && a !== b) { io.err(`The extracted project is "${a}" but the repository is "${b}". Wrong folder?`); return 2; }

  const hasGit = fs.existsSync(path.join(repo, '.git'));
  if (hasGit && flags.has('--apply') && !flags.has('--force')) {
    try {
      const dirty = git(repo, 'status', '--porcelain').trim();
      if (dirty) {
        io.err('The git working tree has uncommitted changes:\n' + dirty.split('\n').slice(0, 10).map((l) => '  ' + l).join('\n') +
          '\nCommit or stash them first (so the update can be reviewed and undone), or re-run with --force.');
        return 3;
      }
    } catch { io.err('Warning: git is not available; cannot check the working tree.'); }
  }

  const p = plan(srcRoot, repo);
  const list = (title, arr, max = 40) => {
    if (!arr.length) return;
    io.out(`\n${title} (${arr.length})`);
    for (const r of arr.slice(0, max)) io.out(`  ${r}`);
    if (arr.length > max) io.out(`  ... and ${arr.length - max} more`);
  };
  io.out(`Source:     ${srcRoot}\nRepository: ${repo}${hasGit ? '' : '  (not a git repository: no undo!)'}`);
  list('New files', p.add);
  list('Changed files', p.change);
  list(flags.has('--delete') ? 'Removed files (no longer in the new version)' : 'Only in your repo (kept; use --delete to remove)', p.remove);
  list('Your files kept untouched (data/, inbox/ are add-only)', p.keptLocal, 10);
  list('Ignored through .updateignore', p.ignored, 10);
  io.out(`\nUnchanged: ${p.same.length}`);

  if (!flags.has('--apply')) {
    io.out('\nDRY RUN: nothing was written. Re-run with --apply to update the repository.');
    return 0;
  }
  apply(p, srcRoot, repo, { del: flags.has('--delete') });
  io.out(`\nDone: ${p.add.length} added, ${p.change.length} changed${flags.has('--delete') ? `, ${p.remove.length} removed` : ''}.`);
  const pkgChanged = [...p.add, ...p.change].includes('package.json') || [...p.add, ...p.change].some((r) => r.endsWith('/package.json'));
  io.out('Next: ' + (pkgChanged ? 'npm install, then ' : '') + 'npm test' + (hasGit ? ', then review with `git status` and `git diff`, and commit.\nUndo everything with: git checkout . && git clean -fd (only if the tree was clean before).' : '.'));
  return 0;
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
