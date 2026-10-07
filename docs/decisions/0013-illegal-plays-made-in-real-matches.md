> [bg-db](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0013 - Illegal plays made in real matches are kept as played, when declared

**Status:** accepted

**Context.** In professional play an illegal play can be made and stand (not called by the opponent, or forced to stand once the next roll is played). A transcriber then records
what happened and adds a remark; the Cup 2022 final file has `Game 6, Move 19 of Simon Lockwood --> 11: 3/2 1/Off(2) was illegal` (a 1-1 played with three of the four dice, although
the fourth could be played). The validator rejected the whole match. But the match did continue from that position, and a database of real matches must hold what happened.

**Decision.**
- Legality stays the default: an illegal play is an error, because in nearly every file it is a typo, and the validator is what catches typos.
- It becomes acceptable only when **declared by the source**: the transcriber's remarks box (parsed for `Game N, Move M [of Player] --> ... was illegal`), or an `illegal` entry in the
  contribution's `.bgdb.json`. Matching is by game number, printed row number and, optionally, player. This keeps the decision with the person who transcribed the match.
- A declared play is accepted as played if it can be carried out mechanically; later plays are checked from the resulting position. It is flagged everywhere (metadata, replay data,
  catalog flag 64, `has:illegal`, a note on the match page) and reported as a `V-ILLEGAL` warning.
- Declarations that match nothing, or a legal play, are reported and otherwise ignored.
- The normalised file writes `Remark` and `IllegalPlay` tags, with its own row numbers, so that the read-back check passes and the information survives re-ingestion.

**Consequences.** Real matches with forced illegal plays can be stored, and the replay (M4) can show the play with a marker instead of silently replaying it as legal. The cost is one more
thing for a transcriber to declare; without the declaration the match is still refused, with a hint explaining how. The match identity includes the illegal play (it is part of the game),
so a "corrected" transcription is a different match. Not covered yet: illegal cube actions and other rule breaches (they remain errors), and SGF files (no row numbers to declare against).
