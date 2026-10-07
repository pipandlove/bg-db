> [bg-db](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0003 - Canonical content and match identifier

**Status:** accepted for canonical version 1 (resolves open question Q1 of the spec for the match hash)

**Context.** The identity must not change with names, dates, notation style or the order of players in the file
(spec ID-02, ID-03), and must detect the same match coming from different sites.

**Decision.** `canonicalContent(match)` (`packages/core/src/identity.js`) is the JSON array
`[1, matchLength, [game...]]`; each game is `[startScore, [action...]]`. Actions: `['m', side, dice, position]` for a
play, `['d', side, cube]`, `['t', side]`, `['p', side]` (drop). Dice are sorted descending. `position` is the position
reached after the play (own-perspective counts for both sides, bar and off included), so the order of sub-moves,
`bar` vs `25`, `(2)` vs repeated entries and chains such as `24/18/15` all give the same hash. Sides are relabelled
A/B with A = the player who rolled first in game 1. The identifier is the first 16 hex characters of the SHA-256
of that JSON; the full digest is available as `contentHash`.

**Consequences.** The same match from two sources has one identity; renaming a player does not change it.
Two plays reaching the same position from different notation are equal (fine for replay purposes). The hash does
not include rules flags such as Jacoby or beaver, comments or analysis. The version number `1` inside the content
allows a future change of definition (old identifiers stay valid because they are stored). Resignations: the
resignation itself is not an action, so a match that ends by resignation has the same content as the same moves
without the resignation; the result lives in metadata. The same holds for a hidden-play resignation (`????`): the hidden
play (`66: ????`) is dropped from the content (tested).
