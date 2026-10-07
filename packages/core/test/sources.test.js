/**
 * sources.json: the data repositories a site reads (decision 0024).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSources, mergeEnrichment } from '../src/sources.js';

const good = () => ({
  schema: '1.0', name: 'BGDB', license: 'CC0-1.0',
  sources: [
    { name: 'bg-db-data-1', url: 'https://owner.github.io/bg-db-data-1/', repository: 'owner/bg-db-data-1', state: 'archived' },
    { name: 'bg-db-data-2', url: 'https://owner.github.io/bg-db-data-2/', repository: 'owner/bg-db-data-2', defaultBranch: 'main', state: 'current' },
    { name: 'bg-db-data-3', url: 'https://owner.github.io/bg-db-data-3/', repository: 'owner/bg-db-data-3', state: 'next' },
  ],
});

test('a valid sources.json: one current source, which is where contributions go', () => {
  const r = checkSources(good());
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.deepEqual([r.current.name, r.current.repository, r.current.defaultBranch], ['bg-db-data-2', 'owner/bg-db-data-2', 'main']);
  assert.equal(r.sources[0].defaultBranch, 'master', 'the default branch defaults to master');
  assert.deepEqual([r.name, r.license], ['BGDB', 'CC0-1.0']);
});

test('addresses: https, http on this computer, or a path relative to the site; always ending with "/"', () => {
  const withUrl = (url) => { const j = good(); j.sources[1].url = url; return checkSources(j); };
  for (const u of ['https://a.example/x/', 'http://localhost:8080/', 'http://127.0.0.1/', './', '../data-1/', 'data/']) assert.equal(withUrl(u).ok, true, u);
  for (const u of ['http://a.example/', 'javascript:alert(1)/', '//a.example/', 'https://a.example/x', 'data', 42]) {
    assert.match(withUrl(u).errors.join(), /"url"/, String(u));
  }
});

test('mistakes are named: no current source, two current, no repository for the current one, duplicates, bad states and names', () => {
  const edit = (f) => { const j = good(); f(j); return checkSources(j).errors.join(' | '); };
  assert.match(edit((j) => { j.sources[1].state = 'archived'; }), /exactly one source must be "current".*there are 0/);
  assert.match(edit((j) => { j.sources[0].state = 'current'; }), /there are 2/);
  assert.match(edit((j) => { delete j.sources[1].repository; }), /current source \(bg-db-data-2\) needs its "repository"/);
  assert.match(edit((j) => { j.sources[2].name = 'bg-db-data-1'; }), /the name is used twice/);
  assert.match(edit((j) => { j.sources[0].state = 'old'; }), /"state" must be one of current, next, archived/);
  assert.match(edit((j) => { j.sources[0].name = 'a b'; }), /"name" must be/);
  assert.match(edit((j) => { j.sources[0].repository = 'no-slash'; }), /"repository" must look like "owner\/name"/);
  assert.match(edit((j) => { j.sources[1].defaultBranch = 'a b'; }), /"defaultBranch" is not a branch name/);
  assert.match(edit((j) => { j.schema = '2'; }), /"schema" must be "1.0"/);
  assert.match(edit((j) => { j.sources = []; }), /at least one data repository/);
  assert.equal(checkSources([]).ok, false);
});

test('enrichments of one match in two repositories are merged, the later repository last', () => {
  const old = { links: [{ url: 'https://youtu.be/a' }], tags: ['final'], attachments: [{ kind: 'sgf', href: 'old.sgf' }], meta: { event: 'Old', round: 'R1' } };
  const now = { links: [{ url: 'https://youtu.be/a' }, { url: 'https://youtu.be/b' }], tags: ['final', 'live'], attachments: [{ kind: 'sgf', href: 'new.sgf' }, { kind: 'xg', href: 'new.xg' }], meta: { event: 'Corrected' } };
  assert.deepEqual(mergeEnrichment(old, now), {
    links: [{ url: 'https://youtu.be/a' }, { url: 'https://youtu.be/b' }], tags: ['final', 'live'],
    attachments: [{ kind: 'sgf', href: 'new.sgf' }, { kind: 'xg', href: 'new.xg' }], meta: { event: 'Corrected', round: 'R1' },
  });
  assert.deepEqual(mergeEnrichment(undefined, now), now);
  assert.equal('meta' in mergeEnrichment({ links: [] }, { tags: [] }), false);
});
