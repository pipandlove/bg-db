/**
 * Match identity (spec ID-01..ID-03). See docs/decisions/0003-canonical-match-hash.md.
 *
 * Canonical content = match length + for each game: the start score, then each action as
 *   move   : side, sorted dice, resulting position
 *   double : side, new cube value
 *   take / drop : side
 * Sides are relabelled A/B: A = the player who rolled first in game 1 (so swapping the order of the
 * two players in a source file does not change the identity). Names, dates, events, notation style
 * (order of sub-moves, "bar" vs 25, repeat counts), analysis and comments are NOT part of it. A hidden
 * play ("????", a resignation) is not part of the content either, like a resignation; a game whose plays are lost (kept by its result only) contributes
 * its result; nor is the last roll of a game that stopped in the middle of the turn (a
 * resignation after a partial play: what the sites write there is not reliable).
 */
import { sha256Hex } from './sha256.js';
import { positionKey } from './rules.js';

export const CANONICAL_VERSION = 1;

export function canonicalContent(match) {
  const firstGame = match.games[0];
  const firstAction = firstGame.actions.find((a) => a.kind === 'move' && !a.hidden && !a.abandoned);
  const A = firstAction ? firstAction.side : 0; // side relabelled as "A"
  const lab = (s) => (s === A ? 0 : 1);
  const ordered = (arr) => (A === 0 ? arr : [arr[1], arr[0]]);
  const posStr = (pos) => positionKey({ c: ordered(pos.c), off: ordered(pos.off) });

  return [
    CANONICAL_VERSION,
    match.matchLength,
    match.games.map((g) => [
      ordered(g.startScore),
      ...(g.resultOnly ? [['s', lab(g.result.winner), g.result.points]] : []),             // no plays: the result is all there is
      g.actions.filter((a) => !a.hidden && !a.abandoned).map((a) => {
        if (a.kind === 'move') return ['m', lab(a.side), a.dice.slice().sort((x, y) => y - x).join(''), posStr(a.pos)];
        if (a.kind === 'double') return ['d', lab(a.side), a.cube];
        return [a.kind === 'take' ? 't' : 'p', lab(a.side)];
      }),
    ]),
  ];
}

/** Full SHA-256 hex digest of the canonical content. Requires a validated match (positions filled in). */
export function contentHash(match) {
  return sha256Hex(JSON.stringify(canonicalContent(match)));
}

/** Short identifier part (first 16 hex chars, spec ID-01). The shard prefix is added at ingestion. */
export function matchHash16(match) {
  return contentHash(match).slice(0, 16);
}
