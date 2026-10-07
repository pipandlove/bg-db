> [bg-db](../../README.md) · [Documentation](../README.md) · BGDB specification, Part I · [Overview](README.md) · [Requirements](requirements.md) · [Terms index](terms-index.md) · [Glossary](glossary.md)

# Indexes

*Indexes* are derived, rebuildable and versioned (P3, P4). Each shard publishes its own; the hub publishes only small global summaries.

## General rules

<a id="IX-01"></a>**[IX-01]** Every index file is listed in the shard’s `manifest.json` with `type`, `version`, `hash`, `size` and `encoding`. Clients MUST skip index types or versions they do not know and fall back to slower strategies.

<a id="IX-02"></a>**[IX-02]** Index files are named by content hash (for example `catalog.3f9a1c.json.gz`) so that they can be cached for ever.

<a id="IX-03"></a>**[IX-03]** Indexes are built by CI on the data repository and deployed with the site. They are never edited by hand and never part of a contributor’s pull request.

## Index families

| **Index**        | **Content**                                                                                                                                   | **Technique**                                                                                                                                       |
|:-----------------|:----------------------------------------------------------------------------------------------------------------------------------------------|:----------------------------------------------------------------------------------------------------------------------------------------------------|
| Catalog          | One compact row per match: id, players, event, date, length, result, flags (analysis, gammon, ...). Sorted by date, split by year when large. | Columnar JSON or binary arrays, gzip. Filters are array scans.                                                                                      |
| Text index       | Players, events, tags, collections.                                                                                                           | *Inverted index* with prefix search (*trie* or \*n\*-grams), *delta encoding* and *variable-length quantity* postings, sharded by first characters. |
| Opening index    | First plies of each game keyed by dice.                                                                                                       | Compact *trie*: answers “what is played after 31?” cheaply.                                                                                         |
| Position index   | Mapping from position key to (match, game, ply).                                                                                              | Zobrist keys sharded by hash prefix; per-shard *Bloom filter* for fast negative answers.                                                            |
| Shard summary    | Date range, length distribution, player filter, event list, counts.                                                                           | Stored in `shard.json`; used to skip shards.                                                                                                        |
| Global directory | Maps player and event identifiers to shard lists.                                                                                             | Small file in the hub, derived from summaries.                                                                                                      |

## Catalog flags

<a id="IX-30"></a>**[IX-30]** The catalog carries one integer of flags per match: 1 = a gammon or backgammon occurred, 2 = the cube was turned, 4 = analysis is known to be available (an analysed SGF), 8 = a game ended by resignation, 16 = an original file (SGF or XG) is attached, 32 = at least one video link, 64 = at least one illegal play was made and is kept as played. Unknown bits MUST be ignored by readers.

## Size control for the position index

Full indexing of every position grows quickly. Policy options, selectable per shard in `shard.json`: index only the first \*N\* plies; only positions with cube decisions; only positions flagged by analysis (errors above a threshold); or everything (“full” tier).

<a id="IX-10"></a>**[IX-10]** The indexed policy MUST be recorded in the shard summary so that the UI can tell users when a position search is partial.

## Evolution

<a id="IX-20"></a>**[IX-20]** A later *derived global index* over sealed shards (generation-based compaction, similar to a *LSM tree*) MAY be added without changing the storage layout; it is announced in the registry as an optional capability.
