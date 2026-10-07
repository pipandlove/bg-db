/**
 * The "Illegal play (...)" marker.
 *
 * eXtreme Gammon's text export (and the sites that reuse it) writes, in place of a play that it could not export, the words
 * "Illegal play" followed by a dump in parentheses: 40 values separated by ";". It was decoded from two real files
 * (docs/formats/illegal-play-marker.md), and every field read here was checked against the match it comes from:
 *
 *   0         match length (the match's, 15 and 11 in the samples)
 *   1-4       four flags (0;1;0;0 in both samples): not interpreted
 *   5, 6      the names of the two players: the first is the "positive" player of the board
 *   7         not interpreted (0)
 *   8, 9      scores at the start of the game, in the order of the names
 *   10        the cube value (1 in both samples, equal to the cube at that point): not used
 *   11        not interpreted (0)
 *   12-37     the board after the play, 26 values: index 0 = the bar of the second player (negative), 1..24 = points seen from the
 *             first player (positive = its checkers, negative = the second player's), 25 = the bar of the first player
 *   38, 39    the dice of the NEXT roll (1;6 where the opponent then plays 16, 6;6 where he then plays 66)
 *
 * The dump holds the position AFTER the play and before the next roll: the game goes on from it. What was moved is not in it.
 */
import { emptyPosition, BAR } from './rules.js';

const LAYOUT = 40;

/** @returns {object|null} null when the text is not a dump of the layout above */
export function parseIllegalDump(inner) {
  const t = inner.split(';');
  if (t[t.length - 1].trim() === '') t.pop();
  if (t.length !== LAYOUT) return null;
  const n = t.map((x) => (/^\s*-?\d+\s*$/.test(x) ? parseInt(x, 10) : NaN));
  for (const i of [0, 1, 2, 3, 4, 7, 8, 9, ...Array.from({ length: 28 }, (_, k) => 10 + k + 2)]) if (!Number.isFinite(n[i])) return null;
  const names = [t[5].trim(), t[6].trim()];
  if (!names[0] || !names[1] || Number.isFinite(parseInt(names[0], 10)) && /^\d+$/.test(names[0])) return null;
  const board = n.slice(12, 38);
  if (board.length !== 26) return null;
  return { matchLength: n[0], names, scores: [n[8], n[9]], board, dice: [n[38], n[39]], raw: inner };
}

/**
 * The position of a dump in the model of the rules engine.
 * @param {object} dump parseIllegalDump's result
 * @param {number} positiveSide the side (0 or 1) of the match that is the first name of the dump
 * @returns {object|null} a position, or null when the board is not 15 + 15 checkers
 */
export function positionFromDump(dump, positiveSide) {
  const pos = emptyPosition();
  const P = positiveSide;
  const N = 1 - P;
  const b = dump.board;
  for (let p = 1; p <= 24; p++) {
    if (b[p] > 0) pos.c[P][p] = b[p];                  // the positive player's own point p
    if (b[p] < 0) pos.c[N][25 - p] = -b[p];            // the other player's own point 25 - p
  }
  if (b[25] > 0) pos.c[P][BAR] = b[25];
  if (b[0] < 0) pos.c[N][BAR] = -b[0];
  if (b[25] < 0 || b[0] > 0) return null;
  for (const s of [0, 1]) {
    let on = 0;
    for (let p = 1; p <= 25; p++) on += pos.c[s][p];
    if (on > 15) return null;
    pos.off[s] = 15 - on;
  }
  return pos;
}
