> [bgdb](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0006 - Open items before going public

**Status:** open. The items about publishing (1, 2, 7, 9) are settled (2026-10-07): nothing blocks the repository from going public. Items 3 to 6 and 8 are technical. Item 10 (players' names and erasure) is settled by decision 0025 (2026-10-08).

1. ~~Data licence~~ decided: CC0 ([decision 0009](0009-data-licence.md)). Its official legal text is saved as `LICENSE-DATA.txt` (2026-10-07), also in each data repository.
2. ~~Fixtures before going public~~ settled ([decision 0010](0010-privacy-and-anonymisation.md)): names, handles, events and the transcriber in every fixture (`.xg` included) are pseudonyms; ingestion keeps real names (decided). The other people's match records among the fixtures are kept, with their dates blurred (decision 0010, point 3, 2026-10-07). The history was squashed into one commit on 2026-10-07.
3. **Zobrist seed and algorithm** for the position key (spec PK-02): to be fixed before the position index (M6).
4. ~~XGID bar convention~~ confirmed with a real XG string (decision 0004); the beaver bit of field 8 is still unverified.
5. ~~**Jacoby rule in money games**~~ covered (2026-10-08): fixtures `KR-TL_2026-10-08_*` (XG text and `.xg`) hold a backgammon with the cube in the middle, counted 1 with `Jacoby On` and 3 with `Jacoby Off`, and a gammon resigned with an unturned cube (Jacoby off, 2 points). A gammon resigned with an unturned cube under `Jacoby On` needs no test: it is worth a single game, and eXtreme Gammon does not even offer it.
6. **Hash length**: 16 hex characters (64 bits); CI must detect collisions (ID-04).
7. ~~Name of the project and repositories~~ decided (2026-10-07): the project and its tools repository are `bgdb`, the data repositories `bgdb-data-1`, `bgdb-data-2`, ... Renamed on 2026-10-08 from `bg-db`, `bg-db-data-1`, ... to `bgdb`, `bgdb-data-1`, ...: one spelling for the project, its command (`bgdb`) and its configuration (`bgdb.config.json`). GitHub redirects the old repository addresses, but not the Pages sites, nor the reusable workflows: data repositories call the tools from tag `v10` on.
8. **Analysis**: reading the analysis of `.sgf` and `.xg` files, reconciling both, normalising it to rank players and show errors: proposed in [decision 0026](0026-analysis-reading-and-normalising.md) (2026-10-08).
9. ~~Actions pinned to commit hashes~~ done (2026-10-07, spec SC-04): every action of the workflows names a commit hash, with its version in a comment, so that
   a changed tag of an action cannot change what runs; `scripts/workflows.test.js` checks it. How to update a pin: [contributing-flow.md](../contributing-flow.md#safety-why-two-workflows).
10. ~~Players' names and erasure~~ decided (2026-10-08, [decision 0025](0025-online-players-otb-names-and-erasure.md)): online players under pseudonyms made with each contributor's key, real names for a match declared over the board, `bgdb erase` with a list of erased matches, a "Remove a match" issue form. The `bgdb-data-1` history was cleaned by deleting and recreating the repository (2026-10-08). The answers of the platforms' forums are still awaited.
