import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMatch, matchHash16, parseMat, parseMoves, validateMatch, writeMat, formatMoves } from '../src/index.js';
import { read, allTextFixtures } from './helpers.js';

// [file, format, games, final score, dialect]
const GOOD = [
  ['opengammon/vireo_vs_tester_2026-09-30.mat', 'mat', 4, [0, 6], 'opengammon'],
  ['opengammon/Starling9_vs_tester_2026-09-27.mat', 'mat', 6, [3, 5], 'opengammon'],
  ['opengammon/toucanBG_vs_tester_2026-08-04.mat', 'mat', 3, [0, 5], 'opengammon'],
  ['opengammon/Sir_Plover_vs_tester_2026-08-03.mat', 'mat', 6, [4, 5], 'opengammon'],
  ['foxamon/tester_vs_Osprey12_2026-08-10.mat', 'mat', 1, [4, 0], 'foxamon'],
  ['foxamon/tester_vs_jackdaw1_2026-08-18.mat', 'mat', 4, [11, 2], 'foxamon'],
  ['backgammon-studio/tester_-_Cardinal_5pt_Backgammon_Studio_2026_09_22_14_49_23.txt', 'mat', 5, [5, 4], 'backgammon-studio'],
  ['backgammon-studio/Bluejay_-_tester_5pt_Backgammon_Studio_2026_08_16_13_00_36.mat', 'mat', 6, [5, 4], 'backgammon-studio'],
  ['backgammon-studio/tester_-_Linnet14_7pt_Backgammon_Studio_2026_10_01_09_38_41.txt', 'mat', 3, [10, 4], 'backgammon-studio'],
  ['xg-text/me-XG_Roller__03-10-2026.txt', 'mat', 1, [1, 0], 'xg-text'],
  ['xg-text/me-XG_Roller__03-10-2026__2.txt', 'mat', 1, [0, 1], 'xg-text'],
  ['xg-text/me-XG_Roller__03-10-2026__3.txt', 'mat', 1, [0, 4], 'xg-text'],
  ['extmatchdb/xg-text-crlf-empty-site_11pt.mat', 'mat', 10, [12, 10], 'xg-text'],
  ['extmatchdb/backgammon-studio_7pt.txt', 'mat', 5, [7, 3], 'backgammon-studio'],
  ['extmatchdb/galaxy-resign-without-marker_7pt.txt', 'mat', 8, [8, 6], 'backgammongalaxy'],
  ['extmatchdb/galaxy-hidden-play-ends-match_7pt.txt', 'mat', 4, [7, 4], 'backgammongalaxy'],
  ['extmatchdb/cube-8-gammon-16-points_13pt.txt', 'mat', 6, [7, 18], 'backgammon-studio'],
  ['extmatchdb/backgammon-studio_13pt.txt', 'mat', 7, [14, 1], 'backgammon-studio'],
  ['extmatchdb/xg-text-transcriber-tag_7pt.txt', 'mat', 6, [7, 4], 'xg-text'],
  ['choue-net/chouehandle-vs-Bot-all-games-s4020-2026-10-04.txt', 'mat', 2, [0, 5], 'choue'],
  ['choue-net/chouehandle-vs-Bot-all-games-s4020-2026-10-04.sgf', 'sgf', 2, [5, 0], 'gnubg-sgf'],
  ['extmatchdb/illegal-play-declared-in-remarks_7pt.txt', 'mat', 6, [3, 7], 'generic'],
  ['gnubg-sgf/2026-01-20T15-36-47-bluetailedgrebe1-tester.sgf', 'sgf', 2, [0, 3], 'gnubg-sgf'],
  ['gnubg-sgf/2026-01-22T18-31-58-avocet-tester.sgf', 'sgf', 7, [4, 5], 'gnubg-sgf'],
];

for (const [file, format, games, score, dialect] of GOOD) {
  test(`valid: ${file.split('/').pop().slice(0, 50)}`, () => {
    const r = readMatch(read(file));
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.format, format);
    assert.equal(r.match.games.length, games);
    assert.deepEqual(r.match.result.score, score);
    assert.equal(r.match.provenance.dialect, dialect);
    assert.match(matchHash16(r.match), /^[0-9a-f]{16}$/);
  });
}

test('the hash is stable (snapshot)', () => {
  const r = readMatch(read('backgammon-studio/tester_-_Linnet14_7pt_Backgammon_Studio_2026_10_01_09_38_41.txt'));
  assert.equal(matchHash16(r.match), '2359e4c944b8d130');
});

test('identity ignores metadata and the order of sub-moves', () => {
  const text = read('foxamon/tester_vs_Osprey12_2026-08-10.mat');
  const base = matchHash16(readMatch(text).match);
  const renamed = text.replaceAll('Osprey12', 'SomeoneElse').replace('Foxamon', 'Elsewhere');
  assert.equal(matchHash16(readMatch(renamed).match), base);
  // swap the order of the two moves in one play: "24/18 24/18 13/7* 13/7" -> "13/7* 13/7 24/18 24/18"
  const reordered = text.replace('24/18 24/18 13/7* 13/7', '13/7* 13/7 24/18 24/18');
  assert.notEqual(reordered, text);
  assert.equal(matchHash16(readMatch(reordered).match), base);
});

test('identity changes when the content changes (here: the match is cut after game 1)', () => {
  const text = read('backgammon-studio/tester_-_Cardinal_5pt_Backgammon_Studio_2026_09_22_14_49_23.txt');
  const full = matchHash16(readMatch(text).match);
  const cut = readMatch(text.slice(0, text.indexOf(' Game 2')));
  assert.equal(cut.ok, true, JSON.stringify(cut.errors));
  assert.ok(cut.warnings.some((w) => /unfinished/.test(w.message)));
  assert.notEqual(matchHash16(cut.match), full);
});

test('the same match with the two players swapped gets the same identity', () => {
  // swap names only: the roll order inside the file is what defines side A
  const r1 = readMatch(read('backgammon-studio/tester_-_Linnet14_7pt_Backgammon_Studio_2026_10_01_09_38_41.txt'));
  const t = read('backgammon-studio/tester_-_Linnet14_7pt_Backgammon_Studio_2026_10_01_09_38_41.txt')
    .replaceAll('tester', 'XXXX').replaceAll('Linnet14', 'tester').replaceAll('XXXX', 'Linnet14');
  assert.equal(matchHash16(readMatch(t).match), matchHash16(r1.match));
});

test('a tampered move is reported as illegal with a location and a hint', () => {
  const text = read('opengammon/vireo_vs_tester_2026-09-30.mat').replace('52: 24/22 13/8', '52: 24/22 13/7');
  const r = readMatch(text);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'V-LEGAL');
  assert.ok(r.errors[0].game === 1 && r.errors[0].line > 0);
  assert.ok(r.errors[0].hint);
});

test('a wrong score declaration is reported', () => {
  const text = read('backgammon-studio/tester_-_Cardinal_5pt_Backgammon_Studio_2026_09_22_14_49_23.txt').replace('Wins 1 point', 'Wins 2 point');
  const r = readMatch(text);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'V-SCORE');
});

const BLUEJAY = 'backgammon-studio/Bluejay_-_tester_5pt_Backgammon_Studio_2026_08_16_13_00_36.mat';

test('Backgammon Studio resignation: "66: ????" + "Wins 2008 point" ends the match, counted as the points needed', () => {
  const r = readMatch(read(BLUEJAY));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const last = r.match.games[5];
  assert.equal(last.result.how, 'resign');
  assert.equal(last.result.winner, 0);
  assert.equal(last.result.points, 2, 'cube 2, the winner needed 2 points (3 -> 5)');
  assert.deepEqual(r.match.result, { winner: 0, score: [5, 4], finished: true });
  assert.ok(r.infos.some((d) => d.code === 'V-RESULT' && /2008/.test(d.message)));
  const hidden = last.actions[last.actions.length - 1];
  assert.equal(hidden.hidden, true);
  assert.deepEqual(hidden.dice, [6, 6]);
  assert.equal(hidden.side, 1);
});

test('the hidden play of a resignation does not change the identity (it is not part of the content)', () => {
  const text = read(BLUEJAY);
  const without = text.replace('66: ????', '');
  assert.notEqual(without, text);
  const a = readMatch(text);
  const b = readMatch(without);
  assert.equal(b.ok, true, JSON.stringify(b.errors));
  assert.equal(matchHash16(a.match), matchHash16(b.match));
});

test('a hidden play must end the game and the other player must be the winner', () => {
  const notLast = parseMat(read(BLUEJAY));
  notLast.games[5].actions.push({ side: 0, kind: 'move', dice: [2, 1], moves: [{ from: 24, to: 23 }], line: 999 });
  const r1 = validateMatch(notLast);
  assert.equal(r1.ok, false);
  assert.equal(r1.errors[0].code, 'V-DAMAGED', 'a hidden play that does not end the game: the position is unknown (decision 0020)');
  assert.match(r1.errors[0].message, /hidden .* but the game goes on/);
  assert.ok(r1.errors.some((d) => d.code === 'V-DAMAGED' && /This match is damaged/.test(d.message)), 'and the summary');

  const wrongWinner = parseMat(read(BLUEJAY));
  wrongWinner.games[5].declared.winner = 1;
  const r2 = validateMatch(wrongWinner);
  assert.equal(r2.ok, false);
  assert.equal(r2.errors[0].code, 'V-SCORE');
});

test('XG binary files given as text are recognised and sent to the binary reader', () => {
  const r = readMatch('RGMH\u0001\u0000\u0000\u0000');
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /binary/);
});

test('move notation: repeats, chains, bar and off', () => {
  assert.deepEqual(parseMoves('13/10(2) bar/20 6/off 24/18*/15'), [
    { from: 13, to: 10 }, { from: 13, to: 10 }, { from: 25, to: 20 }, { from: 6, to: 0 }, { from: 24, to: 18 }, { from: 18, to: 15 },
  ]);
  assert.deepEqual(parseMoves('25/20 3/0'), [{ from: 25, to: 20 }, { from: 3, to: 0 }]);
  assert.throws(() => parseMoves('7/9'), /not a forward move/);
  assert.deepEqual(parseMoves('2/0 0/0'), [{ from: 2, to: 0 }], '"0/0": a die with nothing to move');
});

test('"0/0" for the die left after the last checker is off: same match, same identity; mid-game it is still a missing die', () => {
  const written = (a) => `${a.dice.join('')}: ${formatMoves(a.moves)}`;
  // a fixture with a game won by a bear-off whose last roll used one die only, written as the file writes it
  let found = null;
  for (const [rel, text] of allTextFixtures().filter(([f]) => !f.endsWith('.sgf'))) {
    const r = readMatch(text);
    if (!r.ok) continue;
    for (const g of r.match.games) {
      const a = g.actions.filter((x) => x.kind === 'move').at(-1);
      if (g.result.how === 'bearOff' && a.dice[0] !== a.dice[1] && a.moves.length === 1 && text.split('\n')[a.line - 1].includes(written(a))) { found = { rel, text, r, a }; break; }
    }
    if (found) break;
  }
  assert.ok(found, 'a fixture has such a game');
  const { text, r: base, a: last } = found;
  const lines = text.split('\n');
  lines[last.line - 1] = lines[last.line - 1].replace(written(last), `${written(last)} 0/0`);
  const r = readMatch(lines.join('\n'));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(matchHash16(r.match), matchHash16(base.match));
  // in the middle of a game, "x/y 0/0" for a roll whose two dice could be played lacks a die: refused
  const first = base.match.games[0].actions.find((x) => x.kind === 'move' && x.dice[0] !== x.dice[1] && x.moves.length === 2 && text.split('\n')[x.line - 1].includes(written(x)));
  const fl = text.split('\n');
  fl[first.line - 1] = fl[first.line - 1].replace(written(first), `${first.dice.join('')}: ${formatMoves(first.moves.slice(0, 1))} 0/0`);
  assert.equal(readMatch(fl.join('\n')).errors[0]?.code, 'V-LEGAL');
});

test('a score line padded wider than the rows: a row with an empty left cell still belongs to the right player', () => {
  // XG text exports with long names pad the score line so that the right name starts after the right cells of the rows
  const pick = allTextFixtures().filter(([f]) => !f.endsWith('.sgf')).find(([, t]) => /^\s*1\)\s{10,}[0-6]{2}:/m.test(t) && readMatch(t).ok);
  assert.ok(pick, 'a fixture whose first roll is the right player\'s');
  const [, text] = pick;
  const widened = text.replace(/^(\s*\S.*?:\s*\d+)(\s{2,})(\S.*:\s*\d+\s*)$/gm, (m, a, gap, b) => `${a}${gap}${' '.repeat(12)}${b}`);
  assert.notEqual(widened, text);
  const r = readMatch(widened);
  assert.equal(r.ok, true, JSON.stringify(r.errors.slice(0, 2)));
  assert.equal(matchHash16(r.match), matchHash16(readMatch(text).match));
});

test('layouts of other exporters: a box above the match, Losses, Resign normal, Wins spacing, cells on an unnumbered line, Illegal play without dump', () => {
  const base = read('extmatchdb/galaxy-resign-without-marker_7pt.txt').replace(/\r/g, '');
  const ok = readMatch(base);
  assert.equal(ok.ok, true);
  const lines = base.split('\n');
  // a box above "N point match" without the leading ";": kept as remarks
  const head = lines.findIndex((l) => /point match/i.test(l));
  const boxed = [...lines.slice(0, head), '+------------------------------+', '|  Some Championship 1993      |', '|  Final                       |', '+------------------------------+', ...lines.slice(head)].join('\n');
  const rb = readMatch(boxed);
  assert.equal(rb.ok, true, JSON.stringify(rb.errors));
  assert.deepEqual(rb.match.remarks?.slice(-2) ?? parseMat(boxed).remarks.slice(-2), ['Some Championship 1993', 'Final']);
  // the Wins line written in other ways, and the loser's "Losses" next to it
  const wins = lines.findIndex((l) => /^\s+Wins \d+ points?\s*$/.test(l));
  assert.ok(wins > 0);
  const variant = (f) => { const c = lines.slice(); c[wins] = f(c[wins]); return c.join('\n'); };
  for (const text of [
    variant((l) => l.replace(/Wins (\d+) (points?)/, 'Wins $1    $2')),
    variant((l) => { const indent = l.match(/^\s*/)[0].length; return indent >= 20 ? ' 99)  Losses 1 point'.padEnd(indent) + l.trimStart() : `${l.trimEnd()}${' '.repeat(Math.max(4, 40 - l.trimEnd().length))}Losses 1 point`; }),
  ]) {
    const r = readMatch(text);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(matchHash16(r.match), matchHash16(ok.match));
  }
  assert.deepEqual(parseMat('7 point match\n\n Game 1\n Alice : 0                       Bobby : 0\n  1) 31: 8/5 6/5      Doubles => 2\n      Drops             Wins 1 point\n').games[0].actions.map((a) => a.kind), ['move', 'double', 'drop']);
  assert.equal(parseMat('7 point match\n\n Game 1\n Alice : 0                       Bobby : 0\n  1) 31: 8/5 6/5          42: 8/4 6/4\n  2) Resign normal          Wins 1 point\n').games[0].declared.resign, true);
  const ill = parseMat('7 point match\n\n Game 1\n Alice : 0                       Bobby : 0\n  1) 31: Illegal play      Wins 1 point\n').games[0].actions[0];
  assert.equal(ill.hidden, true, '"Illegal play" without a dump: the play is not known');
});

test('"; Set Pos=": the opening position (or the position reached) is accepted; any other position is refused, never replayed from the opening', () => {
  const text = read('extmatchdb/galaxy-resign-without-marker_7pt.txt').replace(/\r/g, '');
  const lines = text.split('\n');
  const score = lines.findIndex((l) => /^\s*Game 1\s*$/.test(l)) + 1;
  const withPos = (board) => [...lines.slice(0, score + 1), `; Set Pos=${board}/0`, ...lines.slice(score + 1)].join('\n');
  const opening = readMatch(withPos('-b----E-C---eE---c-e----B-'));
  assert.equal(opening.ok, true, JSON.stringify(opening.errors));
  assert.equal(matchHash16(opening.match), matchHash16(readMatch(text).match));
  const other = readMatch(withPos('--BBbBD--B---Ab---ccBbb-a-'));
  assert.equal(other.ok, false);
  assert.match(other.errors[0].message, /starts the game from a set position/);
});

test('older transcriptions: the winner\'s last bear-off hidden ("???"), and Wins on the row of the bear-off', () => {
  // a game won by a bear-off whose last play is written as a text cell we can hide
  let found = null;
  for (const [rel, text] of allTextFixtures().filter(([f]) => !f.endsWith('.sgf'))) {
    const r = readMatch(text);
    if (!r.ok) continue;
    const parsed = parseMat(text);
    const gi = r.match.games.findIndex((g, k) => g.result.how === 'bearOff' && parsed.games[k].declared);
    if (gi < 0) continue;
    const last = r.match.games[gi].actions.filter((x) => x.kind === 'move').at(-1);
    const lines = text.split('\n');
    const cell = lines[last.line - 1].match(new RegExp(`${last.dice[0]}${last.dice[1]}:[^\\n]*?(?=\\s{2,}|\\s*$)`));
    if (cell) { found = { rel, text, r, gi, last, cell: cell[0] }; break; }
  }
  assert.ok(found, 'a fixture with a game won by a bear-off');
  const { text, r: base, gi, last } = found;
  const lines = text.split('\n');
  lines[last.line - 1] = lines[last.line - 1].replace(found.cell, `${last.dice[0]}${last.dice[1]}: ???`.padEnd(found.cell.length));
  const hidden = readMatch(lines.join('\n'));
  assert.equal(hidden.ok, true, JSON.stringify(hidden.errors));
  assert.equal(matchHash16(hidden.match), matchHash16(base.match), 'all 15 off: the same final position, the same identity');
  assert.ok(hidden.infos.some((d) => /read as the final bear-off/.test(d.message)));

  // the Wins cell on the row of the bear-off, in the other column
  const m = parseMat(text);
  m.games[gi].declared.line = last.line;
  m.games[gi].declared.winner = 1 - m.games[gi].declared.winner;
  const same = validateMatch(m);
  assert.equal(same.ok, true, JSON.stringify(same.errors));
  assert.ok(same.infos.some((d) => /row of the last bear-off/.test(d.message)));
  // on a line of its own, the other column is still a contradiction
  const own = parseMat(text);
  own.games[gi].declared.winner = 1 - own.games[gi].declared.winner;
  assert.equal(validateMatch(own).ok, false);
});

test('salvage: a file that stops in the middle of its last game keeps its complete games; a game without a result elsewhere is still an error', () => {
  const text = read('backgammon-studio/tester_-_Cardinal_5pt_Backgammon_Studio_2026_09_22_14_49_23.txt').replace(/\r/g, '');
  const lines = text.split('\n');
  const lastGame = lines.map((l, i) => (/^\s*Game \d+\s*$/.test(l) ? i : -1)).filter((i) => i >= 0).at(-1);
  const withoutLast = readMatch(lines.slice(0, lastGame).join('\n'));
  assert.equal(withoutLast.ok, true);
  // the last game cut after a few rows: no result and no Wins line; kept with --salvage, reported without it
  assert.equal(readMatch(lines.slice(0, lastGame + 6).join('\n')).ok, false, 'a contributor is told');
  const cut = readMatch(lines.slice(0, lastGame + 6).join('\n'), { salvage: true });
  assert.equal(cut.ok, true, JSON.stringify(cut.errors));
  assert.ok(cut.warnings.some((d) => d.code === 'V-PARTIAL' && /stops in the middle of this game/.test(d.message)));
  assert.equal(matchHash16(cut.match), matchHash16(withoutLast.match), 'the match is its complete games');
  // the same cut in the middle of the file is an error
  const mid = parseMat(text);
  mid.games[0].actions = mid.games[0].actions.slice(0, 4);
  delete mid.games[0].declared;
  assert.equal(validateMatch(mid, { salvage: true }).ok, false);
});

test('a file without games is rejected', () => {
  const r = readMatch('; [Site "x"]\n\n5 point match\n');
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'V-FORMAT');
});

test('SGF: both sides are decoded in their own perspective', () => {
  const r = readMatch(read('gnubg-sgf/2026-01-20T15-36-47-bluetailedgrebe1-tester.sgf'));
  const first = r.match.games[0].actions[0];
  assert.equal(first.side, 0);
  assert.deepEqual(first.dice, [5, 4]);
  assert.deepEqual(first.moves.map((m) => [m.from, m.to]).sort(), [[13, 8], [24, 20]]);
});

test('column detection: a left player who rolls second leaves the left cell empty', () => {
  const m = parseMat(read('foxamon/tester_vs_Osprey12_2026-08-10.mat'));
  assert.equal(m.games[0].actions[0].side, 1);
  assert.equal(m.games[0].actions[1].side, 0);
});

const XG1 = 'xg-text/me-XG_Roller__03-10-2026.txt';
const XG3 = 'xg-text/me-XG_Roller__03-10-2026__3.txt';

test('XG text export: the left column (me) is side 0 even though "Player 1" is the other player', () => {
  const r = readMatch(read(XG1));
  assert.deepEqual(r.match.sides.map((x) => x.name), ['me', 'XG Roller+']);
  assert.equal(r.match.sides[0].rating, 2096.75);
  assert.equal(r.match.sides[0].experience, 6506);
  assert.equal(r.match.sides[1].rating, 2262);
  assert.equal(r.match.games[0].actions[0].side, 1, 'XG Roller+ rolls first (the left cell of row 1 is empty)');
});

test('money game: match length 0, Jacoby and beaver flags, date and time', () => {
  const r = readMatch(read('xg-text/me-XG_Roller__03-10-2026__2.txt'));
  assert.equal(r.match.matchLength, 0);
  assert.equal(r.match.rules.jacoby, true);
  assert.equal(r.match.rules.beaver, true);
  assert.equal(r.match.date, '2026-10-03');
  assert.equal(r.match.time, '23:28');
  assert.equal(r.match.games[0].result.how, 'drop');
  assert.equal(r.match.games[0].result.points, 1);
});

test('money game, cube turned: a gammon-sized resignation counts 4 on a cube of 2, without a warning', () => {
  const r = readMatch(read(XG3));
  const g = r.match.games[0];
  assert.deepEqual([g.result.cube, g.result.points, g.result.how], [2, 4, 'resign']);
  assert.equal(r.warnings.length, 0, JSON.stringify(r.warnings));
  assert.ok(r.infos.some((d) => d.code === 'V-RESULT' && /\bme\b/.test(d.message)));
});

test('a resignation value that does not fit the cube is flagged', () => {
  const r = readMatch(read(XG3).replace('Wins 4 point', 'Wins 5 point'));
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((d) => d.code === 'V-SCORE' && /does not fit the cube/.test(d.message)));
});

test('chained plays written without intermediate points ("44: 22/6") are understood', () => {
  const r = readMatch(read(XG3));
  const a = r.match.games[0].actions.find((x) => x.dice && x.dice.join('') === '44' && x.moves.some((m) => m.from === 22 && m.to === 6));
  assert.ok(a, 'the 44 play 22/6 is present and legal');
});

const CRLF = 'extmatchdb/xg-text-crlf-empty-site_11pt.mat';

test('extmatchdb file: CRLF line endings, empty Site tag, trimmed event name', () => {
  const text = read(CRLF);
  assert.ok(text.includes('\r\n'), 'the fixture keeps its CRLF line endings');
  const r = readMatch(text);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.match.event, 'City Open Championship 2026');
  assert.equal(r.match.provenance.dialect, 'xg-text');
  assert.deepEqual(r.match.sides.map((s) => s.name), ['Dale Henderson', 'Matthew Montgomery']);
});

test('a long left cell that touches the right cell with a single space is split in two (line 26 of the extmatchdb file)', () => {
  const r = readMatch(read(CRLF));
  const g = r.match.games[0].actions;
  const left = g.find((a) => a.side === 0 && a.dice?.join('') === '11' && a.moves.length === 4 && a.moves[0].from === 15);
  const right = g.find((a) => a.side === 1 && a.dice?.join('') === '33' && a.moves.length === 4);
  assert.ok(left, 'left cell: 11: 15/14 14/13 13/12 12/11');
  assert.deepEqual(left.moves.map((m) => [m.from, m.to]), [[15, 14], [14, 13], [13, 12], [12, 11]]);
  assert.ok(right, 'right cell: 33: 3/0 3/0 3/0 3/0');
  assert.deepEqual(right.moves.map((m) => [m.from, m.to]), [[3, 0], [3, 0], [3, 0], [3, 0]], '3/0 = four checkers borne off from the 3 point');
});

test('"???" is an accepted resignation: the points declared are kept (cube 2 -> 2, cube 4 -> 4, cube 1 gammon -> 2)', () => {
  const r = readMatch(read(CRLF));
  const first4 = r.match.games.slice(0, 4).map((g) => [g.result.winner, g.result.points, g.result.cube, g.result.how]);
  assert.deepEqual(first4, [[1, 2, 2, 'resign'], [1, 4, 4, 'resign'], [0, 4, 4, 'resign'], [1, 2, 1, 'resign']]);
  assert.deepEqual(r.match.result, { winner: 0, score: [12, 10], finished: true });
});

test('numbered rows with nothing in them are ignored', () => {
  const m = parseMat(read('opengammon/Starling9_vs_tester_2026-09-27.mat'));
  assert.ok(m.games.length > 0);
  const padded = read('backgammon-studio/tester_-_Linnet14_7pt_Backgammon_Studio_2026_10_01_09_38_41.txt');
  assert.ok(/\n[ \t]*\d+\)[ \t]*(?:\n|$)/.test(padded), 'the fixture really contains an empty numbered row');
  assert.equal(readMatch(padded).ok, true);
});

test('a resignation capped at the points the winner needs is not flagged as odd', () => {
  const r = readMatch(read('opengammon/toucanBG_vs_tester_2026-08-04.mat'));
  assert.equal(r.warnings.length, 0, JSON.stringify(r.warnings));
});

test('BackgammonGalaxy: a resignation without a marker is only an info; "????" ends a match as a resignation', () => {
  const a = readMatch(read('extmatchdb/galaxy-resign-without-marker_7pt.txt'));
  assert.equal(a.warnings.length, 0, JSON.stringify(a.warnings));
  assert.ok(a.infos.some((d) => d.code === 'V-RESULT'));
  const b = readMatch(read('extmatchdb/galaxy-hidden-play-ends-match_7pt.txt'));
  const last = b.match.games[3];
  assert.deepEqual([last.result.how, last.result.winner, last.result.points], ['resign', 0, 2]);
  assert.deepEqual(b.match.result, { winner: 0, score: [7, 4], finished: true });
});

test('a 16-point game (cube 8, gammon) and a 4-cube match to 13 are scored correctly', () => {
  const r = readMatch(read('extmatchdb/cube-8-gammon-16-points_13pt.txt'));
  const g6 = r.match.games[5];
  assert.deepEqual([g6.result.points, g6.result.cube, g6.result.kind], [16, 8, 'gammon']);
});

const CHOUE = 'choue-net/chouehandle-vs-Bot-all-games-s4020-2026-10-04';

test('choue.net: "Doubles ==> 2" is a double, the site and event tags are read', () => {
  const r = readMatch(read(`${CHOUE}.txt`));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.ok(r.match.games[0].actions.some((a) => a.kind === 'double' && a.cube === 2));
  assert.equal(r.match.provenance.site, 'choue.net');
  assert.equal(r.match.rules.jacoby, true);
  assert.equal(r.match.rules.cubeLimit, 64);
});

test('the text and the analysed SGF of the same match have the same identity, whatever the player order', () => {
  const a = readMatch(read(`${CHOUE}.txt`));
  const b = readMatch(read(`${CHOUE}.sgf`));
  assert.equal(matchHash16(a.match), matchHash16(b.match));
  assert.deepEqual(a.match.sides.map((s) => s.name), ['chouehandle', 'Bot1']);
  assert.deepEqual(b.match.sides.map((s) => s.name), ['Bot1', 'chouehandle']);
});

test('SGF: analysis is detected (A[..] / DA[..]) with the engine; plain SGFs report none; event and site are read', () => {
  const an = readMatch(read(`${CHOUE}.sgf`)).match;
  assert.deepEqual(an.provenance.analysis, { present: true, engine: 'GNU Backgammon:1.08.003' });
  assert.equal(an.event, 'Online match');
  assert.equal(an.provenance.site, 'choue.net');
  const plain = readMatch(read('gnubg-sgf/2026-01-22T18-31-58-avocet-tester.sgf')).match;
  assert.equal(plain.provenance.analysis.present, false);
});

test('choue.net: "Wins 4 point" with the cube in the middle is impossible; it is a resignation worth at most 3, as the SGF says', () => {
  const t = readMatch(read(`${CHOUE}.txt`));
  const s = readMatch(read(`${CHOUE}.sgf`));
  const [a, b] = [t.match.games[1].result, s.match.games[1].result];
  assert.deepEqual([a.how, a.cube, a.points], ['resign', 1, 3], 'counted as the most a resignation can be worth');
  assert.deepEqual([b.how, b.cube, b.points], ['resign', 1, 3], 'the SGF writes B+3R');
  assert.deepEqual(t.match.result.score, [0, 5]);
  assert.deepEqual(s.match.result.score, [5, 0]);
  const w = t.warnings.find((d) => /impossible with the cube at 1/.test(d.message));
  assert.ok(w, JSON.stringify(t.warnings));
  assert.equal(w.code, 'V-SCORE');
  assert.match(w.message, /the real value is unknown/);
});

test('resignation values: plausible ones are kept, impossible ones are cut to the most possible, capped ones are accepted', () => {
  const base = read(`${CHOUE}.txt`);
  const score = (v) => { const r = readMatch(base.replace('Wins 4 point', `Wins ${v} point`)); return [r.match.games[1].result.points, r.warnings.some((d) => /impossible/.test(d.message)), r.infos.some((d) => d.code === 'V-RESULT')]; };
  assert.deepEqual(score(1), [1, false, false], 'a single game conceded');
  assert.deepEqual(score(2), [2, false, false], 'a gammon conceded');
  assert.deepEqual(score(3), [3, false, false], 'a backgammon conceded');
  assert.deepEqual(score(4), [3, true, false], 'impossible: cut to 3, warned');
  assert.deepEqual(score(5), [3, true, false], '5 is what the winner needs (7 - 2) but a cube of 1 allows 3 at most');
  assert.deepEqual(score(2008), [3, true, false]);
  const bs = readMatch(read(BLUEJAY));            // cube 2: 2008 -> the 2 the winner needs
  assert.equal(bs.match.games[5].result.points, 2);
  assert.ok(bs.infos.some((d) => d.code === 'V-RESULT' && /counted as 2, which the winner needed/.test(d.message)));
});

const REMARKS = 'extmatchdb/illegal-play-declared-in-remarks_7pt.txt';

test('illegal play made in a real match: declared in the transcriber remarks, accepted as played, flagged, and the game goes on', () => {
  const r = readMatch(read(REMARKS));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.match.illegalPlays, [{ game: 6, row: 19, side: 1, player: 'Simon Lockwood', play: '11: 3/2 1/off(2)' }]);
  const a = r.match.games[5].actions.find((x) => x.illegal);
  assert.equal(a.row, 19);
  assert.equal(a.side, 1);
  assert.equal(a.moves.length, 3, 'only three of the four ones were played');
  const w = r.warnings.find((d) => d.code === 'V-ILLEGAL');
  assert.match(w.message, /Game 6, move 19: Simon Lockwood played 11: 3\/2 1\/off\(2\), which is not a legal play; accepted as played/);
  assert.equal(r.match.games[5].result.winner, 1, 'the following moves were checked from the resulting position and the game ends as written');
  assert.deepEqual(r.match.result, { winner: 1, score: [3, 7], finished: true });
});

test('the transcriber remarks and the video tag are kept', () => {
  const r = readMatch(read(REMARKS));
  assert.deepEqual(r.match.remarks, ['Game 6, Move 19 of Simon Lockwood --> 11: 3/2 1/Off(2) was illegal']);
  assert.equal(r.match.links[0].id, 'dQw4w9WgXcQ');
});

test('without a declaration the same play is still an error (typos must not pass)', () => {
  const text = read(REMARKS).split('\n').filter((l) => !/^;\s*[|+]/.test(l)).join('\n');
  const r = readMatch(text);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, 'V-LEGAL');
  assert.match(r.errors[0].message, /Game 6: the move 11: 3\/2 1\/off\(2\) is not legal for this roll/);
  assert.match(r.errors[0].hint, /declare it/);
});

test('a declaration can come from the caller (sidecar) instead of the file', () => {
  const text = read(REMARKS).split('\n').filter((l) => !/^;\s*[|+]/.test(l)).join('\n');
  const r = readMatch(text, { illegal: [{ game: 6, row: 19, player: 'simon lockwood' }] });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.match.illegalPlays.length, 1);
  assert.equal(matchHash16(r.match), matchHash16(readMatch(read(REMARKS)).match), 'same match, same identity');
  const wrongPlayer = readMatch(text, { illegal: [{ game: 6, row: 19, player: 'Matthew Montgomery' }] });
  assert.equal(wrongPlayer.ok, false, 'the declaration names the other player: it does not apply');
});

test('a declaration that matches nothing is reported; one that matches a legal play is ignored with a note', () => {
  const r1 = readMatch(read(REMARKS), { illegal: [{ game: 2, row: 99, player: null }] });
  assert.ok(r1.warnings.some((d) => d.code === 'V-ILLEGAL' && /no such play was found/.test(d.message)));
  const text = read(REMARKS).split('\n').filter((l) => !/^;\s*[|+]/.test(l)).join('\n');
  const r2 = readMatch(text, { illegal: [{ game: 1, row: 2, player: null }] });
  assert.equal(r2.ok, false, 'the real illegal play is still undeclared');
  const base = read('opengammon/vireo_vs_tester_2026-09-30.mat');
  const r3 = readMatch(base, { illegal: [{ game: 1, row: 2, player: null }] });
  assert.equal(r3.ok, true);
  assert.ok(r3.infos.some((d) => d.code === 'V-ILLEGAL' && /is a legal play; treated as legal/.test(d.message)));
  assert.equal(r3.match.illegalPlays.length, 0);
});

test('a declared play that cannot even be played mechanically (missing checker) stays an error', () => {
  const text = read('opengammon/vireo_vs_tester_2026-09-30.mat').replace('52: 24/22 13/8', '52: 23/21 13/8');
  const r = readMatch(text, { illegal: [{ game: 1, row: 2, player: null }, { game: 1, row: 1, player: null }] });
  assert.equal(r.ok, false);
  assert.match(r.errors[0].message, /cannot be played from this position/);
});

test('every valid fixture: the normalised file reads back to the same result, illegal plays and games kept by their result (what the build checks)', () => {
  for (const [rel, text] of allTextFixtures()) {
    const a = readMatch(text);
    if (!a.ok) continue;
    const b = readMatch(writeMat(a.match));
    assert.equal(b.ok, true, `${rel}: ${JSON.stringify(b.errors)}`);
    assert.deepEqual(b.match.result, a.match.result, rel);
    assert.deepEqual(b.match.illegalPlays.map((p) => [p.game, p.row, p.side]), a.match.illegalPlays.map((p) => [p.game, p.row, p.side]), rel);
    assert.deepEqual(b.match.games.map((g) => [g.index, !!g.resultOnly]), a.match.games.map((g, gi) => [g.index ?? gi + 1, !!g.resultOnly]), rel);
  }
});

test('the normalised file keeps the illegal play and its remarks, with its own row numbers, and reads back identically', () => {
  const a = readMatch(read(REMARKS));
  const out = writeMat(a.match);
  assert.match(out, /; \[IllegalPlay "Game 6, Move \d+ of Simon Lockwood"\]/);
  assert.match(out, /; \[Remark "Game 6, Move 19 of Simon Lockwood --> 11: 3\/2 1\/Off\(2\) was illegal"\]/);
  assert.match(out, /; \[Video "https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ"\]/);
  const b = readMatch(out);
  assert.equal(b.ok, true, JSON.stringify(b.errors));
  assert.deepEqual(b.match.illegalPlays.map((p) => [p.game, p.row, p.player]), [[6, 19, 'Simon Lockwood']]);
  assert.equal(matchHash16(b.match), matchHash16(a.match));
  assert.equal(writeMat(b.match), out, 'writing is a fixed point');
});

test('remark lines are limited in number and length, and only the box of the source or Remark tags are read', () => {
  const many = Array.from({ length: 40 }, (_, i) => `; [Remark "${'x'.repeat(500)} ${i}"]`).join('\n');
  const r = readMatch(`${many}\n${read('foxamon/tester_vs_Osprey12_2026-08-10.mat')}`);
  assert.equal(r.match.remarks.length, 20);
  assert.ok(r.match.remarks.every((x) => x.length <= 300));
});
