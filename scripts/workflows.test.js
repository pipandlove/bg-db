import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, '.github/workflows');
const CALLERS = path.join(ROOT, 'templates/data-repo/.github/workflows');      // the workflows of a data repository (decision 0024)
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
const caller = (f) => fs.readFileSync(path.join(CALLERS, f), 'utf8');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.yml'));
const callers = fs.readdirSync(CALLERS).filter((f) => f.endsWith('.yml'));

/** the text of every `run:` step, so that the safety rules can be checked on shell code only */
function runBlocks(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(?:- )?run:\s*(.*)$/);
    if (!m) continue;
    if (!/^[|>][-+]?$/.test(m[2])) { out.push(m[2]); continue; }
    const indent = m[1].length;
    const block = [];
    for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || lines[j].search(/\S/) > indent); j++) block.push(lines[j]);
    out.push(block.join('\n'));
  }
  return out;
}

test('no workflow puts a GitHub expression inside a shell script: untrusted text (issue, pull request, branch names) goes through env variables only', () => {
  for (const [f, t] of [...files.map((f) => [f, read(f)]), ...callers.map((f) => [`data repository: ${f}`, caller(f)])]) {
    for (const r of runBlocks(t)) assert.ok(!r.includes('${{'), `${f}: an expression inside a run step:\n${r.slice(0, 200)}`);
  }
});

test('only actions published by GitHub ("actions/...") are used, each pinned to a commit hash with its version in a comment (spec SC-04)', () => {
  const pins = new Map();
  for (const f of files) {
    for (const m of read(f).matchAll(/uses:\s*(\S+)(.*)/g)) {
      assert.match(m[1], /^actions\/[a-z-]+@[0-9a-f]{40}$/, `${f}: ${m[1]} is not pinned to a commit`);
      assert.match(m[2], /^ {3}# v\d+\.\d+\.\d+$/, `${f}: ${m[1]} has no "# vX.Y.Z" comment`);
      const key = `${m[1]}${m[2]}`.split('@')[0];
      pins.set(key, [...(pins.get(key) ?? new Set()), `${m[1]}${m[2]}`.split('@')[1]]);
    }
  }
  for (const [action, used] of pins) assert.equal(new Set(used).size, 1, `${action} is pinned to different commits: ${[...new Set(used)].join(', ')}`);
});

test('a data repository runs no code of its own: each workflow calls a reusable workflow of bg-db, at the same tag as the tools it checks out', () => {
  assert.deepEqual(callers.sort(), ['ingest.yml', 'issue-to-pr.yml', 'pages.yml', 'review-publish.yml', 'validate.yml']);
  for (const f of callers) {
    const t = caller(f);
    assert.ok(!/\n\s+(?:steps|run):/.test(t), `${f}: no step of its own`);
    const uses = [...t.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
    assert.equal(uses.length, 1, f);
    const m = uses[0].match(/^%%toolsRepository%%\/\.github\/workflows\/(data-[a-z-]+\.yml)@%%toolsRef%%$/);
    assert.ok(m, `${f}: ${uses[0]}`);
    assert.match(t, /\n {4}with:\n {6}tools-repository: %%toolsRepository%%\n {6}tools-ref: %%toolsRef%%\n {4}secrets: inherit\n$/, f);
    const called = read(m[1]);
    assert.match(called, /^on:\n  workflow_call:\n/m, `${m[1]} is reusable`);
    assert.ok(!/^on:\n(?!  workflow_call:)/m.test(called), `${m[1]} has no trigger of its own: it never runs in bg-db`);
  }
  for (const f of files.filter((x) => x.startsWith('data-'))) {
    const t = read(f);
    assert.match(t, /repository: \$\{\{ inputs\.tools-repository \}\}\n\s+ref: \$\{\{ inputs\.tools-ref \}\}\n\s+token: \$\{\{ secrets\.BGDB_TOOLS_TOKEN \|\| github\.token \}\}\n\s+path: tools\n\s+persist-credentials: false/, `${f}: the tools at the pinned tag`);
    assert.match(t, /node-version-file: tools\/\.node-version/, f);
    assert.ok(!/node (?!tools\/)\S*bgdb\.js/.test(t), `${f}: bgdb runs from tools/ only`);
  }
});

test('validate: a read-only pull_request workflow, the tools at the pinned tag, the configuration from the base branch, the pull request is data', () => {
  const c = caller('validate.yml');
  assert.match(c, /^on:\n  pull_request:/m);
  assert.match(c, /permissions:\n  contents: read/);
  assert.match(c, /^jobs:\n  validate:\n/m, 'the check is named "validate / validate"');
  const t = read('data-validate.yml');
  for (const x of [c, t]) assert.ok(!x.includes('pull_request_target'));
  assert.match(t, /permissions:\n  contents: read/);
  assert.ok(!/secrets\.(?!BGDB_TOOLS_TOKEN)/.test(t), 'no secret but the one that reads the tools');
  assert.match(t, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}\n\s+path: base\n\s+sparse-checkout: bgdb\.config\.json/);
  assert.match(t, /node tools\/packages\/cli\/bin\/bgdb\.js review \\\n\s+--inbox pr\/inbox --data pr\/data --config base\/bgdb\.config\.json/);
  assert.ok(!/working-directory: pr\b/.test(t) && !/node pr\//.test(t) && !/npm .*\n.*pr\//.test(t), 'nothing is run from the pull request');
  assert.equal((t.match(/persist-credentials: false/g) ?? []).length, 3);
});

test('review-publish: runs after validate in the context of the base repository, redoes the review itself, never runs the pull request', () => {
  const c = caller('review-publish.yml');
  assert.match(c, /workflow_run:\n    workflows: \[validate\]/);
  const t = read('data-review-publish.yml');
  assert.match(t, /if: github\.event\.workflow_run\.event == 'pull_request'/);
  assert.match(t, /node tools\/packages\/cli\/bin\/bgdb\.js review/);
  assert.match(t, /--config base\/bgdb\.config\.json/);
  assert.ok(!/working-directory: pr\b/.test(t) && !/node pr\//.test(t) && !/bash pr\//.test(t) && !/\.\/pr\//.test(t), 'nothing is run from pr/');
  assert.ok(!/download-artifact/.test(t), 'no artifact of the pull request is trusted');
  assert.ok(!/repository: \$\{\{ github\.event\.workflow_run\.head_repository/.test(t) && !/allow-unsafe-pr-checkout/.test(t), 'the pull request is never checked out (checkout refuses a fork in a workflow_run, rightly)');
  assert.match(t, /HEAD_REPO: \$\{\{ github\.event\.workflow_run\.head_repository\.full_name \}\}/, 'its name only reaches the shell through an environment variable');
  const fetch = t.slice(t.indexOf('The files the pull request adds to inbox/'), t.indexOf('- name: Review'));
  assert.match(fetch, /case "\$F" in inbox\/\*\) ;; \*\) continue ;; esac/, 'only files under inbox/ are fetched');
  assert.match(fetch, /grep -Fq '\.\.'/, 'no ".." in a fetched name');
  assert.match(fetch, /\?ref=\$HEAD_SHA" > "pr\/\$F"/, 'at the commit validate checked');
  assert.match(t, /--inbox pr\/inbox --data base\/data --config base\/bgdb\.config\.json/, 'the data and the configuration come from the default branch');
  assert.match(t, /gh pr merge "\$PR" -R "\$REPO" --squash --match-head-commit "\$HEAD_SHA"/, 'merged only as reviewed: not a commit pushed after the review');
  assert.ok(!/--auto\b/.test(t), 'no auto-merge: it needs a branch rule, which would also refuse the ingest\'s commits');
  assert.match(t, /- name: Merge when the review says it is safe\n\s+if: env\.PR != ''\n\s+env:\n\s+GH_TOKEN: \$\{\{ secrets\.BGDB_BOT_TOKEN \|\| github\.token \}\}/, 'the merge is made with the bot token, so that its push starts the ingest');
  for (const m of t.matchAll(/gh (?:pr|label) [a-z]+ [^\n]*/g)) assert.match(m[0], /-R "\$REPO"/, `the workspace is not a checkout of the repository: ${m[0]}`);
  assert.ok(!/gh pr view [^\n]*authorAssociation/.test(t), '"gh pr view --json" has no authorAssociation: the REST API is read instead');
  assert.match(t, /gh api "repos\/\$REPO\/pulls\/\$PR" > pr\.json[\s\S]*jq -r '\.author_association' pr\.json/);
});

test('ingest: only on the default branch, one run at a time, never cancelled, commits with a bot identity', () => {
  const c = caller('ingest.yml');
  assert.match(c, /branches: \[master\]/);
  assert.match(c, /^on:\n  workflow_dispatch:\n  push:/m, 'it can be run by hand');
  assert.match(c, /concurrency:\n  group: ingest\n  cancel-in-progress: false/);
  assert.match(c, /permissions:\n  contents: write\n  issues: write\n  actions: write/, 'actions: write lets it start the pages workflow');
  assert.ok(!/pull_request/.test(c));
  const t = read('data-ingest.yml');
  assert.match(t, /bgdb\.js ingest --contributor "\$CONTRIBUTOR"/);
  assert.match(t, /git add -A data inbox/);
  assert.match(t, /gh workflow run pages\.yml/);
});

test('issue-to-pr: only for issues labelled "submission", the issue text only through an environment variable, one pull request per issue', () => {
  assert.match(caller('issue-to-pr.yml'), /^on:\n  issues:/m);
  const t = read('data-issue-to-pr.yml');
  assert.match(t, /if: contains\(github\.event\.issue\.labels\.\*\.name, 'submission'\)/);
  assert.match(t, /ISSUE_BODY: \$\{\{ github\.event\.issue\.body \}\}/);
  assert.equal((t.match(/github\.event\.issue\.body/g) ?? []).length, 1, 'the issue body is read in exactly one place');
  assert.match(t, /BRANCH="submission\/issue-\$NUMBER"/);
  assert.match(t, /BGDB_BOT_TOKEN \|\| github\.token/);
  assert.match(t, /confirmed by @%s in the issue form/);
  assert.match(t, /if ! gh pr create [\s\S]*could not open the pull request by itself[\s\S]*exit 1/, 'a pull request that cannot be opened is said on the issue');
});

test('pages: bg-db publishes the site with sources.json; a data repository publishes its data/ only', () => {
  assert.match(read('pages.yml'), /npm run build -- --sources sources\.json/);
  const c = caller('pages.yml');
  assert.match(c, /permissions:\n  contents: read\n  pages: write\n  id-token: write/);
  assert.match(c, /paths: \['data\/\*\*'\]/);
  assert.match(read('data-pages.yml'), /node tools\/packages\/cli\/bin\/bgdb\.js build --data data --out dist --config bgdb\.config\.json/);
});

test('the issue form and the pull request template carry what the review expects (the rights line, the label)', () => {
  const form = fs.readFileSync(path.join(ROOT, 'templates/data-repo/.github/ISSUE_TEMPLATE/submit-match.yml'), 'utf8');
  assert.match(form, /labels: \["submission"\]/);
  assert.match(form, /id: transcript/);
  assert.match(form, /label: I have the right to share this/);
  const pr = fs.readFileSync(path.join(ROOT, 'templates/data-repo/.github/PULL_REQUEST_TEMPLATE.md'), 'utf8');
  assert.match(pr, /- \[ \] I have the right to share/);
});
