> [bg-db](../../README.md) · [Documentation](../README.md) · BGDB specification, Part I · [Overview](README.md) · [Requirements](requirements.md) · [Terms index](terms-index.md) · [Glossary](glossary.md)

# Client runtime and caching

## Storage layers

| **Layer**                      | **Use**                                      | **Note**                                                    |
|:-------------------------------|:---------------------------------------------|:------------------------------------------------------------|
| *Service Worker* + *Cache API* | Cache fetched files, enable offline use      | Content-addressed files can be kept for ever.               |
| *IndexedDB*                    | Parsed catalog, text index, small structures | Skips repeated parsing.                                     |
| *OPFS*                         | Large binary shards (position index)         | Optional; use when supported.                               |
| `localStorage`                 | Version pointers, preferences                | Tiny only.                                                  |
| HTTP cache                     | Free baseline                                | GitHub Pages controls headers, so it cannot be relied upon. |

## Loading protocol

<a id="CL-01"></a>**[CL-01]** On start the client fetches the `registry.json` without using its cache (conditional request), then compares each shard’s `manifestHash` with the stored value.

<a id="CL-02"></a>**[CL-02]** A sealed shard whose hash is unchanged is never re-checked during the session. Only open shards and the registry are revalidated.

<a id="CL-03"></a>**[CL-03]** Files whose names contain their hash are fetched at most once per browser; changed files are downloaded and old versions deleted after success.

<a id="CL-04"></a>**[CL-04]** The catalog loads first; text and position indexes load lazily on first use. Search over cached data MUST work before the update check completes.

<a id="CL-05"></a>**[CL-05]** Parsing, decompression and index building run in a *Web Worker* so the interface stays responsive; *DecompressionStream* is used where available.

<a id="CL-06"></a>**[CL-06]** The client requests persistent storage, shows cache size (via the storage estimate API) and offers a “clear local data” action.

<a id="CL-07"></a>**[CL-07]** The application MUST work with a cold cache: eviction or corruption is detected (hash check on critical files) and repaired by re-download.

<a id="CL-08"></a>**[CL-08]** Several tabs coordinate updates through a *BroadcastChannel* or database versioning so that updates are not applied twice.

<a id="CL-09"></a>**[CL-09]** Cross-origin loading of shard files is assumed (*CORS*); the client never assumes the same origin as the registry.

<a id="CL-10"></a>**[CL-10]** The UI displays the data version (“index up to date, v2026.10.02”) and, when updating, the amount to download.

## Failure behaviour

<a id="CL-20"></a>**[CL-20]** If a shard or an index file cannot be loaded, the client continues with the remaining shards, tries mirrors, and shows a non-blocking notice that results may be incomplete.
