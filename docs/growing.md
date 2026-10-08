> [bgdb](../README.md) · [Documentation](README.md)

# Growing the database: enriching, scaling, and adding a repository

**Where the data lives** ([decision 0024](decisions/0024-data-repositories.md)): `bgdb` holds the tools and the site, **no data**. The matches live in a series of
**data repositories** (`bgdb-data-1`, `-2`, ...), listed in `sources.json`; exactly one is `current` and takes the contributions, the site reads them all. A data
repository warns at 800 MB and stops at 950 MB (`repoPolicy`, an issue opened by its ingest workflow), and the maintainer moves to the next one with two commands
([data-repositories.md](data-repositories.md)). Each data repository has its own `inbox/`, open shard, sealed shards, enrichments and hash files, and runs the workflows of `bgdb` at a pinned tag.

Locally, a data repository is checked out next to `bgdb` (`../bgdb-data-1`); its `package.json` runs the tools of `../bgdb` (`npm run ingest`, `npm run build`,
`npm run serve`), and its build includes the site, so that `npm run build && npm run serve` there shows the whole database.

## 1. Enriching: what can be added to what is already there

`dist/` is **output**: it is deleted and rebuilt by every `npm run build`, so never edit it. The source of truth is `data/` and the files you ingest into it.

| I want to... | How |
|---|---|
| add thousands of matches | put them in `inbox/` (any mix of formats) and run `npm run ingest`: incremental, duplicates are skipped, the result does not depend on the order |
| add a video link, tags, an SGF or an XG file to a match that is **already** in the database | **`bgdb enrich <id> --link ... --tags ... --sgf file --xg file`**, or simply submit the files again with the same match (a duplicate that brings something new **enriches** the existing match, also through a pull request). The SGF is checked against the match |
| correct something in the match itself (a move, the result) | not an enrichment: re-ingest the corrected file; it is a different match (identity includes the moves), and the old one has to be removed |
| correct the date, event or round of a match | edit its `.meta.json` while its shard is **open**; for a **sealed** shard, overlays for patches and tombstones are planned (spec section 5.4), not built |
| attach analysis | enrich with the `.sgf` (verified) or the `.xg` (kept unverified) |

**How enrichment works.** A sealed shard is never edited, because its files are named by their hash, cached for ever by browsers, and protected by a digest (section 2). So an enrichment is a small record in
`data/enrichments/<shard>/<h2>/<hash>.json` (and its attachment files next to it). `bgdb build` publishes all of them as **one overlay file** (`overlays/enrichments.<hash>.json.gz`) and the site applies it on top
of the shards: the list (`has:video`, `has:analysis`, the tags) and the match page include what was added later. A record can be added for a match in a shard that has been moved to another repository too.

Prepare everything in `data/`, check it with `npm run build` and `npm run serve`, and only then publish.

## 2. How big and how slow it gets (measured)

Measured on the 23 real matches of the fixtures (104 games, attachments aside), then extrapolated linearly. Your computer will differ, and the figures depend on the length of the matches.

| Per match | Size |
|---|---|
| in the repository: match file + metadata | about 7 KB |
| in the published site: match file + metadata (the replay data is derived in the browser from the match file) | about 7 KB |
| attachments | very variable: a plain SGF is a few KB, an analysed SGF about 1.7 KB per move (a 7-point match can reach several hundred KB), an XG file 26 to 150 KB |

| Time | per match | 5 000 matches (one full shard) | 20 000 matches (four shards) |
|---|---|---|---|
| ingest, once | about 0.1 s | about 8 minutes | about 35 minutes |
| build, a shard **read in full** (the open shard with no build cache, or a sealed shard without a digest) | about 0.05 s | about 4 minutes | about 15 minutes |
| build, the open shard with the **build cache** (only the matches added since the last build are read) | about 2 ms for a match checked earlier | about 10 seconds plus the new matches | not applicable: only one shard is open |
| build, a **sealed shard trusted by its digest** | about 2 ms (estimate: files are copied and hashed, nothing is parsed) | about 10 seconds | about 40 seconds |

Measured on the fixtures: a build of 23 matches took 1.15 s with every match read in full, and 0.23 s when 20 of them were in a sealed shard trusted by its digest.

How the build stays fast:
- **When a shard is sealed, a digest of all its files is recorded** in its `shard.json`. A later build recomputes the digest (reading the files, which is fast) and, if it is the same, **does not parse the matches again**.
  If it differs, the build stops: a sealed shard must not change. A shard sealed before this existed has no digest: `bgdb verify --record` reads it in full once and records it.
- **Only the open shard is read in full** at every build, and it is bounded by the seal policy: 5 000 matches or 300 MB (decision 0024; it was 20 000 matches).
- **A match already checked by an earlier build is not read again** (the build cache, decision 0024): an open shard costs only the matches added since the last build. Measured on 95 real matches: about 8 to 11 seconds read in full, 0.2 seconds from the cache. The cache lives in `.bgdb-cache/` next to the data folder (not committed); the Pages workflow keeps it between runs.
- The replay data is no longer built and published for every match: the browser derives it from the match file with the same code as the tools, which also makes the published site about 2.4 times smaller.

| Matches | Repository (no attachments) | Published site (no attachments) |
|---|---|---|
| 5 000 (one full shard) | about 36 MB | about 37 MB |
| 20 000 (four shards) | about 146 MB | about 147 MB |
| 140 000 | about 1 GB | about 1 GB = the GitHub Pages limit |

**Attachments, not matches, fill the space.** With analysed files of 100 to 200 KB each, a shard reaches its 300 MB limit (`sealPolicy.maxMB`) at 1 500 to 3 000 matches. The compact analysis format planned for M6 will reduce that.

## 3. Adding a data repository

The procedures (the first data repository, its secrets and settings, the next one and the switch, undoing) are in
**[data-repositories.md](data-repositories.md)**. In short: the ingest of the current repository opens an issue when it passes 800 MB; then
`npm run new-data-repo -- bgdb-data-2` makes the next one, and `npm run switch-data-repo` (run until it says it is done) closes, seals and archives the current
one and makes the next one current.

## 4. Moving one sealed shard by hand (`bgdb split`)

Not the way the database grows any more (section 3 is), but it stays for moving a shard to another repository by hand, for example to hand an archive to another
club (topology T3 of the specification). Tested in `packages/cli/test/m4c.test.js`.

| # | Step | How |
|---|---|---|
| 1 | **Check.** The shard is `sealed`, `npm run build` passes, the work is committed. | `npm run bgdb -- verify` |
| 2 | **Move the shard.** It is copied to the data folder of the other repository (checked out next to this one); the **hashes** of its matches stay here (so duplicates are still recognised); with `--remove` it is deleted here and listed in `bgdb.config.json` as an external shard. | `npm run bgdb -- split 0001 --to ../other/data --base https://owner.github.io/other/data/0001/ --remove` |
| 3 | **Publish the other repository** (its Pages workflow publishes `data/0001/...` at the address given with `--base`), then **commit here**: `data/hashes/0001.tsv` and the `externalShards` entry. | commit, push |
| 4 | **Check**: the number of matches on the site is unchanged, an old link opens, a duplicate of a moved match is still recognised by `ingest`. **Roll back** if needed: copy the folder back, remove the entry from `externalShards` and `data/hashes/0001.tsv`, rebuild. Identifiers and links never change. | |

Details: the registry entry of an external shard has `external: true`, the absolute `base`, and the number of matches given at the move. GitHub Pages sends the CORS
header that lets a site read a shard published by another site, and sites of one owner share one origin anyway (`owner.github.io`).

## 5. Reading XG files

**Done (M4b).** An `.xg` file is a small container: a header (`RGMH`) followed by zlib-compressed streams; the main stream is a list of records of 2 560 bytes (match header, game headers, a cube record and a play
record per turn, a footer per game). The reader (`packages/core/src/xg.js`) turns it into the same logical model as the text parsers, so legality checks, identity, the normalised `.mat` and the replay are the same code.
It was tested against the nine fixtures that have a text twin: each gives the same identity hash as its text version. The layout, and what is still unknown, are in [formats/xg-binary.md](formats/xg-binary.md).
The analysis stored in the file is detected but not read (M6).
