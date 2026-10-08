> [bgdb](../README.md) · [Documentation](README.md)

# Partial matches

A transcription often covers only part of a match: a famous player's fragment, a game or two of a long match. They are worth keeping. This note says what works and what does not.

| Case | Today |
|---|---|
| **Starts at the beginning, stops early** (for example game 1 of a 17-point match) | **Works**: accepted with the warning "the match is unfinished", listed, searchable and replayable. |
| **Starts later** (the first game recorded has a score already, for example 8-4) | **Works** (`V-PARTIAL` warning): the score of the first game is the start of the count, the result is counted from there and carries `partial.startScore`, the site says "a fragment: recorded from 8–4", and the identity already includes the start scores. The Crawford game is inferred when the fragment starts with a player at match point (see [diagnostics](diagnostics.md)). |
| **Stops in the middle of the last game** (no result and no `Wins` line: the file is cut) | **When accepted** (`V-PARTIAL` warning; see the next row): the unfinished game is left out and the complete games are kept. Not accepted: the match is not added. |
| **A game whose moves cannot be read** (an impossible or missing play, a wrong turn, a cube error, a set position) | **When accepted** (`--salvage`, or `"accept": "partial"` for one match): in a match, the game is kept **by its result only** when its `Wins` line gives it and a second source confirms it (the start score of the next game, or the end of the match), so the match stays complete with its real final score; without a confirmed result the game is left out, and the next game starts from the score its file gives. The **winner of the match must stay known**, otherwise the file is refused. In a money session the game is left out (there is no score to follow). At least one readable game must remain. A score or a winner that contradicts the file is never salvaged. Not accepted: the match is not added (`PARTIAL`, `needs-confirmation`). |
| **A gap** (games missing between two recorded ones: an excerpt) | **Works** (`V-PARTIAL` warning): the start score of each game is trusted if it only moves forward (in a match, or in the running score of a money session); `result.partial.gaps` lists the gaps and the page says "an excerpt" ([decision 0020](decisions/0020-excerpts-lost-games-and-missing-plays.md)). |
| **A game whose plays are lost** (only its result is known) | **Works**: kept by its result, flagged `resultOnly`. |
| **A match with plays missing** (blank rolls where a play was possible) | refused as **damaged** (`V-DAMAGED`): the position is unknown. |
| **Starts or stops in the middle of a game** (a position and the moves after it) | refused: a game must start from the opening position and reach a result. It needs a starting position (an XGID in the header, which MAT does not have, but SGF and XG do) and a different kind of record: a "position" or "excerpt" rather than a match; a feature of its own. XG text exports give such a position as `; Set Pos=` (roadmap: games from a set position; fixture and `todo` tests are ready). |
| **A game that ends in the middle of a roll, or with junk in the last slot** (one die, none, wrong moves, `00:`) | **Works**: see [game endings](game-endings.md). |

**Still to do (small):** a `partial` flag in the catalog and `has:partial` in the query language (the match page already says it); a hash per game in the sidecar, so that the database can see that a fragment is a part of a full match that arrives later and mark the fragment as superseded.

**Related questions**
- *The full match arrives later.* A fragment and the full match have different identities (the identity covers every game): they sit side by side until per-game hashes exist.
- *The same match transcribed twice, one copy damaged.* The copies are recognised by their rolls and the better one is kept; the other is `superseded` ([decision 0023](decisions/0023-transcriptions-of-one-match.md)). A fragment shares too few rolls with the full match for this rule.
- *Rights.* Fragments often come from a book, a video or a site: the contributor's declaration (CC0, spec RP-02) applies as for any match.

Fixtures: [`game-ends-dice-without-play_17pt`](../fixtures/extmatchdb/game-ends-dice-without-play_17pt.txt) (a fragment of it from game 5 is built in `packages/core/test/repairs.test.js`) and [`game-ends-play-cut-after-one-die`](../fixtures/extmatchdb/game-ends-play-cut-after-one-die.mat) (rolls abandoned by the loser).

**Who decides.** Old tournament records are worth keeping for their history even when a game is damaged, as long as the score story is clear: a viewer
knows the score before every readable game and who won the match. A maintainer importing an archive accepts that for every file with `bgdb ingest --salvage`.
A contributor decides for each match: the check (Contribute page, bot comment, issue form, `bgdb check --salvage --out`) shows the errors, what would be kept and
the `.mat` that would be stored, and the match is added partially only when they agree (`{"accept": "partial"}` in its `.bgdb.json`, ticked for them by the
page and the form). Otherwise it is not added, and they can fix the file.

