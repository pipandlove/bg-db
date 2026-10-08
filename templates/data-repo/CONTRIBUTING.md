# Contributing matches

**The short version:** give us a match file, we do the rest.

The easiest way: open the **Contribute** page of the site and follow its numbered steps ("How to contribute" on the site shows them with pictures). It replaces the player names (yours included), the
platform and the time of day by made-up names before anything leaves your computer: a file on GitHub is public at once, so send only its ZIP.
A match played over the board (a tournament, a club, at home) can keep its real names: tick the box under that match on the page.
The two ways underneath:

- **A GitHub issue** (no fork, no branch): open a "Submit a match" issue here, drop the ZIP of the Contribute page into the first box, tick the rights box, create the issue. A bot checks it and answers there, opens the pull request itself, and answers again with the links to your matches once they are in the database.
- **A pull request:** put the ZIP of the Contribute page in `inbox/`, as it is, and open a pull request. Or write the files yourself with
  `bgdb hide-names --key-file <your key> --out <folder>` (the tools of the link below; the same key file as the page's) and put those in `inbox/`.
  Your own match files are not rewritten on the way: they would publish the names they hold (the commits of a pull request stay public, even
  after a change), and the check refuses them. For a match played over the board, add `"origin": "otb"` to its `.bgdb.json` instead.

A bot checks every pull request within minutes, posts one comment (what is new, what is already there, what to fix), and merges it when everything is fine.
By submitting you confirm that you have the right to share the match under **CC0** (public domain, see [DATA-LICENSE.md](DATA-LICENSE.md)).

**Removing a match.** If you played in a match of this database and want it removed, open a "Remove a match" issue here (the match page of the
site has a link that fills in its number). Give the number only, no name. A maintainer removes it, and the same match is refused if it is sent again.

The full guide (the formats that are read, partial matches, event and round): CONTRIBUTING.md and docs/contributing-flow.md of
[%%toolsRepository%%](https://github.com/%%toolsRepository%%).
