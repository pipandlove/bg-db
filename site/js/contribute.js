/**
 * The "Contribute" page: drop or paste matches, see at once what would happen to them (the same check as the tools, run in the browser,
 * nothing is sent anywhere), add a video link, and hand them over as a ZIP or through GitHub.
 */
import { loadAll } from './catalog.js';
import { h, download, copyText } from './dom.js';
import { makeZip } from './zip.js';
import { prepare, parseExtras, packageFiles, githubLinks, previewReplay, knownFromRows, sendable } from './contribute-model.js';
import { buildGame } from './replay-model.js';
import { boardTree } from './board.js';
import { toDom } from './svg.js';
import { lengthText, parseMatchId } from './format.js';

const S = { data: null, items: [], extras: new Map(), config: null };
const ui = {};

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
    const video = h('input', { type: 'url', id: `video-${i}`, placeholder: 'https://youtu.be/…', autocomplete: 'off', oninput: () => update(item) });
    const tags = h('input', { type: 'text', id: `tags-${i}`, placeholder: 'final, semifinal', autocomplete: 'off', oninput: () => update(item) });
    const note = h('p', { class: 'muted small', role: 'status', 'aria-live': 'polite' });
    item.inputs = { video, tags, note };
    kids.push(h('div', { class: 'extras' },
      h('div', {}, h('label', { for: `video-${i}`, text: 'YouTube link (optional)' }), video),
      h('div', {}, h('label', { for: `tags-${i}`, text: 'Tags (optional)' }), tags), note));
    kids.push(preview(res.match));
  }
  return h('article', { class: `card c-${res.status}` }, kids);
}

/**
 * A match that can only be added partially (decision 0021): what would be kept, what is wrong (to fix it instead), the .mat that would
 * be stored, and the contributor's choice. Nothing is sent unless the box is ticked.
 */
function partialBox(item, i) {
  const { res } = item;
  const accept = h('input', { type: 'checkbox', id: `partial-${i}`, onchange: () => { item.acceptPartial = accept.checked; refreshActions(); } });
  accept.checked = item.acceptPartial === true;
  return h('div', { class: 'partial' },
    h('p', { text: 'Some games cannot be read, but the rest of the match is clear. It can be added like this:' }),
    h('ul', { class: 'diag' }, res.partial.notes.map((n) => h('li', { class: 'warning', text: n.message }))),
    h('p', { class: 'muted small', text: 'Or fix the file, and the whole match will be added:' }),
    h('ul', { class: 'diag' }, res.partial.errors.slice(0, 3).map((e) => h('li', { class: 'error' }, `${e.message}${e.line ? ` (line ${e.line})` : ''}`, e.hint ? h('div', { class: 'muted', text: `How to fix: ${e.hint}` }) : null))),
    h('p', {}, h('button', { type: 'button', text: 'Download the match as it would be stored (.mat)', onclick: () => download(new Blob([res.normalised], { type: 'text/plain' }), `${item.base}.mat`) }),
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

function refreshActions() {
  const c = counts();
  const ok = c.send > 0 && ui.rights.checked;
  ui.zip.disabled = !ok;
  const links = githubLinks(S.data.registry, S.items, S.items.find(sendable)?.res.text ?? '', ui.login.value.trim());
  ui.steps.hidden = c.send === 0;
  ui.upload.hidden = !links;
  ui.github.hidden = !links;
  if (links) {
    ui.fork.href = links.fork;
    // the upload page of the contributor's own copy: GitHub refuses uploads into a repository one cannot write to
    if (links.upload) ui.upload.href = links.upload; else ui.upload.removeAttribute('href');
    const up = ok && !!links.upload;
    ui.upload.setAttribute('aria-disabled', up ? 'false' : 'true');
    ui.upload.classList.toggle('disabled', !up);
    ui.uploadWhy.textContent = links.uploadWhy ?? '';
    ui.issue.hidden = false;
    if (links.issue) { ui.issue.href = links.issue; ui.issue.removeAttribute('aria-disabled'); ui.issue.classList.toggle('disabled', !ok); ui.issueWhy.textContent = ''; }
    else { ui.issue.removeAttribute('href'); ui.issue.setAttribute('aria-disabled', 'true'); ui.issue.classList.add('disabled'); ui.issueWhy.textContent = links.issueWhy ?? ''; }
  }
}

function showResults() {
  const c = counts();
  ui.results.replaceChildren(...S.items.map(card));
  ui.summary.textContent = S.items.length === 0 ? '' : `${S.items.length} match${S.items.length === 1 ? '' : 'es'} checked: ${c.new} new, ${c.partial ? `${c.partial} can be added partially, ` : ''}${c.duplicate} already in the database, ${c.error} need${c.error === 1 ? 's' : ''} a fix.`;
  ui.send.hidden = S.items.length === 0;
  for (const it of S.items) if (it.res.status === 'new' || it.res.status === 'partial') update(it);
  refreshActions();
}

async function check(files) {
  if (!files.length) return;
  ui.summary.textContent = 'Checking…';
  S.items = prepare(files, { config: S.config, known: S.known });
  S.extras = new Map();
  showResults();
}

function zipNow() {
  const files = packageFiles(S.items, (base) => S.extras.get(base), S.data.registry.license);
  if (!files.length) return;
  download(new Blob([makeZip(files)], { type: 'application/zip' }), 'matches-for-bgdb.zip');
  ui.done.textContent = `The ZIP has ${files.length - 1} file${files.length - 1 === 1 ? '' : 's'}. Next: ${ui.upload.hidden ? 'put it in the inbox folder of your copy of the repository and open a pull request' : 'open the upload page of your copy and drop the ZIP there, as it is'}.`;
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
  ui.zip = h('button', { type: 'button', class: 'primary', text: 'Download the files (ZIP)', disabled: true, onclick: zipNow });
  ui.upload = h('a', { class: 'button', target: '_blank', rel: 'noopener noreferrer', text: 'Open the upload page of your copy', hidden: true });
  ui.fork = h('a', { class: 'button', target: '_blank', rel: 'noopener noreferrer', text: 'Make your copy (fork), first time only' });
  // the GitHub name is remembered in this browser only, for the next visit
  let saved = '';
  try { saved = localStorage.getItem('bgdb.githubLogin') ?? ''; } catch { /* storage blocked: the field starts empty */ }
  ui.login = h('input', { type: 'text', id: 'login', value: saved, autocomplete: 'username', spellcheck: 'false', placeholder: 'your-github-name', size: '20',
    oninput: () => { try { localStorage.setItem('bgdb.githubLogin', ui.login.value.trim()); } catch { /* not remembered */ } refreshActions(); } });
  ui.uploadWhy = h('p', { class: 'muted small' });
  ui.github = h('div', { class: 'actions', hidden: true }, ui.fork, h('label', { for: 'login', text: 'Your GitHub name: ' }), ui.login);
  ui.issue = h('a', { class: 'button', target: '_blank', rel: 'noopener noreferrer', text: 'Send as a GitHub issue (one match)', hidden: true });
  ui.issueWhy = h('p', { class: 'muted small' });
  ui.done = h('p', { role: 'status', 'aria-live': 'polite' });
  ui.steps = h('ol', { class: 'steps' },
    h('li', {}, 'Tick the box, then download the files (ZIP).'),
    h('li', {}, 'GitHub lets you upload only into your own copy of the database: the first time, make it with "Make your copy (fork)", then type your GitHub name.'),
    h('li', {}, 'Open the upload page of your copy, drop the ZIP in (as it is, or its files), choose "Create a new branch for this commit and start a pull request", and press "Propose changes". On the next page, check that the pull request goes to the database repository and press "Create pull request".'),
    h('li', {}, 'A bot checks it again within minutes and merges it automatically if everything is fine.'));
  ui.send = h('section', { class: 'card send', hidden: true, 'aria-label': 'Send' },
    h('h3', { text: 'Send them' }),
    h('p', {}, ui.rights, ' ', h('label', { for: 'rights', text: `I have the right to share these matches under the ${S.data.registry.license === 'CC0-1.0' ? 'CC0 public-domain dedication' : `licence of the database (${S.data.registry.license})`}.` })),
    ui.steps, h('div', { class: 'actions' }, ui.zip), ui.github, h('div', { class: 'actions' }, ui.upload, ui.issue), ui.uploadWhy, ui.issueWhy, ui.done);

  main.append(
    h('h2', { text: 'Contribute a match' }),
    h('p', { class: 'muted', text: 'Drop the files of your matches. They are checked here, in your browser, with the same rules as the database: nothing is sent anywhere until you choose to. You will see what would happen to each one, and can fix problems before sending.' }),
    ui.drop, ui.input, pasteBox, ui.summary, ui.results, ui.send);
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
