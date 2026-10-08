> [bgdb](../../README.md) · [Documentation](../README.md) · BGDB specification, Part I · [Overview](README.md) · [Requirements](requirements.md) · [Terms index](terms-index.md) · [Glossary](glossary.md)

# Glossary

Links point to external explanations at the time of writing; they should be re-checked periodically. Terms defined by the project itself are marked *(project term)*.

- **Backgammon**: Two-player board game of dice and strategy; the domain of the database.

  *Sources:* [Wikipedia: Backgammon](https://en.wikipedia.org/wiki/Backgammon)

- **Bloom filter**: Compact probabilistic set that answers “definitely not present” or “possibly present”; used to skip shards or files quickly.

  *Sources:* [Wikipedia: Bloom filter](https://en.wikipedia.org/wiki/Bloom_filter)

- **Cache API**: Browser API for storing request/response pairs, used by service workers to cache files.

  *Sources:* [MDN: Cache](https://developer.mozilla.org/en-US/docs/Web/API/Cache)

- **CC BY**: Creative Commons licence allowing reuse with attribution.

  *Sources:* [Creative Commons: CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

- **CC0**: Creative Commons public-domain dedication, removing restrictions as far as the law allows. The licence of the BGDB data.

  *Sources:* [Creative Commons: CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)

- **CORS**: Cross-Origin Resource Sharing: HTTP mechanism letting a page load resources from another origin.

  *Sources:* [MDN: CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)

- **Crawford rule**: Match rule: when a player first reaches one point from winning, the doubling cube may not be used for the next game.

  *Sources:* [Wikipedia: Backgammon](https://en.wikipedia.org/wiki/Backgammon)

- **Delta encoding**: Storing differences between consecutive sorted values instead of the values themselves; makes posting lists small.

  *Sources:* [Wikipedia: Delta encoding](https://en.wikipedia.org/wiki/Delta_encoding)

- **DecompressionStream**: Browser API for streaming decompression (gzip, deflate) without extra libraries.

  *Sources:* [MDN: DecompressionStream](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream)

- **Doubling cube**: Die marked 2–64 used to raise the stake of a game; its value and owner are part of a position.

  *Sources:* [Wikipedia: Backgammon](https://en.wikipedia.org/wiki/Backgammon)

- **git-filter-repo**: Tool to rewrite or extract git history, for example to move a folder to a new repository with its history.

  *Sources:* [git-filter-repo repository](https://github.com/newren/git-filter-repo)

- **GitHub Actions**: Workflow automation of GitHub, used for validation, ingestion and index building.

  *Sources:* [GitHub Docs: Actions](https://docs.github.com/en/actions)

- **GitHub Pages**: Static site hosting from a GitHub repository.

  *Sources:* [GitHub Docs: Pages](https://docs.github.com/en/pages)

- **GNU Backgammon**: Free backgammon program and analysis engine; defines the Position ID and Match ID formats.

  *Sources:* [GNU Backgammon](https://www.gnu.org/software/gnubg/), [manual](https://www.gnu.org/software/gnubg/manual/)

- **GNUBGID**: GNU Backgammon identifier: a position ID (80 bits, 14 base-64 characters) and a match ID (66 bits, 12 characters) separated by a colon.

  *Sources:* [GNU Backgammon manual (appendix on IDs)](https://www.gnu.org/software/gnubg/manual/)

- **IndexedDB**: Browser database for structured data of significant size.

  *Sources:* [MDN: IndexedDB API](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)

- **Indexes**: Derived search structures (catalog, text, opening, position) built from shards. *(project term, [§7](07-indexes.md))*
- **Ingestion**: Post-merge process that normalizes inbox files, assigns identifiers and places them into the open shard. *(project term, [§10](10-contribution.md))*
- **Inverted index**: Mapping from terms to the list of records containing them; the basis of text search.

  *Sources:* [Wikipedia: Inverted index](https://en.wikipedia.org/wiki/Inverted_index)

- **Jacoby rule**: Money-game rule: gammons and backgammons count only if the cube has been turned.

  *Sources:* [Wikipedia: Backgammon](https://en.wikipedia.org/wiki/Backgammon)

- **Jellyfish MAT**: Widespread plain-text format for backgammon matches, produced by the Jellyfish program and supported by many tools, including GNU Backgammon and eXtreme Gammon.

  *Sources:* [GNU Backgammon manual (import/export)](https://www.gnu.org/software/gnubg/manual/)

- **JSON Schema**: Vocabulary for validating the structure of JSON documents.

  *Sources:* [json-schema.org](https://json-schema.org/)

- **LSM tree**: Log-structured merge tree: write-friendly structure of immutable sorted levels merged over time; a model for generation-based index compaction.

  *Sources:* [Wikipedia: LSM tree](https://en.wikipedia.org/wiki/Log-structured_merge-tree)

- **OPFS**: Origin Private File System: fast, private file storage in the browser, suited to large binary data.

  *Sources:* [MDN: OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system)

- **Overlay**: Small versioned file applied over sealed shards to hide, patch or regroup records without rewriting them. *(project term, [§5](05-storage.md))*
- **Pip count**: Total number of pips a player needs to bring all checkers home and off; a standard measure of race standing.

  *Sources:* [Wikipedia: Backgammon](https://en.wikipedia.org/wiki/Backgammon)

- **Provenance**: Record of the origin and handling of data (source, contributor, importer, rights).

  *Sources:* [W3C: PROV overview](https://www.w3.org/TR/prov-overview/)

- **Pull request**: GitHub mechanism proposing changes from a branch or fork for review and merge; the growth path of the database.

  *Sources:* [GitHub Docs: Pull requests](https://docs.github.com/en/pull-requests)

- **Registry**: Single JSON file listing all shards, their locations, status and policies. *(project term, [§5](05-storage.md))*
- **Semantic versioning**: Version numbering scheme (major.minor.patch) with compatibility meaning.

  *Sources:* [semver.org](https://semver.org/)

- **Serialization profile**: A way of writing the logical model as files (for example `mat+meta`, `bgdb-json`). *(project term)*
- **Service Worker**: Browser script that intercepts network requests, enabling caching and offline use.

  *Sources:* [MDN: Service Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)

- **SHA-256**: Cryptographic hash function from the SHA-2 family, used to derive content identifiers.

  *Sources:* [Wikipedia: SHA-2](https://en.wikipedia.org/wiki/SHA-2)

- **Shard**: Bounded, self-contained group of matches with its own metadata, files and indexes; open until sealed, then immutable. *(project term, [§5](05-storage.md))*
- **Static site**: Website made of fixed files served as they are, without server-side computation.

  *Sources:* [Wikipedia: Static web page](https://en.wikipedia.org/wiki/Static_web_page)

- **Storage binding**: Mapping from logical entities and profiles to locations (registry, base, relative paths). *(project term)*
- **Trie**: Prefix tree enabling fast prefix lookups, used for type-ahead search and opening sequences.

  *Sources:* [Wikipedia: Trie](https://en.wikipedia.org/wiki/Trie)

- **Unicode normalization**: Canonical forms of Unicode text (NFC, NFD) so equal strings compare equal.

  *Sources:* [Unicode Standard Annex 15](https://unicode.org/reports/tr15/)

- **Variable-length quantity**: Integer encoding using fewer bytes for small values; used in compact posting lists.

  *Sources:* [Wikipedia: Variable-length quantity](https://en.wikipedia.org/wiki/Variable-length_quantity)

- **Web Worker**: Background thread for browser scripts, keeping the interface responsive during heavy work.

  *Sources:* [MDN: Web Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)

- **BroadcastChannel**: Browser API for messaging between tabs or workers of the same origin.

  *Sources:* [MDN: BroadcastChannel](https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel)

- **XG**: eXtreme Gammon: backgammon analysis program and its proprietary file format; its position ID format is XGID.

  *Sources:* [eXtreme Gammon](https://www.extremegammon.com/)

- **XGID**: Compact text identifier of a backgammon position (checkers, cube, dice, score, match settings) defined for eXtreme Gammon.

  *Sources:* [XGID specification](https://www.extremegammon.com/xgid.aspx)

- **Zobrist hash**: Hashing technique for board positions using XOR of random numbers assigned to (point, count) features; enables position lookup.

  *Sources:* [Wikipedia: Zobrist hashing](https://en.wikipedia.org/wiki/Zobrist_hashing)
