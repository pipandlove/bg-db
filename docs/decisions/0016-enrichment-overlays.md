> [bgdb](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0016 - Enrichment as an overlay applied by the client

**Status:** accepted

**Context.** Matches get a video, an analysed SGF or tags after they were stored, often after their shard was sealed (or moved to another repository). Sealed shards must not be edited (their files are named by hash, cached for ever,
and protected by a digest), and the spec already foresees overlays for corrections (section 5.4).

**Decision.**
- An enrichment is a small record outside the shard: `data/enrichments/<shard>/<h2>/<hash>.json`, with attachment files next to it. One record per match; later additions are merged into it (links and tags are added if new; at most one SGF and one XG file per match, counting the match's own).
- `bgdb build` publishes all records as **one overlay file** named by its hash, listed in the registry, plus the attachment files. The **browser applies it**: flags of the rows change (`has:video`, `has:analysis`, the tags) and the match page merges the additions. Applying it in the browser, rather than rewriting catalogs, is what makes it work
  for sealed shards, for shards of other repositories, and without changing a byte of what is published for a shard (tested).
- Ways in: `bgdb enrich <id> ...`, or an ordinary contribution: a duplicate that brings something new enriches the existing match instead of being skipped (so a contributor, or the pull-request bot, needs no new concept). The review reports it as "will add ... to it".
- An SGF is verified against the match it enriches; an XG file is kept unverified, as for a new match.

**Consequences.** No sealed shard is ever edited, and enrichments need no special permission. The overlay is one more small file to load (gzip, a few hundred bytes per enriched match). Corrections that *replace* data (a wrong date, a withdrawn match) are not enrichments: they need the
patch and tombstone overlays of spec section 5.4, still to build, which can use the same mechanism.

**Update (2026-10-06).** Corrections of the event, round and date are now part of the enrichment record (`meta`), applied by the same
code ([decision 0022](0022-event-round-from-headers-and-file-names.md)). Tombstones (withdrawing a match) are still to build.
