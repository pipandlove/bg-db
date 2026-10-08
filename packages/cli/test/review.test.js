import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../src/cli.js';
import { reviewInbox, classify, renderComment, parseIssueBody, issueToInbox, md, MARKER, rightsDeclared } from '../src/review.js';
import { loadConfig } from '../src/store.js';
import { FIXTURES } from '../../core/test/helpers.js';

const config = loadConfig('/nonexistent.json');
const OK_BODY = '- [x] I have the right to share these matches under the CC0 public-domain dedication.\n\nComment (optional):';
const FIX = {
  foxamon: 'foxamon/tester_vs_Osprey12_2026-08-10.mat',
  linnet: 'backgammon-studio/tester_-_Linnet14_7pt_Backgammon_Studio_2026_10_01_09_38_41.txt',
  remarks: 'extmatchdb/illegal-play-declared-in-remarks_7pt.txt',
  chText: 'choue-net/chouehandle-vs-Bot-all-games-s4020-2026-10-04.txt',
  chSgf: 'choue-net/chouehandle-vs-Bot-all-games-s4020-2026-10-04.sgf',
};

function work() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-review-'));
  fs.mkdirSync(path.join(root, 'inbox'));
  fs.mkdirSync(path.join(root, 'data'));
  const put = (key, name = path.basename(FIX[key])) => fs.copyFileSync(path.join(FIXTURES, FIX[key]), path.join(root, 'inbox', name));
  const review = () => reviewInbox({ inbox: path.join(root, 'inbox'), data: path.join(root, 'data'), config });
  return { root, put, review, inbox: path.join(root, 'inbox') };
}
const capture = () => { const lines = []; return { lines, io: { out: (s) => lines.push(s), err: (s) => lines.push(s) } }; };

test('review: new matches, an invalid file, and a duplicate inside the same submission', () => {
  const w = work();
  w.put('foxamon', 'a.mat'); w.put('foxamon', 'same-again.mat'); w.put('linnet', 'b.txt');
  fs.writeFileSync(path.join(w.inbox, 'bad.txt'), 'garbage');
  const r = w.review();
  assert.deepEqual(r.summary, { groups: 4, new: 2, partial: 0, duplicate: 1, enrich: 0, error: 1, warnings: 0 });
  const dup = r.groups.find((g) => g.status === 'duplicate');
  assert.equal(dup.duplicateOf, '(earlier in this submission)');
  const bad = r.groups.find((g) => g.status === 'error');
  assert.equal(bad.errors[0].code, 'V-FORMAT');
  assert.deepEqual(r.groups.find((g) => g.base === 'b').summary.players, ['tester', 'Linnet14']);
  assert.ok(!fs.existsSync(path.join(w.root, 'data/0001')), 'a review writes nothing to data/');
  assert.equal(fs.readdirSync(w.inbox).length, 4, 'and removes nothing from the inbox');
});

test('review: a match already in the database is a duplicate (with the id); what it brings that is new enriches the match, what is already there does not', async () => {
  const w = work();
  w.put('linnet', 'b.txt');
  const ing = capture();
  assert.equal(await main(['ingest', '--inbox', w.inbox, '--data', path.join(w.root, 'data'), '--config', path.join(w.root, 'none.json'), '--date', '2026-10-04'], ing.io), 0);
  // a plain duplicate: nothing to add
  w.put('linnet', 'again.txt');
  const plain = w.review();
  assert.deepEqual([plain.groups[0].status, plain.groups[0].duplicateOf, plain.groups[0].enrich], ['duplicate', '0001/2359e4c944b8d130', null]);
  assert.equal(classify(plain, { body: OK_BODY }).verdict, 'duplicate');
  // with a video link: it will be added to the existing match
  fs.writeFileSync(path.join(w.inbox, 'again.bgdb.json'), JSON.stringify({ links: [{ url: 'https://youtu.be/dQw4w9WgXcQ' }], tags: ['final'] }));
  const r = w.review();
  assert.equal(r.groups[0].status, 'duplicate');
  assert.deepEqual(r.groups[0].enrich, { links: 1, tags: 1, attachments: [] });
  assert.equal(r.groups[0].extrasIgnored, false);
  assert.deepEqual(r.summary, { groups: 1, new: 0, partial: 0, duplicate: 0, enrich: 1, error: 0, warnings: 0 });
  const d = classify(r, { body: OK_BODY });
  assert.deepEqual([d.verdict, d.autoMerge, d.labels], ['ready', true, ['ready', 'auto-merge', 'enrichment']]);
  assert.match(renderComment(r, d), /\| OK \| tester vs Linnet14.*\| already in the database as 0001\/2359e4c944b8d130; will add 1 video link, 1 tag to it \|/);
  // once the enrichment is in, the same extras are nothing new
  assert.equal(await main(['ingest', '--inbox', w.inbox, '--data', path.join(w.root, 'data'), '--config', path.join(w.root, 'none.json'), '--date', '2026-10-05'], capture().io), 0);
  w.put('linnet', 'third.txt');
  fs.writeFileSync(path.join(w.inbox, 'third.bgdb.json'), JSON.stringify({ links: [{ url: 'https://youtu.be/dQw4w9WgXcQ' }] }));
  const again = w.review();
  assert.equal(again.groups[0].enrich, null);
  assert.equal(again.groups[0].extrasIgnored, true);
  assert.match(renderComment(again, classify(again, { body: OK_BODY })), /what you added to it is already there/);
});

test('verdict: clean and inside inbox/ with the rights box ticked -> ready and may be merged automatically', () => {
  const w = work();
  w.put('foxamon', 'a.mat'); w.put('linnet', 'b.txt');
  const d = classify(w.review(), { changed: ['inbox/a.mat', 'inbox/b.txt'], body: OK_BODY });
  assert.deepEqual([d.verdict, d.autoMerge, d.labels, d.reasons], ['ready', true, ['ready', 'auto-merge'], []]);
});

test('verdict: errors, an unticked rights box, no match, too many matches -> needs-fix; nothing is merged automatically', () => {
  const w = work();
  w.put('foxamon', 'a.mat');
  assert.deepEqual(classify(w.review(), { body: 'no checkbox here' }).verdict, 'needs-fix');
  assert.match(classify(w.review(), { body: '- [ ] I have the right to share' }).reasons[0], /rights box/);
  fs.writeFileSync(path.join(w.inbox, 'bad.txt'), 'garbage');
  const d = classify(w.review(), { body: OK_BODY });
  assert.deepEqual([d.verdict, d.autoMerge, d.labels], ['needs-fix', false, ['needs-fix']]);
  const empty = classify({ groups: [], summary: { groups: 0, new: 0, duplicate: 0, error: 0, warnings: 0 } }, { body: OK_BODY });
  assert.deepEqual([empty.verdict, empty.labels, empty.autoMerge], ['empty', ['needs-fix'], false]);
  const many = { groups: Array.from({ length: 501 }, () => ({ status: 'new', warnings: [] })), summary: { groups: 501, new: 501, duplicate: 0, error: 0, warnings: 0 } };
  const dm = classify(many, { body: OK_BODY });
  assert.equal(dm.verdict, 'needs-fix');
  assert.match(dm.reasons[0], /please split it/);
  assert.ok(dm.labels.includes('bulk'));
});

test('verdict: changes outside inbox/, or an illegal play that was made, go to a human even though everything is valid', () => {
  const w = work();
  w.put('foxamon', 'a.mat');
  const outside = classify(w.review(), { changed: ['inbox/a.mat', 'packages/core/src/rules.js', '.github/workflows/ingest.yml'], body: OK_BODY });
  assert.deepEqual([outside.verdict, outside.autoMerge, outside.labels], ['needs-review', false, ['needs-review']]);
  assert.match(outside.reasons[0], /outside inbox\/: packages\/core\/src\/rules\.js, \.github\/workflows\/ingest\.yml/);
  const w2 = work();
  w2.put('remarks', 's.txt');
  const il = classify(w2.review(), { changed: ['inbox/s.txt'], body: OK_BODY });
  assert.deepEqual([il.verdict, il.autoMerge], ['needs-review', false]);
  assert.match(il.reasons[0], /V-ILLEGAL/);
});

test('verdict: the rights check is skipped when there is no description (a local review), and is satisfied by the bot-made description', () => {
  const w = work();
  w.put('foxamon', 'a.mat');
  assert.equal(classify(w.review(), {}).verdict, 'ready');
  assert.equal(rightsDeclared('Closes #4\n\n- [X] I have the right to share this match under the CC0 public-domain dedication (submitted through an issue form).'), true);
  assert.equal(rightsDeclared('- [ ] I have the right'), false);
  assert.equal(rightsDeclared(undefined), false);
});

test('the comment: friendly, a table, details with fixes, a next step; one marker so that it can be updated in place', () => {
  const w = work();
  w.put('foxamon', 'a.mat'); w.put('remarks', 'b.txt');
  fs.writeFileSync(path.join(w.inbox, 'bad.txt'), 'garbage');
  const report = w.review();
  const c = renderComment(report, classify(report, { body: OK_BODY }), { author: 'alice', welcome: true });
  assert.ok(c.startsWith(MARKER));
  assert.match(c, /Welcome, and thank you for your first contribution/);
  assert.match(c, /Thanks, @alice! I checked 3 matches\. A few things need fixing/);
  assert.match(c, /\| OK \| tester vs Osprey12, 3 pts, 1 game \| will be added \|/);
  assert.match(c, /\| Needs a fix \| bad\.txt \| Unexpected text before the first game/);
  assert.match(c, /Cup 2022 Final \(Match 2\), 6 games \| will be added, 1 video link/);
  assert.match(c, /error `V-FORMAT` \(line 1\)/);
  assert.match(c, /warning `V-ILLEGAL`/);
  assert.match(c, /\*\*Next:\*\* Nothing is lost/);
  const ready = (() => { const w2 = work(); w2.put('foxamon', 'a.mat'); const r = w2.review(); return renderComment(r, classify(r, { body: OK_BODY })); })();
  assert.match(ready, /merged automatically in about ten minutes/);
  assert.ok(!ready.includes('Details'));
  assert.ok(c.length < 60000);
});

test('the comment treats everything from a file as text: markdown, mentions, HTML and table breaks are neutralised', () => {
  assert.equal(md('a|b *x* _y_ `z` [l](u) <b>t</b> @alice #1'), 'a\\|b \\*x\\* \\_y\\_ \\`z\\` \\[l\\](u) \\<b\\>t\\</b\\> @\u200balice \\#1');
  const w = work();
  w.put('foxamon', 'a.mat');
  const evil = fs.readFileSync(path.join(w.inbox, 'a.mat'), 'utf8').replaceAll('Osprey12', '[click](http://evil.example) @maintainer <img src=x onerror=1> | x');
  fs.writeFileSync(path.join(w.inbox, 'a.mat'), evil);
  const report = w.review();
  const c = renderComment(report, classify(report, { body: OK_BODY }), { author: 'bob"><script>' });
  assert.ok(!/(?<!\\)</.test(c.replace(MARKER, '')), 'every "<" that comes from a file is escaped, so no HTML can start');
  assert.ok(!/(?<!\\)\[click\]\(/.test(c), 'no live markdown link');
  assert.ok(!c.includes('@maintainer'), 'no mention');
  assert.match(c, /Thanks, @bobscript!/);
});

test('bgdb review: prints the verdict, writes the report and the comment, exits 1 only when a fix is needed', async () => {
  const w = work();
  w.put('foxamon', 'a.mat');
  const body = path.join(w.root, 'body.md'); fs.writeFileSync(body, OK_BODY);
  const changed = path.join(w.root, 'changed.txt'); fs.writeFileSync(changed, 'inbox/a.mat\r\n');
  const rep = path.join(w.root, 'report.json'); const com = path.join(w.root, 'comment.md');
  const args = ['review', '--inbox', w.inbox, '--data', path.join(w.root, 'data'), '--config', path.join(w.root, 'none.json'), '--changed', changed, '--body', body, '--author', 'alice', '--report', rep, '--comment', com];
  const c = capture();
  assert.equal(await main(args, c.io), 0);
  assert.match(c.lines.join('\n'), /verdict: ready; 1 new, 0 duplicate\(s\), 0 with errors; labels: ready, auto-merge; may be merged automatically/);
  const report = JSON.parse(fs.readFileSync(rep, 'utf8'));
  assert.deepEqual([report.verdict, report.autoMerge, report.summary.new], ['ready', true, 1]);
  assert.ok(fs.readFileSync(com, 'utf8').startsWith(MARKER));
  fs.writeFileSync(path.join(w.inbox, 'bad.txt'), 'garbage');
  assert.equal(await main(args, capture().io), 1);
  fs.rmSync(path.join(w.inbox, 'bad.txt'));
  fs.writeFileSync(changed, 'inbox/a.mat\nsite/js/app.js\n');
  const c2 = capture();
  assert.equal(await main(args, c2.io), 0, 'needs-review is not a failure');
  assert.match(c2.lines.join('\n'), /verdict: needs-review/);
});

// ---- issue form -> file
const FORM = (t, box = '- [x] I have the right to share this under the CC0 public-domain dedication.') => `### Match transcript\n\n${t}\n\n### Rights\n\n${box}`;

test('issue form body: the first box and the rights box are found, in any line-ending style, fenced or not', () => {
  const text = fs.readFileSync(path.join(FIXTURES, FIX.foxamon), 'utf8').trim();
  const p = parseIssueBody(FORM(text));
  assert.deepEqual([p.transcript, p.rights], [text, true]);
  assert.equal(parseIssueBody(FORM(text).replace(/\n/g, '\r\n')).transcript, text.replace(/\r\n/g, '\n'));
  assert.equal(parseIssueBody(FORM('```\n' + text + '\n```')).transcript, text);
  assert.equal(parseIssueBody(FORM(text, '- [ ] I have the right to share this under the CC0 public-domain dedication.')).rights, false);
  assert.deepEqual(parseIssueBody(''), { transcript: '', attachments: [], zips: [], rights: false });
});

test('issue -> inbox: a match pasted as text is never used, even a valid one, and the reply asks to delete it from the public issue (decision 0025)', () => {
  const inbox = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-issue-')), 'inbox');
  const text = fs.readFileSync(path.join(FIXTURES, FIX.foxamon), 'utf8').trim();
  const pasted = issueToInbox({ body: FORM(text), number: 42, inbox, config });
  assert.deepEqual([pasted.ok, pasted.errors[0].code], [false, 'V-FORMAT']);
  assert.match(pasted.comment, /not a match pasted as text/);
  assert.match(pasted.comment, /delete the pasted text/);
  const empty = issueToInbox({ body: FORM(''), number: 43, inbox, config });
  assert.match(empty.errors[0].message, /no ZIP/);
  assert.ok(!fs.existsSync(inbox), 'nothing written');
});

test('bgdb from-issue: exit codes and the result file', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-issue-'));
  const body = path.join(root, 'body.md');
  const text = fs.readFileSync(path.join(FIXTURES, FIX.foxamon), 'utf8').trim();
  fs.writeFileSync(body, FORM(text));
  const result = path.join(root, 'result.json');
  assert.equal(await main(['from-issue', '--body', body, '--number', '7', '--inbox', path.join(root, 'inbox'), '--result', result, '--config', path.join(root, 'none.json')], capture().io), 1, 'a pasted match: refused');
  const r = JSON.parse(fs.readFileSync(result, 'utf8'));
  assert.equal(r.ok, false);
  assert.match(r.comment, /delete the pasted text/);
  assert.ok(!fs.existsSync(path.join(root, 'inbox')));
  assert.equal(await main(['from-issue'], capture().io), 2);
});
