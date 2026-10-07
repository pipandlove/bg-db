/**
 * A data repository among several (decision 0024): global shard numbers, the size limits of a repository, a closed repository.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../src/cli.js';
import { loadConfig, repoSize, repoState } from '../src/store.js';
import { FIXTURES } from '../../core/test/helpers.js';

const capture = () => { const lines = []; return { lines, io: { out: (s) => lines.push(s), err: (s) => lines.push(s) } }; };
const FIX = {
  linnet: 'backgammon-studio/tester_-_Linnet14_7pt_Backgammon_Studio_2026_10_01_09_38_41.txt',
  cardinal: 'backgammon-studio/tester_-_Cardinal_5pt_Backgammon_Studio_2026_09_22_14_49_23.txt',
  vireo: 'opengammon/vireo_vs_tester_2026-09-30.mat',
};

/** a data repository in a temporary folder, with its own configuration */
function repo(config = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-repo-'));
  const a = (rel) => path.join(root, rel);
  fs.mkdirSync(a('inbox'));
  const cfg = a('bgdb.config.json');
  const setConfig = (c) => fs.writeFileSync(cfg, JSON.stringify({ name: 'T', license: 'CC0-1.0', ...c }));
  setConfig(config);
  const run = async (...args) => { const c = capture(); const code = await main(args, c.io); return { code, text: c.lines.join('\n') }; };
  return {
    a, cfg, run, setConfig,
    put: (key) => fs.copyFileSync(path.join(FIXTURES, FIX[key]), a(`inbox/${path.basename(FIX[key])}`)),
    ingest: (...x) => run('ingest', '--inbox', a('inbox'), '--data', a('data'), '--config', cfg, '--date', '2026-10-06', ...x),
    shard: (id) => JSON.parse(fs.readFileSync(a(`data/${id}/shard.json`), 'utf8')),
    shards: () => (fs.existsSync(a('data')) ? fs.readdirSync(a('data')).filter((d) => /^\d{4}$/.test(d)).sort() : []),
    hashFile: (id, lines) => { fs.mkdirSync(a('data/hashes'), { recursive: true }); fs.writeFileSync(a(`data/hashes/${id}.tsv`), lines); },
  };
}
const H = (n) => `${String(n).repeat(64).slice(0, 64)}\t0006/${String(n).repeat(16).slice(0, 16)}\n`;

// ------------------------------------------------------------------------------------------------ shard numbers

test('shard numbers are global: a new repository continues after the shards it knows from earlier ones (hash files, externalShards)', async () => {
  const r = repo();
  r.hashFile('0006', H(1));                                  // the previous repository ended at 0006
  r.put('linnet');
  assert.match((await r.ingest()).text, /added\s+0007\//);
  assert.deepEqual(r.shards(), ['0007']);
  const e = repo({ externalShards: [{ id: '0004', base: 'https://x.example/data/0004/' }] });
  e.put('linnet');
  assert.match((await e.ingest()).text, /added\s+0005\//);
});

test('firstShard: where a new repository starts; it must not reuse a number known from elsewhere', async () => {
  const r = repo({ firstShard: 12 });
  r.put('linnet'); r.put('vireo');
  assert.match((await r.ingest('--max-matches', '1')).text, /added\s+0012\/.*\n[\s\S]*added\s+0013\//, 'the next shard after a seal follows it');
  assert.deepEqual(r.shards(), ['0012', '0013']);
  assert.equal(r.shard('0012').status, 'sealed');
  const bad = repo({ firstShard: 3 });
  bad.hashFile('0006', H(1));
  bad.put('linnet');
  const b = await bad.ingest();
  assert.equal(b.code, 2);
  assert.match(b.text, /"firstShard" is 0003, but shard 0006 is already known from another repository .* set firstShard to 7 or more/);
  assert.deepEqual(bad.shards(), [], 'nothing was written');
});

test('the configuration is checked: firstShard, repoPolicy and closed', () => {
  const r = repo();
  const bad = (c, re) => { r.setConfig(c); assert.throws(() => loadConfig(r.cfg), re); };
  bad({ firstShard: 0 }, /"firstShard" must be a whole number from 1/);
  bad({ firstShard: '7' }, /"firstShard" must be a whole number/);
  bad({ repoPolicy: { warnMB: 900, stopMB: 900 } }, /"repoPolicy" needs 0 < warnMB < stopMB/);
  bad({ closed: 'yes' }, /"closed" must be true or false/);
  r.setConfig({ repoPolicy: { warnMB: 10 } });
  assert.deepEqual(loadConfig(r.cfg).repoPolicy, { warnMB: 10, stopMB: 950 }, 'what is not given keeps its default');
  r.setConfig({});
  assert.deepEqual([loadConfig(r.cfg).repoPolicy, loadConfig(r.cfg).firstShard, loadConfig(r.cfg).closed], [{ warnMB: 800, stopMB: 950 }, null, false]);
});

// ------------------------------------------------------------------------------------------------ the size of a repository

test('repository size: the data folder, or the packed git history when it is larger; ok, warn, stop', () => {
  const r = repo();
  fs.mkdirSync(r.a('data/0001'), { recursive: true });
  fs.writeFileSync(r.a('data/0001/x'), Buffer.alloc(1024 * 1024));
  const s = repoSize(r.a('data'));
  assert.equal(s.dataMB, 1);
  assert.equal(s.gitMB, null, 'not a git repository');
  assert.equal(s.mb, 1);
  assert.equal(repoSize(r.a('missing')).mb, 0);
  const p = { warnMB: 800, stopMB: 950 };
  assert.deepEqual([repoState(799.9, p), repoState(800, p), repoState(949, p), repoState(950, p)], ['ok', 'warn', 'warn', 'stop']);
});

test('above warnMB the ingest says it is time to prepare the next repository; above stopMB it adds nothing more, and the matches wait', async () => {
  // limits in MB small enough for the fixtures: one match is a few KB
  const w = repo({ repoPolicy: { warnMB: 0.001, stopMB: 0.006 } });
  w.put('linnet'); w.put('vireo'); w.put('cardinal');
  const r = await w.ingest('--report', w.a('report.json'));
  assert.equal(r.code, 0, 'what was added is committed: waiting matches are not a failure');
  const rep = JSON.parse(fs.readFileSync(w.a('report.json'), 'utf8'));
  assert.ok(rep.added >= 1 && rep.waiting >= 1, JSON.stringify(rep));
  assert.equal(rep.added + rep.waiting, 3);
  assert.equal(rep.repo.state, 'stop');
  assert.match(r.text, /waiting\s+\S+ stays in the inbox: this data repository is at [\d.]+ MB, above 0\.006 MB: the next repository takes the new matches/);
  assert.match(r.text, /repository: [\d.]+ MB \(data [\d.]+ MB\), above 0\.006 MB: nothing more is added here/);
  assert.equal(fs.readdirSync(w.a('inbox')).length, rep.waiting, 'the waiting matches are still in the inbox');
  const warn = repo({ repoPolicy: { warnMB: 0.001, stopMB: 100 } });
  warn.put('linnet');
  const t = await warn.ingest();
  assert.match(t.text, /above 0\.001 MB: time to prepare the next data repository/);
  const ok = repo();
  ok.put('linnet');
  assert.match((await ok.ingest()).text, /repository: [\d.]+ MB \(data [\d.]+ MB\); warning at 800 MB, stop at 950 MB\./);
});

// ------------------------------------------------------------------------------------------------ a closed repository

test('closed: the ingest still files what was merged into the open shard, but opens no new shard', async () => {
  const w = repo();
  w.put('linnet');
  await w.ingest();
  w.setConfig({ closed: true });
  w.put('vireo');
  assert.match((await w.ingest('--max-matches', '2')).text, /added\s+0001\//, 'room left in the open shard: filed');
  w.put('cardinal');
  const r = await w.ingest('--max-matches', '2', '--report', w.a('report.json'));
  assert.match(r.text, /waiting\s+\S+ stays in the inbox: this data repository is closed and its last shard is full/);
  assert.match(r.text, /this data repository is closed: it takes no more contributions/);
  assert.deepEqual(w.shards(), ['0001']);
  assert.equal(w.shard('0001').status, 'open', 'sealing the last shard is part of the switch, not of the ingest');
  assert.equal(JSON.parse(fs.readFileSync(w.a('report.json'), 'utf8')).repo.closed, true);
});

test('closed: the review answers "closed" and never merges; the issue form says the same', async () => {
  const w = repo({ closed: true });
  w.put('linnet');
  const body = w.a('body.md');
  fs.writeFileSync(body, '- [x] I have the right to share these matches under the CC0 public-domain dedication');
  const r = await w.run('review', '--inbox', w.a('inbox'), '--data', w.a('data'), '--config', w.cfg, '--body', body, '--report', w.a('r.json'), '--comment', w.a('c.md'));
  assert.equal(r.code, 1, 'the check fails: nothing is merged');
  const rep = JSON.parse(fs.readFileSync(w.a('r.json'), 'utf8'));
  assert.deepEqual([rep.verdict, rep.labels, rep.autoMerge], ['closed', ['closed'], false]);
  const comment = fs.readFileSync(w.a('c.md'), 'utf8');
  assert.match(comment, /This collection is closed: it takes no more matches/);
  assert.match(comment, /send the same files again from the Contribute page/);
  const issue = w.a('issue.md');
  fs.writeFileSync(issue, '### Match transcript\n\n```\nx\n```\n\n### Rights\n\n- [x] I have the right to share this');
  const i = await w.run('from-issue', '--body', issue, '--number', '5', '--inbox', w.a('inbox2'), '--config', w.cfg, '--result', w.a('i.json'));
  assert.equal(i.code, 1);
  const ir = JSON.parse(fs.readFileSync(w.a('i.json'), 'utf8'));
  assert.deepEqual([ir.ok, ir.closed], [false, true]);
  assert.match(ir.comment, /This collection is closed/);
  assert.equal(fs.existsSync(w.a('inbox2')), false, 'nothing is written');
});
