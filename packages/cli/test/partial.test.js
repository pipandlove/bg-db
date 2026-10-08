/**
 * A match that can only be added partially (decision 0021) is shown to the contributor, with the .mat that would be stored, and is added
 * only when they accept it ({"accept": "partial"} in the match's .bgdb.json, the box of the Contribute page or of the issue form).
 * An archive imported with --salvage is accepted as a whole.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FIXTURES } from '../../core/test/helpers.js';
import { groupFiles, analyzeGroup, readMatch, matchHash16 } from '@bgdb/core';
import { main } from '../src/cli.js';
import { reviewInbox, classify, renderComment, issueToInbox } from '../src/review.js';

const tmpSite = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-partial-site-'));
fs.cpSync(path.join(FIXTURES, '..', 'site', 'js'), path.join(tmpSite, 'js'), { recursive: true });
fs.cpSync(path.join(FIXTURES, '..', 'packages', 'core', 'src'), path.join(tmpSite, 'lib', 'core'), { recursive: true });
const cm = await import(pathToFileURL(path.join(tmpSite, 'js', 'contribute-model.js')).href);

const config = { videoHosts: ['youtube.com', 'www.youtube.com', 'youtu.be'], sealPolicy: { maxAttachmentKB: 2048 }, license: 'CC0-1.0' };
// a 17-point match whose game 4 has a play that cannot be made (a 5-4 played as 9/4 8/2); game 5's score confirms game 4's result
const GOOD = fs.readFileSync(path.join(FIXTURES, 'extmatchdb/game-ends-dice-without-play_17pt.txt'), 'utf8');
const BROKEN = GOOD.replace('54: 9/4 8/4                 42: 8/4* 6/4', '54: 9/4 8/2                 42: 8/4* 6/4');
const enc = (s) => new TextEncoder().encode(s);
const group = (files) => groupFiles(files.map(([name, text]) => ({ name, bytes: enc(text), dir: '' })))[0];
const capture = () => { const lines = []; return { lines, text: () => lines.join('\n'), io: { out: (s) => lines.push(s), err: (s) => lines.push(s) } }; };
const ACCEPT = JSON.stringify({ accept: 'partial' });

test('the shared check: a match that can only be added partially is "partial", with what would be kept, what is wrong, and the .mat', () => {
  assert.notEqual(BROKEN, GOOD);
  const res = analyzeGroup(group([['m.txt', BROKEN]]), { config });
  assert.equal(res.status, 'partial');
  assert.equal(res.partial.accepted, false);
  assert.match(res.partial.notes[0].message, /^Game 4: the moves cannot be read .*confirmed by the score of game 5/);
  assert.equal(res.partial.errors[0].code, 'V-LEGAL', 'the error that a fix would remove');
  const stored = readMatch(res.normalised);                                // the .mat reads back alone, without salvage
  assert.equal(stored.ok, true, JSON.stringify(stored.errors));
  assert.match(res.normalised, /; \[ResultOnly "Game 4"\]/);
  assert.equal(matchHash16(stored.match), res.hash16);
  // accepted: by the sidecar, or by an archive import
  const yes = analyzeGroup(group([['m.txt', BROKEN], ['m.bgdb.json', ACCEPT]]), { config });
  assert.deepEqual([yes.status, yes.partial.accepted, yes.hash16], ['new', true, res.hash16]);
  assert.equal(analyzeGroup(group([['m.txt', BROKEN]]), { config, salvage: true }).status, 'new');
  const bad = analyzeGroup(group([['m.txt', BROKEN], ['m.bgdb.json', JSON.stringify({ accept: 'yes' })]]), { config });
  assert.equal(bad.status, 'partial');
  assert.ok(bad.warnings.some((w) => /"accept" can only be "partial"/.test(w.message)));
  assert.equal(analyzeGroup(group([['m.txt', GOOD]]), { config }).partial, undefined, 'a valid file is not partial');
});

test('ingest: a partial match stays in the inbox until it is accepted; check --out writes the .mat that would be stored', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-partial-'));
  const inbox = path.join(dir, 'inbox');
  const data = path.join(dir, 'data');
  fs.mkdirSync(inbox);
  fs.writeFileSync(path.join(inbox, 'm.txt'), BROKEN);
  const waiting = capture();
  assert.equal(await main(['ingest', '--inbox', inbox, '--data', data, '--date', '2026-10-06'], waiting.io), 1);
  assert.match(waiting.text(), /PARTIAL\s+m\.txt stays in the inbox: it can only be added partially\. Fix it, or accept with \{"accept": "partial"\} in m\.bgdb\.json/);
  assert.match(waiting.text(), /error\s+V-LEGAL line \d+: Game 4/);
  assert.match(waiting.text(), /how to fix/);
  assert.match(waiting.text(), /1 partial waiting for acceptance/);
  assert.deepEqual(fs.readdirSync(inbox), ['m.txt']);

  const out = path.join(dir, 'preview');
  assert.equal(await main(['check', path.join(inbox, 'm.txt'), '--salvage', '--out', out], capture().io), 0);
  const mat = fs.readFileSync(path.join(out, 'm.mat'), 'utf8');
  assert.match(mat, /; \[ResultOnly "Game 4"\]/);

  fs.writeFileSync(path.join(inbox, 'm.bgdb.json'), ACCEPT);
  const added = capture();
  assert.equal(await main(['ingest', '--inbox', inbox, '--data', data, '--date', '2026-10-06'], added.io), 0, added.text());
  assert.match(added.text(), /added\s+0001\/[0-9a-f]{16}\s+\(m\.txt\)\s+PARTIAL \(accepted\)/);
  assert.equal(fs.readdirSync(inbox).length, 0);
  const stored = fs.readdirSync(path.join(data, '0001', 'matches'), { recursive: true }).find((f) => f.endsWith('.mat'));
  assert.equal(fs.readFileSync(path.join(data, '0001', 'matches', stored), 'utf8'), mat, 'what was shown is what is stored');
});

test('review: "needs-confirmation" until the contributor agrees; the comment shows what is kept, how to agree, the errors and the .mat', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-partial-review-'));
  const inbox = path.join(dir, 'inbox');
  fs.mkdirSync(path.join(inbox, 'club'), { recursive: true });
  fs.writeFileSync(path.join(inbox, 'club', 'm.txt'), BROKEN);
  const body = '- [x] I have the right to share these matches under the CC0 public-domain dedication.';
  const r = reviewInbox({ inbox, data: path.join(dir, 'data'), config });
  assert.equal(r.summary.partial, 1);
  const d = classify(r, { body });
  assert.deepEqual([d.verdict, d.autoMerge], ['needs-confirmation', false]);
  assert.ok(d.labels.includes('partial') && d.labels.includes('needs-confirmation'));
  const c = renderComment(r, d);
  assert.match(c, /\| Partial \| .* \| can be added partially: 1 game cannot be read; waiting for your agreement \|/);
  assert.match(c, /Game 4: the moves cannot be read/);
  assert.match(c, /`inbox\/club\/m\.bgdb\.json` must contain: `\{"accept": "partial"\}`/);
  assert.match(c, /Or fix the file, and the whole match will be added: error `V-LEGAL`/);
  assert.match(c, /<details><summary>The match as it would be stored \(\.mat\)/);
  assert.match(c, /; \[ResultOnly "Game 4"\]/);

  fs.writeFileSync(path.join(inbox, 'club', 'm.bgdb.json'), ACCEPT);
  const r2 = reviewInbox({ inbox, data: path.join(dir, 'data'), config });
  const d2 = classify(r2, { body });
  assert.deepEqual([d2.verdict, d2.autoMerge, d2.labels], ['ready', true, ['ready', 'auto-merge', 'partial']]);
  assert.match(renderComment(r2, d2), /will be added \*\*partially\*\* \(you agreed\)/);
});

test('issue form: shown first; with "Add it partially" ticked, the file is written with its acceptance', () => {
  const FORM = (text, partial) => `### Match transcript\n\n${text}\n\n### Event or site (optional)\n\n_No response_\n\n### Rights\n\n- [x] I have the right to share this under the CC0 public-domain dedication.\n\n### Partial match\n\n- [${partial ? 'x' : ' '}] Add it partially if some games cannot be read.`;
  const inbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-partial-issue-'));
  const no = issueToInbox({ body: FORM(BROKEN, false), number: 7, inbox, config });
  assert.deepEqual([no.ok, no.partial], [false, true]);
  assert.match(no.comment, /can be added \*\*partially\*\*/);
  assert.match(no.comment, /tick \*\*"Add it partially"\*\*/);
  assert.match(no.comment, /; \[ResultOnly "Game 4"\]/);
  assert.equal(fs.readdirSync(inbox).length, 0, 'nothing written');
  const yes = issueToInbox({ body: FORM(BROKEN, true), number: 7, inbox, config });
  assert.deepEqual([yes.ok, yes.partial], [true, true]);
  assert.deepEqual(fs.readdirSync(inbox).sort(), ['issue-7.bgdb.json', 'issue-7.txt']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(inbox, 'issue-7.bgdb.json'), 'utf8')), { accept: 'partial' });
});

test('Contribute page: a partial match is named but sent only when its box is ticked, with the acceptance in its .bgdb.json', () => {
  const items = cm.prepare([{ name: 'm.txt', bytes: enc(BROKEN) }], { config, known: new Map() });
  assert.equal(items[0].res.status, 'partial');
  assert.ok(items[0].base, 'it has a name, ready to be sent');
  assert.equal(cm.sendable(items[0]), false);
  assert.deepEqual(cm.packageFiles(items), [], 'not ticked: nothing to send');
  items[0].acceptPartial = true;
  const files = cm.packageFiles(items);
  const side = files.find((f) => f.name.endsWith('.bgdb.json'));
  assert.deepEqual(JSON.parse(side.bytes), { accept: 'partial' });
  assert.ok(files.some((f) => f.name === `${items[0].base}.txt`));
  assert.match(decodeURIComponent(cm.issueFormLink({ repository: 'owner/repo' }, items)), /title=Matches: /, 'an accepted partial match goes by the ZIP like any other');
});
