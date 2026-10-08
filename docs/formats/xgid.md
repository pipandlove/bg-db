> [bgdb](../../README.md) · [Documentation](../README.md) · [Formats](README.md)

# XGID

`XGID=<board26>:<cubeExp>:<cubeOwner>:<turn>:<dice>:<score1>:<score2>:<crawford>:<length>:<maxCubeExp>`

Implemented in `packages/core/src/xgid.js`. Conventions used (see
[decision 0004](../decisions/0004-xgid-conventions.md)): the board is written from the active player's
perspective; index 1..24 are points 1..24; index 0 is the opponent's bar (lowercase), index 25 the active
player's bar (uppercase); `A..O` / `a..o` are 1..15 checkers; the cube is a power-of-two exponent (`0` = cube
at 1); off counts are derived. Start position: `XGID=-b----E-C---eE---c-e----B-:0:0:1:00:0:0:0:0:10` (tested).

The board can be written from either player's view; `turn` (`1` or `-1`) says who is on roll. Field 8 is the
Crawford flag in a match and the Jacoby flag in a money game. A real export with two checkers on the bar,
`XGID=b-A-BaC-D---cB---bBcbb--A-:0:0:-1:52:0:0:1:0:10`, is a test case: the lowercase side has 2 checkers on index 0,
is on roll with 52, and the only legal play enters both and hits the blot on point 2.

Note: `specification_of_the_XGID.pdf` (project file) says index 0 can never hold lowercase letters. The real format
shows otherwise; follow this page and [decision 0004](../decisions/0004-xgid-conventions.md).
