/**
 * Parser for Jellyfish-style ".mat" match text, covering the dialects found in the wild:
 *   - "opengammon"        bar = 25, off = 0, one entry per checker, "Drops", "Wins 1 points"
 *   - "foxamon"           same notation as opengammon, narrower columns
 *   - "backgammon-studio" "bar"/"off", "(n)" repeat counts, "Cannot Move", extra header tags
 *   - "xg-text"           eXtreme Gammon text export: "Bar/20", "(n)", money games ("0 point match"),
 *                         Jacoby/Beaver tags, Elo tags, Player 2 listed in the left column
 * The parser only reads the text and builds the logical model. Legality and score
 * checks are done by validate.js.
 *
 * Column logic: a row is "  N) <left cell>   <right cell>". Left cell = side 0 (Player 1),
 * right cell = side 1 (Player 2). A cell is assigned to a side by its horizontal position
 * relative to the right player's name in the game header line.
 */
import { BgdbError } from './errors.js';
import { parseIllegalDump } from './illegal-dump.js';
import { BAR, OFF } from './rules.js';

const META_RE = /^;\s*\[([A-Za-z][A-Za-z0-9 ]*?)\s+"(.*)"\]\s*$/;

const CELL_START = /(?<=^|\s)(?:[0-6]{2}:|Doubles\b|Takes?\b|Drops?\b|Passes?\b|Wins\b|Loss(?:es)?\b|Resign(?:ed)?\b)/g;
const cellStarts = (rest) => [...rest.matchAll(CELL_START)].map((x) => x.index);

/**
 * The column where the right cell starts in the game rows: the most common start of the second cell of the rows that have two.
 * The score line gives this column too, but some exports (XG text with long names) pad it wider than the rows, so that a row whose
 * left cell is empty (the first roll belongs to the right player) would be read as the left player's. null when no row has two cells.
 */
function rightColumnOfRows(lines) {
  const count = new Map();
  for (const raw of lines) {
    const row = raw.match(/^(\s*\d+\))(.*)$/);
    if (!row) continue;
    const st = cellStarts(row[2].replace(/Illegal play\s*\([^)]*\)/gi, (x) => 'x'.repeat(x.length)));
    if (st.length !== 2 || st[1] - st[0] < 12) continue;
    const col = row[1].length + st[1];
    count.set(col, (count.get(col) ?? 0) + 1);
  }
  let best = null;
  for (const [col, n] of count) if (best === null || n > count.get(best) || (n === count.get(best) && col < best)) best = col;
  return best;
}

/**
 * Tabs to spaces, with a stop every 8 columns, as an editor shows them: the column of a play tells which player made it, and some
 * transcribers aligned the right column with a tab ("11/7 8/7<TAB>   42: 13/9").
 */
export function expandTabs(line) {
  if (!line.includes('\t')) return line;
  let out = '';
  for (const ch of line) out += ch === '\t' ? ' '.repeat(8 - (out.length % 8)) : ch;
  return out;
}

/** @param {string} text @returns {object} match (logical model, not yet validated) */
export function parseMat(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(expandTabs);
  const meta = {};
  const videos = [];                               // repeatable tag: ; [Video "https://youtu.be/..."]
  const remarks = [];                              // the transcriber's remarks: a box of "; | ... |" lines, or ; [Remark "..."] tags
  const illegalDeclared = [];                      // plays the source says were illegal but were made: {game, row, player}
  const resultOnlyDeclared = [];                   // games recorded by their result only (their plays are lost), numbered as in the file: [13]
  let matchLength = null;
  const games = [];
  let game = null;
  let rightIdx = null; // column of the right player's name in the header line
  let expectScoreLine = false;
  let names = [null, null];
  const rowRight = rightColumnOfRows(lines);
  let pendingSetPos = null;                            // a "; Set Pos=" line: attached to the next action          // where the right cell starts in the rows; some exports pad the score line wider than the rows

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;
    if (raw.trim() === '') continue;

    let m = raw.match(META_RE);
    if (m) {
      meta[m[1].trim()] = m[2].trim();
      if (m[1].trim() === 'Video' && m[2].trim()) videos.push(m[2].trim());
      if (m[1].trim() === 'Remark' && m[2].trim()) remarks.push(m[2].trim());
      if (m[1].trim() === 'IllegalPlay') { const d = parseIllegalRef(m[2]); if (d) illegalDeclared.push(d); }
      if (m[1].trim() === 'ResultOnly') { const r = m[2].match(/^Game\s+(\d+)$/i); if (r) resultOnlyDeclared.push(parseInt(r[1], 10)); }
      continue;
    }
    const box = raw.match(/^;\s*\|(.*)\|\s*$/);   // the transcriber's remarks box: "; |  Remarks: ... |"
    if (box) {
      const t = box[1].replace(/^\s*Remarks:\s*/i, '').trim();
      if (t) {
        remarks.push(t);
        const d = parseIllegalRemark(t);
        if (d) illegalDeclared.push(d);
      }
      continue;
    }
    const sp = raw.match(/^;\s*Set Pos=([-A-Oa-o]{26})(?:\/\d)?\s*$/i);   // XG: "the position here is ..." (an XGID board); checked by the validator
    if (sp) { pendingSetPos = { board: sp[1], line: lineNo }; continue; }
    if (raw.startsWith(';')) continue; // other comment

    m = raw.match(/^\s*(\d+)\s+point\s+match\s*$/i);
    if (m) { matchLength = parseInt(m[1], 10); continue; }
    if (/^\s*(money|unlimited)\b/i.test(raw)) { matchLength = 0; continue; }

    m = raw.match(/^\s*Game\s+(\d+)\s*$/i);
    if (m) {
      game = { index: parseInt(m[1], 10), startScore: [0, 0], crawford: false, actions: [], declared: null };
      games.push(game);
      expectScoreLine = true;
      continue;
    }

    if (expectScoreLine) {
      const sc = parseScoreLine(raw);
      if (!sc) throw new BgdbError('V-FORMAT', `Expected the score line after "Game ${game.index}"`, { line: lineNo, hint: 'The line looks like "name: 0   name: 0".' });
      names = sc.names;
      rightIdx = sc.rightIdx;
      game.startScore = sc.scores;
      expectScoreLine = false;
      continue;
    }

    if (!game && matchLength === null && /^\s*[+|]/.test(raw)) {   // a box above the match (event, players), without the leading ";"
      const t = raw.replace(/^\s*\|(.*)\|\s*$/, '$1').trim();
      if (t && !/^[+-]+$/.test(t)) remarks.push(t);
      continue;
    }
    if (!game) throw new BgdbError('V-FORMAT', `Unexpected text before the first game: "${raw.trim().slice(0, 40)}"`, { line: lineNo });

    // game rows (with row number) or stray "Wins" lines (without)
    let base = 0;
    let rest = raw;
    let rowNo = null;
    const row = raw.match(/^(\s*(\d+)\))(.*)$/);
    if (row) { base = row[1].length; rest = row[3]; rowNo = parseInt(row[2], 10); }
    else if (!/^\s+(Wins|Loss(es)?|Resign(ed)?|Drops?|Pass(es)?|Takes?|Doubles)\b/.test(raw)) {
      throw new BgdbError('V-FORMAT', `Cannot understand this line: "${raw.trim().slice(0, 50)}"`, { line: lineNo });
    }

    // Cells are cut at their first word (a roll "63:" or a keyword), not at the gaps: in some exports a long
    // left cell touches the right cell with a single space. The column of the cell's start gives the side.
    if (rest.trim() === '') continue;                // a numbered row with nothing in it
    const boundary = Math.min(rightIdx, rowRight ?? Infinity) - 2;
    // (the dump of an "Illegal play (...)" holds names and numbers: it is hidden from the search for the start of a cell)
    const masked = rest.replace(/Illegal play\s*\([^)]*\)/gi, (x) => 'x'.repeat(x.length));
    const starts = cellStarts(masked);
    if (starts.length === 0 || rest.slice(0, starts[0]).trim() !== '') {
      throw new BgdbError('V-FORMAT', `Cannot understand this line: "${raw.trim().slice(0, 50)}"`, { line: lineNo, hint: 'Expected a roll like "63: 24/18 13/10", "Doubles => 2", "Takes" or "Drops".' });
    }
    const before = game.actions.length;
    starts.forEach((st, k) => {
      const text = rest.slice(st, starts[k + 1] ?? rest.length).trim();
      parseCell(text, base + st >= boundary ? 1 : 0, game, lineNo, rowNo);
    });
    if (pendingSetPos && game.actions.length > before) { game.actions[before].setPos = pendingSetPos; pendingSetPos = null; }
  }

  for (const g of games) {
    if (g.resigned && g.declared) g.declared.resign = true;
    delete g.resigned;
  }
  if (games.length === 0) throw new BgdbError('V-FORMAT', 'No game found in the file', { hint: 'A match file contains lines "Game 1", "Game 2", ...' });
  if (matchLength === null) throw new BgdbError('V-FORMAT', 'Match length line not found', { hint: 'Expected a line such as "5 point match".' });

  const rating = (n) => {
    const key = Object.keys(meta).find((k) => /^Player [12]$/.test(k) && meta[k] === n);
    const m = key && (meta[`${key} Elo`] ?? '').match(/^([\d.]+)\/(\d+)$/);
    return m ? { rating: parseFloat(m[1]), experience: parseInt(m[2], 10) } : {};
  };
  const p1 = names[0] ?? meta['Player 1'];
  const p2 = names[1] ?? meta['Player 2'];
  const dialect = detectDialect(meta, lines);
  // some servers write the rating after the name on the score line ("ouzelbird,1859 : 0"): it is a rating, not part of the name
  const side = (n) => {
    const m = /^(.*\S)\s*,\s*(\d{3,4}(?:\.\d+)?)$/.exec(n ?? '');
    return m ? { name: m[1], rating: parseFloat(m[2]) } : { name: n, ...rating(n) };
  };
  return {
    schema: '1.0',
    sides: [side(p1), side(p2)],
    matchLength,
    rules: {
      crawford: meta.Crawford ? /^on$/i.test(meta.Crawford) : true,
      jacoby: meta.Jacoby ? /^on$/i.test(meta.Jacoby) : null,
      beaver: meta.Beaver ? /^on$/i.test(meta.Beaver) : null,
      cubeLimit: meta.Cubelimit || meta.CubeLimit ? parseInt(meta.Cubelimit ?? meta.CubeLimit, 10) : null,
    },
    date: meta.EventDate ? meta.EventDate.replace(/\./g, '-') : null,
    time: meta.EventTime ? meta.EventTime.replace('.', ':') : null,
    event: meta.Event ?? null,
    round: meta.Round ?? null,
    games,
    links: videos,
    remarks: remarks.slice(0, 20).map((r) => r.slice(0, 300)),
    illegalDeclared,
    resultOnlyDeclared,
    provenance: { originalFormat: 'mat', dialect, site: meta.Site ?? null, siteMatchId: meta['Match ID'] ?? null },
  };
}

/** "Game 6, Move 19 of Simon Lockwood" (the form written by this project) -> {game, row, player} */
export function parseIllegalRef(text) {
  const m = String(text).match(/Game\s+(\d+)\s*,\s*Move\s+(\d+)(?:\s+of\s+(.+?))?\s*$/i);
  return m ? { game: +m[1], row: +m[2], player: m[3]?.trim() || null } : null;
}

/** a transcriber's remark such as "Game 6, Move 19 of Simon Lockwood --> 11: 3/2 1/Off(2) was illegal" */
export function parseIllegalRemark(text) {
  const m = String(text).match(/Game\s+(\d+)\s*,\s*Move\s+(\d+)(?:\s+of\s+(.+?))?\s*-->.*\bwas\s+illegal\b/i);
  return m ? { game: +m[1], row: +m[2], player: m[3]?.trim() || null } : null;
}

function detectDialect(meta, lines) {
  const site = (meta.Site ?? '').toLowerCase();
  if (site.includes('opengammon')) return 'opengammon';
  if (site.includes('foxamon')) return 'foxamon';
  if (site.includes('backgammon studio')) return 'backgammon-studio';
  if (site.includes('extreme gammon')) return 'xg-text';
  if (site === 'bgdb') return 'bgdb';
  if (site.includes('choue')) return 'choue';
  if (site.includes('backgammongalaxy')) return 'backgammongalaxy';
  if (Object.keys(meta).some((k) => /^Player [12] Elo$/.test(k))) return 'xg-text'; // XG export with its own site name (extmatchdb, tournaments)
  return lines.some((l) => /\bbar\//.test(l)) ? 'backgammon-studio' : 'generic';
}

function parseScoreLine(raw) {
  // "name1 : 0      name2 : 0" - names may contain spaces and symbols (e.g. "XG Roller+").
  // The left column is side 0 whatever the "Player 1/2" tags say (eXtreme Gammon lists Player 2 first).
  const all = [...raw.matchAll(/(\S(?:.*?\S)?)\s*:\s*(\d+)/g)];
  if (all.length < 2) return null;
  const [l, r] = [all[0], all[all.length - 1]];
  return { names: [l[1], r[1]], scores: [parseInt(l[2], 10), parseInt(r[2], 10)], rightIdx: r.index };
}

function parseCell(text, side, game, line, row) {
  let m;
  if ((m = text.match(/^Doubles\s*=+>\s*(\d+)$/i))) {
    game.actions.push({ side, kind: 'double', cube: parseInt(m[1], 10), line });
  } else if (/^Takes?$/i.test(text)) {
    game.actions.push({ side, kind: 'take', line });
  } else if (/^(Drops?|Passes|Pass)$/i.test(text)) {
    game.actions.push({ side, kind: 'drop', line });
  } else if (/^Resign(ed)?\s+(Game|Match|normal|single|gammon|backgammon)$/i.test(text)) {
    game.resigned = true; // column is not reliable: the winner is given by the "Wins" cell
  } else if ((m = text.match(/^Wins\s+(\d+)\s+points?(\s+and\s+the\s+match)?$/i))) {
    game.declared = { winner: side, points: parseInt(m[1], 10), matchEnd: !!m[2], line };
  } else if (/^Loss(es)?\s+\d+\s+points?(\s+and\s+the\s+match)?$/i.test(text)) {
    // the loser's side of a Wins line (some sites write both): the Wins cell carries the result
  } else if (/^00:/.test(text)) {
    // "00:" = nothing was rolled (Backgammon Studio writes it for the player who resigns instead of rolling): the same as a hidden play
    game.actions.push({ side, kind: 'move', dice: [0, 0], moves: [], hidden: true, unrolled: true, line, row });
  } else if ((m = text.match(/^([1-6])([1-6]):\s*(.*)$/))) {
    const dice = [parseInt(m[1], 10), parseInt(m[2], 10)];
    const body = m[3].trim();
    if (/^\?+$/.test(body) || /^Illegal play$/i.test(body)) {
      // Backgammon Studio hides the play of a player who abandons the game (a resignation)
      game.actions.push({ side, kind: 'move', dice, moves: [], hidden: true, line, row });
      return;
    }
    const illegal = body.match(/^Illegal play\s*\((.*)\)$/i);
    if (illegal) {
      // the play could not be exported: the dump gives the position after it (docs/formats/illegal-play-marker.md)
      const marker = parseIllegalDump(illegal[1]);
      if (!marker) throw new BgdbError('V-FORMAT', `Cannot understand the dump of the \"Illegal play\" marker`, { line, hint: 'Only the layout of two known files is read: 40 values separated by \";\".' });
      game.actions.push({ side, kind: 'move', dice, moves: [], marker, line, row });
      return;
    }
    const moves = /^(cannot move)?$/i.test(body) ? [] : parseMoves(body, line);
    game.actions.push({ side, kind: 'move', dice, moves, line, row });
  } else {
    throw new BgdbError('V-FORMAT', `Cannot understand "${text}"`, { line, hint: 'Expected a roll like "63: 24/18 13/10", "Doubles => 2", "Takes" or "Drops".' });
  }
}

/** Parse "24/18 13/10*(2) bar/20 6/off" into [{from,to}] (repeat counts expanded). */
export function parseMoves(body, line) {
  const out = [];
  for (const tok of body.split(/\s+/)) {
    if (tok === '0/0') continue;                    // a die with nothing to move (the last checker is off): written by some transcribers, not a step
    const m = tok.match(/^((?:bar|off|\d+)\*?(?:\/(?:bar|off|\d+)\*?)+)(?:\((\d)\))?$/i);
    if (!m) throw new BgdbError('V-FORMAT', `Cannot understand the move "${tok}"`, { line, hint: 'Moves look like 13/7, 8/5*, bar/20, 6/off or 13/10(2).' });
    const pts = m[1].split('/').map((x) => {
      const s = x.replace('*', '').toLowerCase();
      return s === 'bar' ? BAR : s === 'off' ? OFF : parseInt(s, 10);
    });
    const times = m[2] ? parseInt(m[2], 10) : 1;
    for (let t = 0; t < times; t++) {
      for (let k = 0; k + 1 < pts.length; k++) {
        const from = pts[k];
        const to = pts[k + 1];
        if (from < 1 || from > 25 || to < 0 || to > 24 || to >= from) {
          throw new BgdbError('V-FORMAT', `The move "${tok}" is not a forward move`, { line });
        }
        out.push({ from, to });
      }
    }
  }
  return out;
}
