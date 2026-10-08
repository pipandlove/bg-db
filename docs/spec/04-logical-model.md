> [bgdb](../../README.md) · [Documentation](../README.md) · BGDB specification, Part I · [Overview](README.md) · [Requirements](requirements.md) · [Terms index](terms-index.md) · [Glossary](glossary.md)

# Logical data model

This section is *normative for meaning* and *silent about bytes*. Any serialization that can express these entities and identifiers is a valid profile.

## Entities

| **Entity** | **Description**                                                                                   |
|:-----------|:--------------------------------------------------------------------------------------------------|
| Match      | A sequence of games between two sides, with rules and result.                                     |
| Game       | One game inside a match: initial position, ordered actions, result.                               |
| Action     | One event in a game: roll, move, double, take, pass, resign offer, resign answer.                 |
| Position   | Checker layout plus cube, score, side to move and optional dice. Always *derivable* from actions. |
| Player     | A named participant (real name, pseudonym or program) with a stable identifier.                   |
| Event      | A tournament, online session, club night or study set a match belongs to.                         |
| Collection | A curated grouping of matches across shards (for example a championship).                         |
| Provenance | Where a record came from, who submitted it, and under which rights statement.                     |
| Analysis   | Engine evaluations attached to a match, optional and plural.                                      |
| Annotation | Human comments attached to a game or action.
| Link       | A reference to a video of the match (YouTube), optionally at a given game and time. |
| Attachment | An original file kept with a match: a GNU Backgammon SGF or an eXtreme Gammon file, possibly with analysis. |                                                      |

## Match attributes

| **Attribute**    | **Type**          | **Card.** | **Meaning**                                                                                        |
|:-----------------|:------------------|:----------|:---------------------------------------------------------------------------------------------------|
| `id`             | MatchId           | 1         | Stable identifier ([§6](06-identity.md)).                                                          |
| `sides`          | Side\[2\]         | 1         | The two participants, each with a PlayerRef and an optional display name as written in the source. |
| `matchLength`    | integer           | 1         | Points to win; `0` means money / unlimited play.                                                   |
| `rules`          | Rules             | 1         | Crawford, Jacoby, beavers, other variants; unknown values allowed.                                 |
| `date`           | partial ISO date  | 0..1      | Year, year-month or full date; absence is allowed.                                                 |
| `event`, `round` | EventRef, string  | 0..1      | Tournament context.                                                                                |
| `location`       | string            | 0..1      | Venue or online site.                                                                              |
| `games`          | Game\[\]          | 1..n      | Ordered games.                                                                                     |
| `result`         | Result            | 0..1      | Winner and final score; derivable if the games are complete.                                       |
| `collections`    | CollectionRef\[\] | 0..n      | Curated groupings.                                                                                 |
| `tags`           | string\[\]        | 0..n      | Free labels (lowercase, no spaces).                                                                |
| `links`          | Link[]            | 0..n      | Video links (below).                                                                |
| `attachments`    | Attachment[]      | 0..n      | Original SGF or XG files kept with the match (below).                               |
| `provenance`     | Provenance        | 1         | Origin and rights (below).                                                                         |
| `ext`            | map               | 0..1      | Namespaced extension fields ([§4](04-logical-model.md)).                                           |

## Other entities in brief

- **Game.** `index`, `startScore`, `crawford` flag, `initialPosition` (default: standard opening), `actions[]`, `result` (winner, points, kind: single/gammon/backgammon, how: bear-off/drop/resign).

- **Action.** `kind` (roll, move, double, take, pass, resignOffer, resignAccept, resignReject), `side`, kind-specific payload (dice values; list of sub-moves `from`, `to`, `hit`).

- **Position.** Checkers per point $1..24$, bar and off for both sides; cube value and owner; side on roll; dice (optional); score; match length; Crawford flag. Interchange form: *XGID* or *GNUBGID*.

- **Player.** `id`, `displayName`, `aliases[]`, `kind` (human, bot, unknown), `isPseudonym`, optional external handles. Real names are optional and may be pseudonyms ([§11](11-rights-governance.md)).

- **Provenance.** `sourceKind`, `originalFormat`, `importer` (tool and version), `contributor` (GitHub handle, optional), `submittedAt`, `originalHash`, `license`, `rightsStatement`.

- **Analysis.** `engine`, `engineVersion`, `settings`, per-action evaluation (probabilities of single/gammon/backgammon outcomes, equity, best alternatives), per-action error, and summary (average error, performance rating). Several analyses per match are allowed, keyed by engine and settings.

- **Link.** `type` (video), `provider` (youtube), `id` (the 11-character video id), `url` (rebuilt from the id, never copied from the submission), optional `time` (start, seconds), `game` (game number) and `title` (at most 120 characters, plain text).
- **Attachment.** `kind` (`sgf` or `xg`), `file`, `bytes`, `sha256`, `verified` (true when the file was read and found to describe the same match), `analysis` (true, false, or null when unknown) and `engine`.
- **Annotation.** `target` (game or action), `author`, `text` (restricted Markdown subset), `createdAt`.

## Derived versus canonical data

<a id="LM-01"></a>**[LM-01]** Canonical data consists of the match descriptors, the games’ initial positions and the ordered actions (dice and moves, cube actions, resignations). Everything else (positions after each action, pip counts, equities, summaries) is derived.

<a id="LM-02"></a>**[LM-02]** Derived data MAY be cached in indexes or in analysis files, but readers MUST be able to recompute it from canonical data.

<a id="LM-03"></a>**[LM-03]** Analysis and annotations MUST be stored apart from canonical match data (separate record or file), so that adding them never changes a match’s identity.

## Links and attachments

<a id="LNK-01"></a>**[LNK-01]** A match MAY carry video links. Only `https` links to YouTube (`youtube.com`, `youtu.be`, `youtube-nocookie.com` and their `www`/`m` forms) are accepted; the list of hosts is part of the configuration.

<a id="LNK-02"></a>**[LNK-02]** A link is reduced to the video id and rebuilt in canonical form (`https://www.youtube.com/watch?v=<id>`, plus `&t=<seconds>s` when a start time is given). Tracking parameters, playlists, user names and passwords in the submitted URL are never stored.

<a id="LNK-03"></a>**[LNK-03]** An invalid link is ignored with a warning (`V-LINK`) and never blocks the match. A link naming a game the match does not have keeps the link and drops the game number.

<a id="LNK-04"></a>**[LNK-04]** Clients MUST NOT load content from a video provider automatically: the viewer shows a link, and embedding (if offered) happens only on a click, with the privacy-enhanced domain.

<a id="ATT-06"></a>**[ATT-06]** A match MAY keep original files as attachments: at most one SGF and one XG file. An attachment never changes the identity of the match ([[LM-03]](#LM-03)).

## Illegal plays that were made

<a id="ILL-01"></a>**[ILL-01]** A play that is not legal under the rules is an error, except when the source declares that it was made (a transcriber's remark, or an entry supplied with the contribution). A declared illegal play is accepted *as played*: it is kept, flagged, and the game continues from the position it produced.

<a id="ILL-02"></a>**[ILL-02]** Only a play that can be carried out mechanically can be accepted: the checkers must exist on their starting points and the target points must not be blocked. Anything else remains an error.

<a id="ILL-03"></a>**[ILL-03]** A declaration that matches no play is reported with a warning, and a declaration that matches a legal play is reported as information and ignored; neither changes the match.

<a id="ILL-04"></a>**[ILL-04]** An accepted illegal play is recorded in the metadata, marked on the action in the replay data, flagged in the catalog (flag 64) and shown to the reader, so that it can never be mistaken for a defect of the rules engine. The match identity includes it, since it is part of what was played.

<a id="ILL-05"></a>**[ILL-05]** The transcriber's remarks are kept as plain text (limited in number and length) and shown with the match.

## Extension and evolution

<a id="EXT-01"></a>**[EXT-01]** Every record carries a `schema` version string. Readers MUST ignore unknown fields and preserve them when copying a record.

<a id="EXT-02"></a>**[EXT-02]** Experimental or site-specific fields MUST live under `ext`, keyed by a namespace (for example `ext.myclub.rating`). Namespaces are first-come and documented in `docs/namespaces`.

<a id="EXT-03"></a>**[EXT-03]** New entities (for example *Puzzle*, *Commentary*) are added by extending the logical model in a minor version; they MUST NOT alter the meaning of existing attributes.
