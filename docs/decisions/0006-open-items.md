> [bg-db](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0006 - Open items before going public

**Status:** open. The items about publishing (1, 2, 7, 9) are settled (2026-10-07): nothing blocks the repository from going public. Items 3 to 6 and 8 are technical. Item 10 (players' names and erasure, 2026-10-08) is open and bears on what is published.

1. ~~Data licence~~ decided: CC0 ([decision 0009](0009-data-licence.md)). Its official legal text is saved as `LICENSE-DATA.txt` (2026-10-07), also in each data repository.
2. ~~Fixtures before going public~~ settled ([decision 0010](0010-privacy-and-anonymisation.md)): names, handles, events and the transcriber in every fixture (`.xg` included) are pseudonyms; ingestion keeps real names (decided). The other people's match records among the fixtures are kept, with their dates blurred (decision 0010, point 3, 2026-10-07). The history was squashed into one commit on 2026-10-07.
3. **Zobrist seed and algorithm** for the position key (spec PK-02): to be fixed before the position index (M6).
4. ~~XGID bar convention~~ confirmed with a real XG string (decision 0004); the beaver bit of field 8 is still unverified.
5. **Jacoby rule in money games**: implemented when the file says `Jacoby On` and exercised by three XG money games, but none ends by a bear-off with an unturned cube and a gammon. A resignation file with an unturned cube would also help.
6. **Hash length**: 16 hex characters (64 bits); CI must detect collisions (ID-04).
7. ~~Name of the project and repositories~~ decided (2026-10-07): the project and its tools repository are `bg-db`, the data repositories `bg-db-data-1`, `bg-db-data-2`, ...
8. **`.xg` reader**: worth doing only if the analysis data is wanted (spec LM-03, RP-04).
9. ~~Actions pinned to commit hashes~~ done (2026-10-07, spec SC-04): every action of the workflows names a commit hash, with its version in a comment, so that
   a changed tag of an action cannot change what runs; `scripts/workflows.test.js` checks it. How to update a pin: [contributing-flow.md](../contributing-flow.md#safety-why-two-workflows).
10. **Players' names and erasure** (2026-10-08): online handles under pseudonyms, real names over the board, `bgdb erase`, and the clean-up of the `bg-db-data-1` history. Proposed, undecided: [decision 0025](0025-online-players-otb-names-and-erasure.md).
