> [bgdb](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0022 - Event and round: headers cleaned automatically, file names reviewed, corrections as enrichments

**Status:** accepted (2026-10-06)

**Context.** The first real ingest of a tournament archive (3 037 matches) read only the `Event` and `Round` header tags, and
showed many matches that the list could not tell apart. In the 3 129 text files, 1 749 have no event and 2 124 no round; 585 matches
fell in 209 groups with the same players, date, event, round and length. What is missing is often elsewhere in the file or in its name:

- The final of a championship played as 12 matches between the same two players: the event only in the `Site` tag ("Galaxy Backgammon
  River Cup Final 2025"), the match number only in the file name ("... 3. Match 26.07.2025 River Cup Final").
- Old matches transcribed without headers: year, event and round in the name ("1988 A-B NEBG Club Champs Final #3 ... 9pnts").
- Exports that write placeholders: `Event "Online match"` (741 files), `Round "Round 0"` (608 files).
- A rating written after the name on the score line (`name,1816 : 0`, 250 files) was read as part of the name, so that one player
  appeared under several names.

Spec CTB-13 already asked for metadata "inferred from headers, file names and previous contributions", with the contributor able to
correct it; CTB-02 said that file names carry no meaning. Event, round and date are not part of the identity (ID-02): improving them never
changes a match id.

**Decision.**
1. **Headers, applied automatically** (`cleanHeaderMetadata`, in `analyzeGroup`, so the same for `ingest`, the pull-request review and the
   Contribute page): placeholders are left out (`Online match`, `Round 0`, `?`, `-`); when there is no event, a `Site` tag that names a known
   server *and* something else gives that something else as the event ("River Cup Final 2025"). A `Site` that is only a server says nothing; a
   `Site` that is something else (often a place: "Monte Carlo", "Tokyo, Japan") is not taken as the event. Each change is reported as an
   info (`V-META`). The rating after a name on a score line becomes the side's rating.
2. **File names, reviewed** (`nameMetadata`, `planMetadata`, `bgdb meta`): what a name suggests (event, round, match number in a series,
   date, time) is a proposal, never applied by itself: names are free text (CTB-02 stays true for contributors), and a reading of them is
   a guess. `bgdb meta` writes a review sheet (tab-separated text) with the matches that look the same as another (`same`), the series that
   the names or the times of play tell apart (`series`: "Final - Match 3", "Match 2 of 4"), what names alone give (`name`), and copies of one match (`duplicate`: the same moves once the
   header lines are left out, or the same identity, computed only for the look-alikes, since it reads every move); headers stay
   out of it when nothing changes them. `--apply` writes the reviewed values into each match's `.bgdb.json` (`event`, `round`, `date`;
   `null` for none), which the ingest then prefers to the headers.
3. **The list must tell matches apart.** A new match with the same players, date, event, round and length as another (stored or added in
   the same run) is added with a `V-META` warning that says how to fix it. It is never refused: metadata is never blocking (CTB-13).
4. **Corrections after the ingest are enrichments.** An enrichment record may carry `meta: {event?, round?, date?}`; it replaces the values
   of the match (and of earlier corrections). Ways in: `bgdb enrich <id> --event/--round/--match-date`, or a duplicate whose sidecar gives
   different values (a contributor, or a maintainer, re-sends the file with a reviewed `.bgdb.json`). The overlay carries it; the browser
   applies it to the rows (list, search, sort) and to the match page. Sealed shards are not touched (OV-04), as for links and attachments.

**Alternatives.** Applying what the file names suggest without review (fast, but a name such as "Mara Holt-Dan Ferris 7th Green
Mountain" leaves "Mara" in the event, and a wrong round would be published silently); reading the `Site` tag as the event in every case
(most of them are servers or places); refusing look-alike matches (blocks real matches for a metadata problem); a separate `patches`
overlay for corrections (spec section 5.4): the enrichment overlay already exists, is applied by the same code, and a correction is one
more field of the same record.

**Consequences.** On that archive (3 239 readable files) the review sheet holds 1 830 rows: 27 matches that nothing in the files tells
apart (left to the reviewer), 658 in series told apart by their names or times, 1 116 with something read from the name only, and 29
copies of another file (first shown as look-alikes; they are now marked, so the reviewer is not asked to tell one match from itself). The 12 matches of that
final get the event "River Cup Final 2025" automatically and "Final - Match 1" to "Final - Match 12" once reviewed. The overlay can now change
what the catalog says; the browser sorts after applying it. Matches stored before this decision keep their placeholder event until they
are corrected or ingested again.
