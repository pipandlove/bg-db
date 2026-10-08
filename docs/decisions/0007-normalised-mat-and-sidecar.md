> [bgdb](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0007 - Normalised MAT plus JSON sidecar as the stored form of a match

**Status:** accepted

**Context.** Contributions arrive in four text dialects and SGF. Spec ST-03 asks for one primary profile (`mat+meta`) and
a derived client format (`bgdb-json`).

**Decision.**
- Ingestion re-writes every accepted match with `writeMat` (one dialect, "bgdb") and stores the metadata in a sidecar
  `<hash>.meta.json`. The original text is not kept; its SHA-256 is recorded in `provenance.originalHash` and the original
  format, dialect and site in the same record. Before writing, ingestion reads the normalised text back and refuses it if the
  identity differs.
- The client format `bgdb-json` is derived by `build` from the `.mat` and published next to it; it is not committed.
- A hidden-play resignation (`????`) is stored as a resignation with the effective points (`Resigned Game` + `Wins N points`).

*Update: SGF and XG originals are now kept as attachments (decision 0011); text originals are still not kept.*

**Consequences.** Every stored match is readable by any `.mat`-aware tool and by our parser without dialect knowledge; storage is
uniform and diff-friendly. Information that is not in the model is lost on purpose (column layout, site tags other than those kept, the
exact order of sub-moves within a turn). If the original file ever matters, the contributor still has it and its hash proves which one it was.
Position-level details (hits, order) are recomputed on read, so a bug in the writer is caught by the read-back check, not stored silently.
