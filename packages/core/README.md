# @bgdb/core

Dependency-free JavaScript (ES modules) that runs unchanged in the browser, in a Web Worker and in Node.

```js
import { readMatch, matchHash16, toXGID, startPosition } from '@bgdb/core';

const r = readMatch(text);            // detects .mat dialects and GNU Backgammon SGF
if (r.ok) console.log(matchHash16(r.match));
else for (const e of r.errors) console.log(e.code, e.line, e.message, e.hint);

toXGID(startPosition(), { onRoll: 0 });
```

| Module | Purpose |
|---|---|
| `mat.js`, `sgf.js` | parsers producing the logical model |
| `rules.js` | position model, legal plays, bear-off, win kinds |
| `validate.js` | replays a match and reports errors/warnings (codes `V-FORMAT`, `V-LEGAL`, `V-TURN`, `V-CUBE`, `V-SCORE`, `V-RESULT`, `V-META`) |
| `identity.js`, `sha256.js` | canonical content and match identifier |
| `xgid.js`, `gnubgid.js` | position identifiers |

Positions are stored from each side's own perspective: `pos.c[side][point]` (1..24, bar = 25) and `pos.off[side]`.
