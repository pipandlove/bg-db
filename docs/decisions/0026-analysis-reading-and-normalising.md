> [bgdb](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0026 - Analysis: read from `.sgf` and `.xg`, reconciled, normalised to rank players

**Status:** proposed (2026-10-08). Replaces item 8 of [decision 0006](0006-open-items.md) ("`.xg` reader: worth doing only if the analysis data is wanted").
Built so far: both readers and the summary with one rule (`packages/core/src/analysis.js`), checked on twin fixtures. Not built: storage, tiers, display, ranking.

**Goal.** Rank players across the whole database, find well-played matches (`pr:..4`), and show the inaccuracies, errors and blunders of each
match, both for checker plays and for cube decisions, on the match page and in the replay.

**Context.** Analyses arrive in two forms, each attached to a match (spec LM-03: never part of its identity):

- **GNU Backgammon SGF**: each decision carries its candidates with their equities and the depth they were evaluated at, and each game its
  summary (`GS`). Layout: [formats/gnubg-sgf.md](../formats/gnubg-sgf.md).
- **eXtreme Gammon `.xg`**: each move and cube record holds the error of the decision, its level and, for the cube, the three equities.
  Layout: [formats/xg-binary.md](../formats/xg-binary.md).

The numbers are not comparable as they stand:

1. **Depth is counted differently.** gnubg counts the raw network as 0-ply, XG as 1-ply: gnubg *n*-ply is XG (*n*+1)-ply.
2. **The units differ.** gnubg writes checker equities in EMG but cube equities as match winning chances; XG writes everything in EMG.
3. **The summaries are named differently.** XG's PR is 500 × the error ÷ the decisions that count; gnubg's "error rate per decision" (mEMG) is
   1 000 × the same quotient, so PR = gnubg's rate ÷ 2. Both count unforced plays and the cube decisions that were close or wrong.
4. **The engines differ**, and so does the depth chosen by each person. An error is the gap between the best play and the play made as one
   evaluator sees them: consistent within one analysis, not between two.

**Proposal.**

1. **Read the decisions, not the summaries.** For each decision: the game, the side, the kind (`move`, `no-double`, `double`, `take`,
   `pass`), the error in EMG, the depth (counted like XG), and whether it counts. Forced plays are decided by bgdb's rules engine, not by the
   engine that analysed. Cube equities in match winning chances are put in EMG with the match equity table both programs use by default
   (Kazaross XG2, `met.js`). To be stored compactly beside the match (`analysis/<h2>/<hash>.<engine>.json`, the place reserved in
   [spec section 5](../spec/05-storage.md)), built from the attachment.
2. **One rule for every analysis.** PR = 500 × error ÷ decisions counted. Counted: a play with more than one legal result; a double, a take,
   a pass; a no-double when it was wrong or doubling was within 0.16. Classes: inaccuracy from 0.04, error from 0.08, blunder from 0.16
   (gnubg's thresholds: doubtful, bad, very bad). The programs' own summaries are only a check.
3. **Levels in tiers.** The depth of an analysis is its deepest evaluation (gnubg's move filter leaves a lone candidate lower).
   *quick*: XG 1–2-ply (gnubg 0–1); *standard*: XG 3-ply (gnubg 2-ply, "World class"); *strong*: XG 4-ply or more, XG Roller, rollouts
   (gnubg 3-ply, "Grandmaster"). Rankings use *standard* or better; the match page always shows the tier; a match with several analyses
   uses the strongest.
4. **Reconcile with twins.** A match analysed by both programs has the same identity, so its decisions line up one for one.
5. **Rank with uncertainty.** A player's PR is the decision-weighted average over their analysed matches, shown with the number of
   decisions and a margin of error, listed only above a minimum number of decisions. Online players appear under a pseudonym per
   contributor key (decision 0025), so one person can appear under several names; over-the-board players under their real names.

**What was measured (2026-10-08).** The two matches of `fixtures/gnubg-sgf` analysed by XG (`fixtures/xg-binary`) and by gnubg 1.08 at
2-ply and 3-ply (`fixtures/gnubg-analysis`), tests in `packages/core/test/analysis.test.js`:

- The SGF reader gives gnubg's own totals to 1e-4, checker play and cube, with the same unforced plays and the same "close or actual" cube
  decisions (5 and 80 in the avocet match), and PR = gnubg's error rate ÷ 2 (37.3 mEMG → 18.66).
- The XG reader: in all 611 analysed cube decisions of the 12 `.xg` fixtures, XG's stored error is the one given by its three equities. The
  unforced plays found by the rules engine are exactly gnubg's.
- PR of each player:

  | Match | Player | XG (4-ply, cube up to XG Roller+) | gnubg 2-ply | gnubg 3-ply |
  |---|---|---|---|---|
  | bluetailedgrebe1 vs tester (3 points) | bluetailedgrebe1 | 13.58 | 12.83 | 12.24 |
  | | tester | 5.80 | 6.09 | 5.70 |
  | avocet vs tester (5 points) | avocet | 18.43 | 18.66 | 18.67 |
  | | tester | 9.60 | 9.51 | 9.66 |

  Within 0.8 everywhere: on these two matches one ranking can mix both programs. Two matches are not a proof; more twins will say whether a
  correction per engine is needed.
- XG's level codes, compared with what XG shows for the same decisions: code n is (n + 1)-ply, 1001 is XG Roller+. The owner's XG
  analyses are 4-ply for checker play, and for the cube 2-ply up to XG Roller+ (XG goes deeper only on close decisions): the *strong* tier,
  one step deeper than gnubg's "World class". That they still agree within 0.8 PR with gnubg 2-ply suggests the depth matters little for a PR.
- gnubg's "World class" settings, given as a script, give byte for byte the file made with the menus. The script is in
  [formats/gnubg-sgf.md](../formats/gnubg-sgf.md); in the menus: *Settings → Analysis*, checker play and cube: 2-ply, cubeful, no noise,
  move filter "Normal" (the "World class" preset). XG's "World Class" is a playing level, not an analysis setting: what matters is the depth.

**Open questions.**

- **XG's terms.** Spec RP-04 and decision 0009 forbid analysis whose terms forbid redistribution. Before anything read from an `.xg` is
  published, the eXtreme Gammon licence must be checked. Publishing a PR without the equities may be acceptable.
- **One engine for everything.** The fullest normalisation is to analyse every match again with one gnubg setting (free and scriptable).
  Spec section 1 says bgdb stores analyses and does not produce them: it would be a batch the maintainer runs outside CI, contributed as SGF.
  The twins so far say it may not be needed.
- **Money games.** gnubg's cube values in a money game are taken as EMG already; no analysed money SGF has been checked.

**Next steps.** Store the decisions beside each match at ingestion and build; the match page and the replay
(classes per decision, PR per player); then the search (`pr:`) and the ranking.
