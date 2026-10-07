> [bg-db](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0018 - Moving shards to another repository: external shards and hash files

**Status:** accepted

**Context.** The plan (decision 0002, [growing.md](../growing.md)) is to start with one repository and to move sealed shards to a data repository when the size limits come near. Three things must survive the move: links, duplicate detection, and the ability to enrich.

**Decision.**
- The registry already addresses a shard by its `base`: an **external shard** is a sealed shard listed in `externalShards` of `bgdb.config.json` with an **absolute** `base`; the build lists it and does not copy it; the browser loads it from there (the other site must send the CORS header, which GitHub Pages does).
- **Hash files**: `data/hashes/<shard>.tsv` (content hash and id of each match) stays in the hub when a shard leaves, and `ingest`, `review` and `enrich` read it: duplicates of moved matches are still recognised and enrichable.
- **`bgdb split`** does the move in one verified step: verify the shard (and record its digest), write the hash file, copy the shard, optionally remove it here and write the configuration entry. It refuses an open shard.
- The **open shard and `inbox/` stay in the hub**: contributors never meet the second repository. Enrichments stay in the hub too, and the browser applies them to matches of any shard.
- The configuration entries are checked when read (a wrong one would break the site for everybody).

**Update (2026-10-06).** [Decision 0024](0024-data-repositories.md) replaces the hub that keeps the open shard and `inbox/`: each data repository takes the contributions while it is current, so a match is stored in the history of one repository only. External entries, hash files and `bgdb split` stay; hash files are what a new data repository receives from the previous ones.

**Consequences.** Moving a shard is reversible (copy back, remove the entry and the hash file). The data repository needs the same tools to publish its own files and a Pages workflow (a copy of the hub's; not written yet). Duplicate detection across repositories relies on the hash file being committed: the command says so.
