/**
 * The replay of a match (milestone M4): the position before each play with arrows and transparent ghost checkers, controls, a move list,
 * and a menu (position IDs, picture export, display options). All data goes into the page with textContent / setAttribute only.
 */
import { buildGame, positionIds } from './replay-model.js';
import { boardTree, describeStep, VIEW_W, VIEW_H } from './board.js';
import { toDom, toSvgFile } from './svg.js';
import { h, slug, download, copyText } from './dom.js';

const SPEEDS = [['Slow', 2200], ['Normal', 1300], ['Fast', 600]];
const SIZES = [['fit', 'Board size: fit to the window'], ['small', 'Board size: small']];
const SIZE_KEY = 'bgdb.boardSize';

/** the board size chosen earlier in this browser (a convenience: storage may be missing or refused) */
function savedSize() {
  try { const v = localStorage.getItem(SIZE_KEY); return SIZES.some(([k]) => k === v) ? v : 'fit'; } catch { return 'fit'; }
}
function saveSize(v) { try { localStorage.setItem(SIZE_KEY, v); } catch { /* not remembered */ } }

/** PNG of an SVG file text, at twice the size */
function svgToPng(svgText, width, height) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * 2;
      canvas.height = height * 2;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the picture could not be made'))), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('the picture could not be made')); };
    img.src = url;
  });
}

/**
 * @param {{replay:object, meta:object, head?:Element, initial?:{g?:number,t?:number}, onChange?:(s:{g:number,t:number})=>void, link:(s:{g:number,t:number})=>string}} o
 */
export function createReplay(o) {
  const { replay } = o;
  const S = { g: 0, t: 0, bottomSide: 0, mirror: false, numbers: 'mover', arrows: true, playing: false, speed: 1, timer: null, menuOpen: false, size: savedSize() };
  const cache = [];
  const game = () => (cache[S.g] ??= buildGame(replay, S.g));
  const step = () => game().steps[S.t];
  const last = () => game().steps.length - 1;
  const names = [replay.sides[0].name ?? 'Player 1', replay.sides[1].name ?? 'Player 2'];

  const ui = {};
  const root = h('section', { class: `replay size-${S.size}`, 'aria-label': 'Replay' });
  root.style.setProperty('--board-ratio', String(VIEW_W / VIEW_H));

  // ---------------------------------------------------------------- move list (left on wide screens)
  ui.gameSelect = h('select', { id: 'rp-game', 'aria-label': 'Game', onchange: () => setGame(parseInt(ui.gameSelect.value, 10), 0) },
    replay.games.map((g, i) => h('option', { value: String(i), text: `Game ${g.index} · ${g.startScore[0]}–${g.startScore[1]}` })));
  ui.prevGame = h('button', { type: 'button', text: '‹', title: 'Previous game', 'aria-label': 'Previous game', onclick: () => setGame(S.g - 1, 0) });
  ui.nextGame = h('button', { type: 'button', text: '›', title: 'Next game', 'aria-label': 'Next game', onclick: () => setGame(S.g + 1, 0) });
  ui.list = h('ol', { class: 'move-list' });
  const head = o.head ? h('div', { class: 'replay-top' }, o.head) : null;
  const aside = h('aside', { class: 'replay-list', 'aria-label': 'Moves' },
    h('div', { class: 'game-picker' }, ui.prevGame, ui.gameSelect, ui.nextGame), ui.list);

  // ---------------------------------------------------------------- board, menu, controls
  ui.boardHost = h('div', { class: 'board-host' });
  ui.status = h('p', { class: 'copy-status', role: 'status', 'aria-live': 'polite' });
  ui.menuButton = h('button', { type: 'button', class: 'kebab', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Board menu', title: 'Board menu', onclick: toggleMenu }, '⋮');
  ui.menu = h('div', { class: 'menu', role: 'menu', hidden: true });
  const boardWrap = h('div', { class: 'board-wrap', tabindex: '0', 'aria-label': 'Board. Arrow keys move through the game, Home and End jump to the start and the end, Space plays.' }, ui.boardHost, ui.status);

  ui.first = h('button', { type: 'button', text: '⏮', title: 'First position (Home)', 'aria-label': 'First position', onclick: () => goStep(0) });
  ui.prev = h('button', { type: 'button', text: '‹', title: 'Previous (←)', 'aria-label': 'Previous step', onclick: () => goStep(S.t - 1) });
  ui.play = h('button', { type: 'button', class: 'play', text: '▶', title: 'Play / pause (Space)', 'aria-label': 'Play', onclick: togglePlay });
  ui.next = h('button', { type: 'button', text: '›', title: 'Next (→)', 'aria-label': 'Next step', class: 'next', onclick: () => goStep(S.t + 1) });
  ui.end = h('button', { type: 'button', text: '⏭', title: 'Last position (End)', 'aria-label': 'Last position', onclick: () => goStep(last()) });
  ui.slider = h('input', { type: 'range', min: '0', max: '0', value: '0', 'aria-label': 'Position in the game', oninput: () => goStep(parseInt(ui.slider.value, 10)) });
  ui.speed = h('select', { 'aria-label': 'Speed', onchange: () => { S.speed = parseInt(ui.speed.value, 10); if (S.playing) { stop(); start(); } } },
    SPEEDS.map(([n], i) => h('option', { value: String(i), text: n, selected: i === S.speed })));
  const controls = h('div', { class: 'controls' }, h('div', { class: 'buttons' }, ui.first, ui.prev, ui.play, ui.next, ui.end), ui.slider, ui.speed, ui.menuButton, ui.menu);
  // the text of each step is read by screen readers; on screen the move list, the slider and the board already show it, and the board needs the room
  ui.caption = h('p', { class: 'caption visually-hidden', role: 'status', 'aria-live': 'polite' });
  const main = h('div', { class: 'replay-main' }, boardWrap, controls, ui.caption);

  root.append(...(head ? [head] : []), main, aside);
  if (!head) root.classList.add('no-head');

  // "fit to the window": the board is as large as the height of the window allows with its controls under it, when the page is at its top
  function fit() {
    if (!root.isConnected) return;
    const top = root.getBoundingClientRect().top + window.scrollY;
    const below = main.offsetHeight - boardWrap.offsetHeight;
    root.style.setProperty('--fit-h', `${Math.max(240, window.innerHeight - top - below - 8)}px`);
  }
  const onResize = () => fit();
  window.addEventListener('resize', onResize);
  requestAnimationFrame(fit);

  // ---------------------------------------------------------------- state changes
  function emit() { o.onChange?.({ g: S.g + 1, t: S.t }); }

  function setGame(g, t) {
    S.g = Math.max(0, Math.min(replay.games.length - 1, g));
    S.t = Math.max(0, Math.min(last(), t));
    stop();
    buildList();
    render();
    emit();
  }

  function goStep(t, quiet) {
    const n = Math.max(0, Math.min(last(), t));
    if (n === S.t) { if (S.playing && n === last()) stop(); return; }
    S.t = n;
    if (S.playing && S.t === last()) stop();
    render();
    if (!quiet) emit();
  }

  function start() {
    if (S.t >= last()) { S.t = 0; render(); }
    S.playing = true;
    S.timer = setInterval(() => goStep(S.t + 1, false), SPEEDS[S.speed][1]);
    syncPlay();
  }
  function stop() { S.playing = false; clearInterval(S.timer); S.timer = null; syncPlay(); }
  function togglePlay() { if (S.playing) stop(); else start(); }
  function syncPlay() { ui.play.textContent = S.playing ? '⏸' : '▶'; ui.play.setAttribute('aria-label', S.playing ? 'Pause' : 'Play'); }

  // ---------------------------------------------------------------- drawing
  function buildList() {
    const gm = game();
    ui.list.replaceChildren(...gm.steps.map((st, i) => {
      const side = st.kind === 'end' ? null : st.side;
      const label = st.kind === 'm' ? `${st.number}.` : st.kind === 'end' ? '' : '·';
      const btn = h('button', { type: 'button', class: `row-btn ${st.kind === 'm' ? 'play-row' : st.kind === 'end' ? 'end-row' : 'cube-row'}`, onclick: () => { stop(); goStep(i); } },
        side === null ? null : h('span', { class: `dot s${side}`, title: names[side], 'aria-hidden': 'true' }),
        h('span', { class: 'no', text: label }), h('span', { class: 'txt', text: st.text }),
        st.illegal ? h('span', { class: 'badge warn', text: 'illegal', title: 'An illegal play that was made and is kept as played' }) : null);
      return h('li', { 'data-step': String(i) }, btn);
    }));
  }

  function render() {
    const gm = game();
    const st = step();
    const tree = boardTree({ replay, game: gm, step: st, bottomSide: S.bottomSide, mirror: S.mirror, numbers: S.numbers, arrows: S.arrows, theme: 'board' });
    const svg = toDom(tree);
    svg.setAttribute('class', 'board-svg');
    ui.boardHost.replaceChildren(svg);
    ui.slider.max = String(last());
    ui.slider.value = String(S.t);
    ui.gameSelect.value = String(S.g);
    ui.prevGame.disabled = S.g === 0;
    ui.nextGame.disabled = S.g === replay.games.length - 1;
    ui.first.disabled = ui.prev.disabled = S.t === 0;
    ui.next.disabled = ui.end.disabled = S.t === last();
    ui.caption.textContent = `${describeStep(replay, gm, st)} (${S.t + 1} of ${last() + 1})`;
    for (const li of ui.list.children) {
      const on = li.dataset.step === String(S.t);
      const b = li.firstChild;
      if (on) { b.setAttribute('aria-current', 'step'); b.classList.add('on'); } else { b.removeAttribute('aria-current'); b.classList.remove('on'); }
      if (on) {
        const top = li.offsetTop;
        if (top < ui.list.scrollTop || top + li.offsetHeight > ui.list.scrollTop + ui.list.clientHeight) ui.list.scrollTop = top - ui.list.clientHeight / 2;
      }
    }
    buildMenu();
  }

  // ---------------------------------------------------------------- menu
  const ids = () => positionIds(replay, game(), step());
  const flash = (text) => { ui.status.textContent = text; clearTimeout(flash.t); flash.t = setTimeout(() => { ui.status.textContent = ''; }, 3500); };

  async function copyId(kind) {
    const i = ids();
    if (!i) return;
    const text = kind === 'xg' ? i.xgid : i.gnubgid;
    const ok = await copyText(text);
    flash(ok ? `${kind === 'xg' ? 'XGID' : 'GNU Backgammon ID'} copied: ${text}` : `Copy it by hand: ${text}`);
  }

  async function copyLink() {
    const url = new URL(o.link({ g: S.g + 1, t: S.t }), document.baseURI).href;
    flash((await copyText(url)) ? 'Link to this position copied' : `Copy it by hand: ${url}`);
  }

  function diagram() {
    const tree = boardTree({ replay, game: game(), step: step(), bottomSide: S.bottomSide, mirror: S.mirror, numbers: S.numbers, arrows: false, theme: 'export' });
    tree.attrs.width = VIEW_W;
    tree.attrs.height = VIEW_H;
    return { text: toSvgFile(tree), name: `${slug(names[0])}-vs-${slug(names[1])}-game${game().index}-position${S.t + 1}` };
  }

  async function exportPng() {
    try { const d = diagram(); download(await svgToPng(d.text, VIEW_W, VIEW_H), `${d.name}.png`); flash('Picture saved (PNG)'); } catch (e) { flash(e.message); }
  }
  function exportSvg() { const d = diagram(); download(new Blob([d.text], { type: 'image/svg+xml' }), `${d.name}.svg`); flash('Picture saved (SVG)'); }

  function setSize(v) {
    root.classList.replace(`size-${S.size}`, `size-${v}`);
    S.size = v;
    saveSize(v);
    buildMenu();
    fit();
    root.scrollIntoView({ block: 'nearest' });
  }

  const NUMBER_MODES = [['mover', 'Point numbers: of the player to move'], ['bottom', 'Point numbers: of the player at the bottom'], ['none', 'Point numbers: hidden']];
  function buildMenu() {
    const i = ids();
    const item = (text, fn, extra = {}) => h('button', { type: 'button', role: 'menuitem', class: 'menu-item', text, onclick: () => { closeMenu(); fn(); }, ...extra });
    ui.menu.replaceChildren(
      item('Copy XGID', () => copyId('xg'), { disabled: !i, title: i ? i.xgid : 'Not available for an answer to a double or for the final position' }),
      item('Copy GNU Backgammon ID', () => copyId('gnu'), { disabled: !i, title: i ? i.gnubgid : 'Not available for an answer to a double or for the final position' }),
      item('Copy link to this position', copyLink),
      h('hr'),
      item('Save picture (PNG)', exportPng),
      item('Save picture (SVG)', exportSvg),
      h('hr'),
      item('Swap players (top / bottom)', () => { S.bottomSide = 1 - S.bottomSide; render(); }),
      item(S.mirror ? 'Home boards on the right' : 'Home boards on the left', () => { S.mirror = !S.mirror; render(); }),
      item(S.arrows ? 'Hide arrows' : 'Show arrows', () => { S.arrows = !S.arrows; render(); }),
      item(NUMBER_MODES.find(([k]) => k === S.numbers)[1], () => { S.numbers = NUMBER_MODES[(NUMBER_MODES.findIndex(([k]) => k === S.numbers) + 1) % NUMBER_MODES.length][0]; render(); }),
      h('hr'),
      ...SIZES.map(([k, text]) => item(`${k === S.size ? '✓' : '\u2003'} ${text}`, () => setSize(k), { role: 'menuitemradio', 'aria-checked': String(k === S.size) })));
  }
  function toggleMenu() { S.menuOpen ? closeMenu() : openMenu(); }
  function openMenu() {
    S.menuOpen = true;
    ui.menu.hidden = false;
    ui.menuButton.setAttribute('aria-expanded', 'true');
    ui.menu.querySelector('button:not(:disabled)')?.focus();
  }
  function closeMenu(refocus) {
    S.menuOpen = false;
    ui.menu.hidden = true;
    ui.menuButton.setAttribute('aria-expanded', 'false');
    if (refocus) ui.menuButton.focus();
  }

  // ---------------------------------------------------------------- keyboard and outside clicks
  const onKey = (e) => {
    if (!root.isConnected) return;
    const tag = e.target.tagName;
    if (e.key === 'Escape' && S.menuOpen) { e.preventDefault(); closeMenu(true); return; }
    if (S.menuOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const items = [...ui.menu.querySelectorAll('button:not(:disabled)')];
      const k = items.indexOf(document.activeElement);
      items[(k + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey || ['INPUT', 'TEXTAREA'].includes(tag) || (tag === 'SELECT')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); stop(); goStep(S.t + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); stop(); goStep(S.t - 1); }
    else if (e.key === 'Home') { e.preventDefault(); stop(); goStep(0); }
    else if (e.key === 'End') { e.preventDefault(); stop(); goStep(last()); }
    else if (e.key === ' ' && tag !== 'BUTTON' && tag !== 'A') { e.preventDefault(); togglePlay(); }
  };
  const onClick = (e) => { if (S.menuOpen && !ui.menu.contains(e.target) && e.target !== ui.menuButton) closeMenu(); };
  document.addEventListener('keydown', onKey);
  document.addEventListener('click', onClick);

  // ---------------------------------------------------------------- start
  const g0 = Math.max(0, Math.min(replay.games.length - 1, (o.initial?.g ?? 1) - 1));
  S.g = g0;
  S.t = Math.max(0, Math.min(last(), o.initial?.t ?? 0));
  buildList();
  render();

  return {
    el: root,
    /** move to another game / step (from the address bar) without writing the address again */
    goto(g, t) { const ng = Math.max(0, Math.min(replay.games.length - 1, (g ?? 1) - 1)); stop(); if (ng !== S.g) { S.g = ng; buildList(); } S.t = Math.max(0, Math.min(last(), t ?? 0)); render(); },
    destroy() { stop(); window.removeEventListener('resize', onResize); document.removeEventListener('keydown', onKey); document.removeEventListener('click', onClick); },
  };
}
