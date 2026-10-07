> [bg-db](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0017 - Sealed shards trusted by a digest; replay data derived in the browser

**Status:** accepted

**Context.** The build read and validated every match of every shard each time (about 0.05 s per match: 15 minutes for 20 000), and published, for every match, a replay JSON of about 10 KB next to the 7 KB of the match itself.

**Decision.**
- When a shard is sealed, a **digest of all its files** (`sha256-tree`) is recorded in its `shard.json`. A build recomputes it (reading and hashing files, no parsing) and, if it is unchanged, **trusts the shard**: nothing is parsed. If it differs the build stops and reads every match to name the damage. Only the open shard is read in
  full each time. Shards sealed before this existed are read in full once, with a note, until `bgdb verify --record` records a digest.
- The **replay data is no longer published**. The browser derives it from the match file with the same code as the tools (`readMatch`, `toBgdbJson`), and offers it as a download. This also makes the published site about 2.4 times smaller and takes the
  parse out of the build for good.
- `bgdb verify` is the full check, on demand.

**Consequences.** Building a shard that never changes costs hashing, not parsing (estimated 40 seconds for 20 000 matches, instead of 15 minutes). Trust rests on a digest that is computed once at sealing, from files that were just validated. The page does a little more work when a match is opened (parsing one match takes a few
milliseconds). Programs that want the `bgdb-json` form derive it from the `.mat` (the format is documented) or download it from the match page.
