> [bgdb](../../README.md) · [Documentation](../README.md) · [Formats](README.md)

# XG binary (`.xg`)

eXtreme Gammon's proprietary file. It starts with the magic `RGMH` and contains the match **with XG's analysis**, which is why it is 10-20x larger than the
text export. The publisher does not document it: the layout below was **reverse-engineered from the nine fixtures that have a text twin** and is checked
against them (`packages/core/test/xg.test.js`: each `.xg` must give the very same match, with the same identity hash, as its text version).
The reader is `packages/core/src/xg.js` (it uses `inflate.js`, a small synchronous inflate, so it works in the browser and in Node without a dependency).

## Layout

- A header (`RGMH`, a few fields, UTF-16 strings such as "Played on eXtreme Gammon"), then **zlib streams** (a byte `0x78` followed by `01`, `5e`, `9c` or `da`).
  The biggest stream whose size is a multiple of 2 560 and whose first record has type 0 is the match; the others (a 5 120-byte one and a 1 064-byte one) are not read.
- The main stream is a list of **records of 2 560 bytes**. The type is the byte at offset 8. All integers are little-endian int32.

| Type | Record | Fields read (offsets in the record) |
|---|---|---|
| 0 | match header | player 1 and 2: Pascal strings at 9 and 50; match length: int32 at 92 (`99999` = money game); Crawford, Jacoby, beaver: bytes 100, 101, 102; date and time: Delphi `TDateTime` (double, days since 1899-12-30) at 128; site: Pascal string at 283 |
| 1 | game header | score at the start: int32 at 12 and 16; game number: int32 at 48 |
| 2 | cube record | one per turn, even when nobody doubles. Player: int32 at 12; doubled: int32 at 16 (1 = yes); answer, in the same record: int32 at 20 (0 = pass, 1 = take). Other values (beaver, raccoon) are refused |
| 3 | move record | one per roll. Player: int32 at 64 (1 or -1); up to four steps as eight int32 from 68 (from, to pairs; 0-based points, 24 = bar, -1 as `to` = off, -1 as `from` ends the list); dice: int32 at 100 and 104 |
| 4 | game footer | winner: int32 at 24 (1 or -1); points: int32 at 28; how it ended: int32 at 32 (0 cube dropped, 1 single, 2 gammon, 3 backgammon, 100 + n resigned) |
| 5 | match footer | not read |

Player 1 (the first name, `ActiveP` = 1) is side 0 of the model. A chained step such as `13/7/4` is written by XG as two steps, so the reader gives the same
moves as the text.

**Analysis** (equities, errors, rollouts) is **not read**: the file is kept as an attachment. The reader only detects whether the cube records hold
plausible single-precision numbers from offset 124, which sets `analysis.present`. The analysis display (M6) needs these records too.

## What the reader refuses, with a sentence

- A file saved **in the middle of a game** (the last game has no footer, or a roll with all steps at zero): "the file was saved in the middle of a game, and a game that is not finished cannot be kept". The fixture [`fixtures/invalid/xg-saved-in-the-middle-of-a-game.xg`](../../fixtures/invalid/xg-saved-in-the-middle-of-a-game.xg) is this case; `bgdb check --recursive` skips folders named `invalid`.
- A beaver or a raccoon, a match length or dice that are not credible, a file with no readable main stream (another version of XG): `V-FORMAT`, with the advice to export the match as text.

## Container and renaming names

Around the match stream, the file is an archive: the `RGMH` header (8 232 bytes, with UTF-16 strings such as the game title) and a JPEG thumbnail, then the
zlib-compressed files (the match, `temp.xg`, and a copy of its header, `temp.xgi`), a compressed index of 532-byte records (uncompressed size, compressed size, start
and CRC32 of each file) and a 36-byte trailer (CRC32 of the archive and the index, file count, sizes). `scripts/xg-rename.mjs` uses this to replace player names
(header, and the first record of each file) and rebuild the index and trailer, so that a fixture can be anonymised (decision 0010).

## Use in the database

An `.xg` is read like any other format: **alone it is the match** (its identifier is the same as its text export's), next to a text file or an SGF of the same match it is
verified against it and kept as a verified attachment, and `bgdb enrich --xg` does the same for a match already in the database. Because of the licence caveat in spec
requirement RP-04, check the rights before redistributing analysis produced by XG.

What is **not** known yet: files from other versions of XG, rollout and match-equity data inside the records, and the games of a file that holds several matches.
