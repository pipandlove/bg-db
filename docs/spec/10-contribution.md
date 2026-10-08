> [bgdb](../../README.md) · [Documentation](../README.md) · BGDB specification, Part I · [Overview](README.md) · [Requirements](requirements.md) · [Terms index](terms-index.md) · [Glossary](glossary.md)

# Contribution workflow

## Objective: a feeling of ease

Growth of the database depends on how little effort a contribution costs. The workflow is designed around one idea: *contributors supply a file; machines do everything else.*

<a id="EAS-01"></a>**[EAS-01]** A first-time contributor with a match file in hand MUST be able to submit it in under three minutes, without reading documentation, without knowing about shards, hashes, folders or formats.

<a id="EAS-02"></a>**[EAS-02]** Contributors never have to name files, compute identifiers, fill mandatory metadata that can be inferred, or edit any shared file.

<a id="EAS-03"></a>**[EAS-03]** Every failure message states in plain language what is wrong, where, and how to fix it, and when possible offers a one-click fix.

<a id="EAS-04"></a>**[EAS-04]** The contribution can be validated *before* submission, in the browser, with the same validator that CI uses (one code base, two runtimes).

<a id="EAS-05"></a>**[EAS-05]** Contributions never conflict: the pull-request model MUST ensure that two valid pull requests can always be merged in any order (P6).

<a id="EAS-06"></a>**[EAS-06]** Contributors receive automated feedback within five minutes and, for clean submissions, automatic merging within ten minutes.

<a id="EAS-07"></a>**[EAS-07]** Contributors are credited automatically and visibly (opt-out available).

## The inbox model

Contributors add files only to an `inbox/` folder of the data repository, under any file name, in any supported input format. Nothing in `data/` is touched by a pull request.

    data-repo/
      inbox/                     # contributors drop files here (any name)
        Smith_vs_Jones.mat
        worldchamp2019-final.txt
        batch-2026-10/           # optional sub-folders for bulk submissions
      data/
        0001/ ... (sealed)
        0007/ ... (open)         # written only by the ingestion bot
      .github/
        ISSUE_TEMPLATE/submit-match.yml
        PULL_REQUEST_TEMPLATE.md
        workflows/validate.yml, ingest.yml, build.yml
      CONTRIBUTING.md            # three short paragraphs

<a id="CTB-01"></a>**[CTB-01]** A pull request is valid when it only adds or modifies files under `inbox/`. Changes elsewhere require maintainer review.

<a id="CTB-02"></a>**[CTB-02]** File names under `inbox/` are arbitrary but unique within the pull request. Names carry no meaning by themselves; metadata comes from file contents, an optional sidecar, or the submission form. What a file name suggests is only a proposal for review (CTB-13, [decision 0022](../decisions/0022-event-round-from-headers-and-file-names.md)).

<a id="CTB-03"></a>**[CTB-03]** After merge, the *ingestion* job ([§10](10-contribution.md)) normalizes, identifies, renames and places each file into the open shard, then removes it from the inbox. Contributors never see shard structure.

<a id="CTB-04"></a>**[CTB-04]** Because file names are free and generated indexes are not committed, two pull requests cannot modify the same file; merge conflicts are structurally avoided.

## Status of implementation (milestone M5)

Built and tested: the inbox model and the groups of files (CTB-01 to CTB-04, ATT-01 to ATT-07); the shared validation (VA-01 to VA-03) used by `ingest`, `review` and the browser; the bot comment and labels (FB-01, FB-03); the merge policy and the auto-merge decision (MP-01 to MP-04);
ingestion after merge (IN-01 to IN-03); the Contribute page (path C1: CTB-10 to CTB-14, with the ZIP and the upload page; CTB-15 transports T1 for one small match and T2); the issue form path (C2: CTB-20, CTB-21); the upload page path (C3: CTB-30); the safety rules (SC-01, SC-02, SC-04).
Written, not yet run on GitHub: the four workflows. Built since: enrichment of existing matches (ATT-07, `bgdb enrich`); no guessed plays and set positions refused (VA-04); partial matches (VA-05, MP-05): shown with their `.mat` and added only with consent, `bgdb ingest --salvage` for archives; text files that are not UTF-8. Not built: the command line `submit` and bulk importers (C4, C5), "Suggest a fix" (C6), the relay (C7), the welcome with a link to a two-minute guide (FB-02, only the welcome text), recognition pages (RC-01 beyond "added by"), metrics (ME-01).
See [../contributing-flow.md](../contributing-flow.md).

## Contribution paths

All paths lead to the same result: files in `inbox/` merged through a pull request. The more convenient paths come first.

| **ID** | **Path**                        | **Needs**               | **Experience**                                                                                                                                                             |
|:-------|:--------------------------------|:------------------------|:---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| C1     | “Drop a file” on the website    | Browser, GitHub account | Drag the file(s) onto a page. The page parses and validates locally, shows a summary and detected duplicates, pre-fills metadata, and hands over to GitHub with one click. |
| C2     | “Paste a match” form            | Browser, GitHub account | Paste the transcript into a form; a bot turns it into a pull request. Works on phones.                                                                                     |
| C3     | GitHub web upload               | GitHub account          | *Add file → Upload files* on `inbox/`; GitHub forks and opens the pull request automatically.                                                                              |
| C4     | Command line                    | Node.js, git            | `npx bgdb submit file.mat` validates, normalizes and opens the pull request through the GitHub CLI.                                                                        |
| C5     | Bulk importer                   | Node.js, git            | `bgdb import --format <name> folder/` converts an archive and splits it into several pull requests.                                                                         |
| C6     | “Suggest a fix” on a match page | Browser, GitHub account | Pre-filled edit of metadata, or request of takedown, from the match page itself.                                                                                           |
| C7     | Relay bot (optional extension)  | Browser                 | A small serverless function creates the pull request on the contributor’s behalf; no GitHub account needed; moderated.                                                     |

### C1 – Drop a file (primary path)

<a id="CTB-10"></a>**[CTB-10]** The “Contribute” page accepts one or many files by drag and drop, a file chooser, or paste. It detects the format, parses it with the shared validator, and shows for each match: players, date, length, result, number of moves, and *OK / warning / error* badges.

<a id="CTB-11"></a>**[CTB-11]** The page shows a miniature replay (first and last position) so the contributor can recognise their match and confirm it was parsed correctly.

<a id="CTB-12"></a>**[CTB-12]** The page looks up duplicates using the global hash list and marks them (“already in the database since 2026-03-12”), offering to submit enrichment only ([§10](10-contribution.md)).

<a id="CTB-13"></a>**[CTB-13]** Metadata (event, date, location, player aliases) is inferred from headers, file names and previous contributions; the contributor can correct it inline. Unknown fields stay empty and are never blocking. *Implemented for event, round and date ([decision 0022](../decisions/0022-event-round-from-headers-and-file-names.md)): headers are cleaned automatically, file names are read by `bgdb meta` into a review sheet whose reviewed values go to the `.bgdb.json` sidecar, and a match the list cannot tell apart from another is reported with a warning. Inline correction on the Contribute page, location and player aliases are still to do.*

<a id="CTB-14"></a>**[CTB-14]** A single checkbox states the rights declaration (“I have the right to share this under the database licence”); the licence and a short privacy note are shown once, with a link to details.

<a id="CTB-15"></a>**[CTB-15]** The hand-over uses one of the following *transports*, in this order of preference, selected automatically by size and capability:

1.  **Pre-filled issue.** A link to the data repository’s issue form ([Appendix E](90-appendices.md)) with title and body pre-filled and the payload (compressed, URL-safe) embedded; a bot converts the issue into a pull request. Limited by URL length, so used for single matches.

2.  **Download and upload.** The page produces a normalized file with a good name (and a ZIP for several files) and opens GitHub’s upload page for `inbox/`; the contributor drops the file in and presses *Propose changes*.

3.  **Relay** (if enabled): one click, no GitHub account.

*Implemented differently (tools v8, [decision 0015](../decisions/0015-contribution-loop.md)): the page produces the ZIP and opens the issue form, where the contributor drops it (GitHub's own file upload of issues); a bot turns it into a pull request. The upload page (2) needed a fork, which first-time contributors could not manage. The page is five numbered steps with pictures of GitHub, also shown on their own ("How to contribute").*

The hand-over MUST work without the website holding any secret; secrets are only used by optional relay components.

### C2 – Paste a match

<a id="CTB-20"></a>**[CTB-20]** The issue form ([Appendix E](90-appendices.md)) accepts a pasted transcript in any supported text format and optional free-text notes. A bot creates a branch and a pull request containing the file, links it to the issue, and replies with the validation report.

<a id="CTB-21"></a>**[CTB-21]** If the pasted text cannot be parsed, the bot replies in the issue with the first error position and does *not* open a pull request; editing the issue triggers a new attempt. *Implemented, and extended (tools v8, [decision 0015](../decisions/0015-contribution-loop.md)): the first box also takes the ZIP of the Contribute page dropped into it; the bot downloads it from GitHub, checks it against the database (errors, duplicates, partial matches) and opens the pull request only when it can be added, then answers on the issue again with the links to the matches after the ingest.*

### C3 – GitHub web upload

<a id="CTB-30"></a>**[CTB-30]** The repository’s `inbox/README.md` contains a three-line instruction and a direct link to the upload page. The pull request template is reduced to one checkbox (rights) and an optional comment field.

### C4 and C5 – Command line and bulk import

<a id="CTB-40"></a>**[CTB-40]** The CLI bundles the validator, normalizer, importers and exporters, runs offline, and prints the same messages as the website and the bot.

<a id="CTB-41"></a>**[CTB-41]** `bgdb submit` creates the fork and branch if needed, commits the files to `inbox/`, and opens the pull request, with a dry-run mode.

<a id="CTB-42"></a>**[CTB-42]** Importers exist as plug-ins (input format → logical model) with a documented interface, so new sources can be added by contributors. Bulk imports are split into pull requests of at most 500 matches each (configurable) so that review and CI stay fast.

<a id="CTB-43"></a>**[CTB-43]** Large imports (for example a club archive) SHOULD be announced in an issue so that maintainers can coordinate rights and licensing.

### C6 – Suggest a fix

<a id="CTB-50"></a>**[CTB-50]** Each match page offers: *Fix metadata*, *Add analysis*, *Add comment*, *Report a problem*. Each opens GitHub with a pre-filled pull request or issue targeting an overlay or enrichment file (`inbox/enrich/<id>.json`), never a sealed shard.

<a id="CTB-51"></a>**[CTB-51]** Enrichment submissions are validated against the existing match identity (the target must exist) and are merged by the same automation.

### C7 – Optional relay

<a id="CTB-60"></a>**[CTB-60]** A relay MUST be optional, replaceable, and documented. It receives a payload, runs the same validator, and creates a pull request with a bot identity using a token held by the relay only. Anonymous submissions pass through a moderation queue (label `needs-review`) and rate limits.

## Companion files, extras and video links

A contribution is a *group of files* that share a base name in the inbox. The group is the unit of validation, ingestion and feedback.

<a id="ATT-01"></a>**[ATT-01]** Files named `name.mat` or `name.txt` (the match as text), `name.sgf` (GNU Backgammon SGF, possibly with analysis), `name.xg` (eXtreme Gammon file) and `name.bgdb.json` (optional extras) form one contribution. The text version is the primary file; if there is none, the SGF is.

<a id="ATT-02"></a>**[ATT-02]** SGF and XG files are kept as attachments. An SGF is *verified*: it is read, and must have the same match identity as the primary file, otherwise it is not kept and a warning (`V-ATTACH`) says so. If the SGF and the text disagree on the points of a game, the text value is used and the difference is reported.

<a id="ATT-03"></a>**[ATT-03]** An XG file is read like the other formats ([docs/formats/xg-binary.md](../formats/xg-binary.md)): alone, it is the match; next to a text or SGF version it is *verified* (same match identity) and kept as an attachment. A variant the reader cannot read is kept unverified, with a warning, only next to a text or SGF version of the same match.

<a id="ATT-04"></a>**[ATT-04]** A problem with an attachment (too large, not what it claims, another match) never blocks the match: the attachment is skipped with a warning. The size limit is `sealPolicy.maxAttachmentKB`.

<a id="ATT-05"></a>**[ATT-05]** Attachments are listed in the match's metadata with their SHA-256; `build` verifies them again and refuses a missing or damaged attachment.

<a id="LNK-05"></a>**[LNK-05]** A contributor can supply video links in two ways: a repeatable tag in the text header, `; [Video "https://youtu.be/..."]`, or a `name.bgdb.json` file with `{"links": [{"url": "...", "title": "...", "game": 2, "time": 95}], "tags": ["final"]}`; the same file can declare illegal plays that were made (`"illegal"`) and agree to a partial match (`"accept": "partial"`, [[VA-05]](#VA-05)). Both are validated as in [[LNK-01]](#LNK-01) to [[LNK-03]](#LNK-03). Unknown keys and invalid tags are ignored with a warning.

<a id="ATT-07"></a>**[ATT-07]** Extra files of a match that already exists (a later SGF or XG file, a video link, tags) enrich the existing match: they are recorded as an enrichment ([OV-03](05-storage.md#OV-03)) and the match itself is not changed. A duplicate that brings nothing new is only reported. This is the enrichment path of [[CTB-50]](#CTB-50).

## Validation pipeline

Validation runs, in this order and with the same code, in the browser, in the CLI and in CI. Severity levels: **error** blocks merge, **warning** allows merge and is flagged, **info** is advisory.

| **Check**  | **What it verifies**                                                         | **Severity**    | **Typical fix offered**                                                      |
|:-----------|:-----------------------------------------------------------------------------|:----------------|:-----------------------------------------------------------------------------|
| V-FILE     | Allowed extension, size limit, not an archive bomb, text encoding detectable | error           | Re-save as plain text; split large files.                                    |
| V-FORMAT   | Format detected and parsed into the logical model                            | error           | Show first failing line and expected syntax.                                 |
| V-LEGAL    | Every move legal (dice, blocked points, hits, bar, bear-off, cube rules)     | error           | Highlight the first illegal move; offer to cut the transcript at that point. |
| V-SCORE    | Score, Crawford and result consistent with the games                         | error / warning | Recompute; offer corrected metadata.                                         |
| V-META     | Metadata matches the schema; dates plausible; tags well formed               | warning         | Normalize automatically.                                                     |
| V-NAMES    | Player names resolved to identities or flagged as new                        | info            | Suggest known aliases.                                                       |
| V-DUP      | Content hash already known (within the PR or database)                       | info            | Offer “enrichment only”.                                                     |
| V-RIGHTS   | Rights checkbox present; no obvious private data (e-mail, phone) in comments | error / warning | Offer to remove the flagged text.                                            |
| V-SIZE     | Pull request within limits (files, total size)                               | error           | Suggest splitting.                                                           |
| V-ANALYSIS | Analysis (if present) consistent with the match; engine declared             | warning         | Strip or relabel.                                                            |

<a id="VA-01"></a>**[VA-01]** Validation MUST be deterministic and side-effect free; it MUST NOT execute contributed content or follow links.

<a id="VA-02"></a>**[VA-02]** Error messages MUST include a stable code, a human sentence, a location (file, line), and a *how to fix* hint. A machine-readable report (`report.json`) is produced for tools.

<a id="VA-03"></a>**[VA-03]** Where a normalization is unambiguous (line endings, encoding, whitespace, header casing, file naming), the bot applies it silently and reports it as *info* rather than asking the contributor to fix it. A text file that is not valid UTF-8 is read as Windows-1252 (UTF-16 when it starts with a byte order mark); the stored form is UTF-8.

<a id="VA-04"></a>**[VA-04]** A match MUST NOT be stored with plays that were guessed: a typo is corrected only when exactly one legal play makes the game valid, and a game that starts from a set position (or jumps to one) is refused, never replayed from the opening position.

<a id="VA-05"></a>**[VA-05]** When some games of a match cannot be read but its score story is clear, the match MAY be added *partially* (decision 0021): a game whose moves cannot be read is kept by its result only when two sources confirm that result, or left out otherwise, provided the winner of the match stays known and no score or winner contradicts the file. A partial match MUST NOT be added without consent: the contributor's, for one match (`"accept": "partial"` in its sidecar), or the maintainer's, for an archive import (`bgdb ingest --salvage`).

## Feedback to the contributor

<a id="FB-01"></a>**[FB-01]** The bot posts one comment per pull request (updated in place on each push) with: a one-line verdict, a table of matches (new / duplicate / enrichment / error), warnings with fixes, and a “what happens next” sentence. For a match that can only be added partially it also shows what would be kept, the errors that a fix would remove, how to agree, and the normalised `.mat` that would be stored (when it fits in the comment; otherwise the command that writes it).

<a id="FB-02"></a>**[FB-02]** The tone is friendly and short; the first comment for a new contributor includes a welcome and a link to a two-minute guide.

<a id="FB-03"></a>**[FB-03]** Labels reflect state: `ready`, `needs-fix`, `duplicate`, `needs-review`, `needs-confirmation`, `partial`, `auto-merge`, `enrichment`, `bulk`.

    Thanks, @alice! Checked 3 matches in 4 s.
      OK       Smith vs Jones, 7 pts, 2019-05-04          -> will be added
      OK       Lee vs Park, 9 pts (no date found)          -> will be added
      Skipped  Chen vs Ito, 5 pts: already in the database (0002/3f9a...)
    Notes: line endings were normalised. Names matched to existing players.
    Next: this pull request merges automatically in about 10 minutes.

## Merge policy and automation

<a id="MP-01"></a>**[MP-01]** A pull request that (a) only touches `inbox/`, (b) has no errors, (c) is within size limits, (d) has the rights declaration, and (e) comes from a contributor without outstanding moderation flags, is merged automatically after a short delay (default ten minutes, to allow withdrawal).

<a id="MP-02"></a>**[MP-02]** Pull requests with warnings of type V-NAMES, V-ANALYSIS or V-RIGHTS go to `needs-review`. Maintainers answer within a published service target (default: seven days) and may delegate review to trusted contributors.

<a id="MP-05"></a>**[MP-05]** A pull request with a match that can only be added partially, without the contributor's agreement ([[VA-05]](#VA-05)), is `needs-confirmation`: it is not merged automatically, and the ingest after a merge leaves such a match in the inbox. Once the contributor agrees, the pull request follows [[MP-01]](#MP-01).

<a id="MP-03"></a>**[MP-03]** Pull requests touching anything other than `inbox/` (tools, policy, overlays) follow normal code review and CODEOWNERS rules.

<a id="MP-04"></a>**[MP-04]** The system continues to function with zero human review for clean submissions; humans handle exceptions only.

## Ingestion after merge

<a id="IN-01"></a>**[IN-01]** The ingestion job runs on every push to the default branch, serialized by a concurrency group so that two ingestions never write the same shard simultaneously.

<a id="IN-02"></a>**[IN-02]** For each inbox file the job: re-validates; converts to the shard’s primary profile; computes the content hash and identifier; skips or enriches duplicates; writes files into the open shard; updates `shard.json` counts and summaries; removes the inbox file; and commits with a message listing the contributor.

<a id="IN-03"></a>**[IN-03]** If the open shard reaches a seal threshold, the job marks it `sealed`, creates the next shard, and updates the registry. Growing into a new data repository is not a workflow: the ingest warns, then stops opening shards near the size limit, and a maintainer creates the next repository and switches to it with two commands ([decision 0024](../decisions/0024-data-repositories.md)).

<a id="IN-04"></a>**[IN-04]** The build job generates indexes and manifests and deploys the site. A failed build never removes the previously deployed version.

## Corrections, removals and enrichment

<a id="CR-01"></a>**[CR-01]** Corrections to sealed shards are stored as overlay or enrichment records ([[OV-01]](05-storage.md#OV-01)) and take effect at the next site build, without rewriting sealed files.

<a id="CR-02"></a>**[CR-02]** A takedown request is accepted through an issue form and acted on promptly ([§11](11-rights-governance.md)). Hard removal (history rewrite) is reserved for legal necessity and documented in a public log.

## Recognition

<a id="RC-01"></a>**[RC-01]** Each match page shows “contributed by” (GitHub handle or pseudonym, opt-out available) and the submission date. A generated `CONTRIBUTORS` page lists contributors by number of matches and by first contribution date.

<a id="RC-02"></a>**[RC-02]** The bot thanks the contributor on merge and links to the live page of the new match.

## Security of the contribution pipeline

<a id="SC-01"></a>**[SC-01]** Workflows triggered by pull requests from forks use read-only tokens and run only the data validator; they never execute code from the pull request. Privileged steps (merging, ingestion) run on the default branch.

<a id="SC-02"></a>**[SC-02]** The validator runs with resource limits (time, memory, file size, decompression ratio) and processes data as text only.

<a id="SC-03"></a>**[SC-03]** First-time contributors may need workflow approval from a maintainer according to repository settings; the documentation tells contributors that this is expected and how long it takes. Maintainers MAY allow automatic approval for pull requests touching only `inbox/`.

<a id="SC-04"></a>**[SC-04]** Third-party actions are pinned to commit hashes; secrets are never exposed to fork-triggered workflows.

## Metrics

<a id="ME-01"></a>**[ME-01]** The project tracks, in aggregate and publicly: median time from submission to merge, share of submissions merged without human intervention, top error codes, share of abandoned pull requests, and number of first-time contributors per month. Error codes that dominate are candidates for better automatic fixes.
