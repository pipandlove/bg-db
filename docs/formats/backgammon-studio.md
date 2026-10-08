> [bgdb](../../README.md) · [Documentation](../README.md) · [Formats](README.md)

# Backgammon Studio `.mat` / `.txt`

Header: `Site "Backgammon Studio"`, `Match ID`, `Event`, `Round`, `Player 1/2`, `EventDate`, `EventTime`,
`Unrated`, `Crawford`, `CubeLimit`, `ClockType`. Score line has a space before the colon (`tester : 0`).
Notation uses words and counts: `bar/20`, `6/off`, `13/7(2)`, hit star `*`, `Cannot Move`. `Takes`/`Drops` can share
the row of the double (`Doubles => 2 / Takes`). `Wins 2 point` appears in the winner's cell on the final row.
Seen both as `.mat` and as `.txt` (same content).

A game that a player resigns (or abandons) is written as `66: ????` in the abandoning player's
column and `Wins 2008 point` in the winner's: the large number is a sentinel, not a real score (see
[the quirks list](README.md)).

Fixtures: [`fixtures/backgammon-studio/`](../../fixtures/backgammon-studio) (3 files; the Bluejay match ends with the
resignation marker `????`).
