> [bgdb](../../README.md) · [Documentation](../README.md) · BGDB specification, Part I · [Overview](README.md) · [Requirements](requirements.md) · [Terms index](terms-index.md) · [Glossary](glossary.md)

# Evolution and compatibility

<a id="EV-01"></a>**[EV-01]** The specification, registry, shard metadata, manifests, indexes and match records follow *semantic versioning* of their own schemas. A major change requires a migration plan.

<a id="EV-02"></a>**[EV-02]** Readers MUST support all minor versions of a major version, and SHOULD support the previous major version for at least two minor releases of the next one (“read old, write new”).

<a id="EV-03"></a>**[EV-03]** Schema changes never rewrite sealed shards. Old records are upgraded at read time (“upcasting”); a shard MAY be re-serialized into a new shard generation when the benefit is clear.

<a id="EV-04"></a>**[EV-04]** Changes to the model or workflow are proposed as short documents in `rfcs/NNNN-title.md` (motivation, design, compatibility, alternatives) and discussed in a pull request. Decisions are recorded in `docs/decisions`.

<a id="EV-05"></a>**[EV-05]** Capability flags in the registry (for example `positionIndex`, `analysis`, `globalIndex`) allow clients and data to evolve at different speeds.

<a id="EV-06"></a>**[EV-06]** The validator and importers are versioned packages; the data repository pins their version, and updates are proposed by bot pull requests.
