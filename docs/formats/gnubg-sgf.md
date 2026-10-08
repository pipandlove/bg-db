> [bgdb](../../README.md) · [Documentation](../README.md) · [Formats](README.md)

# GNU Backgammon SGF (`GM[6]`)

One top-level branch per game: `(;FF[4]GM[6]...MI[length:3][game:0][bs:0][ws:0]PB[..]PW[..]RU[Crawford]RE[W+2] ;B[54aelq] ;W[double] ...)`.

- `B` = side 0, `W` = side 1. `MI` carries match length, game number and the scores at the start (`bs`, `ws`).
- A move node is two dice digits followed by letter pairs (from, to). Letters `a`..`x` are indexes 0..23,
  `y` = bar, `z` = off. Coordinates are absolute: black's own point is `24 - index`, white's is `index + 1`.
  (Checked on openings: `B[54aelq]` = 24/20 13/8, `W[55fafahchc]` = 8/3(2) 6/1(2).)
- `double`, `take`, `drop` are nodes of their own; a node with only dice is a roll with no play.
- `RE[W+1R]`: the trailing `R` means the game ended by resignation (no bear-off in the moves).
- Hits are not encoded; the validator recomputes them.

**Analysis.** GNU Backgammon writes its analysis into the same file: `A[...]` (the alternatives considered for a move, with probabilities and equity), `DA[...]` (cube decisions), `GS[...]`, `LU[...]` (luck), `MR[...]`. The parser ignores them for the match itself but detects their presence (`provenance.analysis`, with the engine from `AP[...]`), and ingestion keeps the whole file as an attachment (flag 4 in the catalog). An analysed SGF is about 1.7 KB per move: a 7-point match is several hundred KB, hence the attachment size limit; a compact extraction is planned. Header properties read: `PB`, `PW`, `DT`, `EV` (event), `PC` (place, used as site), `MI`, `RU`, `RE`, `AP`.

Fixtures: [`fixtures/gnubg-sgf/`](../../fixtures/gnubg-sgf) (2 matches from backgammonhub, each with a `.xg`) and [`fixtures/choue-net/`](../../fixtures/choue-net) (a text file and the analysed SGF of the same match).
