> [bgdb](../../README.md) · [Documentation](../README.md) · Formats

# Input formats

Written from the real files in [`fixtures/`](../../fixtures). Every dialect below parses and validates.

| Format | Origin | Notation of bar / off | Repeated moves | Doubles shown as | Parser |
|---|---|---|---|---|---|
| [OpenGammon `.mat`](opengammon.md) | opengammon site | `25` / `0` | one entry per checker | `Doubles => 2`, `Takes`, `Drops` | `mat.js` |
| [Foxamon `.mat`](foxamon.md) | foxamon site | `25` / `0` | one entry per checker | same | `mat.js` |
| [Backgammon Studio `.mat` / `.txt`](backgammon-studio.md) | backgammonstudio site | `bar` / `off` | `(n)` | same | `mat.js` |
| [eXtreme Gammon text](xg-text.md) (also the extmatchdb files) | XG "export as text" | `Bar` / `off` | `(n)` | same | `mat.js` |
| choue.net `.txt` (+ `.sgf` with analysis) | choue.net site | `bar` / `off` | `(n)` | `Doubles ==> 2` | `mat.js` |
| BackgammonGalaxy `.txt` | backgammongalaxy site | `Bar` / `Off` | `(n)` | same | `mat.js` |
| [GNU Backgammon SGF](gnubg-sgf.md) | gnubg, backgammonhub | `y` / `z` | letters | `double`, `take`, `drop` nodes | `sgf.js` |
| [XG binary `.xg`](xg-binary.md) | eXtreme Gammon | n/a (binary) | n/a | n/a | `xg.js`, `inflate.js` |
| [XGID](xgid.md), [GNUBGID](gnubgid.md) | position identifiers | | | | `xgid.js`, `gnubgid.js` |

Stored and published forms (what ingestion writes and the site reads): [shard, metadata and index files](shard-and-index.md).

## Common structure of the three `.mat` dialects

```
; [Key "Value"]             header tags (Site, Match ID, Player 1, Player 2, EventDate, Crawford, ...)
5 point match

 Game 1
 name1 : 0        name2 : 0           score line: left player = Player 1 = side 0, right = side 1
  1) 61: 13/7 8/7      43: 24/20 13/10   row number, left cell, right cell
```

- A cell belongs to the left or right player according to its horizontal position, compared with the position
  of the right player's name in the score line (`mat.js`, "Column logic").
- An empty left cell on row 1 means the right player rolled first.
- The left column is always side 0, whatever the `Player 1` / `Player 2` tags say (eXtreme Gammon lists its own
  `Player 2` on the left).
- Cells: a roll with its moves (`63: 24/18 13/10`), a roll that cannot be played (`34:` or `Cannot Move`),
  `Doubles => N`, `Takes`, `Drops`, `Wins N point(s) [and the match]`, `Resigned Game|Match`.
- Both players write moves from their **own** perspective (24 = their back point, 1 = their ace point).
- Sequence, not alternation, drives reading: a double in one cell is answered in a cell of the other column
  (same row in Backgammon Studio's `Doubles => 2 / Takes`, next row elsewhere), then the doubler rolls.

## How the dialect is recognised

By the `Site` tag (`OpenGammon`, `Foxamon`, `Backgammon Studio`, `eXtreme Gammon`, `BackgammonGalaxy`, `choue.net`, our own `bgdb`), otherwise by the presence of
`Player 1 Elo` / `Player 2 Elo` tags (an XG export with its own site name: extmatchdb database, tournaments), otherwise `generic`. The dialect is only recorded
in the match's provenance; it changes the severity of one diagnostic (a resignation without marker is an `info` for XG text and BackgammonGalaxy). Tags the
parser does not use (`Transcriber`, `ClockType`, `Unrated`, ...) are ignored and not stored.

## Quirks handled (each has a test or a fixture)

- **Capped points.** OpenGammon and Foxamon write the points needed to win the match, not the real value
  (a gammon at cube 4 in a 3-point match is "3 points and the match"). Reported as an `info` diagnostic.
- **Resignation markers.** `Resigned Game` / `Resigned Match` sit in the winner's column; the winner is taken from
  the `Wins` line. One OpenGammon file ends without any marker; it is accepted with a `V-RESULT` warning.
  eXtreme Gammon's text export never writes a marker, so there the same situation is only an `info`. A resignation
  value is checked against the cube (it must be 1, 2 or 3 times the cube).
- **Cells are cut at their first word, not at the gaps.** A cell starts at a roll (`63:`) or a keyword (`Doubles`, `Takes`,
  `Drops`, `Wins`, `Resigned`); the column of that start decides the side. In some exports a long left cell touches the
  right cell with a single space (`... 12/11 33: 3/0 ...`). Numbered rows with nothing in them and CRLF line endings are accepted.
  A tab inside a row is expanded to the next 8-column stop, as an editor shows it: some transcribers aligned the right column with a tab,
  which would otherwise move the right player's play into the left column.
- **`Doubles ==> 2`** (two equals signs, choue.net) is read like `Doubles => 2`. Score lines without a space before the colon (`Bot1: 0`) and games without a leading space are accepted.
- **`0/0` for a die with nothing to move** (the last checker is already off: `21: 2/0 0/0`) is ignored. Elsewhere the legality check still requires every die that can be played.
- **Other exporters' layouts** (seen in a collection of 3 000 tournament files):
  - the right column is found from the rows themselves (the most common start of a second cell): some XG exports pad the score line wider than the rows, and a
    row whose left cell is empty (the first roll belongs to the right player) was read as the left player's;
  - a box above `N point match` without the leading `;` (`+----+`, `|  Monte Carlo 1993  |`) is kept as remarks;
  - `Wins 1 point and the      Match` (any spacing, any case); `Losses N point` (the loser's side of a `Wins` line) is ignored;
  - `Resign normal`, `Resign gammon`, `Resign backgammon` mark a resignation like `Resigned Game`;
  - cells on a line without a row number (`      Drops      Wins 1 point`);
  - `31: Illegal play` without a dump: the play is not known, like `???`.
- **`; Set Pos=<XGID board>/n`** (XG: "the position here is ..."). It is checked against the position the moves reach: the opening position, or the position
  already reached, is accepted; any other position is refused (a game that starts from a set position, or a jump), never replayed from the opening.
  In the four real files checked, the uppercase checkers are the **left** player of the score line, whatever the `/0` or `/1` suffix says (its meaning is not known),
  and from that position every play is legal. Supporting such games is on the roadmap (fixture `fixtures/invalid/set-position-start_11pt.mat`).
- **Encoding.** A text file is read as UTF-8 when it is valid UTF-8 (with or without a byte order mark), as UTF-16 when it starts with a UTF-16 byte order mark, and otherwise as **Windows-1252** (older Windows exports and tournament archives: `Sürmeyan`, `François`, curly quotes); an info says so. The stored normalised `.mat` is always UTF-8. `bgdb anonymize` rewrites a file byte for byte, so it keeps its encoding.
- **Chained plays without intermediate points** (`44: 22/6` for four steps of 4) are accepted; hits are recomputed.
- **Hidden play = resignation (Backgammon Studio, extmatchdb/XG, choue.net).** A player who gives up is recorded as a roll whose play is
  hidden (`66: ????` or `65: ???`), followed by `Wins N point` for the opponent. The parser reads it as a hidden play that ends the game
  by **resignation** (the winner is the other player); it must be the last action of the game and is not part of the match identity.
  The number N is **not always believable**: a resignation concedes a single game, a gammon or a backgammon, so it is at most 3 times the
  cube. Larger values are cut to the most possible (3 x cube), or to what the winner needs to finish the match, and reported:
  `Wins 2008 point` (Backgammon Studio, cube 2, winner needs 2: counted 2, an `info`), `Wins 4 point` with the cube in the middle
  (choue.net: counted 3, a `warning` because the real value is unknown; the analysed SGF of the same match says `B+3R`).

## Illegal plays made in real matches

In a real match an illegal play can be made and stand: the opponent does not call it, or the rules force it to stand once the next roll has been played. A transcription
then contains a play that the rules engine rejects, and that must not be "corrected": the match really went on from there. The policy (decision 0013):

- **`00:` = nothing rolled (Backgammon Studio).** The slot of a player who resigned instead of rolling, often written `00: ????`. It is read as a hidden play, and the `Wins` line says who gave up. How the end of a game is read in general: [game endings](../game-endings.md).
- A play that is not legal is an **error** (`V-LEGAL`), because it is almost always a typo. It becomes acceptable **only when the source declares it**.
- **Declaring it.** Either the transcriber's remarks box in the file header, in the form used by the extmatchdb database:

  ```
  ; +------------------------------------------------------------------+
  ; |  Remarks:                                                        |
  ; |      Game 6, Move 19 of Simon Lockwood --> 11: 3/2 1/Off(2) was illegal   |
  ; +------------------------------------------------------------------+
  ```

  or an `illegal` entry in the `name.bgdb.json` file next to the match: `{"illegal": [{"game": 6, "row": 19, "player": "Simon Lockwood"}]}`.
  *Game* is the game number, *Move* (or `row`) is the printed row number of that game, and the player says which of the two cells of the row (optional).
- A declared play is **accepted as played**: the checkers are moved as written (they must exist and the points must not be blocked) and the following plays are checked from the
  resulting position. It is kept in the metadata (`illegalPlays`), flagged in the replay data (`i: 1` on the action) and in the catalog (flag 64, `has:illegal`), and a `V-ILLEGAL`
  **warning** says so.
- A declaration that matches no play, or a play that is in fact legal, is reported (`V-ILLEGAL`) and has no other effect. A declared play that cannot even be carried out
  mechanically (no checker on the starting point, a blocked target) stays an error.
- The transcriber's remarks are kept as text (at most 20 lines of 300 characters) and shown on the match page. The normalised file writes them as `; [Remark "..."]`, and the
  illegal plays as `; [IllegalPlay "Game 6, Move 19 of Simon Lockwood"]` with the row numbers of the normalised file itself.
- **`Illegal play (...)` (XG text and sites that reuse it).** A play that could not be exported, with the position after it: [illegal-play-marker.md](illegal-play-marker.md).
