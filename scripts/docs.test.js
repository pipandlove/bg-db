/**
 * The documentation can be navigated: links resolve, every page is listed in the index of its folder, every page leads back to the
 * documentation index and to the project README, and no index lists a page twice.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(REPO, 'docs');
const FOLDERS = ['', 'formats', 'decisions', 'spec'];

const rel = (p) => path.relative(REPO, p).split(path.sep).join('/');
const pages = (folder) => fs.readdirSync(path.join(DOCS, folder)).filter((f) => f.endsWith('.md')).map((f) => path.join(DOCS, folder, f));
const allPages = () => FOLDERS.flatMap(pages);
/** relative links of a Markdown file (code blocks left out), without their #anchor */
const links = (file) => [...fs.readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '').matchAll(/\]\(([^)\s]+)\)/g)]
  .map((m) => m[1]).filter((l) => !/^(?:[a-z]+:|#)/.test(l)).map((l) => decodeURIComponent(l.split('#')[0]));

test('every relative link of the documentation and the READMEs points to a file that exists', () => {
  const files = [...allPages(), ...['README.md', 'CONTRIBUTING.md', 'DATA-LICENSE.md', ...['README.md', 'CONTRIBUTING.md', 'DATA-LICENSE.md', 'inbox/README.md'].map((f) => `templates/data-repo/${f}`)].map((f) => path.join(REPO, f))];
  for (const f of files) {
    for (const l of links(f)) assert.ok(fs.existsSync(path.resolve(path.dirname(f), l)), `${rel(f)} links to ${l}, which does not exist`);
  }
});

test('every page is listed in the index of its folder, every folder in docs/README.md, and docs/README.md in the README', () => {
  for (const folder of FOLDERS) {
    const index = path.join(DOCS, folder, 'README.md');
    const targets = new Set(links(index).map((l) => path.resolve(path.dirname(index), l)));
    for (const p of pages(folder)) if (!p.endsWith('README.md')) assert.ok(targets.has(p), `${rel(p)} is not listed in ${rel(index)}`);
    if (folder) assert.ok(links(path.join(DOCS, 'README.md')).includes(`${folder}/README.md`), `docs/README.md does not list ${folder}/`);
  }
  assert.ok(links(path.join(REPO, 'README.md')).includes('docs/README.md'), 'the README links to the documentation index');
});

test('every page starts with a line that leads back to the project README and the documentation index', () => {
  for (const p of allPages()) {
    const first = fs.readFileSync(p, 'utf8').split('\n')[0];
    const up = path.relative(path.dirname(p), REPO).split(path.sep).join('/') || '.';
    assert.ok(first.startsWith(`> [bgdb](${up}/README.md)`), `${rel(p)} does not start with the line back to the README`);
    if (p !== path.join(DOCS, 'README.md')) assert.match(first, /\[Documentation\]\((?:\.\.\/)?README\.md\)/, `${rel(p)}: no link to the documentation index`);
  }
});

test('no index lists the same page twice in one section', () => {
  for (const f of [path.join(REPO, 'README.md'), ...FOLDERS.map((x) => path.join(DOCS, x, 'README.md'))]) {
    for (const section of fs.readFileSync(f, 'utf8').split(/^## /m)) {
      const seen = new Set();
      for (const m of section.matchAll(/\]\(([^)#\s]+\.md)\)/g)) {
        if (m[1].startsWith('../')) continue;                       // links back up (the navigation line)
        assert.ok(!seen.has(m[1]), `${rel(f)} lists ${m[1]} twice in "${section.split('\n')[0].slice(0, 40)}"`);
        seen.add(m[1]);
      }
    }
  }
});
