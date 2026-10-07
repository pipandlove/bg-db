/**
 * Parser for GNU Backgammon SGF (GM[6]) files as exported by gnubg and sites such as backgammonhub.
 * One game per top-level branch. B = side 0, W = side 1.
 * Move encoding: dice digits, then pairs of letters (from,to). Letter index i = 0..23 for 'a'..'x',
 * 'y' = bar, 'z' = off. Coordinates are absolute: for B own point = 24 - i, for W own point = i + 1.
 */
import { BgdbError } from './errors.js';
import { BAR, OFF } from './rules.js';

export function parseSgf(text) {
  const src = text.replace(/^\uFEFF/, '');
  let pos = 0;
  const trees = [];
  const err = (msg) => new BgdbError('V-FORMAT', msg, { hint: 'Is this a GNU Backgammon SGF file (GM[6])?' });

  const skipWs = () => { while (pos < src.length && /\s/.test(src[pos])) pos++; };

  const readValue = () => {
    pos++; // [
    let v = '';
    while (pos < src.length && src[pos] !== ']') {
      if (src[pos] === '\\') pos++;
      v += src[pos++];
    }
    pos++; // ]
    return v;
  };

  const readNode = () => {
    pos++; // ;
    const props = {};
    for (;;) {
      skipWs();
      const id = src.slice(pos).match(/^[A-Z]+/);
      if (!id) break;
      pos += id[0].length;
      const vals = [];
      skipWs();
      while (src[pos] === '[') { vals.push(readValue()); skipWs(); }
      props[id[0]] = (props[id[0]] ?? []).concat(vals);
    }
    return props;
  };

  for (;;) {
    skipWs();
    if (pos >= src.length) break;
    if (src[pos] !== '(') throw err(`Unexpected character "${src[pos]}"`);
    pos++;
    const nodes = [];
    for (;;) {
      skipWs();
      if (src[pos] === ';') nodes.push(readNode());
      else if (src[pos] === ')') { pos++; break; }
      else throw err('Unexpected content inside a game');
    }
    trees.push(nodes);
  }
  if (trees.length === 0) throw err('No game found');

  const first = trees[0][0];
  if (!first.GM || first.GM[0] !== '6') throw err('Not a backgammon SGF (GM[6] missing)');
  const info = (props) => {
    const mi = props.MI ?? [];
    const o = {};
    for (const v of mi) { const [k, x] = v.split(':'); o[k] = x; }
    return o;
  };
  const mi0 = info(first);

  const games = trees.map((nodes, gi) => {
    const root = nodes[0];
    const mi = info(root);
    const game = {
      index: gi + 1,
      startScore: [parseInt(mi.bs ?? '0', 10), parseInt(mi.ws ?? '0', 10)],
      crawford: /CrawfordGame/.test((root.RU ?? [''])[0]),
      actions: [],
      declared: null,
    };
    nodes.slice(1).forEach((n, ni) => {
      const key = n.B ? 'B' : n.W ? 'W' : null;
      if (!key) return;
      const side = key === 'B' ? 0 : 1;
      const v = n[key][0];
      const line = ni + 2;
      if (v === 'double') game.actions.push({ side, kind: 'double', cube: null, line });
      else if (v === 'take') game.actions.push({ side, kind: 'take', line });
      else if (v === 'drop') game.actions.push({ side, kind: 'drop', line });
      else {
        const m = v.match(/^([1-6])([1-6])((?:[a-z]{2})*)$/);
        if (!m) throw new BgdbError('V-FORMAT', `Cannot understand the node "${key}[${v}]"`, { game: gi + 1, action: ni + 1 });
        const moves = [];
        for (let k = 0; k < m[3].length; k += 2) {
          moves.push({ from: letter(m[3][k], side), to: letter(m[3][k + 1], side) });
        }
        game.actions.push({ side, kind: 'move', dice: [+m[1], +m[2]], moves, line });
      }
    });
    const re = (root.RE ?? [''])[0].match(/^([BW])\+(\d+)(R?)$/);
    if (re) game.declared = { winner: re[1] === 'B' ? 0 : 1, points: +re[2], resign: re[3] === 'R' };
    return game;
  });

  const first0 = trees[0][0];
  const date = (first0.DT ?? [null])[0];
  const analysed = trees.some((nodes) => nodes.some((n) => n.A || n.DA));   // gnubg stores its analysis in A[...] and DA[...]
  return {
    schema: '1.0',
    sides: [{ name: (first0.PB ?? [null])[0] }, { name: (first0.PW ?? [null])[0] }],
    matchLength: parseInt(mi0.length ?? '0', 10),
    rules: { crawford: /Crawford/.test((first0.RU ?? [''])[0]), jacoby: null, beaver: null, cubeLimit: null },
    date,
    time: null,
    event: (first0.EV ?? [null])[0],
    round: null,
    games,
    links: [],
    provenance: {
      originalFormat: 'sgf', dialect: 'gnubg-sgf', site: (first0.PC ?? [null])[0], siteMatchId: null,
      analysis: { present: analysed, engine: (first0.AP ?? [null])[0] },
    },
  };
}

function letter(ch, side) {
  if (ch === 'y') return BAR;
  if (ch === 'z') return OFF;
  const i = ch.charCodeAt(0) - 97;
  return side === 0 ? 24 - i : i + 1;
}
