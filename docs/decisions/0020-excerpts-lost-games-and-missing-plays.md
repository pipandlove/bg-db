> [bgdb](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0020 - Excerpts, lost games, and plays that are missing

**Status:** accepted

**Context.** Four real files that failed validation, each for a different reason: a 21-point match of which a transcriber kept four games (the score does not follow from game to game); a last game destroyed
down to a marker and two rows; an `Illegal play (...)` in the middle of a game; a match where plays are blank although they were possible. They look alike (the checker stops) but call for different answers.

**Decision.**

1. **Excerpts.** The score at the start of each game is **trusted**. When a game starts at a score that is higher than where the previous game ended (both scores can only go forward) and below the
   match length, games are missing between them: accepted with a `V-PARTIAL` warning that names the previous `Wins` line, recorded in `result.partial.gaps` (each gap names the game after it by its number in the file; the normalised `.mat` keeps these numbers, fixed on 2026-10-06: it renumbered the games, so an excerpt numbered 1, 2, 6 was stored in a state the build refused), and shown as "an excerpt" on the match page. The Crawford game
   after a gap is inferred like at the start of a fragment. A score that goes backwards, or reaches the match length, stays an error.
   *Price:* a `Wins` line that is too small, in a file that is meant to be contiguous, is now read as "games missing". The warning says so and names the line. Evidence: in the 27 text fixtures, 131 of 133 pairs of
   consecutive games agree (decision 0019); the 2 that do not are in the one excerpt. This supersedes the claim of 0019 that a disagreement is always an error.
2. **The marker is a position, not an error.** `Illegal play (...)` gives the position after the play (docs/formats/illegal-play-marker.md). It is verified against the match, the play is rebuilt as a notation that
   reaches it, and the game goes on. It is flagged illegal only if no legal play reaches the position.
3. **A game whose plays are lost is kept by its result.** When the first play of a game is a marker for a position that the opening cannot reach, the plays are not in the file. The game has no plays, `resultOnly`, and the declared
   winner and points; the result is part of the identity (it is all there is). It is declared in the normalised `.mat` (`; [ResultOnly "Game 13"]`), so an empty game is never confused with a cut file. A game with no plays and a `Wins`
   line that is not declared stays what it was: a resignation before the first roll.
4. **A play that is missing makes a match damaged.** A roll written with no play although a play was possible (and not the last roll of a settled game, which is a tail, decision 0019) leaves the position unknown:
   error `V-DAMAGED`, one per game and a summary, the result of the check is flagged `damaged`, `check` prints `DAMAGED`, and the file stays in the inbox with a report that says it cannot be repaired. A wrong play (a typo) is not damage: it stays `V-LEGAL`.

**Why damaged, and not rebuilt.** Rebuilding is a search for the histories in which every written play stays legal (`node scripts/completions.mjs <file>`). It is feasible, and sometimes unique, but the match needs
a single identity: the position after every play is part of it. On the real file (ouzelbird vs albatros) the games have 2, 1, 1, 1, 350 and 1 258 histories: games 2, 3 and 4 could be rebuilt, the match as a whole
(880 600 histories) cannot. A guess would make the identity depend on the order in which candidates are tried.

**Consequences.** Ingesting the readable part of a damaged file is done by decision 0021 (`--salvage`: the broken game is kept by its confirmed result, not rebuilt). A hidden play (`???`, `Illegal play` without a dump) followed by more moves is damaged too, and the running score of a money session that jumps forward is an excerpt like a match's (updates of 2026-10-06). Not done: replaying the surviving rows of a lost game from the marker's position (the normalised `.mat` cannot express a
start position); markers of other layouts.
