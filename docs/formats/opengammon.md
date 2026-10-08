> [bgdb](../../README.md) · [Documentation](../README.md) · [Formats](README.md)

# OpenGammon `.mat`

Header tags: `Site "OpenGammon"`, `Match ID`, `EventDate "2026.09.30"`, `EventTime "06:20"`, `Player 1/2`, `Variation`,
`Crawford`, `Jacoby`, `Beaver`, `Cubelimit`. Rows are written with a wide fixed column layout (right cell about
column 46). Bar is `25`, bearing off is `0` (`6/0`). A play lists one entry per checker (`13/11 13/11`), never `(2)`.
A roll with no legal move is `66:` with nothing after the colon. `Wins N points` is written in the winner's column
on its own line; the last game's value is capped at the points still needed.

Fixtures: [`fixtures/opengammon/`](../../fixtures/opengammon) (4 matches; two of them have a matching `.xg` in
[`fixtures/xg-binary/`](../../fixtures/xg-binary)).
