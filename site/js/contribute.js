/**
 * The "Contribute" page: six numbered steps (steps.js, shared with the "How to contribute" page). The names key (decision 0025, asked the
 * first time only), then drop or paste matches and see at once what would happen to them (the same check as the tools, run in the browser,
 * nothing is sent anywhere) and the names they will have, add a video link, download them as a ZIP, and drop the ZIP into the "Submit a
 * match" form on GitHub, which a bot turns into additions to the database (decision 0015).
 */
import { loadAll } from './catalog.js';
import { h, download } from './dom.js';
import { makeZip } from './zip.js';
import { prepare, hideNames, parseExtras, packageFiles, issueFormLink, previewReplay, knownFromRows, sendable, platformOf } from './contribute-model.js';
import { STEPS, stepSection, accountNotice, stepNo } from './steps.js';
import { newKey, keyFileText, parseKey, keyToHex, keyFromHex, keyFingerprint, namer } from '../lib/core/index.js';
import { buildGame } from './replay-model.js';
import { boardTree } from './board.js';
import { toDom } from './svg.js';
import { lengthText, parseMatchId } from './format.js';

const S = { data: null, items: [], files: [], extras: new Map(), config: null, zipped: false, opened: false, key: null, keyMode: null, visitKey: newKey() };
const ui = {};

// ---------------------------------------------------------------- the names key (decision 0025)

// kept by the browser for the whole site (the database's pages share it); never sent anywhere
const KEY_STORE = 'bgdb-names-key';
function storedKey() { try { return keyFromHex(localStorage.getItem(KEY_STORE)); } catch { return null; } }
function storeKey(key) { try { localStorage.setItem(KEY_STORE, keyToHex(key)); return localStorage.getItem(KEY_STORE) === keyToHex(key); } catch { return false; } }
function dropStoredKey() { try { localStorage.removeItem(KEY_STORE); } catch { /* nothing kept */ } }

/** the pseudonyms of the moment: the contributor's key, or, until they choose, a key made for this visit only */
const nameOf = () => namer(S.key ?? S.visitKey);

function downloadKey() {
  if (!S.key) return;
  download(new Blob([keyFileText(S.key)], { type: 'text/plain' }), 'bgdb-names-key.txt');
  S.keySaved = true;
  renderKey();
}

/** mode: 'saved' (kept by this browser), 'unsaved' (the browser cannot keep it), 'visit' (no key: this visit only) */
async function useKey(key, mode) {
  S.key = key;
  S.keyMode = mode;
  if (mode === 'visit') S.visitKey = newKey();
  renderKey();
  if (S.files.length) await check(S.files);                          // the same matches, with the names of this key
  else refreshActions();
}

async function createKey() {
  const key = newKey();
  S.keySaved = false;
  await useKey(key, storeKey(key) ? 'saved' : 'unsaved');
}

async function loadKeyFile(file) {
  const key = parseKey(await file.text());
  if (!key) { ui.keyNote.textContent = `${file.name} is not a names key: it should hold a line that starts with "bgdb-key-1:".`; return; }
  S.keySaved = true;
  await useKey(key, storeKey(key) ? 'saved' : 'unsaved');
}

async function forgetKey() {
  if (!window.confirm('Forget the key in this browser? Without a copy of it, your opponents will get new names in your next matches.')) return;
  dropStoredKey();
  S.key = null;
  S.keyMode = null;
  renderKey();
  if (S.files.length) await check(S.files); else refreshActions();
}

/** the body of the key step: three choices the first time, then one line that says which key is in use */
function renderKey() {
  const fp = S.key ? keyFingerprint(S.key) : '';
  const btn = (text, onclick, cls = '') => h('button', { type: 'button', class: cls, text, onclick });
  const loadBtn = h('label', { class: 'button', for: 'key-file', text: S.key ? 'Use another key file' : 'I have a key file' });
  let kids;
  if (!S.keyMode) {
    kids = [h('div', { class: 'actions' }, btn('Create my key', createKey, 'primary big'), loadBtn, btn('Go on without a key', () => useKey(null, 'visit')))];
  } else if (S.keyMode === 'visit') {
    kids = [h('p', { text: 'No key: the names are replaced with a key made for this visit only, so the same opponent gets a new name next time.' }),
      h('div', { class: 'actions' }, btn('Create my key after all', createKey), loadBtn)];
  } else {
    const where = S.keyMode === 'saved' ? 'kept in this browser' : 'not kept: this browser cannot store it, so download a copy now';
    kids = [h('p', {}, h('strong', { text: 'Your names key is ready' }), ` (${where}; key ${fp}).`),
      !S.keySaved ? h('p', { class: 'muted', text: 'Download a copy now and keep it with your files: it is the only way to get the same names on another computer, or after clearing this browser.' }) : null,
      h('div', { class: 'actions' }, btn('Download a copy of my key', downloadKey, S.keySaved ? '' : 'primary'), loadBtn,
        S.keyMode === 'saved' ? btn('Forget it', forgetKey) : null)];
  }
  ui.keyBody.replaceChildren(...kids.filter(Boolean), ui.keyInput, ui.keyNote);
  ui.keyNote.textContent = '';
  // the explanation is shown in full the first time; afterwards it is one click away
  const chosen = !!S.keyMode;
  for (const p of ui.keyText) p.hidden = chosen && !ui.keyWhy.open;
  ui.keyWhy.hidden = !chosen;
}

async function readFiles(fileList) {
  return Promise.all([...fileList].map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
}

const badge = (text, cls) => h('span', { class: `badge${cls ? ` ${cls}` : ''}`, text });

function diagnostics(res) {
  const rows = [...res.errors.map((e) => ({ ...e, severity: 'error' })), ...res.warnings.filter((w) => w.severity === 'warning')];
  return rows.length ? h('ul', { class: 'diag' }, rows.map((d) => h('li', { class: d.severity },
    h('strong', { text: d.severity === 'error' ? 'Needs a fix: ' : 'Note: ' }), `${d.message}${d.line ? ` (line ${d.line})` : ''}`,
    d.hint ? h('div', { class: 'muted', text: `How to fix: ${d.hint}` }) : null))) : null;
}

function preview(match) {
  try {
    const replay = previewReplay(match);
    const gi = replay.games.length - 1;
    const game = buildGame(replay, gi);
    const svg = toDom(boardTree({ replay, game, step: game.steps.at(-1), theme: 'board' }));
    svg.setAttribute('class', 'board-svg');
    return h('div', { class: 'thumb', 'aria-label': 'The last position of the match' }, svg);
  } catch { return null; }
}

function card(item, i) {
  const { res, group } = item;
  const names = Object.values(group.files).flat().map((e) => e.name);
  const s = res.summary;
  const title = s ? `${s.players.join(' vs ')}` : names.join(', ');
  const status = res.status === 'new' ? badge('New', 'ok') : res.status === 'duplicate' ? badge('Already in the database') : res.status === 'partial' ? badge('Can be added partially', 'warn') : badge('Needs a fix', 'warn');
  const facts = s ? [lengthText(s.matchLength), s.date, s.event, s.round, `${s.games} game${s.games === 1 ? '' : 's'}`,
    s.result?.finished ? `result ${s.result.score.join('–')}` : s.result ? `unfinished ${s.result.score.join('–')}` : null].filter(Boolean).join(' · ') : '';
  const kids = [h('header', {}, status, h('h3', { text: title })), facts ? h('p', { class: 'muted', text: facts }) : null, h('p', { class: 'muted small', text: names.join(', ') })];
  if (res.status === 'new' || res.status === 'partial') {
    item.namesEl = h('div', { class: 'names-box' });
    kids.push(item.namesEl);
    renderNames(item);
    kids.push(otbBox(item, i));
  }
  if (res.status === 'duplicate') {
    const pid = parseMatchId(res.duplicateOf);
    kids.push(h('p', {}, pid ? h('a', { href: `./#m=${encodeURIComponent(res.duplicateOf)}`, text: `Open it: ${res.duplicateOf}` }) : `Found: ${res.duplicateOf}`,
      res.extrasIgnored ? h('span', { class: 'muted', text: ' (the extra files you added, SGF, XG or links, cannot be added to an existing match yet)' }) : null));
  }
  kids.push(diagnostics(res));
  if (res.status === 'partial') kids.push(partialBox(item, i));
  if (res.status === 'new' || res.status === 'partial') {
    const flags = [];
    if (res.attachments.length) flags.push(...res.attachments.map((a) => badge(`${a.kind.toUpperCase()} kept${a.analysis ? ', with analysis' : ''}`, 'ok')));
    if (res.links.length) flags.push(badge(`${res.links.length} video link${res.links.length === 1 ? '' : 's'}`));
    if (res.match.illegalPlays?.length) flags.push(badge('illegal play kept as played', 'warn'));
    if (flags.length) kids.push(h('div', { class: 'badges' }, flags));
    const video = h('input', { type: 'url', id: `video-${i}`, placeholder: 'https://youtu.be/…', autocomplete: 'off', oninput: () => { S.zipped = false; update(item); } });
    const tags = h('input', { type: 'text', id: `tags-${i}`, placeholder: 'final, semifinal', autocomplete: 'off', oninput: () => { S.zipped = false; update(item); } });
    const note = h('p', { class: 'muted small', role: 'status', 'aria-live': 'polite' });
    item.inputs = { video, tags, note };
    kids.push(h('div', { class: 'extras' },
      h('div', {}, h('label', { for: `video-${i}`, text: 'YouTube link (optional)' }), video),
      h('div', {}, h('label', { for: `tags-${i}`, text: 'Tags (optional)' }), tags), note));
    kids.push(preview(item.hidden?.match ?? res.match));
  }
  return h('article', { class: `card c-${res.status}` }, kids);
}

/** the names the match will have in the database: made-up names (decision 0025), or the real ones for a match played over the board */
function renderNames(item) {
  const kids = [];
  if (item.otb) {
    kids.push(h('p', { class: 'names' }, 'In the database: ', h('strong', { text: item.res.summary.players.join(' vs ') }),
      h('span', { class: 'muted small', text: ' (real names, with the event and the place, like chess games)' })));
  } else if (item.hidden) {
    kids.push(h('p', { class: 'names' }, 'In the database: ', h('strong', { text: item.hidden.players.join(' vs ') }),
      h('span', { class: 'muted small', text: ' (no platform, no time of day, no event, no remarks)' })));
    if (item.hidden.notes.length) kids.push(h('ul', { class: 'diag' }, item.hidden.notes.map((n) => h('li', { class: 'warning' }, h('strong', { text: 'Note: ' }), n))));
  } else if (item.hideError) kids.push(h('ul', { class: 'diag' }, h('li', { class: 'error' }, h('strong', { text: 'Cannot be sent: ' }), `the names could not be replaced (${item.hideError}).`)));
  item.namesEl.replaceChildren(...kids);
}

/**
 * Played over the board? (decision 0025): then the real names are published, and a player can ask for the match to be removed. Not offered
 * when the file names an online platform (the review would refuse it).
 */
function otbBox(item, i) {
  const platform = platformOf(item);
  if (platform) return h('p', { class: 'muted small', text: `Played online (the file names ${platform}): the players get made-up names.` });
  const box = h('input', { type: 'checkbox', id: `otb-${i}`, onchange: () => { item.otb = box.checked; S.zipped = false; renderNames(item); refreshActions(); } });
  box.checked = !!item.otb;
  return h('div', { class: 'otb' },
    h('p', {}, box, ' ', h('label', { for: `otb-${i}`, text: 'Played over the board (a tournament, a club, at home): publish the real names' })),
    h('p', { class: 'muted small', text: 'The names and moves of an over-the-board match are published as they are in your file, like chess games. A player can ask for the match to be removed.' }));
}

/**
 * A match that can only be added partially (decision 0021): what would be kept, what is wrong (to fix it instead), the .mat that would
 * be stored, and the contributor's choice. Nothing is sent unless the box is ticked.
 */
function partialBox(item, i) {
  const { res } = item;
  const accept = h('input', { type: 'checkbox', id: `partial-${i}`, onchange: () => { item.acceptPartial = accept.checked; S.zipped = false; refreshActions(); } });
  accept.checked = item.acceptPartial === true;
  return h('div', { class: 'partial' },
    h('p', { text: 'Some games cannot be read, but the rest of the match is clear. It can be added like this:' }),
    h('ul', { class: 'diag' }, res.partial.notes.map((n) => h('li', { class: 'warning', text: n.message }))),
    h('p', { class: 'muted small', text: 'Or fix the file, and the whole match will be added:' }),
    h('ul', { class: 'diag' }, res.partial.errors.slice(0, 3).map((e) => h('li', { class: 'error' }, `${e.message}${e.line ? ` (line ${e.line})` : ''}`, e.hint ? h('div', { class: 'muted', text: `How to fix: ${e.hint}` }) : null))),
    h('p', {}, h('button', { type: 'button', text: 'Download the match as it would be stored (.mat)', onclick: () => download(new Blob([(!item.otb && item.hidden?.normalised) || res.normalised], { type: 'text/plain' }), `${item.otb ? item.realBase : item.base}.mat`) }),
      h('span', { class: 'muted small', text: ' Open it in your own program, or check it, before you decide.' })),
    h('p', {}, accept, ' ', h('label', { for: `partial-${i}`, text: 'Add it partially, as shown above' })));
}

/** read what was typed for one match and remember it */
function update(item) {
  const { video, tags, note } = item.inputs;
  const x = parseExtras({ video: video.value, tags: tags.value }, S.config);
  S.extras.set(item.base, x);
  note.textContent = x.problems.join(' ');
  refreshActions();
}

function counts() {
  const c = { new: 0, duplicate: 0, error: 0, partial: 0, send: 0 };
  for (const i of S.items) { c[i.res.status]++; if (sendable(i)) c.send++; }
  return c;
}

/** what can be done now: each step is marked done, current or waiting, and its button is enabled when its turn has come */
function refreshActions() {
  const c = counts();
  const ok = c.send > 0 && ui.rights.checked;
  ui.zip.disabled = !ok;
  ui.zipWhy.textContent = c.send === 0 ? (S.items.length ? `None of these matches can be sent: they are already in the database, or need a fix (step ${stepNo('check')}).` : `First check at least one new match in step ${stepNo('check')}.`)
    : ui.rights.checked ? '' : 'Tick the box to download the ZIP.';
  const link = issueFormLink(S.data.registry, S.items);
  const canOpen = !!link && S.zipped && c.send > 0;
  if (link) ui.form.href = link; else ui.form.removeAttribute('href');
  ui.form.setAttribute('aria-disabled', canOpen ? 'false' : 'true');
  ui.form.classList.toggle('disabled', !canOpen);
  ui.formWhy.textContent = !link ? 'The database does not say where its form is: see CONTRIBUTING.md of its repository.' : canOpen ? '' : `First download the ZIP (step ${stepNo('zip')}).`;
  const done = { key: !!S.keyMode, check: c.send > 0, zip: S.zipped && c.send > 0, form: S.opened && S.zipped, send: false, wait: false };
  const current = STEPS.findIndex((st) => !done[st.id]);
  STEPS.forEach((st, i) => {
    const sec = ui.steps[i];
    sec.classList.toggle('done', done[st.id]);
    sec.classList.toggle('current', i === current);
  });
}

function showResults() {
  const c = counts();
  ui.results.replaceChildren(...S.items.map(card));
  ui.summary.textContent = S.items.length === 0 ? '' : `${S.items.length} match${S.items.length === 1 ? '' : 'es'} checked: ${c.new} new, ${c.partial ? `${c.partial} can be added partially, ` : ''}${c.duplicate} already in the database, ${c.error} need${c.error === 1 ? 's' : ''} a fix.`;
  for (const it of S.items) if (it.res.status === 'new' || it.res.status === 'partial') update(it);
  refreshActions();
}

async function check(files) {
  if (!files.length) return;
  ui.summary.textContent = 'Checking…';
  S.files = files;
  const names = nameOf();
  S.items = prepare(files, { config: S.config, known: S.known, nameOf: names });
  // the names that will be sent (decision 0025): what cannot be rewritten cannot be sent
  for (const it of S.items) {
    if (it.res.status !== 'new' && it.res.status !== 'partial') continue;
    try { it.hidden = await hideNames(it, names); } catch (e) { it.hideError = e.message; }
  }
  S.extras = new Map();
  // other matches: a ZIP downloaded before does not hold them
  S.zipped = false;
  S.opened = false;
  ui.done.textContent = '';
  showResults();
}

function zipNow() {
  const files = packageFiles(S.items, (base) => S.extras.get(base), S.data.registry.license);
  if (!files.length) return;
  download(new Blob([makeZip(files)], { type: 'application/zip' }), 'matches-for-bgdb.zip');
  S.zipped = true;
  const n = files.filter((f) => f.name !== 'CONTRIBUTION.md' && !f.name.endsWith('.bgdb.json')).length;
  ui.done.textContent = `Downloaded: matches-for-bgdb.zip (${n} file${n === 1 ? '' : 's'}). Next: step ${stepNo('form')}.`;
  refreshActions();
}

function build() {
  const main = document.getElementById('app');
  ui.drop = h('label', { class: 'drop', for: 'files' }, h('strong', { text: 'Drop your match files here' }), ' or ', h('span', { class: 'link', text: 'choose files' }),
    h('span', { class: 'muted small', text: ' (.txt .mat .sgf .xg, and the files of one match with the same name)' }));
  ui.input = h('input', { type: 'file', id: 'files', multiple: true, accept: '.mat,.txt,.sgf,.xg,.json', class: 'visually-hidden', onchange: async () => { await check(await readFiles(ui.input.files)); ui.input.value = ''; } });
  for (const ev of ['dragenter', 'dragover']) ui.drop.addEventListener(ev, (e) => { e.preventDefault(); ui.drop.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) ui.drop.addEventListener(ev, (e) => { e.preventDefault(); ui.drop.classList.remove('over'); });
  ui.drop.addEventListener('drop', async (e) => { await check(await readFiles(e.dataTransfer.files)); });
  ui.paste = h('textarea', { id: 'paste', rows: '8', placeholder: 'Paste the text of a match here', spellcheck: 'false' });
  const pasteBox = h('details', { class: 'paste' }, h('summary', { text: 'Or paste a match' }), h('label', { for: 'paste', class: 'visually-hidden', text: 'Match text' }), ui.paste,
    h('button', { type: 'button', text: 'Check the pasted text', onclick: () => check([{ name: 'pasted.txt', bytes: new TextEncoder().encode(ui.paste.value) }]) }));
  ui.summary = h('p', { role: 'status', 'aria-live': 'polite', class: 'summary' });
  ui.results = h('div', { class: 'results' });

  ui.rights = h('input', { type: 'checkbox', id: 'rights', onchange: refreshActions });
  ui.zip = h('button', { type: 'button', class: 'primary big', text: 'Download the ZIP', disabled: true, onclick: zipNow });
  ui.zipWhy = h('p', { class: 'muted small', role: 'status', 'aria-live': 'polite' });
  ui.done = h('p', { role: 'status', 'aria-live': 'polite', class: 'done-note' });
  ui.form = h('a', { class: 'button primary big', target: '_blank', rel: 'noopener noreferrer', text: 'Open the submission form', 'aria-disabled': 'true',
    onclick: (e) => { if (ui.form.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; } S.opened = true; refreshActions(); } });
  ui.formWhy = h('p', { class: 'muted small', role: 'status', 'aria-live': 'polite' });
  const licence = S.data.registry.license === 'CC0-1.0' ? 'CC0 public-domain dedication' : `licence of the database (${S.data.registry.license})`;

  ui.keyInput = h('input', { type: 'file', id: 'key-file', accept: '.txt,text/plain', class: 'visually-hidden', onchange: async () => { if (ui.keyInput.files[0]) await loadKeyFile(ui.keyInput.files[0]); ui.keyInput.value = ''; } });
  ui.keyNote = h('p', { class: 'muted small', role: 'status', 'aria-live': 'polite' });
  ui.keyBody = h('div', { class: 'key-body' });
  ui.keyWhy = h('details', { class: 'key-why', ontoggle: () => renderKey() }, h('summary', { text: 'Why a key?' }));
  const bodies = {
    key: [ui.keyWhy, ui.keyBody],
    check: [ui.drop, ui.input, pasteBox, ui.summary, ui.results],
    zip: [h('p', { class: 'rights' }, ui.rights, ' ', h('label', { for: 'rights', text: `I have the right to share these matches under the ${licence}.` })),
      h('div', { class: 'actions' }, ui.zip), ui.zipWhy, ui.done],
    form: [h('div', { class: 'actions' }, ui.form), ui.formWhy],
  };
  ui.steps = STEPS.map((st, i) => stepSection(st, i + 1, { body: bodies[st.id] ?? [], pictures: 'open' }));
  ui.keyText = [...ui.steps[STEPS.findIndex((st) => st.id === 'key')].children].filter((e) => e.tagName === 'P');
  main.append(
    h('h2', { text: 'Contribute a match' }),
    h('p', { class: 'lead' }, `${['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight'][STEPS.length] ?? STEPS.length} steps, a few minutes. Want to see them all first, with pictures? `, h('a', { href: 'guide.html', text: 'How to contribute' }), '.'),
    accountNotice(), ...ui.steps);
  const kept = storedKey();
  if (kept) { S.key = kept; S.keyMode = 'saved'; S.keySaved = true; }  // the step shrinks to one line: the key was made on an earlier visit
  renderKey();
  refreshActions();
}

async function main() {
  const loading = document.getElementById('loading');
  try { S.data = await loadAll({ base: document.baseURI }); } catch (e) {
    loading.className = 'error';
    loading.textContent = `The database could not be loaded (${e.message}). The check needs it to recognise matches that are already there.`;
    return;
  }
  loading.remove();
  document.getElementById('app').hidden = false;
  document.title = `Contribute – ${S.data.registry.name}`;
  document.querySelector('#site-name a').textContent = S.data.registry.name;
  S.config = { videoHosts: S.data.registry.videoHosts, sealPolicy: S.data.registry.sealPolicy };
  S.known = knownFromRows(S.data.rows);
  build();
}

main();
