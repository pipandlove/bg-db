> [bg-db](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0008 - Catalog format and deterministic builds

**Status:** accepted for catalog version 1

**Context.** The site must filter a large list of matches quickly (spec 7.2) and sealed shards must never need re-downloading
(spec CL-02, CL-03).

**Decision.** The catalog is columnar JSON with dictionaries for players and events, gzip-compressed, named by the hash of the
stored bytes; the manifest lists it with size and SHA-256. `build` is deterministic (no timestamps, sorted output, normalised gzip
header). The catalog is built from the sidecar metadata, while every `.mat` is parsed and checked again during the build, so a damaged
or edited match file stops the build.

**Consequences.** Re-running the build gives the same bytes; browsers and CDNs can keep a sealed shard's files forever.
JSON is easy to inspect and fast enough for tens of thousands of rows per shard; a binary encoding can replace it later through the
`version` field and the manifest `type`/`version`, with no change to the layout. The whole `data/` folder is read at each build
(O(number of matches)); incremental builds are possible later because sealed shards never change.
