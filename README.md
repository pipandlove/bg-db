# bgdb

An open, federated, static backgammon game database: download, search and replay matches in the browser,
grow the collection by pull request.

> **Status: M0-M5 and M4c done (core library, `check`, `ingest`, `build`, `review`, search site, replay, Contribute page, contribution workflows); the data lives in data repositories (decision 0024).** The workflows have not run on GitHub yet: see [docs/contributing-flow.md](docs/contributing-flow.md). Analysis display and the other proposed steps come next
> (see [docs/roadmap.md](docs/roadmap.md)). Data licence: **CC0**; code: MIT. The items of
> [docs/decisions/0006-open-items.md](docs/decisions/0006-open-items.md) about going public are settled.

## Quick start

Requires Node.js >= 22 (the repository pins `v24.21.0` in `.node-version`). There are no dependencies.

```sh
npm install          # only creates the workspace links
npm test             # 405 tests (5 marked todo: games from a set position, planned)
npm run check        # validates every match in fixtures/ (every real match must be valid)
node packages/cli/bin/bgdb.js check path/to/match.mat
```

### Add matches and build the site folder

The matches are not in this repository: they live in **data repositories** (`bgdb-data-1`, ...), listed in `sources.json`
([decision 0024](docs/decisions/0024-data-repositories.md), [docs/growing.md](docs/growing.md)). Check out the current one next to `bgdb` (none exists yet: [docs/data-repositories.md](docs/data-repositories.md) says how to make the first, put it on GitHub with its secrets and settings, and later switch to the next), and work from there:

```sh
cd ../bgdb-data-1
cp my-matches/* inbox/                  # .mat / .txt / .sgf / .xg; a text file and its .sgf/.xg share the same name
npm run ingest -- --contributor me      # validates, de-duplicates, files them into data/0001 (use --dry-run first)
npm run build                           # writes dist/ : registry, catalog, manifest, match files, attachments, and the site of ../bgdb
npm run serve                           # http://localhost:8080 (serves dist/)
```

Invalid files stay in `inbox/` with a plain-language explanation; duplicates are skipped. `data/` is what you commit there;
`dist/` is generated (and ignored). See [docs/formats/shard-and-index.md](docs/formats/shard-and-index.md). Without a data repository, any folder works:
`npm run bgdb -- ingest --inbox <dir> --data <dir>` ([testing locally](docs/testing-locally.md)).
For a whole archive (thousands of files, events and rounds to review), follow [docs/importing-an-archive.md](docs/importing-an-archive.md)
(`npm run archive -- <folder> <step>`).

Example output:

```
OK    2359e4c944b8d130  tester vs Linnet14  7pt  3 games  10-4  (match.txt)
ERROR  (broken.mat)
   error   V-LEGAL line 14: Game 1: the move 52: 24/22 13/7 is not legal for this roll
           how to fix: The rules require playing as many dice as possible ...
```

## What works today

- Parsers for the `.mat` dialects of **OpenGammon, Foxamon, Backgammon Studio, BackgammonGalaxy, choue.net and eXtreme Gammon text exports** (money games included, and the layouts of older tournament archives), for **GNU Backgammon SGF** and for **eXtreme Gammon `.xg`** files (analysis detected, not read)
  (see [docs/formats](docs/formats/README.md)). Text files that are not UTF-8 (older Windows exports) are read right.
- A rules engine and validator: every move is replayed and checked (dice, bar entry, blocked points, hits,
  bear-off, "play as many dice as possible", turn order, cube rules, Crawford, scores, gammons). Plays are never guessed; fragments, excerpts and
  damaged files follow [docs/partial-matches.md](docs/partial-matches.md), and `bgdb ingest --salvage` keeps what is clear of old archive files (decision 0021).
- A canonical **match identifier** (SHA-256 of the positions reached, independent of names and notation).
- **XGID** and **GNUBGID** encoders/decoders.
- A normalised `.mat` writer (read-back checked), shards with automatic sealing (by count and by size), duplicate detection, a deterministic build
  (catalog, manifest, registry, Bloom filter of players, replay JSON).
- Contributions as groups of files: the text, its analysed SGF and/or XG kept as attachments, optional YouTube links (https only).
- Event, round and date: headers cleaned automatically, what file names suggest reviewed in a sheet (`bgdb meta`), matches the list cannot
  tell apart reported, corrections of stored matches applied by the site (decision 0022, [docs/importing-an-archive.md](docs/importing-an-archive.md)).
- Two transcriptions of one match (another layout, a typo) are recognised by their rolls; the better copy is kept, and a person chooses
  when both are valid but differ (decision 0023).
- A static `dist/` that GitHub Pages can serve as it is ([docs/deploy.md](docs/deploy.md)), with a search site: list, filters, URL-shareable queries, a page per match with a replay, downloads and video links ([docs/site.md](docs/site.md), [docs/replay.md](docs/replay.md)).
- A CLI: `bgdb check`, `ingest`, `meta`, `build`, `serve`, `review`, `enrich`, `verify`, `split` and `anonymize` ([docs/commands.md](docs/commands.md)).
- Data in a series of data repositories that run the workflows of this one at a pinned tag: the site reads them all (`sources.json`), a repository warns and
  stops near GitHub's size limits, and two commands make the next one and switch to it (decision 0024, [docs/growing.md](docs/growing.md)).

## Updating from a new zip

```sh
# extract the zip anywhere, then, from inside your repository:
node scripts/update-from-zip.mjs ../path/to/extracted/bgdb            # dry run: lists what would change
node scripts/update-from-zip.mjs ../path/to/extracted/bgdb --apply    # copies new and changed files
```

Options: `--delete` (also remove files that no longer exist upstream), `--force` (skip the clean-git-tree check),
`--repo <dir>`. Your `data/` and `inbox/` are add-only, `.git` and `node_modules` are never touched, and extra paths
to leave alone can be listed in a `.updateignore` file. Review with `git diff`, then commit.

## Documentation

The index is **[docs/README.md](docs/README.md)**; every page starts with a line that leads back to it and to this README.

- Using the tools: **[commands](docs/commands.md)** (every command, its options, inputs, outputs and exit codes),
  [testing locally](docs/testing-locally.md) (tests, trying the pipeline in a scratch folder, undoing it),
  **[importing an archive](docs/importing-an-archive.md)** (bulk import step by step), [diagnostics](docs/diagnostics.md) (error, warning and info codes and their fixes)
- Matches and how they are read: [formats](docs/formats/README.md), [game endings](docs/game-endings.md), [partial matches](docs/partial-matches.md)
- The site: [site and query language](docs/site.md), [replay](docs/replay.md), [publishing on GitHub Pages](docs/deploy.md)
- Contributions and growth: **[contributing flow](docs/contributing-flow.md)** (Contribute page, issue, pull request, the bot), [CONTRIBUTING.md](CONTRIBUTING.md),
  [growing](docs/growing.md) (enriching, size and speed), **[data repositories](docs/data-repositories.md)** (the maintainer's procedures: GitHub, secrets, settings, the switch)
- Design: [specification](docs/spec/README.md), [decisions](docs/decisions/README.md), [roadmap](docs/roadmap.md)

## Licences

Code: [MIT](LICENSE). Data (the match records, metadata, attachments and catalogs): [CC0](DATA-LICENSE.md).

## Layout

```
packages/core   logical model, parsers, rules, validation, identity, XGID/GNUBGID, metadata (no dependencies; runs in Node and the browser)
packages/cli    command line: check, ingest, meta, build, serve, review, enrich, verify, split, anonymize
site/           static site: search, match pages, replay, Contribute page (uses packages/core as it is)
scripts/        archive import steps, data repositories (new, switch), update from a zip, spec index, diagnostics helpers
fixtures/       real matches by dialect (+ .xg binaries, and invalid/ cases), names replaced by pseudonyms
docs/           documentation (index: docs/README.md), with spec/, formats/ and decisions/
templates/data-repo/   what a new data repository starts with (workflows that call .github/workflows/data-*.yml at a tag, config, README)
sources.json    the data repositories the site reads; the current one takes the contributions
```

## Working locally before going public

Everything runs offline: `npm test`, `npm run check` and `npm run serve` (static server on port 8080).
Pushing to the private repository is optional at any time. GitHub Pages on private repositories needs a paid
plan, so deployment tests wait until the repository (or a throwaway copy) is public.
Before making it public: run `npm run bgdb -- anonymize fixtures --recursive --check`, check any new `.xg` fixture's compressed streams for names, and read
[decision 0010](docs/decisions/0010-privacy-and-anonymisation.md) (binary `.xg` fixtures, real names, rights, the squashed history).
