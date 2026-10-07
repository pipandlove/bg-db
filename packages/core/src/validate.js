/**
 * Match validation (spec section "Validation pipeline"): replays every game from the
 * initial position and checks turn order, move legality, cube actions, scores and results.
 * Returns the match with derived data filled in (hit flags, game results) plus diagnostics.
 */
import { diag } from './errors.js';
import { normalizeVideoLink } from './links.js';
import { normalizeName } from './names.js';
import { formatMoves } from './mat-writer.js';
import {
  startPosition, clonePosition, legalPlays, applyNotated, positionKey, checkPosition, winKind, opp, isPartialPlay, hitsBetween, movesBetween,
} from './rules.js';
import { positionFromDump } from './illegal-dump.js';
import { parseXGID } from './xgid.js';

/**
 * @param {object} match  output of parseMat / parseSgf
 * @returns {{ok:boolean, errors:object[], warnings:object[], infos:object[], match:object}}
 */
/** the XGID board of a "; Set Pos=" line is the position pos, seen from either side */
function samePosition(board, pos) {
  let p;
  try { p = parseXGID(`${board}:0:0:1:00:0:0:0:0:10`).pos; } catch { return false; }
  const k = positionKey(pos);
  return positionKey(p) === k || positionKey({ c: [p.c[1], p.c[0]], off: [p.off[1], p.off[0]] }) === k;
}

/** errors that say the moves of one game cannot be read (its result may still be known) */
const UNREADABLE = (e) => ['V-LEGAL', 'V-DAMAGED', 'V-TURN', 'V-CUBE'].includes(e.code) || (e.code === 'V-FORMAT' && /set position/.test(e.message));
const gameOf = (e) => Number((e.message.match(/^Game (\d+)/) ?? [])[1]) || null;
const nameOf = (match, side) => match.sides[side]?.name ?? `player ${side + 1}`;

/** the result of a game given by its Wins line and confirmed by a second source: the start score of the next game, or the end of the match */
function confirmedResult(match, gi) {
  const game = match.games[gi];
  const d = game.declared;
  if (!d || !(d.winner === 0 || d.winner === 1) || !(d.points > 0)) return null;
  const w = d.winner;
  const next = match.games[gi + 1];
  if (next) {
    const ok = next.startScore[w] === game.startScore[w] + d.points && next.startScore[1 - w] === game.startScore[1 - w];
    return ok ? `the score of game ${next.index ?? gi + 2}` : null;
  }
  const L = match.matchLength;
  return L > 0 && (d.matchEnd || game.startScore[w] + d.points >= L) ? 'the end of the match' : null;
}

/**
 * Validate a match. With opts.salvage (bulk imports of old archives: bgdb ingest --salvage), when it fails, keep what is clear
 * (docs/partial-matches.md); without it (a contributor's own file) the errors are reported so that the file can be fixed:
 *   - a file that stops in the middle of its last game (no result and no Wins line): the complete games are kept;
 *   - a game whose moves cannot be read (an impossible or missing play, a wrong turn, a cube error, a set position):
 *       match play: kept by its result only when the Wins line gives it and a second source confirms it, otherwise left out; every game
 *                   that stays starts from the score its file gives, and the winner of the match must be known;
 *       money session: left out (there is no score to follow);
 *     at least one readable game must remain.
 * Anything else (a score or a winner that contradicts the file) leaves the match refused, with its errors.
 */
export function validateMatch(match, opts = {}) {
  const original = opts.salvage && match.games?.length > 1 ? structuredClone(match) : null;   // opt-in: archives (bgdb ingest --salvage)
  const r = validateOnce(match, opts);
  if (r.ok || !original) return r;
  const games = original.games;
  const n = games.length;
  const L = original.matchLength;
  const pos = (num) => games.findIndex((x, i) => (x.index ?? i + 1) === num);       // a game number in a message -> its position
  const errors = r.errors.filter((e) => !/^This match is damaged/.test(e.message));
  const lastNum = games[n - 1].index ?? n;
  const cut = errors.some((e) => e.message.startsWith(`Game ${lastNum} does not reach a result`)) && !games[n - 1].declared;
  const rest = errors.filter((e) => !(cut && gameOf(e) === lastNum));
  if (rest.length === 0 && !cut) return r;
  if (!rest.every((e) => gameOf(e) && UNREADABLE(e) && pos(gameOf(e)) >= 0)) return r;
  const bad = [...new Set(rest.map((e) => pos(gameOf(e))))];
  const notes = [];
  const drop = new Set(cut ? [n - 1] : []);
  for (const gi of bad) {
    const first = rest.find((e) => pos(gameOf(e)) === gi);
    const why = `the moves cannot be read (${first.code}${first.line ? ` line ${first.line}` : ''}: ${first.message.replace(/^Game \d+(, move \d+)?: /, '')})`;
    const by = L > 0 ? confirmedResult(original, gi) : null;
    if (by) {
      games[gi].actions = [];
      games[gi].resultOnlyReason = `${why}; the result is confirmed by ${by}`;
    } else {
      drop.add(gi);
      notes.push(diag('warning', 'V-PARTIAL', `Game ${games[gi].index ?? gi + 1}: ${why}; the game is left out${L > 0 ? ' (its result is not confirmed)' : ''}`, { game: games[gi].index ?? gi + 1 }));
    }
  }
  if (L > 0 && drop.has(n - 1) && !cut) return r;                         // the last game is lost: the winner of the match is not known
  const readable = games.filter((x, gi) => !drop.has(gi) && !x.resultOnlyReason).length;
  if (readable === 0) return r;
  if (cut) notes.unshift(diag('warning', 'V-PARTIAL', `Game ${lastNum}: the file stops in the middle of this game (no result and no Wins line): the game is left out`, { game: lastNum, hint: 'If the rest of the game exists, submit the complete file: it will be another match (the identity covers every game).' }));
  original.games = games.filter((x, gi) => !drop.has(gi));
  const r2 = validateOnce(original, opts);
  if (!r2.ok) return r;
  if (L > 0 && !cut && !r2.match.result?.finished) return r;              // games were removed: the winner of the match must still be known
  r2.warnings.unshift(...notes);
  return r2;
}

function validateOnce(match, opts = {}) {
  const diags = [];
  const add = (sev, code, msg, where) => diags.push(diag(sev, code, msg, where));

  // video links: keep the valid ones in canonical form, drop (and report) the others
  const links = [];
  for (const raw of match.links ?? []) {
    const r = normalizeVideoLink(raw, { hosts: opts.videoHosts });
    if (!r.ok) { add('warning', 'V-LINK', `A video link was ignored: ${r.reason}`, { hint: 'Use an https link to a YouTube video, for example https://youtu.be/xxxxxxxxxxx.' }); continue; }
    if (r.link.game && r.link.game > match.games.length) { add('warning', 'V-LINK', `A video link refers to game ${r.link.game} but the match has ${match.games.length}; the game number was dropped`, {}); delete r.link.game; }
    if (!links.some((l) => l.url === r.link.url && l.game === r.link.game)) links.push(r.link);
  }
  match.links = links;

  // plays that the source declares illegal-but-made (transcriber's remarks, or a sidecar entry): accepted as played, flagged
  const declared = [...(match.illegalDeclared ?? []), ...(opts.illegal ?? [])].map((d) => ({ ...d, used: false }));
  const illegalPlays = [];
  const takeDeclaration = (game, a) => declared.find((d) => !d.used && d.game === game && d.row === a.row
    && (!d.player || normalizeName(d.player) === normalizeName(match.sides[a.side].name)));
  const L = match.matchLength;
  let score = [0, 0];
  let crawfordUsed = false;
  let prevWins = null;                                                  // the Wins line of the previous game, named when the next start score disagrees
  let matchEndClaim = null;                                             // the game whose Wins line says "and the match"
  let partialStart = null;                                              // the score of the first game when the match is recorded from the middle
  const gaps = [];                                                      // places where games are missing between two games of the file: {before, from, to}
  const damaged = [];                                                   // plays that are missing: {game, row, side, roll, candidates}

  if (!match.sides[0].name || !match.sides[1].name) add('warning', 'V-META', 'A player name is missing');
  if (match.sides[0].name && match.sides[0].name === match.sides[1].name) add('warning', 'V-META', 'Both players have the same name');

  match.games.forEach((game, gi) => {
    const g = game.index ?? gi + 1;                                       // the game's number in the file (games may have been left out)
    const W = { game: g };

    // ---- a fragment: the first game recorded already has a score (the match is recorded from the middle)
    if (gi === 0 && L > 0 && (game.startScore[0] !== 0 || game.startScore[1] !== 0)
      && game.startScore.every((x) => Number.isInteger(x) && x >= 0 && x < L)) {
      score = game.startScore.slice();
      partialStart = score.slice();
      add('warning', 'V-PARTIAL', `The file starts with the score already at ${score.join('-')} in a ${L}-point match: only part of the match is recorded, and the result is counted from there`, W);
    }
    // ---- scores at start of game
    let gapBefore = false;
    if (game.startScore[0] !== score[0] || game.startScore[1] !== score[1]) {
      if (gi > 0 && game.startScore.every((x, k) => Number.isInteger(x) && x >= score[k] && (L === 0 || x < L))) {
        // Games are missing between the previous game and this one (an excerpt: a transcriber keeps some games of a match or of a money session's
        // running total). The score at the start of each game is taken as written; it can only go forward, and stay below the match length.
        gapBefore = true;
        gaps.push({ before: g, from: score.slice(), to: game.startScore.slice() });
        const was = prevWins ? ` (the Wins line of game ${match.games[gi - 1]?.index ?? gi} says ${match.sides[prevWins.winner].name ?? `player ${prevWins.winner + 1}`} wins ${prevWins.points} point(s))` : '';
        add('warning', 'V-PARTIAL', `Game ${g} starts at ${game.startScore.join('-')} but game ${match.games[gi - 1]?.index ?? gi} ended at ${score.join('-')}${was}: games are missing between them, the file is an excerpt of the match`, { ...W, hint: 'The start score of each game is trusted. If no game is missing, the Wins line of the previous game is wrong: check it.' });
        score = game.startScore.slice();
      } else {
      const prev = prevWins ? `; the Wins line of game ${match.games[gi - 1]?.index ?? gi} says ${match.sides[prevWins.winner].name ?? `player ${prevWins.winner + 1}`} wins ${prevWins.points} point(s)` : '';
      add('error', 'V-SCORE', `Game ${g} starts at ${game.startScore.join('-')} but the previous games add up to ${score.join('-')}${prev}`, { ...W, hint: 'Check the "Wins N points" lines of the previous games.' });
      }
    }
    // ---- Crawford game (computed)
    const crawfordWasUsed = crawfordUsed;
    let crawford = false;
    if (L > 0 && match.rules.crawford !== false) {
      const a = score[0] === L - 1;
      const b = score[1] === L - 1;
      if (a !== b && !crawfordUsed) { crawford = true; crawfordUsed = true; }
    }
    if (game.crawford !== crawford && match.provenance.originalFormat === 'sgf') {
      add('warning', 'V-SCORE', `Game ${g}: Crawford flag in the file (${game.crawford}) differs from the computed one (${crawford})`, W);
    }
    if (((gi === 0 && partialStart) || (gapBefore && !crawfordWasUsed)) && L > 0 && match.rules.crawford !== false && (score[0] === L - 1) !== (score[1] === L - 1)) {
      // A fragment (or a game after a gap) that starts with a player one point from winning: was the Crawford game already played? The file does not say (SGF does:
      // its flag is kept). A double in the game proves it is a game after the Crawford game; with no double, the Crawford game is the better guess.
      const doubled = game.actions.some((x) => x.kind === 'double');
      crawford = match.provenance.originalFormat === 'sgf' ? game.crawford === true : !doubled;
      crawfordUsed = true;
      if (match.provenance.originalFormat !== 'sgf') {
        add('info', 'V-PARTIAL', crawford
          ? `Game ${g}: a player is one point from winning and nobody doubles: taken as the Crawford game (the file starts after the Crawford game or at it, which it does not say)`
          : `Game ${g}: a player is one point from winning and the cube is used: taken as a game after the Crawford game`, W);
      }
    }
    game.crawford = crawford;

    // ---- replay
    // The "Wins N points" line settles the game when there is no bear-off or drop. A roll at the very end of the game (nothing but hidden
    // plays after it) is then only a tail: whatever it holds, it cannot change who won, so it is not allowed to make the match invalid.
    const settled = !!game.declared && (game.declared.winner === 0 || game.declared.winner === 1);
    const loseGame = (why) => {
      if (!game.declared) { add('error', 'V-LEGAL', `Game ${g}: ${why}, and there is no Wins line that gives its result`, W); return false; }
      lostGame = true;
      ended = true;
      result = { winner: game.declared.winner, how: 'declared' };
      add('warning', 'V-PARTIAL', `Game ${g}: ${why}; only its result is kept (${match.sides[game.declared.winner].name ?? `player ${game.declared.winner + 1}`} wins ${game.declared.points} point(s))`, W);
      return true;
    };
    const onlyHiddenAfter = (ai) => game.actions.slice(ai + 1).every((x) => x.kind === 'move' && x.hidden);
    let pos = startPosition();
    let cube = 1;
    let cubeOwner = null; // null = centred
    let lastRoller = null;
    let pending = null; // {side, value}
    let ended = false;
    let result = null;
    let lostGame = false;                                               // the plays of the game are lost: only its result is kept
    const errsBefore = diags.filter((d) => d.severity === 'error').length;

    if (game.actions.length === 0 && (game.resultOnlyReason || (match.resultOnlyDeclared ?? []).includes(g))) loseGame(game.resultOnlyReason ?? 'the plays of this game are not recorded');
    for (let ai = 0; ai < game.actions.length; ai++) {
      const a = game.actions[ai];
      const where = { ...W, action: ai + 1, line: a.line };
      if (a.setPos && !samePosition(a.setPos.board, pos)) {
        // "; Set Pos=": the source puts the board in a position the moves do not lead to (an opening that was not recorded, a correction)
        const atStart = !game.actions.slice(0, ai).some((x) => x.kind === 'move' && !x.hidden);
        add('error', 'V-FORMAT', `Game ${g}: the file ${atStart ? 'starts the game from a set position' : 'sets a position that the moves before do not lead to'} ("Set Pos", line ${a.setPos.line}); games from a set position are not supported yet`, { ...where, line: a.setPos.line, hint: 'Only games that start from the opening position can be kept for now.' });
        break;
      }
      if (ended) {
        if (a.kind === 'move' && a.hidden) continue;                     // an empty slot ("00:", "????") after the end: nothing to read
        add('error', 'V-LEGAL', `Game ${g}: moves continue after the game is over`, where);
        break;
      }

      if (a.kind === 'move' && a.hidden) {
        // "????" / "???": the player rolled and then resigned (the sites hide the play of the player who gives up)
        if (pending) { add('error', 'V-CUBE', `Game ${g}: a double was offered but nobody took or dropped before the next roll`, where); break; }
        if (!a.unrolled && lastRoller !== null && a.side !== opp(lastRoller)) { add('error', 'V-TURN', `Game ${g}: the same player rolls twice in a row`, where); break; }
        if (!onlyHiddenAfter(ai)) {
          // a hidden play that is not the end of the game: the play is not known, so neither is the position (decision 0020)
          damaged.push({ game: g, row: a.row, side: a.side, roll: a.dice.join(''), candidates: null });
          add('error', 'V-DAMAGED', `Game ${g}, move ${a.row}: the play of ${match.sides[a.side].name ?? 'the player'}${a.unrolled ? '' : ` for ${a.dice.join('')}`} is hidden ("????" or "Illegal play") but the game goes on: the position is unknown from here and the rest of the game cannot be checked`, { ...where, hint: 'Plays are missing from this export. Ask for another export of the match.' });
          break;
        }
        if (!a.unrolled && settled && game.declared.winner === a.side) {
          // older transcriptions hide the winner's last bear-off ("44: ???") and write Wins under that player: when the roll bears off
          // every checker left, the play is known (all 15 off) and the game ends by a bear-off
          const finish = [...legalPlays(pos, a.side, a.dice[0], a.dice[1]).plays.values()].find((v) => v.pos.off[a.side] === 15);
          if (finish) {
            a.moves = movesBetween(pos, finish.pos, a.side, hitsBetween(pos, finish.pos, a.side));
            a.hidden = false;
            a.reconstructed = true;
            pos = finish.pos;
            a.pos = clonePosition(pos);
            lastRoller = a.side;
            ended = true;
            result = { winner: a.side, how: 'bearOff' };
            add('info', 'V-RESULT', `Game ${g}, move ${a.row}: the last play of ${match.sides[a.side].name ?? 'the player'} (${a.dice.join('')}) is not written and the file says that player wins: the roll bears off every checker left, so it is read as the final bear-off (${formatMoves(a.moves)})`, where);
            continue;
          }
        }
        ended = true;
        result = { winner: opp(a.side), how: 'resign', hiddenPlay: true };
        if (a.unrolled && settled) {
          // "00:" says nothing about who gave up: the Wins line decides
          if (game.declared.winner === a.side) add('info', 'V-RESULT', `Game ${g}: nothing was rolled by ${match.sides[a.side].name ?? 'the player'} and the file says that player wins: the Wins line is followed`, where);
          result.winner = game.declared.winner;
        }
        continue;
      }
      if (a.kind === 'move') {
        if (pending) { add('error', 'V-CUBE', `Game ${g}: a double was offered but nobody took or dropped before the next roll`, where); break; }
        if (lastRoller !== null && a.side !== opp(lastRoller)) {
          add('error', 'V-TURN', `Game ${g}: the same player rolls twice in a row`, { ...where, hint: 'A column may have been misread, or a turn is missing.' });
          break;
        }
        let fromMarker = false;
        if (a.marker) {
          // "Illegal play (...)": the play is not written, the source gives the position after it (docs/formats/illegal-play-marker.md)
          const r = resolveMarker(match, game, ai, a, pos, L);
          if (r.status === 'unreachable' && ai === 0) {
            // the position is the one of a later moment of the game: the beginning of the game is lost, and what follows cannot be checked
            loseGame('the first play is not written and the position the source gives after it is far from the opening position (the plays before it are lost)');
            break;
          }
          if (r.status !== 'ok') {
            add('error', 'V-LEGAL', `Game ${g}, move ${a.row}: the play of ${match.sides[a.side].name ?? 'the player'} (${a.dice.join('')}) is not written (\"Illegal play\") and ${r.message}`, { ...where, hint: 'The marker gives the position after the play: it must agree with the match and follow from the plays before it.' });
            break;
          }
          a.moves = r.moves;
          delete a.marker;
          fromMarker = true;
        }
        const { plays, used } = legalPlays(pos, a.side, a.dice[0], a.dice[1]);
        const tail = settled && onlyHiddenAfter(ai);
        let applied = applyNotated(pos, a.side, a.moves);
        let wrong = null;                                                 // the written play of a tail roll that cannot be played at all
        if (!applied) {
          if (!tail) {
            add('error', 'V-LEGAL', `Game ${g}: the move ${fmt(a)} cannot be played from this position`, { ...where, hint: 'A checker is missing on the starting point or the target point is blocked.' });
            break;
          }
          wrong = fmt(a);
          applied = { pos: clonePosition(pos), moves: [] };
        }
        let key = positionKey(applied.pos);
        const decl = takeDeclaration(g, a) ?? (fromMarker ? { marker: true } : null);
        if (decl) decl.used = true;
        if (wrong === null && tail && !decl && !plays.has(key) && !isPartialPlay(pos, a.side, a.dice[0], a.dice[1], applied.moves)) {
          // applicable to the board, but neither a legal play nor a prefix of one: same as moves that cannot be played
          wrong = fmt(a);
          applied = { pos: clonePosition(pos), moves: [] };
          key = positionKey(applied.pos);
        }
        if (wrong !== null) {
          // The last roll of the game is written with moves that cannot be played. The Wins line settles the game, so the play is dropped
          // (it is not trustworthy and not part of the identity) and the roll is kept, without moves, as the place where the game stopped.
          a.abandoned = true;
          a.discarded = wrong;
          add('warning', 'V-RESULT', `Game ${g}, move ${a.row}: the last roll of ${match.sides[a.side].name ?? 'the player'} (${wrong}) is not a possible play: it is ignored, and the game is counted as a resignation as the file says (${match.sides[game.declared.winner].name ?? `player ${game.declared.winner + 1}`} wins)`, where);
        } else if (!plays.has(key)) {
          if (decl) {
            // the transcriber says this play was made although it was illegal: keep it, flag it, go on from the resulting position
            a.illegal = true;
            illegalPlays.push({ game: g, row: a.row, side: a.side, player: match.sides[a.side].name ?? null, play: fmt(a) });
            if (decl.marker) add('warning', 'V-ILLEGAL', `Game ${g}, move ${a.row}: the play of ${match.sides[a.side].name ?? 'the player'} (${a.dice.join('')}) is not written; the position the source gives after it cannot be reached by a legal play: accepted as played, reconstructed as ${fmt(a)} (the position is exact, the moves are one way to reach it)`, where);
            else add('warning', 'V-ILLEGAL', `Game ${g}, move ${a.row}: ${match.sides[a.side].name ?? 'the player'} played ${fmt(a)}, which is not a legal play; accepted as played because the source says it was made`, where);
          } else if (tail && isPartialPlay(pos, a.side, a.dice[0], a.dice[1], applied.moves)) {
            // The last roll of the game is only partly played, or not at all: the game stopped in the middle of the turn (a resignation, by the
            // roller or by the opponent). The sites write what was moved. The play is kept as written but is not part of the identity.
            a.abandoned = true;
            const what = applied.moves.length ? `played only ${formatMoves(applied.moves)}` : 'played nothing';
            add('info', 'V-RESULT', `Game ${g}, move ${a.row}: ${match.sides[a.side].name ?? 'the player'} rolled ${a.dice.join('')} and ${what}, and the game stops there: counted as a resignation (${match.sides[game.declared.winner].name ?? `player ${game.declared.winner + 1}`} wins)`, where);
          } else {
            if (used > 0 && a.moves.length === 0) {
              // Nothing is written although a play was possible: the play is missing. Unlike a wrong play (a typo), it leaves the position unknown.
              damaged.push({ game: g, row: a.row, side: a.side, roll: a.dice.join(''), candidates: plays.size });
              add('error', 'V-DAMAGED', `Game ${g}, move ${a.row}: the play of ${match.sides[a.side].name ?? 'the player'} for ${a.dice.join('')} is missing (${plays.size} different play${plays.size === 1 ? ' was' : 's were'} possible): the position is unknown from here and the rest of the game cannot be checked`, { ...where, hint: 'Plays are missing from this export. Ask for another export of the match.' });
              break;
            }
            const msg = used === 0 || (a.moves.length === 0)
              ? `Game ${g}: the player has no move written but a legal move exists (${a.dice.join('')})`
              : `Game ${g}: the move ${fmt(a)} is not legal for this roll`;
            add('error', 'V-LEGAL', msg, { ...where, hint: 'The rules require playing as many dice as possible (and the larger die if only one can be played). If the play really was made in the match, declare it: see docs/formats (illegal plays).' });
            break;
          }
        } else if (decl) {
          if (decl.marker) add('info', 'V-ILLEGAL', `Game ${g}, move ${a.row}: the play of ${match.sides[a.side].name ?? 'the player'} (${a.dice.join('')}) is not written; the position the source gives after it is reached by a legal play: reconstructed as ${fmt(a)}`, where);
          else add('info', 'V-ILLEGAL', `Game ${g}, move ${a.row}: the source says ${fmt(a)} was illegal, but it is a legal play; treated as legal`, where);
        }
        a.moves = applied.moves; // normalized order with hit flags
        pos = applied.pos;
        a.pos = clonePosition(pos);
        lastRoller = a.side;
        if (pos.off[a.side] === 15) { ended = true; result = { winner: a.side, how: 'bearOff' }; }
        else if (a.abandoned) { ended = true; result = { winner: game.declared.winner, how: 'resign' }; }
      } else if (a.kind === 'double') {
        const expect = lastRoller === null ? null : opp(lastRoller);
        if (lastRoller === null) { add('error', 'V-CUBE', `Game ${g}: a double before the first roll`, where); break; }
        if (a.side !== expect) { add('error', 'V-CUBE', `Game ${g}: the double is offered by the player who is not on turn`, where); break; }
        if (cubeOwner !== null && cubeOwner !== a.side) { add('error', 'V-CUBE', `Game ${g}: the player does not own the cube`, where); break; }
        if (crawford) { add('error', 'V-CUBE', `Game ${g}: doubling is not allowed in the Crawford game`, where); break; }
        if (a.cube !== null && a.cube !== cube * 2) { add('error', 'V-CUBE', `Game ${g}: the cube goes from ${cube} to ${a.cube} (expected ${cube * 2})`, where); break; }
        a.cube = cube * 2;
        if (match.rules.cubeLimit && a.cube > match.rules.cubeLimit) add('warning', 'V-CUBE', `Game ${g}: cube above the limit ${match.rules.cubeLimit}`, where);
        pending = { side: a.side, value: a.cube };
      } else if (a.kind === 'take' || a.kind === 'drop') {
        if (!pending) { add('error', 'V-CUBE', `Game ${g}: "${a.kind}" without a double`, where); break; }
        if (a.side === pending.side) { add('error', 'V-CUBE', `Game ${g}: the doubler answers their own double`, where); break; }
        if (a.kind === 'take') { cube = pending.value; cubeOwner = a.side; pending = null; }
        else { ended = true; result = { winner: pending.side, how: 'drop', dropPoints: cube }; pending = null; }
      }
    }

    if (lostGame) { game.actions = []; game.resultOnly = true; }
    // ---- result
    const posErr = checkPosition(pos);
    if (posErr) add('error', 'V-LEGAL', `Game ${g}: inconsistent position (${posErr})`, W);

    const decl = game.declared;
    const failed = diags.filter((d) => d.severity === 'error').length > errsBefore;
    if (decl && decl.matchEnd) matchEndClaim = g;
    if (!result && pending && decl && !failed && decl.winner === pending.side) {
      // a double that nobody answered, and the file says the doubler wins: the other player passed
      result = { winner: pending.side, how: 'drop', dropPoints: cube };
      ended = true;
      add('info', 'V-RESULT', `Game ${g}: the double was not answered; counted as a drop, as the file says ${match.sides[pending.side].name ?? `player ${pending.side + 1}`} wins`, W);
    }
    if (!result && decl && !failed) {
      result = { winner: decl.winner, how: 'resign' };
      ended = true;
      if (!decl.resign) {
        // eXtreme Gammon's text export and BackgammonGalaxy have no resignation marker at all, so there it is normal
        const quiet = ['xg-text', 'backgammongalaxy'].includes(match.provenance.dialect);
        add(quiet ? 'info' : 'warning', 'V-RESULT', `Game ${g} ends without a bear-off or drop; it is treated as a resignation by ${match.sides[1 - decl.winner].name ?? `player ${2 - decl.winner}`}`, W);
      }
    }
    if (failed) {
      // errors already reported for this game; skip result checks. The running score follows the file's own word about this game, so that
      // one problem is reported once and not again as a wrong start score in every later game.
      if (decl && (decl.winner === 0 || decl.winner === 1) && Number.isFinite(decl.points)) {
        score = score.slice();
        score[decl.winner] += L > 0 ? Math.max(0, Math.min(decl.points, L - score[decl.winner])) : decl.points;
      }
    } else if (!result) {
      add('error', 'V-SCORE', `Game ${g} does not reach a result (no bear-off, drop or resignation)`, { ...W, hint: 'The file may be cut off.' });
    } else {
      // The ledger: the score at the start of the next game. It is a second, independent record of what this game was worth, and every later
      // score of the file is consistent with it. It is clean when only the winner's score went up.
      const nextStart = match.games[gi + 1]?.startScore;
      const ledger = nextStart ? { points: nextStart[result.winner] - score[result.winner], clean: nextStart[result.winner] - score[result.winner] >= 1 && nextStart[1 - result.winner] === score[1 - result.winner] } : null;
      let points;
      let kind = 'single';
      if (result.how === 'drop') points = result.dropPoints;
      else if (result.how === 'resign') {
        // A resignation concedes a single game, a gammon or a backgammon: at most 3 times the cube. Sites sometimes write
        // a larger number (a marker such as "2008 point", or an impossible "4 point" with the cube in the middle), and
        // OpenGammon/Foxamon cap the last game at what the winner needs: neither can be trusted blindly.
        const maxPlausible = 3 * cube;
        const needed = L > 0 ? L - score[result.winner] : Infinity;
        const raw = decl ? decl.points : null;
        if (raw === null && ledger?.clean && ledger.points <= maxPlausible) {
          // no Wins line says what the game was worth (a hidden play ends the game): the score of the next game does. A Wins line is never overridden by it:
          // the line is written by the site, so a disagreement means the file was edited or cut, and that must be reported.
          points = ledger.points;
          add('info', 'V-RESULT', `Game ${g}: no points are written for the resignation; ${points} taken from the score at the start of game ${match.games[gi + 1]?.index ?? gi + 2}`, W);
        } else if (raw === null) points = Math.min(needed, maxPlausible);
        else if (raw > maxPlausible) {
          points = Math.min(needed, maxPlausible);
          if (points === needed) add('info', 'V-RESULT', `Game ${g}: the site records ${raw} points for a resignation; counted as ${points}, which the winner needed to win the match`, W);
          else add('warning', 'V-SCORE', `Game ${g}: the site records ${raw} points for a resignation, which is impossible with the cube at ${cube} (at most ${maxPlausible}); counted as ${points}, the most possible: the real value is unknown`, { ...W, hint: 'If you know the real value (single, gammon or backgammon), add the matching SGF file or correct the "Wins" line.' });
        } else {
          points = raw;
          if (cube > 0 && raw % cube !== 0 && raw !== needed) add('warning', 'V-SCORE', `Game ${g}: a resignation worth ${raw} point(s) does not fit the cube value ${cube}`, W);
        }
      }
      else if (result.how === 'declared') points = decl.points;
      else {
        const wk = winKind(pos, result.winner);
        kind = wk.kind;
        points = cube * wk.mult;
        if (match.rules.jacoby === true && L === 0 && cube === 1 && cubeOwner === null) { points = 1; kind = 'single'; }
      }
      if (decl) {
        const lastMove = game.actions.filter((x) => x.kind === 'move').at(-1);
        if (decl.winner !== result.winner && result.how === 'bearOff' && lastMove && decl.line === lastMove.line) {
          // the Wins cell shares the row of the winning bear-off and takes the free cell: its column says nothing about the winner
          add('info', 'V-RESULT', `Game ${g}: the Wins cell is on the row of the last bear-off, in the other column; the bear-off decides the winner`, W);
          decl.winner = result.winner;
        }
        if (decl.winner !== result.winner) add('error', 'V-SCORE', `Game ${g}: the file says player ${decl.winner + 1} wins but the moves show player ${result.winner + 1}`, W);
        else if (result.how !== 'resign' && decl.points !== points) {
          // some sites cap the points of the last game at what the winner still needs
          const capped = L > 0 && result.how !== 'resign' && points > decl.points && decl.points >= L - score[result.winner];   // what was needed, or the match length
          if (capped) add('info', 'V-SCORE', `Game ${g}: the site counts ${decl.points} point(s) (capped at the match length) instead of ${points}`, W);
          else {
            const agrees = ledger?.clean && ledger.points === decl.points;
            add('error', 'V-SCORE', `Game ${g}: the file says ${decl.points} point(s) but the moves give ${points}${agrees ? `; game ${match.games[gi + 1]?.index ?? gi + 2} starts at ${nextStart.join('-')}, which agrees with the file` : ''}`, { ...W, hint: agrees ? 'The file is consistent with itself, so a play of this game may be missing or misread (or the rules differ): check the moves, gammons, backgammons and the cube value.' : 'Check gammons, backgammons and the cube value.' });
          }
        }
      } else {
        add('warning', 'V-SCORE', `Game ${g}: no declared result in the file`, W);
      }
      game.result = { winner: result.winner, points, kind, how: result.how, cube };
      score = score.slice();
      score[result.winner] += points;
    }
    prevWins = decl && (decl.winner === 0 || decl.winner === 1) ? { winner: decl.winner, points: decl.points } : null;
    delete game.declared;
    game.endPosition = pos;
  });

  for (const d of declared.filter((x) => !x.used)) {
    add('warning', 'V-ILLEGAL', `The source declares an illegal play in game ${d.game}, move ${d.row}${d.player ? ` of ${d.player}` : ''}, but no such play was found`, {});
  }
  match.illegalPlays = illegalPlays;

  // ---- match result
  const last = match.games[match.games.length - 1];
  if (last && last.result) {
    const winner = score[0] > score[1] ? 0 : 1;
    const finished = L === 0 || score[winner] >= L;
    match.result = { winner: finished ? winner : null, score, finished };
    if (partialStart || gaps.length) match.result.partial = { ...(partialStart ? { startScore: partialStart } : {}), ...(gaps.length ? { gaps } : {}) };
    if (L > 0 && !finished) {
      if (matchEndClaim === match.games.length) add('warning', 'V-SCORE', `The file says the match ends with game ${matchEndClaim}, but the score is ${score.join('-')} in a ${L}-point match`, {});
      add('warning', 'V-SCORE', `The match is unfinished (${score.join('-')} in a ${L}-point match)`, {});
    }
  }
  for (const g of match.games) delete g.endPosition;
  if (damaged.length) {
    const games = [...new Set(damaged.map((d) => d.game))];
    add('error', 'V-DAMAGED', `This match is damaged: plays are missing in ${games.length} of ${match.games.length} game(s) (game ${games.join(', ')}). The position after a missing play is not known, so the match cannot be rebuilt and cannot be ingested.`, { hint: 'Ask for another export of the match (the site\'s own export, or an XG file).' });
  }

  const errors = diags.filter((d) => d.severity === 'error');
  return {
    ok: errors.length === 0,
    errors,
    warnings: diags.filter((d) => d.severity === 'warning'),
    infos: diags.filter((d) => d.severity === 'info'),
    match,
    ...(damaged.length ? { damaged: true } : {}),
  };
}

/**
 * The position that an "Illegal play (...)" marker gives, checked against the match and against the plays before it.
 * @returns {{status:'ok', moves:object[]} | {status:'invalid'|'unreachable', message:string}}
 *   invalid     the marker does not belong to this match (names, length, scores, board, dice of the next roll)
 *   unreachable the position is not one play away from the position before it
 */
function resolveMarker(match, game, ai, a, pos, L) {
  const d = a.marker;
  const key = (n) => normalizeName(n ?? '');
  const sideOf = (n) => [0, 1].find((s) => key(match.sides[s].name) === key(n));
  const bad = (message) => ({ status: 'invalid', message });
  const pSide = sideOf(d.names[0]);
  const nSide = sideOf(d.names[1]);
  if (pSide === undefined || nSide === undefined || pSide === nSide) return bad(`the marker names ${d.names.join(' and ')}, who are not the players of this match`);
  if (L > 0 && d.matchLength !== L) return bad(`the marker belongs to a ${d.matchLength}-point match`);
  const scores = [];
  scores[pSide] = d.scores[0];
  scores[nSide] = d.scores[1];
  if (scores[0] !== game.startScore[0] || scores[1] !== game.startScore[1]) return bad(`the marker is for the score ${scores.join('-')}, not ${game.startScore.join('-')}`);
  const after = positionFromDump(d, pSide);
  if (!after || checkPosition(after)) return bad('the board of the marker is not a position of 15 checkers per player');
  const next = game.actions.slice(ai + 1).find((x) => x.kind === 'move' && !x.hidden && !x.marker);
  const sorted = (x) => x.slice().sort((p, q) => q - p).join('');
  if (next && sorted(next.dice) !== sorted(d.dice)) return bad(`the marker says that the next roll is ${d.dice.join('')} but the file has ${next.dice.join('')}`);
  const hits = hitsBetween(pos, after, a.side);
  const moves = hits ? movesBetween(pos, after, a.side, hits) : null;
  const applied = moves ? applyNotated(pos, a.side, moves) : null;
  if (!applied || positionKey(applied.pos) !== positionKey(after)) return { status: 'unreachable', message: 'the position it gives does not follow from the position before it by one play of this player' };
  return { status: 'ok', moves };
}

function fmt(a) {
  return `${a.dice.join('')}: ${a.moves.length ? formatMoves(a.moves) : '(none)'}`;
}
