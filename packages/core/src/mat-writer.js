/**
 * Writer for the normalised BGDB ".mat" profile (spec ST-03, profile "mat+meta").
 * The output is a plain Jellyfish-style text that the project's own parser (and, by design, other
 * tools) can read: "bar"/"off", "(n)" repeat counts, one row per pair of cells, the right cell aligned
 * at a fixed column that adapts to the longest left cell.
 * Writing then reading a validated match gives the same match identity and results (tested on all fixtures).
 */
import { BAR, OFF } from './rules.js';

const pt = (n) => (n === BAR ? 'bar' : n === OFF ? 'off' : String(n));

export function formatMoves(moves) {
  const groups = new Map();
  for (const m of moves) {
    const key = `${m.from}/${m.to}/${m.hit ? 1 : 0}`;
    const g = groups.get(key);
    if (g) g.n++;
    else groups.set(key, { m, n: 1 });
  }
  return [...groups.values()]
    .map(({ m, n }) => `${pt(m.from)}/${pt(m.to)}${m.hit ? '*' : ''}${n > 1 ? `(${n})` : ''}`)
    .join(' ');
}

function cellText(a) {
  if (a.kind === 'double') return `Doubles => ${a.cube}`;
  if (a.kind === 'take') return 'Takes';
  if (a.kind === 'drop') return 'Drops';
  const body = a.moves.length ? formatMoves(a.moves) : 'Cannot Move';
  return `${a.dice.join('')}: ${body}`;
}

/** Lay the events of a game out in rows of (left, right) cells, preserving reading order. */
function layout(actions) {
  const rows = [];
  let row = null;
  for (const a of actions) {
    if (a.hidden) continue; // the hidden play of a resignation is written as a resignation marker instead
    const text = cellText(a);
    if (a.side === 0) {
      if (!row || row.L !== undefined || row.R !== undefined) rows.push((row = {}));
      row.L = text;
      row.la = a;
    } else {
      if (!row || row.R !== undefined) rows.push((row = {}));
      row.R = text;
      row.ra = a;
    }
  }
  return rows;
}

const tag = (k, v) => `; [${k} "${v}"]`;
const onOff = (b) => (b ? 'On' : 'Off');

/** @param {object} match a validated match (positions/hit flags filled in by validateMatch) */
export function writeMat(match) {
  const L = [];
  const layouts = match.games.map((g) => layout(g.actions));
  const [n0, n1] = [match.sides[0].name ?? 'Player 1', match.sides[1].name ?? 'Player 2'];
  L.push(tag('Site', 'bgdb'));
  L.push(tag('Player 1', n0), tag('Player 2', n1));
  if (match.date) L.push(tag('EventDate', match.date.replace(/-/g, '.')));
  if (match.time) L.push(tag('EventTime', match.time.replace(':', '.')));
  if (match.event) L.push(tag('Event', match.event));
  if (match.round) L.push(tag('Round', match.round));
  L.push(tag('Variation', 'Backgammon'));
  for (const link of match.links ?? []) L.push(tag('Video', link.url));
  for (const r of match.remarks ?? []) L.push(tag('Remark', r.replace(/[\r\n]+/g, ' ')));
  // games keep their number in the source: an excerpt numbered 1, 2, 6 says that games 3 to 5 are missing, and its gaps (result.partial)
  // name the games by these numbers, so the file must read back with them
  const num = (gi) => match.games[gi].index ?? gi + 1;
  // plays that were made although illegal: written with the row numbers of THIS file, so that it reads back identically
  layouts.forEach((rows, gi) => rows.forEach((r, ri) => {
    for (const [a, side] of [[r.la, 0], [r.ra, 1]]) {
      if (a?.illegal) L.push(tag('IllegalPlay', `Game ${num(gi)}, Move ${ri + 1} of ${match.sides[side].name ?? `Player ${side + 1}`}`));
    }
  }));
  // games kept by their result only (their plays are lost): declared, so that the empty game reads back and is not taken for a cut file
  match.games.forEach((g, gi) => { if (g.resultOnly) L.push(tag('ResultOnly', `Game ${num(gi)}`)); });
  L.push(tag('Crawford', onOff(match.rules.crawford !== false)));
  if (match.rules.jacoby !== null && match.rules.jacoby !== undefined) L.push(tag('Jacoby', onOff(match.rules.jacoby)));
  if (match.rules.beaver !== null && match.rules.beaver !== undefined) L.push(tag('Beaver', onOff(match.rules.beaver)));
  if (match.rules.cubeLimit) L.push(tag('CubeLimit', match.rules.cubeLimit));
  L.push('', `${match.matchLength} point match`, '');

  match.games.forEach((g, gi) => {
    const rows = layouts[gi];
    const prefixLen = (n) => `${String(n).padStart(3)}) `.length;
    let rightIdx = 40;
    rows.forEach((r, i) => { if (r.L !== undefined) rightIdx = Math.max(rightIdx, prefixLen(i + 1) + r.L.length + 3); });
    const leftScore = ` ${n0} : ${g.startScore[0]}`;
    rightIdx = Math.max(rightIdx, leftScore.length + 3);

    L.push(` Game ${num(gi)}`);
    L.push(`${leftScore}`.padEnd(rightIdx) + `${n1} : ${g.startScore[1]}`);
    rows.forEach((r, i) => {
      const prefix = `${String(i + 1).padStart(3)}) `;
      let line = prefix + (r.L ?? '');
      if (r.R !== undefined) line = line.padEnd(rightIdx) + r.R;
      L.push(line.replace(/\s+$/, ''));
    });
    const res = g.result;
    if (res) {
      const col = res.winner === 0 ? 5 : rightIdx;
      if (res.how === 'resign') L.push(' '.repeat(col) + 'Resigned Game');
      const last = gi === match.games.length - 1 && match.result?.finished && match.matchLength > 0;
      L.push(' '.repeat(col) + `Wins ${res.points} point${res.points === 1 ? '' : 's'}${last ? ' and the match' : ''}`);
    }
    L.push('');
  });
  return L.join('\n') + '\n';
}
