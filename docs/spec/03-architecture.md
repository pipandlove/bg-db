> [bg-db](../../README.md) · [Documentation](../README.md) · BGDB specification, Part I · [Overview](README.md) · [Requirements](requirements.md) · [Terms index](terms-index.md) · [Glossary](glossary.md)

# Architecture overview

## Layers

| **Layer**              | **Responsibility**                                                      | **Defined in**                                         |
|:-----------------------|:------------------------------------------------------------------------|:-------------------------------------------------------|
| Logical model          | Entities (match, game, action, player, event, analysis) and identifiers | [§4](04-logical-model.md)                              |
| Serialization profiles | How the logical model is written as bytes (MAT, JSON, ...)              | [§5](05-storage.md)                                    |
| Storage binding        | Where profiles live: registry, shards, folders, repositories            | [§5](05-storage.md)                                    |
| Identity & integrity   | Content hashes, duplicate detection, position keys                      | [§6](06-identity.md)                                   |
| Indexes                | Derived, versioned search structures per shard and global summaries     | [§7](07-indexes.md)                                    |
| Client runtime         | Loading, caching, workers, offline behaviour                            | [§8](08-client.md)                                     |
| Search                 | Query model, filters, performance budgets                               | [§9](09-search.md)                                     |
| Contribution           | Pull-request pipeline, inbox, validation, bots                          | [§10](10-contribution.md)                              |
| Governance             | Licensing, privacy, takedown, evolution                                 | [§11](11-rights-governance.md), [§12](12-evolution.md) |

## Repositories and sites

The recommended starting topology consists of two repositories (see [§5](05-storage.md) for variants):

- **Hub repository.** The static site (UI), the validator and other tooling, the specification and documentation, the *registry* listing all shards, and global overlays. It stays small forever.

- **Data repository.** An `inbox/` folder that accepts contributions, and a `data/` folder containing the *shards*. It publishes its own static files (shards, indexes) via its own site. When it is full, a new data repository takes over and the old one is archived ([decision 0024](../decisions/0024-data-repositories.md)).

## Actors

| **Actor**       | **Role**                                                                                     |
|:----------------|:---------------------------------------------------------------------------------------------|
| Reader          | Browses, searches, replays. Needs only a browser.                                            |
| Contributor     | Submits matches or corrections. Needs a GitHub account for the pull-request paths.           |
| Maintainer      | Reviews exceptions, manages policy, handles takedowns.                                       |
| Bot             | Automation performing validation, feedback, normalization, ingestion, sealing, index builds. |
| Mirror operator | Hosts a copy of a shard or the whole site; reads the registry.                               |
