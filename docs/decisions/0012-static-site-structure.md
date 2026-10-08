> [bgdb](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0012 - Static site: no framework, shared core code, URL-fragment state

**Status:** accepted

**Context.** The site must stay static (it is published on GitHub Pages), run from any sub-path, and share validated code with the tools. The project has no runtime dependencies and no
bundler (decision 0001).

**Decision.**
- Plain ES modules in `site/`, no framework and no build step; DOM built with a 15-line helper using `textContent`/`setAttribute` only.
- The browser imports the **same code as the tools**: `build` copies `packages/core/src` into `dist/lib/core/` and the site imports it with relative paths. Nothing is duplicated, and
  the browser-side validator planned for the contribution page (M5) will use the same files.
- State lives in the URL fragment (`#q=...&p=...`, `#m=<id>`): shareable, no server routing, works on any static host and under any sub-path. The query text is the single source of truth;
  the filter controls only rewrite it.
- Search runs entirely in memory on the decoded catalog (strings normalised once at load). This is enough for tens of thousands of matches per shard; the text index and lazy shards of
  spec section 7 take over when the volume requires it (M6).
- Tests run the page's modules in Node against a real HTTP server serving `dist/`; the DOM layer is not tested automatically (no dependency on a browser or DOM library).

**Consequences.** No dependency to maintain and nothing to compile. The DOM layer needs a manual browser check after changes (it was checked with a headless Chromium during M3). A site
that wants a strict content-security policy can have one: no inline script or style, no external load.
