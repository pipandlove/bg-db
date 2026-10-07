/**
 * Reader for eXtreme Gammon files (.xg): turns the binary file into the logical match model, exactly like the text parsers do. Everything
 * after this point (legality check, identity, normalised .mat, replay) is the same code as for a text match.
 *
 * What is known about the format (reverse-engineered from real files and checked against their text exports, see docs/formats/xg-binary.md):
 *   - "RGMH" header, then zlib streams. The biggest one is a list of records of 2560 bytes; the entry type is the byte at offset 8:
 *       0 match header   names (Pascal strings at 9 and 50), match length (int32 at 92, 99999 = money game), Crawford/Jacoby/Beaver (bytes 100-102),
 *                        date (Delphi TDateTime, double at 128), site (Pascal string at 283)
 *       1 game header    scores at the start (int32 at 12 and 16), game number (int32 at 48)
 *       2 cube record    one per turn: player (int32 at 12), doubled (int32 at 16 = 1), answer (int32 at 20: 0 pass, 1 take)
 *       3 move record    one per roll: player (int32 at 64: 1 or -1), steps (8 int32 at 68, from/to pairs, 0-based, from 24 = bar, to -1 = off, -1 ends),
 *                        dice (int32 at 100 and 104)
 *       4 game footer    winner (int32 at 24: 1 or -1), points (28), how it ended (32: 0 cube dropped, 1 single, 2 gammon, 3 backgammon, 100 + n resigned)
 *       5 match footer
 *   - Player 1 is the first name and has ActiveP = 1: it becomes side 0 of the model.
 * Analysis (equities, errors) is not read: the file is kept as an attachment instead. Whether it carries analysis is detected.
 */
import { BgdbError } from './errors.js';
import { inflateZlib } from './inflate.js';

const REC = 2560;
const MONEY = 99999;
const fail = (message, hint) => new BgdbError('V-FORMAT', message, hint ? { hint } : {});

export const isXg = (bytes) => bytes.length > 4 && bytes[0] === 0x52 && bytes[1] === 0x47 && bytes[2] === 0x4d && bytes[3] === 0x48;   // "RGMH"

const view = (rec) => new DataView(rec.buffer, rec.byteOffset, rec.byteLength);

function pascal(rec, offset, max = 40) {
  const n = Math.min(rec[offset], max);
  const bytes = rec.subarray(offset + 1, offset + 1 + n);
  try { return new TextDecoder('windows-1252').decode(bytes).replace(/\0.*$/s, '').trim(); } catch { return String.fromCharCode(...bytes).trim(); }
}

/** the records of the biggest zlib stream of the file whose size is a multiple of 2560 and which starts with a match header */
function mainStream(bytes) {
  let best = null;
  for (let o = 8; o + 2 < bytes.length; o++) {
    if (bytes[o] !== 0x78 || ![0x01, 0x5e, 0x9c, 0xda].includes(bytes[o + 1])) continue;
    let r;
    try { r = inflateZlib(bytes, o); } catch { continue; }
    if (r.out.length >= 3 * REC && r.out.length % REC === 0 && r.out[8] === 0 && (!best || r.out.length > best.length)) best = r.out;
    if (r.end > o + 2) o = Math.max(o, r.end - 1);                          // continue after a stream that was read
  }
  return best;
}

const tDateTime = (v) => {
  if (!(v > 20000 && v < 80000)) return { date: null, time: null };
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
  const minutes = Math.floor((v - Math.floor(v)) * 1440 + 1e-6);
  const two = (n) => String(n).padStart(2, '0');
  return { date: `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`, time: `${two(Math.floor(minutes / 60))}:${two(minutes % 60)}` };
};

/** a cube record carries analysis when its evaluation area holds numbers: plausible equities and probabilities (single-precision floats) */
function hasEvaluation(rec) {
  const dv = view(rec);
  for (let o = 124; o < 700; o += 4) {
    const v = dv.getFloat32(o, true);
    if (Number.isFinite(v) && Math.abs(v) > 1e-4 && Math.abs(v) < 4) return true;
  }
  return false;
}

/**
 * @param {Uint8Array} bytes the whole file
 * @returns {object} the match (same shape as the output of parseMat), not yet validated
 * @throws {BgdbError} V-FORMAT with a sentence a person can act on
 */
export function parseXg(bytes) {
  if (!isXg(bytes)) throw fail('This is not an eXtreme Gammon file (it does not start with "RGMH").');
  const data = mainStream(bytes);
  if (!data) throw fail('The game records of this eXtreme Gammon file could not be found: the file is damaged or from a version of XG that is not supported yet.', 'Export the match from eXtreme Gammon as text (.txt) and submit that file next to the .xg.');
  const recs = [];
  for (let i = 0; i < data.length; i += REC) recs.push(data.subarray(i, i + REC));
  const head = recs[0];
  const hv = view(head);

  const names = [pascal(head, 9), pascal(head, 50)];
  if (!names[0] || !names[1]) throw fail('The player names of this eXtreme Gammon file could not be read: the file is from a version of XG that is not supported yet.');
  const length = hv.getInt32(92, true);
  const matchLength = length === MONEY ? 0 : length;
  if (matchLength < 0 || matchLength > 99) throw fail(`The match length of this eXtreme Gammon file (${length}) is not credible: the file is from a version of XG that is not supported yet.`);
  const money = matchLength === 0;
  const { date, time } = tDateTime(hv.getFloat64(128, true));
  const side = (active) => (active === 1 ? 0 : active === -1 ? 1 : null);

  const games = [];
  let game = null;
  let analysed = false;
  let row = 0;
  const open = () => { if (!game) throw fail('The records of this eXtreme Gammon file are not in the expected order (a record outside a game).'); return game; };

  for (let i = 1; i < recs.length; i++) {
    const r = recs[i];
    const v = view(r);
    switch (r[8]) {
      case 1:
        if (game && !game.closed) throw fail(`Game ${game.index} of this eXtreme Gammon file has no end: the file stops in the middle of a game.`);
        game = { index: v.getInt32(48, true), startScore: [v.getInt32(12, true), v.getInt32(16, true)], crawford: false, actions: [], declared: null, closed: false };
        row = 0;
        games.push(game);
        break;
      case 2: {
        const g = open();
        if (hasEvaluation(r)) analysed = true;
        if (v.getInt32(16, true) === 1) {                                  // a double, with its answer in the same record
          const doubler = side(v.getInt32(12, true));
          const answer = v.getInt32(20, true);
          if (doubler === null) throw fail(`Game ${g.index}: a double by an unknown player.`);
          if (answer !== 0 && answer !== 1) throw fail(`Game ${g.index}: a beaver or a raccoon, which this reader does not support yet.`, 'Export the match from eXtreme Gammon as text (.txt) and submit that file next to the .xg.');
          row++;
          g.actions.push({ side: doubler, kind: 'double', cube: null, row });
          g.actions.push({ side: 1 - doubler, kind: answer === 1 ? 'take' : 'drop', row });
        }
        break;
      }
      case 3: {
        const g = open();
        const s = side(v.getInt32(64, true));
        if (s === null) throw fail(`Game ${g.index}: a play by an unknown player.`);
        const dice = [v.getInt32(100, true), v.getInt32(104, true)];
        if (!dice.every((d) => d >= 1 && d <= 6)) throw fail(`Game ${g.index}: dice that are not dice (${dice.join(', ')}).`);
        const raw = Array.from({ length: 8 }, (_, k) => v.getInt32(68 + 4 * k, true));
        if (raw.every((x) => x === 0)) break;                               // a roll with no play yet: the game was left here (the missing end is reported below)
        const moves = [];
        for (let k = 0; k < 8; k += 2) {
          const from = v.getInt32(68 + 4 * k, true);
          const to = v.getInt32(72 + 4 * k, true);
          if (from === -1) break;
          if (from < 0 || from > 24 || to < -1 || to > 23 || (to >= 0 && to >= from)) throw fail(`Game ${g.index}: a step that is not a forward step (${from} to ${to}).`);
          moves.push({ from: from + 1, to: to + 1 });                       // 0-based points, 24 = bar, -1 = off  ->  1..25, 25 = bar, 0 = off
        }
        row++;
        g.actions.push({ side: s, kind: 'move', dice, moves, row });
        break;
      }
      case 4: {
        const g = open();
        const winner = side(v.getInt32(24, true));
        const how = v.getInt32(32, true);
        if (winner === null) throw fail(`Game ${g.index}: the winner is unknown.`);
        g.declared = { winner, points: v.getInt32(28, true), resign: how >= 100 };
        g.closed = true;
        break;
      }
      default:                                                             // 0 (a second header), 5 (match footer), others: nothing to read
        break;
    }
  }
  if (games.length === 0) throw fail('No game was found in this eXtreme Gammon file.');
  const last = games[games.length - 1];
  if (!last.closed) throw fail(`Game ${last.index} of this eXtreme Gammon file has no end: the file was saved in the middle of a game, and a game that is not finished cannot be kept.`, 'Finish the game in eXtreme Gammon (or resign it) and export the match again.');
  for (const g of games) delete g.closed;

  return {
    schema: '1.0',
    sides: [{ name: names[0] }, { name: names[1] }],
    matchLength,
    rules: {
      crawford: head[100] === 1,
      jacoby: money ? head[101] === 1 : null,
      beaver: money ? head[102] === 1 : null,
      cubeLimit: null,
    },
    date, time, event: null, round: null,
    games, links: [], remarks: [], illegalDeclared: [],
    provenance: {
      originalFormat: 'xg', dialect: 'xg-binary', site: pascal(head, 283) || null, siteMatchId: null,
      analysis: { present: analysed, engine: 'eXtreme Gammon' },
    },
  };
}
