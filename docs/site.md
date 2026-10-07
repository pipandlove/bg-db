> [bg-db](../README.md) · [Documentation](README.md)

# The site (milestone M3)

A static page that loads the database from the files next to it, lets you search it, and shows a page per match. Plain JavaScript modules, no framework,
no build step, no server. It is built into `dist/` by `bgdb build` and works from any static host ([deploy.md](deploy.md)).

```
cd ../bg-db-data-1   # a data repository checked out next to bg-db (decision 0024)
npm run build        # its matches and the site of ../bg-db (ingest first if it is empty: see commands.md)
npm run serve        # http://localhost:8080 (serves dist/)
```

Published, the site of `bg-db` reads the data repositories listed in `sources.json` (`bgdb build --sources sources.json`), each published by its own Pages site.

## What it does

Three pages: the search and replay page (`index.html`), the **Contribute** page (`contribute.html`, described in [contributing-flow.md](contributing-flow.md)), and **How to contribute** (`guide.html`): the same five steps with every picture, to read before starting.


- **List** of all matches, newest first (undated last), 50 per page; on the same day by event, then by **round** in natural order (Round 2 before Round 10). Each row: date, both players with the score (the winner in bold), length, games, **event, round** and small tags (on phones the event and round go under the names).
- **Search box** with a small query language, **suggestions** while you type (players, events), and a **Filters** panel (year, length, event, flags) that writes into the same query.
- **Match page** (`#m=<shard>/<hash>`): the **replay** ([replay.md](replay.md)), then details, per-game table, notes (the transcriber's remarks and any illegal play that was made), YouTube links, downloads (the normalised `.mat`, the replay JSON, and the attached SGF/XG files with badges for
  "with analysis" and "checked against the match"). The replay is described in [replay.md](replay.md).
- **Shareable URLs:** the state is in the address (`#q=player:smith+year:2019..2024&p=2`), so a result list or a match can be linked to. Back and forward work.
- Works on phones (the table becomes two columns with the tags under the names), in light and dark mode (follows the system), with keyboard navigation and screen-reader labels.

## The query language

| Write | Meaning |
|---|---|
| `player:smith` or `player:"Dale Henderson"` | a match where that player took part, on either side (part of a name is enough) |
| `player:dale player:matthew` | a match **between** the two (in either order) |
| `event:final` | part of the event name |
| `round:"match 2"`, `round:1` | part of the round name (the Round column; `"match 2"` as a plain word finds it too) |
| `year:2021`, `year:2019..2024`, `year:..2020`, `year:2025..` | one year or a range (undated matches are excluded when a year is asked for) |
| `len:7`, `len:5..9`, `len:money` | match length; `money` is a money game |
| `has:cube,gammon,resign,analysis,attachment,video,illegal` | only matches where all of these are true (cube turned, gammon or backgammon, a game ended by resignation, analysed file attached, SGF/XG attached, video link, an illegal play was made and kept as played) |
| any other word | must appear in a player, event or round name (`city`) |

Accents and capitals are ignored. A search that is not understood is not silently dropped: a notice names the part that was not understood.
Not yet: `result:`, `score:`, `pos:` (position search), `opening:`, `collection:`, player aliases (spec section 9).

## How it is built

| File | Role |
|---|---|
| `site/index.html`, `style.css`, `favicon.svg` | the page; no inline script or style (so a strict content-security policy can be added) |
| `site/js/app.js` | the page: DOM, routing by URL fragment, suggestions |
| `site/js/query.js` | parse, format and apply a query (pure functions, tested in Node) |
| `site/js/catalog.js` | load the sources, their registries, shards and compressed catalogs and overlays; decode them into rows |
| `site/js/replay.js`, `replay-model.js`, `board.js`, `svg.js` | the replay: see [replay.md](replay.md) |
| `site/contribute.html`, `js/contribute.js`, `contribute-model.js`, `zip.js` | the Contribute page: five numbered steps; check files in the browser with the core code, download them as a ZIP, open the "Submit a match" form of the current data repository |
| `site/guide.html`, `js/guide.js`, `js/steps.js`, `img/guide/*.png` | How to contribute: the steps (one list in `steps.js`, shown by both pages) and the pictures of GitHub, with numbered red marks drawn on top. **To replace a picture:** a plain screenshot of the `sambot1981`-like contributor account (light theme, window about 1280 px, player names blurred), cropped to the useful column; then give its `w`/`h` in `SHOTS` and measure its marks again (`box` = x, y, width, height in the picture's pixels): a test checks the size and that every mark lies inside |
| `site/js/dom.js` | DOM helpers shared by the pages |
| `site/js/format.js` | display helpers; the check that a video link has the exact canonical shape before it is shown |
| `dist/lib/core/*.js` | a copy of `packages/core/src` made by `build`: the browser uses the same code as the tools (here: `normalizeName`; the replay and the browser-side validator will use more) |

How the page loads the data (spec section 8): `sources.json` (always fetched fresh) lists the data repositories to read ([format](formats/shard-and-index.md#sourcesjson-the-data-repositories-a-site-reads)); without it, the `registry.json` next to the page is the only one. Each repository's `registry.json` (always fetched fresh) lists its shards; for each shard `shard.json` names the catalog file, whose name contains its hash
(`catalog.<h8>.json.gz`); the catalog is decompressed in the browser (`DecompressionStream`; plain JSON is accepted too if a server already decoded it) and decoded into rows with the
search strings normalised once. Only catalogs (and the small overlay of enrichments, if any) are loaded for the list; the match file and its metadata are fetched when a match page is opened, and the replay data is derived from them in the browser.
The **overlay** holds video links, tags and attachments added to matches after they were stored ([growing.md](growing.md)): it changes the flags of the rows (so `has:video` and `has:analysis` include them) and is merged into the match page.
A shard of another repository (`externalShards`) is loaded from its own address, like any other. A shard, or a whole data repository, that cannot be loaded is skipped with a notice and
the others still work; a shard number listed by two repositories is read from the first one, with a notice. The Contribute page sends to the `current` repository, and recognises duplicates in all of them. All URLs are resolved against the page, so the site works under any sub-path.

## Safety

- Data is put into the page with `textContent` and `setAttribute` only, never as HTML (a test checks that the site code contains no `innerHTML`, `eval` or `document.write`).
- A video link is shown only if it has exactly the form `https://www.youtube.com/watch?v=<11 characters>[&t=<n>s]`, even though ingestion already rebuilds it. It opens in a new tab
  with `rel="noopener noreferrer"`; nothing from YouTube is loaded by the page.
- Match identifiers taken from the URL are validated (`<shard>/<hex hash>`) before any file is requested.

## Tests

`packages/cli/test/site.test.js` builds a small database, serves `dist/` over a real HTTP server and runs the page's modules against it (load, decode, search, suggestions, match files, a
failing shard, a sub-path) and checks the shipped files (relative URLs only, nothing inline, no external loads, every import exists). The page itself (DOM, clicks) was checked by hand
in a headless browser; there is no browser test in the repository because it would need a dependency.
