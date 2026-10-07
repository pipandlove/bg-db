/**
 * new-data-repo and switch-data-repo (decision 0024), in a temporary folder: bg-db and its data repositories side by side, real git,
 * and a fake gh that records what it was asked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newDataRepo, publishDataRepo, switchDataRepo, spawnRun, parseArgs } from './data-repos.mjs';
import { main } from '../packages/cli/src/cli.js';
import { FIXTURES } from '../packages/core/test/helpers.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = [
  'backgammon-studio/tester_-_Linnet14_7pt_Backgammon_Studio_2026_10_01_09_38_41.txt',
  'opengammon/vireo_vs_tester_2026-09-30.mat',
  'backgammon-studio/tester_-_Cardinal_5pt_Backgammon_Studio_2026_09_22_14_49_23.txt',
  'opengammon/Starling9_vs_tester_2026-09-27.mat',
];

/** bg-db (its configuration, the template, a git identity) in a new folder; the data repositories are made next to it */
function world({ identity = true } = {}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-repos-'));
  const tools = path.join(parent, 'bg-db');
  fs.mkdirSync(tools);
  fs.writeFileSync(path.join(tools, 'bgdb.config.json'), JSON.stringify({ name: 'BGDB', license: 'CC0-1.0', repository: 'owner/bg-db' }));
  fs.cpSync(path.join(REPO, 'templates'), path.join(tools, 'templates'), { recursive: true });
  spawnRun('git', ['init', '-q', '-b', 'master', tools]);
  if (identity) {
    spawnRun('git', ['-C', tools, 'config', 'user.name', 'Maintainer']);
    spawnRun('git', ['-C', tools, 'config', 'user.email', '1+maintainer@users.noreply.github.com']);
  }
  const gh = [];
  // what GitHub answers: the tools exist with their tag, nothing else yet
  const answers = { visibility: 'PRIVATE', refuse: [], exists: new Set(['owner/bg-db']), tag: true, pages: false, secrets: [], installed: true, loggedIn: true };
  const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
  const no = (stderr = 'HTTP 404: Not Found') => ({ status: 1, stdout: '', stderr });
  const run = (cmd, args, opts = {}) => {
    if (cmd !== 'gh') return spawnRun(cmd, args, opts);
    gh.push({ args, input: opts.input });
    const a = args.join(' ');
    if (!answers.installed) return { status: 127, stdout: '', stderr: 'spawnSync gh ENOENT' };
    if (a === 'auth status') return answers.loggedIn ? ok() : no('You are not logged into any GitHub hosts');
    if (answers.refuse.some((r) => a.includes(r))) return no('HTTP 403: Upgrade to GitHub Pro');
    if (args[0] === 'repo' && args[1] === 'view') return args.includes('.visibility') ? ok(`${answers.visibility}\n`) : answers.exists.has(args[2]) ? ok() : no();
    if (args[0] === 'repo' && args[1] === 'create') { answers.exists.add(args[2]); return ok(); }
    if (args[0] === 'api' && args.length === 2 && args[1].includes('/git/ref/tags/')) return answers.tag ? ok() : no();
    if (args[0] === 'api' && args.length === 2 && args[1].endsWith('/pages')) return answers.pages ? ok() : no();
    if (args[0] === 'secret' && args[1] === 'list') return ok(JSON.stringify(answers.secrets.map((name) => ({ name }))));
    return ok();
  };
  const lines = [];
  const opts = (o = {}) => ({ tools, run, out: (s) => lines.push(s), ...o });
  const d = (name, rel = '') => path.join(parent, name, rel);
  const read = (name, rel) => fs.readFileSync(d(name, rel), 'utf8');
  const sources = () => JSON.parse(fs.readFileSync(path.join(tools, 'sources.json'), 'utf8'));
  const git = (name, ...args) => spawnRun('git', ['-C', d(name), ...args]).stdout.trim();
  /** an ingest in a data repository, committed as the ingest workflow would */
  const ingest = async (name, files, ...extra) => {
    for (const f of files) fs.copyFileSync(path.join(FIXTURES, f), d(name, `inbox/${path.basename(f)}`));
    const out = [];
    const code = await main(['ingest', '--inbox', d(name, 'inbox'), '--data', d(name, 'data'), '--config', d(name, 'bgdb.config.json'), '--date', '2026-10-07', ...extra], { out: (s) => out.push(s), err: (s) => out.push(s) });
    git(name, 'add', '-A');
    git(name, 'commit', '-q', '-m', 'ingest');
    return { code, text: out.join('\n') };
  };
  return { parent, tools, gh, answers, lines, text: () => lines.join('\n'), opts, d, read, sources, git, ingest };
}

test('new-data-repo, the first one: made from the template, committed with the identity of bg-db, current in sources.json', async () => {
  const w = world();
  assert.equal(await newDataRepo(w.opts({ name: 'bg-db-data-1', local: true })), 0, w.text());
  const cfg = JSON.parse(w.read('bg-db-data-1', 'bgdb.config.json'));
  assert.deepEqual([cfg.firstShard, cfg.repository, cfg.closed, cfg.name], [1, 'owner/bg-db-data-1', false, 'BGDB']);
  for (const f of ['validate', 'review-publish', 'ingest', 'issue-to-pr', 'pages']) {
    const t = w.read('bg-db-data-1', `.github/workflows/${f}.yml`);
    assert.match(t, /uses: owner\/bg-db\/\.github\/workflows\/data-[a-z-]+\.yml@v4\n {4}with:\n {6}tools-repository: owner\/bg-db\n {6}tools-ref: v4\n/, f);
  }
  for (const f of ['README.md', 'CONTRIBUTING.md', 'DATA-LICENSE.md', 'inbox/README.md', '.github/ISSUE_TEMPLATE/submit-match.yml', '.github/PULL_REQUEST_TEMPLATE.md', 'package.json', '.gitignore']) {
    assert.ok(!w.read('bg-db-data-1', f).includes('%%'), `${f}: a placeholder is left`);
  }
  assert.match(w.read('bg-db-data-1', 'README.md'), /publishes them at <https:\/\/owner\.github\.io\/bg-db-data-1\/>[\s\S]*Shards start at `0001`/);
  assert.equal(w.git('bg-db-data-1', 'log', '--format=%an <%ae>|%s'), 'Maintainer <1+maintainer@users.noreply.github.com>|Data repository bg-db-data-1, from the template of owner/bg-db@v4');
  assert.equal(w.git('bg-db-data-1', 'status', '--porcelain'), '');
  assert.deepEqual(w.sources(), {
    schema: '1.0', name: 'BGDB', license: 'CC0-1.0',
    sources: [{ name: 'bg-db-data-1', url: 'https://owner.github.io/bg-db-data-1/', repository: 'owner/bg-db-data-1', defaultBranch: 'master', state: 'current' }],
  });
  assert.equal(w.gh.length, 0, '--local: nothing on GitHub');
  assert.match(w.text(), /bg-db-data-1 is the current data repository/);
});

test('new-data-repo on GitHub: create and push, squash merging, label, Pages, no branch rule, access to the private tools; refusals are warnings', async () => {
  const w = world();
  w.answers.refuse = ['/pages'];                                      // a private repository on a free plan
  w.answers.tag = false;
  assert.equal(await newDataRepo(w.opts({ name: 'bg-db-data-1' })), 0, w.text());
  const calls = w.gh.map((c) => c.args.join(' '));
  assert.deepEqual(calls.slice(0, 4), ['--version', 'auth status', 'repo view owner/bg-db --json name', 'api repos/owner/bg-db/git/ref/tags/v4'], 'checked before anything is made');
  assert.match(calls.find((c) => c.startsWith('repo create')), /^repo create owner\/bg-db-data-1 --private --source .*bg-db-data-1 --remote origin --push --description /);
  assert.ok(calls.includes('api -X PATCH repos/owner/bg-db-data-1 -F allow_squash_merge=true -F delete_branch_on_merge=true'));
  assert.ok(calls.includes('label create submission -R owner/bg-db-data-1 --force'));
  assert.ok(calls.includes('api -X POST repos/owner/bg-db-data-1/pages -f build_type=workflow'));
  assert.ok(!calls.some((c) => c.startsWith('variable set')), 'no publication after ingest when Pages could not be turned on');
  assert.ok(!calls.some((c) => c.includes('/protection')), 'no branch rule: it would refuse the ingest\'s commits, and the review decides the merge');
  assert.ok(calls.includes('api -X PUT repos/owner/bg-db/actions/permissions/access -f access_level=user'));
  const t = w.text();
  assert.match(t, /warning: turn on Pages \(source: GitHub Actions\): refused \(HTTP 403: Upgrade to GitHub Pro\)\. By hand: Settings > Pages/);
  assert.match(t, /warning: owner\/bg-db is private: add the secret BGDB_TOOLS_TOKEN to owner\/bg-db-data-1/);
  assert.match(t, /warning: add the secret BGDB_BOT_TOKEN to owner\/bg-db-data-1/);
  assert.match(t, /warning: there is no tag v4 on GitHub in owner\/bg-db: .* git tag v4 && git push origin v4/);
  assert.ok(!calls.some((c) => c.startsWith('workflow run')), 'Pages refused: nothing to publish');

  const p = world();
  p.answers.visibility = 'PUBLIC';
  p.answers.secrets = ['BGDB_BOT_TOKEN'];
  assert.equal(await newDataRepo(p.opts({ name: 'x', public: true, toolsRef: 'v2' })), 0, p.text());
  const pc = p.gh.map((c) => c.args.join(' '));
  assert.match(pc.find((c) => c.startsWith('repo create')), / --public /);
  assert.ok(!/warning/.test(p.text()), 'a public tools repository and the secret already there: nothing to do by hand');
  assert.ok(pc.includes('variable set PUBLISH_AFTER_INGEST --body true -R owner/x'));
  assert.ok(pc.includes('workflow run pages.yml -R owner/x --ref master'), 'published once, so that the site finds its registry');
  assert.ok(!pc.some((c) => c.includes('permissions/access')), 'public tools: no access setting, no token');
  assert.match(p.read('x', '.github/workflows/ingest.yml'), /data-ingest\.yml@v2\n[\s\S]*tools-ref: v2/);
});

test('new-data-repo refuses: no name, a name already listed, a "next" waiting, bg-db without identity, a folder in the way, the previous repository not checked out', async () => {
  const w = world();
  assert.equal(await newDataRepo(w.opts({ name: undefined, local: true })), 2);
  assert.match(w.text(), /Give the name of the new data repository/);
  await newDataRepo(w.opts({ name: 'a', local: true }));
  assert.equal(await newDataRepo(w.opts({ name: 'a', local: true })), 2);
  assert.match(w.text(), /a is already listed in sources\.json/);
  await newDataRepo(w.opts({ name: 'b', local: true }));
  assert.equal(w.sources().sources[1].state, 'next');
  assert.equal(await newDataRepo(w.opts({ name: 'c', local: true })), 2);
  assert.match(w.text(), /b is already the next data repository: run "npm run switch-data-repo" first/);
  assert.ok(!fs.existsSync(w.d('c')));

  const n = world({ identity: false });
  assert.equal(await newDataRepo(n.opts({ name: 'a', local: true })), 2);
  assert.match(n.text(), /has no git identity of its own/);
  assert.ok(!fs.existsSync(n.d('a')) && !fs.existsSync(path.join(n.tools, 'sources.json')), 'nothing was written');

  const f = world();
  fs.mkdirSync(f.d('a')); fs.writeFileSync(f.d('a', 'x'), '');
  assert.equal(await newDataRepo(f.opts({ name: 'a', local: true })), 2);
  assert.match(f.text(), /already exists and is not empty/);

  const m = world();
  await newDataRepo(m.opts({ name: 'a', local: true }));
  fs.rmSync(m.d('a'), { recursive: true });
  assert.equal(await newDataRepo(m.opts({ name: 'b', local: true })), 2);
  assert.match(m.text(), /a is not checked out at .*: it is needed to know the last shard number used/);
});

test('--dry-run prints the steps and does nothing', async () => {
  const w = world();
  assert.equal(await newDataRepo(w.opts({ name: 'a', dryRun: true })), 0);
  assert.match(w.text(), /would make .* from templates\/data-repo[\s\S]*would write .*sources\.json: a \(current\)[\s\S]*would create owner\/a on GitHub \(private\) and push/);
  assert.ok(!fs.existsSync(w.d('a')) && !fs.existsSync(path.join(w.tools, 'sources.json')));
  assert.deepEqual(w.gh.map((c) => c.args.join(' ')).filter((c) => /-X |repo create|label create|variable set/.test(c)), [], 'only questions were asked to GitHub');
});

test('from one data repository to the next: firstShard after the last shard, close, wait for the inbox, seal, hash files, sources.json', async () => {
  const w = world();
  await newDataRepo(w.opts({ name: 'data-1', local: true }));
  const r = await w.ingest('data-1', FIX.slice(0, 2), '--max-matches', '1');
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(fs.readdirSync(w.d('data-1', 'data')).sort(), ['0001', '0002']);

  // the next one starts after 0002, but nothing changes for contributors yet
  assert.equal(await newDataRepo(w.opts({ name: 'data-2', local: true })), 0, w.text());
  assert.equal(JSON.parse(w.read('data-2', 'bgdb.config.json')).firstShard, 3);
  assert.deepEqual(w.sources().sources.map((s) => s.state), ['current', 'next']);

  // a match merged but not ingested yet: the switch closes the repository and waits
  fs.copyFileSync(path.join(FIXTURES, FIX[2]), w.d('data-1', `inbox/${path.basename(FIX[2])}`));
  w.git('data-1', 'add', '-A'); w.git('data-1', 'commit', '-q', '-m', 'merged');
  assert.equal(await switchDataRepo(w.opts({ local: true })), 1, w.text());
  assert.match(w.text(), /1 file\(s\) still in data-1\/inbox: wait for its ingest[\s\S]*run npm run switch-data-repo again/);
  assert.equal(JSON.parse(w.read('data-1', 'bgdb.config.json')).closed, true);
  assert.equal(w.git('data-1', 'log', '-1', '--format=%s'), 'Closed: new contributions go to data-2 (decision 0024)');
  assert.deepEqual(w.sources().sources.map((s) => s.state), ['current', 'next'], 'not switched yet');

  // the ingest of the closed repository still files it into its open shard
  assert.match((await w.ingest('data-1', [])).text, /added\s+0002\//);
  w.lines.length = 0;
  assert.equal(await switchDataRepo(w.opts({ local: true })), 0, w.text());
  assert.match(w.text(), /data-1 is closed already[\s\S]*sealed 0002 \(2 matches\)/);
  const shard2 = JSON.parse(w.read('data-1', 'data/0002/shard.json'));
  assert.equal(shard2.status, 'sealed');
  assert.ok(shard2.integrity?.digest, 'sealed with its digest, so that builds trust it');
  assert.equal(w.git('data-1', 'status', '--porcelain'), '', 'committed');
  assert.deepEqual(fs.readdirSync(w.d('data-2', 'data/hashes')).sort(), ['0001.tsv', '0002.tsv']);
  assert.equal(w.read('data-2', 'data/hashes/0002.tsv').split('\n').filter(Boolean).length, 2);
  assert.equal(w.git('data-2', 'log', '-1', '--format=%s'), 'Hash files of the shards of data-1 (0001-0002) (decision 0024)');
  assert.deepEqual(w.sources().sources.map((s) => [s.name, s.state]), [['data-1', 'archived'], ['data-2', 'current']]);

  // the new repository: a match of the old one is a duplicate, a new match goes into 0003
  const dup = await w.ingest('data-2', [FIX[0]]);
  assert.match(dup.text, /0 added, 0 enriched, 1 duplicate/);
  assert.match((await w.ingest('data-2', [FIX[3]])).text, /added\s+0003\//);
  w.lines.length = 0;
  assert.equal(await switchDataRepo(w.opts({ local: true })), 2);
  assert.match(w.text(), /no "next" data repository/);
});

test('switch-data-repo: an empty open shard is removed rather than sealed, and the next repository starts at its number', async () => {
  const w = world();
  await newDataRepo(w.opts({ name: 'data-1', local: true }));
  await w.ingest('data-1', FIX.slice(0, 1));
  fs.mkdirSync(w.d('data-1', 'data/0002'));
  fs.writeFileSync(w.d('data-1', 'data/0001/shard.json'), JSON.stringify({ ...JSON.parse(w.read('data-1', 'data/0001/shard.json')), status: 'sealed' }));
  fs.writeFileSync(w.d('data-1', 'data/0002/shard.json'), JSON.stringify({ schema: '1.0', id: '0002', status: 'open', counts: { matches: 0, games: 0 } }));
  w.git('data-1', 'add', '-A'); w.git('data-1', 'commit', '-q', '-m', 'empty open shard');
  await newDataRepo(w.opts({ name: 'data-2', local: true }));
  assert.equal(JSON.parse(w.read('data-2', 'bgdb.config.json')).firstShard, 3);
  assert.equal(await switchDataRepo(w.opts({ local: true })), 0, w.text());
  assert.match(w.text(), /removed 0002: it was empty[\s\S]*firstShard of data-2: 0002/);
  assert.equal(JSON.parse(w.read('data-2', 'bgdb.config.json')).firstShard, 2);
  assert.match((await w.ingest('data-2', [FIX[1]])).text, /added\s+0002\//);
});

test('switch-data-repo refuses a data repository with changes not committed, and --dry-run changes nothing', async () => {
  const w = world();
  await newDataRepo(w.opts({ name: 'data-1', local: true }));
  await newDataRepo(w.opts({ name: 'data-2', local: true }));
  fs.writeFileSync(w.d('data-1', 'notes.txt'), 'x');
  assert.equal(await switchDataRepo(w.opts({ local: true })), 2);
  assert.match(w.text(), /data-1 has changes that are not committed/);
  fs.rmSync(w.d('data-1', 'notes.txt'));
  const before = fs.readFileSync(path.join(w.tools, 'sources.json'), 'utf8');
  assert.equal(await switchDataRepo(w.opts({ local: true, dryRun: true })), 0, w.text());
  assert.match(w.text(), /would close data-1[\s\S]*would seal[\s\S]*would copy the hash files[\s\S]*would write/);
  assert.equal(fs.readFileSync(path.join(w.tools, 'sources.json'), 'utf8'), before);
  assert.equal(JSON.parse(w.read('data-1', 'bgdb.config.json')).closed, false);
});

test('switch-data-repo on GitHub: waits for open pull requests; archives the old repository after its Pages run', async () => {
  const w = world();
  // remotes: a bare repository for each data repository, so that pull and push work
  await newDataRepo(w.opts({ name: 'data-1', local: true }));
  await newDataRepo(w.opts({ name: 'data-2', local: true }));
  for (const n of ['data-1', 'data-2']) {
    spawnRun('git', ['init', '-q', '--bare', '-b', 'master', w.d(`${n}.git`)]);
    w.git(n, 'remote', 'add', 'origin', w.d(`${n}.git`));
    w.git(n, 'push', '-q', '-u', 'origin', 'master');
  }
  let prs = '[{"number":4}]';
  let archived = 'false';
  const gh = [];
  const run = (cmd, args, opts) => {
    if (cmd !== 'gh') return spawnRun(cmd, args, opts);
    gh.push(args.join(' '));
    const a = args.join(' ');
    if (a.startsWith('pr list')) return { status: 0, stdout: prs, stderr: '' };
    if (a.includes('isArchived')) return { status: 0, stdout: archived, stderr: '' };
    if (a.startsWith('run list')) return { status: 0, stdout: '77\n', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  const o = w.opts({ run, sleep: async () => {} });
  assert.equal(await switchDataRepo(o), 1, w.text());
  assert.match(w.text(), /1 pull request\(s\) still open in owner\/data-1 \(#4\): merge or close them/);
  assert.equal(spawnRun('git', ['-C', w.d('data-1.git'), 'log', '-1', '--format=%s']).stdout.trim(), 'Closed: new contributions go to data-2 (decision 0024)', 'the closing was pushed');
  prs = '[]';
  assert.equal(await switchDataRepo(o), 0, w.text());
  assert.ok(gh.includes('workflow run pages.yml -R owner/data-1 --ref master'));
  assert.ok(gh.includes(`run list -R owner/data-1 --workflow pages.yml --commit ${w.git('data-1', 'rev-parse', 'HEAD')} --json databaseId --jq .[0].databaseId // empty`));
  assert.ok(gh.includes('run watch 77 -R owner/data-1 --exit-status'));
  assert.ok(gh.includes('repo archive owner/data-1 --yes'));
  assert.equal(w.sources().sources[1].state, 'current');
  gh.length = 0;
});

test('new-data-repo checks gh and the tools on GitHub before it makes anything', async () => {
  for (const [set, re] of [
    [(a) => { a.installed = false; }, /gh \(the GitHub command line\) is not installed: see docs\/data-repositories\.md/],
    [(a) => { a.loggedIn = false; }, /gh is not logged in: run "gh auth login"/],
    [(a) => { a.exists.delete('owner/bg-db'); }, /owner\/bg-db \(the tools, .*\) is not on GitHub, or this login cannot see it/],
  ]) {
    const w = world();
    set(w.answers);
    assert.equal(await newDataRepo(w.opts({ name: 'a' })), 2);
    assert.match(w.text(), re);
    assert.ok(!fs.existsSync(w.d('a')) && !fs.existsSync(path.join(w.tools, 'sources.json')), 'nothing was made');
  }
});

test('publish-data-repo: a repository made with --local goes on GitHub later; a GitHub part that stopped is finished; it is safe to repeat', async () => {
  const w = world();
  assert.equal(await newDataRepo(w.opts({ name: 'a', local: true })), 0);
  assert.equal(await publishDataRepo(w.opts({ name: 'b' })), 2);
  assert.match(w.text(), /b is not listed in sources\.json/);
  assert.equal(await publishDataRepo(w.opts({ name: 'a' })), 0, w.text());
  let calls = w.gh.map((c) => c.args.join(' '));
  assert.match(calls.find((c) => c.startsWith('repo create')), /^repo create owner\/a --private --source .*\/a --remote origin --push/);
  assert.match(w.text(), /owner\/a is on GitHub\. Do what the warnings say, then run this again/);

  // again: the repository exists, so it is pushed to; Pages already on is left alone
  spawnRun('git', ['init', '-q', '--bare', '-b', 'master', w.d('a.git')]);
  w.git('a', 'remote', 'add', 'origin', w.d('a.git'));
  w.answers.pages = true;
  w.answers.secrets = ['BGDB_BOT_TOKEN', 'BGDB_TOOLS_TOKEN'];
  w.gh.length = 0; w.lines.length = 0;
  assert.equal(await publishDataRepo(w.opts({ name: 'a' })), 0, w.text());
  calls = w.gh.map((c) => c.args.join(' '));
  assert.ok(!calls.some((c) => c.startsWith('repo create') || c.includes('-X POST')), calls.join('\n'));
  assert.match(w.text(), /owner\/a exists on GitHub: push to it[\s\S]*Pages is on already/);
  assert.ok(!/warning/.test(w.text()));
  assert.equal(spawnRun('git', ['-C', w.d('a.git'), 'log', '--format=%s']).stdout.trim(), 'Data repository a, from the template of owner/bg-db@v4');

  // gh repo create refused: the folder and sources.json are kept, and the message says how to finish
  const f = world();
  f.answers.refuse = ['repo create'];
  assert.equal(await newDataRepo(f.opts({ name: 'c' })), 2);
  assert.match(f.text(), /gh repo create owner\/c .* failed[\s\S]*once the cause is fixed, finish with npm run publish-data-repo -- c/);
  assert.equal(f.sources().sources[0].name, 'c');
  f.answers.refuse = [];
  assert.equal(await publishDataRepo(f.opts({ name: 'c' })), 0, f.text());
});

test('the command line of the steps', () => {
  assert.deepEqual(parseArgs(['new', 'bg-db-data-2', '--owner', 'o', '--tools-ref', 'v2', '--first-shard', '7', '--public', '--dry-run']),
    { command: 'new', name: 'bg-db-data-2', owner: 'o', toolsRef: 'v2', firstShard: 7, public: true, dryRun: true });
  assert.deepEqual(parseArgs(['switch', '--local']), { command: 'switch', name: undefined, local: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['new-data-repo'], 'node scripts/data-repos.mjs new');
  assert.equal(pkg.scripts['switch-data-repo'], 'node scripts/data-repos.mjs switch');
  assert.equal(pkg.scripts['publish-data-repo'], 'node scripts/data-repos.mjs publish');
});
