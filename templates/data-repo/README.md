# %%name%%

Matches of **%%databaseName%%**, an open backgammon match database. This is one of its **data repositories**: it holds match files
(`data/`), receives new ones (`inbox/`), and publishes them at <%%dataUrl%%>. The tools and the site live in
[%%toolsRepository%%](https://github.com/%%toolsRepository%%); the site reads every data repository.

- **Add a match:** use the Contribute page of the site, or put the files in `inbox/` and open a pull request: see [CONTRIBUTING.md](CONTRIBUTING.md).
- **Licence of the data:** CC0, see [DATA-LICENSE.md](DATA-LICENSE.md).
- Shards start at `%%firstShardId%%` (shard numbers are global across the data repositories).

## For the maintainer

The workflows call those of `%%toolsRepository%%` at the tag `%%toolsRef%%`: a new release of the tools changes nothing here until the
tag is moved in `.github/workflows/*.yml` (all five files, both places in each). With `%%toolsRepository%%` checked out next to this
repository (`../bgdb`), the usual commands run from here:

```sh
npm run check                              # what the bot will say about inbox/
npm run ingest -- --contributor me --dry-run
npm run build && npm run serve             # the whole site with this repository's data, http://localhost:8080
```

When this repository nears its size limit, the ingest opens an issue; the next repository is made with `npm run new-data-repo` in
`bgdb` (its docs/growing.md).
