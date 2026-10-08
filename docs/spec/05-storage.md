> [bgdb](../../README.md) · [Documentation](../README.md) · BGDB specification, Part I · [Overview](README.md) · [Requirements](requirements.md) · [Terms index](terms-index.md) · [Glossary](glossary.md)

# Representation and storage

## Decoupling

The logical model is mapped to bytes in two independent steps:

1.  A *serialization profile* turns logical records into files (for example `mat+meta`, `bgdb-json`).

2.  A *storage binding* says where files live: a `base` location per shard, relative paths inside it, and an optional directory sharding rule.

<a id="ST-01"></a>**[ST-01]** Tools MUST access matches through the logical model (a *codec* layer plus a resolver), never by constructing file paths by hand.

<a id="ST-02"></a>**[ST-02]** A shard declares in `shard.json` the profiles it uses (`formats`) and their capabilities. A profile MUST declare which logical fields it can carry; fields it cannot carry are stored in a sidecar record.

<a id="ST-03"></a>**[ST-03]** Version 1 defines two profiles. **`mat+meta`**: the match as a *Jellyfish MAT* text file, plus a small JSON/YAML sidecar for metadata, rights and tags. **`bgdb-json`**: a lossless JSON serialization of the logical model, produced by the build step for the client.

<a id="ST-04"></a>**[ST-04]** Additional profiles (binary, compressed, other text formats) MAY be added without changing the logical model; clients ignore profiles they do not support when another is available.

## Registry

The *registry* (`registry.json`, [Appendix A](90-appendices.md)) is the single entry point for clients. It lists shards with a stable `id`, a `base` location, a `status` and summary information.

<a id="ST-10"></a>**[ST-10]** `base` MAY be a path relative to the registry’s URL or an absolute URL. Clients MUST resolve it against the URL from which the registry was loaded.

<a id="ST-11"></a>**[ST-11]** Nothing inside a shard may contain absolute URLs or repository names; all internal references are relative to `base`.

<a id="ST-12"></a>**[ST-12]** Match identifiers embed the shard identifier but never a location ([§6](06-identity.md)), so moving a shard does not break links.

<a id="ST-13"></a>**[ST-13]** The registry carries a `schema` version and MAY list `mirrors` per shard (ordered alternative bases). Clients SHOULD fall back to mirrors on failure.

## Shards

A *shard* is a self-contained, bounded group of matches with its own metadata, files and indexes. Shards are defined by *ingestion order*, not by any content attribute.

<a id="SH-01"></a>**[SH-01]** Exactly one shard is `open` at any time; it receives new matches. All others are `sealed`.

<a id="SH-02"></a>**[SH-02]** A shard is sealed automatically when any threshold in the registry’s `sealPolicy` is reached (default: 5 000 matches, so that the open shard, read in full at each build, stays small ([decision 0024](../decisions/0024-data-repositories.md)), or 300 MB compressed, or the position index exceeds a configured size). Thresholds apply to future shards only; an open shard that is already above a lowered threshold is sealed as it is at the next ingest.

<a id="SH-03"></a>**[SH-03]** Sealed shards are immutable. Corrections and removals are expressed as overlays ([§5](05-storage.md)).

<a id="SH-04"></a>**[SH-04]** Content attributes (date, players, event, length) are exposed through per-shard *summaries* in `shard.json`, never through the shard assignment.

<a id="SH-05"></a>**[SH-05]** When a shard is sealed, a digest of all its files is recorded in its `shard.json`. A build that finds the digest unchanged trusts the shard without reading its matches again; a different digest is an error, because a sealed shard must not change. A shard sealed without a digest is read in full until one is recorded (`bgdb verify --record`).

## Shard layout

    <base>/
      shard.json              # identity, status, counts, summaries, formats
      manifest.json           # list of files with hashes (see Section 8)
      matches/<h2>/<hash>.mat # primary files (profile mat+meta)
      matches/<h2>/<hash>.meta.json
      attachments/<h2>/<hash>.sgf            # optional: original GNU Backgammon file (may carry analysis)
      attachments/<h2>/<hash>.xg             # optional: original eXtreme Gammon file
      analysis/<h2>/<hash>.<engine>.json     # optional, later: compact analysis extracted from an attachment
      index/...               # derived, built by CI

Here `<h2>` is the first two hexadecimal characters of the match hash, keeping directories small. This is a storage detail (see [[ST-01]](#ST-01)).

<a id="ST-14"></a>**[ST-14]** A shard that lives in another repository is listed in the registry with an absolute `base` and is not copied by the build; the browser loads it from its own address. A shard that has been moved leaves behind a file of the content hashes of its matches, so that duplicates are still recognised.

## Overlays

*Overlays* are small files in the hub (or a dedicated overlay location) that the client applies on top of sealed shards: `tombstones.json` (hide a match), `patches.json` (replace metadata), `aliases.json` (merge player identities), `collections.json` (membership).

<a id="OV-01"></a>**[OV-01]** Overlays reference matches by identifier only and carry a reason and a date.

<a id="OV-02"></a>**[OV-02]** Overlays are versioned and cacheable like any other file. Rebuilding indexes MUST apply overlays or ignore tombstoned entries at query time.

<a id="OV-03"></a>**[OV-03]** An *enrichment* adds video links, tags and attachments to a match that already exists. It is recorded outside the shard (so that a sealed shard is never edited), published by the build as one overlay file named by its hash and listed in the registry, and applied by the client: the rows of the catalog get the matching flags, and the match page shows the additions. At most one attachment of each kind exists for a match, counting its own.

<a id="OV-05"></a>**[OV-05]** An enrichment may also *correct* the event, round and date of a match; the correction replaces the stored values (and earlier corrections), and the client applies it to the list, the search, the order of the list and the match page ([decision 0022](../decisions/0022-event-round-from-headers-and-file-names.md)).

<a id="OV-04"></a>**[OV-04]** What is published for a shard is the same, byte for byte, before and after an enrichment of one of its matches.

## Deployment topologies (informative)

Because only `base` varies, the same specification supports:

- **T1 – Single repository (where the project starts, [decision 0002](../decisions/0002-single-repository-start.md)).** Hub and data together; shards are folders (`base` relative). Simplest, and enough until a size limit is near.
- **T2 – Hub plus a data repository (where it goes when needed).** The site and tooling live apart from data. When the repository or the published site nears its limits, sealed shards are moved to a new repository and only their `base` is changed. The practical procedure is in [growing.md](../growing.md). The chosen form ([decision 0024](../decisions/0024-data-repositories.md)): a series of data repositories, one of them current (it takes the contributions and holds the only open shard), the others archived; shard numbers continue from one repository to the next.
- **T3 – Federation.** Many repositories, possibly owned by different organisations (clubs, tournaments), each exposing shards that follow `shard.json` and are listed in the registry.

Moving a shard preserves its identifiers, hashes and cached files; git history MAY be preserved with *git-filter-repo* but is not required.
