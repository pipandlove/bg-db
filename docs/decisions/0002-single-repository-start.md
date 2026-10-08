> [bgdb](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0002 - Start with a single repository; shards are folders

**Status:** accepted

**Context.** Spec section 5 allows several topologies. Cross-repository CI, tokens and CORS add work with no
benefit before there is data.

**Decision.** `bgdb` holds tooling, site, docs, `inbox/` and `data/0001/`. The registry and `shard.json` already use
a `base` location, so moving sealed shards to a second repository (`bgdb-data`) later changes only `base`.

**Update.** The specification once called the two-repository topology (T2) "recommended"; the wording now says that T1 is the start and T2 the destination. The practical procedure for the move, what already works and what is still to be built are in [docs/growing.md](../growing.md).

**Update (2026-10-06).** The next step is decided: tools and site stay in `bgdb`, the data moves to a series of data repositories ([decision 0024](0024-data-repositories.md)). Done on 2026-10-07: `bgdb` keeps no data.

**Consequences.** No cross-repo setup now. The first limit to watch is the size of the published site
(about 1 GB on GitHub Pages). Match identifiers never contain a location (ST-12).
