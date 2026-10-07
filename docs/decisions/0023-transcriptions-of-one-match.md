> [bg-db](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0023 - Transcriptions of one match: the better file is kept

**Status:** accepted (2026-10-06)

**Context.** Archives hold the same match transcribed twice: by two people, in two layouts, with a typo in one of them (a roll written
`53` where the other copy says `51`, a play that cannot be made). The identity covers every roll and every position (decision 0003), so
such copies get different identities: the database stored both, a complete match and a damaged one, and a damaged copy was refused or
waited in the inbox although a good copy of the same match was there. In an archive of 3 249 files, 136 groups of files are one match:
111 have the same identity (ordinary duplicates), 15 have one clearly better copy, 10 have copies that are both valid but differ.

**Decision.**
1. **The same match is recognised by its rolls.** For each file, the sequence of rolls and cube actions, game by game (who rolls what,
   who doubles, takes, drops), is read from the parse alone: it exists even for a file that fails, and it does not depend on the notation
   of the plays. Two files between the same two players (by normalised name, in any column order) and for the same length, with at least
   **95%** of these in common (longest common subsequence, game by game), are one match. Dice repeated over hundreds of rolls are a very
   strong signature: two different matches between the same players share about 15%.
2. **The better copy is kept**, by rank: valid as it is, over valid only by salvage (decision 0021), over refused. Only these files are
   read in full. Copies with the same identity are ordinary duplicates.
3. **When one copy has the only best rank, the ingest decides alone.** The others are reported `superseded` (with the share in common and
   the first difference: "game 1, row 18: Ballard rolls 53 here, Ballard rolls 51 in the other"), skipped and removed from the inbox, like
   duplicates. What they know and the kept copy does not (event, round, date) is kept: it fills the kept match, or corrects the stored one
   (an enrichment, decision 0022).
4. **When no copy ranks higher** (both valid but different: which one is right is not known), a person chooses. The review sheet of
   `bgdb meta` shows them as `near-duplicate`, with the first difference; `reject` in its new column `action` moves a file out of the inbox
   into `rejected/` (with the reason in `REASONS.md`), and applying the same sheet after a restart rejects it again. Without a choice both
   are stored, with a `V-COPY` warning. Nothing is guessed: the rules never choose between two readings of a roll.
5. Against stored matches: a damaged copy of a stored match is superseded by it. A better copy of a stored match is added, with a warning:
   withdrawing a stored match (tombstones, spec section 5.4) does not exist yet.

**Alternatives.** Keeping the legal file without comparing (a damaged file of a *different* match would be thrown away with no copy of it
left); comparing positions (impossible for a file that fails, and a single wrong play changes every position after it); a threshold on
whole games instead of rolls (a typo in one roll would cost a whole game); choosing between two valid copies by their number of warnings
(a guess about which transcriber was right).

**Consequences.** On the archive: 16 copies superseded (several of them refused files that stayed in the inbox before), 16 files in 8
groups left to the reviewer. The review sheet and the ingest read the files of these groups in full: about half a minute more for
thousands of files. A fragment and the full match it comes from are not recognised by this rule (the fragment shares too little of the
rolls): that still needs a hash per game (docs/partial-matches.md).
