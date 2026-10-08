> [bgdb](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0005 - How input dialects and quirks are handled

**Status:** accepted

**Context.** The eleven text fixtures come from four sources and use three `.mat` dialects plus SGF.

**Decision.**
- One tolerant `.mat` parser reads all dialects; the dialect is only recorded in provenance. The parser builds the
  logical model and does not judge legality.
- `validate.js` replays every game from the opening position and is the single source of truth for correctness.
  Notation is never trusted: hits are recomputed, the order of sub-moves is free, and the final position must be
  one of the legal outcomes of the roll (including the "play as many dice as possible / the larger die" rules).
- Known site habits are accepted and reported at the lowest sufficient severity: capped final-game points
  (`info`), the hidden-play resignation `????` / `???` with an inflated `Wins N point` (`info` when the match result is unaffected, `warning` when the value had to be estimated), missing resignation marker
  (`warning`). Anything that makes the replay impossible is an `error` with a code, a line and a hint.
  (The marker was first misread as damage, then as a separate "forfeit" and as a played backgammon; the file's owner pointed out that it is always a
  **resignation**, and that a value above 3 x cube is impossible. There is one concept, `how: resign`.)
- Unsupported input (XG binary) is refused with an explanation, never silently ignored.

**Consequences.** New sources usually only need a small parser tweak and a fixture. The error paths are tested
by tampering with valid fixtures (an illegal move, a wrong score, a hidden play that is not last).
