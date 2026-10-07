/**
 * Two transcriptions of one match (decision 0023): files whose rolls agree almost everywhere, between the same two players and for the
 * same length, are one match written twice, with typos, another layout, or games lost in one of them. The better file is kept:
 *
 *   rank 3  valid as it is
 *   rank 2  valid only by salvage (some games kept by their result, decision 0021)
 *   rank 1  refused
 *
 * A strictly better rank decides; two files of the same rank are left to a person (both valid but different: which one is right is not
 * known). What is compared is the sequence of rolls and cube actions, game by game: it can be read even from a file that fails, and it does
 * not depend on the notation of the plays. Plays are compared by the identity, not here.
 */
import { normalizeName } from './names.js';

export const SAME_MATCH_RATIO = 0.95;

/**
 * The rolls of a match, as tokens per game ("m0:53" = player 0 rolls 5-3; "d1" = player 1 doubles; "t0", "p0" = takes, drops).
 * Players are numbered by their normalised names in alphabetical order, so the order of the columns does not matter.
 * @param {object} match a parsed match (validated or not)
 * @returns {{key:string|null, players:string[], games:{tokens:string[], rows:(number|null)[]}[]}} key: the players and the length (null
 *   without two distinct names); players: the names as written, in the order of the numbers of the tokens
 */
export function rollTokens(match) {
  const names = match.sides.map((s) => normalizeName(s.name));
  const sorted = [...names].sort();
  const key = names[0] && names[1] && names[0] !== names[1] ? `${sorted.join(' / ')} | ${match.matchLength}` : null;
  const p = (side) => sorted.indexOf(names[side]);
  const games = match.games.map((g) => {
    const tokens = [];
    const rows = [];
    for (const a of g.actions ?? []) {
      if (a.kind === 'move') tokens.push(`m${p(a.side)}:${a.unrolled ? '?' : [...a.dice].sort((x, y) => y - x).join('')}`);
      else tokens.push(`${a.kind === 'double' ? 'd' : a.kind === 'take' ? 't' : 'p'}${p(a.side)}`);
      rows.push(a.row ?? null);
    }
    return { tokens, rows };
  });
  const players = sorted.map((n) => match.sides[names.indexOf(n)]?.name ?? n);
  return { key, players, games };
}

/** length of the longest common subsequence of two token lists */
function lcs(a, b) {
  if (!a.length || !b.length) return 0;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length];
}

const describe = (t, players = []) => {
  if (!t) return 'nothing';
  const who = players[+t[1]] ?? `player ${+t[1] + 1}`;
  if (t[0] === 'm') return t.endsWith('?') ? `a hidden roll of ${who}` : `${who} rolls ${t.slice(3)}`;
  return `${who} ${{ d: 'doubles', t: 'takes', p: 'drops' }[t[0]]}`;
};

/**
 * How much two matches have in common: the share of their rolls and cube actions that agree, game by game, and the first place they differ.
 * @returns {{ratio:number, common:number, total:number, diff:{game:number, row:number|null, here:string, there:string}|null}}
 */
export function compareRolls(ta, tb) {
  let common = 0;
  let total = 0;
  let diff = null;
  const n = Math.max(ta.games.length, tb.games.length);
  for (let g = 0; g < n; g++) {
    const a = ta.games[g] ?? { tokens: [], rows: [] };
    const b = tb.games[g] ?? { tokens: [], rows: [] };
    common += lcs(a.tokens, b.tokens);
    total += Math.max(a.tokens.length, b.tokens.length);
    if (!diff) {
      const i = a.tokens.findIndex((t, k) => t !== b.tokens[k]);
      const at = i >= 0 ? i : a.tokens.length < b.tokens.length ? a.tokens.length : -1;
      if (at >= 0) diff = { game: g + 1, row: a.rows[at] ?? b.rows[at] ?? null, here: describe(a.tokens[at], ta.players), there: describe(b.tokens[at], tb.players) };
    }
  }
  return { ratio: total ? common / total : 1, common, total, diff };
}

/** "game 1, row 18: Ballard rolls 53 here, Ballard rolls 51 in the other" */
export function diffText(diff) {
  if (!diff) return 'the same rolls; the plays differ';
  return `game ${diff.game}${diff.row ? `, row ${diff.row}` : ''}: ${diff.here} here, ${diff.there} in the other`;
}

/**
 * Groups of entries that are one match: same players and length, rolls in common at least `ratio`.
 * @param {{id:string, tokens:{key:string|null, games:object[]}}[]} entries
 * @returns {{members:string[], pairs:{a:string, b:string, ratio:number, diff:object|null}[]}[]} clusters of two or more ids
 */
export function sameMatchClusters(entries, ratio = SAME_MATCH_RATIO) {
  const byKey = new Map();
  for (const e of entries) if (e.tokens.key) (byKey.get(e.tokens.key) ?? byKey.set(e.tokens.key, []).get(e.tokens.key)).push(e);
  const parent = new Map(entries.map((e) => [e.id, e.id]));
  const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; };
  const pairs = [];
  for (const list of byKey.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const c = compareRolls(list[i].tokens, list[j].tokens);
        if (c.ratio < ratio) continue;
        pairs.push({ a: list[i].id, b: list[j].id, ratio: c.ratio, diff: c.diff, back: compareRolls(list[j].tokens, list[i].tokens).diff });
        parent.set(find(list[i].id), find(list[j].id));
      }
    }
  }
  const clusters = new Map();
  for (const p of pairs) {
    const root = find(p.a);
    const c = clusters.get(root) ?? clusters.set(root, { members: new Set(), pairs: [] }).get(root);
    c.members.add(p.a); c.members.add(p.b); c.pairs.push(p);
  }
  return [...clusters.values()].map((c) => ({ members: [...c.members], pairs: c.pairs }));
}

/**
 * The member to keep: the only one with the best rank, else null (left to a person).
 * @param {{id:string, rank:number}[]} members
 */
export function keeperOf(members) {
  const best = Math.max(...members.map((m) => m.rank));
  const top = members.filter((m) => m.rank === best);
  return top.length === 1 && best > 1 ? top[0].id : null;
}

export const RANK_TEXT = { 3: 'valid', 2: 'valid only by salvage (games kept by their result)', 1: 'refused' };
