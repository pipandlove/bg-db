> [bg-db](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0009 - Data licence: CC0 1.0

**Status:** accepted (resolves open question Q2 of the specification). *History: CC BY-SA 4.0 was chosen first and replaced by CC0 on the owner's decision before any public release or outside contribution, so no relicensing was needed.*

**Context.** The data must be open and forkable (spec goal G1). A transcribed match is a sequence of moves, which the project owner considers cannot be
proprietary; the licence is a safety net for whatever rights might exist in the collection, the database, added notes and metadata. The candidates were CC0,
CC BY and CC BY-SA.

**Decision.** The data (match records, metadata, attachments, catalogs) is dedicated to the public domain under **CC0 1.0** (SPDX `CC0-1.0`). Code stays under MIT.
The licence is recorded in `bgdb.config.json`, copied into `registry.json` and into every match's provenance at ingestion, and stated in `DATA-LICENSE.md`.
The contributor declaration (pull request template, issue form, CONTRIBUTING) names it.

**Consequences.**
- No condition on reuse: no attribution and no ShareAlike. The data can be merged into any other collection and can feed commercial products.
- A contributor can only waive rights they hold. The declaration is the control (spec RP-02, RP-06): material from sources that forbid redistribution, XG analysis
  whose terms forbid it, or other people's tournament work must not be submitted. Crediting stays a community norm, helped by the `contributor` field.
- Not legal advice: if the project grows, a short review by someone qualified is worthwhile, especially for tournament transcripts and for attached analysis files.
- Relicensing later would need every contributor's consent, which is why the decision was taken before accepting contributions. CC0 is irrevocable for what is published.
- The official legal text should be saved as `LICENSE-DATA.txt` (not done: it could not be downloaded from the build environment).
