> [bgdb](../README.md) · [Documentation](README.md)

# Testing locally

Everything runs on your machine, offline. Nothing here needs GitHub, and nothing is published. Commands are for macOS and Linux (bash/zsh);
on Windows use PowerShell with `New-Item -ItemType Directory`, `Copy-Item` and `Remove-Item -Recurse -Force` in place of `mkdir -p`, `cp` and `rm -rf`.

| I want to... | Go to |
|---|---|
| run the automated tests, or one of them | [1. Automated tests](#1-automated-tests) |
| try ingest, build and the site on some files, **without touching the repository** | [2. A scratch folder (safest)](#2-a-scratch-folder-safest) |
| try it **inside a data repository** and be able to undo | [3. In a data repository, undone with git](#3-in-a-data-repository-undone-with-git) |
| test one particular behaviour (duplicates, a broken file, sealing, attachments, a switch of data repository...) | [4. Recipes](#4-recipes) |
| check the site by hand | [5. Checking the site in a browser](#5-checking-the-site-in-a-browser) |

## 1. Automated tests

```sh
npm test                                              # everything: core, command line, site, scripts
npm run check                                         # validate every match in fixtures/ (all must be valid)
node --test packages/core/test/fixtures.test.js       # one test file
node --test --test-name-pattern="illegal" packages/core/test/fixtures.test.js    # only the tests whose name contains "illegal"
npm run bgdb -- check path/to/match.txt               # one match file: is it valid, what is its identifier?
npm run bgdb -- check some-folder --recursive --json  # a whole folder, as JSON
```

`npm test` takes a few seconds. A failing test prints what was expected and what happened.

## 2. A scratch folder (safest)

`ingest` and `build` accept other folders, so the repository is not touched. Run from the repository root:

```sh
mkdir -p /tmp/bgtest/inbox
cp fixtures/extmatchdb/*.txt /tmp/bgtest/inbox/        # copy, don't move: ingest deletes inbox files

npm run bgdb -- ingest --inbox /tmp/bgtest/inbox --data /tmp/bgtest/data --dry-run   # preview only
npm run bgdb -- ingest --inbox /tmp/bgtest/inbox --data /tmp/bgtest/data --contributor me
npm run bgdb -- build  --data /tmp/bgtest/data --out /tmp/bgtest/dist
npm run bgdb -- serve  /tmp/bgtest/dist               # http://localhost:8080 (Ctrl+C to stop)

rm -rf /tmp/bgtest                                    # undo everything
```

- Run the same `ingest` a second time to see duplicates detected (copy the files into the inbox again first).
- Edit a copy of a match to break a move and ingest it: it stays in the inbox, with an explanation.
- Replace `fixtures/extmatchdb/*.txt` with your own files, in any mix of formats. To keep a text match together with its `.sgf` or `.xg`, give them the same base name.
- The site needs a built `dist/` that contains matches; with an empty database it says so.

## 3. In a data repository, undone with git

`bgdb` holds no data ([decision 0024](decisions/0024-data-repositories.md)): the matches are in a data repository checked out next to it (`../bgdb-data-1`), whose
`package.json` runs the tools of `../bgdb`. Run these from that repository. What the commands change:

| Command | Writes | Deletes |
|---|---|---|
| `npm run ingest` | `data/0001/...` (matches, attachments, `shard.json`) | the ingested and duplicate files from `inbox/` (its `README.md` stays) |
| `npm run build` | `dist/` only (ignored by git), with the site of `../bgdb` | `dist/` first |

1. Start from a clean tree: `git status` must show nothing (commit or stash first).
2. Copy files into `inbox/`, then `npm run ingest -- --dry-run`, then `npm run ingest -- --contributor me`, then `npm run build`, then `npm run serve`.
3. To undo:

```sh
git clean -fdn data inbox      # preview: lists the untracked files it would delete
git clean -fd data inbox       # delete them (the ingested matches, your copies in inbox/)
git restore data               # put the tracked shard.json files back to their old counts
rm -rf dist
```

`git clean` deletes every untracked file in those two folders, so read the preview first. If you already committed: `git reset --hard HEAD~1` removes the last commit
(not yet pushed), `git revert <commit>` undoes a pushed one.

Do not delete match files in `data/` by hand: the counts in `data/*/shard.json` would stay wrong. Use `git restore` as above.

## 4. Recipes

All of these work in a scratch folder: put `--inbox /tmp/bgtest/inbox --data /tmp/bgtest/data` (and `--out /tmp/bgtest/dist` for build) after the command.

| To test... | Do |
|---|---|
| duplicates | ingest a file, copy it back into the inbox (even under another name), ingest again: "duplicate, already in the database as ..." |
| a broken file | change one move in a copy (`24/22` to `24/21`): "V-LEGAL ... cannot be played" and the file stays in the inbox |
| a play that was made although illegal | see [formats: illegal plays](formats/README.md#illegal-plays-made-in-real-matches): remove the remarks box from `fixtures/extmatchdb/illegal-play-declared-in-remarks_7pt.txt` and ingest it (refused), then add `name.bgdb.json` with an `illegal` entry (accepted, flagged) |
| the text with its SGF/XG | copy `fixtures/choue-net/*` (text + analysed SGF) into the inbox: "+ sgf"; the file is kept under `data/.../attachments/` |
| a video link | add `; [Video "https://youtu.be/dQw4w9WgXcQ"]` at the top of a text file, or a `name.bgdb.json` with `{"links":[{"url":"https://youtu.be/dQw4w9WgXcQ"}]}`; bad links are dropped with a warning |
| sealing (a full shard) | `ingest --max-matches 2` with 3 or more files: shard `0001` is sealed with 2 matches and `0002` opens; or `--max-mb 0.1` |
| anonymising | `npm run bgdb -- anonymize fixtures --recursive` (report), `--check` (exit code 1 if work remains), `--write` (rewrite) |
| enriching a match | `bgdb enrich 0001/<hash> --link https://youtu.be/... --tags final` then `build`: the match shows the video in the list (`has:video`) and on its page; the shard folder is unchanged (`git status` shows only `data/enrichments/`). Or put an SGF of an existing match in the inbox: "enriched" |
| sealing and the faster build | `ingest --max-matches 2` with 3 files: shard 0001 is sealed and records a digest; `build` says "1 read in full, 2 trusted by their seal"; edit a file of the sealed shard: the build refuses; `bgdb verify` names it |
| making and switching data repositories | in a scratch copy: `mkdir /tmp/w && cp -r ../bgdb /tmp/w/ && cd /tmp/w/bgdb && rm sources.json`, then `npm run new-data-repo -- d1 --local`, ingest a few files in `/tmp/w/d1` (`npm run ingest` there) and commit, `npm run new-data-repo -- d2 --local`, `npm run switch-data-repo -- --local`: `d1` is closed and sealed, `d2` has `data/hashes/` and is `current` in `sources.json`. `scripts/data-repos.test.js` does the same |
| moving a shard | `bgdb split 0001 --to /tmp/other/data --base https://example.org/data/0001/ --remove`, see [growing.md](growing.md); then `ingest` a duplicate of a moved match: it is still recognised |
| the update script | extract a zip next to the repository and run `node scripts/update-from-zip.mjs ../extracted` (dry run), then `--apply` |
| the requirements index | `npm run spec-index` after editing `docs/spec`; `npm test` fails if it is stale |
| the site under a sub-path | `mkdir -p /tmp/bgsub && cp -r /tmp/bgtest/dist /tmp/bgsub/bgdb && npm run bgdb -- serve /tmp/bgsub` and open `http://localhost:8080/bgdb/` |

## Checking a contribution before sending it

In a data repository (or with `--inbox`, `--data` and `--config` pointing to one):

```sh
cp my-match.txt my-match.sgf inbox/          # the files of one match share a name
npm run bgdb -- review                       # what would the bot say? (writes nothing)
npm run bgdb -- review --report /tmp/r.json --comment /tmp/c.md    # also the report and the comment text
npm run bgdb -- from-issue --body issue.md --number 1 --inbox /tmp/inbox   # try the issue conversion on a saved issue text
```

Or open the Contribute page (`npm run build`, `npm run serve`, then `contribute.html`) and drop the files: it uses the same check.

## 5. Checking the site in a browser

The page's DOM code is not tested automatically (see [site.md](site.md)), so after changing `site/` look at it:

1. In a data repository with matches (or a scratch folder built with `--site site`), `npm run build && npm run serve`, open http://localhost:8080 with the browser console open: **no error or warning** should appear. The list has Event and Round columns (type `round:final`, or `cup`, to see them).
2. Type `player:` followed by a few letters of a player: suggestions appear, arrows and Enter choose one. Clear resets everything.
3. Open **Filters**: change the length, tick a flag: the search box text changes with them, and the count changes.
4. Reload the page: the search is still there (it is in the address). Click a match, then **All matches**: the list is as you left it.
5. A match page shows the replay, then details, a games table, the downloads and, when present, the video link, the notes and the attached files.
   Replay: `→` / `←` step through the game and the board shows the position before each play with arrows and transparent checkers; click a row of the move list; `Space` plays; the ⋮ menu copies an XGID / GNU Backgammon ID (paste it into XG or GNU Backgammon to check) and saves a PNG/SVG picture; "Swap players" and "Home boards on the left" turn the board; "Board size" makes it large or fits it to the window; reload the page after stepping: the same position comes back (the address holds `g=` and `t=`).
6. Narrow the window below 640 px (or use the browser's mobile view): no horizontal scrolling, tags move under the player names.
7. On a phone-sized window the board comes first, the move list under it.
8. Switch the system to dark mode: the page follows.
9. **Contribute page** (`contribute.html`): step 1 offers "Create my key", "I have a key file" and "Go on without a key"; after "Create my key", it shrinks to one line ("Your names key is ready", with "Download a copy of my key"), and stays so after a reload (a private window starts again with no key). Drop `fixtures/opengammon/Sir_Plover_vs_tester_2026-08-03.mat` with its `.xg` twin from `fixtures/xg-binary/`: the card says "In the database: anon-… vs anon-…"; the ZIP holds a `.mat` and an `.xg` named after those names, and neither the handles nor "OpenGammon" are in any of its files. Load the key file again on another browser profile: the same names. Then drop a few fixtures (a valid one, one broken by editing a move, one that is already in the database): each card says New / Already in the database / Needs a fix / Can be added partially (a match of several games with one broken move), with the reason and how to fix it; a partial card offers the download of the `.mat` that would be stored and the box "Add it partially", and nothing of it goes into the ZIP until the box is ticked; add a YouTube link and a tag; the ZIP button stays disabled until the rights box is ticked; the ZIP unzips to files named after the players and date, with a `.bgdb.json` when you added something; the steps light up in turn (green when done, blue for the current one); "Open the submission form" stays disabled until the ZIP is downloaded, then points to `github.com/<repository>/issues/new?template=submit-match.yml` of the current repository of `sources.json` (built with `--sources`), else of `bgdb.config.json`, with a title naming the matches. **How to contribute** (`guide.html`) shows the same six steps with all the pictures; on a phone-sized window the pictures shrink and the numbered texts under them stay readable. Drop `fixtures/backgammon-studio/tester_-_Linnet14_7pt_Backgammon_Studio_2026_10_01_09_38_41.txt`: its card has the box "Played over the board"; ticked, the names line shows the real names and the ZIP holds the original file with a `.bgdb.json` saying `"origin": "otb"`. An OpenGammon file shows "Played online" instead of the box.

The page cannot work when opened as a file (`file://`): always use `npm run serve`.
