/**
 * How to contribute, step by step: one list, shown by the Contribute page (with the check and the buttons inside the steps) and by the
 * "How to contribute" page (to read before starting). Pictures of GitHub are plain screenshots (site/img/guide/, player names blurred);
 * the red marks are drawn here, on top of them, so that a new screenshot only replaces the picture, and the text of each mark is in the
 * page (readable on a phone, and by a screen reader).
 */
import { h } from './dom.js';
import { el, toDom } from './svg.js';

/**
 * The pictures. box = [x, y, width, height] of what a mark points at, in the picture's pixels. Its number sits in a margin to the right of
 * the picture, at the height of what it points at, with an arrow to it.
 */
export const SHOTS = {
  form: {
    src: 'img/guide/form.png', w: 1030, h: 833,
    alt: 'The "Submit a match" form on GitHub, empty: a title field that says "Matches", a short explanation, the box "Your matches", a field for the event, the rights box, the box for a partial match, and the green Create button.',
    marks: [
      { box: [54, 95, 960, 32], text: 'The title is filled in for you.' },
      { box: [54, 270, 960, 177], text: 'Your ZIP goes into this box (step 4).' },
    ],
  },
  dropped: {
    src: 'img/guide/dropped.png', w: 985, h: 280,
    alt: 'The box "Your matches" after the ZIP was dropped into it: it holds one line that starts with [matches-for-bgdb.zip] followed by the address of the file on GitHub.',
    marks: [{ box: [24, 116, 670, 28], text: 'This line means that the ZIP is uploaded. It looks odd, but it is right: leave it as it is.' }],
  },
  send: {
    src: 'img/guide/send.png', w: 985, h: 255,
    alt: 'The bottom of the form: the rights box ticked, the box for a partial match left empty, and the green Create button.',
    marks: [
      { box: [10, 28, 505, 26], text: 'Tick the rights box.' },
      { box: [868, 211, 110, 36], text: 'Press Create.' },
    ],
  },
  reply: {
    src: 'img/guide/reply.png', w: 925, h: 310,
    alt: 'The bot\'s first answer on the issue: "Thanks for the submission! I checked the 1 match of your ZIP", a table where the match is OK and "will be added", then "You do not need to do anything".',
    marks: [
      { box: [22, 128, 560, 36], text: 'Each of your matches, and what happens to it.' },
      { box: [16, 180, 884, 64], text: '"You do not need to do anything": the bot does the rest.' },
    ],
  },
  done: {
    src: 'img/guide/done.png', w: 925, h: 274,
    alt: 'A few minutes later: the issue is closed, and the bot\'s last answer says "Done: 1 match is now in the database. Thank you!", with a link to the match.',
    marks: [{ box: [226, 150, 166, 22], text: 'The link to your match on the site.' }],
  },
  site: {
    src: 'img/guide/site.png', w: 1327, h: 907,
    alt: 'The match on the site: the list of its moves on the left, and the board with the replay on the right.',
    marks: [],
  },
};

/** a paragraph: strings, and links as {href, text} */
const P = (...parts) => ({ p: parts });

export const STEPS = [
  {
    id: 'check', title: 'Check your matches',
    text: [P('Drop the files of your matches (.txt, .mat, .sgf or .xg), or paste the text of a match. They are checked here, in your browser, with the same rules as the database: you see at once which ones are new, which ones are already in the database, and which ones need a fix. Nothing is sent anywhere.')],
    shots: [],
  },
  {
    id: 'zip', title: 'Download the ZIP',
    text: [P('Tick the rights box and press "Download the ZIP". Your browser saves ', { code: 'matches-for-bgdb.zip' }, ', usually in your Downloads folder. It holds your new matches, ready for the database: you do not need to open it.')],
    shots: [],
  },
  {
    id: 'form', title: 'Open the submission form',
    text: [
      P('Press "Open the submission form": GitHub opens the form of the database in a new tab.'),
      P('If GitHub asks you to sign in, sign in with your GitHub account, then press the button again. No account yet? ', { href: 'https://github.com/signup', text: 'Create one on github.com/signup' }, ' (see "Before you start" above).'),
    ],
    shots: ['form'],
  },
  {
    id: 'send', title: 'Drop the ZIP into the form, tick the box, press Create',
    text: [
      P('Drag ', { code: 'matches-for-bgdb.zip' }, ' from your Downloads folder into the box "Your matches". GitHub uploads it, and after a moment the box holds a line with its name: that is how the bot finds your ZIP.'),
      P('Then tick the rights box and press Create.'),
    ],
    shots: ['dropped', 'send'],
    tip: [P('If the box says "Failed to upload": on GitHub, open Settings, then Emails, check that your address is verified and add a backup address; an ad blocker can also stop the upload (allow github.com). Then delete the line "Failed to upload" from the box and drop the ZIP again.')],
  },
  {
    id: 'wait', title: 'The bot does the rest',
    text: [
      P('Within a minute or two, a bot answers on your issue: it lists your matches and what happens to each one. If everything is fine, there is nothing more to do: about five minutes later it answers again with the links to your matches, and closes the issue. GitHub also e-mails you its answers.'),
      P('If it asks for a fix: fix the file, check it again on this page and download the new ZIP. Then, on your issue, open the menu "…" at the top right of your text, choose Edit, delete the line of the old ZIP, drop the new one, and save. The bot checks it again.'),
    ],
    shots: ['reply', 'done', 'site'],
  },
];

/** shown above the steps by both pages: the one thing to have before starting */
export function accountNotice() {
  return h('section', { class: 'account', 'aria-labelledby': 'account-title' },
    h('h3', { id: 'account-title', text: 'Before you start: you need a GitHub account' }),
    stepText([
      P('The matches are sent through GitHub, where the database lives. A GitHub account is free and takes two minutes to create.'),
      P({ href: 'https://github.com/signup', text: 'Create a GitHub account', button: true }, ' ', { text: 'Then come back to this page. Already have one? You are ready: GitHub will ask you to sign in at step 3 if needed.', muted: true }),
    ]));
}

const RED = '#cf222e';
const GUTTER = 130;

/** the picture with its marks, as one SVG that scales as a whole; the texts of the marks under it */
export function shotFigure(name) {
  const s = SHOTS[name];
  const W = s.w + (s.marks.length ? GUTTER : 0);
  const marks = s.marks.map((m, i) => {
    const [x, y, w, hgt] = m.box;
    const cy = Math.min(Math.max(y + hgt / 2, 34), s.h - 34);
    const bx = s.w + GUTTER / 2 + 6;
    const ex = x + w + 12;                                                    // the arrow ends just right of the box
    return el('g', {},
      el('rect', { x: x - 6, y: y - 6, width: w + 12, height: hgt + 12, rx: 8, fill: 'none', stroke: RED, 'stroke-width': 5 }),
      el('line', { x1: bx - 32, y1: cy, x2: ex + 16, y2: y + hgt / 2, stroke: RED, 'stroke-width': 5, 'stroke-linecap': 'round' }),
      el('polygon', { points: arrowHead(bx - 32, cy, ex, y + hgt / 2), fill: RED }),
      el('circle', { cx: bx, cy, r: 30, fill: RED, stroke: '#ffffff', 'stroke-width': 4 }),
      el('text', { x: bx, y: cy + 11, 'text-anchor': 'middle', 'font-size': 32, 'font-weight': 700, 'font-family': 'system-ui, sans-serif', fill: '#ffffff' }, String(i + 1)));
  });
  const svg = toDom(el('svg', { viewBox: `0 0 ${W} ${s.h}`, class: 'shot-svg', role: 'img', 'aria-label': s.alt },
    el('image', { href: s.src, x: 0, y: 0, width: s.w, height: s.h }),
    el('rect', { x: 0.5, y: 0.5, width: s.w - 1, height: s.h - 1, fill: 'none', stroke: '#8c959f', 'stroke-width': 1 }),
    ...marks));
  return h('figure', { class: 'shot' }, svg,
    s.marks.length ? h('ol', { class: 'marks' }, s.marks.map((m) => h('li', { text: m.text }))) : null);
}

/** the tip of an arrow from (x1, y1) that ends at (x2, y2) */
function arrowHead(x1, y1, x2, y2) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const [ux, uy] = [(x2 - x1) / len, (y2 - y1) / len];
  const [bx, by] = [x2 - ux * 22, y2 - uy * 22];
  return [[x2, y2], [bx - uy * 12, by + ux * 12], [bx + uy * 12, by - ux * 12]].map((p) => p.map((v) => Math.round(v * 10) / 10).join(',')).join(' ');
}

/** the paragraphs of a step */
export function stepText(paragraphs) {
  return paragraphs.map(({ p }) => h('p', {}, p.map((x) => (typeof x === 'string' ? x : x.code ? h('code', { text: x.code })
    : x.muted ? h('span', { class: 'muted', text: x.text })
    : h('a', { href: x.href, target: '_blank', rel: 'noopener noreferrer', class: x.button ? 'button primary' : null, text: x.text })))));
}

/**
 * One step: its number, its title, its text, then `body` (the Contribute page puts the check and the buttons there), its pictures and
 * its tip. pictures: 'open' shows them, 'closed' puts them behind "Show me", false leaves them out.
 */
export function stepSection(step, n, { body = [], pictures = 'open' } = {}) {
  const shots = pictures && step.shots.length ? step.shots.map(shotFigure) : [];
  const pics = !shots.length ? null : pictures === 'closed'
    ? h('details', { class: 'shots' }, h('summary', { text: `Show me (${shots.length === 1 ? 'a picture' : `${shots.length} pictures`})` }), shots)
    : h('div', { class: 'shots' }, shots);
  return h('section', { class: 'step', id: `step-${step.id}`, 'aria-labelledby': `step-${step.id}-title` },
    h('h3', { id: `step-${step.id}-title` }, h('span', { class: 'step-n', 'aria-hidden': 'true', text: String(n) }), h('span', { class: 'visually-hidden', text: `Step ${n}: ` }), step.title),
    stepText(step.text), body, pics, step.tip ? h('div', { class: 'tip' }, stepText(step.tip)) : null);
}
