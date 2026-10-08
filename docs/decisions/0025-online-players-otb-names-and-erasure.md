> [bgdb](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0025 - Online players under pseudonyms, real names over the board, erasing a match

**Status:** proposed, **undecided**. The owner is reviewing this design (2026-10-08) and plans to ask on each platform's forum
what it allows (questions at the end). Nothing here is built. Until it is accepted, [decision 0010](0010-privacy-and-anonymisation.md)
still describes the code: ingestion keeps names and handles as they are.

What the platform shows and promises about players depends on this decision, so it is written out in full to be re-read before
choosing. It is not legal advice.

## Context

- **Decision 0010 keeps handles.** The original idea was that searching the matches of a player is a purpose of the database, and that a
  person who objects uses the takedown path ([spec RP-03](../spec/11-rights-governance.md#RP-03), [CR-02](../spec/10-contribution.md#CR-02)).
- **What happened.** On 2026-10-07 the first real contributions reached the public data repository `bgdb-data-1` ([decision 0024](0024-data-repositories.md)):
  two matches against the owner's daughter (a home game, `Site "HedgeHog"`), and two online matches whose files named the other player by their
  platform handle and named the platform (`provenance.site: "OpenGammon"`; a BackgammonHub `.sgf` attachment carrying both handles). The opponents had not
  agreed to anything. The two online matches were erased on 2026-10-08 (see *Done so far*).
- **Online handles are personal data.** Under the GDPR a handle is personal data as soon as someone (the platform, the player's friends) can link it to a
  person. Replacing it by a pseudonym that can be recomputed is *pseudonymisation*, not anonymisation: the result is still personal data for whoever can
  recompute it. Only a pseudonym nobody can link back is outside the GDPR.
- **A game record can identify a game even without names.** The platform that hosted the game has the same dice and moves. With the date and time, the
  platform name and the hash of its own export file, the platform or the opponent can find the game. Everyone else can't.
- **Platforms have terms.** Some online servers claim rights over their game logs or forbid republishing them. [RP-02](../spec/11-rights-governance.md#RP-02)
  already forbids scraped content, and the contributor declaration ([decision 0009](0009-data-licence.md)) only covers rights the contributor holds.
- **Over-the-board records work differently.** Chess has a long practice: tournament games are published with the players' real names and the moves, in
  databases anyone can search. The usual legal basis is legitimate interest, balanced by a working right to object and to erasure (GDPR articles 6(1)(f),
  17 and 21). The owner wants the same for backgammon over-the-board matches: if they are displayed, the players' identity and their moves can be shown.
- **Removal is not built.** The spec plans tombstones ([SH-03](../spec/05-storage.md#SH-03), [OV-02](../spec/05-storage.md#OV-02),
  [§5 overlays](../spec/05-storage.md)) and [decision 0016](0016-enrichment-overlays.md) says they are still to build. Sealed shards are protected by a digest
  ([decision 0017](0017-trusted-sealed-shards-and-derived-replay.md)), and hash files carry the content hash of every match into the next data repository
  ([decision 0018](0018-external-shards-and-hash-files.md)).

## Proposed design

### 1. Three origins, and what each one shows

| Origin | How it is known | Names shown |
|---|---|---|
| **Online platform** | Detected (below) or declared by the contributor | The contributor's own side as they choose (2); the opponent as a pseudonym (3) |
| **Over the board** (tournament, club, home) | Declared by the contributor: `"origin": "otb"` in the sidecar, a box on the Contribute page, a field of the issue form | Real names, like chess databases (5) |
| **Unknown** | Nothing detected, nothing declared | Treated as online: pseudonyms (owner's choice, 2026-10-08) |

**Detection.** Online platforms are recognised by the `Site` tag, the dialect, the program named in an `.sgf` (`AP`/the engine of an attachment), and
the file name. The list to cover: Backgammon Heroes, OpenGammon, Backgammon Galaxy, BackgammonHub, NextGammon, backgammon.com, plus the servers already
listed in `SERVERS` (`packages/core/src/metadata.js`), which already sorts out a server name from an event ([decision 0022](0022-event-round-from-headers-and-file-names.md)):
FIBS, DailyGammon, GridGammon/GamesGrid, PlayOK, Safe Harbor Games, choue.net, Foxamon. Programs (XG, GNU Backgammon, BGBlitz, Backgammon Studio,
HedgeHog) are not platforms: a file saved by a program has an unknown origin unless the program's file says it was an online game.

**The platform name is not shown.** It is replaced by `online` in `provenance.site` and dropped from the `Site` tag of the normalised `.mat` and from
attachments (owner's choice, 2026-10-08). Reason: with the date and the moves, the platform name is what lets someone search the platform's own records.

### 2. The contributor's own side

On the Contribute page each match asks *"Which player are you?"* (player 1, player 2, neither). That side keeps the handle that is in the file (for
example `s4mu3l`), because the person concerned is the one choosing to publish it. An option could show the contributor's GitHub login there instead (it
is verified by GitHub, and already public in the repository history). "Neither" means both sides get pseudonyms.

What can't be checked: GitHub can't prove that a GitHub account owns the platform handle written in the file. Someone could claim to be a player they are
not, which would publish that player's handle. Ways to limit it: allow keeping the own handle only when it matches a handle the contributor has used before,
or always show the GitHub login rather than the platform handle (no impersonation possible: the login is the contributor's own).

### 3. Opponent pseudonyms: stable for one contributor, unlinkable between contributors

The goal stated by the owner: the contributor can find the matches they entered, and can see that the same opponent appears in several of them, without
anyone being able to tie that opponent to their account on the platform.

- **Why not a plain hash of the handle.** A public function (`sha256("hmjames")` turned into a name) gives the same result to everyone: anyone who knows a
  handle computes its pseudonym and finds all that person's matches. That defeats the purpose. A slow hash doesn't help either, because a targeted search
  only needs one computation.
- **A secret key per contributor.** The pseudonym is `HMAC-SHA-256(key, platform + "\n" + normalised handle)`, turned into a readable name: two words from a
  fixed list plus four hex characters, for example `anon-heron-7f3a`. Without the key, nobody can compute it.
- **The key belongs to the contributor.** The Contribute page creates a random key the first time (WebCrypto), keeps it in the browser, and lets the
  contributor save it to a file and load it on another computer. The CLI takes the same key (`--key-file`), so a contributor using git gets the same names.
  No secret is kept by the project, so there is no project key that could leak or be demanded.
- **Consequences of this choice:**
  - The same opponent gets the *same* pseudonym in all the matches of one contributor (what the owner asked for) and *different* pseudonyms with two
    contributors. Nobody can link "this opponent played contributor A and contributor B".
  - A lost key means new pseudonyms for the same opponents from then on. Old matches are not changed.
  - The contributor can recompute the mapping, which is fine: they already know their opponents' handles.
  - The opponent's handle never leaves the contributor's computer.
- **Alternatives considered:**
  - *A new pseudonym per match* (`Player-fc7f-B`): simplest and safest, but the contributor can't see a recurring opponent.
  - *One project key held as a GitHub secret*: the same opponent would have one pseudonym across all contributors. Player search would work for online
    matches, but it links games across contributors. It is also not possible in practice, because of point 4.
  - *Plain `Player 1`/`Player 2`*: all online matches look alike in lists.

### 4. Anonymisation happens before the upload, never after

A file is public as soon as it is submitted:
- a pull request keeps its commits under `refs/pull/<n>/head` forever, even after a force push of the branch;
- a ZIP dropped into an issue gets a public URL (`user-attachments`), and the issue title holds the players' names (issues #9 and #11 of `bgdb-data-1`
  are titled with handles);
- the bot's comment quotes the names.

So ingestion can't be the place where names are replaced. The Contribute page already reads and checks files in the browser with the same core as the
tools ([decision 0015](0015-contribution-loop.md), [contributing-flow.md](../contributing-flow.md)). It would rewrite the files (the normalised `.mat`, and
attachments: names in an `.sgf` (`PB`/`PW`), in an `.xg` with the method of `scripts/xg-rename.mjs`) and build the ZIP, the issue title and the pull request
from the rewritten files only. The match identity does not change, since it depends on the positions only ([decision 0003](0003-canonical-match-hash.md)).

What else is cleaned with the names: the `Transcriber` and comment lines (they often hold a handle), the site's `Match ID` (already dropped, decision 0010),
and the platform name (point 1).

Still open: whether to drop the **time** (05:15 narrows the search on the platform) or keep the date only to the month.

**`provenance.originalHash`** is the SHA-256 of the file as submitted, before normalisation. Nothing uses it today; it records which file the match came
from. Computed on the raw file, it would let the opponent or the platform prove that their own export is that game. Computed on the file already rewritten
by the Contribute page, it is harmless. Proposed: keep it, computed after the rewrite.

### 5. Over-the-board matches: real names

A match declared `otb` keeps the players' names, the event, the venue and the transcriber, as decision 0010 does today. The Contribute page says what this
means: *"The names and moves of an over-the-board match are published, like chess games. A player can ask for a match to be removed."* The right to object
is what makes this defensible, so it depends on point 6 being built.

Open question: whether a declared over-the-board match whose `Site` names an online platform is refused, or the declaration wins.

### 6. Erasing a match

`bgdb erase <id> --reason <category>` (maintainer only):
1. Removes the match's `.mat`, `.meta.json` and attachments from its shard, and updates `shard.json` counts.
2. If the shard is sealed, writes its new digest and an entry in the erasure log: sealing protects against accidental change, not against a deliberate,
   logged removal. [SH-03](../spec/05-storage.md#SH-03) needs rewording ("sealed shards change only by a logged erasure").
3. Adds the content hash to `data/erased.tsv`, which `check`, `review` and `ingest` read: the same match submitted again (in any notation, any format) is
   refused with "this match was removed at a player's request". The list holds hashes only, no names. It is carried to the next data repository like the
   hash files of decision 0018, and the erased line is removed from those hash files.
4. The next build and Pages deployment drop it from the site, the catalogs and the player index.
5. The erasure log (`data/erasures.md`, required by [CR-02](../spec/10-contribution.md#CR-02)) records the date, the id and the reason category
   (*player request*, *contributor withdrawal*, *rights*, *legal*), without names.

A tombstone overlay (hide without deleting) is not enough for a person's request: the files would stay in the current tree. It is still useful for a match
hidden for another reason (a disputed transcription), and keeps its place in the spec.

**What erasure can't reach:**
- **The git history** keeps the files. Removing them from history means rewriting it and force-pushing. GitHub still keeps the `refs/pull/<n>/head` refs and
  cached views: only GitHub Support can purge them (or deleting and recreating the repository).
- **Issue attachments** keep their URLs even after an issue is edited or deleted (also a GitHub Support request).
- **Forks, clones, mirrors and archives** made before the erasure. Data published under CC0 ([decision 0009](0009-data-licence.md)) can be reused freely, and
  the project can't recall copies.

This is why point 4 matters more than point 6: a name that is never published never needs erasing.

### 7. Finding the matches one contributed

Every match already records the GitHub login of its contributor (`provenance.contributor`). The site gets a "submitted by" filter (search and match page),
so a contributor finds their own matches whatever the names in them.

### 8. A safety net in CI

The shared check (`analyzeGroup`, [decision 0015](0015-contribution-loop.md)) gets a new error, `V-HANDLE`, for an online or unknown-origin match where a
side is neither a pseudonym (`anon-…`) nor declared as the contributor's own side. The message points to the Contribute page. By the time CI sees the
file it is already public (point 4), so this protects the stored data, not the pull request.

## What would change if accepted

- [Decision 0010](0010-privacy-and-anonymisation.md): "ingestion keeps player names and handles" is replaced by "real names over the board, pseudonyms online".
- Spec: [RP-03](../spec/11-rights-governance.md#RP-03) (online pseudonyms, OTB names, the erasure path), [CR-02](../spec/10-contribution.md#CR-02) and
  [SH-03](../spec/05-storage.md#SH-03) (logged erasure, sealed shards included), [§10 contribution](../spec/10-contribution.md) (`origin`, which side is
  the contributor, `V-HANDLE`), [V-RIGHTS](../spec/10-contribution.md).
- Code: `packages/core` (platform detection, pseudonyms, rewriting of `.mat`/`.sgf`/`.xg`), the Contribute page (`site/contribute.html`, `site/guide.html`:
  the key, the questions), `bgdb erase` ([commands.md](../commands.md)), search by contributor ([site.md](../site.md)), the issue form and
  `CONTRIBUTING.md` of [templates/data-repo](../../templates/data-repo/).
- Docs: [data-repositories.md](../data-repositories.md) (the erasure and history-rewrite procedure for the maintainer).

## Questions for the platforms' forums

For each of Backgammon Heroes, OpenGammon, Backgammon Galaxy, BackgammonHub, NextGammon, backgammon.com:
1. May a player republish the record of a game they played (dice and moves), under a public-domain dedication (CC0)?
2. Does the platform object to the platform name being shown? (The current design drops it anyway.)
3. Is the opponent's agreement needed when the opponent appears only under a pseudonym that can't be linked to their account?
4. Do the terms forbid exporting games in bulk (more than one's own)?

## What the platforms say

- **BackgammonHub** (privacy policy, https://www.backgammonhub.com, read 2026-10-08). The site applies the UK and EU GDPR. A player may have their
  account erased. Completed matches are not deleted: the player's identity in them is anonymised and shown as "Deleted player", and their username is
  retired. A copy of a match published elsewhere would keep the handle after that erasure, and BackgammonHub could not reach it. **The owner's conclusion:
  the handles of other online players can't be published.** This supports the pseudonyms of points 1 to 4 (and dropping the platform name).
- The other platforms: still to ask (questions above).

## Done so far

- **2026-10-08.** In `bgdb-data-1`, the two online matches were erased by hand (open shard, so no digest): `0001/6b01e8a3a4af0956` (with its `.sgf`) and
  `0001/fc7ff6f26a3e9b78`; `shard.json` counts are 2 matches, 2 games. The two Hadar vs Sam matches stay. They are home games between the owner and
  their daughter, kept at the owner's choice.
- **2026-10-08, clean-up.** The repository was deleted and recreated, as the cheapest way to remove everything GitHub kept:
  - `pipandlove/bgdb-data-1` and the fork `sambot1981/bgdb-data-1` (which held the old history) were deleted. Their issues, the pull request refs
    and the attachments went with them.
  - The repository was recreated, public, with one commit holding the two Hadar vs Sam matches (`npm run publish-data-repo -- bgdb-data-1 --public`).
    Its Pages site has the same address, so `sources.json` is unchanged.
  - The `BGDB_BOT_TOKEN` secret had to be set again ([data-repositories.md](../data-repositories.md#3-the-two-secrets)).
  - Copies made before 2026-10-08 (clones, caches) can't be reached.
