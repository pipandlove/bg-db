/**
 * Backgammon rules engine (position model, legal plays).
 *
 * Position model: every side is described from ITS OWN perspective.
 *   pos.c[s][p]  checkers of side s on its own point p (1..24); p = 25 is the bar; index 0 unused
 *   pos.off[s]   checkers borne off by side s
 * Side s moves from point 24 down to point 1, then off. Own point p is the
 * opponent's point 25-p.
 */
export const BAR = 25;
export const OFF = 0;

export const opp = (s) => 1 - s;

export function emptyPosition() {
  return { c: [new Array(26).fill(0), new Array(26).fill(0)], off: [0, 0] };
}

export function startPosition() {
  const pos = emptyPosition();
  for (const s of [0, 1]) {
    pos.c[s][24] = 2;
    pos.c[s][13] = 5;
    pos.c[s][8] = 3;
    pos.c[s][6] = 5;
  }
  return pos;
}

export function clonePosition(pos) {
  return { c: [pos.c[0].slice(), pos.c[1].slice()], off: pos.off.slice() };
}

/** Compact deterministic string for a position (side 0 then side 1). */
export function positionKey(pos) {
  return `${pos.c[0].slice(1).join('.')}|${pos.c[1].slice(1).join('.')}|${pos.off[0]}.${pos.off[1]}`;
}

/** Pip count of side s (bar = 25 pips per checker). */
export function pipCount(pos, s) {
  let n = 0;
  for (let p = 1; p <= 25; p++) n += p * pos.c[s][p];
  return n;
}

/** Sanity check: 15 checkers per side, no negative counts. Returns an error string or null. */
export function checkPosition(pos) {
  for (const s of [0, 1]) {
    let n = pos.off[s];
    for (let p = 1; p <= 25; p++) {
      if (pos.c[s][p] < 0) return `negative checker count (side ${s}, point ${p})`;
      n += pos.c[s][p];
    }
    if (n !== 15) return `side ${s} has ${n} checkers instead of 15`;
  }
  for (let p = 1; p <= 24; p++) {
    if (pos.c[0][p] > 0 && pos.c[1][25 - p] > 0) return `both sides on the same point (${p})`;
  }
  return null;
}

/**
 * Try to move one checker of side s from `from` by die d.
 * @returns {{to:number, hit:boolean}|null}
 */
export function step(pos, s, from, d) {
  const me = pos.c[s];
  const op = pos.c[1 - s];
  if (me[from] <= 0) return null;
  if (me[BAR] > 0 && from !== BAR) return null;
  const to = from - d;
  if (to <= 0) {
    for (let p = 7; p <= BAR; p++) if (me[p] > 0) return null; // not all home
    if (to < 0) for (let p = from + 1; p <= 6; p++) if (me[p] > 0) return null; // higher checker exists
    return { to: OFF, hit: false };
  }
  const o = op[25 - to];
  if (o >= 2) return null; // blocked
  return { to, hit: o === 1 };
}

/** Apply a single checker move (no legality check). Mutates pos. */
export function applyStep(pos, s, from, to, hit) {
  pos.c[s][from]--;
  if (to === OFF) pos.off[s]++;
  else pos.c[s][to]++;
  if (hit) {
    pos.c[1 - s][25 - to]--;
    pos.c[1 - s][BAR]++;
  }
}

/**
 * All legal final positions for side s with dice d1,d2 (rules: use as many dice as
 * possible; if only one die can be played it must be the larger one when possible).
 * @returns {{plays: Map<string,{pos:object, used:number}>, used:number}}
 *   used = number of dice that must be played; plays.size===1 && used===0 means "cannot move".
 */
export function legalPlays(pos, s, d1, d2) {
  const seqs = d1 === d2 ? [[d1, d1, d1, d1]] : [[d1, d2], [d2, d1]];
  const leaves = new Map(); // key -> {pos, used, first}
  let maxUsed = 0;

  for (const seq of seqs) {
    const seen = new Set();
    const dfs = (p, i, firstDie) => {
      const memo = positionKey(p) + '#' + i;
      if (seen.has(memo)) return;
      seen.add(memo);
      let any = false;
      if (i < seq.length) {
        const d = seq[i];
        const froms = p.c[s][BAR] > 0 ? [BAR] : [...Array(24).keys()].map((k) => k + 1);
        for (const from of froms) {
          const m = step(p, s, from, d);
          if (!m) continue;
          any = true;
          const q = clonePosition(p);
          applyStep(q, s, from, m.to, m.hit);
          dfs(q, i + 1, i === 0 ? d : firstDie);
        }
      }
      if (!any) {
        const k = positionKey(p);
        const prev = leaves.get(k);
        if (!prev || prev.used < i) leaves.set(k, { pos: p, used: i, first: firstDie });
        else if (prev.used === i && prev.first !== firstDie) prev.firstBoth = true;
        if (i > maxUsed) maxUsed = i;
      }
    };
    dfs(pos, 0, null);
  }

  const plays = new Map();
  for (const [k, v] of leaves) if (v.used === maxUsed) plays.set(k, v);

  if (maxUsed === 1 && d1 !== d2) {
    const big = Math.max(d1, d2);
    const withBig = new Map();
    for (const [k, v] of plays) if (v.first === big || v.firstBoth) withBig.set(k, v);
    if (withBig.size > 0) return { plays: withBig, used: 1 };
  }
  return { plays, used: maxUsed };
}

/**
 * Is the notated list of sub-moves an unfinished play: a proper prefix of at least one legal play for this roll?
 * (A player who rolls and then gives up moves some of the dice, or none: the sites write what was moved.)
 * A complete play, or a list that cannot be played in any order with these dice, is not unfinished.
 * @param {{from:number,to:number}[]} subMoves
 */
export function isPartialPlay(pos, s, d1, d2, subMoves) {
  const { used: maxUsed } = legalPlays(pos, s, d1, d2);
  if (subMoves.length >= maxUsed) return false;
  const seqs = d1 === d2 ? [[d1, d1, d1, d1]] : [[d1, d2], [d2, d1]];
  const froms = (p) => (p.c[s][BAR] > 0 ? [BAR] : [...Array(24).keys()].map((k) => k + 1));
  for (const seq of seqs) {
    // can the position be played on, with the dice that are left, until the whole legal play (maxUsed dice) is reached?
    const extend = (p, i) => {
      if (i >= maxUsed) return true;
      for (const from of froms(p)) {
        const m = step(p, s, from, seq[i]);
        if (!m) continue;
        const q = clonePosition(p);
        applyStep(q, s, from, m.to, m.hit);
        if (extend(q, i + 1)) return true;
      }
      return false;
    };
    // play the notated steps in this order of dice (any order of the steps), then extend
    const rec = (p, i, rest) => {
      if (rest.length === 0) return extend(p, i);
      for (let k = 0; k < rest.length; k++) {
        const m = step(p, s, rest[k].from, seq[i]);
        if (!m || m.to !== rest[k].to) continue;
        const q = clonePosition(p);
        applyStep(q, s, rest[k].from, m.to, m.hit);
        if (rec(q, i + 1, rest.filter((_, j) => j !== k))) return true;
      }
      return false;
    };
    if (rec(pos, 0, subMoves)) return true;
  }
  return false;
}

/**
 * Apply a notated list of sub-moves [{from,to}] to a clone of pos, in any order that works.
 * Hits are detected automatically. Returns {pos, moves} (moves = ordered sub-moves with hit flags)
 * or null if the notation cannot be applied.
 */
export function applyNotated(pos, s, subMoves) {
  const n = subMoves.length;
  const used = new Array(n).fill(false);
  const order = [];
  const rec = (p) => {
    if (order.length === n) return p;
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      const { from, to } = subMoves[i];
      if (p.c[s][from] <= 0) continue;
      if (to !== OFF) {
        const o = p.c[1 - s][25 - to];
        if (o >= 2 || to > 24) continue;
      }
      const hit = to !== OFF && p.c[1 - s][25 - to] === 1;
      const q = clonePosition(p);
      applyStep(q, s, from, to, hit);
      used[i] = true;
      order.push({ from, to, hit });
      const r = rec(q);
      if (r) return r;
      used[i] = false;
      order.pop();
    }
    return null;
  };
  const result = rec(pos);
  return result ? { pos: result, moves: order.slice() } : null;
}

/** Winner multiplier: 1 single, 2 gammon, 3 backgammon, given the final position and winner. */
export function winKind(pos, winner) {
  const loser = 1 - winner;
  if (pos.off[loser] > 0) return { kind: 'single', mult: 1 };
  let bg = pos.c[loser][BAR] > 0;
  for (let p = 19; p <= 24; p++) if (pos.c[loser][p] > 0) bg = true; // winner's home board
  return bg ? { kind: 'backgammon', mult: 3 } : { kind: 'gammon', mult: 2 };
}

/**
 * The points (as seen by the player who moved) where a play hit a blot: the opponent's checkers that left a point and went to the bar.
 * @returns {number[]|null} null when the change of the opponent is not made of hits (a checker lost, a point that gained one...)
 */
export function hitsBetween(before, after, mover) {
  const o = opp(mover);
  const hits = [];
  let lost = 0;
  for (let q = 1; q <= 24; q++) {
    const d = before.c[o][q] - after.c[o][q];
    if (d < 0) return null;
    if (d > 1) return null;                                   // only a blot can be hit
    if (d === 1) { if (before.c[o][q] !== 1) return null; hits.push(25 - q); lost++; }
  }
  if (after.c[o][BAR] - before.c[o][BAR] !== lost) return null;
  if (after.off[o] !== before.off[o]) return null;
  return hits;
}

/**
 * A notation that carries `before` to `after` for the player `s` using forward steps only (the way the plays are written: from, to, with
 * 25 = bar and 0 = off), or null if the checkers of `after` cannot all have come from `before` moving forward. The notation reaches the same position
 * but is not necessarily what was played (a play and another play can reach the same position). `hits` are the points where the opponent was hit:
 * the notation passes through them so that the hit is made when it is applied.
 */
export function movesBetween(before, after, s, hits = []) {
  const count = (pos, p) => (p === OFF ? pos.off[s] : pos.c[s][p]);
  const sources = [];
  const targets = [];
  for (let p = 0; p <= BAR; p++) {
    const d = count(before, p) - count(after, p);
    for (let k = 0; k < d; k++) sources.push(p);
    for (let k = 0; k < -d; k++) targets.push(p);
  }
  if (sources.length !== targets.length) return null;
  sources.sort((a, b) => b - a);
  targets.sort((a, b) => b - a);
  const moves = [];
  for (let i = 0; i < sources.length; i++) {
    if (sources[i] <= targets[i]) return null;
    moves.push({ from: sources[i], to: targets[i] });
  }
  for (const h of hits) {
    if (moves.some((m) => m.to === h)) continue;               // a checker lands there anyway
    const k = moves.findIndex((m) => m.from > h && m.to < h);
    if (k < 0) return null;
    const m = moves[k];
    moves.splice(k, 1, { from: m.from, to: h }, { from: h, to: m.to });
  }
  return moves;
}
