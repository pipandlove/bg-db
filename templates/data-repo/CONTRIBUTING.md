# Contributing matches

**The short version:** give us a match file, we do the rest.

The easiest way: open the **Contribute** page of the site and follow its five numbered steps ("How to contribute" on the site shows them with pictures). The two ways underneath:

- **A GitHub issue** (no fork, no branch): open a "Submit a match" issue here, drop the ZIP of the Contribute page into the first box (or paste the text of one match), tick the rights box, create the issue. A bot checks it and answers there, opens the pull request itself, and answers again with the links to your matches once they are in the database.
- **A pull request:** put the files in `inbox/` (any file name; the ZIP of the Contribute page can go as it is) and open a pull request. If you also have the GNU Backgammon `.sgf` or the eXtreme Gammon
  `.xg` of the same match, give all the files the **same name** and they are kept together.

A bot checks every pull request within minutes, posts one comment (what is new, what is already there, what to fix), and merges it when everything is fine.
By submitting you confirm that you have the right to share the match under **CC0** (public domain, see [DATA-LICENSE.md](DATA-LICENSE.md)).

The full guide (the formats that are read, partial matches, event and round): CONTRIBUTING.md and docs/contributing-flow.md of
[%%toolsRepository%%](https://github.com/%%toolsRepository%%).
