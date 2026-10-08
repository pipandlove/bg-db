> [bgdb](../README.md) · Documentation

# Documentation

Every page starts with a line that leads back here and to the [project README](../README.md).

## Using the tools

| Page | Content |
|---|---|
| [commands.md](commands.md) | Reference of every command: options, inputs, outputs, exit codes, common tasks |
| [testing-locally.md](testing-locally.md) | Run the tests, try the pipeline in a scratch folder or in the repo and undo it, recipes, a browser checklist |
| [importing-an-archive.md](importing-an-archive.md) | Bulk import of an archive by a maintainer, step by step (`npm run archive`): dry run, review of event and round, ingest, build, browse, corrections, starting again |
| [diagnostics.md](diagnostics.md) | Error, warning and info codes with causes and fixes |

## Matches and how they are read

| Page | Content |
|---|---|
| [formats/](formats/README.md) | Notes on each input format, written from real files, and the stored and published file formats |
| [game-endings.md](game-endings.md) | How a game that nobody bears off or drops is read: body, tail, settlement against the next game's score |
| [partial-matches.md](partial-matches.md) | Partial matches (fragments, excerpts, games cut in the middle, salvaged archive files): what works and what does not |

## The site

| Page | Content |
|---|---|
| [site.md](site.md) | The static site: what it does, the query language, how it is built and tested |
| [replay.md](replay.md) | The replay: arrows and ghost checkers, steps, the ⋮ menu (position IDs, picture export), address, how it is built and tested |
| [deploy.md](deploy.md) | Publishing the static site on GitHub Pages: steps, guarantees, limits |

## Contributions and growth

| Page | Content |
|---|---|
| [contributing-flow.md](contributing-flow.md) | How contributions flow: the Contribute page, issues, pull requests, the bot and its safety, GitHub settings, how to test the workflows ([CONTRIBUTING.md](../CONTRIBUTING.md) is the short version for contributors) |
| [data-repositories.md](data-repositories.md) | **The maintainer's procedures** for data repositories: installing `gh`, putting `bgdb` on GitHub, the first data repository, the two secrets, the settings, working locally, a new version of the tools, the switch to the next repository, undoing, troubleshooting |
| [growing.md](growing.md) | Enriching, size and speed (measured), where the data lives, moving one shard by hand, reading XG files |

## Design

| Page | Content |
|---|---|
| [spec/](spec/README.md) | The functional specification: Part I (data model, storage, indexes, caching, contribution workflow) and the replay interface |
| [decisions/](decisions/README.md) | Architecture decision records (why things are the way they are) |
| [roadmap.md](roadmap.md) | Milestones and status |
| `rfcs/` | Proposals for changes to the specification (none yet) |
