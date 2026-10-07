/**
 * The board as an SVG tree (see svg.js). One drawing function, two looks (themes): the interactive dark board, and a monochrome diagram for export.
 *
 * The position drawn is the one BEFORE the play. The play is shown on top of it: rounded transparent arrows from the checkers that move
 * to the place where each one lands, and a transparent "ghost" checker there (the new position). Hit blots get a red ring and a ghost on the bar.
 */
import { el } from './svg.js';
import { BAR, OFF } from '../lib/core/rules.js';
import { actor, pips } from './replay-model.js';

// geometry (viewBox units)
const COL = 58;          // width of a point
const BARW = 66;
const PAD = 16;          // frame thickness
const PH = 286;          // height of a point's column (five checkers fit, touching)
const MID = 74;          // free strip in the middle
const R = 28;            // checker radius, line included: a checker is a little wider than the base of a point (COL - 4)
const TRAY = 78;         // bear-off tray + gap, on both sides
const HEAD = 38;         // names line
const NUM = 22;          // point numbers line
const INNER_W = 12 * COL + BARW;
const INNER_H = 2 * PH + MID;
const SIDE = 24;         // margin on the side without the trays (room for the turn marker)
const TRIM = TRAY - SIDE; // the drawing has room for the trays on both sides; the view leaves out the side without them
export const VIEW_W = 2 * TRAY + INNER_W + 2 * PAD - TRIM;
export const VIEW_H = 2 * HEAD + 2 * NUM + INNER_H + 2 * PAD;
const FX = TRAY;                      // frame left
const FY = HEAD + NUM;                // frame top
const IX = FX + PAD;                  // inner left
const IY = FY + PAD;                  // inner top
const IB = IY + INNER_H;              // inner bottom
const MIDY = IY + PH + MID / 2;
const BARX = IX + 6 * COL + BARW / 2;

export const THEMES = {
  board: {
    font: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
    bg: '#0e1a2b', frame: '#1c3050', triA: '#0b1526', triB: '#a9c8ec', bar: '#0a1322', mid: '#2b5a96',
    c0: { fill: '#f6f8fc', stroke: '#000000' }, c1: { fill: '#2a3245', stroke: '#000000' },   // dark, yet lighter than the dark points it stands on
    ghost: 0.45, arrow: '#f5b942', arrowOpacity: 0.7, hit: '#ff6b5e', illegal: '#ff6b5e',
    label: '#8fa6c4', text: '#e8eef7', textStrong: '#ffffff', dieFill: '#fbfcfe', dieStroke: '#c4cde0', diePip: '#101624',
    cubeFill: '#eef2f8', cubeStroke: '#9db0cc', cubeText: '#0e1a2b', tray: '#132338', banner: '#000000', bannerOpacity: 0.62, bannerText: '#ffffff', turn: '#f5b942',
  },
  export: {
    font: 'Arial, Helvetica, sans-serif',
    bg: '#ffffff', frame: '#000000', triA: '#bdbdbd', triB: '#ffffff', bar: '#e6e6e6', mid: '#ffffff',
    c0: { fill: '#ffffff', stroke: '#000000' }, c1: { fill: '#000000', stroke: '#000000' },
    ghost: 0.45, arrow: '#444444', arrowOpacity: 0.7, hit: '#000000', illegal: '#000000',
    label: '#444444', text: '#000000', textStrong: '#000000', dieFill: '#ffffff', dieStroke: '#000000', diePip: '#000000',
    cubeFill: '#ffffff', cubeStroke: '#000000', cubeText: '#000000', tray: '#ffffff', banner: '#000000', bannerOpacity: 0.0, bannerText: '#000000', turn: '#000000',
  },
};

/** screen position of point b (numbering of the bottom player, 1..24) */
function column(b, mirror) {
  const c = b <= 12 ? 12 - b : b - 13;                 // 0..11, left to right (home board of the bottom player on the right)
  return mirror ? 11 - c : c;
}
const colX = (c) => IX + c * COL + (c >= 6 ? BARW : 0) + COL / 2;

/** layout of the stacks, once per drawing */
function makeLayout(view) {
  const { bottomSide, mirror } = view;
  const bottomNo = (side, p) => (side === bottomSide ? p : 25 - p);           // a checker's point in the bottom player's numbering
  const stepFor = (n) => (n <= 1 ? 2 * R : Math.max(12, Math.min(2 * R, (PH - 2 * R - 8) / (n - 1))));
  const slotCount = new Map();                                                 // "b" -> number of slots to make room for
  const need = (side, p, n) => { if (p >= 1 && p <= 24) { const b = bottomNo(side, p); slotCount.set(b, Math.max(slotCount.get(b) ?? 0, n)); } };
  return {
    need,
    xy(side, p, slot) {
      if (p === BAR) {
        const down = side === bottomSide;
        return { x: BARX, y: MIDY + (down ? 1 : -1) * (58 + slot * (2 * R + 2)) };
      }
      const b = bottomNo(side, p);
      const step = stepFor(slotCount.get(b) ?? 5);
      const x = colX(column(b, mirror));
      return b <= 12 ? { x, y: IB - R - 4 - slot * step } : { x, y: IY + R + 4 + slot * step };
    },
    trayXY(side, slot) {
      const bottom = side === bottomSide;
      return {
        x: mirror ? FX - TRAY / 2 : FX + 2 * PAD + INNER_W + TRAY / 2,                       // the trays are on the home-board side
        y: bottom ? IB + PAD - 12 - slot * 15 : IY - PAD + 12 + slot * 15,
      };
    },
  };
}

const esc = (s) => String(s ?? '');
const checker = (t, side, x, y, opts = {}) => {
  const c = side === 0 ? t.c0 : t.c1;           // one colour with a black edge: nothing inside
  return el('g', opts.ghost ? { opacity: t.ghost } : {},
    el('circle', { cx: x, cy: y, r: R - 1, fill: c.fill, stroke: c.stroke, 'stroke-width': 2, 'stroke-dasharray': opts.ghost ? '5 4' : null }));
};
const flat = (t, side, x, y, ghost) => {
  const c = side === 0 ? t.c0 : t.c1;
  return el('g', ghost ? { opacity: t.ghost } : {}, el('rect', { x: x - 26, y: y - 6, width: 52, height: 12, rx: 4, fill: c.fill, stroke: c.stroke, 'stroke-width': 1.5, 'stroke-dasharray': ghost ? '5 4' : null }));
};

function die(t, x, y, v) {
  const S = 52;
  const g = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
  return el('g', {}, el('rect', { x: x - S / 2, y: y - S / 2, width: S, height: S, rx: 10, fill: t.dieFill, stroke: t.dieStroke, 'stroke-width': 2 }),
    ...g[v].map(([dx, dy]) => el('circle', { cx: x + dx * 13, cy: y + dy * 13, r: 5.2, fill: t.diePip })));
}

function cubeNode(t, x, y, value, big) {
  const S = big ? 58 : 50;
  return el('g', {}, el('rect', { x: x - S / 2, y: y - S / 2, width: S, height: S, rx: 9, fill: t.cubeFill, stroke: t.cubeStroke, 'stroke-width': big ? 3.5 : 2.5 }),
    el('text', { x, y: y + 9, 'text-anchor': 'middle', 'font-size': value >= 100 ? 20 : 26, 'font-weight': 700, fill: t.cubeText, 'font-family': t.font }, String(value)));
}

function arrow(t, from, to, color) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy) || 1;
  const u = { x: dx / d, y: dy / d };
  const s = { x: from.x + u.x * 6, y: from.y + u.y * 6 };
  const e = { x: to.x - u.x * (R + 4), y: to.y - u.y * (R + 4) };
  const mid = { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 };
  let n = { x: -u.y, y: u.x };
  if (Math.abs((mid.y + n.y * 10) - MIDY) > Math.abs((mid.y - n.y * 10) - MIDY)) n = { x: -n.x, y: -n.y };   // bulge towards the middle of the board
  const bulge = Math.min(80, d * 0.28);
  const c = { x: mid.x + n.x * bulge, y: mid.y + n.y * bulge };
  const tx = e.x - c.x;
  const ty = e.y - c.y;
  const tl = Math.hypot(tx, ty) || 1;
  const tu = { x: tx / tl, y: ty / tl };
  const base = { x: e.x - tu.x * 20, y: e.y - tu.y * 20 };
  const nn = { x: -tu.y, y: tu.x };
  const head = `${e.x},${e.y} ${base.x + nn.x * 12},${base.y + nn.y * 12} ${base.x - nn.x * 12},${base.y - nn.y * 12}`;
  return el('g', { opacity: t.arrowOpacity },
    el('path', { d: `M${s.x},${s.y} Q${c.x},${c.y} ${base.x},${base.y}`, fill: 'none', stroke: color, 'stroke-width': 11, 'stroke-linecap': 'round' }),
    el('polygon', { points: head, fill: color, stroke: color, 'stroke-width': 5, 'stroke-linejoin': 'round' }));
}

/**
 * Whose numbering the point numbers follow by default: the player on move. The whole sequence double - take/pass keeps the numbering
 * of the player who doubles (the one who rolls next after a take), so the numbers do not flip at the answer. At the end of a game: the bottom player.
 */
export function numberingSide(step, bottomSide) {
  if (step.kind === 'end') return bottomSide;
  if ((step.kind === 't' || step.kind === 'p') && step.offer) return step.offer.side;
  return step.side;
}

export const cubeShown = (cube) => (cube.owner === null && cube.value === 1 ? 64 : cube.value);

export function describeStep(replay, game, step) {
  const name = (s) => replay.sides[s]?.name ?? `Player ${s + 1}`;
  const g = `Game ${game.index}`;
  if (step.kind === 'end') return `${g}, final position. ${step.text}.`;
  const who = name(step.side);
  if (step.kind === 'm') return `${g}, play ${step.number}: ${who} rolls ${step.dice.join(' and ')} and plays ${step.draw.paths.length ? step.text.slice(3) : step.abandoned ? 'nothing' : 'nothing (cannot move)'}${step.abandoned ? ' and the game stops there (resignation)' : ''}${step.illegal ? ' (an illegal play, kept as played)' : ''}.`;
  return `${g}: ${who} ${step.kind === 'd' ? `doubles to ${step.text.replace('Doubles to ', '')}` : step.kind === 't' ? 'takes' : 'passes'}.`;
}

/**
 * @param {{replay:object, game:object, step:object, bottomSide?:number, mirror?:boolean, numbers?:'mover'|'bottom'|'none', arrows?:boolean, theme?:'board'|'export', dice?:boolean}} view
 */
export function boardTree(view) {
  const { replay, game, step } = view;
  const t = THEMES[view.theme ?? 'board'];
  const bottomSide = view.bottomSide ?? 0;
  const mirror = !!view.mirror;
  const v = { bottomSide, mirror };
  const L = makeLayout(v);
  const pos = step.pos;
  const draw = step.draw;
  const showPlay = view.arrows !== false && draw;

  // room for stacks (before the play and with the ghosts)
  for (const s of [0, 1]) for (let p = 1; p <= 24; p++) L.need(s, p, pos.c[s][p]);
  if (showPlay) for (const gh of draw.ghosts) if (gh.point >= 1) L.need(gh.side, gh.point, gh.slot + 1);

  const out = [];
  const x0 = mirror ? 0 : TRIM;
  out.push(el('rect', { x: x0, y: 0, width: VIEW_W, height: VIEW_H, fill: t.bg }));
  out.push(el('rect', { x: FX, y: FY, width: INNER_W + 2 * PAD, height: INNER_H + 2 * PAD, rx: 10, fill: t.frame }));
  out.push(el('rect', { x: IX, y: IY, width: INNER_W, height: INNER_H, fill: t.mid }));
  out.push(el('rect', { x: IX + 6 * COL, y: IY, width: BARW, height: INNER_H, fill: t.bar }));
  const trayX = mirror ? FX - TRAY + 8 : FX + 2 * PAD + INNER_W + 8;                       // bear-off trays
  for (const top of [true, false]) {
    out.push(el('rect', { x: trayX, y: top ? FY : FY + INNER_H / 2 + PAD + 4, width: TRAY - 16, height: INNER_H / 2 + PAD - 4, rx: 8, fill: t.tray, stroke: view.theme === 'export' ? '#000000' : t.frame, 'stroke-width': 2 }));
  }

  // points
  for (let b = 1; b <= 24; b++) {
    const c = column(b, mirror);
    const x = colX(c);
    const bottom = b <= 12;
    const colour = (b % 2 === 1) ? t.triA : t.triB;
    const baseY = bottom ? IB : IY;
    const tipY = bottom ? IB - PH * 0.92 : IY + PH * 0.92;
    out.push(el('polygon', { points: `${x - COL / 2 + 2},${baseY} ${x + COL / 2 - 2},${baseY} ${x},${tipY}`, fill: colour, stroke: view.theme === 'export' ? '#000000' : null, 'stroke-width': view.theme === 'export' ? 1 : null }));
  }

  // point numbers
  if ((view.numbers ?? 'mover') !== 'none') {
    const moverSide = view.numbers === 'bottom' ? bottomSide : (view.labelSide ?? numberingSide(step, bottomSide));
    const label = (b) => (moverSide === bottomSide ? b : 25 - b);
    for (let b = 1; b <= 24; b++) {
      const x = colX(column(b, mirror));
      out.push(el('text', { x, y: b <= 12 ? IB + PAD + 18 : IY - PAD - 8, 'text-anchor': 'middle', 'font-size': 15, fill: t.label, 'font-family': t.font }, String(label(b))));
    }
  }

  // checkers (the position before the play)
  const stackOf = (s, p) => pos.c[s][p];
  for (const s of [0, 1]) {
    for (let p = 1; p <= BAR; p++) {
      for (let k = 0; k < stackOf(s, p); k++) { const { x, y } = L.xy(s, p, k); out.push(checker(t, s, x, y)); }
    }
    for (let k = 0; k < pos.off[s]; k++) { const { x, y } = L.trayXY(s, k); out.push(flat(t, s, x, y, false)); }
  }

  // the play: hit rings, arrows, ghosts
  if (showPlay) {
    const col = step.illegal ? t.illegal : t.arrow;
    for (const b of draw.blots) { const { x, y } = L.xy(b.side, b.point, 0); out.push(el('circle', { cx: x, cy: y, r: R + 5, fill: 'none', stroke: t.hit, 'stroke-width': 4, 'stroke-dasharray': '6 4' })); }
    for (const gh of draw.ghosts) {
      if (gh.point === OFF) { const { x, y } = L.trayXY(gh.side, gh.slot); out.push(flat(t, gh.side, x, y, true)); }
      else { const { x, y } = L.xy(gh.side, gh.point, gh.slot); out.push(checker(t, gh.side, x, y, { ghost: true })); }
    }
    for (const gh of draw.hitGhosts) { const { x, y } = L.xy(gh.side, BAR, gh.slot); out.push(checker(t, gh.side, x, y, { ghost: true })); }
    for (const a of draw.arrows) {
      const from = L.xy(a.side, a.from, a.fromSlot);
      const to = a.to === OFF ? L.trayXY(a.side, a.toSlot) : L.xy(a.side, a.to, a.toSlot);
      out.push(arrow(t, from, to, col));
    }
  }

  // cube
  const offered = step.offer && (step.kind === 't' || step.kind === 'p') ? step.offer : (step.kind === 'd' ? { side: step.side, value: Number(step.text.replace('Doubles to ', '')) } : null);
  const owner = step.cube.owner;
  if (offered) {
    const responder = 1 - offered.side;
    const half = (responder === bottomSide) === mirror ? 0 : 1;               // a half of the board: the responder's right-hand half (left if the board is mirrored)
    const x = IX + (half === 0 ? 3 * COL : 6 * COL + BARW + 3 * COL);
    out.push(cubeNode(t, x, MIDY, offered.value, true));
  } else {
    const y = owner === null ? MIDY : owner === bottomSide ? IB - 38 : IY + 38;
    out.push(cubeNode(t, BARX, y, cubeShown(step.cube), false));
  }

  // dice: in the right-hand half for the player at the bottom, the left-hand half for the player at the top (mirrored boards swap)
  if (step.dice && view.dice !== false) {
    const bottomMoves = step.side === bottomSide;
    const rightHalf = bottomMoves !== mirror;
    const cx = rightHalf ? IX + 6 * COL + BARW + 3 * COL : IX + 3 * COL;
    out.push(die(t, cx - 36, MIDY, step.dice[0]), die(t, cx + 36, MIDY, step.dice[1]));
  }

  // names, scores, pip counts, turn marker
  const [p0, p1] = pips(step);
  const pip = [p0, p1];
  const act = actor(step);
  const lenText = replay.matchLength === 0 ? 'money' : String(replay.matchLength);
  const topSide = 1 - bottomSide;
  const header = (side, y, anchor) => {
    const name = esc(replay.sides[side]?.name ?? `Player ${side + 1}`);
    const sc = replay.matchLength === 0 ? `${step.score[side]}` : `${step.score[side]} / ${lenText}`;
    const marker = act === side ? el('polygon', { points: `${FX},${y - 16} ${FX + 14},${y - 9} ${FX},${y - 2}`, fill: t.turn }) : null;
    return [
      marker,
      el('text', { x: FX + 24, y: y - 3, 'font-size': 24, 'font-weight': 700, fill: act === side ? t.textStrong : t.text, 'font-family': t.font }, name),
      el('text', { x: BARX, y: y - 4, 'text-anchor': 'middle', 'font-size': 18, fill: t.label, 'font-family': t.font }, `pips ${pip[side]}`),
      el('text', { x: FX + 2 * PAD + INNER_W, y: y - 3, 'text-anchor': 'end', 'font-size': 24, fill: t.text, 'font-family': t.font }, sc),
    ];
  };
  out.push(...header(topSide, HEAD - 6), ...header(bottomSide, VIEW_H - 10));
  if (game.crawford) out.push(el('text', { x: FX + 2 * PAD + INNER_W, y: HEAD + 8, 'text-anchor': 'end', 'font-size': 14, fill: t.label, 'font-family': t.font }, 'Crawford game'));

  // banners: result, illegal play
  const banner = (text, y) => {
    const w = Math.min(INNER_W - 40, 24 + text.length * 12.5);
    return el('g', {}, el('rect', { x: IX + INNER_W / 2 - w / 2, y: y - 22, width: w, height: 44, rx: 10, fill: t.banner, opacity: t.bannerOpacity }),
      el('text', { x: IX + INNER_W / 2, y: y + 8, 'text-anchor': 'middle', 'font-size': 22, 'font-weight': 700, fill: t.bannerText, 'font-family': t.font }, text));
  };
  if (step.kind === 'end') out.push(banner(step.text, MIDY));
  if (step.illegal) out.push(banner('illegal play, kept as played', MIDY - 64));

  const alt = describeStep(replay, game, step);
  return el('svg', { viewBox: `${x0} 0 ${VIEW_W} ${VIEW_H}`, role: 'img', 'aria-label': alt, 'font-family': t.font }, el('title', {}, alt), ...out);
}
