> [bgdb](../../README.md) · [Documentation](../README.md) · [Formats](README.md)

# The `Illegal play (...)` marker

In some text exports (eXtreme Gammon's, and sites that reuse it), a play that could not be exported is replaced by the words `Illegal play` and a dump in parentheses, in the cell of the player who made it:

```
10) 11: Illegal play (15;0;1;0;0;Morley;Tanguay;0;9;9;1;0;0;0;0;2;2;2;2;0;2;0;1;0;-2;0;0;-3;0;-4;0;-3;2;-1;0;2;-2;0;1;6;) 16: 8/2 10/9
```

The layout was **decoded from two real files** (Tanguay vs Morley, Dixon vs Zanders) and every field that is read was checked against the match it comes from. Reader: `packages/core/src/illegal-dump.js`.

| Value | Meaning | Status |
|---|---|---|
| 0 | match length | read, must equal the match's |
| 1-4 | four flags (`0;1;0;0` in both files) | not interpreted |
| 5, 6 | names; the first is the "positive" player of the board | read, must be the players of the match |
| 7 | `0` | not interpreted |
| 8, 9 | scores at the start of the game, in the order of the names | read, must equal the game's start score |
| 10 | looks like the cube value (1 in both files, equal to the cube there) | **not used** |
| 11 | `0` | not interpreted |
| 12-37 | the board **after the play**: 26 values; 0 = bar of the second player (negative), 1..24 = points seen from the first player (positive = its checkers, negative = the other's), 25 = bar of the first player; checkers not on the board are borne off | read |
| 38, 39 | dice of the **next** roll | read, must equal the next roll of the file |

The dump holds a position, not a play: **what was moved is not in it**.

## What the checker does with it

1. **Checks the marker belongs here**: names, match length, start score, a board of 15 + 15 checkers, the next roll. Otherwise an error says which.
2. **Mid-game** (the position before the play is known): the position must be one play away: the roller's checkers only moved forward, the opponent only lost checkers to the bar where a blot was hit. A notation that reaches exactly that position is built (`11: 14/10 11/10(2)`): it is *a* way to reach it, not necessarily the real moves. If a legal play reaches the position, the play is treated as legal (info); otherwise it is an illegal play kept as played (warning, listed like a declared one, decision 0013). The game then goes on from that position. If the position cannot be reached by one play, it is an error.
3. **First play of a game** and the position far from the opening position: the plays before it are lost. The game is kept by its result only (decision 0020).

In the normalised `.mat` the rebuilt play is written with an `IllegalPlay` tag; the dump is not copied.

## Evidence (Tanguay vs Morley, game 12, move 10)

- The opponent's checkers in the dump equal the replayed position exactly; Tanguay's need a 6-pip play with a 1-1 roll.
- The last two values (`1;6`) are the next roll in the file; in the other file (`6;6`) too.
- Two rows later Tanguay plays `10/9`: a checker that exists only in the dump's position.
- None of the 80 legal results of 1-1 lets the rest of the game replay: the play really was illegal (`excerpts.test.js`).

## Not known

Other layouts (a different XG version), the four flags, and markers where the play hits a blot have no real sample yet: a marker of another layout is refused with a V-FORMAT error.
