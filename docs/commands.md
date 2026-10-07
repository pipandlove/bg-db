> [bg-db](../README.md) · [Documentation](README.md)

# Command reference

Every command of the repository, what it reads, what it writes, its options and its exit codes.
Run `node packages/cli/bin/bgdb.js help` (or `npm run bgdb -- help`) for the short list and
`bgdb <command> --help` for one usage line. Paths are relative to the repository root.

Typical flow: `check` a file, put it in `inbox/`, `ingest`, `build`, `serve`. Since [decision 0024](decisions/0024-data-repositories.md) `inbox/` and `data/` live in a
**data repository** (`bg-db-data-1`, ...) checked out next to `bg-db`: run the commands from there (its `package.json` has `npm run ingest`, `build`, `serve`, `check` and
`bgdb`, which call `../bg-db`), or from `bg-db` with `--inbox ../bg-db-data-1/inbox --data ../bg-db-data-1/data --config ../bg-db-data-1/bgdb.config.json`.

| npm script | Runs |
|---|---|
| `npm test` | all tests (core, CLI, update script) |
| `npm run check` | `bgdb check fixtures --recursive` |
| `npm run ingest -- <options>` | `bgdb ingest <options>` |
| `npm run build` | `bgdb build` |
| `npm run serve` | `bgdb serve dist` |
| `npm run update -- <folder> [--apply]` | `scripts/update-from-zip.mjs` |
| `npm run bgdb -- review` | check what a pull request would do (see below) |
| `npm run new-data-repo -- <name>` | `scripts/data-repos.mjs new`: make the next data repository (see below) |
| `npm run publish-data-repo -- <name>` | `scripts/data-repos.mjs publish`: put a data repository made with `--local` on GitHub, or check its settings (see below) |
| `npm run switch-data-repo` | `scripts/data-repos.mjs switch`: move the contributions to it (see below) |
| `npm run spec-index` | regenerates `docs/spec/requirements.md` from the specification (a test fails if it is stale) |

Exit codes (all `bgdb` commands): **0** success, **1** the work was done but some file had a problem (invalid match,
build error, `--check` found work to do), **2** the command could not run (bad usage, unreadable folder, unsafe output folder).

## bgdb check

`bgdb check <file|dir>... [--recursive] [--json] [--salvage] [--out dir]`

Validates match files **without changing anything** and prints, for each file, its 16-character match identifier,
players, length, number of games and final score. Every move is replayed (see [diagnostics](diagnostics.md)).

| Option | Meaning |
|---|---|
| `<file\|dir>...` | one or more files, or folders (`.mat`, `.txt`, `.sgf`, `.xg`) |
| `--recursive` | also look inside sub-folders |
| `--json` | print one JSON report per file (id, players, score, `errors`, `warnings`, `infos`) |
| `--salvage` | show what `bgdb ingest --salvage` would keep of a file that fails (a match added partially) |
| `--out` | write the normalised `.mat` of each valid file into this folder: exactly what would be stored (with `--salvage`, the partial match), to look at it or open it in another program |

Reads: the given files. Writes: nothing, except the `.mat` files of `--out`. Exit 1 if any file is invalid.

```
$ bgdb check fixtures/foxamon
OK    d2fe694645e0abc1  tester vs Osprey12  3pt  1 games  4-0  (tester_vs_Osprey12_2026-08-10.mat)
   info    V-SCORE: Game 1: the site counts 3 point(s) (capped at the match length) instead of 4
```

## bgdb ingest

`bgdb ingest [--inbox inbox] [--data data] [--contributor name] [--date YYYY-MM-DD] [--dry-run] [--max-matches n] [--max-mb n] [--salvage] [--report file] [--config file]`

Moves valid matches from the inbox into the **open shard**: each match is validated, de-duplicated by content, rewritten in the
normalised `.mat` form (read back to make sure it is identical) and stored with its metadata sidecar. Invalid files stay in the
inbox with an explanation; duplicates are reported and removed from the inbox. When the open shard reaches a limit it is sealed
and the next shard opens. Site match identifiers are never stored.

**A ZIP in the inbox** (the Contribute page's, uploaded as it is) is unpacked first into a folder next to it (`x.zip` gives `x/`) and deleted; a dry run reads
it in place. It is read defensively (`readZip` of the core: at most 500 entries, 10 MB each, 50 MB in all, no encrypted or ZIP64 entries, plain file names
only); one that cannot be read stays in the inbox, reported as an error. **Notes** are never read as matches: `CONTRIBUTION.md` (the page writes it into its
ZIP, with the rights statement), `README.txt` and `README.md` (except the inbox's own); the ingest removes them once it has run.

**A contribution is a group of files with the same base name** (spec ATT-01):

| File | Role |
|---|---|
| `name.mat` or `name.txt` | the match as text (primary) |
| `name.sgf` | GNU Backgammon SGF, possibly with analysis: kept as an attachment (verified: it must be the same match); if it is the only file it is also the match itself |
| `name.xg` | eXtreme Gammon file: read like the others, so it can be the match itself; next to a text or SGF version it is verified against it and kept as an attachment (an unreadable variant is kept unchecked, with a warning) |
| `name.bgdb.json` | optional extras: `{"links": [{"url": "https://youtu.be/...", "title": "...", "game": 2, "time": 95}], "tags": ["final"], "illegal": [{"game": 6, "row": 19, "player": "Name"}]}`; `illegal` declares plays that were made although illegal; `"accept": "partial"` agrees that the match is added partially when some games cannot be read (decision 0021); `"event"`, `"round"` and `"date"` (`2025-07-26`, `2025-07` or `2025`) are reviewed values that replace what the headers say, `null` for none (decision 0022, written by `bgdb meta --apply`) ([formats](formats/README.md#illegal-plays-made-in-real-matches)) |

**Event and round** come from the headers, cleaned automatically (decision 0022): a placeholder such as `Event "Online match"` or
`Round "Round 0"` is left out, and when there is no event, a `Site` tag that names a server and an event (`Galaxy Backgammon River Cup Final 2025`)
gives the event (`River Cup Final 2025`). A place (`Site "Monte Carlo"`) or what a file name suggests is never applied by itself: it goes through
`bgdb meta`. A new match that the list could not tell apart from another one (same players, date, event, round and length) is added with
a `V-META` warning.

A video link can also be written in the header of the text file, one tag per link: `; [Video "https://youtu.be/xxxxxxxxxxx"]`.
Only `https` YouTube links are accepted; they are rebuilt from the video id. Bad links, bad tags, unreadable or oversized attachments
are skipped **with a warning** and never block the match.

| Option | Default | Meaning |
|---|---|---|
| `--inbox` | `inbox` | folder to read (searched recursively) |
| `--data` | `data` | folder holding the shards (`data/0001`, ...) |
| `--contributor` | none | recorded in each match's provenance (a GitHub handle, for instance) |
| `--date` | today | submission date recorded in provenance (use it for reproducible runs) |
| `--dry-run` | off | report what would happen, write and delete nothing |
| `--max-matches` | from config | seal threshold override (default `sealPolicy.maxMatches`, 5 000) |
| `--max-mb` | from config | size threshold override in MB of files in the shard, attachments included (default `sealPolicy.maxMB`, 300) |
| `--salvage` | off | for bulk imports of old archives: keep what is clear of a match that fails ([partial-matches](partial-matches.md)). A game whose moves cannot be read is kept by its result when two sources confirm it, and left out otherwise; the winner of the match must stay known. In a money session, unreadable games are left out. Without it, the errors are reported so the file can be fixed |
| `--report` | none | write a JSON summary: the counts (`added`, `waiting`, ...), the shards sealed, and `repo` (size in MB, limits, `state` ok / warn / stop, `closed`); the ingest workflow reads it |
| `--config` | `bgdb.config.json` | licence, name, seal policy (`maxAttachmentKB`, default 2048), allowed video hosts, and the keys of a data repository below |

Reads: `inbox/`, `data/*/matches`, `data/hashes/` (matches of shards that were moved away), the config. Writes: `data/<shard>/shard.json`, `matches/<h2>/<hash>.mat`, `<hash>.meta.json`, and
`attachments/<h2>/<hash>.sgf|.xg`; deletes the files of every ingested or duplicate group from the inbox. Never writes into a sealed shard.
A match that could only be added **partially** (some games cannot be read) is added only if its `.bgdb.json` says `"accept": "partial"` (or with `--salvage`); otherwise it stays in the inbox (`PARTIAL`, with its errors, what would be kept and how to accept). Exit 1 if any group was invalid or waits for acceptance.

**Two transcriptions of one match** (the same players and length, at least 95% of the rolls in common, decision 0023): when one copy is
better (valid, against valid only by salvage or refused), it is kept and the others are reported `superseded`, skipped and removed from
the inbox; what they know and it does not (event, round, date) is kept. When none is better, both are stored with a `V-COPY` warning
(choose in `bgdb meta`). Copies are compared before the first file is stored, which reads those files in full (about a minute for
thousands of files).

**A duplicate that brings something new** (a video link, tags, an SGF or XG file the match does not have yet, an event, round or date in its `.bgdb.json` that differs) **enriches the existing match** instead of being skipped: an enrichment record is written in `data/enrichments/` (see `bgdb enrich`), the shard is not touched, and the files leave the inbox. A duplicate that brings nothing new is only reported. When a shard is sealed, a digest of its files is recorded in its `shard.json` (see `bgdb build` and `bgdb verify`).

**A data repository among several** ([decision 0024](decisions/0024-data-repositories.md)). Three keys of the configuration:

| Key | Default | Meaning |
|---|---|---|
| `firstShard` | none | the number of this repository's first shard. Shard numbers are global: without it, a new shard gets the number after every shard this repository knows of (its own, the hash files in `data/hashes/` copied from earlier repositories, `externalShards`). A `firstShard` that would reuse one of those numbers stops the ingest (exit 2) |
| `repoPolicy` | `{"warnMB": 800, "stopMB": 950}` | the size of the repository, measured at each ingest: the larger of `data/` and the packed git history. Above `warnMB` the ingest says it is time to prepare the next repository (and the workflow opens an issue); above `stopMB`, even during a run, it **adds nothing more**: new matches stay in the inbox (`waiting`) for the next repository |
| `closed` | `false` | `true`: the repository takes no more contributions. The review answers `closed`, the issue form refuses; the ingest still files what was merged into the open shard, but opens no new shard (the matches wait) |

The output ends with the size: `repository: 812.4 MB (data 790.2 MB, git 812.4 MB), above 800 MB: time to prepare the next data repository`. Matches that wait are not an error (exit 0): what was added is committed.

## bgdb meta

`bgdb meta [--inbox inbox] [--data data] [--sheet meta-review.tsv] [--apply sheet] [--rejected dir] [--dry-run] [--config file]`

The review of event, round and date **before an ingest** (decision 0022). File names often hold what the headers lack ("12 matches of a
final, numbered 1 to 12 only in their names"); this command reads them, but never applies them by itself.

1. `bgdb meta --inbox inbox` reads every match of the inbox (parse only, a few seconds for thousands of files), cleans the headers as
   the ingest does, applies the sidecars, and writes a **review sheet** (tab-separated text: open it in a spreadsheet or an editor).
   One row per match that needs a look, in this order:
   - `same`: nothing tells it apart from another match of the inbox, or from a stored one (same players, date, event, round and
     length), even with the file names. Give it a round.
   - `series`: it looked the same as others, and the file names (`1. Match`, `#2`, `3v5`, `Match4`, `qf2`) or the times of play (in the
     file, else in its name) tell them apart: the proposed round says which match of the series it is (`Final - Match 3`, `Match 2 of 4`).
   - `name`: the file name gives an event, round or date that the headers do not.
   - `near-duplicate`: another transcription of the same match (same players and length, at least 95% of the rolls in common) when
     no copy is better: both are valid but differ. The note gives the first difference. Put `reject` in the column `action` on the
     one to drop, or leave both ([decision 0023](decisions/0023-transcriptions-of-one-match.md)).
   - `superseded`: another transcription of a match that a better file gives (valid, against valid only by salvage or refused): the
     ingest keeps the better one by itself. Nothing to do.
   - `duplicate`: a copy of another file of the inbox: the same text once the header lines are left out, or, among matches that look
     the same, the same match identifier (computed for those only, as the ingest does). Nothing to do: the ingest keeps one.

   The columns `from` and `note` say where each value comes from. The headers are not in the sheet when nothing changes them.
2. Edit the columns `date`, `event` and `round` (an empty cell means none; delete the rows you do not want to apply), and `action`
   (`reject`, or nothing); save as text.
3. `bgdb meta --inbox inbox --apply meta-review.tsv` writes the values that differ from the headers into each match's `.bgdb.json`
   (other keys are kept), and moves the files of every row marked `reject` into `rejected/` next to the inbox (`--rejected` for
   another folder), with the reason appended to its `REASONS.md`. After a restart, applying the same sheet rejects them again. `--dry-run` counts without writing. Run step 1 again to see what is left.

| Option | Default | Meaning |
|---|---|---|
| `--inbox` | `inbox` | the files to review |
| `--data` | `data` | stored matches, to find new files that look the same as them |
| `--sheet` | `meta-review.tsv` | where the sheet is written |
| `--apply` | none | a reviewed sheet: write its values into the sidecars, move the rejected files out of the inbox |
| `--rejected` | `rejected` next to the inbox | where `reject` moves files |
| `--dry-run` | off | with `--apply`: count, write nothing |
| `--config` | `bgdb.config.json` | as for `ingest` |

Exit 1 if rows of the sheet were refused (an unknown file, a date not written `2025-07-26`), 2 for a missing inbox or sheet.
For a match that is already stored, use `bgdb enrich <id> --round ...`.

## bgdb build

`bgdb build [--data data] [--out dist] [--site site] [--sources file] [--cache file] [--no-cache] [--config file]`

Produces the folder to publish: registry, per-shard summary and manifest, compressed catalog, the match files and their metadata, the attachments, the **overlay of enrichments** (`overlays/`) and the
contents of `site/`, plus an empty `.nojekyll` file so that GitHub Pages serves everything as it is ([deploy.md](deploy.md)). **An open shard is read in full**: every match file is parsed and checked against its hash and result, and every attachment against its recorded hash; a damaged or missing file stops the build. **A sealed shard that still matches the digest recorded when it was sealed is trusted**: its matches are not read again. **A match file already checked by an earlier build is not read again either**: the build cache remembers each match that passed, by a digest of its file's bytes, its recorded hash and its result, and the whole cache is dropped when the code of `packages/core` changes (decision 0024). A changed file, or a changed result in its metadata, is read again. The output says how many of each: `N read in full, C checked by an earlier build, M trusted by their seal`; it never depends on the cache. If its files no longer match the digest, the build stops, and reads every match to name the damage. A sealed shard without a digest is read in full, with a note. Shards listed in `externalShards` are only added to the registry. The replay data is not published: the browser derives it from the match file. The output is deterministic
(two builds of the same data are identical). Formats: [shard-and-index.md](formats/shard-and-index.md).

While it checks an open shard, the build shows an ASCII progress bar (`shard 0001 [###############...............]  50%  1500/3000 matches checked`), redrawn in place on a terminal; when the output goes to a pipe or a log it prints that line every 250 matches and at the end of each shard instead.

| Option | Default | Meaning |
|---|---|---|
| `--data` | `data` | shards to read |
| `--out` | `dist` | output folder, **deleted and recreated**; refused if it contains `data`, `site` or the current folder |
| `--site` | `site` | static site files copied to the root of the output (ignored if the folder does not exist) |
| `--sources` | none | the list of data repositories the site reads ([`sources.json`](formats/shard-and-index.md#sourcesjson-the-data-repositories-a-site-reads), decision 0024): checked, then published next to the page; a mistake stops the build (exit 2). Without it, the site reads the registry next to it |
| `--cache` | `.bgdb-cache/build.json` next to the data folder | the build cache; refused inside the output folder (it is deleted at every build) |
| `--no-cache` | | read every match of the open shards in full, and write no cache |
| `--config` | `bgdb.config.json` | name, licence, seal policy, capabilities written into `registry.json` |

Reads: `data/` (shards, `enrichments/`, `hashes/`), `site/`, config, the cache. Writes: `--out` and the cache (ignored by git). Exit 1 on a damaged match, 2 on an unsafe output folder.

## bgdb enrich

`bgdb enrich <id> [--link url] [--title text] [--game n] [--time seconds] [--tags a,b] [--sgf file] [--xg file] [--event text] [--round text] [--match-date YYYY-MM-DD] [--data data] [--contributor name] [--date YYYY-MM-DD] [--dry-run] [--config file]`

Adds a YouTube link, tags, an SGF file or an XG file to a match that is **already in the database**, or corrects its event, round or date, without touching its shard (so it works for sealed shards and for shards that were moved to another repository). The match is named by its id (`0001/2359e4c944b8d130`)
or by the first 8 or more characters of its hash. The same rules as for a contribution apply: only `https` YouTube links (rebuilt from the video id), tags of lower-case letters, digits and `-`, an SGF that must be **the same match** (it is checked against it; it may carry analysis),
an XG file that must start with `RGMH` (it is read and must describe the same match), a size limit (`sealPolicy.maxAttachmentKB`). A match has at most one SGF and one XG file: a second one is not added, with a note. What is already there is not added twice, so running the command again says "nothing new".

The result is a record in `data/enrichments/<shard>/<h2>/<hash>.json` (with the attachment files next to it); `bgdb build` publishes all records as one overlay and the site applies it. Exit code 1 for refused input, 2 for bad usage.

| Option | Meaning |
|---|---|
| `<id>` | the match |
| `--link`, `--title`, `--game`, `--time` | a video link, with an optional title, the game it shows and the start time in seconds |
| `--tags a,b` | tags, comma separated |
| `--sgf file`, `--xg file` | an attachment |
| `--event`, `--round`, `--match-date` | corrections (decision 0022): they replace the values of the match and of earlier corrections; `""` for none. The site shows and searches the corrected values |
| `--contributor`, `--date` | recorded in the enrichment record |
| `--dry-run` | say what would be added, write nothing |

## bgdb verify

`bgdb verify [--data data] [--shard id] [--record]`

Reads **every match of the shards in full** (parse, validate, compare with the metadata and the hash, check the attachments) and reports the damaged ones. With `--record`, a **sealed** shard without errors gets the digest of its files recorded in
`shard.json`: from then on the build trusts it without reading its matches. Use it once for a shard that was sealed before digests existed, or as a pre-release check. Exit code 1 if any error was found.

## bgdb split

`bgdb split <id> --to <folder> --base <url> [--remove] [--data data] [--config file]`

Moves a **sealed** shard to the data folder of another repository (see [growing.md](growing.md#4-moving-one-sealed-shard-by-hand-bgdb-split)). It verifies the shard (and records its digest), writes `data/hashes/<id>.tsv` (the content hash of each match, so that `ingest`
and `enrich` still know the moved matches), and copies the shard to `<folder>/<id>/`. With `--remove` it also deletes the shard here and adds it to `externalShards` in the configuration. `--base` is the **absolute address** (ending with `/`) where the other repository will publish the shard,
for example `https://user.github.io/bg-db-data/data/0001/`. Refuses an open or unknown shard, a bad address, and a destination that is not empty. Exit code 1 when refused, 2 for bad usage.

## bgdb review

`bgdb review [--inbox inbox] [--data data] [--changed file] [--body file] [--author name] [--welcome] [--report file] [--comment file] [--config file]`

Checks what a pull request that adds files to `inbox/` would do, **without writing anything** to `data/` or changing `inbox/`. Every contribution (a group of files, see ingest) is checked with the same code as `ingest`
and as the "Contribute" page; the result is a **verdict**, **labels**, the decision whether the pull request may be **merged automatically**, and the text of the bot's comment.
It runs in the workflows of the repository ([contributing-flow.md](contributing-flow.md)), and you can run it yourself before opening a pull request.
A ZIP in the inbox is reviewed in place, its matches shown as `x.zip/<file>` (see ingest).

| Verdict | Meaning | Labels | Auto-merge |
|---|---|---|---|
| `ready` | everything valid (new matches, or extras that enrich existing ones), only `inbox/` changed, rights box ticked (or the rights statement of a `CONTRIBUTION.md`, which the Contribute page writes into its ZIP) | `ready`, `auto-merge` | yes |
| `needs-fix` | an error, the rights box not ticked, more than 500 matches | `needs-fix` | no |
| `needs-review` | valid, but it changes files outside `inbox/`, or contains an illegal play that was made (`V-ILLEGAL`) | `needs-review` | no |
| `needs-confirmation` | valid except that a match can only be added **partially** (some games cannot be read) and the contributor has not agreed yet: the comment shows what would be kept, the errors (to fix the file instead), how to agree (`{"accept": "partial"}` in the match's `.bgdb.json`) and the `.mat` that would be stored | `needs-confirmation`, `partial` | no |
| `duplicate` | everything is already in the database and brings nothing new | `duplicate` | no |
| `empty` | no match file in `inbox/` | `needs-fix` | no |
| `closed` | the data repository is closed (`"closed": true`, decision 0024): the comment asks to send the files again from the Contribute page, which sends them to the repository that takes new matches | `closed` | no |

The labels `enrichment` (a duplicate brings something new for an existing match), `partial` (a match is, or would be, added partially) and `bulk` (20 matches or more) are added when they apply.

| Option | Meaning |
|---|---|
| `--inbox`, `--data`, `--config` | as for `ingest` (defaults `inbox`, `data`, `bgdb.config.json`) |
| `--changed file` | a text file with the paths changed by the pull request, one per line (from `git diff --name-only`); anything outside `inbox/` makes it `needs-review` |
| `--body file` | the pull request description; the rights line `- [x] I have the right ...` must be ticked (without `--body` the rights check is skipped, as in a local run) |
| `--author name` | the contributor, named in the comment |
| `--welcome` | add a welcome for a first contribution |
| `--report file` | write the report as JSON (verdict, labels, autoMerge, reasons, one entry per contribution) |
| `--comment file` | write the comment as markdown (it starts with `<!-- bgdb-review -->` so that it can be updated in place); text that comes from files is escaped |

Exit code 1 for `needs-fix`, `empty` and `closed` (so that the check fails), 0 otherwise.

## bgdb from-issue

`bgdb from-issue --body file --number n [--inbox inbox] [--result file] [--config file]`

Turns the text of an issue made with the "Submit a match" form into the file `inbox/issue-<n>.txt`, if the match is valid and the rights box is ticked; nothing is written otherwise. Used by the issue workflow
("Paste a match", [contributing-flow.md](contributing-flow.md)). The optional "Event" answer is added as a header only when the match has none. A closed data repository refuses every issue (`V-CLOSED`). `--result` receives `{ok, file, errors, comment}`; the
comment is the answer to post on the issue. Exit code 1 when the issue cannot be used, 2 for bad usage.

## bgdb anonymize

`bgdb anonymize <file|dir>... [--recursive] [--write] [--check]`

Replaces the site match identifier (`; [Match ID "..."]`) in text match files by `anonymized`. **Player handles are kept**
([decision 0010](decisions/0010-privacy-and-anonymisation.md)). Without `--write` it only reports. Binary `.xg` files are listed as skipped:
they cannot be rewritten and may contain the identifier, so do not publish them if that matters.

| Option | Meaning |
|---|---|
| `--recursive` | also look inside sub-folders |
| `--write` | rewrite the files in place (without it: a report, nothing is written) |
| `--check` | exit 1 if any file still needs anonymising (for a pre-release check); has no effect with `--write` |

Reads and (with `--write`) rewrites the given files. Idempotent. The match identity does not change.

## bgdb serve

`bgdb serve [dir] [--port 8080]`

A small static web server for local development (modules and `fetch` do not work from `file://`). `dir` defaults to `site`, which has no data and shows an error;
use `dist` (what `npm run serve` does) to see the built database ([site.md](site.md)). Adds `Access-Control-Allow-Origin: *`. Stop with Ctrl+C.

| Option | Default | Meaning |
|---|---|---|
| `[dir]` | `site` | folder to serve |
| `--port` | `8080` | port |

## bgdb help

`bgdb help [command]`

Lists the commands, or prints the usage line of one. `bgdb <command> --help` does the same.

## scripts/update-from-zip.mjs

`node scripts/update-from-zip.mjs <extracted-folder> [--repo <dir>] [--apply] [--delete] [--force]`

Updates your local repository from a folder extracted from a new `bg-db.zip`. **Dry run by default**: it lists new, changed,
removed and unchanged files. Details and safety rules are in the file header and in the README ("Updating from a new zip").

| Option | Meaning |
|---|---|
| `<extracted-folder>` | the extracted zip (or its parent: the project folder is found automatically) |
| `--repo <dir>` | repository to update (default: current folder) |
| `--apply` | copy new and changed files (requires a clean git working tree) |
| `--delete` | also remove files that no longer exist in the new version |
| `--force` | skip the clean-working-tree check |

`data/` and `inbox/` are add-only; `.git`, `node_modules` and the paths listed in `.updateignore` are never touched.
Exit codes: 0 done or dry run, 2 bad usage or wrong project, 3 uncommitted changes.

## scripts/data-repos.mjs

The steps of [decision 0024](decisions/0024-data-repositories.md) that the maintainer takes, on their own machine with their own `gh` login (no workflow creates
repositories). Data repositories are checked out next to `bg-db` (`../<name>`); commits there use the git identity of the `bg-db` repository. Both change
`sources.json` without committing it: review it and commit it in `bg-db`, which publishes the site. The procedures, step by step (installing `gh`, the secrets, the settings, undoing): **[data-repositories.md](data-repositories.md)**.

`npm run new-data-repo -- <name> [--owner o] [--tools-ref v7] [--first-shard n] [--public] [--local] [--dry-run]`

First checks that `gh` is installed and logged in and that the tools are on GitHub (not with `--local`): if not, it stops before making anything. Then it makes `../<name>` from `templates/data-repo/` (five workflows that call the reusable workflows of `bg-db` at the tag `--tools-ref`, `bgdb.config.json` with
`firstShard`, README, CONTRIBUTING, the issue form), commits it, writes `sources.json`, creates it on GitHub and pushes, allows squash merging, creates the label `submission`, turns Pages on
(and sets `PUBLISH_AFTER_INGEST`, and publishes it once), and, while `bg-db` is private, lets its workflows be called. It sets no branch rule: the bot's review decides the merge. It lists the new
repository in `sources.json` as `current` if it is the first, else `next` (nothing changes for contributors yet). If the GitHub part stops half way, the folder and
`sources.json` are kept, and `publish-data-repo` finishes it.

| Option | Meaning |
|---|---|
| `<name>` | the repository, for example `bg-db-data-2` |
| `--owner o` | the GitHub account (default: the owner of the current data repository, else of `repository` in `bgdb.config.json`) |
| `--tools-ref v7` | the tag of `bg-db` its workflows use (default: `DEFAULT_TOOLS_REF` in `scripts/data-repos.mjs`, `v7`); it must exist on GitHub before the first workflow runs |
| `--first-shard n` | the number of its first shard (default: after every shard of the repositories in `sources.json`, which must be checked out) |
| `--public` | create it public (default private) |
| `--local` | make the folder, the commit and `sources.json` only: nothing on GitHub |
| `--dry-run` | print the steps, do nothing |

A GitHub setting that is refused (Pages on a private repository of a free plan) is a warning that says what to do by hand, not a failure.
Secrets cannot be made for you: the output warns about `BGDB_BOT_TOKEN` (pull requests made from issues) and, while `bg-db` is private, `BGDB_TOOLS_TOKEN`
when they are missing ([data-repositories.md](data-repositories.md#3-the-two-secrets)).

`npm run publish-data-repo -- <name> [--public] [--dry-run]`

The GitHub part of `new-data-repo`, for a data repository listed in `sources.json` and checked out at `../<name>` with everything committed: creates it on GitHub
and pushes (or pushes to it when it exists), then the settings, then the warnings for what is missing. Safe to repeat: run it again after changing the plan, the
visibility or the secrets, to check.

`npm run switch-data-repo [-- --local] [--dry-run]`

From the `current` data repository to the `next` one. Run it again until it says it is done: it closes the current repository (`"closed": true`, committed and pushed),
then stops with exit code 1 while pull requests are open there or files wait in its `inbox/`; then it seals its last shard (an empty open shard is removed instead),
copies the hash files of its shards into the next repository (so that their matches stay duplicates and can be enriched) and sets its `firstShard`, waits for the Pages
run of the old repository and archives it on GitHub, and writes `sources.json`: the old one `archived`, the next one `current`. `--local` does no pull, push or `gh`.

Exit codes of all three: 0 done, 1 waiting (run again later), 2 could not run (the message says why; nothing was changed by the step that failed).

## Common situations

| I want to... | Do |
|---|---|
| know whether a match file is valid | `bgdb check file.mat` |
| add matches to the database | in the current data repository: copy them to `inbox/` (the text file, plus its `.sgf` / `.xg` with the same name), `bgdb ingest --dry-run`, then `bgdb ingest --contributor me` |
| add a YouTube link to a match | before ingesting: `; [Video "https://youtu.be/..."]` in the text file's header, or a `name.bgdb.json` next to it. Afterwards: `bgdb enrich <id> --link ...` |
| add an SGF with analysis to a match that is already in | `bgdb enrich <id> --sgf file.sgf`, or put the SGF in the inbox |
| check that nothing in the shards is damaged | `bgdb verify` |
| move a full shard to another repository | `bgdb split` ([growing.md](growing.md)) |
| prepare the next data repository, then move to it | `npm run new-data-repo -- bg-db-data-2`, later `npm run switch-data-repo` ([data-repositories.md](data-repositories.md#8-the-next-data-repository-and-the-switch)) |
| check my files before opening a pull request | put them in `inbox/`, run `npm run bgdb -- review`; or drop them on the Contribute page of the site |
| publish the site | see [deploy.md](deploy.md) |
| see the database in the browser | `bgdb build`, then `bgdb serve dist` |
| prepare files for publishing | `bgdb anonymize <folder> --recursive --check`, then `--write` |
| apply a new zip | `node scripts/update-from-zip.mjs <extracted>` (dry run), then `--apply` |
