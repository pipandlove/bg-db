/**
 * Event, round and date from review to site (decision 0022): `bgdb meta` writes a review sheet and applies it to the sidecars, the ingest
 * uses them and warns about matches the list cannot tell apart, corrections after the ingest are enrichments applied by the site.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { main } from '../src/cli.js';
import { readSheet } from '../src/meta.js';
import { FIXTURES } from '../../core/test/helpers.js';

const ROLLER = ['xg-text/me-XG_Roller__03-10-2026.txt', 'xg-text/me-XG_Roller__03-10-2026__2.txt', 'xg-text/me-XG_Roller__03-10-2026__3.txt'];
const SITE = path.resolve(FIXTURES, '../site');
const TWINS = ['extmatchdb/galaxy-resign-without-marker_7pt.txt', 'extmatchdb/galaxy-hidden-play-ends-match_7pt.txt'];   // same players, same day

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-meta-'));
  const a = (rel) => path.join(root, rel);
  fs.mkdirSync(a('inbox'));
  const drop = (rel, name = path.basename(rel)) => fs.copyFileSync(path.join(FIXTURES, rel), a(`inbox/${name}`));
  const run = async (...args) => { const lines = []; const code = await main(args, { out: (s) => lines.push(s), err: (s) => lines.push(s) }); return { code, text: lines.join('\n') }; };
  const common = ['--config', a('none.json')];
  return {
    a, drop,
    meta: (...x) => run('meta', '--inbox', a('inbox'), '--data', a('data'), ...common, ...x),
    ingest: (...x) => run('ingest', '--inbox', a('inbox'), '--data', a('data'), '--date', '2026-10-06', '--contributor', 'tester', ...common, ...x),
    enrich: (...x) => run('enrich', ...x, '--data', a('data'), '--date', '2026-10-06', ...common),
    build: () => run('build', '--data', a('data'), '--out', a('dist'), '--site', SITE, ...common),
  };
}

const metaOf = (w, id) => { const [shard, hash] = id.split('/'); return JSON.parse(fs.readFileSync(w.a(`data/${shard}/matches/${hash.slice(0, 2)}/${hash}.meta.json`), 'utf8')); };
const idsIn = (text) => [...text.matchAll(/added +(\d{4}\/[0-9a-f]{16})\s+\(([^)]+)\)/g)].map((m) => ({ id: m[1], file: m[2] }));

test('meta: the sheet proposes the numbers of a series from the file names; --apply writes the reviewed values; the ingest uses them', async () => {
  const w = workspace();
  for (const f of ROLLER) w.drop(f);
  const r = await w.meta('--sheet', w.a('sheet.tsv'));
  assert.equal(r.code, 0);
  assert.match(r.text, /3 match file\(s\) read; 3 row\(s\) to review/);
  const sheet = fs.readFileSync(w.a('sheet.tsv'), 'utf8');
  const rows = readSheet(sheet).rows;
  assert.deepEqual(rows.map((x) => [x.status, x.file, x.round]), [
    ['series', 'me-XG_Roller__03-10-2026__2.txt', 'Match 2'], ['series', 'me-XG_Roller__03-10-2026__3.txt', 'Match 3'], ['series', 'me-XG_Roller__03-10-2026.txt', ''],
  ]);
  assert.equal(fs.readdirSync(w.a('inbox')).filter((f) => f.endsWith('.bgdb.json')).length, 0, 'writing the sheet changes nothing in the inbox');

  // the reviewer fills the round of the first session and gives them all an event
  const edited = sheet.split('\n').map((l, i) => {
    if (i === 0 || !l) return l;
    const c = l.split('\t');
    c[8] = 'Evening practice';                                   // columns: status, action, group, file, players, length, date, time, event, round
    if (!c[9]) c[9] = 'Match 1';
    return c.join('\t');
  }).join('\n');
  fs.writeFileSync(w.a('sheet.tsv'), edited);
  const dry = await w.meta('--apply', w.a('sheet.tsv'), '--dry-run');
  assert.match(dry.text, /3 sidecar\(s\) to write, 0 match\(es\) to reject, 0 unchanged \(dry run/);
  assert.equal(fs.readdirSync(w.a('inbox')).filter((f) => f.endsWith('.bgdb.json')).length, 0);
  const applied = await w.meta('--apply', w.a('sheet.tsv'));
  assert.equal(applied.code, 0);
  assert.match(applied.text, /3 sidecar\(s\) written, 0 match\(es\) rejected \(moved out of the inbox\), 0 unchanged/);
  assert.deepEqual(JSON.parse(fs.readFileSync(w.a('inbox/me-XG_Roller__03-10-2026__2.bgdb.json'), 'utf8')), { event: 'Evening practice', round: 'Match 2' },
    'only what differs from the headers is written');
  assert.match((await w.meta('--apply', w.a('sheet.tsv'))).text, /0 sidecar\(s\) written, 0 match\(es\) rejected .*, 3 unchanged/, 'applying again changes nothing');
  assert.match((await w.meta('--sheet', w.a('again.tsv'))).text, /0 row\(s\) to review/, 'nothing left to review');

  const ing = await w.ingest();
  assert.equal(ing.code, 0);
  assert.doesNotMatch(ing.text, /Nothing tells it apart/);
  const byFile = Object.fromEntries(idsIn(ing.text).map((x) => [x.file, metaOf(w, x.id)]));
  assert.deepEqual(['me-XG_Roller__03-10-2026.txt', 'me-XG_Roller__03-10-2026__2.txt', 'me-XG_Roller__03-10-2026__3.txt'].map((f) => [byFile[f].event, byFile[f].round]),
    [['Evening practice', 'Match 1'], ['Evening practice', 'Match 2'], ['Evening practice', 'Match 3']]);
});

test('meta: copies of one match are marked "duplicate", by their moves or, among look-alikes, by their identity', async () => {
  const w = workspace();
  const text = fs.readFileSync(path.join(FIXTURES, TWINS[0]), 'utf8');
  fs.writeFileSync(w.a('inbox/a.txt'), text);
  fs.writeFileSync(w.a('inbox/b.txt'), text.replace(/^(; \[Site ")[^"]*/m, '$1Elsewhere'));                       // another header, the same moves
  fs.writeFileSync(w.a('inbox/c.txt'), text.replace(/^(\s*\d+\)) /gm, '$1   '));                                   // another layout: only the identity sees it
  const r = await w.meta('--sheet', w.a('sheet.tsv'));
  assert.match(r.text, /2 copies of another file/);
  assert.match(r.text, /0 that nothing tells apart/);
  const rows = readSheet(fs.readFileSync(w.a('sheet.tsv'), 'utf8')).rows.filter((x) => x.status === 'duplicate');
  assert.deepEqual(rows.map((x) => [x.file, x.note.slice(0, 19)]), [['b.txt', 'same moves as a.txt'], ['c.txt', 'same moves as a.txt']]);
});

test('two transcriptions of one match: the better one is kept by itself; when none is better, the sheet asks, and "reject" moves one out', async () => {
  const w = workspace();
  const text = fs.readFileSync(path.join(FIXTURES, 'opengammon/vireo_vs_tester_2026-09-30.mat'), 'utf8');
  const typo1 = text.replace('52: 24/22 13/8', '52: 24/22 13/7');                       // game 1 cannot be read
  const typo2 = text.replace('13: 8/5 6/5', '13: 8/5 6/4');                             // game 3 cannot be read
  assert.notEqual(typo1, text); assert.notEqual(typo2, text);

  // a valid file and a copy with a typo: the ingest keeps the valid one by itself
  fs.writeFileSync(w.a('inbox/good.mat'), text);
  fs.writeFileSync(w.a('inbox/typo.mat'), typo1);
  let r = await w.meta('--sheet', w.a('sheet.tsv'));
  assert.match(r.text, /1 superseded by a better transcription/);
  assert.match(fs.readFileSync(w.a('sheet.tsv'), 'utf8'), /superseded\t\t\ttypo\.mat\t.*the ingest keeps good\.mat \(valid\); this one is valid only by salvage/);
  fs.rmSync(w.a('inbox/good.mat')); fs.rmSync(w.a('inbox/typo.mat'));

  // two copies with a typo each: nothing ranks them, the sheet asks
  fs.writeFileSync(w.a('inbox/aa.mat'), typo1);
  fs.writeFileSync(w.a('inbox/bb.mat'), typo2);
  r = await w.meta('--sheet', w.a('sheet.tsv'));
  assert.match(r.text, /2 transcriptions of one match that nothing ranks/);
  const sheet = fs.readFileSync(w.a('sheet.tsv'), 'utf8');
  assert.match(sheet, /near-duplicate\t\t\d+\taa\.mat\t.*another transcription of bb\.mat: 100\.0% of the rolls in common/);
  const dry = await w.ingest('--salvage', '--dry-run');
  assert.match(dry.text, /warning V-COPY: Another transcription of this match is bb\.mat/, 'without a choice, both are kept, with a warning');

  fs.writeFileSync(w.a('sheet.tsv'), sheet.replace(/^near-duplicate\t\t(.*\tbb\.mat\t)/m, 'near-duplicate\treject\t$1'));
  r = await w.meta('--apply', w.a('sheet.tsv'));
  assert.match(r.text, /1 match\(es\) rejected \(moved out of the inbox\)/);
  assert.deepEqual(fs.readdirSync(w.a('inbox')), ['aa.mat']);
  assert.ok(fs.existsSync(w.a('rejected/bb.mat')), 'moved to rejected/ next to the inbox');
  assert.match(fs.readFileSync(w.a('rejected/REASONS.md'), 'utf8'), /- bb\.mat: rejected in the review of sheet\.tsv \(another transcription of aa\.mat/);
  assert.match((await w.meta('--apply', w.a('sheet.tsv'))).text, /0 match\(es\) rejected/, 'applying again: already rejected, not an error');
  fs.writeFileSync(w.a('inbox/bb.mat'), typo2);                                         // a restart brings the file back ...
  assert.match((await w.meta('--apply', w.a('sheet.tsv'))).text, /1 match\(es\) rejected/, '... and the same sheet rejects it again');
  const ing = await w.ingest('--salvage');
  assert.match(ing.text, /1 added/);
  assert.doesNotMatch(ing.text, /V-COPY/);
});

test('meta: refused rows are reported (unknown file, bad date); a missing sheet is a usage error', async () => {
  const w = workspace();
  w.drop(ROLLER[0]);
  fs.writeFileSync(w.a('sheet.tsv'), 'file\tdate\tevent\tround\nnot-there.txt\t\t\t\nme-XG_Roller__03-10-2026.txt\t03.10.2026\t\t\n');
  const r = await w.meta('--apply', w.a('sheet.tsv'));
  assert.equal(r.code, 1);
  assert.match(r.text, /not-there\.txt: no such match/);
  assert.match(r.text, /me-XG_Roller__03-10-2026\.txt: "date" was ignored/);
  assert.equal((await w.meta('--apply', w.a('nope.tsv'))).code, 2);
});

test('ingest warns about a match the list cannot tell apart from another; a correction (enrich, or a duplicate with a sidecar) fixes it', async () => {
  const w = workspace();
  for (const f of TWINS) w.drop(f);
  const ing = await w.ingest();
  assert.equal(ing.code, 0, 'a warning, never a refusal');
  assert.equal((ing.text.match(/warning V-META: Nothing tells it apart from 0001\/[0-9a-f]{16} in the list/g) ?? []).length, 1);
  const [first, second] = idsIn(ing.text);

  // the sheet also sees a new file that looks the same as a stored match
  w.drop(TWINS[1], 'zz.txt');                                      // a name that suggests nothing
  const m = await w.meta('--sheet', w.a('sheet.tsv'));
  assert.match(m.text, /1 that nothing tells apart/);
  assert.match(fs.readFileSync(w.a('sheet.tsv'), 'utf8'), new RegExp(`looks the same as 0001/[0-9a-f]{16}, already stored`));
  fs.rmSync(w.a('inbox/zz.txt'));

  // corrections by command
  const e = await w.enrich(first.id, '--event', 'Spring Cup', '--round', 'Final - Match 1');
  assert.equal(e.code, 0);
  assert.match(e.text, /added event, round corrected/);
  assert.match((await w.enrich(first.id, '--round', 'Final - Match 1')).text, /nothing new to add/);
  assert.equal((await w.enrich(first.id, '--match-date', '08.02.2025')).code, 1, 'a date is written 2025-02-08');
  const record = JSON.parse(fs.readFileSync(w.a(`data/enrichments/0001/${first.id.slice(5, 7)}/${first.id.slice(5)}.json`), 'utf8'));
  assert.deepEqual(record.meta, { event: 'Spring Cup', round: 'Final - Match 1' });

  // a correction by contribution: the same match again, with a reviewed sidecar
  w.drop(path.join(path.dirname(TWINS[0]), path.basename(second.file)), second.file);
  fs.writeFileSync(w.a(`inbox/${second.file.replace(/\.txt$/, '.bgdb.json')}`), JSON.stringify({ event: 'Spring Cup', round: 'Final - Match 2' }));
  const again = await w.ingest();
  assert.match(again.text, new RegExp(`enriched +${second.id.replace('/', '\\/')} .*event, round corrected`));
  assert.equal(fs.readdirSync(w.a('inbox')).length, 0);

  // the stored files are not touched; the overlay carries the corrections; the site applies them to the rows and sorts again
  assert.equal(metaOf(w, first.id).event, null);
  const b = await w.build();
  assert.equal(b.code, 0, b.text);
  const reg = JSON.parse(fs.readFileSync(w.a('dist/registry.json'), 'utf8'));
  const overlay = JSON.parse(zlib.gunzipSync(fs.readFileSync(w.a(`dist/${reg.overlays.enrichments}`))).toString());
  assert.deepEqual(overlay.items[first.id].meta, { event: 'Spring Cup', round: 'Final - Match 1' });
  assert.deepEqual(overlay.items[second.id].meta, { event: 'Spring Cup', round: 'Final - Match 2' });

  const { applyEnrichments, compareRows } = await import(pathToFileURL(w.a('dist/js/catalog.js')).href);   // the module as it ships
  const row = (id, round) => ({ id, p0: 'A', p1: 'B', n0: 'a', n1: 'b', event: '', eventNorm: '', round, roundNorm: round.toLowerCase(), hay: '', date: '2025-02-08', year: 2025, flags: 0 });
  const rows = applyEnrichments([row(second.id, ''), row(first.id, '')], overlay.items).sort(compareRows);
  assert.deepEqual(rows.map((r) => [r.id, r.event, r.round, r.eventNorm]), [[first.id, 'Spring Cup', 'Final - Match 1', 'spring cup'], [second.id, 'Spring Cup', 'Final - Match 2', 'spring cup']]);
  assert.match(rows[0].hay, /spring cup final - match 1/);
  const cleared = applyEnrichments([row('0001/x', 'Final')], { '0001/x': { links: [], tags: [], attachments: [], meta: { round: null, date: '2024' } } });
  assert.deepEqual([cleared[0].round, cleared[0].date, cleared[0].year], ['', '2024', 2024]);
});
