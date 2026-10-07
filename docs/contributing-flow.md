> [bg-db](../README.md) · [Documentation](README.md)

# The contribution flow (milestone M5)

How a match gets from a contributor into the database, what is built, what the maintainer has to set up on GitHub once, and how to test it. The design is in spec section 10
([10-contribution.md](spec/10-contribution.md)); the reasons for the safety choices are in [decision 0015](decisions/0015-contribution-loop.md).

## For a contributor: three ways, one result

Every way ends the same: the files land in `inbox/` of the **current data repository** (the one `sources.json` marks `current`, [decision 0024](decisions/0024-data-repositories.md)) through a pull request; a bot checks them, and merges the pull request automatically when everything is fine; after the merge the matches are filed
into the database. A match is a group of files with the same name: `my-match.txt` (or `.mat`), optionally `my-match.sgf` (GNU Backgammon, with analysis), `my-match.xg` (eXtreme Gammon), and `my-match.bgdb.json`.
The event and round come from the file's headers; when they are missing, or when several matches of a series would look the same in the
list, give them in `my-match.bgdb.json`: `{"event": "Club Championship 2025", "round": "Final - Match 3"}` (decision 0022). Sending the
same match again with such a file corrects a match that is already in the database.

| Way | For | What you do |
|---|---|---|
| **The Contribute page** (`contribute.html` on the site) | most people | Drop the files (or paste the text). The page checks them in your browser with the same rules as the database and shows, for each match, whether it is new, already in the database, or needs a fix, with a picture of the last position. Add a YouTube link and tags if you want, tick the rights box and download the ZIP. GitHub lets a person upload files only into a repository they can write to, so the ZIP goes through **your own copy** of the data repository: the first time, "Make your copy (fork)"; then type your GitHub name (remembered by your browser), open the upload page of your copy, drop the ZIP **as it is** (or its files), choose "Create a new branch for this commit and start a pull request", press "Propose changes", check that the pull request goes to the data repository, and press "Create pull request". The ZIP carries the rights statement you ticked (`CONTRIBUTION.md`), so the box of the pull request needs no second tick. For one small match it can also open a pre-filled issue, which needs no copy. |
| **A GitHub issue** ("Submit a match" form of the current data repository) | one match, pasted as text | Paste the text, tick the rights box. A bot checks it and opens the pull request for you. |
| **A pull request** | people used to git | Add the files to `inbox/` of the current data repository and open a pull request. `npm run check` there (or `npm run bgdb -- review --inbox ...` in `bg-db`) tells you beforehand what the bot will say. |

Nothing has to be named in a special way, filled in, or organised: the database never asks for metadata that the file already contains. If something is wrong, the message says what, where and how to fix it.

## What happens to a pull request

The workflows of a data repository are five short files that call the reusable workflows of `bg-db` (`.github/workflows/data-*.yml`) at the tag the data repository
pins (`@v4`, for example): the tools that check and file matches are those of that tag, so a new release of `bg-db` changes nothing in a data repository until its tag is moved.

1. **`validate`** (workflow, read-only): reads the pull request's files as data, with the tools of `bg-db` at the pinned tag and the configuration of the **base branch**, and runs `bgdb review`. Its result is the status check "validate / validate" (it fails when a fix is needed).
2. **`review-publish`** (workflow, runs in the base repository after `validate`): redoes the review itself, then posts **one comment** (updated in place), sets the **labels** and, when the verdict is `ready`, **merges** it (squash), only if its last commit is the one it checked, and with `BGDB_BOT_TOKEN`, so that the merge starts the ingest.
3. No branch rule is involved: the review decides, and only people with write access can merge by hand.
4. **`ingest`** (workflow on the default branch, one run at a time): runs `bgdb ingest --contributor <author>` on `inbox/`, commits `data/` (and empties `inbox/`), and optionally starts the publication of the site.

The verdicts (ready, needs-fix, needs-review, needs-confirmation, duplicate, empty) and the labels are in [commands.md](commands.md#bgdb-review). A pull request that changes anything outside `inbox/`, or that contains an illegal play that
was made, is never merged by the bot: it waits for a maintainer.

**A match that can only be added partially** (some games cannot be read; decision 0021) is never added without the contributor's agreement. The comment shows what would be kept,
the errors (to fix the file instead) and the `.mat` that would be stored; the verdict is `needs-confirmation` (no merge). The contributor agrees by adding `{"accept": "partial"}` to the
match's `.bgdb.json` and pushing: the review becomes `ready`, and the ingest after the merge adds exactly what was shown. On the Contribute page this is a box ("Add it partially")
next to a download of the `.mat`; in the issue form, a box of its own.

## Safety (why two workflows)

A pull request from a fork gets a read-only token and cannot comment; a workflow that runs with a write token must never run the pull request's code. So:

- `validate` uses the plain `pull_request` event: a read-only token, the **tools come from `bg-db` at the pinned tag** and the configuration from the base branch (two more checkouts), the pull request is only data. A pull request cannot change how it is checked. The only secret it may use, `BGDB_TOOLS_TOKEN`, reads the tools while `bg-db` is private.
- `review-publish` has the write token, but trusts **nothing** produced by the pull request: it does not read any artifact, finds the pull request number itself, reads the files as data and redoes the review with the tools at the pinned tag and the configuration of the default branch.
- No workflow puts untrusted text (issue, pull request description, branch name) into a shell command; it goes through environment variables (a test checks this). Only actions published by GitHub are used, each **pinned to a commit hash** with its version in a comment (`actions/checkout@11d5960...   # v4.4.0`, spec SC-04), so that a moved tag cannot change what runs; a test checks it. To update one: `git ls-remote --tags https://github.com/actions/checkout.git` lists each version with its commit (use the line ending in `^{}` when there is one), then change the hash and the comment everywhere it is used.
- Text from files that ends up in a comment is escaped (no links, mentions, HTML or table breaks), and the site shows data only as text.
- Anything wrong with an attachment (too large, another match, not an XG file) never blocks the match: it is skipped with a warning.

## What the maintainer sets up once (GitHub)

For each data repository: the settings (squash merging, no branch rule, the label `submission`, Pages) and the two secrets
(`BGDB_BOT_TOKEN`, and `BGDB_TOOLS_TOKEN` while `bg-db` is private). `npm run new-data-repo` and `npm run publish-data-repo` make the settings and say what they
could not do; what each one is for, how to check it, and how to make the secrets, step by step: [data-repositories.md](data-repositories.md#3-the-two-secrets).
Two defaults are right as they are: Settings > Actions > General > "Fork pull request workflows" (a maintainer approves the first run of a first-time contributor,
which CONTRIBUTING.md says), and "Allow GitHub Actions to create and approve pull requests", which stays off: the issue workflow opens its pull requests with `BGDB_BOT_TOKEN`, without which the issue route fails.

The Contribute page takes the repository to fork, the name of the copy's upload page and the issue form from the `current` entry of `sources.json` (`repository`, `defaultBranch`); without
`sources.json`, from `bgdb.config.json` of the repository it was built from.

## Not tested yet: the workflows

The tools behind the workflows (review, verdicts, comment, issue conversion, the Contribute page) have automated tests, and the workflow files are checked for their safety rules and their YAML syntax. **The workflows themselves have not
run on GitHub**: that needs the repository. Before relying on them, test them in a scratch repository:

1. Follow [data-repositories.md](data-repositories.md) sections 1 to 4: `bg-db` on GitHub with its tag, a data repository (a scratch name is fine), its secrets and settings.
2. From a second branch, add a valid match to `inbox/` and open a pull request: expect the check `validate / validate`, then a comment, the labels `ready` and `auto-merge`, a merge within a few minutes, and a commit "ingest: matches added by ..." on `master` with the match in `data/`.
3. Open a pull request with a broken file: expect `needs-fix`, a failing check and no merge; fix it with a new commit: expect the same comment to be updated and the merge.
4. Open a pull request that also edits a file outside `inbox/`: expect `needs-review` and no merge.
5. Open a pull request with a match of several games whose game 2 has an impossible move: expect `needs-confirmation`, the labels `needs-confirmation` and `partial`, the `.mat` in the comment, and no merge; add `{"accept": "partial"}` in its `.bgdb.json`: expect `ready` and a merge, and the match stored with game 2 kept by its result.
6. Create an issue with the "Submit a match" form (label `submission`): expect an answer on the issue and a pull request.
7. From a fork (another account), open a pull request: expect to approve the first run, and the comment to appear.
8. After an ingest: expect the `pages` workflow to publish `data/` (with `PUBLISH_AFTER_INGEST`), and the site of `bg-db`, built with `sources.json`, to list the match.
9. Make a second scratch data repository and switch to it (`npm run switch-data-repo`, run until it says it is done): expect a pull request to the first one to get the verdict `closed`, the first one archived, and a duplicate of its match sent to the second one recognised.

If a step fails, the workflow log names the step. Typical causes are in [data-repositories.md](data-repositories.md#10-troubleshooting): a missing secret, a branch rule on `master`, squash merging not allowed.

## Not done yet

The relay for people without a GitHub account (spec C7), a command line `bgdb submit` that opens the pull request (C4), bulk importers (C5), "Suggest a fix" on a match page (C6), a generated CONTRIBUTORS page and the metrics of spec ME-01.
Editing the event, date or round on the Contribute page is not offered: edit the header of the file instead.

**Extras for a match that already exists** (a video link, tags, an SGF or XG file) are accepted: submitted again with the same match, or alone with `bgdb enrich`, they enrich the existing match (the review says "will add ... to it", the label `enrichment`, and the pull request is merged like any other when it is clean).
