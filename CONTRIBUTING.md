> [bgdb](README.md) · [Documentation](docs/README.md)

# Contributing

**The short version:** give us a match file, we do the rest.

The easiest way: open the **Contribute** page of the site (`contribute.html`) and follow its numbered steps (to see them first, with pictures: **How to contribute**, `guide.html`). The first time, it asks you to create your **names key**: the page replaces every player name (yours included) by a made-up one computed with that key, and removes the platform, the time of day, the event and the remarks, before anything leaves your computer ([decision 0025](docs/decisions/0025-online-players-otb-names-and-erasure.md)); a match played over the board (a tournament, a club, at home) can keep its real names with the box under it. You check your matches there and download a ZIP, then drop the ZIP into a **"Submit a match" issue** of the current data repository on GitHub (the page opens the form); a bot checks it, answers on the issue, adds the matches and answers again with their links. You need a free GitHub account; no fork, no branch. Or, if you know git, do it by hand:

1. **Have a match file?** (`.mat` or `.txt` from Backgammon Studio, OpenGammon, Foxamon, eXtreme Gammon, choue.net and others, or a GNU Backgammon `.sgf`; an `.xg` can be added next to its text version.)
2. Put the ZIP made by the Contribute page, as it is, or the files written by `npm run bgdb -- hide-names <files> --key-file <your key> --out <folder>` (the same key file as the page's; [commands](docs/commands.md#bgdb-hide-names)), in the `inbox/` folder (a match file of your own is not rewritten on the way, and the commits of a pull request stay public: it would publish the names it holds, and the check refuses it, `V-HANDLE`; for a match played over the board write `"origin": "otb"` in its `.bgdb.json`) of the **current data repository** (the matches live there, not in `bgdb`: the one marked `current` in `sources.json`; the Contribute page knows which) and open a pull request. Any file name works; if you also have the GNU Backgammon `.sgf` (with analysis) or the eXtreme Gammon `.xg` of the same match, give all the files the **same name** (`my-match.txt`, `my-match.sgf`, `my-match.xg`) and they are kept together. To add a YouTube link, put `; [Video "https://youtu.be/..."]` at the top of the text file (https YouTube links only). If the match contains a play that was made although illegal, keep it as played and declare it (see [docs/formats](docs/formats/README.md#illegal-plays-made-in-real-matches)): it is kept and flagged, not rejected. You do not need to fill in metadata or
   know how the database is organised: a bot checks the match, tells you in plain words what
   (if anything) is wrong, and merges clean submissions automatically. If the file does not say which event or round it is (or
   several matches of a series would look the same), you can add `my-match.bgdb.json` with `{"event": "...", "round": "Final - Match 3"}`
   ([details](docs/contributing-flow.md)).
3. By submitting you confirm that you have the right to share the match under the database licence, **CC0** (public domain; see [DATA-LICENSE.md](DATA-LICENSE.md)). The ZIP of the Contribute page holds made-up names only; site match identifiers are removed too (`bgdb anonymize`).

You can also check a file yourself before sending it: `node packages/cli/bin/bgdb.js check my-match.mat`; `npm run check` in a data repository says what the bot will say about its `inbox/`.

**If some games of a match cannot be read** (a mistyped move, a missing play), you are told what is wrong, so you can fix it. If the rest of the match is clear, you are
also offered to add it **partially**: the games that cannot be read are kept by their result only, or left out. You see the match exactly as it would be stored
(a `.mat` file: download it on the Contribute page, or `bgdb check --salvage --out preview my-match.txt`) and nothing is added until you agree: tick "Add it partially"
on the page or in the issue form, or put `{"accept": "partial"}` in `my-match.bgdb.json` in a pull request.

What happens next: a bot checks your pull request within minutes, posts one comment (what is new, what is already there, what to fix), and merges it automatically if everything is fine. The first time you contribute, GitHub may ask a maintainer to approve the check run; that is normal. Details: [docs/contributing-flow.md](docs/contributing-flow.md).

For code changes (pull requests to `bgdb` itself): `npm test` must pass; new behaviour needs a test, preferably with a real (small) fixture.
Larger changes to the data model or the workflow start as a short proposal in `docs/rfcs/`
(see [docs/spec/12-evolution.md](docs/spec/12-evolution.md)).
