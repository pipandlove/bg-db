> [bg-db](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0011 - Contribution groups, attachments and video links

**Status:** accepted

**Context.** Contributors have, for one match, a text transcription, a GNU Backgammon SGF (sometimes with analysis), an eXtreme Gammon file (binary, with analysis) and
sometimes a YouTube video. The analysis must not be lost, but an analysed SGF is about 1.7 KB per move and an XG file 26-150 KB, against 1-5 KB for the text.

**Decision.**
- A contribution is a **group of files with the same base name** in the inbox (`name.txt|mat`, `name.sgf`, `name.xg`, `name.bgdb.json`). The text is the primary file; the SGF
  is the match itself when there is no text. No naming other than the shared base name is required.
- **SGF and XG originals are kept as attachments** under `attachments/<h2>/<hash>.<ext>`, listed in the metadata with their SHA-256. An SGF is *verified* (same match identity as the
  text); an XG file cannot be read yet, so it is stored unverified, only next to a text or SGF version. Attachment problems are warnings, never a reason to refuse the match.
- Attachments count towards the shard size (`sealPolicy.maxMB`) and are limited to `maxAttachmentKB` each (default 2 MB). A compact analysis extraction will replace bulk storage later.
- **Video links**: `https` YouTube links only, rebuilt from the video id; given in a `; [Video "..."]` header tag or a `name.bgdb.json` file. Nothing is embedded or loaded automatically.
- The catalog gets three flags (analysis, attachment, video). Match identity is unchanged by attachments and links.

**Consequences.** Contributing stays one action (drop files). Analysis is preserved byte for byte, ready for a later extraction. The repository grows faster with analysed matches: the
size-based sealing keeps shards under the Pages limit. Extra files for a match that already exists are not added yet (enrichment path, spec ATT-07).
