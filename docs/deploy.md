> [bgdb](../README.md) · [Documentation](README.md)

# Publishing the site (static, GitHub Pages)

`npm run build` produces `dist/`: plain files only (HTML, JavaScript, JSON, `.gz`, `.mat`, `.sgf`, `.xg`). There is no server code, no database and no special header or
rewrite rule, so **any static host works, GitHub Pages included** (spec HST-01). Everything the browser needs is a file served as it is.

## Publishing with GitHub Pages

Two kinds of sites ([decision 0024](decisions/0024-data-repositories.md)): `bgdb` publishes **the site** (the pages, the shared code and `sources.json`, the list of
data repositories), and each **data repository** publishes **its data** (`registry.json`, shards, catalogs, match files, overlays) with its own `pages` workflow,
which runs the tools of `bgdb` at the tag it pins. The site reads every data repository listed in `sources.json`; sites of one owner share one origin
(`owner.github.io`), so no cross-origin setting is involved.

1. Build and look at it locally, in a data repository checked out next to `bgdb`: `npm run build`, `npm run serve` (http://localhost:8080). Its build includes the site.
2. In the repository: **Settings > Pages > Build and deployment > Source: GitHub Actions**.
3. Run the workflow **pages** once (Actions tab > pages > Run workflow). In `bgdb` it tests, builds the site with `sources.json` and publishes it, and
   then runs by itself on every push to `master`; in a data repository it builds and publishes `data/`, and runs by itself on a push that changes
   `data/` and after each ingest (`PUBLISH_AFTER_INGEST`).
4. The site appears at `https://<user>.github.io/<repository>/`.

Private repositories can use Pages only on a paid GitHub plan; on a free plan the repository (or a copy) has to be public.

## Why it stays static: what the build guarantees

| Point | How it is handled |
|---|---|
| Served under a sub-path (`/bgdb/`) | Every path in `registry.json`, `shard.json` and the site is **relative** (tested). The site must use relative URLs too. |
| No custom headers on Pages | Files are named by their content hash (`catalog.<h8>.json.gz`), so they can be cached for ever; `registry.json` is the only file that must be fetched fresh. |
| `.gz` files are served as they are | The browser decompresses them (`DecompressionStream`), as planned in the client design (spec CL-05). |
| Shared code | `build` copies `packages/core/src` to `dist/lib/core/`; the site imports it with relative paths, so nothing outside `dist/` is needed. |
| Jekyll processing | An empty `.nojekyll` file is written to `dist/` so nothing is rewritten or hidden. |
| Cross-origin | Pages sends permissive CORS headers, which is what lets the main site read shards that live in another repository later. |

## Limits to keep in mind

- A Pages site should stay under about **1 GB**; the soft bandwidth limit is 100 GB per month. Shards are sealed at 300 MB (`sealPolicy.maxMB`) so that one shard fits comfortably;
  each data repository is a site of its own, and its ingest warns at 800 MB: the next data repository then takes the new matches ([growing.md](growing.md#3-adding-a-data-repository)).
- A single file must stay under 100 MB (attachments are limited to 2 MB).
- The published site is about 7 KB per match without attachments (match file and metadata only: the replay data is derived in the browser), so the limit is reached with attachments long before it is with matches. When it is near, the next data repository takes over: [growing.md](growing.md).
- Analysed SGF and XG attachments are the main source of size; the compact analysis format planned for later will reduce it.
