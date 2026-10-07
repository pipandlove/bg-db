> [bg-db](../../README.md) · [Documentation](../README.md) · BGDB specification, Part I · [Overview](README.md) · [Requirements](requirements.md) · [Terms index](terms-index.md) · [Glossary](glossary.md)

# Replay interface (Part II, version 1)

Implemented in milestone M4; the user-facing description is [../replay.md](../replay.md) and the reasons are in [decision 0014](../decisions/0014-replay-design.md).

<a id="RPL-01"></a>**[RPL-01]** The replay shows, for each step, the position as it was *before* the play. The play is overlaid: rounded, semi-transparent arrows from the checkers that move to their destinations, and a transparent "ghost" checker at each destination. The position after the play is what the next step shows.

<a id="RPL-02"></a>**[RPL-02]** A step of one checker that continues from a point where it just arrived is drawn as one arrow (24/21/15). A blot that is hit is marked with a ring and the hit checker appears as a ghost on the bar; a checker borne off appears as a ghost in the tray. A ghost never covers an existing checker, except the hit blot it replaces.

<a id="RPL-03"></a>**[RPL-03]** A step is a roll with its play, a double, a take or a pass; the last step of a game is the final position with its result. Every game of the match can be replayed.

<a id="RPL-04"></a>**[RPL-04]** Every point carries its number at the outer edge of the board. The numbering is always relative to the player on move, as in backgammon notation: his 1 is the first point of his own home board, and the numbers turn to the other player's when he moves. A double and its answer keep the numbering of the doubler. The player at the bottom's numbering, or no numbers, can be chosen in the menu.

<a id="RPL-05"></a>**[RPL-05]** The position can be copied as an XGID and as a GNU Backgammon ID: the position before the play, with the dice (when it is a roll), the cube, the score and the match length. These IDs MUST decode back to the same position and state. They are not offered for the answer to a double or for the final position.

<a id="RPL-06"></a>**[RPL-06]** The position can be saved as a picture (PNG and SVG), made in the browser, in black, white and grey only, with the cube, the dice, both pip counts, the names, the score and the point numbers (numbered as on the board), and without arrows.

<a id="RPL-07"></a>**[RPL-07]** The options (IDs, link, picture, swap players, mirror, arrows, point numbers, board size) are reachable from one menu next to the controls, and all of them can be used from the keyboard.

<a id="RPL-08"></a>**[RPL-08]** The state of the replay is part of the address (`#m=<match>&g=<game>&t=<step>`): opening it shows the same position, and back and forward move between positions.

<a id="RPL-09"></a>**[RPL-09]** On wide screens the move list is on the left and the board is above its controls; on narrow screens the board comes first and the list under it. By default the board and its controls fit inside the window when the page opens, with no scrolling. The page never scrolls sideways.

<a id="RPL-10"></a>**[RPL-10]** The replay can be used with the keyboard (arrows, Home, End, Space), each step is announced as text to screen readers, and the two sides can be told apart by lightness, not by hue alone (light and dark checkers).

<a id="RPL-11"></a>**[RPL-11]** A play that was made although illegal ([ILL-01](04-logical-model.md#ILL-01)) is marked on the board, in the list and in the text of the step.

<a id="RPL-12"></a>**[RPL-12]** For every play of every fixture, the arrows and ghosts MUST reproduce the position of the next step (position before, minus departures, plus ghosts). This is tested automatically.
