> [bg-db](../../README.md) · [Documentation](../README.md) · BGDB specification, Part I · [Overview](README.md) · [Requirements](requirements.md) · [Terms index](terms-index.md) · [Glossary](glossary.md)

# Introduction

## Purpose and scope

This specification defines *what* BGDB stores, *how* it is organised so that it can grow without a central server, and *how* people contribute to it. It is meant to be read by maintainers, contributors who write tooling, and anyone who wants to build an independent client or mirror. Part I covers everything except the match viewer.

## Goals

1.  Offer an open, forkable, long-lived archive of backgammon matches (a “freedb” for backgammon), inspired by older databases such as extmatchdb, without copying their content.

2.  Run as a *static site*: no application server, no database server, no account needed to *read*.

3.  Let anyone search quickly in the browser, even when the collection becomes large, thanks to compact, versioned, lazily loaded *indexes*.

4.  Let the collection grow “indefinitely” by adding *shards* (possibly in new repositories) without breaking existing links, caches or indexes.

5.  Keep the *logical* description of the data independent from its *storage* layout so that either can evolve.

6.  Make contributing a match as quick and effortless as possible ([§10](10-contribution.md)).

## Non-goals (for version 1)

- Running a game engine, online play, or live analysis inside the project (analysis results may be *stored*, not produced, by BGDB).

- Replacing the native formats and tools of *XG*, *GNU Backgammon* or similar programs.

- Hosting copyrighted material without the right to do so (see [§11](11-rights-governance.md)).

- Real-time features, user profiles, comments threads or any feature requiring a server-side session.

## Design principles

- **P1 Static first.** Every feature must work from static files plus browser code. Optional servers are extensions, never requirements.

- **P2 Logical model ≠ storage.** Tools reason about entities and identifiers ([§4](04-logical-model.md)); files, folders and repositories are an implementation detail declared in metadata ([§5](05-storage.md)).

- **P3 Immutability by default.** Sealed shards never change; everything derived (indexes, summaries) is rebuildable from them.

- **P4 Derived data is disposable.** Indexes are never the source of truth and are not committed by contributors.

- **P5 Self-describing and versioned.** Every file type carries a schema version; readers ignore what they do not understand.

- **P6 Conflict-free contributions.** Two contributors must never need to edit the same file.

- **P7 Ease before ceremony.** The shortest path to a valid contribution wins over procedural completeness; machines do the chores.

- **P8 Graceful degradation.** A missing shard, index or analysis reduces features but never breaks the site.

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT and MAY are used as in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). Requirements are numbered (for example [[CTB-01]](10-contribution.md#CTB-01)) so that they can be referenced from issues and tests. JSON/YAML identifiers use `camelCase`. Technical terms appear in italics at first use and are listed in the Index; the Glossary gives definitions and external sources. Sections marked *informative* impose no requirements.
