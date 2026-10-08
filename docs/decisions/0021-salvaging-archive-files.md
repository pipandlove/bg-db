> [bgdb](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0021 - Salvaging old archive files: keep what is clear

**Status:** accepted (2026-10-06)

**Context.** A dry run over a collection of 3 144 tournament files (most of them old matches) refused 209 files. Reading the
exporters' layouts better rescued about 50 (docs/formats/README.md, docs/game-endings.md) and five typos had a single correction (a
typo is corrected only when exactly one legal play makes the game valid). Most of the others hold one or a few games whose moves
cannot be read: a mistyped play that several corrections fit (an earlier play was mistyped into another legal play), plays that are
missing, a game that starts from a set position. In those files 81% of the games are readable, and the result of a broken game is
usually written twice: by its `Wins` line, and by the start score of the next game (or the end of the match).

These matches are kept mostly for their historical interest. A viewer can enjoy and understand a partial match when the score is known
before every readable game and the winner of the match is known; a corrupted game offers nothing to replay.

**Decision.**
1. **A partial match is added only with consent.** A maintainer importing an archive gives it for every file (`bgdb ingest --salvage`).
   A contributor gives it for one match (`"accept": "partial"` in its `.bgdb.json`; a box on the Contribute page and in the issue form),
   after seeing the errors (to fix the file instead), what would be kept and the `.mat` that would be stored (downloaded from the page,
   shown in the bot's comment, or written by `bgdb check --salvage --out`). Without consent the match is not added (`PARTIAL` in
   `ingest`, verdict `needs-confirmation` in the review) and nothing else changes.
2. **Match play.** A game whose moves cannot be read (an impossible or missing play, a wrong turn, a cube error, a set position) is kept
   **by its result only** when its `Wins` line gives the result and a second source confirms it (the start score of the next game, or
   the end of the match): the match stays complete, with its real final score, and the result enters the identity, as for the lost
   games of decision 0020. Without a confirmed result the game is **left out**, and the next game starts from the score its file
   gives (an excerpt, decision 0020). The **winner of the match must stay known**; otherwise the file is refused.
3. **Money sessions.** Unreadable games are left out, with a note; there is no score to follow.
4. A file that stops in the middle of its last game (no result and no `Wins` line) keeps its complete games.
5. **Never salvaged:** a score or a winner that contradicts the file (the score lines against the results, the cube against the
   points): which part is wrong is not known. At least one readable game must remain.
6. Every game left out or kept by its result is reported (`V-PARTIAL`), with the error that made it unreadable. Messages use the game
   numbers of the file, since games may be left out.

**Alternatives.** Leaving every broken game out (simpler, but the match loses its real final score and shows gaps where the result is
known); a threshold such as "at least half of the games readable" (it does not say whether the viewer can follow the match: the
score story does); choosing the correction closest to what is written (rejected: the stored moves and the identity could be wrong).

**Consequences.** On that collection, 100 of the 153 files still refused after the reading fixes were kept, with 130 games kept by
their result; 53 stay refused (32 because a score or a winner contradicts the file). A salvaged match and a later complete
transcription of it have different identities; since decision 0023 the complete copy is kept and the salvaged one superseded when both
are in the inbox (a stored salvaged match stays until tombstones exist). The
normalised `.mat` declares the games kept by their result (`; [ResultOnly "Game 6"]`), so it reads back as the same match without
salvage. Supersedes the "not done" of decision 0020 about ingesting the readable part of a damaged file (by result, not by rebuilding).

**Update (2026-10-06).** Contributions: salvage was first reserved to archive imports. It is now offered to contributors, with the
consent and the preview described in point 1 (spec VA-05, MP-05, FB-01).

