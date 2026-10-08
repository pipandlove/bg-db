> [bgdb](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0004 - XGID conventions

**Status:** accepted; confirmed by a real eXtreme Gammon export (the bar convention). Two smaller points remain to verify.

**Context.** The PDF in the project (`specification_of_the_XGID.pdf`) differs from the real format in several places,
and the existing `xgid.js` already works around some of them.

**Decision.**
1. The cube field is a power-of-two exponent (`0` = 1, `1` = 2, `2` = 4), not the face value.
2. The board string has index 0 and 25 for the bars: index 0 = the lowercase side's bar, index 25 = the uppercase
   side's bar. The case of the letter decides whose bar it is, so index 0 may hold either case. The borne-off
   count is not stored (15 minus checkers on board and bar).
   **Confirmed** by `XGID=b-A-BaC-D---cB---bBcbb--A-:0:0:-1:52:0:0:1:0:10`: two lowercase checkers on index 0,
   consistent with the PDF being wrong on its validation rule 3 ("index 0 cannot contain lowercase letters").
3. The board can be written from either player's view; `turn` says who is on roll (`1` = the uppercase side,
   `-1` = the lowercase side). In the example above the lowercase side is on the bar and on roll with 52, so the
   board is not flipped. `toXGID` writes from the side on roll (turn = 1) by default and accepts
   `perspective` to reproduce XG's own output exactly (tested character for character).
4. Dice are written highest first; `00` means not rolled.
5. Field 8 is the Crawford flag in a match. In a money game (length `0`) the same bit is read as the **Jacoby**
   flag (as in the example above, where it is `1`).

**To verify.** (a) Whether the bit value `2` of field 8 means "beaver" in money games (not decoded; the bit is ignored).
(b) A position with a checker borne off, to confirm that the count is never written (the derivation is already
tested for self-consistency).
