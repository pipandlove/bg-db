> [bgdb](../../README.md) · [Documentation](../README.md) · BGDB specification, Part I · [Overview](README.md) · [Requirements](requirements.md) · [Terms index](terms-index.md) · [Glossary](glossary.md)

# Identity, integrity and normalization

## Match identity

<a id="ID-01"></a>**[ID-01]** A match identifier has the form `<shardId>/<hash>`, for example `0007/3f9a1c5e0b72d814`. The hash is the first 16 or more hexadecimal characters of a *SHA-256* digest of the *canonical content* ([[LM-01]](04-logical-model.md#LM-01)).

<a id="ID-02"></a>**[ID-02]** The identity MUST NOT depend on descriptive metadata (names, event, date, tags), analysis or annotations; correcting a typo in a player name does not create a new match.

<a id="ID-03"></a>**[ID-03]** The identity MUST be invariant under reordering of the two players in the source file. The exact canonicalization (side labelling, treatment of optional comments, line endings, move ordering within a turn) is to be fixed in Annex A of the final 1.0 specification; until then, implementations MUST follow the reference implementation.

<a id="ID-04"></a>**[ID-04]** Hash collisions at the chosen length MUST be detected by CI; the identifier then extends to a longer prefix for the later record.

## Duplicate detection

<a id="DU-01"></a>**[DU-01]** The hub maintains (or derives) a list of all match content hashes. The validator, both in the browser and in CI, checks submissions against it and reports duplicates *before* merge.

<a id="DU-03"></a>**[DU-03]** Two transcriptions of one match (the same players and length, at least 95% of the rolls in common) are one match: the copy with the only best rank (valid, then valid by salvage, then refused) is kept and the others are reported as superseded; when no copy ranks higher, a person chooses ([decision 0023](../decisions/0023-transcriptions-of-one-match.md)).

<a id="DU-02"></a>**[DU-02]** A duplicate is never an error that blocks a contributor with additions: new metadata, analysis or annotations on an existing match are accepted as enrichment ([§10](10-contribution.md)).

## Position keys

<a id="PK-01"></a>**[PK-01]** Positions are keyed by a 64-bit *Zobrist hash* computed on the canonical position from the viewpoint of the side on roll (so colours and board orientation do not matter). Cube value and owner are part of the key; dice are not.

<a id="PK-02"></a>**[PK-02]** The random table is generated from a fixed algorithm and seed published in Annex B so that independent implementations obtain identical keys.

<a id="PK-03"></a>**[PK-03]** Positions are exchanged with humans and other programs as *XGID* or *GNUBGID*; both MUST be accepted wherever a position is entered.

## Normalization of inputs

<a id="NO-01"></a>**[NO-01]** Text input is normalized to Unicode NFC, LF line endings, trimmed trailing whitespace, and player names compared case- and accent-insensitively for matching purposes (display names keep their original form).

<a id="NO-02"></a>**[NO-02]** Importers convert foreign formats to the logical model and record the original format and file hash in provenance.
