/**
 * The replay timeline (pure functions, no DOM): from the replay JSON of a match ("bgdb-json") to the list of steps of a game,
 * each with the position BEFORE the play, the arrows and ghost checkers that show the play, the pip counts, the cube and the score.
 *
 *   step k (0 <= k < n)  the position when action k is about to be made (a roll with its play, a double, a take or a pass)
 *   step n               the final position of the game, with the result
 *
 * Points are always in the numbering of the player who owns the checker: 24 = back point, 1 = ace point, 25 = bar, 0 = off.
 */
import { startPosition, clonePosition, applyStep, pipCount, BAR, OFF } from '../lib/core/rules.js';
import { toXGID } from '../lib/core/xgid.js';
import { toGnubgId } from '../lib/core/gnubgid.js';

const ptName = (p) => (p === BAR ? 'bar' : p === OFF ? 'off' : String(p));

/**
 * Join the single steps of a play into paths (24/21/15 is one checker making two steps).
 * A step that starts on a point is taken as the continuation of a checker that just arrived there only when the checkers that were
 * on that point before the play are all used up by other paths; otherwise it uses one of them.
 */
export function pathsOf(moves, before, side) {
  const paths = [];
  const started = {};                                    // point -> paths that start there with a checker that was already there
  for (const [from, to, hit] of moves) {
    const exhausted = (started[from] ?? 0) + 1 > before.c[side][from];
    const chain = exhausted && from !== BAR ? paths.find((p) => p.to === from) : null;
    if (chain) { chain.points.push(to); chain.to = to; chain.hits.push(hit === 1); continue; }
    started[from] = (started[from] ?? 0) + 1;
    paths.push({ from, to, points: [from, to], hits: [hit === 1] });
  }
  return paths.map((p) => ({ from: p.from, to: p.to, points: p.points, hits: p.hits, hit: p.hits.some(Boolean) }));
}

/** the text of a play: each path as 24/21/15 (a star after a point where a blot is hit), identical paths grouped: 13/7(2) */
export function playText(paths) {
  const groups = new Map();
  for (const p of paths) {
    const t = p.points.map((pt, i) => `${ptName(pt)}${i > 0 && p.hits[i - 1] ? '*' : ''}`).join('/');
    groups.set(t, (groups.get(t) ?? 0) + 1);
  }
  return [...groups].map(([t, n]) => (n > 1 ? `${t}(${n})` : t)).join(' ');
}

/** Apply a play to a copy of the position (moves are in a valid order, with hit flags). */
export function applyPlay(pos, side, moves) {
  const q = clonePosition(pos);
  for (const [from, to, hit] of moves) applyStep(q, side, from, to, hit === 1);
  return q;
}

/**
 * What to draw on top of the original position for a play: arrows (from the top checker of a stack to the slot of the new checker)
 * and ghost checkers (the new position, in transparency).
 * slot = index of a checker in its stack (0 = the one next to the board edge).
 */
export function drawPlay(pos, side, moves) {
  const paths = pathsOf(moves, pos, side).sort((a, b) => b.from - a.from || b.to - a.to);   // written like a human: bar/24 13/8, back checkers first
  const after = applyPlay(pos, side, moves);
  const opp = 1 - side;
  const taken = {};      // source point -> checkers already used as a start
  const placed = {};     // destination point -> ghosts already placed
  const arrows = paths.map((p) => {
    const k = taken[p.from] ?? 0;
    taken[p.from] = k + 1;
    const fromSlot = Math.max(0, pos.c[side][p.from] - 1 - k);
    const base = p.to === OFF ? pos.off[side] : pos.c[side][p.to];
    const n = placed[p.to] ?? 0;
    placed[p.to] = n + 1;
    return { side, from: p.from, fromSlot, to: p.to, toSlot: base + n, points: p.points, hit: p.hit, hitPoints: p.points.slice(1).filter((_, i) => p.hits[i]) };
  });
  const ghosts = arrows.map((a) => ({ side, point: a.to, slot: a.toSlot }));
  const hitGhosts = [];
  const barBefore = pos.c[opp][BAR];
  for (let i = 0; i < after.c[opp][BAR] - barBefore; i++) hitGhosts.push({ side: opp, point: BAR, slot: barBefore + i });
  const blots = arrows.flatMap((a) => a.hitPoints.map((pt) => ({ side: opp, point: 25 - pt })));   // the blots that are hit, in the opponent's numbering
  return { paths, arrows, ghosts, hitGhosts, blots, after };
}

const sideName = (replay, s) => replay.sides[s]?.name ?? `Player ${s + 1}`;

/** @returns {{steps:object[], result:object}} */
export function buildGame(replay, gi) {
  const g = replay.games[gi];
  const steps = [];
  let pos = startPosition();
  let cube = { value: 1, owner: null };
  let pending = null;
  let play = 0;
  g.actions.forEach((a, i) => {
    const step = {
      index: i, kind: a.k, side: a.s, pos: clonePosition(pos), cube: { ...cube }, offer: pending ? { ...pending } : null,
      score: g.startScore, dice: null, number: null, text: '', draw: null, illegal: a.i === 1, abandoned: a.ab === 1,
    };
    if (a.k === 'm') {
      play++;
      step.number = play;
      step.dice = a.d;
      step.draw = drawPlay(pos, a.s, a.m);
      step.text = `${a.d.join('')} ${a.m.length ? playText(step.draw.paths) : a.ab === 1 ? 'gives up' : 'cannot move'}`;
      pos = step.draw.after;
    } else if (a.k === 'd') {
      pending = { side: a.s, value: a.c };
      step.text = `Doubles to ${a.c}`;
    } else if (a.k === 't') {
      step.text = 'Takes';
      cube = { value: pending.value, owner: a.s };
      pending = null;
    } else {
      step.text = 'Passes';
      pending = null;
    }
    steps.push(step);
  });
  const r = g.result;
  steps.push({
    index: g.actions.length, kind: 'end', side: r.winner, pos: clonePosition(pos), cube: { ...cube }, offer: null, score: g.startScore,
    dice: null, number: null, draw: null, illegal: false,
    text: `${sideName(replay, r.winner)} wins ${r.points} point${r.points === 1 ? '' : 's'}${r.how === 'bearOff' && r.kind !== 'single' ? ` (${r.kind})` : r.how === 'resign' ? ' (resignation)' : r.how === 'drop' ? ' (cube dropped)' : r.how === 'declared' ? ' (result only: the plays of this game are not recorded)' : ''}`,
  });
  return { index: g.index, steps, crawford: g.crawford, startScore: g.startScore, result: r };
}

/** who acts in a step (for the turn marker): the roller, the doubler, or the player who answers a double */
export const actor = (step) => (step.kind === 'end' ? null : step.side);

export const pips = (step) => [pipCount(step.pos, 0), pipCount(step.pos, 1)];

/**
 * Position identifiers of a step (the position BEFORE the play, with the dice when it is a roll).
 * Not available for the answer to a double (take / pass): the ID formats mark a pending double in a way this project has not verified yet.
 * @returns {{xgid:string, gnubgid:string}|null}
 */
export function positionIds(replay, game, step) {
  if (step.kind === 't' || step.kind === 'p') return null;
  const onRoll = step.side;
  const ctx = {
    onRoll,
    cube: step.cube.value, cubeOwner: step.cube.owner,
    dice: step.kind === 'm' ? step.dice : null,
    score: step.score, matchLength: replay.matchLength,
    crawford: !!game.crawford, jacoby: replay.rules?.jacoby === true,
  };
  if (step.kind === 'end') return null;
  return { xgid: toXGID(step.pos, ctx), gnubgid: toGnubgId(step.pos, ctx) };
}
