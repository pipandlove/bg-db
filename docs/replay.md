> [bgdb](../README.md) · [Documentation](README.md)

# The replay (milestone M4)

On every match page, above the details, the match can be replayed play by play. Everything is drawn in the browser from the replay data that `bgdb build` writes
(`matches/<h2>/<hash>.json`, see [formats/shard-and-index.md](formats/shard-and-index.md)); no server and no image files are involved.

## What you see

- **The position before each play**, exactly as it was when the player rolled, with **rounded transparent arrows** from the checkers that are going to move to the place where each one lands,
  and a **transparent "ghost" checker** at each destination: that is the position after the play, which is what the next step shows for real.
- **Hits:** the blot that is hit gets a red dashed ring, and a ghost of the hit checker appears on the bar. **Bearing off:** the ghost goes into the tray.
- **Point numbers** at the outer edge of every point, **always relative to the player on move** (the numbering of backgammon notation): when a player moves, his 1 is the first point of his own home board
  (the ace point, at the board's edge), so the play written in the move list (`24/21/15`) can be read straight off the board; when the other player moves, the numbers turn to his own. The whole
  sequence double, take/pass keeps the numbering of the player who doubled, so the numbers do not flip at the answer; at the end of a game the numbers are those of the player at the bottom.
  The menu can switch to the numbers of the player at the bottom, or hide them.
- **Dice** on the board (in the half of the player who rolled), the **cube** on the bar (64 when centred, at the owner's end when owned, in the answering player's half while a double is offered),
  **pip counts** and **score** (`2 / 7`, or the points in a money game) next to the names, a marker for the player to act, and "Crawford game" when it applies.
- **The end of a game:** the final position with the result in a banner.
- **An illegal play that was made** ([formats](formats/README.md#illegal-plays-made-in-real-matches)): red arrows, a banner "illegal play, kept as played" and an "illegal" badge in the list.
- **Look:** a blue board (dark navy and light blue points on a mid-blue board), plain light and dark checkers, each one a single colour with a black edge and nothing drawn inside, a little wider than the base of a point; arrows in amber (red for an illegal play).
  Sides are told apart by lightness, not only by hue, so they stay distinct in grey tones and in the black-and-white picture.

## Steps

A step is one **roll with its play**, or one **double**, **take** or **pass**; the last step of a game is the final position. The slider, the buttons and the move list all move between steps.

| Control | Does |
|---|---|
| ⏮ ‹ ▶ › ⏭, `Home` `←` `Space` `→` `End` | first, previous, play/pause, next, last (the keys work anywhere on the page except in a field or a menu) |
| Speed (Slow, Normal, Fast) | time between steps while playing |
| Move list (left on wide screens, under the board on phones; the link back to all matches and the title of the match are above it) | click a row to go there; the current row is highlighted and scrolled into view; a dot shows who played it |
| Game selector, ‹ › | another game of the match |
| ⋮ menu | everything below |

## The ⋮ menu

| Item | Does |
|---|---|
| Copy XGID | the eXtreme Gammon ID of this position: before the play, with the dice, the cube, the score and the match length |
| Copy GNU Backgammon ID | the same, as a GNU Backgammon position ID plus match ID |
| Copy link to this position | the address of this match, game and step |
| Save picture (PNG) / (SVG) | a diagram of this position, see below |
| Swap players (top / bottom) | the other player at the bottom |
| Home boards on the left / right | mirrors the board |
| Hide / Show arrows | the board without the play |
| Point numbers: ... | cycles: of the player on move (default), of the player at the bottom, hidden; the picture follows the same setting |
| Board size: fit to the window / small | fit to the window (the default): the board is as large as the window allows with its controls still in view when the page is at its top, so nothing needs scrolling; small: the board stays in the page column. The choice is remembered in this browser |

The IDs are not offered for the answer to a double (take / pass) or for the final position, because the ID formats mark a pending double in a way this project has not verified yet. If the
browser refuses clipboard access, the ID is shown in the status line under the board so that it can be copied by hand.

## The picture

A plain diagram in black, white and grey (white and grey points, white and black plain checkers), made in the browser, no arrows: the position before the play with the dice, the cube, both pip counts,
the names and the score, and the point numbers **as on the board** (relative to the player on move by default, or as set in the menu). Fonts are Arial/Helvetica, nothing is loaded from elsewhere. PNG is twice the size of the SVG (1792 x 1624 pixels).

## Address

`#m=<match>&g=<game>&t=<step>` (game from 1, step from 0): opening such an address shows that position, the address follows the replay, back and forward work, and "Copy link" gives it.

## How it works (for contributors)

| File | Role |
|---|---|
| `site/js/replay-model.js` | pure functions: the steps of a game, the arrows and ghosts of a play (`drawPlay`), text of a play, pip counts, position IDs |
| `site/js/board.js` | the board as an SVG tree, in two themes (interactive dark board, monochrome export) |
| `site/js/svg.js` | a tiny SVG tree with a serializer (export, tests) and a DOM builder (page); text and attributes are escaped, never parsed as markup |
| `site/js/replay.js` | the page component: controls, list, menu, clipboard, export, keyboard |

The replay data (`bgdb-json`) is not published for each match: the page reads the match file (`.mat`), adds its metadata and any enrichment, and derives the data in the browser with `readMatch` and `toBgdbJson` of the core library, the same code as the tools.

`packages/cli/test/replay.test.js` proves, on **every play of every fixture**, that the drawn arrows and ghosts are the play: the position before, minus the departures, plus the ghosts, is exactly the
position of the next step; a ghost is never on an existing checker; hits give the right ghosts on the bar; and the position IDs of every step decode back to the same position, cube, score and dice.
The page itself (DOM) was checked by hand in a headless browser: [testing-locally.md](testing-locally.md).

## Not yet

Analysis (equity, error markers, the "You / Opp / Errors" filters): milestone M6. Animated movement of the checkers between steps. IDs for the answer to a double. OpenGammon IDs. Board themes and
sizes. Start of the video at the position being shown.
