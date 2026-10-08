> [bgdb](../../README.md) · [Documentation](../README.md) · [Formats](README.md)

# eXtreme Gammon text export

Produced by XG's *export as text*. Examples: [`fixtures/xg-text/`](../../fixtures/xg-text) (3 money games against the
bot "XG Roller+", each with a `.xg` twin in [`fixtures/xg-binary/`](../../fixtures/xg-binary)).

- **Header tags:** `Site "eXtreme Gammon"`, `Match ID` (can be negative), `Player 1`, `Player 2`, `Player 1 Elo "2262.00/400"`
  (rating / number of games, kept as `rating` and `experience` on the side), `EventDate`, `EventTime`, `Variation`,
  `Unrated`, `Jacoby`, `Beaver`, `CubeLimit`. `Crawford` is absent in money games.
- **Money game:** the line `0 point match`. Jacoby and beaver flags are read from the tags. With Jacoby on, a gammon
  or backgammon only counts when the cube has been turned (implemented in `validate.js`; the three fixtures end by a
  drop or a resignation, so a natural-ending gammon with an unturned cube is not covered by a real file yet).
- **Columns:** the left column is the human (`Player 2` in the tags) and `Player 1` is on the right: the tags
  do not give the column order, the score line does (`me : 0   XG Roller+ : 0`).
- **Notation:** `Bar/20` (capital B), `(n)` repeat counts, hit star, `Cannot Move`, chained plays without the
  intermediate points (`44: 22/6`). Doubles: `Doubles => 2` with `Takes` / `Drops` in the other column.
- **Resignation:** nothing is written except the `Wins N point` line; a game that stops while the winner still has
  checkers on the board is a resignation, and `N` is the value (here 4 = cube 2 x gammon).
- **Money-game scores:** a single game, so the match result is just that game's points.

## The same format in the extmatchdb database

Files downloaded from extmatchdb use this export with: an **empty `Site ""` tag** (recognised through the Elo tags; the same holds for tournament files with a site name of their own, e.g. `Grand Hotel`, plus a `Transcriber` tag that is ignored), **CRLF**
line endings, trailing spaces in tag values (trimmed), **tournament** data (`Event`, `Round`), matches to 11 points, and `???` in
place of the play of a player who concedes: `65: ???` followed by `Wins 2 point` for the opponent. The value written is the value
conceded (cube 4 -> `4 point`, a gammon conceded at cube 1 -> `2 point`), so it is kept as the points of the game (a resignation). A long left cell can touch the right cell (`11: 15/14 14/13 13/12 12/11 33: 3/0 3/0 3/0 3/0`); `3/0` is a checker
borne off from the 3 point. Fixture: [`fixtures/extmatchdb/`](../../fixtures/extmatchdb).
