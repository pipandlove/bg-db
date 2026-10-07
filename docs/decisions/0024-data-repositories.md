> [bg-db](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0024 - Tools and site in one repository, data in a series of data repositories

**Status:** accepted (2026-10-06), built (2026-10-07): all seven points, the commands `new-data-repo`, `publish-data-repo` and `switch-data-repo`, and the move of `data/` out of `bg-db`. The first data repository, `bg-db-data-1`, is made by the maintainer following [data-repositories.md](../data-repositories.md). Refines topology T2 of the specification ([§3](../spec/03-architecture.md#repositories-and-sites), [§5](../spec/05-storage.md#deployment-topologies-informative)) and replaces the "open shard stays in the hub" rule of [decision 0018](0018-external-shards-and-hash-files.md).

**Context.** `bg-db` holds the tools, the site and the data in one repository (decision 0002). Two limits of GitHub decide when this has to change: a Pages site
is at most 1 GB, and a repository should stay below about 1 GB. Git keeps every file in its history, so moving sealed shards out of a hub (`bgdb split --remove`,
decision 0018) frees the published site but never shrinks the hub: each match would pass through the hub's history first. The build reads the open shard in full
at every run (about 0.05 s per match, so about 15 minutes for a full shard of 20 000 matches), while sealed shards are trusted by their digest (decision 0017).
Contributors need a GitHub account (a relay without one, spec C7, was considered and left out: it needs a server, a stored token and moderation, against the
simplicity of a static project). Growing should therefore be as automatic as it can be **without a stored credential that can create repositories**.

**Decision.**

1. **`bg-db` holds the tools and the site, no data.** Code, fixtures, tests, documentation and the site, published on Pages. A file `sources.json` lists the data
   repositories, in order, with the address of each one's published site and its state: `current` (the one that takes contributions), `next` (created, not yet
   used) or `archived`. The site reads every listed repository's `registry.json` and enrichment overlay and merges them in the browser; the Contribute page
   takes the address of its upload page from the `current` entry and checks duplicates against all of them.
2. **Data repositories form a series: `bg-db-data-1`, `bg-db-data-2`, ...** Each is self-contained: `inbox/` (contributions arrive by pull request here), one open
   shard, its sealed shards, its enrichments, its hash files, and a Pages workflow that publishes its own `data/`. A match is stored in the history of one
   repository only. Exactly **one** data repository is `current` at any time, and it has exactly **one** open shard.
3. **Shard numbers are global.** A match id is `<shard>/<hash>` (spec ST-12), so numbers never restart: if `bg-db-data-1` ends at `0006`, `bg-db-data-2`
   starts at `0007`. The first shard number is set when a repository is created (`firstShard` in its `bgdb.config.json`). Links stay valid for ever.
4. **Smaller shards.** `sealPolicy.maxMatches` goes from 20 000 to **5 000** (`maxMB` stays 300): the open shard, read in full at each build, stays under about
   4 minutes. The build also keeps a **cache of what it read, keyed by the content hash** of each match file: files are named by their content, so a file
   already read is never parsed again, and the output stays byte-identical (decision 0008).
5. **Data repositories use the tools at a pinned version.** Their workflows call the reusable workflows of `bg-db` at a tag (`@v1`), so a new release of the
   tools changes nothing in a data repository until it moves to the new tag. The identity code (decision 0003) must never change by accident. The files a new
   data repository starts with are a template folder of `bg-db` (`templates/data-repo/`), versioned and tested with the tools, rather than a separate template
   repository on GitHub that would have to be kept in step.
6. **A repository warns, then stops; a person switches.** After each ingest the `ingest` workflow measures the repository: the size of `data/` (what Pages
   publishes) and the packed size of the git history (what GitHub counts), and takes the larger. Limits in `bgdb.config.json`,
   `repoPolicy: { "warnMB": 800, "stopMB": 950 }`. Above `warnMB` it opens (or updates) an issue; above `stopMB`, checked again as matches are added during a
   run, it **adds nothing more** and new matches wait in `inbox/` (not only "opens no new shard": the open shard could still grow by up to 300 MB, past 1 GB). The switch to the next repository is a decision of the maintainer, made with two commands run on their own machine with their
   own `gh` login: `new-data-repo` and `switch-data-repo`. **No workflow creates repositories**: that would need a token with administration rights over the
   whole account, for a step that happens every few years.
7. **A closed repository answers, it does not merge.** `"closed": true` in a data repository's `bgdb.config.json` makes the review verdict `closed`: the bot asks
   the contributor to send the match again from the Contribute page, which now points to the new repository.

## The five scenarios

| # | Scenario | Who does it | Today |
|---|---|---|---|
| 1 | Growing a shard | the `ingest` workflow | exists |
| 2 | Starting a new shard | the `ingest` workflow | exists (limits to change) |
| 3 | Growing a data repository | the `ingest` workflow, then the maintainer reads an issue | exists |
| 4 | Starting a new data repository | the maintainer: `new-data-repo` | exists |
| 5 | Moving to the first shard of the new repository | the maintainer: `switch-data-repo`, then the `ingest` workflow | exists |

**1. Growing a shard.** A contributor drops a match on the Contribute page and sends it to the `current` repository. The pull request is checked (`validate`,
`review-publish`, decision 0015) and merged; `ingest` files the match into the open shard, say `0003`, and commits it. The build reads `0003` in full (only the
matches not in its cache) and trusts `0001` and `0002` by their digests. Nothing for the maintainer to do.

**2. Starting a new shard.** During an ingest, `0003` reaches 5 000 matches or 300 MB. In the same run (`packages/cli/src/ingest.js`), `0003` is marked `sealed`,
its digest is recorded in its `shard.json`, `0004` is created as the open shard, and the remaining matches go into it. A shard can be sealed at any size.
Nothing for the maintainer to do.

**3. Growing a data repository.** The repository fills shard after shard: `0001` to `0005` sealed, `0006` open. When the measured size passes `warnMB`, `ingest`
opens an issue (and updates the same issue at each later run): "bg-db-data-1 is at 812 MB of 1 GB: prepare the next data repository (docs/growing.md)".
Contributions go on as before: this is a reminder with plenty of margin, not an emergency. If nobody acts and the size passes `stopMB`, nothing more is
added; the matches merged after that stay in `inbox/`, nothing is lost, and the issue says that ingestion is stopped until the switch.

**4. Starting a new data repository.** The maintainer runs `npm run new-data-repo -- bg-db-data-2`. It makes `../bg-db-data-2` from `templates/data-repo/`
(workflows pinned to the tools' tag, `bgdb.config.json`, README, CONTRIBUTING, the issue form) with `firstShard` (the last shard number used, plus one: `0007`),
commits it with the git identity of `bg-db`, and, with the maintainer's `gh` login, creates the repository and pushes, turns on Pages (source: GitHub Actions),
sets the branch rule that requires the check `validate / validate`, allows auto-merge, and adds the repository to `sources.json` in `bg-db` as `next`. The new
repository is empty; nothing has changed for contributors yet.

**5. Moving to the first shard of the new repository.** The trigger is the maintainer's decision, not a size: once `bg-db-data-2` exists, they run
`npm run switch-data-repo`, and again until it says it is done (it stops after step 1 while pull requests are open or files wait in the inbox).

1. `bg-db-data-1` is **closed**: `"closed": true` in its configuration; new pull requests there get the verdict `closed` and are not merged.
2. Pull requests already waiting are reviewed as usual; the maintainer merges what is ready, and the last ingest files it into `0006`.
3. `0006` is **sealed** at whatever size it has reached (1 200 matches, say), with its digest; no new shard is opened. The repository is archived on GitHub
   (read-only) and marked `archived` in `sources.json`; its Pages site keeps serving its shards.
4. The hash files of `0001` to `0006` (`data/hashes/*.tsv`, decision 0018) are copied into `bg-db-data-2`, so that a match stored in `bg-db-data-1` is still
   recognised as a duplicate there, and can still be enriched.
5. `bg-db-data-2` becomes `current` in `sources.json`: the Contribute page now sends to it. Its first ingest creates `0007`, and it is scenario 1 again.

The site lists the matches of both repositories; old links (`#m=0003/...`) keep working. Enrichments and corrections of event, round and date for a match of an
archived repository are written in the `current` repository (`data/enrichments/0003/...`): the overlay applies to a match wherever it is stored (decision 0016).

```
bg-db (tools + site)    sources.json: bg-db-data-1 (archived) · bg-db-data-2 (current)
bg-db-data-1   [0001][0002][0003][0004][0005][0006]   archived, read-only, still published
bg-db-data-2   [0007][0008][0009 open]   <- contributions arrive here
```

How often: without attachments a shard of 5 000 matches is about 35 MB, so a repository holds about 25 shards (about 125 000 matches); with analysed
attachments shards seal at 300 MB, so about 3 shards (roughly 10 000 matches). Scenarios 4 and 5 should come every few years at most.

**Alternatives.**
- *A hub that keeps the open shard and `inbox/`, sealed shards moved out* (decision 0018 as written): contributors never change address, but every match passes
  through the hub's history, so the hub grows without end.
- *A hub that keeps only `inbox/` and pushes matches into the current data repository*: the address stays fixed, but it needs a cross-repository token, and the
  original files still accumulate in the hub's history.
- *Creating the next repository from a workflow*: needs a stored token with administration rights over the whole account, for a rare step.
- *A relay for contributors without a GitHub account* (spec C7): needs a server, a stored token, a captcha and moderation; left out.
- *Shards split by date (`YYYY/MM/DD`)*: ids would carry a location and many matches have no date; the `<h2>` folders already keep folders small.

**Consequences.**
- The present `data/` of `bg-db` becomes `bg-db-data-1`, started from a fresh history (which decision 0010 already asks for before going public); `bg-db`
  keeps no data. `bgdb split` stays for moving a shard by hand, but is no longer the growth path.
- Built:
  - `sources.json` (`bgdb build --sources`, checked by `checkSources`): the site reads every source but `next`, merges shards and enrichments, and the Contribute page
    sends to the `current` one; without the file, the site reads the registry next to it as before. Data sites of one owner on GitHub Pages share one origin
    (`owner.github.io`), so reading them needs no CORS.
  - `maxMatches` 5 000: an open shard already above it is sealed as it is at the next ingest.
  - The build cache (`bgdb build --cache`, `--no-cache`); measured on 95 real matches: 8 to 11 s read in full, 0.2 s from the cache.
  - Shard numbers: a new shard comes after every number the repository knows of (its shards, `data/hashes/`, `externalShards`), so a new repository that
    received the hash files of the previous one continues the numbering by itself; `firstShard` sets it explicitly and is refused if it would reuse a number.
  - `repoPolicy` (warning, stop, `ingest --report`, one issue opened or updated by the ingest workflow) and `closed` (review verdict `closed`, issue form
    refused with `V-CLOSED`, no new shard opened).
  - The reusable workflows (`.github/workflows/data-*.yml` in `bg-db`, triggered only by `workflow_call`) and the template folder `templates/data-repo/`, whose
    five workflows only call them, with the tag in two places (`@v1` and `tools-ref: v1`; a test checks they are the same). The tools are checked out at that tag,
    the configuration from the data repository's base branch, and a pull request is only data, as before (decision 0015). While `bg-db` is private, the data
    repositories read it with a secret `BGDB_TOOLS_TOKEN`.
  - `npm run new-data-repo`, `npm run publish-data-repo` (the GitHub part alone, for a repository made with `--local`; safe to repeat) and
    `npm run switch-data-repo` (`scripts/data-repos.mjs`, [commands.md](../commands.md#scriptsdata-reposmjs)). They check `gh` and the tools on GitHub before
    making anything; a GitHub setting that is refused (a private repository on a free plan) is a warning saying what to do by hand. The maintainer's procedures,
    secrets and settings included: [data-repositories.md](../data-repositories.md).
  - Local work: a data repository is checked out next to `bg-db`; its `package.json` runs the tools of `../bg-db`, and its `npm run build` includes the site.
  - `bg-db` keeps no `data/` nor `inbox/` (shard `0001` was still empty, so nothing had to be copied), and publishes the site with `sources.json`, which the first
    `new-data-repo` writes.
- While the repositories are private, Pages and branch rules need a paid GitHub plan, and the data repositories read the tools with a token
  (`BGDB_TOOLS_TOKEN`); until then a data repository can be made with `--local` and put on GitHub later with `publish-data-repo`.
- The contribution address changes at each switch; contributors who use the Contribute page do not notice, those who send pull requests by hand are told by the
  bot of the closed repository.
- Workflows not yet run on GitHub (docs/contributing-flow.md) are still the first thing to test, now with two repositories.
