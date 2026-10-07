#!/usr/bin/env node
/**
 * The steps of decision 0024 that a person takes, on their own machine, with their own `gh` login (no workflow creates repositories).
 *
 *   npm run new-data-repo -- <name> [--owner o] [--tools-ref v3] [--first-shard n] [--public] [--local] [--dry-run]
 *   npm run publish-data-repo -- <name> [--public] [--dry-run]
 *   npm run switch-data-repo -- [--local] [--dry-run]
 *
 * new-data-repo   makes ../<name> from templates/data-repo (workflows pinned to the tools' tag, bgdb.config.json with firstShard, README,
 *                 CONTRIBUTING), commits it, creates it on GitHub (gh repo create --push), allows auto-merge, turns Pages on, requires the
 *                 "validate / validate" check on master, and lists it in sources.json: "current" if it is the first, else "next".
 * publish-data-repo  the GitHub part of new-data-repo, for a repository made with --local (or one whose GitHub part stopped): safe to repeat.
 * switch-data-repo  closes the current repository (closed: true), waits until its open pull requests are merged or closed and its inbox
 *                 is empty (run it again until then), seals its last shard, copies the hash files of its shards into the next repository,
 *                 archives it on GitHub once its Pages site is up to date, and makes the next one current in sources.json.
 *
 * Data repositories are checked out next to bg-db (../<name>). Commits there use the git identity of the bg-db repository. sources.json is
 * changed but not committed: review it and commit it in bg-db, which publishes the site. --local touches nothing on GitHub (no gh, no push,
 * no pull); --dry-run prints the steps without doing them. Exit code: 0 done, 1 waiting (run again later), 2 error. Guide: docs/data-repositories.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkSources } from '../packages/core/src/index.js';
import { loadConfig, listShards, nextShardNumber, shardIdOf, readMetas, writeHashFile } from '../packages/cli/src/store.js';
import { sealOpenShard } from '../packages/cli/src/shards.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_TOOLS_REF = 'v3';
export const REQUIRED_CHECK = 'validate / validate';          // the caller job "validate" running the reusable job "validate"
const TEXT = new Set(['.md', '.json', '.yml', '.yaml', '']);

/** run a program; the tests replace it to answer for gh */
export function spawnRun(cmd, args, { cwd, input } = {}) {
  const r = spawnSync(cmd, args, { cwd, input, encoding: 'utf8' });
  return { status: r.error ? 127 : r.status, stdout: r.stdout ?? '', stderr: r.error ? r.error.message : r.stderr ?? '' };
}

class Stop extends Error {
  constructor(message, code = 2) { super(message); this.code = code; }
}

/** the context shared by both commands: bg-db, its sources.json, the folder next to it, and how to run programs */
function context(o) {
  const tools = path.resolve(o.tools ?? REPO);
  const out = o.out ?? ((s) => console.log(s));
  const run = o.run ?? spawnRun;
  const sourcesFile = path.join(tools, 'sources.json');
  let sources = null;
  if (fs.existsSync(sourcesFile)) {
    sources = JSON.parse(fs.readFileSync(sourcesFile, 'utf8'));
    const c = checkSources(sources);
    if (!c.ok) throw new Stop(`${sourcesFile}: ${c.errors.join('; ')}`);
  }
  const checkout = (name) => path.join(path.dirname(tools), name);
  const must = (cmd, args, opts = {}) => {
    const r = run(cmd, args, opts);
    if (r.status !== 0) throw new Stop(`${cmd} ${args.join(' ')} failed${opts.cwd ? ` in ${opts.cwd}` : ''}:\n${(r.stderr || r.stdout).trim()}`);
    return r.stdout;
  };
  /** a step: printed, then done unless --dry-run */
  const step = (text, fn) => { out(`${o.dryRun ? 'would ' : ''}${text}`); return o.dryRun ? undefined : fn?.(); };
  /** a GitHub setting that may be refused (a private repository on a free plan): a warning with what to do by hand, not a stop */
  const warnings = [];
  const tryGh = (text, args, byHand, input) => step(text, () => {
    const r = run('gh', args, { input });
    if (r.status !== 0) { warnings.push(`${text}: refused (${(r.stderr || r.stdout).trim().split('\n')[0]}). By hand: ${byHand}`); return false; }
    return true;
  });
  const identity = () => {
    const get = (k) => run('git', ['-C', tools, 'config', '--local', k]).stdout.trim();
    const id = { name: get('user.name'), email: get('user.email') };
    if (!id.name || !id.email) throw new Stop(`${tools} has no git identity of its own (git config user.name / user.email): the data repositories use the same one, set it there first`);
    return id;
  };
  const writeSources = (j) => {
    const c = checkSources(j);
    if (!c.ok) throw new Stop(`the new sources.json would be wrong: ${c.errors.join('; ')}`);
    step(`write ${path.relative(process.cwd(), sourcesFile) || sourcesFile}: ${j.sources.map((s) => `${s.name} (${s.state})`).join(', ')}`,
      () => fs.writeFileSync(sourcesFile, `${JSON.stringify(j, null, 2)}\n`));
  };
  return { ...o, tools, out, run, sourcesFile, sources, checkout, must, step, tryGh, warnings, identity, writeSources };
}

/** the last shard number a data repository knows of: its shards, the hash files it received, externalShards, firstShard */
export function lastShardOf(dir) {
  const config = loadConfig(path.join(dir, 'bgdb.config.json'));
  const data = path.join(dir, 'data');
  return nextShardNumber(listShards(data), data, config) - 1;
}

/** copy templates/data-repo into dir, with the placeholders %%key%% replaced */
export function renderTemplate(from, to, values) {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name);
    const dst = path.join(to, e.name);
    if (e.isDirectory()) { fs.mkdirSync(dst, { recursive: true }); renderTemplate(src, dst, values); continue; }
    let text = fs.readFileSync(src, 'utf8');
    if (TEXT.has(path.extname(e.name))) {
      text = text.replace(/%%(\w+)%%/g, (m, k) => {
        if (!(k in values)) throw new Stop(`${src}: no value for the placeholder ${m}`);
        return String(values[k]);
      });
    }
    fs.writeFileSync(dst, text);
  }
}

const commitAll = (c, dir, message) => {
  c.must('git', ['-C', dir, 'add', '-A']);
  if (c.run('git', ['-C', dir, 'diff', '--cached', '--quiet']).status === 0) return false;
  c.must('git', ['-C', dir, 'commit', '-q', '-m', message]);
  return true;
};

function isClean(c, dir) {
  if (!fs.existsSync(path.join(dir, '.git'))) throw new Stop(`${dir} is not a git checkout: check out the data repository there first`);
  if (c.must('git', ['-C', dir, 'status', '--porcelain']).trim()) throw new Stop(`${dir} has changes that are not committed: commit or remove them first`);
}

const GUIDE = 'docs/data-repositories.md';

/** gh is installed and logged in, and the tools are on GitHub: checked before anything is done there */
function ghReady(c, toolsRepository, toolsRef) {
  if (c.run('gh', ['--version']).status !== 0) throw new Stop(`gh (the GitHub command line) is not installed: see ${GUIDE}, "Before you start". Or add --local to do everything but the GitHub part.`);
  if (c.run('gh', ['auth', 'status']).status !== 0) throw new Stop(`gh is not logged in: run "gh auth login" (see ${GUIDE}, "Before you start")`);
  if (c.run('gh', ['repo', 'view', toolsRepository, '--json', 'name']).status !== 0) throw new Stop(`${toolsRepository} (the tools, named by "repository" in bgdb.config.json) is not on GitHub, or this login cannot see it: put bg-db on GitHub first (${GUIDE}, "Before you start")`);
  c.tagOk = c.run('gh', ['api', `repos/${toolsRepository}/git/ref/tags/${toolsRef}`]).status === 0;
  if (!c.tagOk) c.warnings.push(`there is no tag ${toolsRef} on GitHub in ${toolsRepository}: the workflows of the data repository call ${toolsRepository}@${toolsRef} and fail until it exists. In bg-db: git tag ${toolsRef} && git push origin ${toolsRef}`);
}

/**
 * The GitHub part of a data repository: create it (or reuse it when it exists) and push, then the settings its workflows need. A setting that is
 * refused (a private repository on a free plan) is a warning that says what to do by hand. Running it again is safe.
 */
async function onGitHub(c, { repository, owner, dir, toolsRepository, toolsRef, public: pub, description, ready = false }) {
  if (!ready) ghReady(c, toolsRepository, toolsRef);
  const exists = c.run('gh', ['repo', 'view', repository, '--json', 'name']).status === 0;
  const hasOrigin = c.run('git', ['-C', dir, 'remote', 'get-url', 'origin']).status === 0;
  if (!exists) {
    c.step(`create ${repository} on GitHub (${pub ? 'public' : 'private'}) and push`, () => {
      if (hasOrigin) c.must('git', ['-C', dir, 'remote', 'remove', 'origin']);
      c.must('gh', ['repo', 'create', repository, pub ? '--public' : '--private', '--source', dir, '--remote', 'origin', '--push', '--description', description]);
    });
  } else {
    c.step(`${repository} exists on GitHub: push to it`, () => {
      if (!hasOrigin) c.must('git', ['-C', dir, 'remote', 'add', 'origin', `https://github.com/${repository}.git`]);
      c.must('git', ['-C', dir, 'push', '-q', '-u', 'origin', 'master']);
    });
  }
  c.tryGh('allow auto-merge and squash merging', ['api', '-X', 'PATCH', `repos/${repository}`, '-F', 'allow_auto_merge=true', '-F', 'allow_squash_merge=true', '-F', 'delete_branch_on_merge=true'],
    `Settings > General > Pull Requests: allow auto-merge and squash merging (${GUIDE}, "The settings")`);
  c.tryGh('create the label "submission" (the issue form uses it)', ['label', 'create', 'submission', '-R', repository, '--force'], `gh label create submission -R ${repository}`);
  const pagesOn = c.run('gh', ['api', `repos/${repository}/pages`]).status === 0;
  const pages = pagesOn ? (c.out('Pages is on already'), true)
    : c.tryGh('turn on Pages (source: GitHub Actions)', ['api', '-X', 'POST', `repos/${repository}/pages`, '-f', 'build_type=workflow'],
      `Settings > Pages > Source: GitHub Actions; a private repository needs a paid plan (${GUIDE}, "The settings")`);
  if (pages !== false) {
    c.tryGh('publish after each ingest (variable PUBLISH_AFTER_INGEST)', ['variable', 'set', 'PUBLISH_AFTER_INGEST', '--body', 'true', '-R', repository], `gh variable set PUBLISH_AFTER_INGEST --body true -R ${repository}`);
    // the pages workflow runs on a push that changes data/, and a new repository has none: without this run the site gets a 404 for its registry
    if (c.tagOk) c.tryGh('publish it once (the site reads its registry.json)', ['workflow', 'run', 'pages.yml', '-R', repository, '--ref', 'master'], `the data repository > Actions > pages > Run workflow`);
    else c.warnings.push(`once the tag ${toolsRef} exists, publish ${repository} once (the site reads its registry.json): gh workflow run pages.yml -R ${repository}`);
  }
  const rule = { required_status_checks: { strict: false, contexts: [REQUIRED_CHECK] }, enforce_admins: false, required_pull_request_reviews: null, restrictions: null };
  c.tryGh(`require the check "${REQUIRED_CHECK}" on master`, ['api', '-X', 'PUT', `repos/${repository}/branches/master/protection`, '--input', '-'],
    `Settings > Branches: a rule for master that requires the status check "${REQUIRED_CHECK}", no required review; a private repository needs a paid plan (${GUIDE}, "The settings")`, JSON.stringify(rule));
  const vis = c.run('gh', ['repo', 'view', toolsRepository, '--json', 'visibility', '--jq', '.visibility']).stdout.trim();
  const secrets = c.dryRun ? [] : (() => { try { return JSON.parse(c.run('gh', ['secret', 'list', '-R', repository, '--json', 'name']).stdout || '[]').map((x) => x.name); } catch { return []; } })();
  if (vis === 'PRIVATE') {
    c.tryGh(`let the repositories of ${owner} call the workflows of ${toolsRepository} (it is private)`, ['api', '-X', 'PUT', `repos/${toolsRepository}/actions/permissions/access`, '-f', 'access_level=user'],
      `in ${toolsRepository}: Settings > Actions > General > Access: "Accessible from repositories owned by ${owner}"`);
    if (!secrets.includes('BGDB_TOOLS_TOKEN')) c.warnings.push(`${toolsRepository} is private: add the secret BGDB_TOOLS_TOKEN to ${repository}, or its workflows cannot read the tools (${GUIDE}, "The two secrets")`);
  }
  if (!secrets.includes('BGDB_BOT_TOKEN')) c.warnings.push(`add the secret BGDB_BOT_TOKEN to ${repository}: without it a "Submit a match" issue cannot become a pull request, and an automatic merge does not start the ingest (${GUIDE}, "The two secrets")`);
}

// ------------------------------------------------------------------------------------------------ new-data-repo

/**
 * @param {{name:string, owner?:string, toolsRef?:string, toolsRepository?:string, firstShard?:number, public?:boolean, local?:boolean,
 *   dryRun?:boolean, tools?:string, out?:(s:string)=>void, run?:typeof spawnRun}} o
 * @returns {Promise<number>} exit code
 */
export async function newDataRepo(o) {
  let c;
  try {
    c = context(o);
    const { name } = o;
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(name ?? '')) throw new Stop('Give the name of the new data repository, for example: npm run new-data-repo -- bg-db-data-2');
    const list = c.sources?.sources ?? [];
    if (list.some((s) => s.name === name)) throw new Stop(`${name} is already listed in sources.json`);
    const pending = list.find((s) => s.state === 'next');
    if (pending) throw new Stop(`${pending.name} is already the next data repository: run "npm run switch-data-repo" first`);
    const toolsConfig = loadConfig(path.join(c.tools, 'bgdb.config.json'));
    const toolsRepository = o.toolsRepository ?? toolsConfig.repository;
    if (!toolsRepository) throw new Stop(`no "repository" in ${path.join(c.tools, 'bgdb.config.json')}: it names the repository of the tools ("owner/bg-db")`);
    const current = list.find((s) => s.state === 'current');
    const owner = o.owner ?? (current?.repository ?? toolsRepository).split('/')[0];
    const repository = `${owner}/${name}`;
    const toolsRef = o.toolsRef ?? DEFAULT_TOOLS_REF;
    const dir = c.checkout(name);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Stop(`${dir} already exists and is not empty`);

    // shard numbers are global: the new repository starts after every shard the listed repositories know of
    let last = 0;
    for (const s of list) {
      const d = c.checkout(s.name);
      if (!fs.existsSync(path.join(d, 'bgdb.config.json'))) throw new Stop(`${s.name} is not checked out at ${d}: it is needed to know the last shard number used`);
      last = Math.max(last, lastShardOf(d));
    }
    const firstShard = o.firstShard ?? last + 1;
    if (!(Number.isInteger(firstShard) && firstShard > last)) throw new Stop(`--first-shard must be a whole number above ${last}, the last shard number already used`);
    const id = c.identity();
    const values = {
      name, repository, toolsRepository, toolsRef, firstShard, firstShardId: shardIdOf(firstShard), databaseName: toolsConfig.name,
      dataUrl: `https://${owner.toLowerCase()}.github.io/${name}/`,
    };
    if (!c.local) ghReady(c, toolsRepository, toolsRef);           // before anything is written, so that a missing gh leaves nothing half made
    c.out(`${repository}: a data repository whose first shard is ${values.firstShardId}, with the tools ${toolsRepository}@${toolsRef}${c.dryRun ? ' (dry run: nothing is done)' : ''}`);

    c.step(`make ${dir} from templates/data-repo`, () => { fs.mkdirSync(dir, { recursive: true }); renderTemplate(path.join(c.tools, 'templates/data-repo'), dir, values); });
    c.step(`commit it as ${id.name} <${id.email}> (the identity of bg-db)`, () => {
      c.must('git', ['init', '-q', '-b', 'master', dir]);
      c.must('git', ['-C', dir, 'config', 'user.name', id.name]);
      c.must('git', ['-C', dir, 'config', 'user.email', id.email]);
      commitAll(c, dir, `Data repository ${name}, from the template of ${toolsRepository}@${toolsRef}\n\nFirst shard: ${values.firstShardId} (decision 0024).`);
    });
    const j = c.sources ?? { schema: '1.0', name: toolsConfig.name, license: toolsConfig.license, sources: [] };
    const state = list.length === 0 ? 'current' : 'next';
    c.writeSources({ ...j, sources: [...list, { name, url: values.dataUrl, repository, defaultBranch: 'master', state }] });
    if (!c.local) {
      try {
        await onGitHub(c, { repository, owner, dir, toolsRepository, toolsRef, public: o.public, description: `Matches of ${toolsConfig.name}: a data repository of ${toolsRepository}`, ready: true });
      } catch (e) {
        if (e instanceof Stop) e.message += `\n${dir} and sources.json are made: once the cause is fixed, finish with npm run publish-data-repo -- ${name}`;
        throw e;
      }
    }
    for (const w of c.warnings) c.out(`warning: ${w}`);
    c.out(state === 'current'
      ? `\n${name} is the current data repository. Commit sources.json in bg-db: the site reads ${name}, and the Contribute page sends to it.`
      : `\n${name} is the next data repository: nothing changes for contributors yet. Commit sources.json in bg-db; when you decide, run: npm run switch-data-repo`);
    return 0;
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    (c?.out ?? o.out ?? console.error)(e.message);
    return e.code;
  }
}

// ------------------------------------------------------------------------------------------------ publish-data-repo

/**
 * Put on GitHub a data repository made with new-data-repo --local (or finish one whose GitHub part stopped half way): create it and push, then the
 * settings. It must be listed in sources.json and checked out at ../<name>, with everything committed.
 * @param {{name:string, public?:boolean, dryRun?:boolean, tools?:string, out?:(s:string)=>void, run?:typeof spawnRun}} o
 * @returns {Promise<number>} exit code
 */
export async function publishDataRepo(o) {
  let c;
  try {
    c = context(o);
    const src = c.sources?.sources.find((s) => s.name === o.name);
    if (!src) throw new Stop(`${o.name ?? '(no name)'} is not listed in sources.json: make it first with npm run new-data-repo -- <name> --local`);
    const dir = c.checkout(src.name);
    isClean(c, dir);
    const toolsConfig = loadConfig(path.join(c.tools, 'bgdb.config.json'));
    const cfg = loadConfig(path.join(dir, 'bgdb.config.json'));
    const toolsRef = (fs.readFileSync(path.join(dir, '.github/workflows/ingest.yml'), 'utf8').match(/@([\w.-]+)\n/) ?? [])[1] ?? DEFAULT_TOOLS_REF;
    const toolsRepository = toolsConfig.repository;
    c.out(`${src.repository}: put ${dir} on GitHub, with the tools ${toolsRepository}@${toolsRef}${c.dryRun ? ' (dry run: nothing is done)' : ''}`);
    await onGitHub(c, { repository: src.repository, owner: src.repository.split('/')[0], dir, toolsRepository, toolsRef, public: o.public, description: `Matches of ${cfg.name}: a data repository of ${toolsRepository}` });
    for (const w of c.warnings) c.out(`warning: ${w}`);
    c.out(`\n${src.repository} is on GitHub.${c.warnings.length ? ' Do what the warnings say, then run this again to check: it is safe to repeat.' : ''}`);
    return 0;
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    (c?.out ?? o.out ?? console.error)(e.message);
    return e.code;
  }
}

// ------------------------------------------------------------------------------------------------ switch-data-repo

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** publish the repository once more and wait for that run, so that the archived repository shows its final state */
async function waitForPages(c, repository, sha) {
  if (c.run('gh', ['workflow', 'run', 'pages.yml', '-R', repository, '--ref', 'master']).status !== 0) return false;
  for (let i = 0; i < (c.polls ?? 24); i++) {
    const r = c.run('gh', ['run', 'list', '-R', repository, '--workflow', 'pages.yml', '--commit', sha, '--json', 'databaseId', '--jq', '.[0].databaseId // empty']);
    const id = r.stdout.trim();
    if (id) return c.run('gh', ['run', 'watch', id, '-R', repository, '--exit-status']).status === 0;
    await (c.sleep ?? sleep)(5000);
  }
  return false;
}

/**
 * @param {{local?:boolean, dryRun?:boolean, tools?:string, out?:(s:string)=>void, run?:typeof spawnRun, sleep?:(ms:number)=>Promise<void>, polls?:number}} o
 * @returns {Promise<number>} exit code: 0 done, 1 waiting (run again), 2 error
 */
export async function switchDataRepo(o = {}) {
  let c;
  try {
    c = context(o);
    if (!c.sources) throw new Stop('there is no sources.json in bg-db: make the first data repository with npm run new-data-repo');
    const cur = c.sources.sources.find((s) => s.state === 'current');
    const next = c.sources.sources.find((s) => s.state === 'next');
    if (!next) throw new Stop('sources.json has no "next" data repository: make it first with npm run new-data-repo -- <name>');
    const A = c.checkout(cur.name);
    const B = c.checkout(next.name);
    for (const d of [A, B]) isClean(c, d);
    if (!c.local && c.run('gh', ['auth', 'status']).status !== 0) throw new Stop(`gh is not installed or not logged in (${GUIDE}, "Before you start"); --local does everything but the GitHub part`);
    if (!c.local) for (const d of [A, B]) c.step(`bring ${d} up to date`, () => c.must('git', ['-C', d, 'pull', '-q', '--ff-only']));
    c.out(`switch from ${cur.name} to ${next.name}${c.dryRun ? ' (dry run: nothing is done)' : ''}`);

    // 1. close the current repository: its review answers "closed", its ingest opens no new shard
    const cfgFile = path.join(A, 'bgdb.config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    if (!cfg.closed) {
      c.step(`close ${cur.name} (closed: true) and commit`, () => {
        fs.writeFileSync(cfgFile, `${JSON.stringify({ ...cfg, closed: true }, null, 2)}\n`);
        commitAll(c, A, `Closed: new contributions go to ${next.name} (decision 0024)`);
        if (!c.local) c.must('git', ['-C', A, 'push', '-q']);
      });
    } else c.out(`${cur.name} is closed already`);

    // 2. what was merged before the closing must be ingested first
    const open = c.local ? [] : JSON.parse(c.must('gh', ['pr', 'list', '-R', cur.repository, '--state', 'open', '--json', 'number']) || '[]');
    const inbox = path.join(A, 'inbox');
    const waiting = fs.existsSync(inbox) ? fs.readdirSync(inbox).filter((f) => f !== 'README.md') : [];
    if (open.length || waiting.length) {
      if (open.length) c.out(`${open.length} pull request(s) still open in ${cur.repository} (#${open.map((p) => p.number).join(', #')}): merge or close them.`);
      if (waiting.length) c.out(`${waiting.length} file(s) still in ${cur.name}/inbox: wait for its ingest (or, if they wait for the next repository, move them to ${next.name}/inbox).`);
      c.out('Then run npm run switch-data-repo again.');
      return 1;
    }

    // 3. seal the last shard, at whatever size it has reached
    const dataA = path.join(A, 'data');
    c.step(`seal the open shard of ${cur.name} and commit`, () => {
      const r = sealOpenShard({ data: dataA });
      if (!r.ok) throw new Stop(r.error);
      if (r.sealed) c.out(`  sealed ${r.sealed} (${r.matches} matches)`);
      if (r.removed) c.out(`  removed ${r.removed}: it was empty`);
      if (commitAll(c, A, `Sealed the last shard: ${cur.name} is archived, new matches go to ${next.name} (decision 0024)`) && !c.local) c.must('git', ['-C', A, 'push', '-q']);
    });

    // 4. the next repository recognises the matches of this one as duplicates, and continues the shard numbers after them
    c.step(`copy the hash files of ${cur.name}'s shards into ${next.name} and commit`, () => {
      const dataB = path.join(B, 'data');
      const ids = [];
      for (const s of listShards(dataA)) { writeHashFile(dataB, s.id, readMetas(s.dir)); ids.push(s.id); }
      const received = path.join(dataA, 'hashes');
      if (fs.existsSync(received)) fs.mkdirSync(path.join(dataB, 'hashes'), { recursive: true });
      if (fs.existsSync(received)) for (const f of fs.readdirSync(received)) fs.copyFileSync(path.join(received, f), path.join(dataB, 'hashes', f));
      const cfgB = JSON.parse(fs.readFileSync(path.join(B, 'bgdb.config.json'), 'utf8'));
      const first = lastShardOf(A) + 1;
      if (listShards(dataB).length === 0 && cfgB.firstShard !== first) {
        fs.writeFileSync(path.join(B, 'bgdb.config.json'), `${JSON.stringify({ ...cfgB, firstShard: first }, null, 2)}\n`);
        c.out(`  firstShard of ${next.name}: ${shardIdOf(first)}`);
      }
      if (commitAll(c, B, `Hash files of the shards of ${cur.name}${ids.length ? ` (${ids[0]}-${ids.at(-1)})` : ''} (decision 0024)`) && !c.local) c.must('git', ['-C', B, 'push', '-q']);
    });

    // 5. archive the old repository on GitHub once its site shows the sealed shard
    if (!c.local) {
      const sha = c.dryRun ? '' : c.must('git', ['-C', A, 'rev-parse', 'HEAD']).trim();
      const archived = c.run('gh', ['repo', 'view', cur.repository, '--json', 'isArchived', '--jq', '.isArchived']).stdout.trim() === 'true';
      if (!archived) {
        const published = await c.step(`wait for the Pages run of ${cur.repository}, then archive it (read-only; its site keeps serving)`, async () => {
          if (!(await waitForPages(c, cur.repository, sha))) {
            c.warnings.push(`no successful Pages run of ${cur.repository} for ${sha.slice(0, 7)} was seen: run its pages workflow, then archive it by hand (gh repo archive ${cur.repository} --yes)`);
            return false;
          }
          c.must('gh', ['repo', 'archive', cur.repository, '--yes']);
          return true;
        });
        if (published === false) c.out(`  ${cur.repository} is not archived yet`);
      }
    }

    // 6. the site reads both, and the Contribute page sends to the next one
    c.writeSources({ ...c.sources, sources: c.sources.sources.map((s) => (s.name === cur.name ? { ...s, state: 'archived' } : s.name === next.name ? { ...s, state: 'current' } : s)) });
    for (const w of c.warnings) c.out(`warning: ${w}`);
    c.out(`\n${next.name} is now the current data repository. Commit sources.json in bg-db and publish the site: its Contribute page then sends to ${next.name}.`);
    return 0;
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    (c?.out ?? o.out ?? console.error)(e.message);
    return e.code;
  }
}

// ------------------------------------------------------------------------------------------------ command line

/** command-line options: [name] [--owner o] [--tools-ref ref] [--first-shard n] [--public] [--local] [--dry-run] */
export function parseArgs(argv) {
  const o = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--owner') o.owner = argv[++i];
    else if (a === '--tools-ref') o.toolsRef = argv[++i];
    else if (a === '--first-shard') o.firstShard = Number(argv[++i]);
    else if (a === '--public') o.public = true;
    else if (a === '--local') o.local = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else pos.push(a);
  }
  return { ...o, command: pos[0], name: pos[1] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || !['new', 'publish', 'switch'].includes(o.command)) {
    console.log('Usage: npm run new-data-repo -- <name> [--owner o] [--tools-ref v3] [--first-shard n] [--public] [--local] [--dry-run]\n'
      + '       npm run publish-data-repo -- <name> [--public] [--dry-run]\n'
      + '       npm run switch-data-repo -- [--local] [--dry-run]\nGuide: docs/data-repositories.md');
    process.exitCode = o.help ? 0 : 2;
  } else process.exitCode = await { new: newDataRepo, publish: publishDataRepo, switch: switchDataRepo }[o.command](o);
}
