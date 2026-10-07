# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

bg-db is an open, static, federated backgammon match database. Match files (`.mat`/`.txt` dialects, GNU Backgammon `.sgf`, eXtreme Gammon `.xg`) are validated move by move, given a canonical identity, filed into shards under `data/`, and published as a static site (GitHub Pages) with search and a replay. Contributions arrive by pull request into `inbox/`. Since decision 0024 this repository holds the tools and the site only: `inbox/` and `data/` live in data repositories (`bg-db-data-1`, ...) checked out next to it (`../bg-db-data-1`) and listed in `sources.json`. The maintainer's procedures (gh, secrets, settings, switch): `docs/data-repositories.md`.

## Commands

Node.js >= 22 (pinned in `.node-version`). There are **no dependencies**; `npm install` only creates workspace links.

```sh
npm test                                   # all tests (node:test): packages/*/test/*.test.js and scripts/*.test.js
node --test packages/core/test/rules.test.js           # one test file
node --test --test-name-pattern="XGID" packages/core/test/ids.test.js   # one test by name
npm run check                              # validate every fixture (CI runs this too; every real fixture must be valid)
npm run bgdb -- <command> [...]            # the CLI: check, ingest, meta, build, serve, review, enrich, verify, split, anonymize, help
npm run ingest -- --contributor me --dry-run
npm run build                              # writes dist/ (generated, ignored)
npm run serve                              # http://localhost:8080 serving dist/
npm run spec-index                         # regenerate docs/spec/requirements.md after editing requirement IDs in docs/spec
npm run new-data-repo -- <name> [--local] [--dry-run]   # make the next data repository from templates/data-repo/ (gh, sources.json); decision 0024
npm run publish-data-repo -- <name>        # the GitHub part alone (a repository made with --local); safe to repeat
npm run switch-data-repo [-- --local]      # close the current data repository, seal it, copy its hash files to the next one, make that one current
npm run archive -- <dir> <step>            # bulk import in a working folder: init, dry-run, review, apply, ingest, build, serve, status, commands, reset (docs/importing-an-archive.md)
node scripts/completions.mjs <file>        # count the histories that fit a match with missing plays (diagnostic for V-DAMAGED files)
node scripts/xg-rename.mjs --map ../names.json f.xg [--write]   # replace names inside an .xg fixture (mapping kept outside the repo)
```

There is no linter or build/transpile step. CI (`.github/workflows/test.yml`) runs `npm test` and `npm run check`. In a data repository, `npm run ingest`/`build`/`serve`/`check` call `../bg-db` (its `package.json`).

## Architecture

- **`packages/core`** (`@bg-db/core`): dependency-free ES modules that run unchanged in Node, the browser and a Web Worker. It holds the logical model, parsers (`mat.js` for all text dialects, `sgf.js`, `xg.js` binary reader with its own `inflate.js`), the rules engine (`rules.js`), the validator (`validate.js`, diagnostic codes documented in `docs/diagnostics.md`), the canonical identity (`identity.js`: SHA-256 over the positions reached, independent of names/notation; site IDs are 16 hex chars), XGID/GNUBGID, the normalised `.mat` writer, and contribution grouping (`contribution.js`: `groupFiles`/`analyzeGroup`, the shared check used by CLI, CI and the Contribute page). `read.js` (`readMatch`/`readMatchBytes`) is the format-detecting entry point.
- **`packages/cli`**: `cli.js` holds the `COMMANDS` registry, which a test checks against `docs/commands.md` — keep them in sync. `ingest.js`/`store.js` move inbox files into the open shard (dedup, sealing by `sealPolicy` in `bgdb.config.json`); `build.js` produces `dist/` (registry, per-shard manifest/catalog, Bloom filter of players, enrichment overlay) deterministically; `review.js` is the PR bot logic; `meta.js` is the review sheet of event/round/date (decision 0022); `reconcile.js` finds transcriptions of one match by their rolls and keeps the better copy (decision 0023, core `reconcile.js`); `enrich.js` adds links/tags/attachments to existing matches and corrects their event/round/date; `shards.js` does `verify`/`split` and seals the last shard of a closed data repository (`sealOpenShard`).
- **`site/`**: plain static HTML/JS. It imports core from `../lib/core/`, which `build` copies from `packages/core/src` — the browser uses the same parsers and rules as the tools, and replay data is derived in the browser from the stored match file rather than prebuilt.
- **`.github/workflows/data-*.yml`**: reusable workflows (validate, review-publish, ingest, issue-to-pr, pages) that data repositories call at a pinned tag (`@v1`); they check out the tools into `tools/`. **`templates/data-repo/`** is what a new data repository starts with (callers, `bgdb.config.json`, README; `%%placeholders%%` filled by `scripts/data-repos.mjs`). `scripts/workflows.test.js` checks the safety rules of both. `bg-db`'s own `pages.yml` publishes the site with `sources.json`.
- **`data/`** (in a data repository): committed data. Shards (`data/0001/...`); sealed shards are immutable and protected by a digest in `shard.json` (build fails if they change). Later additions to existing matches live in `data/enrichments/` and are published as an overlay. Layout: `docs/formats/shard-and-index.md`.
- **`fixtures/`**: real match files grouped by source/dialect; `fixtures/invalid/` holds expected failures. Many tests iterate over all fixtures (e.g. replay tests check every play of every fixture).

## Conventions and constraints

- Plain JavaScript ES modules with JSDoc, no runtime dependencies, no transpilation (decision 0001). Do not add npm dependencies.
- Builds must be deterministic: two builds of the same data are byte-identical (decision 0008).
- Positions are stored per side from that side's perspective: `pos.c[side][point]` (1..24, bar = 25), `pos.off[side]`.
- Illegal plays are errors unless the source declares they were made in a real match (decision 0013).
- Validation of damaged or incomplete real files follows decisions 0019 and 0020; read them before changing `validate.js` or `identity.js`:
  - The start score of each game is trusted. A forward jump between games is an excerpt with missing games (`V-PARTIAL`, `result.partial.gaps`), not an error.
  - The `Illegal play (...)` marker of XG text exports is a dump of the position *after* the play (`illegal-dump.js`, `docs/formats/illegal-play-marker.md`). Mid-game, a notation that reaches that position is rebuilt. As the first play of a game it means the plays are lost: the game is kept by its result only (`resultOnly`), and the result then enters the identity.
  - A roll written with no play when one was possible is `V-DAMAGED`: the match is refused and never guessed, because the identity must be unique.
  - Partial matches (decision 0021, `validateMatch(m, { salvage: true })`): a game whose moves cannot be read is kept by its result when two sources confirm it, else left out; the winner of the match must stay known (docs/partial-matches.md). `analyzeGroup` returns status `partial` (with the `.mat` that would be stored) unless consent is given: `{"accept": "partial"}` in the sidecar, or `bgdb ingest --salvage` for archives. A play is never guessed: a typo is only corrected when a single legal play makes the game valid.
- A planned feature can come with its fixture in `fixtures/invalid/` (skipped by `check` and by the fixture loops) and tests marked `{ todo: ... }`: they run and report but do not fail the suite. When the feature lands, drop the `todo` marks and move the fixture out of `invalid/` (example: games from a set position).
- Changing what `canonicalContent` includes changes match identifiers. Treat it as a format change, not a refactor.
- The specification lives in `docs/spec` (requirements carry IDs like `LM-03`, `ST-14`); design reasons are in `docs/decisions`; status and next steps in `docs/roadmap.md` and `docs/decisions/0006-open-items.md`. `docs/spec/requirements.md` is generated and checked by a test.
- Ingestion keeps real player names (player search is a goal). Test fixtures must not: every name, handle, event, venue and transcriber in `fixtures/` is a same-length pseudonym, consistent across twin files (decision 0010). Anonymise any new fixture the same way before committing it, including `.xg` files (`scripts/xg-rename.mjs`, which recompresses them and recomputes the archive index and CRCs).
- The publishing items of decision 0006 are settled; going public is the owner's call. Keep fixtures pseudonymous (decision 0010) and actions pinned to commit hashes (spec SC-04).
