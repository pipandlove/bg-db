> [bg-db](../../README.md) · [Documentation](../README.md) · BGDB specification, Part I · [Overview](README.md) · [Requirements](requirements.md) · [Terms index](terms-index.md) · [Glossary](glossary.md)

# Non-functional requirements

- **Performance.** See [§9](09-search.md) and [§8](08-client.md). First useful result after a cold start in under five seconds on a typical broadband connection for 20 000 matches.

- **Offline.** After the first visit the site works offline for cached shards.

- **Accessibility.** The interface targets WCAG 2.2 AA: keyboard operation, sufficient contrast, textual alternatives for board states.

- **Mobile.** All reading and contribution paths work on small touch screens (paths C1, C2 in particular).

- **Browsers.** Current versions of the major browsers; features beyond the baseline (OPFS, streaming decompression) are progressive enhancements.

- **Internationalization.** Interface strings are externalised; names and comments are stored as Unicode.

- **Longevity.** Raw data is plain text; no component is required to read it other than a text editor and the published formats.

- **Hosting limits.** Plan for the size limits of the chosen host (for example about 1 GB per *GitHub Pages* site) and move shards (T2/T3) before limits are reached.

<a id="HST-01"></a>**[HST-01]** The published site (`dist/`) is made only of static files and MUST work when served by GitHub Pages or any plain static host: no server code, no custom headers, no rewrite rules. A `.nojekyll` file is part of the output.

<a id="HST-02"></a>**[HST-02]** All paths in the registry, shard files and site are relative, so that the site works under any URL prefix (for example `https://user.github.io/repo/`). Files that need compression are stored compressed (`.gz`) and decompressed in the browser.

<a id="HST-03"></a>**[HST-03]** Deployment is a workflow that builds `dist/` and publishes it as a Pages artifact; the output size is kept under the host's limits (about 1 GB for GitHub Pages) by sealing and moving shards ([[SH-02]](#SH-02)).
