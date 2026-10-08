> [bgdb](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0010 - Privacy: anonymised match IDs, handles kept

**Status:** accepted; its rule on names ("ingestion keeps player names and handles") is superseded by [decision 0025](0025-online-players-otb-names-and-erasure.md) (2026-10-08): real names over the board, pseudonyms online. Every player of a match sent from the Contribute page gets a pseudonym computed with the contributor's key, unless the contributor declares the match played over the board; a data repository refuses other names (`"names": "pseudonyms"`, `V-HANDLE`); a match can be erased (`bgdb erase`). The tools themselves keep the names they are given (`"names": "as-is"`, the default), which the fixtures rule below still governs.

**Context.** Real match files carry identifiers that point back to a site's records (`Match ID`), player handles, sometimes real names (tournament
transcripts), and a `Transcriber` credit. The project owner decided that **match identifiers may be anonymised and handles do not need to be**.

**Decision.**
- The site `Match ID` is never stored in the database: ingestion drops it and the normalised `.mat` does not contain it.
- `bgdb anonymize` replaces the `; [Match ID "..."]` value by `anonymized` in text files (dry run by default, `--check` for a pre-release gate). All text
  fixtures were rewritten this way, and the fixtures whose file names were the site identifier (the four OpenGammon files and their `.xg` twins) were renamed to
  `<player>_vs_<player>_<date>`. The match identity is unaffected (tested).
- **Ingestion keeps player names and handles as they are**: searching the matches of a player is a purpose of the database. A person who wants a name removed uses the takedown path (spec RP-03).
- **Test fixtures carry no real names** (update of 2026-10-05). Every player name, handle, tournament event, venue and transcriber in `fixtures/` was replaced by a pseudonym
  of the same length (so column alignment in text files and fixed-width fields in `.xg` files are unchanged), consistently across files, so twins (`.txt`/`.sgf`/`.xg`) still
  match. Bots (`XG Roller+`, `Bot1`) and software site names (used to detect the dialect) were kept. The `.xg` files were rewritten too: the names in the header and in
  the first record of each compressed file were replaced, each file recompressed, and the archive index (sizes, offsets, CRC32) and trailer CRC recomputed. Every file
  still gives the same match identity. The mapping to the real names is not kept in the repository. A new fixture must be anonymised the same way before it is committed; for an `.xg` file, `node scripts/xg-rename.mjs --map <names.json> <file.xg> --write` does it (the mapping file must live outside the repository).

**Open points before the repository goes public.**
1. ~~The binary `.xg` fixtures~~: rewritten with pseudonyms (see above).
2. ~~Real names in the tournament fixtures and the `Transcriber` tag~~: replaced by pseudonyms (see above).
3. ~~Rights to publish other people's tournament transcripts~~ decided (2026-10-07): **kept**. The 16 records of other people's matches (`fixtures/extmatchdb/`,
   and `set-position-start_11pt.mat` and `damaged-missing-plays_ouzelbird-albatros_9pt.txt` in `fixtures/invalid/`) stay in the public repository as test fixtures:
   the dice and moves of a game are facts, every name, event, venue and transcriber is a pseudonym, and 16 records are a very small extract of the database they
   came from. What could lead back to the source was blurred: dates are 1 January of the same year, times `12.00` (or `11.00`, to keep the order of two matches
   of one day), a timestamp was removed from a file name, ratings rounded, and a real video link replaced by a neutral one. Match identities are unchanged
   (they depend on the positions only). The project owner made this choice; it is not legal advice, and a takedown request (spec RP-03) would be honoured.
4. ~~Git history~~: squashed into one commit on 2026-10-07, after the last real handle was replaced (below), so no earlier version of a fixture is kept.

**Update (2026-10-07).** One `.xg` fixture (`2026-01-20T15-36-47-bluetailedgrebe1-tester.xg`) still held a real handle in a second name field of its records,
which the reader does not show (the text twin did not have it): replaced by the pseudonym `kittiwake` with `scripts/xg-rename.mjs`, identity unchanged. To check an
`.xg` file, list the readable strings of every compressed stream inside it, not only what `bgdb check` shows.
