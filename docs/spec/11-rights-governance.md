> [bgdb](../../README.md) · [Documentation](../README.md) · BGDB specification, Part I · [Overview](README.md) · [Requirements](requirements.md) · [Terms index](terms-index.md) · [Glossary](glossary.md)

# Rights, privacy and governance

<a id="RP-01"></a>**[RP-01]** Data is published under the *CC0 1.0* public-domain dedication (SPDX `CC0-1.0`, [decision 0009](../decisions/0009-data-licence.md)). The licence is stated in the registry, in every `shard.json` and in every match’s provenance. Code is licensed separately (MIT).

<a id="RP-02"></a>**[RP-02]** Contributors affirm they have the right to share what they submit. Content scraped from other databases without permission MUST NOT be accepted.

<a id="RP-03"></a>**[RP-03]** Online players appear under pseudonyms, over-the-board players under their real names ([decision 0025](../decisions/0025-online-players-otb-names-and-erasure.md)). Names are replaced before a submission leaves the contributor's computer: the contribution page (and `bgdb hide-names`) gives every player a pseudonym computed with the contributor's own secret key (the same handle, the same pseudonym, for that contributor only) and removes the platform, the time of day, the event and the remarks, unless the contributor declares the match played over the board (`"origin": "otb"`; refused when the file names an online platform, `V-ORIGIN`). A data repository refuses any other name (`V-HANDLE`). Because git history is public and durable, nothing with the original names of an online match is uploaded, and a player can have a match removed ([CR-02](10-contribution.md#CR-02)).

<a id="RP-06"></a>**[RP-06]** Attachments (SGF, XG) and video links are covered by the same declaration as the match. A contributor MUST NOT attach files, or link videos, that they have no right to share; the project hosts no video, only links.

<a id="RP-04"></a>**[RP-04]** Analysis files record the engine and licence conditions; analysis produced by software whose terms forbid redistribution MUST NOT be accepted.

<a id="RP-05"></a>**[RP-05]** Governance is lightweight: maintainers decide policy through public issues; significant changes follow the proposal process of [§12](12-evolution.md).
