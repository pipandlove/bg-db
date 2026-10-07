> [bg-db](../README.md) · [Documentation](README.md)

# Importing an archive

The procedure for a bulk import of match files (a tournament archive, a collection of old transcriptions) by a maintainer, from an empty
working folder to a site to browse. Contributors use the pull-request flow instead ([contributing-flow.md](contributing-flow.md)).

## The quick way: `scripts/archive.mjs`

One command per step, run from the root of the repository. Each step shows its output as it goes (one line per file for `dry-run`
and `ingest`, a progress bar for `build`, or a line every 250 matches when the output is not a terminal) and writes it to its log at the same time, keeps the real exit code,
and ends with the next step to run.

```sh
npm run archive -- /tmp/bgtest init --contributor <name>   # folders; copies source/ into an empty inbox/; remembers the contributor
npm run archive -- /tmp/bgtest dry-run                     # -> dry-run.log; nothing written
npm run archive -- /tmp/bgtest review                      # -> meta-review.tsv: edit date, event, round
npm run archive -- /tmp/bgtest apply                       # sidecars written; what is left -> meta-left.tsv
npm run archive -- /tmp/bgtest ingest                      # -> ingest.log; compared with the dry run
npm run archive -- /tmp/bgtest build                       # -> dist/
npm run archive -- /tmp/bgtest serve                       # http://localhost:8080 (--port n)
npm run archive -- /tmp/bgtest status                      # what is there, and the next step
npm run archive -- /tmp/bgtest commands                    # the plain commands below, with the folder filled in
npm run archive -- /tmp/bgtest reset --yes                 # erase inbox/, data/, dist/, sheets, logs; copy source/ into inbox/
```

`reset` without `--yes` only lists what it would erase. `source/` and `rejected/` are never touched. Refused files that stay in the
inbox do not make `dry-run` or `ingest` fail. The sections below explain each step and give the commands it runs.

## The steps by hand

The commands run from the root of the repository. `W` is the working folder (here `/tmp/bgtest`); nothing is written in the repository
itself until you decide to (step 8).

```sh
W=/tmp/bgtest
```

## 0. Prepare the working folder

```sh
mkdir -p $W/source $W/inbox $W/data $W/rejected
# copy the archive into $W/source (any layout; files are grouped by folder and base name)
cp -a $W/source/. $W/inbox/
```

Keep `source/` untouched: **the ingest deletes from the inbox every file it stores or recognises as a duplicate**, so a re-test starts
again from `source/` (step 9).

## 1. Dry run: what would be refused

```sh
npm run bgdb -- ingest --inbox $W/inbox --data $W/data --salvage --contributor <name> --dry-run 2>&1 | tee $W/dry-run.log
tail -1 $W/dry-run.log
grep -E '^(ERROR|DAMAGED|PARTIAL) ' $W/dry-run.log
```

Nothing is written. The last line counts what would be added, the duplicates and the files with errors. `--salvage` keeps what is clear
of a damaged match (games kept by their confirmed result, [partial-matches.md](partial-matches.md)); without it such files are reported.

For each refused file: fix it when a single correction is certain (keep the original and note the fix), otherwise move it out of the
inbox, with the reason:

```sh
mv "$W/inbox/<file>" $W/rejected/        # and write why in $W/rejected/REASONS.md
```

Refused files that stay in the inbox are harmless: they stay there after the real ingest, which then exits with code 1.

## 2. Review event, round and date

The headers are cleaned by the ingest itself (placeholders such as `Online match` and `Round 0` left out, the event taken from a `Site` tag
that names a server and an event). What the file names suggest, and the matches that nothing tells apart, are reviewed
([decision 0022](decisions/0022-event-round-from-headers-and-file-names.md)).

```sh
npm run bgdb -- meta --inbox $W/inbox --data $W/data --sheet $W/meta-review.tsv
```

Open `$W/meta-review.tsv` in a spreadsheet or an editor (tab-separated). Rows come in this order:

| `status` | What to do |
|---|---|
| `same` | nothing tells the match apart from another one (or from a stored match): give it a round, or an event |
| `series` | a group that looked the same, told apart by the file names or the times of play: check the proposed round (`Final - Match 3`, `Match 2 of 4`) |
| `name` | the file name gives an event, round or date the headers lack: keep, correct, or clear |
| `near-duplicate` | the same match transcribed twice, both copies valid but different (the note gives the first difference): put `reject` in the column `action` on the one to drop, or leave both |
| `superseded` | the same match transcribed twice, one copy better (valid against damaged): nothing to do, the ingest keeps the better one |
| `duplicate` | a copy of another file of the inbox (the same moves, whatever the headers or the layout): nothing to do, the ingest stores one and skips the others. A value you give here corrects the stored match |

Edit only the columns `date`, `event`, `round` and `action` (`reject` moves that file out of the inbox when the sheet is applied). An empty
cell means "none"; delete a row to leave that match as its headers say.
The columns `from` and `note` say where each value comes from. Save as tab-separated text.

## 3. Apply the review

```sh
npm run bgdb -- meta --inbox $W/inbox --apply $W/meta-review.tsv --dry-run    # count first
npm run bgdb -- meta --inbox $W/inbox --apply $W/meta-review.tsv
npm run bgdb -- meta --inbox $W/inbox --data $W/data --sheet $W/meta-left.tsv  # what is left
```

`--apply` writes the reviewed values into a `<name>.bgdb.json` next to each match (only what differs from its headers), and moves the files
marked `reject` into `rejected/`, with the reason in `rejected/REASONS.md`. After a restart (step 9), apply the same sheet again: it
rejects the same files again. Running `meta`
again shows what is still unresolved; repeat steps 2 and 3 until it is acceptable. Matches that still look the same are not refused:
the ingest adds them with a `V-META` warning, and they can be corrected later (step 7).

## 4. Ingest

```sh
npm run bgdb -- ingest --inbox $W/inbox --data $W/data --salvage --contributor <name> 2>&1 | tee $W/ingest.log
tail -1 $W/ingest.log
grep -c 'Nothing tells it apart' $W/ingest.log
```

About 5 minutes for 3 000 files. Compare the last line with the dry run of step 1: the same number added and the same duplicates.
A different count means a change in the code since the dry run: find out why before going on.

## 5. Build

```sh
npm run bgdb -- build --data $W/data --out $W/dist
```

About 4 minutes for 3 000 matches in an open shard (every match is read in full; a sealed shard is trusted by its digest).

## 6. Browse

```sh
npm run bgdb -- serve $W/dist          # http://localhost:8080
```

Check the search (players, `event:`, `round:`), the player suggestions, a few replays, a partial match.

## 7. Correct a stored match

```sh
npm run bgdb -- enrich <id> --data $W/data --event "River Cup Final 2025" --round "Final - Match 3" [--match-date 2025-07-26]
npm run bgdb -- build --data $W/data --out $W/dist
```

`<id>` is the id shown on the match page (or at least 8 characters of its hash); `--round ""` clears a value. The correction is an
enrichment record in `$W/data/enrichments/`: stored files are not changed, the site applies it.

## 8. Keep the result

The working folder is outside the repository. To publish the matches, the data goes through the usual flow (`data/` of the repository,
[growing.md](growing.md) for size limits). Not covered here.

## 9. Start again from scratch

```sh
rm -rf $W/inbox $W/data $W/dist $W/meta-review.tsv $W/meta-left.tsv $W/*.log
mkdir -p $W/inbox $W/data
cp -a $W/source/. $W/inbox/
```

Then back to step 1. Fixes and refusals decided earlier are lost with the inbox: apply them to `source/` (or keep them in `rejected/`
and remove those files again) so that they survive a restart.
