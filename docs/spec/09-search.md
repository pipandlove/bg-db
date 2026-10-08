> [bgdb](../../README.md) · [Documentation](../README.md) · BGDB specification, Part I · [Overview](README.md) · [Requirements](requirements.md) · [Terms index](terms-index.md) · [Glossary](glossary.md)

# Search

## Query model

Search combines a free-text part and structured filters (facets). All queries are serializable in the URL fragment (for example `#q=player:smith year:2019..2024 len:7`) so that a result list can be shared.

| **Filter**                      | **Meaning**                                                       |
|:--------------------------------|:------------------------------------------------------------------|
| `player:`                       | Matches where a player (any alias) took part; `vs:` for the pair. |
| `event:`, `collection:`, `tag:` | Context filters.                                                  |
| `year:`, `date:`                | Single year or range; a day or a month, or a range of them.       |
| `len:`                          | Match length (`0` for money games).                               |
| `result:`                       | Winner, gammon or backgammon present.                             |
| `score:`                        | Match score reached (for example 2-away/2-away).                  |
| `hasAnalysis:`, `maxError:`     | Analysis availability and thresholds.                             |
| `pos:`                          | Exact position (XGID or GNUBGID), optionally with cube state.     |
| `opening:`                      | Opening roll and play.                                            |

## Implemented so far (M3)

`player:` (also `vs:`; two players mean a match between them), `event:`, `round:`, `year:`, `date:` (a day, a month or a range), `len:` (with `money`), `has:` (`cube`, `gammon`, `resign`, `analysis`, `attachment`, `video`, `illegal`, matching catalog flags
2, 1, 8, 4, 16, 32, 64) and bare words; suggestions for players and events; the query in the URL fragment. See [site.md](../site.md) for the syntax. The other filters of the table are still to do.

## Behaviour and budgets

<a id="SE-01"></a>**[SE-01]** Type-ahead suggestions for players and events appear within 100 ms of a keystroke once the text index shard is loaded.

<a id="SE-02"></a>**[SE-02]** Filtering the catalog returns the first page of results within 200 ms on a mid-range laptop for a catalog of 100 000 matches.

<a id="SE-03"></a>**[SE-03]** Results are paginated lazily and sorted by relevance, date or length; identical queries give identical order.

<a id="SE-04"></a>**[SE-04]** A position search fetches at most the shards whose summaries or filters can contain the key, and reports which shards were consulted.

<a id="SE-05"></a>**[SE-05]** Search is case- and accent-insensitive; player aliases (from overlays) are expanded transparently.

<a id="SE-07"></a>**[SE-07]** Every part of a query that is not understood is reported to the user in plain words; it is never silently dropped. The query is part of the URL, so that a result list can be shared.

<a id="SE-06"></a>**[SE-06]** First-load budget (informative target): catalog ≤ 3 MB compressed for 100 000 matches; subsequent visits download only changed files.
