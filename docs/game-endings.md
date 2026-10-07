> [bg-db](../README.md) · [Documentation](README.md)

# How a game ends when nobody bears off or drops

Sites record a resignation in many ways. The checker does not have a rule for each of them: it reads the end of every game in three layers
([decision 0019](decisions/0019-game-endings-body-tail-settlement.md)). Terms: **LP** and **RP** are the players of the left and right column; **WXP** is the `Wins N points` line.

| What the file shows at the end of the game | Layer | What the checker does | Diagnostic |
|---|---|---|---|
| plays done correctly, then a WXP | body | normal: the WXP gives the points | none (or `V-RESULT` "ends without a bear-off or drop; treated as a resignation" when the format never writes a marker) |
| the roll of a player, dice only, then a WXP | tail | the roll is kept, nothing was played; the WXP settles who won | `V-RESULT` info "rolled 16 and played nothing, and the game stops there" |
| the roll with only some of the plays | tail | kept as written | `V-RESULT` info "played only 22/16" |
| the roll with moves that make no sense (a checker that is not there, a die that was not rolled) | tail | the moves are dropped; the game is still a resignation | `V-RESULT` **warning** "is not a possible play: it is ignored" |
| the WXP written like a move (a numbered row, in either column) | parser | read as a WXP: the column is the winner | none |
| `00:` (nothing rolled), with or without `????` | tail | the same as a hidden play; **the WXP says who gave up** | none (info if it names the player of that slot as the winner) |
| `????` after real dice | tail | a hidden play: that player gave up | none |
| a numbered row (`23)`) with nothing on it | parser | skipped | none |
| an empty slot after the game is already over (bear-off, drop, tail) | tail | ignored | none |
| a double that nobody answers, then the doubler's WXP | settlement | a drop | `V-RESULT` info |

**The rule for the tail:** it is the *last roll of the game*, followed only by empty slots, in a game that a WXP settles. Anywhere else a wrong play is still an error, and without a WXP the same roll is an error
("the file may be cut off"). The roller can be either player (a resignation can come in the middle of the opponent's turn).

**The ledger.** The WXP is machine generated, so it is never overridden: it is checked against the score at the start of the next game, and "and the match" at the end of the file.
In the text fixtures, 131 of 133 pairs of consecutive games agree; the 2 that do not are in the one excerpt (games are missing from that file, [decision 0020](decisions/0020-excerpts-lost-games-and-missing-plays.md)). So:
- a WXP that disagrees with the next game's score is an **error** (unless the start score only moves forward: then games are missing, a warning, and the start score is trusted), reported once on the next game's start score, with the WXP of the previous game named: the file was probably edited or cut;
- a bear-off or drop whose points differ from our reading of the moves is an **error**; if the next game's score agrees with the WXP, the message says so (a play may be missing or misread);
- the next game's score is used only to **fill in** the points of a resignation that has no WXP at all (a hidden play ends the game and nothing else is written), when only the winner's score moved.

**Identity.** The tail is not part of a match's identity, like a hidden play. Whatever the site wrote in the last slot of a resigned game, the match keeps the same identifier. The normalised `.mat` writes the
roll (if there is one) followed by `Resigned Game` and the WXP, and reads back to the same match.

Examples in the fixtures: [`game-ends-play-cut-after-one-die`](../fixtures/extmatchdb/game-ends-play-cut-after-one-die.mat) (a play cut after one die, twice), [`game-ends-dice-without-play_17pt`](../fixtures/extmatchdb/game-ends-dice-without-play_17pt.txt) (dice and nothing played, twice),
[`hidden-play-and-empty-rows_13pt`](../fixtures/extmatchdb/hidden-play-and-empty-rows_13pt.txt) (`00: ????`, WXP in the left column as a row of its own, empty rows). The tests that pin all of this are `packages/core/test/endings.test.js`
and `repairs.test.js`; one of them takes every resignation of every text fixture and checks that a junk tail changes neither the result nor the identity.

## Endings written by older transcriptions

- **The winner's last bear-off is hidden** (`44: ???` under the player who is bearing off, and `Wins` under that same player). A hidden play is normally the roller's
  resignation; here the file says the roller wins. When the roll bears off every checker left, the play is known (all 15 are off), so it is read as the final bear-off
  (info `V-RESULT`) and is part of the identity. Otherwise it stays a contradiction.
- **`Wins` on the row of the last bear-off** (`53) 55: 1/0 1/0 1/0      Wins 2 points`): the cell takes the free column, which says nothing about the winner; the bear-off decides.
- **Points capped in the last game**: some sites write the match length (or what the winner needed) instead of a larger gammon or backgammon value. Accepted with an
  info when the declared value still wins the match.
- **A hidden play in the middle of a game** (`64: ???` and the game goes on) leaves the position unknown: `V-DAMAGED`, like a missing play (decision 0020).

