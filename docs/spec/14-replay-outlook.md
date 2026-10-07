> [bg-db](../../README.md) · [Documentation](../README.md) · BGDB specification, Part I · [Overview](README.md) · [Requirements](requirements.md) · [Terms index](terms-index.md) · [Glossary](glossary.md)

# Outlook: the replay interface (Part II)

> **Update:** version 1 of the replay is specified in [section 15](15-replay.md) and was built in milestone M4. What remains of this outlook is analysis display, annotations, embedding, and the other items below.

The replay and information display are specified in Part II. The data model above already guarantees the hooks that design will need:

- deterministic reconstruction of any position from canonical actions ([[LM-01]](04-logical-model.md#LM-01));

- per-action analysis lookup when analysis exists ([[LM-03]](04-logical-model.md#LM-03));

- annotations attached to games and actions;

- stable deep links built from the match identifier plus game and ply;

- position identifiers in standard formats for copy and paste into other tools.

Topics for Part II: board rendering and themes, playback controls and keyboard shortcuts, panels (score, pip count, cube, match equity, dice history), analysis display (equity graph, errors, alternatives), annotations, mobile layout, accessibility, embedding and export (links, images), and performance of long matches.

## Open questions

1.  Final canonicalization for the match hash ([[ID-03]](06-identity.md#ID-03)) and the Zobrist table seed ([[PK-02]](06-identity.md#PK-02)).

2.  ~~Which licence~~ decided: CC0 1.0 ([decision 0009](../decisions/0009-data-licence.md)).

3.  Default seal thresholds after measuring real index sizes on a sample of 5 000 matches.

4.  Choice between binary and JSON encodings for the position index.

5.  Whether to operate the optional relay (C7) from the start.

6.  Naming of the project and repositories.
