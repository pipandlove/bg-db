import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sgfAnalysis, xgAnalysis, summarise, classOf } from '../src/index.js';
import { sgfTrees } from '../src/sgf.js';
import { xgRecords } from '../src/xg.js';
import { FIXTURES } from './helpers.js';

const bytes = (rel) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, rel)));
const text = (rel) => fs.readFileSync(path.join(FIXTURES, rel), 'utf8');

// the same matches analysed by eXtreme Gammon (.xg) and by GNU Backgammon at 2-ply ("World class") and 3-ply ("Grandmaster")
const TWINS = ['2026-01-20T15-36-47-bluetailedgrebe1-tester', '2026-01-22T18-31-58-avocet-tester'];
const ANALYSED_SGF = [...TWINS.flatMap((m) => [`gnubg-analysis/${m}-2ply.sgf`, `gnubg-analysis/${m}-3ply.sgf`]), 'choue-net/chouehandle-vs-Bot-all-games-s4020-2026-10-04.sgf'];

/** gnubg's own summary, summed over the games: GS[M:...] and GS[C:...]; its player 0 is W, side 1 of the model */
function gnubgTotals(t) {
  const out = [0, 1].map(() => ({ checker: 0, cube: 0, unforced: 0 }));
  for (const tree of sgfTrees(t)) {
    const gs = tree[0].GS;
    if (!gs) continue;
    const M = gs.find((x) => x.startsWith('M:')).slice(2).trim().split(/\s+/).map(Number);
    const C = gs.find((x) => x.startsWith('C:')).slice(2).trim().split(/\s+/).map(Number);
    for (const p of [0, 1]) {
      const side = out[1 - p];
      side.unforced += M[p];
      side.checker += M[12 + 2 * p];                                    // EMG, then MWC, for each player
      for (let k = 0; k < 6; k++) side.cube += C[20 + 12 * p + 2 * k]; // six kinds of cube error, EMG then MWC, player by player
    }
  }
  return out;
}

test('gnubg SGF: errors summed decision by decision equal gnubg\'s own totals, checker play and cube (through the match equity table)', () => {
  for (const f of ANALYSED_SGF) {
    const t = text(f);
    const s = summarise(sgfAnalysis(t).decisions);
    const g = gnubgTotals(t);
    for (const side of [0, 1]) {
      assert.ok(Math.abs(s[side].checker.error - g[side].checker) < 1e-4, `${f} side ${side} checker`);
      assert.ok(Math.abs(s[side].cube.error - g[side].cube) < 1e-4, `${f} side ${side} cube`);
      assert.equal(s[side].checker.decisions, g[side].unforced, `${f} side ${side} unforced moves`);
    }
  }
});

test('gnubg SGF: the cube decisions counted are gnubg\'s "close or actual" ones, and PR is its error rate per decision / 2', () => {
  const s = summarise(sgfAnalysis(text('gnubg-analysis/2026-01-22T18-31-58-avocet-tester-2ply.sgf')).decisions);
  // gnubg 1.08 "show statistics match": close or actual cube decisions 5 (tester) and 80 (avocet); error rate 19.0 and 37.3 mEMG
  assert.deepEqual([s[1].cube.decisions, s[0].cube.decisions], [5, 80]);
  assert.equal((s[1].pr * 2).toFixed(1), '19.0');
  assert.equal((s[0].pr * 2).toFixed(1), '37.3');
  // the depth of an analysis is its deepest evaluation: gnubg's move filter leaves a lone candidate at a lower depth
  const depth = (f) => Math.max(...sgfAnalysis(text(f)).decisions.map((x) => x.plies));
  assert.equal(depth('gnubg-analysis/2026-01-22T18-31-58-avocet-tester-2ply.sgf'), 3, 'gnubg 2-ply is XG 3-ply');
  assert.equal(depth('gnubg-analysis/2026-01-22T18-31-58-avocet-tester-3ply.sgf'), 4, 'gnubg 3-ply is XG 4-ply');
});

test('an SGF without analysis gives null', () => {
  assert.equal(sgfAnalysis(text('gnubg-sgf/2026-01-20T15-36-47-bluetailedgrebe1-tester.sgf')), null);
});

test('XG: the cube error stored by XG is the one given by its no double, double/take and double/pass equities', () => {
  let n = 0;
  for (const f of fs.readdirSync(path.join(FIXTURES, 'xg-binary'))) {
    for (const r of xgRecords(bytes(`xg-binary/${f}`))) {
      if (r[8] !== 2) continue;
      const v = new DataView(r.buffer, r.byteOffset, r.byteLength);
      const doubled = v.getInt32(16, true), err = v.getFloat64(200, true);
      if (doubled === -2 || err === -1000) continue;
      const nd = v.getFloat32(152, true), dt = v.getFloat32(156, true), dp = v.getFloat32(160, true);
      const opt = Math.max(nd, Math.min(dt, dp));
      assert.ok(Math.abs(Math.abs(err) - (opt - (doubled === 1 ? Math.min(dt, dp) : nd))) < 1e-3, `${f}: cube error`);
      n++;
    }
  }
  assert.ok(n > 500);
});

test('twins: XG and gnubg count the same unforced plays, and their PR agree within 1', () => {
  for (const m of TWINS) {
    const x = summarise(xgAnalysis(bytes(`xg-binary/${m}.xg`)).decisions);
    const g = summarise(sgfAnalysis(text(`gnubg-analysis/${m}-2ply.sgf`)).decisions);
    for (const side of [0, 1]) {
      const twin = g[1 - side];                                          // XG lists tester first, the SGF second
      assert.equal(x[side].checker.decisions, twin.checker.decisions, `${m}: unforced plays`);
      assert.ok(Math.abs(x[side].pr - twin.pr) < 1, `${m}: PR ${x[side].pr.toFixed(2)} (XG) against ${twin.pr.toFixed(2)} (gnubg)`);
    }
  }
});

test('XG levels: read as XG shows them (checker play 4-ply, cube XG Roller+ in this file)', () => {
  // what XG 2.10 shows for this match: a play of game 1 analysed at 4-ply, a redouble "Analyzed in XG Roller+" (no double +0.866, double/take +0.940)
  const d = xgAnalysis(bytes('xg-binary/2026-01-20T15-36-47-bluetailedgrebe1-tester.xg')).decisions;
  assert.ok(d.filter((x) => x.kind === 'move').every((x) => x.plies === 4));
  const redouble = d.find((x) => x.kind === 'no-double' && Math.abs(x.error - 0.0735) < 5e-4);
  assert.equal(redouble.plies, 6);
});

test('classes: inaccuracy from 0.04, error from 0.08, blunder from 0.16', () => {
  assert.deepEqual([0.039, 0.04, 0.08, 0.159, 0.16].map(classOf), [null, 'inaccuracy', 'error', 'error', 'blunder']);
});
