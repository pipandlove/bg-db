import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listRequirements, render } from './spec-index.mjs';

const SPEC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/spec');

test('docs/spec/requirements.md is up to date (run: node scripts/spec-index.mjs)', () => {
  assert.equal(fs.readFileSync(path.join(SPEC, 'requirements.md'), 'utf8'), render());
});

test('requirement ids are unique and every cross-reference in the spec points to an existing requirement', () => {
  const reqs = listRequirements();
  const ids = new Set(reqs.map((r) => r.id));
  assert.equal(ids.size, reqs.length, 'duplicate requirement id');
  for (const f of fs.readdirSync(SPEC).filter((n) => n.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(SPEC, f), 'utf8');
    for (const m of text.matchAll(/\]\((?:[\w.-]*\.md)?#([A-Z]+-\d+)\)/g)) assert.ok(ids.has(m[1]), `${f} refers to ${m[1]}, which does not exist`);
  }
});

test('the spec mentions the licence that the configuration uses', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(SPEC, '../../bgdb.config.json'), 'utf8'));
  assert.equal(cfg.license, 'CC0-1.0');
  assert.match(fs.readFileSync(path.join(SPEC, '11-rights-governance.md'), 'utf8'), /CC0 1\.0/);
});
