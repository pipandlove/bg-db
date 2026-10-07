> [bg-db](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0015 - The contribution loop: one shared check, two workflows for pull requests, data only

**Status:** accepted. **Update (2026-10-07):** the workflows run in each data repository ([decision 0024](0024-data-repositories.md)) as reusable workflows of `bg-db`; the trusted tools are those of `bg-db` at the tag the data repository pins (no longer its base branch), and the configuration comes from its base branch. The safety rules below are unchanged. Since tools `v4`, review-publish merges a `ready` pull request itself (only the commit it checked) instead of turning on auto-merge behind a required check: the branch rule refused the ingest's commits (decision 0024). Since `v5`, a ZIP in the inbox is reviewed in place and unpacked by the ingest, and a rights statement written by the Contribute page into its ZIP (`CONTRIBUTION.md`) counts like the ticked box: both are the contributor's own statement.

**Context.** Spec section 10 asks that contributing be quick and easy, that the same validator run in the browser, on the command line and in CI (EAS-04), that clean contributions merge without a human (MP-04),
and that pull requests from forks cannot harm the project (SC-01). GitHub gives read-only tokens to fork pull requests and no workflow runs for pull requests made with the default token.

**Decision.**
- **One check.** `analyzeGroup` (core library) does everything for one contribution: grouping by base name, the sidecar, the match, duplicates, attachments, the read-back of the normalised file. `ingest`, `review` and the browser page all call it.
  The browser page is therefore the same code as the CI, run on bytes (no file system).
- **`review`** is `ingest` without writing: it produces a report, a verdict, labels, the auto-merge decision and the comment. Policy lives in one tested function (`classify`).
- **Two workflows for pull requests.** `validate` (event `pull_request`, read-only, tools from the base branch, the pull request as data) provides the required status check. `review-publish` (event `workflow_run`, write token) redoes the review itself with the
  default branch tools and posts the comment, labels and auto-merge. It trusts no artifact and no number from the pull request. `pull_request_target` is not used.
- **After the merge**, `ingest` runs on the default branch, serialised, and commits `data/`. The contributor is the author of the squash commit.
- **The issue path** converts an issue to a file in a pull request; it needs a token that triggers workflows (`BGDB_BOT_TOKEN`).
- **Hand-over from the browser** is a ZIP (files renamed after players and date, plus the extras typed on the page) and GitHub's own upload page, because a static page cannot open a pull request without a secret. One small match can go through a pre-filled issue.
- Untrusted text never enters a shell command or a comment unescaped; tests check the workflow files for this.

**Consequences.** A contribution costs one drop and a few clicks, and a clean one is merged and filed with no human. The cost is that the workflows depend on repository settings and on GitHub behaviour that cannot be tested locally: [contributing-flow.md](../contributing-flow.md)
gives the settings and a test plan for a scratch repository. People without a GitHub account are not served yet (the optional relay, spec C7).
