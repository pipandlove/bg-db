> [bg-db](../../README.md) · [Documentation](../README.md) · [Decisions](README.md)

# 0014 - Replay: the position before the play, arrows and ghosts

**Status:** accepted

**Context.** The owner asked for: at each play, the original position with rounded transparent arrows showing where the checkers go and a transparent checker at each end point (the new position);
point numbers on the board; the position as a GNU Backgammon or XG ID; a monochrome picture export; a small menu for these; the move list on the left and the board on top on wide screens.
HedgeHog (a reference the owner likes) draws the board with the moves and analysis around it.

**Decision.**
- Step k shows the position **before** action k; the play is overlaid (arrows from the top checker of each source stack, ghosts in the first free slot of each destination, a red ring on a hit blot and a ghost on the
  bar, ghosts in the tray for bearing off). Consecutive steps of one checker are joined into one arrow (24/21/15), but only when the checkers that stood on the middle point are all used up by other arrows.
- A **single SVG tree** (`svg.js`) is drawn by one function (`board.js`) with two themes; the page converts the tree to DOM nodes, the export serializes it to a file. Interactive board and export therefore cannot drift apart.
- **Point numbers** default to the numbering of the player to move, because the notation of the move list is in that numbering and the arrows then match the text.
- **IDs** (XGID, GNU Backgammon ID) describe the position before the play with the dice, using the encoders and the verified ID layouts of the core library. They are not offered for takes, passes and the
  final position, instead of guessing how a pending double is encoded.
- **Export** is made in the browser (SVG string, then a canvas for PNG): no server, no external fonts.
- The menu is one button next to the controls (⋮), reachable by keyboard; every option is also reachable without a mouse.
- Layout: two columns on wide screens (moves left, board and controls right, the board above its controls), one column on phones (board first).
- The drawing code is pure (no DOM) so that its geometry-independent facts are tested in Node on all fixtures; the DOM component is checked by hand.

**Update (after the first review by the owner).**
- The first palette copied HedgeHog's brown. The board is now **blue** (dark and light blue points on dark navy; amber arrows), which also avoids a clash with the green used for winners in the list.
- Checkers are **plain discs with a lighter edge**, with no ring inside; the picture too. Sides remain distinct by lightness (light/dark).
- Point numbers are **always relative to the player on move** (this was already the default; the double/take/pass sequence now keeps the doubler's numbering so that numbers do not flip at the
  answer), and the **picture follows the same setting** as the board instead of a fixed numbering.
- The result list has a **Round** column and a `round:` search, because tournament matches of one event could not be told apart (catalog version 2).

**Consequences.** What is drawn is provably the play (tested on every play of every fixture). The analysis features of HedgeHog (equity table, error markers, "Errors" filters) have a place in the list and a panel next to
the board, to be added in M6. Animation between steps is not done: a step is a still picture, which keeps the arrows readable.
