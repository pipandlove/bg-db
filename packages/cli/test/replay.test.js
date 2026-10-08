import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readMatch, toBgdbJson, buildMeta, matchHash16, parseXGID, parseGnubgId, positionKey, startPosition, pipCount, checkPosition, CANONICAL_VERSION } from '@bgdb/core';
import { allTextFixtures, FIXTURES } from '../../core/test/helpers.js';

const SITE_JS = path.join(FIXTURES, '..', 'site', 'js');
// the site code imports "../lib/core/..." which only exists in the built folder: tests load the modules from a built copy
import fs from 'node:fs';
import os from 'node:os';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bgdb-replay-'));
fs.cpSync(SITE_JS, path.join(tmp, 'js'), { recursive: true });
fs.cpSync(path.join(FIXTURES, '..', 'packages', 'core', 'src'), path.join(tmp, 'lib', 'core'), { recursive: true });
const load = (f) => import(pathToFileURL(path.join(tmp, 'js', f)).href);
const [model, boardMod, svg] = [await load('replay-model.js'), await load('board.js'), await load('svg.js')];

const replays = allTextFixtures().map(([file, text]) => {
  const r = readMatch(text);
  assert.equal(r.ok, true, file);
  const meta = buildMeta(r.match, { id: `0001/${matchHash16(r.match)}`, contentHash: 'x'.repeat(64), canonicalVersion: CANONICAL_VERSION, originalHash: 'y' });
  return { file, replay: JSON.parse(JSON.stringify(toBgdbJson(r.match, meta))) };
});

const countCheckers = (pos, s) => pos.off[s] + pos.c[s].reduce((a, b) => a + b, 0);

test('every game of every fixture: the timeline reaches the end, positions are consistent, and each play is one step', () => {
  let steps = 0;
  for (const { file, replay } of replays) {
    replay.games.forEach((g, gi) => {
      const game = model.buildGame(replay, gi);
      assert.equal(game.steps.length, g.actions.length + 1, `${file} game ${g.index}`);
      assert.equal(game.steps.at(-1).kind, 'end');
      game.steps.forEach((st, k) => {
        steps++;
        assert.equal(st.index, k);
        assert.equal(checkPosition(st.pos), null, `${file} game ${g.index} step ${k}: ${checkPosition(st.pos)}`);
      });
      assert.equal(positionKey(game.steps[0].pos), positionKey(startPosition()), 'a game starts from the standard position');
      assert.deepEqual(model.pips(game.steps[0]), [167, 167]);
    });
  }
  assert.ok(steps > 1000, `${steps} steps checked`);
});

test('THE ARROWS AND GHOSTS ARE THE PLAY: before-position + ghosts - departures = the position of the next step (all fixtures)', () => {
  let plays = 0;
  let hits = 0;
  for (const { file, replay } of replays) {
    replay.games.forEach((g, gi) => {
      const game = model.buildGame(replay, gi);
      game.steps.forEach((st, k) => {
        if (st.kind !== 'm') return;
        plays++;
        const next = game.steps[k + 1];
        const side = st.side;
        const before = st.pos;
        // rebuild the next position from what is drawn
        const c = before.c[side].slice();
        let off = before.off[side];
        for (const a of st.draw.arrows) {
          c[a.from]--;
          if (a.to === 0) off++; else c[a.to]++;
        }
        assert.deepEqual(c.slice(1), next.pos.c[side].slice(1), `${file} game ${g.index} play ${st.number}: own checkers`);
        assert.equal(off, next.pos.off[side], `${file} game ${g.index} play ${st.number}: borne off`);
        // ghosts: one per arrow, at the destination, in free slots (never on top of an own checker)
        assert.equal(st.draw.ghosts.length, st.draw.arrows.length);
        const used = new Set();
        for (const gh of st.draw.ghosts) {
          const key = `${gh.point}:${gh.slot}`;
          assert.ok(!used.has(key), `${file}: two ghosts in the same slot ${key}`);
          used.add(key);
          const have = gh.point === 0 ? before.off[side] : before.c[side][gh.point];
          assert.ok(gh.slot >= have, `${file}: ghost drawn on an existing checker`);
        }
        // arrows start on existing checkers, one different checker per arrow
        const from = {};
        for (const a of st.draw.arrows) { from[a.from] = (from[a.from] ?? 0) + 1; assert.ok(a.fromSlot >= 0 && a.fromSlot < before.c[side][a.from]); }
        for (const [p, n] of Object.entries(from)) assert.ok(n <= before.c[side][p], `${file}: more arrows than checkers on ${p}`);
        // hits: the opponent loses the blot and gets a ghost on the bar
        const opp = 1 - side;
        const barGain = next.pos.c[opp][25] - before.c[opp][25];
        assert.equal(st.draw.hitGhosts.length, barGain, `${file}: ghosts on the bar = checkers hit`);
        assert.equal(st.draw.blots.length, barGain);
        hits += barGain;
        for (const b of st.draw.blots) assert.equal(before.c[opp][b.point], 1, 'a hit blot was alone');
      });
    });
  }
  assert.ok(plays > 500 && hits > 20, `${plays} plays and ${hits} hits checked`);
});

test('chained steps become one arrow (24/21/15) only when the checker must be the one that arrived', () => {
  const before = startPosition();
  const p = model.pathsOf([[24, 21, 0], [21, 15, 0]], before, 0);
  assert.equal(p.length, 1);
  assert.deepEqual([p[0].from, p[0].to, p[0].points], [24, 15, [24, 21, 15]]);
  assert.equal(model.playText(p), '24/21/15');
  // checkers already stand on 8: 13/8 then 8/4 are two different checkers (one arrives, one leaves)
  const q = model.pathsOf([[13, 8, 0], [8, 4, 0]], before, 0);
  assert.equal(q.length, 2);
  // one checker on 9: 13/9 then 9/5 twice = the original leaves and the arrived one goes on (two arrows, one of them 13/9/5)
  const own = { c: [new Array(26).fill(0), new Array(26).fill(0)], off: [0, 0] };
  own.c[0][13] = 2; own.c[0][9] = 1;
  const w = model.pathsOf([[13, 9, 0], [9, 5, 0], [9, 5, 0]], own, 0);
  assert.equal(w.length, 2);
  assert.ok(w.some((x) => x.points.join('/') === '13/9/5') && w.some((x) => x.points.join('/') === '9/5'));
  // a hit in the middle is starred; identical paths are grouped
  const r = model.pathsOf([[24, 20, 1], [20, 16, 0]], before, 0);
  assert.equal(model.playText(r), '24/20*/16');
  assert.equal(model.playText(model.pathsOf([[13, 7, 0], [13, 7, 0], [25, 20, 0], [6, 0, 0]], { c: [[...before.c[0]], []], off: [0, 0] }, 0)), '13/7(2) bar/20 6/off');
});

test('the text of each play matches what the match file says (first game of the Linnet14 match)', () => {
  const { replay } = replays.find((r) => r.file.includes('Linnet14'));
  const game = model.buildGame(replay, 0);
  assert.deepEqual(game.steps.slice(0, 4).map((s) => s.text), ['65 24/13', '63 24/18 13/10', '42 13/7*', '43 bar/18*']);
  assert.equal(game.steps.find((s) => s.text.includes('bar/') && s.text.split(' ').length > 2).text.split(' ')[1].startsWith('bar/'), true, 'a play that enters from the bar is written with the bar first');
  assert.ok(game.steps.some((s) => s.text === 'Doubles to 2'));
  assert.ok(game.steps.some((s) => s.text === 'Takes'));
  assert.equal(game.steps.at(-1).text, 'tester wins 2 points');
});

test('the cube follows doubles, takes and passes; an offer is visible while it is pending', () => {
  const { replay } = replays.find((r) => r.file.includes('Linnet14'));
  const g = model.buildGame(replay, 0);
  const iD = g.steps.findIndex((s) => s.kind === 'd');
  assert.deepEqual(g.steps[iD].cube, { value: 1, owner: null });
  assert.equal(g.steps[iD + 1].kind, 't');
  assert.deepEqual(g.steps[iD + 1].offer, { side: g.steps[iD].side, value: 2 });
  assert.deepEqual(g.steps[iD + 2].cube, { value: 2, owner: g.steps[iD + 1].side }, 'after the take the taker owns the cube');
  assert.equal(g.steps[iD + 2].offer, null);
});

test('position IDs of a step decode back to the same position, cube, score and dice', () => {
  let checked = 0;
  for (const { file, replay } of replays) {
    replay.games.forEach((g, gi) => {
      const game = model.buildGame(replay, gi);
      for (const st of game.steps) {
        const ids = model.positionIds(replay, game, st);
        if (st.kind === 't' || st.kind === 'p' || st.kind === 'end') { assert.equal(ids, null); continue; }
        assert.ok(ids.xgid.startsWith('XGID=') && /^[A-Za-z0-9+/]{14}:[A-Za-z0-9+/]{12}$/.test(ids.gnubgid), `${file}: ${ids.xgid} ${ids.gnubgid}`);
        for (const [dec, label] of [[parseXGID(ids.xgid), 'XGID'], [parseGnubgId(ids.gnubgid), 'GNUBGID']]) {
          const onRoll = dec.ctx.onRoll;
          // the decoded position has the perspective of the side on roll in a fixed side numbering: compare as sets of (side, point, count)
          const sideOf = (decodedSide) => (label === 'XGID' ? (decodedSide === 0 ? st.side : 1 - st.side) : decodedSide);
          for (const ds of [0, 1]) {
            const real = sideOf(ds);
            assert.deepEqual(dec.pos.c[ds].slice(1), st.pos.c[real].slice(1), `${file} ${label} step ${st.index}: points of side ${real}`);
            assert.equal(dec.pos.off[ds], st.pos.off[real]);
          }
          assert.equal(dec.ctx.cube, st.cube.value, `${label} cube`);
          if (label === 'GNUBGID') {
            assert.equal(onRoll, st.side);
            assert.deepEqual(dec.ctx.score, st.score);
            assert.deepEqual(dec.ctx.dice, st.kind === 'm' ? st.dice : null);
            assert.equal(dec.ctx.cubeOwner, st.cube.owner);
            assert.equal(dec.ctx.matchLength, replay.matchLength);
          } else {
            assert.deepEqual(dec.ctx.dice, st.kind === 'm' ? [Math.max(...st.dice), Math.min(...st.dice)] : null);
            assert.equal(dec.ctx.matchLength, replay.matchLength);
            assert.deepEqual(dec.ctx.score, [st.score[st.side], st.score[1 - st.side]]);
          }
        }
        checked++;
      }
    });
  }
  assert.ok(checked > 800, `${checked} positions checked`);
});

test('the opening position IDs are the well-known ones', () => {
  const { replay } = replays.find((r) => r.file.includes('Linnet14'));
  const game = model.buildGame(replay, 0);
  const ids = model.positionIds(replay, game, game.steps[0]);
  assert.equal(ids.xgid.split(':')[0], 'XGID=-b----E-C---eE---c-e----B-');
  assert.match(ids.xgid, /:0:0:1:65:0:0:1:7:10$|:0:0:1:65:0:0:0:7:10$/);
  assert.equal(ids.gnubgid.split(':')[0], '4HPwATDgc/ABMA');
});

// ---- the board drawing
const tree = (replay, gi, k, extra = {}) => {
  const game = model.buildGame(replay, gi);
  return { game, step: game.steps[k], svg: boardMod.boardTree({ replay, game, step: game.steps[k], ...extra }) };
};
const first = replays.find((r) => r.file.includes('vireo')).replay;

/** a small well-formedness check: every tag is closed in order, no stray "<" or "&" in text or attributes */
function assertWellFormed(xml) {
  const stack = [];
  for (const m of xml.matchAll(/<(\/?)([a-zA-Z]+)((?:\s+[\w:-]+="[^"<&]*(?:&(?:amp|lt|gt|quot|#39);[^"<&]*)*")*)\s*(\/?)>|<\?xml[^>]*\?>|([^<]+)/g)) {
    if (m[5] !== undefined) { assert.ok(!/&(?!(amp|lt|gt|quot|#39);)/.test(m[5]), `raw & in text: ${m[5].slice(0, 40)}`); continue; }
    if (m[2] === undefined) continue;
    if (m[1]) assert.equal(stack.pop(), m[2], 'closing tag out of order');
    else if (!m[4]) stack.push(m[2]);
  }
  assert.deepEqual(stack, []);
  assert.ok(!/<[^a-zA-Z/?]/.test(xml.replace(/<\?xml[^>]*\?>/, '')), 'a "<" that starts no tag');
}

test('every step of every fixture draws, in both themes, as well-formed SVG (all plays, all cube steps, the end of each game)', () => {
  let n = 0;
  for (const { replay } of replays) {
    replay.games.forEach((g, gi) => {
      const game = model.buildGame(replay, gi);
      for (const step of game.steps) {
        for (const theme of ['board', 'export']) {
          const xml = svg.serialize(boardMod.boardTree({ replay, game, step, theme }));
          assert.ok(xml.startsWith('<svg ') && xml.endsWith('</svg>'));
          n++;
          if (n % 150 === 0) assertWellFormed(xml);
        }
      }
    });
  }
  assert.ok(n > 2000, `${n} drawings`);
});

test('the board shows the position before the play: 15 checkers a side, arrows and ghosts from the play, dice for a roll only', () => {
  const { step, svg: t } = tree(first, 0, 2);                       // game 1, play 3: 36 24/18/15 by the first player
  const xml = svg.serialize(t);
  const circles = (xml.match(/<circle [^>]*r="27"/g) ?? []).length;           // checkers: r = 28 - 1 (half the edge line)
  const ghosts = (xml.match(/<g opacity="0\.45">/g) ?? []).length;
  assert.equal(circles, 30 + step.draw.ghosts.length, '30 checkers + the ghosts (also circles)');
  assert.equal(ghosts, step.draw.ghosts.length);
  assert.equal((xml.match(/stroke-linecap="round"/g) ?? []).length, step.draw.arrows.length, 'one arrow per path');
  assert.equal((xml.match(/<rect [^>]*width="52" height="52"/g) ?? []).length, 2, 'two dice');
  const cubeStep = model.buildGame(first, 0).steps.find((s) => s.kind === 'd');
  const noDice = svg.serialize(boardMod.boardTree({ replay: first, game: model.buildGame(first, 0), step: cubeStep }));
  assert.equal((noDice.match(/<rect [^>]*width="52" height="52"/g) ?? []).length, 0, 'no dice on a cube step');
  const noArrows = svg.serialize(boardMod.boardTree({ replay: first, game: model.buildGame(first, 0), step, arrows: false }));
  assert.equal((noArrows.match(/stroke-linecap="round"/g) ?? []).length, 0);
  assert.equal((noArrows.match(/<g opacity="0\.45">/g) ?? []).length, 0);
});

test('hits: a red dashed ring on the blot and a ghost on the bar', () => {
  const game = model.buildGame(first, 0);
  const k = game.steps.findIndex((s) => s.kind === 'm' && s.draw.blots.length > 0);
  const xml = svg.serialize(boardMod.boardTree({ replay: first, game, step: game.steps[k] }));
  const hit = boardMod.THEMES.board.hit;
  assert.ok(xml.includes(`stroke="${hit}"`), 'the hit ring');
  assert.equal((xml.match(new RegExp(`stroke="${hit}"`, 'g')) ?? []).length, game.steps[k].draw.blots.length);
  assert.ok(game.steps[k].draw.hitGhosts.length >= 1);
});

test('the export is monochrome: only black, white and greys, no arrows, with pip counts, cube, dice and the point numbers of the bottom player', () => {
  const { svg: t, step } = tree(first, 0, 6, { theme: 'export', arrows: false, numbers: 'bottom', labelSide: 0 });
  const xml = svg.toSvgFile({ ...t, attrs: { ...t.attrs, width: boardMod.VIEW_W, height: boardMod.VIEW_H } });
  assert.ok(xml.startsWith('<?xml'));
  assert.ok(xml.includes('xmlns="http://www.w3.org/2000/svg"'));
  const colours = [...xml.matchAll(/(?:fill|stroke)="(#[0-9a-fA-F]{3,8}|[a-z]+)"/g)].map((m) => m[1].toLowerCase()).filter((c) => c !== 'none');
  for (const c of new Set(colours)) assert.match(c, /^#([0-9a-f])\1\1\1\1\1$|^#(?:000000|ffffff|[0-9a-f]{2}\1{0}[0-9a-f]{2}[0-9a-f]{2})$/, `not a grey: ${c}`);
  for (const c of new Set(colours)) { const m = c.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/); assert.ok(m && m[1] === m[2] && m[2] === m[3], `not a grey: ${c}`); }
  assert.equal((xml.match(/stroke-linecap="round"/g) ?? []).length, 0, 'no arrows');
  assert.match(xml, /pips 1\d\d/);
  assert.ok(xml.includes('>64<'), 'the cube in the middle shows 64');
  assert.equal((xml.match(/<rect [^>]*width="52" height="52"/g) ?? []).length, 2, 'the dice of the roll');
  for (const n of [1, 6, 12, 13, 19, 24]) assert.ok(xml.includes(`>${n}</text>`), `point number ${n}`);
  assertWellFormed(xml);
  assert.ok(step.dice);
});

test('point numbers: of the player to move (default), of the bottom player, or hidden', () => {
  const nums = (extra) => { const xml = svg.serialize(tree(first, 0, 1, extra).svg); return (xml.match(/font-size="15"/g) ?? []).length; };
  assert.equal(nums({}), 24);
  assert.equal(nums({ numbers: 'bottom' }), 24);
  assert.equal(nums({ numbers: 'none' }), 0);
  // play 2 is by the second player, who is at the top: the labels are in his numbering, so the bottom row reads 13..24 from the left
  const xml = svg.serialize(tree(first, 0, 1, {}).svg);
  const bottom = [...xml.matchAll(/<text x="([\d.]+)" y="(7\d\d(?:\.\d+)?)"[^>]*font-size="15"[^>]*>(\d+)<\/text>/g)].sort((a, b) => a[1] - b[1]).map((m) => +m[3]);
  assert.deepEqual(bottom, [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
  const bottomSide = svg.serialize(tree(first, 0, 1, { numbers: 'bottom' }).svg);
  const b2 = [...bottomSide.matchAll(/<text x="([\d.]+)" y="(7\d\d(?:\.\d+)?)"[^>]*font-size="15"[^>]*>(\d+)<\/text>/g)].sort((a, b) => a[1] - b[1]).map((m) => +m[3]);
  assert.deepEqual(b2, [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
});

test('swapping players and mirroring move names, home boards and dice', () => {
  const nameY = (xml, name) => +xml.match(new RegExp(`y="([\\d.]+)"[^>]*font-weight="700"[^>]*>${name}</text>`))[1];
  const a = svg.serialize(tree(first, 0, 0, {}).svg);
  const b = svg.serialize(tree(first, 0, 0, { bottomSide: 1 }).svg);
  assert.ok(nameY(a, 'vireo') > nameY(a, 'tester'), 'vireo (side 0) at the bottom');
  assert.ok(nameY(b, 'tester') > nameY(b, 'vireo'), 'swapped');
  const m = svg.serialize(tree(first, 0, 0, { mirror: true }).svg);
  assert.notEqual(a, m);
  const diceX = (xml) => [...xml.matchAll(/<rect x="([\d.]+)" y="[\d.]+" width="52" height="52"/g)].map((x) => +x[1]);
  assert.ok(Math.min(...diceX(a)) > boardMod.VIEW_W / 2, 'the first player at the bottom rolls in the right-hand half');
  assert.ok(Math.max(...diceX(m)) < boardMod.VIEW_W / 2, 'mirrored: the left-hand half');
});

test('names are data: markup in a player name is escaped, never interpreted', () => {
  const evil = JSON.parse(JSON.stringify(first));
  evil.sides[0].name = '<script>alert(1)</script> & "q" \'x\'';
  const xml = svg.serialize(boardMod.boardTree({ replay: evil, game: model.buildGame(evil, 0), step: model.buildGame(evil, 0).steps[0] }));
  assert.ok(!xml.includes('<script>'));
  assert.ok(xml.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot; &#39;x&#39;'));
  assertWellFormed(xml);
  assert.equal(svg.escapeXml('a<b>&"\''), 'a&lt;b&gt;&amp;&quot;&#39;');
});

test('an illegal play that was made is marked on the board, with a banner and red arrows', () => {
  const { replay } = replays.find((r) => r.file.includes('illegal-play-declared-in-remarks'));
  const gi = 5;
  const game = model.buildGame(replay, gi);
  const k = game.steps.findIndex((s) => s.illegal);
  assert.ok(k > 0);
  const xml = svg.serialize(boardMod.boardTree({ replay, game, step: game.steps[k] }));
  assert.ok(xml.includes('illegal play, kept as played'));
  assert.ok(xml.includes(`stroke="${boardMod.THEMES.board.illegal}"`), 'red arrows');
  assert.match(boardMod.describeStep(replay, game, game.steps[k]), /an illegal play, kept as played/);
  assert.ok(!svg.serialize(boardMod.boardTree({ replay, game, step: game.steps[k - 1] })).includes('illegal play'));
});

test('the end of a game shows the result in a banner; the text for a screen reader describes each step', () => {
  const game = model.buildGame(first, 0);
  const end = game.steps.at(-1);
  assert.ok(svg.serialize(boardMod.boardTree({ replay: first, game, step: end })).includes('tester wins 1 point (cube dropped)'));
  assert.equal(boardMod.describeStep(first, game, game.steps[0]), 'Game 1, play 1: vireo rolls 1 and 5 and plays 24/23 13/8.');
  assert.match(boardMod.describeStep(first, game, game.steps.find((s) => s.kind === 'd')), /^Game 1: tester doubles to 2\.$/);
  assert.match(boardMod.describeStep(first, game, end), /^Game 1, final position\./);
});

// ---- design choices of the owner: blue palette, plain checkers, numbers of the player on move
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

test('the board palette is blue (dark navy and light blue points on a mid-blue board), not brown', () => {
  const th = boardMod.THEMES.board;
  for (const k of ['bg', 'frame', 'triA', 'triB', 'bar', 'mid', 'tray']) {
    const [r, g, b] = hex(th[k]);
    assert.ok(b > r && b >= g, `${k} ${th[k]} is a shade of blue`);
  }
  const lum = (c) => { const [r, g, b] = hex(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  assert.ok(lum(th.triA) < 120 && lum(th.triB) > 170, 'one dark and one light blue');
  assert.ok(lum(th.triA) < lum(th.mid) && lum(th.mid) < lum(th.triB), 'the board between the points is a blue between the two');
  assert.ok(lum(th.c0.fill) > 230 && lum(th.c1.fill) < 70, 'light and dark checkers');
  assert.ok(lum(th.c1.fill) - lum(th.triA) > 25, 'a dark checker stands out from the dark point under it');
  const xml = svg.serialize(tree(first, 0, 3).svg);
  assert.ok(xml.includes(th.triA) && xml.includes(th.triB));
  for (const brown of ['#6c4636', '#a58f7d', '#1f1a16', '#3a3027']) assert.ok(!xml.includes(brown), `old brown ${brown} is gone`);
});

test('a checker is one plain disc with a thin black edge, a little wider than the base of a point: no ring inside (board and picture)', () => {
  for (const theme of ['board', 'export']) {
    const xml = svg.serialize(tree(first, 0, 0, { theme }).svg);
    const discs = (xml.match(/<circle [^>]*r="27"[^>]*stroke="#000000" stroke-width="2"/g) ?? []).length;
    assert.ok(discs >= 30, `${theme}: ${discs} checkers`);
    assert.equal((xml.match(/<circle [^>]*r="16"/g) ?? []).length, 0, `${theme}: no inner ring`);
    assert.ok(!/<circle [^>]*fill="none"[^>]*r="16"/.test(xml));
    // exactly one circle element per checker (dice pips are r=5.2, hit rings r=33)
    const circles = (xml.match(/<circle /g) ?? []).length;
    const pips = (xml.match(/<circle [^>]*r="5\.2"/g) ?? []).length;
    assert.equal(circles, discs + pips + (xml.match(/<circle [^>]*r="33"/g) ?? []).length, `${theme}: only discs, dice pips and hit rings`);
  }
  for (const theme of Object.values(boardMod.THEMES)) for (const c of [theme.c0, theme.c1]) assert.equal(c.stroke, '#000000', 'a thin black edge');
  // a checker (56 wide with its line) is a little wider than the base of a point (58 - 2 x 2), and still clear of the next point's checker (58 apart)
  const xml = svg.serialize(tree(first, 0, 0).svg);
  const base = xml.match(/<polygon points="([\d.]+),[\d.]+ ([\d.]+),/).slice(1).map(Number);
  const width = base[1] - base[0];
  assert.ok(56 > width && 56 - width <= 3, `checker 56, point base ${width}`);
});

test('point numbers follow the player on move: each side sees its own 1 at the first point of its own home board', () => {
  const game = model.buildGame(first, 0);
  const labels = (step, extra = {}) => {
    const xml = svg.serialize(boardMod.boardTree({ replay: first, game, step, ...extra }));
    const nums = [...xml.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*font-size="15"[^>]*>(\d+)<\/text>/g)];      // the point numbers, above and below the board
    const row = (top) => nums.filter((m) => (+m[2] < boardMod.VIEW_H / 2) === top).sort((a, b) => a[1] - b[1]).map((m) => +m[3]);
    return { top: row(true), bottom: row(false) };
  };
  const p1 = game.steps.find((s) => s.kind === 'm' && s.side === 0);       // player at the bottom is on move
  const p2 = game.steps.find((s) => s.kind === 'm' && s.side === 1);       // player at the top is on move
  const a = labels(p1);
  assert.deepEqual(a.bottom, [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 'bottom player on move: his 1 is at the right end of the bottom row');
  assert.deepEqual(a.top, [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
  const b = labels(p2);
  assert.deepEqual(b.top, [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 'top player on move: his 1 is at the right end of the top row, in his own home board');
  assert.deepEqual(b.bottom, [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
  // the same holds with the roles swapped on the screen
  assert.deepEqual(labels(p2, { bottomSide: 1 }).bottom, [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
});

test('the answer to a double keeps the numbering of the player who doubled, so the numbers do not flip; the end of a game uses the bottom player', () => {
  const game = model.buildGame(first, 0);
  const iD = game.steps.findIndex((s) => s.kind === 'd');
  const dSide = game.steps[iD].side;
  assert.equal(boardMod.numberingSide(game.steps[iD], 0), dSide);
  assert.equal(boardMod.numberingSide(game.steps[iD + 1], 0), dSide, 'take / pass');
  assert.equal(boardMod.numberingSide(game.steps.at(-1), 1), 1, 'end: the bottom player');
  assert.equal(boardMod.numberingSide(game.steps[0], 0), game.steps[0].side, 'a roll: the roller');
  const bottomRow = (k) => { const xml = svg.serialize(boardMod.boardTree({ replay: first, game, step: game.steps[k] })); return [...xml.matchAll(/<text x="([\d.]+)" y="(7\d\d(?:\.\d+)?)"[^>]*font-size="15"[^>]*>(\d+)<\/text>/g)].sort((a, b) => a[1] - b[1]).map((m) => m[3]).join(','); };
  assert.equal(bottomRow(iD), bottomRow(iD + 1));
});

test('the exported picture follows the same numbering as the board (and the menu setting), not a fixed one', () => {
  const game = model.buildGame(first, 0);
  const step = game.steps.find((s) => s.kind === 'm' && s.side === 1);
  const row = (xml) => [...xml.matchAll(/<text x="([\d.]+)" y="(7\d\d(?:\.\d+)?)"[^>]*font-size="15"[^>]*>(\d+)<\/text>/g)].sort((a, b) => a[1] - b[1]).map((m) => +m[3]);
  const mover = svg.serialize(boardMod.boardTree({ replay: first, game, step, theme: 'export', arrows: false, numbers: 'mover' }));
  const bottom = svg.serialize(boardMod.boardTree({ replay: first, game, step, theme: 'export', arrows: false, numbers: 'bottom' }));
  assert.deepEqual(row(mover), [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
  assert.deepEqual(row(bottom), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
});

test('a game from a set position: the replay starts from that position (uppercase = the left player)', { todo: 'games from a set position: not supported yet (roadmap)' }, () => {
  const r = readMatch(fs.readFileSync(path.join(FIXTURES, 'invalid/set-position-start_11pt.mat'), 'utf8'));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const meta = buildMeta(r.match, { id: `0001/${matchHash16(r.match)}`, contentHash: 'x'.repeat(64), canonicalVersion: CANONICAL_VERSION, originalHash: 'y' });
  const game = model.buildGame(JSON.parse(JSON.stringify(toBgdbJson(r.match, meta))), 0);
  assert.equal(positionKey(game.steps[0].pos), positionKey(parseXGID('----cBD-D-B--A--Abcdc---A-:0:0:1:00:0:0:0:0:10').pos));
});
