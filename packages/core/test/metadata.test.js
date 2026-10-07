/**
 * Event, round and date (decision 0022): headers cleaned automatically, file names read as proposals, matches the list cannot tell apart.
 * Names in these tests are made up.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteEvent, cleanHeaderMetadata, nameMetadata, planMetadata, displayKey, parseSidecar, parseMat, analyzeGroup } from '../src/index.js';
import { read } from './helpers.js';

const sides = (a, b) => ({ sides: [{ name: a }, { name: b }] });
const enc = (o) => new TextEncoder().encode(typeof o === 'string' ? o : JSON.stringify(o));

test('Site tag: a server says nothing, a server plus an event gives the event, anything else is not taken as the event', () => {
  assert.deepEqual(siteEvent('Backgammon Studio'), { kind: 'server' });
  assert.deepEqual(siteEvent('GamesGrid Games Server'), { kind: 'server' });
  assert.deepEqual(siteEvent('BGNJ-v4.0.1'), { kind: 'server' });
  assert.deepEqual(siteEvent('Galaxy Backgammon  River Cup Final 2025'), { kind: 'event', value: 'River Cup Final 2025' });
  assert.deepEqual(siteEvent('Monte Carlo'), { kind: 'place', value: 'Monte Carlo' });
  assert.deepEqual(siteEvent(''), { kind: 'none' });
  assert.deepEqual(siteEvent(null), { kind: 'none' });
});

test('headers: placeholders are left out, the event comes from the Site tag when there is none, each change is noted', () => {
  const studio = cleanHeaderMetadata({ event: 'Online match', round: 'Round 0', provenance: { site: 'Backgammon Studio' } });
  assert.deepEqual([studio.event, studio.round], [null, null]);
  assert.equal(studio.notes.length, 2);
  const galaxy = cleanHeaderMetadata({ event: null, round: null, provenance: { site: 'Galaxy Backgammon River Cup Final 2025' } });
  assert.deepEqual([galaxy.event, galaxy.notes], ['River Cup Final 2025', ['The event "River Cup Final 2025" was taken from the Site tag']]);
  const kept = cleanHeaderMetadata({ event: ' City  Open ', round: 'Semi Final', provenance: { site: 'Galaxy Backgammon Other' } });
  assert.deepEqual([kept.event, kept.round, kept.notes], ['City Open', 'Semi Final', []], 'a real event wins over the Site tag');
  const place = cleanHeaderMetadata({ event: null, round: null, provenance: { site: 'Riverton, Freeland' } });
  assert.equal(place.event, null, 'a place is not taken as the event');
});

test('file names: the number of a match in a series, the stage, the event, the date', () => {
  const cases = [
    ['Ann Smith-Bob Jones   3. Match 26.07.2025 Club Final_1753531841', sides('Bob Jones', 'Ann Smith'), { round: 'Final - Match 3', event: 'Club', date: '2025-07-26' }],
    ['Ann Smith-Bob Jones  12. Match 26.07.2025 Club Final_1753732844', sides('Bob Jones', 'Ann Smith'), { round: 'Final - Match 12' }],
    ['1988 Ann Smith-Bob Jones City Champs Final #2 AS won 9pnts_1348305923', sides('Ann Smith', 'Bob Jones'), { round: 'Final - Match 2', event: 'City Champs 1988', date: '1988' }],
    ['Smith_WCII_Riverton1990_2v5_1347412533', sides('Ann Smith', 'Bob Jones'), { round: 'Match 2 of 5', event: 'WCII Riverton 1990', date: '1990' }],
    ['annsmith-bobjones 11 point match 2015-06-28(2 of 2)', sides('annsmith', 'bobjones'), { round: 'Match 2 of 2', event: null, date: '2015-06-28' }],
    ['01 annsmith - bobjones 5pt Backgammon Studio 2023_07_19 17_44_25_1689788692', sides('annsmith', 'bobjones'), { round: 'Match 1', event: null, date: '2023-07-19', time: '17:44' }],
    ['annsmith-bobjones-2011Nov031701', sides('annsmith', 'bobjones'), { round: null, event: null, date: '2011-11-03', time: '17:01' }],
    ['183025-AnnSmith-BobJonesFinal17Pts2012-04-09_1346177672', sides('Ann Smith', 'Bob Jones'), { round: 'Final', event: null, date: '2012-04-09' }],
    ['150214_Riverton_BanseiSemiFinal-Ann-Bob Jones 11 point match_2_1424149887', { ...sides('Ann', 'Bob Jones'), matchLength: 11 }, { round: 'Semi-final - Match 2', event: 'Riverton Bansei' }],
    ['2015-cdf-qf2-smith-jones_1449358178', sides('Ann Smith', 'Bob Jones'), { round: 'Quarter-final 2', date: '2015' }],
    ['808_2008-05-28-Ann_Smith-Bob_Jones-15-2nd_1354342557', { ...sides('Ann Smith', 'Bob Jones'), matchLength: 15 }, { round: 'Match 2', date: '2008-05-28' }],
    ['89229_2009-01-20-Ann-Bob-5_1349535546', { ...sides('Ann', 'Bob'), matchLength: 5 }, { round: null }],
    ['Ann vs Bob Jones 2nd match_1577757585', sides('Ann', 'Bob Jones'), { round: 'Match 2', event: null }],
    ['1981riverton_r32_smith v jones_1346811244', sides('Ann Smith', 'Bob Jones'), { round: 'Round 32', event: 'riverton 1981' }],
    ['match38659076_1780215518', sides('Ann', 'Bob'), { round: null, event: null }],
  ];
  for (const [name, m, want] of cases) {
    const got = nameMetadata(name, m);
    for (const [k, v] of Object.entries(want)) assert.equal(got[k], v, `${name}: ${k}`);
  }
});

const item = (file, o = {}) => ({ file, base: file, players: ['Ann', 'Bob'], matchLength: 7, date: '2025-07-26', time: null, event: 'Cup', round: null, name: nameMetadata(file, sides('Ann', 'Bob')), ...o });

test('review: a series told apart by the names, by the times of play, or not at all; a match that looks like a stored one', () => {
  const byName = planMetadata([item('Ann-Bob 1. Match'), item('Ann-Bob 2. Match')]);
  assert.deepEqual(byName.rows.map((r) => [r.status, r.round]), [['series', 'Match 1'], ['series', 'Match 2']]);
  assert.equal(byName.groups, 1);

  const withRound = planMetadata([item('Ann-Bob 1. Match', { round: 'Final' }), item('Ann-Bob 2. Match', { round: 'Final' })]);
  assert.deepEqual(withRound.rows.map((r) => r.round), ['Final - Match 1', 'Final - Match 2'], 'the round of the headers keeps, the number is added');

  const byTime = planMetadata([item('a', { time: '15:00' }), item('b', { time: '13:00' })]);
  assert.deepEqual(byTime.rows.map((r) => [r.file, r.round, r.from]), [['a', 'Match 2 of 2', 'match number from the time of play'], ['b', 'Match 1 of 2', 'match number from the time of play']]);

  const nameTimes = planMetadata([item('x', { name: { time: '18:31', date: '2025-07-26', n: null } }), item('y', { name: { time: '17:01', date: '2025-07-26', n: null } })]);
  assert.deepEqual(nameTimes.rows.map((r) => r.round), ['Match 2 of 2', 'Match 1 of 2'], 'times read from the file names, when the file has none');

  const same = planMetadata([item('a', { time: '13:00' }), item('b', { time: '13:00' })]);
  assert.deepEqual(same.rows.map((r) => r.status), ['same', 'same']);
  assert.match(same.rows[0].note, /give the round/);

  const stored = planMetadata([item('a')], [{ id: '0001/aaaaaaaaaaaaaaaa', players: ['Bob', 'Ann'], matchLength: 7, date: '2025-07-26', event: 'Cup', round: null }]);
  assert.deepEqual(stored.rows.map((r) => [r.status, r.note]), [['same', 'looks the same as 0001/aaaaaaaaaaaaaaaa, already stored']]);

  const copies = planMetadata([item('b', { moves: 'x' }), item('a', { moves: 'x' }), item('c', { moves: 'y', date: '2024-01-01' })]);
  assert.deepEqual(copies.rows.map((r) => [r.status, r.file, r.note]).filter((r) => r[0] === 'duplicate'),
    [['duplicate', 'b', 'same moves as a: the ingest stores one of them and skips the other']], 'a copy is not a match to tell apart');
  assert.ok(!copies.rows.some((r) => r.status === 'same'));

  const alone = planMetadata([item('Ann-Bob Riverton Open', { event: null })]);
  assert.deepEqual(alone.rows.map((r) => [r.status, r.event, r.current.event]), [['name', 'Riverton Open', null]], 'a name that fills a gap');
  assert.equal(planMetadata([item('plain')]).rows.length, 0, 'nothing to review');
});

test('the key the list tells matches apart by ignores the order of the players, case and accents', () => {
  assert.equal(displayKey({ players: ['Ann', 'Bob'], date: '2025', event: 'Cup', round: 'Final', matchLength: 7 }),
    displayKey({ sides: [{ name: 'bob' }, { name: 'ÁNN' }], date: '2025', event: 'cup', round: 'final', matchLength: 7 }));
});

test('sidecar: event, round and date are reviewed values (null = none); bad ones are ignored with a warning', () => {
  const w = [];
  const ok = parseSidecar('m.bgdb.json', enc({ event: ' River  Cup ', round: null, date: '2025-07' }), {}, w);
  assert.deepEqual([ok.meta, w], [{ event: 'River Cup', round: null, date: '2025-07' }, []]);
  const bad = [];
  const r = parseSidecar('m.bgdb.json', enc({ date: '26.07.2025', round: 3, event: 'x'.repeat(121) }), {}, bad);
  assert.deepEqual(r.meta, {});
  assert.equal(bad.length, 3);
  assert.match(bad[0].message, /"event" was ignored|"round" was ignored|"date" was ignored/);
});

test('analyzeGroup: headers cleaned, the sidecar wins; the match id does not change', () => {
  const name = 'backgammon-studio/tester_-_Linnet14_7pt_Backgammon_Studio_2026_10_01_09_38_41.txt';
  const bytes = enc(read(name));
  const plain = analyzeGroup({ base: 'a', files: { txt: [{ name: 'a.txt', bytes }] } }, { config: {} });
  assert.equal(plain.status, 'new');
  assert.equal(parseMat(read(name)).event, 'Online match', 'the parser reads the file as it is');
  assert.deepEqual([plain.match.event, plain.summary.event], [null, null], 'the placeholder is left out');
  assert.ok(plain.infos.some((i) => i.code === 'V-META' && /Online match/.test(i.message)));
  const side = { name: 'a.bgdb.json', bytes: enc({ event: 'Club Night', round: 'Final - Match 2', date: '2026-10-01' }) };
  const reviewed = analyzeGroup({ base: 'a', files: { txt: [{ name: 'a.txt', bytes }], side: [side] } }, { config: {} });
  assert.deepEqual([reviewed.match.event, reviewed.match.round, reviewed.match.date], ['Club Night', 'Final - Match 2', '2026-10-01']);
  assert.equal(reviewed.full, plain.full, 'event, round and date are not part of the identity');
  assert.match(reviewed.normalised, /\[Round "Final - Match 2"\]/);
});

test('score lines: a rating written after the name ("name,1850 : 0") is a rating, not part of the name', () => {
  const m = parseMat(read('invalid/damaged-missing-plays_ouzelbird-albatros_9pt.txt'));
  const ouzel = m.sides.find((s) => s.name === 'ouzelbird');
  assert.equal(ouzel?.rating, 1850);
  assert.ok(!m.sides.some((s) => s.name.includes(',')));
});

test('a tab inside a move row is expanded to the next 8-column stop: the play stays in its column', async () => {
  const { expandTabs } = await import('../src/mat.js');
  assert.equal(expandTabs('  4) 41: 11/7 8/7\t            42: 13/9'), `  4) 41: 11/7 8/7${' '.repeat(19)}42: 13/9`);
  // the same file with its spaces turned into tabs where a tab stop allows it reads as the same match
  const text = read('opengammon/vireo_vs_tester_2026-09-30.mat');
  // a chunk of 8 columns that ends with two spaces or more becomes its text and a tab (what an editor that "uses tabs" saves)
  const tabify = (l) => (l.match(/.{1,8}/g) ?? []).map((c) => (c.length === 8 && / {2}$/.test(c) ? `${c.replace(/ +$/, '')}\t` : c)).join('');
  const tabbed = text.split('\n').map((l) => (/^\s*\d+\)/.test(l) ? tabify(l) : l)).join('\n');
  assert.notEqual(tabbed, text, 'the test file has tabs');
  const { matchHash16, readMatch } = await import('../src/index.js');
  const [a, b] = [readMatch(text), readMatch(tabbed)];
  assert.equal(b.ok, true);
  assert.equal(matchHash16(b.match), matchHash16(a.match));
});
