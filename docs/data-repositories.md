> [bgdb](../README.md) · [Documentation](README.md)

# Data repositories: the maintainer's procedures

Everything the maintainer may have to do with data repositories, step by step: making the first one, putting it on GitHub, its secrets and settings, working
in it, moving it to a new version of the tools, switching to the next one, undoing, and erasing a match. The reasons are in [decision 0024](decisions/0024-data-repositories.md);
the options of the commands are in [commands.md](commands.md#scriptsdata-reposmjs).

**In short.** `bgdb` holds the tools and the site, no matches. The matches live in data repositories (`bgdb-data-1`, then `bgdb-data-2`, ...), each a GitHub
repository of its own, checked out on your machine **next to** `bgdb`:

```
~/repo/bgdb            the tools and the site; sources.json lists the data repositories
~/repo/bgdb-data-1     inbox/, data/, bgdb.config.json, five workflows that call those of bgdb at the tag v1
```

Exactly one data repository is **current**: contributions go to it. Three commands, run in `bgdb`, do the work:

| Command | What it does | When |
|---|---|---|
| `npm run new-data-repo -- <name>` | makes `../<name>` from `templates/data-repo/`, commits it, puts it on GitHub with its settings, lists it in `sources.json` | the first data repository; later, when the current one nears 1 GB |
| `npm run publish-data-repo -- <name>` | the GitHub part only, for a repository made with `--local`, or to finish or check one; safe to repeat | when you are ready to go on GitHub |
| `npm run switch-data-repo` | closes the current repository, seals it, and makes the next one current | after `new-data-repo`, when you decide |

Every command accepts `--dry-run` (print the steps, do nothing). `new-data-repo` and `switch-data-repo` accept `--local` (everything but GitHub).

**Where things stand (2026-10-08):** `bgdb` is on GitHub (`pipandlove/bgdb`, its site at `https://pipandlove.github.io/bgdb/`), and `bgdb-data-1` is the current
data repository, on tools `v12`. Sections 1 and 2 are done; the next steps are [7](#7-a-new-version-of-the-tools) for each release, and [8](#8-the-next-data-repository-and-the-switch) near 1 GB.

## 1. Before you start (once)

### 1.1 Install `gh`, the GitHub command line, and log in

```sh
sudo apt install gh                  # or a recent version: https://github.com/cli/cli/blob/trunk/docs/install_linux.md
gh auth login --scopes workflow      # GitHub.com, HTTPS, "Authenticate Git with your GitHub credentials": Yes, "Login with a web browser"
gh auth status                       # "Logged in to github.com account pipandlove", with the scopes repo and workflow
```

The scope `workflow` is what lets `git push` send files of `.github/workflows/`; without it GitHub refuses the push of a data repository.

### 1.2 Choose how private the repositories are

While the project stays private (decision 0006), the GitHub plan matters. GitHub's plans change: check its pricing page. As of this writing:

| | Private, GitHub Free | Private, GitHub Pro (paid) | Public |
|---|---|---|---|
| Workflows run (`validate`, `ingest`, ...) | yes (a monthly quota of minutes) | yes | yes |
| Pages (the published data and site) | **no** | yes | yes |
| Who sees the matches | you | you | everyone |

On a private repository of a free plan, the commands still work: what GitHub refuses becomes a warning, and the rest is done. Without Pages there is no
published site. Nothing is lost: once the plan or the visibility changes, run
`npm run publish-data-repo -- <name>` again and it sets what is missing.

### 1.3 The git identity of `bgdb`

Your global git configuration has no identity on purpose; each repository has its own. The data repositories use the identity of `bgdb`, so it must be set:

```sh
git -C ~/repo/bgdb config user.name     # pipandlove
git -C ~/repo/bgdb config user.email    # 302734070+pipandlove@users.noreply.github.com
```

### 1.4 Put `bgdb` on GitHub, with the tag `v1`

The workflows of a data repository run the tools of `pipandlove/bgdb` (the `repository` of `bgdb.config.json`) at a tag, `v1`. So `bgdb` must be on GitHub,
and the tag must exist there. Find out whether `pipandlove/bgdb` exists already:

```sh
gh repo view pipandlove/bgdb
```

- **It does not exist** ("Could not resolve to a Repository"): create it from this folder, private, and push.

  ```sh
  cd ~/repo/bgdb
  gh repo create pipandlove/bgdb --private --source . --remote origin --push
  ```

- **It exists:** connect this folder to it and look before pushing.

  ```sh
  cd ~/repo/bgdb
  git remote add origin https://github.com/pipandlove/bgdb.git
  git fetch origin
  git log --oneline -3 origin/master     # what GitHub has; then: git push -u origin master
  ```

  If `git push` is refused ("rejected, fetch first"), the history on GitHub differs from yours: stop and sort it out before going on (do not force it).

Then the tag, if `bgdb` has none on GitHub yet (`git ls-remote --tags origin`). A tag is a name for one commit: the data repositories use exactly that version
of the tools, whatever happens to `master` later. Use the tag of `DEFAULT_TOOLS_REF` in `scripts/data-repos.mjs` (section 7 lists the tags):

```sh
git tag v1
git push origin v1
```

## 2. The first data repository

From `bgdb`. Look first, then do it:

```sh
npm run new-data-repo -- bgdb-data-1 --dry-run     # the steps, nothing done
npm run new-data-repo -- bgdb-data-1               # on GitHub (needs 1.1 to 1.4)
npm run new-data-repo -- bgdb-data-1 --local       # or: only on this machine, GitHub later (needs 1.3)
```

What it does, in order (the output prints each step):

1. Checks `gh` is installed and logged in, that `pipandlove/bgdb` exists on GitHub, and whether the tag `v1` is there (skipped with `--local`). If something is
   missing it stops here, before making anything.
2. Makes `../bgdb-data-1` from `templates/data-repo/`: the five workflows (pinned to `v1`), `bgdb.config.json` (`firstShard: 1`), README, CONTRIBUTING, the issue
   form, `inbox/`. Makes it a git repository with the identity of `bgdb`, and commits it.
3. Writes `sources.json` in `bgdb`, with `bgdb-data-1` as `current` (it is the first).
4. On GitHub (not with `--local`): creates `pipandlove/bgdb-data-1` (private; `--public` for public) and pushes, then makes [the settings](#4-the-settings),
   and publishes the repository once (its `pages` workflow), so that the site finds its `registry.json` before any match is added.
5. Prints **warnings**: each one is something it could not do, with what to do by hand.

Then, in `bgdb`, commit `sources.json`:

```sh
git add sources.json && git commit -m "sources.json: bgdb-data-1" && git push
```

If the GitHub part stopped half way (the network, a refusal), the folder and `sources.json` are kept: fix the cause and run
`npm run publish-data-repo -- bgdb-data-1` to finish.

**Later, to go on GitHub with a repository made with `--local`:** do 1.1 to 1.4, then `npm run publish-data-repo -- bgdb-data-1`. It creates the repository and
pushes, or pushes to it if it exists, then makes the settings. Run it again whenever you want to check: it changes only what is missing.

## 3. The two secrets

A **secret** is a value stored in a GitHub repository (Settings > Secrets and variables > Actions) that its workflows can use and nobody can read back. The data
repositories may need two, both **tokens**: passwords for programs, made on your GitHub account with only the rights they need. `new-data-repo` and
`publish-data-repo` cannot make them for you (GitHub shows a token only to you, once); they warn when one is missing. Make the data repository first: a token
is given access to repositories that exist.

| Secret | Why | Needed |
|---|---|---|
| `BGDB_TOOLS_TOKEN` | the workflows of a data repository fetch the tools from `pipandlove/bgdb`. While `bgdb` is **private**, the token GitHub gives a workflow can only read its own repository, so without this secret every workflow fails at "The tools, at the pinned tag" | while `bgdb` is private |
| `BGDB_BOT_TOKEN` | the workflows act for you where GitHub's own workflow token is not enough: a "Submit a match" issue becomes a pull request (GitHub's token may not open one: "GitHub Actions is not permitted to create or approve pull requests", and a pull request it opens starts no check), and the automatic merge is made in your name, so that its push starts the ingest (a push made with GitHub's token starts no workflow) | **yes**: without it the issue route fails, and merged matches wait in `inbox/` until you run the ingest by hand (Actions > ingest > Run workflow) |

### 3.1 Make a token (on github.com)

Your picture (top right) > **Settings** > **Developer settings** (bottom of the left column) > **Personal access tokens** > **Fine-grained tokens** >
**Generate new token**. Then:

| Field | `BGDB_TOOLS_TOKEN` | `BGDB_BOT_TOKEN` |
|---|---|---|
| Token name | `bgdb tools, read` | `bgdb-data-1 bot` |
| Expiration | a date you note down (renew it before: section 3.3) | the same |
| Resource owner | pipandlove | pipandlove |
| Repository access | **Only select repositories**: `bgdb` | **Only select repositories**: `bgdb-data-1` |
| Repository permissions | **Contents: Read-only** | **Contents: Read and write**, **Issues: Read and write**, **Pull requests: Read and write** |

("Metadata: Read-only" is added by itself.) Press **Generate token** and copy it: GitHub shows it only now.

### 3.2 Store it in the data repository

```sh
gh secret set BGDB_TOOLS_TOKEN -R pipandlove/bgdb-data-1     # paste the token when asked (it is not shown), Enter
gh secret set BGDB_BOT_TOKEN -R pipandlove/bgdb-data-1
gh secret list -R pipandlove/bgdb-data-1                       # the names (never the values)
```

Or on github.com: the data repository > **Settings** > **Secrets and variables** > **Actions** > **New repository secret**, name and value.
`npm run publish-data-repo -- bgdb-data-1` no longer warns about a secret that is there.

### 3.3 Later

- **Renew** before the expiration date: the same page on github.com > the token > **Regenerate token**, then `gh secret set` again with the new value.
- **A new data repository** needs the secrets too: `BGDB_TOOLS_TOKEN` can be the same token (it reads `bgdb`); `BGDB_BOT_TOKEN` needs a token that has access to
  the new repository (edit the token's repository access, or make a new one).
- **When `bgdb` becomes public,** `BGDB_TOOLS_TOKEN` is no longer needed: delete the secret and the token.

## 4. The settings

What `new-data-repo` and `publish-data-repo` set on GitHub. Each line says why, and where to check or do it by hand when a warning says it was refused.

| Setting | Why | Where (github.com, in the data repository unless said) |
|---|---|---|
| Allow **squash merging**, delete branches after merge | the bot merges a clean pull request by itself, as one commit that carries the contributor's name (which is how the contributor is recorded) | Settings > General > Pull Requests |
| **No branch rule** on `master` | the bot's review decides the merge (right after `validate`, only the commit it checked), and the ingest commits to `master` after it: a rule requiring a check would refuse those commits ("GH006: Protected branch update failed"). Only people with write access (you) can merge by hand | Settings > Branches: no rule for `master` (remove one if it is there) |
| The label **`submission`** | the "Submit a match" issue form puts it on new issues, and the issue workflow acts only on issues that have it | Issues > Labels (`gh label create submission -R ...`) |
| **Pages**, source GitHub Actions | the data repository publishes its `data/` (registry, shards) for the site to read | Settings > Pages > Build and deployment > Source: GitHub Actions |
| The variable **`PUBLISH_AFTER_INGEST`** = `true` | the data is published again after each ingest (set only when Pages is on) | Settings > Secrets and variables > Actions > Variables |
| In **`bgdb`**: Actions access for the owner's repositories (only while `bgdb` is private) | lets the data repositories call the workflows of `bgdb` | `bgdb` > Settings > Actions > General > Access: "Accessible from repositories owned by the user 'pipandlove'" |

The site of `bgdb` is published by its own `pages` workflow (Actions > pages > Run workflow), once Pages is on for `bgdb` too (same setting) and
`sources.json` is committed (the workflow fails without it). It reads every
data repository of `sources.json`. See [deploy.md](deploy.md).

## 5. Checking that it works

On GitHub, once the secrets and settings are done: follow the test of [contributing-flow.md](contributing-flow.md#not-tested-yet-the-workflows) (a pull request
with a valid match, a broken one, an issue). The first run of each workflow is the moment to read its log (the data repository > Actions): a failure names the
step. Typical causes are in [Troubleshooting](#10-troubleshooting).

## 6. Working in a data repository on your machine

The ingest workflow commits on GitHub after each merge, so **pull before working**. A fresh clone has no git identity (yours is per repository): set it once.

```sh
cd ~/repo
gh repo clone pipandlove/bgdb-data-1                   # only if the folder is not there
cd bgdb-data-1
git config user.name pipandlove
git config user.email 302734070+pipandlove@users.noreply.github.com
git pull
npm run check                                  # what the bot would say about inbox/
npm run ingest -- --contributor pipandlove --dry-run
npm run ingest -- --contributor pipandlove
npm run build && npm run serve                 # the whole site with this repository's data: http://localhost:8080
git add -A data inbox && git commit -m "ingest: ..." && git push
```

**Adding a match yourself.** The Contribute page works for you as for anyone (its ZIP, dropped into a "Submit a match" issue). With git, use a branch and a pull request, so that the bot checks it like any other:

```sh
cd ~/repo/bgdb-data-1 && git pull
git switch -c add-match
cp ~/matches/my-match.txt inbox/
git add inbox && git commit -m "Add a match" && git push -u origin add-match
gh pr create --fill                            # the bot checks it and merges it; then: git switch master && git pull
```

These scripts run the tools of `../bgdb` (its current version, not the tag): keep `bgdb` up to date, or check out the tag there if you need exactly what
the workflows run. For a large archive, review it in a working folder as [importing-an-archive.md](importing-an-archive.md) says, then run its final ingest into this repository:
`npm run bgdb -- ingest --inbox <folder>/inbox --data ~/repo/bgdb-data-1/data --config ~/repo/bgdb-data-1/bgdb.config.json --salvage --contributor pipandlove` (from `bgdb`).

## 7. A new version of the tools

A data repository uses the tools at the tag in its workflows, so a change in `bgdb` reaches it only when you decide:

```sh
cd ~/repo/bgdb && git tag v2 && git push origin v2
cd ~/repo/bgdb-data-1
sed -i 's/\bv1\b/v2/g' .github/workflows/*.yml README.md
git diff                                       # two lines in each workflow, the comment of validate.yml, the README
git commit -am "Tools v2" && git push
```

New data repositories get the tag given by `--tools-ref`, by default `DEFAULT_TOOLS_REF` in `scripts/data-repos.mjs`: change it with each new tag.
Never move an existing tag: the identity of matches must not change by accident (decision 0003).

The tags so far:

| Tag | Date | What changed for data repositories |
|---|---|---|
| `v1` | 2026-10-07 | the first release |
| `v2` | 2026-10-07 | review-publish reads the pull request through the REST API (it failed with "Unknown JSON field: authorAssociation"); issue-to-pr says on the issue when it cannot open the pull request |
| `v3` | 2026-10-07 | review-publish turns on auto-merge with `BGDB_BOT_TOKEN`, so that the merge starts the ingest. A data repository moving to `v3` also adds `workflow_dispatch:` to its `ingest.yml` (the template has it: "Run workflow" by hand) |
| `v4` | 2026-10-07 | review-publish merges the pull request itself (only the commit it checked) instead of turning on auto-merge, so the data repository needs no branch rule, which refused the ingest's commits. A data repository moving to `v4` removes its branch rule on `master` |
| `v5` | 2026-10-07 | the review and the ingest accept the Contribute page's ZIP uploaded as it is (it was found empty: "no match file was found under inbox/"), and its rights statement (`CONTRIBUTION.md`) counts like the ticked box. Nothing to change in a data repository but the tag |
| `v6` | 2026-10-07 | review-publish no longer checks out the pull request (GitHub refused a fork's code in a `workflow_run`): it downloads the files the pull request adds under `inbox/` through the API, and takes the data and configuration from the default branch. Nothing to change in a data repository but the tag |
| `v7` | 2026-10-07 | review-publish finds the pull request of a fork's commit (GitHub's "pull requests of a commit" returns none for it, and the run stopped quietly): it takes the open pull request whose last commit was checked, and warns when there is none. Nothing to change in a data repository but the tag |
| `v8` | 2026-10-07 | the issue route takes the ZIP of the Contribute page dropped into the "Submit a match" form (no fork, no branch): the bot downloads it, checks it and answers on the issue, then opens the pull request. The ingest credits the issue's author (not the person who merged) and answers on the pull request and the issue with links to the matches on the site (`siteUrl` in `bgdb.config.json`). A data repository moving to `v8` also takes the new issue form (`.github/ISSUE_TEMPLATE/submit-match.yml` of the template) and adds `"siteUrl": "https://<owner>.github.io/bgdb/"` to its `bgdb.config.json` |
| `v9` | 2026-10-07 | the ingest's answer to the contributor is posted with `BGDB_BOT_TOKEN` (the workflow's own token may not comment on a pull request: "Resource not accessible by integration", and the publication of the data after it was skipped); a failed answer no longer stops the publication. Nothing to change in a data repository but the tag |
| `v10` | 2026-10-08 | the project is renamed `bgdb` (it was `bg-db`): the tools are `pipandlove/bgdb`, the data repositories `bgdb-data-1`, ... (decision 0006, item 7). GitHub redirects a renamed repository's address but not a reusable workflow's, so a data repository moving to `v10` also replaces `bg-db` by `bgdb` in its workflow callers (`uses:` and `tools-repository:`), its `bgdb.config.json` (`repository`, `siteUrl`), README and CONTRIBUTING; the sites move to `https://<owner>.github.io/bgdb/` and `https://<owner>.github.io/bgdb-data-1/` |
| `v11` | 2026-10-08 | the Contribute page replaces player names by pseudonyms made with the contributor's own names key, and removes the platform, the time of day, the event and the remarks, before the ZIP is made (decision 0025); the site revalidates each `shard.json` (a new match no longer stays out of the search for ten minutes). A data repository moving to `v11` also takes the new issue form (`.github/ISSUE_TEMPLATE/submit-match.yml`: no more pasting a match) and the new CONTRIBUTING.md of the template |
| `v12` | 2026-10-08 | decision 0025 in full: a box on the Contribute page for a match played over the board (real names, `"origin": "otb"`); pseudonyms without the `anon-` prefix; the review and the ingest refuse names that are not pseudonyms (`V-HANDLE`) when `bgdb.config.json` says `"names": "pseudonyms"`, and an over-the-board match whose file names an online platform (`V-ORIGIN`); `bgdb erase` and `data/erased.tsv` (`V-ERASED`); the `by:` search (catalog version 3); `bgdb hide-names`. A data repository moving to `v12` also adds `"names": "pseudonyms"` to its `bgdb.config.json`, and takes the new issue form `.github/ISSUE_TEMPLATE/remove-match.yml` and the new CONTRIBUTING.md of the template |

## 8. The next data repository, and the switch

**When.** The ingest of the current repository opens an issue "Prepare the next data repository" when the repository passes 800 MB (`repoPolicy.warnMB`: the larger
of its `data/` and its packed git history). There is time: above 950 MB (`stopMB`) nothing more is added, and new matches wait in its `inbox/`. You may also switch
earlier, for example to hand the new data to other people. The figures: [growing.md](growing.md#2-how-big-and-how-slow-it-gets-measured).

| # | Step | Command (in `bgdb`) |
|---|---|---|
| 1 | Bring the current repository up to date on your machine (`git pull` in `../bgdb-data-1`). Make the next one: it starts after the last shard number used, and is listed as `next` in `sources.json`. Nothing changes for contributors. | `npm run new-data-repo -- bgdb-data-2` |
| 2 | Its secrets (section 3.3) and settings (warnings); commit `sources.json`. | `gh secret set ... -R pipandlove/bgdb-data-2` |
| 3 | Close the current one: it answers `closed` to new pull requests and opens no new shard. The command stops (exit code 1) while pull requests are open or files wait in its `inbox/`: merge or close them, let the ingest run. | `npm run switch-data-repo` |
| 4 | Run it again: the last shard is sealed at whatever size it reached, the hash files of its shards go to the next repository (its matches stay duplicates there, and can still be enriched), the old repository is published once more and **archived** on GitHub (read-only, its site keeps serving), and `sources.json` makes the next one `current`. | `npm run switch-data-repo` |
| 5 | Commit and push `sources.json`, publish the site: the Contribute page now sends to the new repository. | `git commit sources.json`, then `pages` |
| 6 | Check: the number of matches on the site is unchanged, an old link (`#m=0001/...`) opens, a duplicate of an old match sent to the new repository is recognised. | the browser |

Corrections and enrichments of a match of an archived repository are written in the current one; the site applies them wherever the match is stored.

## 9. Undoing, and starting again

| To undo... | Do |
|---|---|
| a data repository made with `--local`, never pushed | `rm -rf ~/repo/bgdb-data-1`, then remove its entry from `sources.json` (or `git restore sources.json` if it was not committed; delete the file if it was the only entry) |
| the same, on GitHub as well (only while it holds nothing you want) | `gh auth refresh -s delete_repo` once, then `gh repo delete pipandlove/bgdb-data-1 --yes`, then as above |
| `switch-data-repo` stopped at step 3 (closed, not switched) | set `"closed": false` in the old repository's `bgdb.config.json`, commit, push |
| an archived repository | github.com > the repository > Settings > General > Danger Zone > Unarchive |

## 10. Troubleshooting

| Message or symptom | Cause and fix |
|---|---|
| `gh (the GitHub command line) is not installed` | section 1.1 |
| `gh is not logged in` | `gh auth login --scopes workflow` |
| `pipandlove/bgdb (the tools ...) is not on GitHub` | section 1.4; or `repository` in `bgdb/bgdb.config.json` names another repository |
| `there is no tag v1 on GitHub` | `git tag v1 && git push origin v1` in `bgdb` (section 1.4) |
| `has no git identity of its own` | section 1.3 |
| `... is not checked out at ...` | a repository of `sources.json` must be next to `bgdb`: `gh repo clone pipandlove/<name>` in `~/repo` |
| `has changes that are not committed` | commit or remove them in that repository |
| `git push` refused: "refusing to allow an OAuth App to create or update workflow" | the `workflow` scope: `gh auth refresh -s workflow` |
| a workflow fails at "The tools, at the pinned tag" | the secret `BGDB_TOOLS_TOKEN` (bgdb private), the tag missing on GitHub, or the token expired |
| the ingest fails: "GH006: Protected branch update failed ... Required status check" | a branch rule on `master` (section 4: there should be none): `gh api -X DELETE repos/pipandlove/bgdb-data-1/branches/master/protection`, then run the ingest again |
| the `issue-to-pr` workflow fails: "GitHub Actions is not permitted to create or approve pull requests" | the secret `BGDB_BOT_TOKEN` is missing (section 3). The match is already on the branch `submission/issue-<n>`: once the secret is set, run the workflow again (`gh run rerun <run id> -R pipandlove/bgdb-data-1`, or edit the issue), and it opens the pull request |
| pull requests made from issues have no check | the secret `BGDB_BOT_TOKEN` |
| a pull request was merged, but its matches stay in `inbox/` (no ingest run) | the merge was made with GitHub's own token, whose pushes start no workflow: set `BGDB_BOT_TOKEN` (and use tools `v3` or later), then run the ingest once by hand: `gh workflow run ingest.yml -R pipandlove/bgdb-data-1` |
| the ZIP dropped into the issue form gives "Failed to upload" | the GitHub account cannot upload files yet: in its Settings > Emails, a verified address and a backup address (that fixed it for the test account); an ad blocker can also block it. The Contribute page says so in step 4 |
| GitHub's upload page says "Uploads are disabled" | uploads need write access: contributors use the issue form with the ZIP instead (the Contribute page leads them there). For the owner: add matches with git (section 6) |
| a warning about Pages, "Upgrade to GitHub Pro" | section 1.2: a private repository on a free plan |
| the site or the Contribute page: "The database could not be loaded (https://.../bgdb-data-1/registry.json: HTTP 404)" | the data repository was never published: its `pages` workflow runs on a push that changes `data/`, and a new repository has none. Run it once: `gh workflow run pages.yml -R pipandlove/bgdb-data-1` (or Actions > pages > Run workflow); also check that Pages is on (section 4) |
| a workflow of the data repository failed after 0 s, "a workflow file issue" | it called `bgdb` at a tag that did not exist yet (section 1.4); once the tag is pushed, the next run works |

<a id="erasing-a-match"></a>
## 11. Erasing a match

A player of a match asks for it to be removed, or the person who added it withdraws it ([decision 0025](decisions/0025-online-players-otb-names-and-erasure.md), spec CR-02).
The request arrives as an issue of the "Remove a match" form (label `removal`), opened from the "Ask for its removal" link of the match page; it gives the match
number only.

| # | Step | Command |
|---|---|---|
| 1 | Check the number in the issue opens a match on the site. Do not ask who the person is, and write no name in the issue. | the browser |
| 2 | In the data repository that stores it (its shard number tells which one; `git pull` first): remove its files and list it. An archived repository is unarchived first (section 9), and archived again after step 3. | `npm run bgdb -- erase 0001/21acddbb70ed09d5 --reason player-request` |
| 3 | Commit and push: the `pages` workflow publishes the data again, without the match. | `git commit -am "Erased 0001/21acddbb70ed09d5 (player request)" && git push` |
| 4 | If the current data repository is another one, run the same command there too: it removes the match's line from `data/hashes/` and lists it in its `data/erased.tsv`, so that the match is refused if it is sent again. | as in step 2 |
| 5 | Answer the issue ("removed; it leaves the site within a few minutes") and close it. | github.com |

The reasons: `player-request`, `contributor-withdrawal`, `rights`, `legal`. `data/erased.tsv` is the public log: the content hash, the id, the date and the reason,
never a name. A sealed shard changes only this way: `erase` records its digest again, so the build keeps trusting it.

**What `erase` cannot reach.** The git history still holds the files, and so do clones, forks and mirrors made before. For a player's request, removing the match from
the published data is the usual answer. When the law requires more (a court order, a legal request about the history), the history is rewritten: delete and recreate the
repository from its current files, as was done on 2026-10-08 ([decision 0025](decisions/0025-online-players-otb-names-and-erasure.md#done-so-far)), or rewrite it with
`git filter-repo --invert-paths --path <file>` and force-push; then ask GitHub Support to purge the cached views, the pull request refs (`refs/pull/<n>/head`) and the issue
attachments that held the match.
