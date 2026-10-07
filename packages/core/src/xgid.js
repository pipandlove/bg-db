/**
 * XGID (eXtreme Gammon ID) encoder/decoder. See docs/formats/xgid.md and
 * docs/decisions/0004-xgid-conventions.md.
 *
 * XGID=<board26>:<cubeExp>:<cubeOwner>:<turn>:<dice>:<score1>:<score2>:<crawford>:<length>:<maxCubeExp>
 * Board is written from the ACTIVE player's perspective (the player on roll when encoding):
 *   index 0 = opponent's bar (lowercase), 1..24 = points 1..24, 25 = active player's bar (uppercase).
 *   A..O = 1..15 active checkers, a..o = 1..15 opponent checkers, '-' = empty.
 * Cube value is a power-of-two exponent (0 = cube at 1). Off counts are derived (15 - on board).
 *
 * In this library a decoded XGID uses side 0 = active (perspective) player, side 1 = opponent.
 */
import { emptyPosition } from './rules.js';

const up = (n) => String.fromCharCode(64 + n); // 1..15 -> A..O
const lo = (n) => String.fromCharCode(96 + n); // 1..15 -> a..o

/**
 * @param {object} pos  position (own-perspective model)
 * @param {{onRoll:number, perspective?:number, cube?:number, cubeOwner?:number|null, dice?:number[]|null,
 *          score?:number[], matchLength?:number, crawford?:boolean, jacoby?:boolean, maxCubeExp?:number}} ctx
 *   `perspective` = side whose point of view the board is written from (default: the side on roll,
 *   which gives turn = 1). eXtreme Gammon may write the other player's view with turn = -1.
 */
export function toXGID(pos, ctx) {
  const a = ctx.perspective ?? ctx.onRoll;
  const o = 1 - a;
  let board = '';
  const ch = (n, f) => (n === 0 ? '-' : f(n));
  board += ch(pos.c[o][25], lo);
  for (let i = 1; i <= 24; i++) {
    const mine = pos.c[a][i];
    const theirs = pos.c[o][25 - i];
    board += mine > 0 ? up(mine) : theirs > 0 ? lo(theirs) : '-';
  }
  board += ch(pos.c[a][25], up);
  const cube = ctx.cube ?? 1;
  const exp = Math.log2(cube);
  if (!Number.isInteger(exp)) throw new RangeError(`Cube value ${cube} is not a power of two`);
  const owner = ctx.cubeOwner == null ? 0 : ctx.cubeOwner === a ? 1 : -1;
  const dice = ctx.dice ? ctx.dice.slice().sort((x, y) => y - x).join('') : '00';
  const score = ctx.score ?? [0, 0];
  const length = ctx.matchLength ?? 0;
  const flag = (length > 0 ? ctx.crawford : ctx.jacoby) ? 1 : 0;
  return `XGID=${board}:${exp}:${owner}:${ctx.onRoll === a ? 1 : -1}:${dice}:${score[a]}:${score[o]}:${flag}:${length}:${ctx.maxCubeExp ?? 10}`;
}

/**
 * @returns {{pos:object, ctx:{onRoll:number, cube:number, cubeOwner:number|null, dice:number[]|null,
 *            score:number[], matchLength:number, crawford:boolean, jacoby:boolean, maxCubeExp:number}}}
 *   Side 0 = the perspective ("active") player of the XGID (the uppercase letters).
 */
export function parseXGID(str) {
  let s = str.trim();
  if (/^XGID=/i.test(s)) s = s.slice(5);
  const f = s.split(':');
  if (f.length < 10) throw new Error(`XGID: expected 10 fields separated by ':' but found ${f.length}`);
  const board = f[0];
  if (board.length !== 26) throw new Error(`XGID: the board must have 26 characters (found ${board.length})`);
  const pos = emptyPosition();
  for (let i = 0; i < 26; i++) {
    const c = board[i];
    if (c === '-') continue;
    const code = c.charCodeAt(0);
    let n;
    let mine;
    if (code >= 65 && code <= 79) { n = code - 64; mine = true; }
    else if (code >= 97 && code <= 111) { n = code - 96; mine = false; }
    else throw new Error(`XGID: unexpected character "${c}" in the board`);
    if (i === 0 || i === 25) {
      pos.c[mine ? 0 : 1][25] += n; // a bar (case decides whose)
    } else if (mine) pos.c[0][i] += n;
    else pos.c[1][25 - i] += n;
  }
  for (const side of [0, 1]) {
    let on = 0;
    for (let p = 1; p <= 25; p++) on += pos.c[side][p];
    if (on > 15) throw new Error(`XGID: side ${side} has ${on} checkers (more than 15)`);
    pos.off[side] = 15 - on;
  }
  const exp = parseInt(f[1], 10);
  const ownerRaw = parseInt(f[2], 10);
  const turn = parseInt(f[3], 10);
  const dd = f[4];
  const d1 = parseInt(dd[0], 10) || 0;
  const d2 = parseInt(dd[1], 10) || 0;
  return {
    pos,
    ctx: {
      onRoll: turn === -1 ? 1 : 0,
      cube: 2 ** exp,
      cubeOwner: ownerRaw === 0 ? null : ownerRaw === 1 ? 0 : 1,
      dice: d1 && d2 ? [d1, d2] : null,
      score: [parseInt(f[5], 10), parseInt(f[6], 10)],
      // field 8 is the Crawford flag in a match and (to be confirmed) the Jacoby flag in a money game
      crawford: parseInt(f[8], 10) > 0 && (parseInt(f[7], 10) & 1) === 1,
      jacoby: parseInt(f[8], 10) === 0 && (parseInt(f[7], 10) & 1) === 1,
      matchLength: parseInt(f[8], 10),
      perspective: 0,
      maxCubeExp: parseInt(f[9], 10),
    },
  };
}
