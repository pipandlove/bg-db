/**
 * The analysis of a match, read decision by decision from the file that carries it, and summed with one rule whatever the engine (decision 0026).
 *
 * A decision: { game, side, kind, error, plies, counted }
 *   kind     'move' (checker play), 'no-double' (the player could double and did not), 'double', 'take' or 'pass'
 *   error    equity lost by the choice, in EMG (normalised money equity: 1 = a single game at the current cube), never negative
 *   plies    depth of the evaluation, counted like eXtreme Gammon (the raw network is 1-ply; gnubg's n-ply is n + 1 here)
 *   counted  the decision enters the PR: a checker play with a choice, a double, a take or a pass, a no-double that was close or wrong
 *
 * GNU Backgammon SGF: a move node holds A[i][move E ver 3 p1..p5 equity plies...]... (candidates best first, i = the one played; equities in EMG)
 * and DA[E ver 3 <context> <no double: 5 probabilities, cubeless, cubeful> <double/take: the same>] (cubeful equities as match winning chances).
 *
 * eXtreme Gammon .xg (records of 2 560 bytes, docs/formats/xg-binary.md; offsets as in the open-source xgdatatools):
 *   move record (3)  position before the play (26 signed bytes at 9, seen by player 1), error of the play (double at 2312, -1000 = not
 *                    analysed), level (int32 at 2472)
 *   cube record (2)  doubled (int32 at 16: -2 = the cube was not available), answer (20), level (int32 at 92), no double, double/take, double/pass (floats at 152,
 *                    156, 160, in EMG: double/pass = 1), error of the cube action (double at 200) and of the answer (216)
 */
import { sgfTrees } from './sgf.js';
import { xgRecords } from './xg.js';
import { emptyPosition, legalPlays } from './rules.js';
import { PRE, POST } from './met.js';

/** the thresholds of the classes, in EMG (gnubg's defaults: doubtful, bad, very bad) */
export const CLASSES = [['blunder', 0.16], ['error', 0.08], ['inaccuracy', 0.04]];

/** a no-double counts when doubling was within this much of not doubling */
const CLOSE_CUBE = 0.16;

export const classOf = (error) => (CLASSES.find(([, t]) => error >= t - 5e-7) ?? [null])[0];

/** chance to win the match, `me` and `opp` points away; after the Crawford game the post-Crawford table applies */
function mwc(me, opp, postCrawford) {
  if (me <= 0) return 1;
  if (opp <= 0) return 0;
  if (postCrawford && me === 1) return 1 - POST[opp - 1];
  if (postCrawford && opp === 1) return POST[me - 1];
  return PRE[me - 1][opp - 1];
}

/** gnubg's mwc2eq: a match winning chance of `side` as EMG with this cube, so that winning the game (double/pass) is 1 and losing it -1 */
function toEmg(r, length, score, side, cube) {
  const me = length - score[side], opp = length - score[1 - side];
  const post = me === 1 || opp === 1;                                    // someone is 1 away at the start of the game: it is the Crawford game or after it
  const win = mwc(me - cube, opp, post), lose = mwc(me, opp - cube, post);
  return (2 * r - (win + lose)) / (win - lose);
}

const numbers = (s) => s.trim().split(/\s+/).map(Number);

/** a gnubg evaluation context "3C 0 1 0.000000 1": plies counted from 0, and C when cubeful */
const plies = (ctx) => parseInt(ctx, 10) + 1;

/**
 * eXtreme Gammon's level codes, checked against what XG shows (decision 0026): n = (n + 1)-ply, 1001 = XG Roller+.
 * The Rollers rank above 4-ply: XG Roller 5, Roller+ 6, Roller++ 7.
 */
const xgPlies = (code) => (code >= 1000 ? 5 + (code - 1000) : code + 1);

/**
 * @param {string} text a GNU Backgammon SGF file
 * @returns {{ engine: string, decisions: object[] } | null} null when the file holds no analysis
 */
export function sgfAnalysis(text) {
  const trees = sgfTrees(text);
  const root = trees[0][0];
  const length = parseInt(((root.MI ?? []).find((v) => v.startsWith('length:')) ?? 'length:0').slice(7), 10);
  const decisions = [];
  trees.forEach((nodes, gi) => {
    const mi = Object.fromEntries((nodes[0].MI ?? []).map((v) => v.split(':')));
    const score = [parseInt(mi.bs ?? '0', 10), parseInt(mi.ws ?? '0', 10)];
    let cube = 1;
    let cubeEq = null;                                                    // the last double: [no double, double/take, double/pass] in EMG of the doubler
    for (const n of nodes.slice(1)) {
      const key = n.B ? 'B' : n.W ? 'W' : null;
      if (!key) continue;
      const side = key === 'B' ? 0 : 1;
      const v = n[key][0];
      const add = (kind, error, depth, counted) => decisions.push({ game: gi + 1, side, kind, error: Math.max(0, error), plies: depth, counted });
      let da = null;
      if (n.DA) {
        const m = n.DA[0].match(/^E ver 3 (\d+C?) \S+ \S+ \S+ (.*)$/);
        if (m) {
          const o = numbers(m[2]);
          const who = v === 'take' || v === 'drop' ? 1 - side : side;   // the equities are those of the player who may double
          // ponytail: money games are taken as already in EMG (double/pass = 1); no analysed money SGF to check it against yet
          const eq = (r) => (length ? toEmg(r, length, score, who, cube) : r);
          da = { nd: eq(o[6]), dt: eq(o[13]), dp: 1, plies: plies(m[1]) };
        }
      }
      if (v === 'double') {
        if (da) {
          const opt = Math.max(da.nd, Math.min(da.dt, da.dp));
          add('double', opt - Math.min(da.dt, da.dp), da.plies, true);
          cubeEq = da;
        }
      } else if (v === 'take' || v === 'drop') {
        const d = da ?? cubeEq;
        if (d) add(v === 'take' ? 'take' : 'pass', v === 'take' ? d.dt - d.dp : d.dp - d.dt, d.plies, true);
        if (v === 'take') cube *= 2;
      } else {
        if (da) {
          const opt = Math.max(da.nd, Math.min(da.dt, da.dp));
          const error = opt - da.nd;
          add('no-double', error, da.plies, error > 5e-7 || Math.abs(Math.min(da.dt, da.dp) - da.nd) <= CLOSE_CUBE);
        }
        if (n.A && n.A.length > 1) {
          const cands = n.A.slice(1).map((c) => c.match(/^[a-z]* E ver 3 (?:\S+ ){5}(\S+) (\d+C?)/)).filter(Boolean);
          const played = cands[parseInt(n.A[0], 10)];
          if (played) add('move', +cands[0][1] - +played[1], plies(cands[0][2]), cands.length > 1);
        }
      }
    }
  });
  return decisions.length ? { engine: (root.AP ?? ['GNU Backgammon'])[0], decisions } : null;
}

const NA = -1000;                                                        // XG's mark for "not analysed"

/** the position before a play, from XG's 26 bytes, always seen by player 1 (side 0): points 1..24 (> 0 his, < 0 the opponent's), 25 = his bar, 0 = the opponent's */
function xgPosition(rec) {
  const x = new Int8Array(rec.buffer, rec.byteOffset + 9, 26);
  const pos = emptyPosition();
  for (let p = 1; p <= 24; p++) {
    if (x[p] > 0) pos.c[0][p] = x[p];
    else if (x[p] < 0) pos.c[1][25 - p] = -x[p];
  }
  pos.c[0][25] = x[25];
  pos.c[1][25] = -x[0];
  for (const s of [0, 1]) pos.off[s] = 15 - pos.c[s].reduce((a, b) => a + b, 0);
  return pos;
}

/**
 * @param {Uint8Array} bytes an eXtreme Gammon file
 * @returns {{ engine: string, decisions: object[] } | null} null when the file holds no analysis
 */
export function xgAnalysis(bytes) {
  const decisions = [];
  let game = 0;
  const side = (active) => (active === 1 ? 0 : 1);
  for (const r of xgRecords(bytes)) {
    const v = new DataView(r.buffer, r.byteOffset, r.byteLength);
    if (r[8] === 1) game++;
    else if (r[8] === 2) {
      const doubled = v.getInt32(16, true);
      const err = v.getFloat64(200, true);
      if (doubled === -2 || err === NA) continue;
      const s = side(v.getInt32(12, true));
      const nd = v.getFloat32(152, true), dt = v.getFloat32(156, true), dp = v.getFloat32(160, true);
      const level = xgPlies(v.getInt32(92, true));
      if (doubled === 1) {
        decisions.push({ game, side: s, kind: 'double', error: Math.abs(err), plies: level, counted: true });
        const take = v.getInt32(20, true);
        const errTake = v.getFloat64(216, true);
        if (errTake !== NA) decisions.push({ game, side: 1 - s, kind: take === 1 ? 'take' : 'pass', error: Math.abs(errTake), plies: level, counted: true });
      } else {
        decisions.push({ game, side: s, kind: 'no-double', error: Math.abs(err), plies: level, counted: Math.abs(err) > 5e-7 || Math.abs(Math.min(dt, dp) - nd) <= CLOSE_CUBE });
      }
    } else if (r[8] === 3) {
      const err = v.getFloat64(2312, true);
      if (err === NA) continue;
      const s = side(v.getInt32(64, true));
      const forced = legalPlays(xgPosition(r), s, v.getInt32(100, true), v.getInt32(104, true)).plays.size <= 1;
      decisions.push({ game, side: s, kind: 'move', error: Math.abs(err), plies: xgPlies(v.getInt32(2472, true)), counted: !forced });
    }
  }
  return decisions.length ? { engine: 'eXtreme Gammon', decisions } : null;
}

/**
 * The summary of each side, with one rule: PR = 500 x the error of the counted decisions / their number (eXtreme Gammon's definition).
 * @returns {Array<{ decisions: number, error: number, pr: number|null, checker: object, cube: object }>} index = side
 */
export function summarise(decisions) {
  return [0, 1].map((side) => {
    const mine = decisions.filter((d) => d.side === side);
    const part = (list) => {
      const counts = Object.fromEntries(CLASSES.map(([c]) => [c, 0]));
      for (const d of list) { const c = classOf(d.error); if (c) counts[c]++; }
      return { decisions: list.filter((d) => d.counted).length, error: list.reduce((s, d) => s + d.error, 0), classes: counts };
    };
    const checker = part(mine.filter((d) => d.kind === 'move'));
    const cube = part(mine.filter((d) => d.kind !== 'move'));
    const n = checker.decisions + cube.decisions;
    const error = checker.error + cube.error;
    return { decisions: n, error, pr: n ? (500 * error) / n : null, checker, cube };
  });
}
