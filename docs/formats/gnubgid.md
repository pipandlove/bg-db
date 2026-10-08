> [bgdb](../../README.md) · [Documentation](../README.md) · [Formats](README.md)

# GNU Backgammon ID

`<PositionID, 14 chars>:<MatchID, 12 chars>`; implemented in `packages/core/src/gnubgid.js`.
Position ID: 80 bits, the player not on roll first, then the player on roll; each of 25 zones is written as one
1-bit per checker followed by a 0-bit; bits are packed least-significant-bit first and written in Base64 without
padding. Match ID: 66 bits of little-endian fields (cube, owner, player on roll, Crawford, state, dice, match
length, scores). Verified against GNU Backgammon's start position: `4HPwATDgc/ABMA:cAkAAAAAAAAA` (tested).
