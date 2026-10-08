/**
 * The issue route with the ZIP of the Contribute page dropped into the "Submit a match" form (tools v8): its link is read from the form,
 * the file is downloaded from GitHub only, checked as the pull request will check it, and answered on the issue. After the ingest, the
 * contributor gets the links to the matches.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { main } from '../src/cli.js';
import { parseIssueBody, issueToInbox, downloadAttachment, MARKER } from '../src/review.js';
import { ingest, ingestComment } from '../src/ingest.js';
import { loadConfig } from '../src/store.js';
import { FIXTURES } from '../../core/test/helpers.js';

// the site modules import ../lib/core: load them from a built copy
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-issue-zip-site-'));
fs.cpSync(path.join(FIXTURES, '..', 'site', 'js'), path.join(tmp, 'js'), { recursive: true });
fs.cpSync(path.join(FIXTURES, '..', 'packages', 'core', 'src'), path.join(tmp, 'lib', 'core'), { recursive: true });
const { makeZip } = await import(pathToFileURL(path.join(tmp, 'js', 'zip.js')).href);
const cm = await import(pathToFileURL(path.join(tmp, 'js', 'contribute-model.js')).href);

const config = loadConfig('/nonexistent.json');
const bytes = (rel) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, rel)));
const FOX = 'foxamon/tester_vs_Osprey12_2026-08-10.mat';
const URL1 = 'https://github.com/user-attachments/files/23456789/matches-for-bgdb.zip';
const TICK = '- [x] I have the right to share this under the CC0 public-domain dedication.';
const UNTICK = '- [ ] I have the right to share this under the CC0 public-domain dedication.';
const FORM = (box, rights = TICK) => `### Your matches\n\n${box}\n\n### Event or site (optional, for pasted text)\n\n_No response_\n\n### Rights\n\n${rights}\n\n### Partial match\n\n- [ ] Add it partially if some games cannot be read.`;
const DROPPED = (url = URL1) => `[${url.split('/').pop()}](${url})`;

/** the ZIP the Contribute page makes (its rights statement inside), or a plain one without it */
const pageZip = (rels) => makeZip(cm.packageFiles(cm.prepare(rels.map((r) => ({ name: path.basename(r), bytes: bytes(r) })), { config, known: new Map() }), () => ({ links: [], tags: [] }), 'CC0-1.0'));
const plainZip = (rels) => makeZip(rels.map((r) => ({ name: path.basename(r), bytes: bytes(r) })));

function work() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-issue-zip-'));
  return { root, inbox: path.join(root, 'inbox'), data: path.join(root, 'data') };
}

/** a fetch that answers like GitHub: the attachment link redirects to its file storage */
function fakeFetch(data, { status = 200, host = 'objects.githubusercontent.com', length = null, fail = null } = {}) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (fail) throw new Error(fail);
    return {
      ok: status >= 200 && status < 300, status, url: `https://${host}/github-production-repository-file-5c1aeb/1/2?X-Amz=...`,
      headers: { get: (h) => (h === 'content-length' && length !== null ? String(length) : null) },
      body: (async function* () { for (let i = 0; i < data.length; i += 1000) yield data.subarray(i, i + 1000); })(),
    };
  };
  return { fn, calls };
}

// ------------------------------------------------------------------------------------------------ the form

test('the form: a dropped ZIP is found by its link, under the new label and the old one; other text in the first box is the transcript (reported, never used)', () => {
  const p = parseIssueBody(FORM(DROPPED()));
  assert.deepEqual([p.attachments, p.zips, p.rights], [[URL1], [URL1], true]);
  assert.deepEqual(parseIssueBody(FORM(DROPPED()).replace('### Your matches', '### Match transcript')).zips, [URL1]);
  const two = parseIssueBody(FORM(`${DROPPED()}\n${DROPPED(URL1.replace('23456789', '23456790'))}\n${DROPPED()}`));
  assert.equal(two.zips.length, 2, 'the same link twice counts once');
  const txt = parseIssueBody(FORM('[a.txt](https://github.com/user-attachments/files/1/a.txt)'));
  assert.deepEqual([txt.attachments.length, txt.zips.length], [1, 0]);
  assert.deepEqual(parseIssueBody(FORM('[x.zip](https://example.com/user-attachments/files/1/x.zip)')).attachments, [], 'only GitHub\'s own attachment links');
  const text = fs.readFileSync(path.join(FIXTURES, FOX), 'utf8').trim();
  assert.equal(parseIssueBody(FORM(text)).transcript, text);
});

// ------------------------------------------------------------------------------------------------ the download

test('download: GitHub\'s attachment link only, over https, to GitHub\'s hosts, within the size limit', async () => {
  const z = plainZip([FOX]);
  const ok = await downloadAttachment(URL1, { fetchFn: fakeFetch(z).fn });
  assert.deepEqual(ok.bytes, z);
  const f = fakeFetch(z);
  assert.match((await downloadAttachment('https://evil.example/user-attachments/files/1/x.zip', { fetchFn: f.fn })).error, /not a file attached to this issue/);
  assert.match((await downloadAttachment(`${URL1}?x=1`, { fetchFn: f.fn })).error, /not a file attached/);
  assert.equal(f.calls.length, 0, 'nothing is fetched from a link that is not an attachment');
  assert.match((await downloadAttachment(URL1, { fetchFn: fakeFetch(z, { host: 'evil.example' }).fn })).error, /somewhere else than GitHub/);
  assert.match((await downloadAttachment(URL1, { fetchFn: fakeFetch(z, { status: 404 }).fn })).error, /HTTP 404/);
  assert.match((await downloadAttachment(URL1, { fetchFn: fakeFetch(z, { fail: 'getaddrinfo ENOTFOUND' }).fn })).error, /could not be downloaded \(getaddrinfo/);
  assert.match((await downloadAttachment(URL1, { fetchFn: fakeFetch(z, { length: 99_999_999 }).fn })).error, /larger than 25 MB/);
  assert.match((await downloadAttachment(URL1, { fetchFn: fakeFetch(z).fn, maxBytes: 1500 })).error, /larger than/, 'a size not announced is still counted while reading');
});

// ------------------------------------------------------------------------------------------------ the check on the issue

test('a dropped ZIP that can be merged becomes inbox/issue-N.zip, with an answer that says nothing more is needed', () => {
  const w = work();
  const r = issueToInbox({ body: FORM(DROPPED()), number: 12, inbox: w.inbox, data: w.data, config, zip: { bytes: pageZip([FOX]) } });
  assert.equal(r.ok, true, r.comment);
  assert.equal(r.verdict, 'ready');
  assert.equal(path.basename(r.file), 'issue-12.zip');
  assert.deepEqual(new Uint8Array(fs.readFileSync(r.file)), pageZip([FOX]), 'the ZIP as it is: review and ingest read it');
  assert.ok(r.comment.startsWith(MARKER));
  assert.match(r.comment, /checked the 1 match of your ZIP/);
  assert.match(r.comment, /\| OK \| tester vs Osprey12/);
  assert.match(r.comment, /You do not need to do anything/);
  // the rights: the box of the form, or the statement the page wrote into the ZIP
  assert.equal(issueToInbox({ body: FORM(DROPPED(), UNTICK), number: 13, inbox: w.inbox, data: w.data, config, zip: { bytes: pageZip([FOX]) } }).ok, true);
  const none = issueToInbox({ body: FORM(DROPPED(), UNTICK), number: 14, inbox: w.inbox, data: w.data, config, zip: { bytes: plainZip([FOX]) } });
  assert.deepEqual([none.ok, none.errors[0].code], [false, 'V-RIGHTS']);
  assert.match(none.comment, /tick "I have the right to share this"/);
  assert.ok(!fs.existsSync(path.join(w.inbox, 'issue-14.zip')));
});

test('a dropped ZIP that cannot be used: the answer says what to do, and nothing is written', () => {
  const w = work();
  const at = (body, zip, n) => issueToInbox({ body, number: n, inbox: w.inbox, data: w.data, config, zip });
  const broken = at(FORM(DROPPED()), { bytes: new TextEncoder().encode('not a zip') }, 1);
  assert.match(broken.comment, /The ZIP cannot be read: it is not a ZIP archive\. Fix it on the Contribute page/);
  const bad = at(FORM(DROPPED()), { bytes: makeZip([{ name: 'm.txt', bytes: 'this is not a match' }]) }, 2);
  assert.equal(bad.ok, false);
  assert.match(bad.comment, /\*\*What to fix\*\*\n\n- \*\*m\.txt\*\*: error `V-FORMAT`/, 'the file named as in the ZIP');
  assert.match(bad.comment, /drop the new ZIP there/);
  assert.match(at(FORM(DROPPED()), { error: 'matches-for-bgdb.zip could not be downloaded (HTTP 404)' }, 3).comment, /could not be downloaded \(HTTP 404\)\. Edit the issue/);
  assert.match(at(FORM(`${DROPPED()}\n${DROPPED(URL1.replace('23456789', '1'))}`), null, 4).comment, /more than one ZIP/);
  assert.match(at(FORM('[a.txt](https://github.com/user-attachments/files/1/a.txt)'), null, 5).comment, /not the ZIP of the Contribute page/);
  assert.match(at(FORM(DROPPED()), { bytes: makeZip([{ name: 'CONTRIBUTION.md', bytes: '# x' }]) }, 6).comment, /holds no match file/);
  assert.ok(!fs.existsSync(w.inbox), 'nothing written for any of them');
  // already in the database: said, and no pull request
  ingest({ inbox: (fs.mkdirSync(w.inbox), fs.writeFileSync(path.join(w.inbox, 'fox.mat'), bytes(FOX)), w.inbox), data: w.data, config, contributor: 't', submittedAt: '2026-10-07' });
  const dup = at(FORM(DROPPED()), { bytes: pageZip([FOX]) }, 7);
  assert.equal(dup.ok, false);
  assert.match(dup.comment, /\| Skipped \| tester vs Osprey12[^\n]*already in the database as 0001\/[0-9a-f]{16}/);
  assert.match(dup.comment, /nothing to add/);
  assert.deepEqual(fs.readdirSync(w.inbox), []);
});

test('bgdb from-issue downloads the dropped ZIP (through io.fetch in this test) and writes it to the inbox', async () => {
  const w = work();
  const body = path.join(w.root, 'body.md');
  fs.writeFileSync(body, FORM(DROPPED()));
  const result = path.join(w.root, 'result.json');
  const f = fakeFetch(pageZip([FOX]));
  const lines = [];
  const io = { out: (s) => lines.push(s), err: (s) => lines.push(s), fetch: f.fn };
  assert.equal(await main(['from-issue', '--body', body, '--number', '21', '--inbox', w.inbox, '--data', w.data, '--result', result, '--config', '/nonexistent.json'], io), 0, lines.join('\n'));
  assert.deepEqual(f.calls, [URL1]);
  assert.equal(JSON.parse(fs.readFileSync(result, 'utf8')).verdict, 'ready');
  assert.ok(fs.existsSync(path.join(w.inbox, 'issue-21.zip')));
});

// ------------------------------------------------------------------------------------------------ the answer after the ingest

test('after the ingest: the contributor gets the links to the matches on the site', () => {
  const w = work();
  fs.mkdirSync(w.inbox);
  fs.writeFileSync(path.join(w.inbox, 'issue-12.zip'), pageZip([FOX]));
  const rep = ingest({ inbox: w.inbox, data: w.data, config, contributor: 't', submittedAt: '2026-10-07' });
  const id = rep.results.find((r) => r.status === 'added').id;
  const c = ingestComment(rep, { siteUrl: 'https://owner.github.io/bgdb' });
  assert.match(c, /^Done: 1 match is now in the database\. Thank you!/);
  assert.ok(c.includes(`- tester vs Osprey12, 3 pts: [${id}](https://owner.github.io/bgdb/#m=${encodeURIComponent(id)})`), c);
  assert.match(c, /within a few minutes/);
  assert.ok(ingestComment(rep).includes(`\`${id}\``), 'without siteUrl, the identifier');
  fs.writeFileSync(path.join(w.inbox, 'again.mat'), bytes(FOX));
  const again = ingestComment(ingest({ inbox: w.inbox, data: w.data, config, contributor: 't', submittedAt: '2026-10-07' }), { siteUrl: 'https://owner.github.io/bgdb/' });
  assert.match(again, /^The ingest has run, but nothing new was added\.\n\n- tester vs Osprey12, 3 pts: already in the database/);
});
