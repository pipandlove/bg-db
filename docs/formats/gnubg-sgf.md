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

**Analysis.** GNU Backgammon writes its analysis into the same file: `A[...]` (the alternatives considered for a move, with probabilities and equity), `DA[...]` (cube decisions), `GS[...]`, `LU[...]` (luck), `MR[...]`. The parser ignores them for the match itself but detects their presence (`provenance.analysis`, with the engine from `AP[...]`), and ingestion keeps the whole file as an attachment (flag 4 in the catalog). `sgfAnalysis` (`packages/core/src/analysis.js`, [decision 0026](../decisions/0026-analysis-reading-and-normalising.md)) reads them decision by decision. An analysed SGF is about 1.7 KB per move: a 7-point match is several hundred KB, hence the attachment size limit; a compact extraction is planned. Header properties read: `PB`, `PW`, `DT`, `EV` (event), `PC` (place, used as site), `MI`, `RU`, `RE`, `AP`.

How the analysis is written (gnubg 1.08, checked against its own totals):

| Property | On | Content |
|---|---|---|
| `A[i][move E ver 3 p1 p2 p3 p4 p5 eq ctx]...` | a move node | the candidates, best first, `i` = the one played; `eq` = cubeful equity in EMG, so the error is `eq` of the first minus `eq` of the played one; `ctx` = `3C 0 1 0.000000 1` (plies counted from 0, `C` = cubeful). The move filter leaves a lone candidate at a lower depth: the depth of an analysis is its deepest evaluation. A node with one candidate is a forced play |
| `DA[E ver 3 ctx 14 numbers]` | a move node (before the roll), `double`, `take`/`drop` | the cube decision of the player who may double: 5 probabilities, cubeless equity, cubeful value for no double, then the same for double/take. In a match, cubeful values are match winning chances: they are put in EMG with the match equity table (`met.js`, Kazaross XG2, gnubg's default) as gnubg does: `(2 mwc - (win + lose)) / (win - lose)`, so that double/pass is 1 |
| `GS[M:...][C:...][D:...]` | each game's root | gnubg's summary of that game: `M` = unforced and total moves, moves by mark, checker error (EMG then MWC) of player 0 then 1; `C` = cube counts, then six kinds of cube error, EMG then MWC, all of player 0 then all of player 1. Its player 0 is `W` |
| `BM`, `DO`, `BC`, `DC`, `GB`, `LU` | | gnubg's marks (bad, doubtful, bad cube, doubtful cube, good) and the luck of the roll: not read |

To analyse a match the way the fixtures were (gnubg's "World class", 2-ply, the same depth as XG 3-ply), from a shell: `gnubg -t -q < script`, where the script is

```
set analysis chequerplay evaluation plies 2
set analysis chequerplay evaluation cubeful on
set analysis chequerplay evaluation prune on
set analysis chequerplay evaluation noise 0
set analysis cubedecision evaluation plies 2
set analysis cubedecision evaluation cubeful on
set analysis cubedecision evaluation prune on
set analysis cubedecision evaluation noise 0
load match match.sgf
analyse match
save match analysed.sgf
```

(`import mat match.mat` instead of `load match` for a text file.) It gives the very same file as the menus.

Fixtures: [`fixtures/gnubg-sgf/`](../../fixtures/gnubg-sgf) (2 matches from backgammonhub, each with a `.xg`), [`fixtures/gnubg-analysis/`](../../fixtures/gnubg-analysis) (the same 2 matches analysed by gnubg at 2-ply and at 3-ply: with the `.xg`, each match has three analyses) and [`fixtures/choue-net/`](../../fixtures/choue-net) (a text file and the analysed SGF of the same match).
