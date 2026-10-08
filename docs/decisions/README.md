> [bgdb](../../README.md) · [Documentation](../README.md) · Decisions

# Decision records

Short notes that record why a choice was made, so that it can be revisited with the context in hand.
Format: context, decision, consequences. Status: accepted / proposed / superseded.

| # | Title | Status |
|---|---|---|
| [0001](0001-plain-javascript.md) | Plain JavaScript, no dependencies, no build step | accepted |
| [0002](0002-single-repository-start.md) | Start with a single repository; shards are folders | accepted |
| [0003](0003-canonical-match-hash.md) | Canonical content and match identifier | accepted (v1) |
| [0004](0004-xgid-conventions.md) | XGID conventions | accepted, bar convention confirmed |
| [0005](0005-input-dialects.md) | How input dialects and quirks are handled | accepted |
| [0006](0006-open-items.md) | Open items before going public | open |
| [0007](0007-normalised-mat-and-sidecar.md) | Normalised MAT plus JSON sidecar as the stored form | accepted |
| [0008](0008-catalog-and-determinism.md) | Catalog format and deterministic builds | accepted |
| [0009](0009-data-licence.md) | Data licence: CC0 | accepted |
| [0011](0011-attachments-and-links.md) | Contribution groups, attachments and video links | accepted |
| [0012](0012-static-site-structure.md) | Static site: no framework, shared core code, URL-fragment state | accepted |
| [0016](0016-enrichment-overlays.md) | Enrichment as an overlay applied by the client | accepted |
| [0017](0017-trusted-sealed-shards-and-derived-replay.md) | Sealed shards trusted by a digest; replay data derived in the browser | accepted |
| [0018](0018-external-shards-and-hash-files.md) | Moving shards to another repository: external shards and hash files | accepted |
| [0015](0015-contribution-loop.md) | The contribution loop: one shared check, two workflows for pull requests, data-only | accepted |
| [0014](0014-replay-design.md) | Replay: the position before the play, arrows and ghosts | accepted |
| [0013](0013-illegal-plays-made-in-real-matches.md) | Illegal plays made in real matches are kept as played, when declared | accepted |
| [0010](0010-privacy-and-anonymisation.md) | Privacy: anonymised match IDs, handles kept | accepted |
| [0025](0025-online-players-otb-names-and-erasure.md) | Online players under pseudonyms (a key per contributor, rewritten before upload), real names over the board, `bgdb erase` | proposed, undecided |
| [0024](0024-data-repositories.md) | Tools and site in one repository, data in a series of data repositories (`bgdb-data-1`, `-2`, ...): warn, stop, switch by hand | accepted, built |
| [0023](0023-transcriptions-of-one-match.md) | Transcriptions of one match: recognised by their rolls, the better file kept (`superseded`), a person chooses between two valid copies (`near-duplicate`, `reject`) | accepted |
| [0022](0022-event-round-from-headers-and-file-names.md) | Event and round: headers cleaned automatically, file names reviewed (`bgdb meta`), corrections as enrichments | accepted |
| [0021](0021-salvaging-archive-files.md) | Partial matches: unreadable games kept by their confirmed result, added only with consent (`--salvage`, `"accept": "partial"`) | accepted |
| [0020](0020-excerpts-lost-games-and-missing-plays.md) | Excerpts (gaps), lost games, plays that are missing (damaged files) | accepted |
| [0019](0019-game-endings-body-tail-settlement.md) | How a game ends: body, tail, settlement (the Wins line against the ledger) | accepted |
