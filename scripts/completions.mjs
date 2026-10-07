#!/usr/bin/env node
/**
 * How many histories fit a match that has plays missing?
 *
 *   node scripts/completions.mjs <match.txt|.mat>
 *
 * For every game: each roll written with no play although a play was possible is tried with every legal play, and only the histories in which every
 * play that IS written stays legal are kept. The number of such histories says whether the match can be rebuilt: 1 means the missing plays are
 * forced by the rest of the game, anything else means that the match has no single identity (docs/decisions/0020). The search stops at 200 000 nodes.
 */
import fs from 'node:fs';
import { parseMat } from '../packages/core/src/mat.js';
import { startPosition, legalPlays, applyNotated, positionKey } from '../packages/core/src/rules.js';

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/completions.mjs <match.txt|.mat>'); process.exit(2); }
const CAP = 200000;
const m = parseMat(fs.readFileSync(file, 'utf8'));
let total = 1n;
let exact = true;
let none = false;

m.games.forEach((g, gi) => {
  const acts = g.actions.filter((a) => a.kind === 'move' && !a.hidden);
  let nodes = 0;
  let histories = 0;
  let capped = false;
  let missing = 0;
  const ends = new Set();
  const rec = (i, pos) => {
    if (capped) return;
    if (++nodes > CAP) { capped = true; return; }
    if (i === acts.length) { histories++; ends.add(positionKey(pos)); return; }
    const a = acts[i];
    const { plays, used } = legalPlays(pos, a.side, a.dice[0], a.dice[1]);
    if (a.moves.length === 0) {
      if (used === 0) return rec(i + 1, pos);                              // a dance
      if (i === acts.length - 1 && g.declared) return rec(i + 1, pos);    // a blank last roll in a settled game: a tail (docs/game-endings.md)
      const seen = new Set();
      for (const v of plays.values()) {
        const k = positionKey(v.pos);
        if (seen.has(k)) continue;
        seen.add(k);
        rec(i + 1, v.pos);
        if (capped) return;
      }
      return;
    }
    const ap = applyNotated(pos, a.side, a.moves);
    if (!ap || !plays.has(positionKey(ap.pos))) {
      // the last roll of a game that a Wins line settles may be partial or garbled (docs/game-endings.md): it is a tail, not a contradiction
      if (i === acts.length - 1 && g.declared) return rec(i + 1, pos);
      return;                                                              // a written play that is not legal here: this history is wrong
    }
    rec(i + 1, ap.pos);
  };
  rec(0, startPosition());
  for (const a of acts) if (a.moves.length === 0) missing++;
  console.log(`game ${String(gi + 1).padStart(2)}: ${String(acts.length).padStart(3)} rolls, ${capped ? `more than ${CAP} nodes (stopped)` : `${histories} history(ies) fit, ${ends.size} different end position(s)`}`);
  if (capped) exact = false;
  else if (histories === 0) none = true;
  else total *= BigInt(histories);
});
if (none) { console.log('\nno history fits one of the games: the plays that are written contradict each other, this is not only a matter of missing plays'); process.exit(1); }
console.log(`\nhistories of the whole match (product over the games): ${exact ? total : `at least ${total}`}${exact && total === 1n ? '  -> one: the match can be rebuilt' : ''}`);
