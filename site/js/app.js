/**
 * BGDB site, version 0 (milestone M3): search and list the matches, show a match page.
 * Plain ES modules, no framework, no build step. Everything comes from static files next to this page.
 * Data is only ever put into the page with textContent / setAttribute (never innerHTML).
 */
import { loadAll, fetchJson, fetchText, suggestPlayers, suggestEvents } from './catalog.js';
import { parseQuery, formatQuery, makePredicate, currentToken, quote, FLAG_BITS, FLAG_LABELS, FLAG_HELP } from './query.js';
import { h, download } from './dom.js';
import { createReplay } from './replay.js';
import {
  lengthText, dateText, timeLabel, safeVideoUrl, parseMatchId, matchFiles, attachmentUrl,
  HOW_TEXT, KIND_TEXT, resultText, rulesText, LICENSE_LINKS,
} from './format.js';

const PAGE_SIZE = 50;

const S = { data: null, results: [], page: 1, lastHash: null, current: null, fromList: false, replay: null };
const ui = {};

// ---------------------------------------------------------------- start

async function main() {
  const loading = document.getElementById('loading');
  const app = document.getElementById('app');
  try {
    S.data = await loadAll({ base: document.baseURI });
  } catch (e) {
    loading.className = 'error';
    loading.removeAttribute('role');
    loading.textContent = location.protocol === 'file:'
      ? 'This page must be opened through a web server, not as a file. Run "npm run build" then "npm run serve" and open localhost:8080 in your browser.'
      : `The database could not be loaded (${e.message}).`;
    return;
  }
  loading.remove();
  app.hidden = false;
  const reg = S.data.registry;
  document.title = reg.name;
  document.querySelector('#site-name a').textContent = reg.name;
  buildList(app);
  buildMatchView(app);
  buildFooter();
  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);
  route();
}

// ---------------------------------------------------------------- URL state

const encodeQ = (q) => encodeURIComponent(q).replace(/%3A/gi, ':').replace(/%2C/gi, ',').replace(/%20/g, '+');

function listHash() {
  const parts = [];
  if (ui.input.value.trim()) parts.push(`q=${encodeQ(ui.input.value.trim())}`);
  if (S.page > 1) parts.push(`p=${S.page}`);
  return parts.join('&');
}

/** write the list state into the address bar without adding history entries while typing */
function writeListHash(push) {
  const hash = listHash();
  const url = hash ? `#${hash}` : location.pathname + location.search;
  if (push) history.pushState(null, '', url); else history.replaceState(null, '', url);
  S.lastHash = location.hash.slice(1);
}

function route() {
  const hash = location.hash.slice(1);
  if (hash === S.lastHash && S.current !== undefined && S.rendered) return;
  S.lastHash = hash;
  S.rendered = true;
  const params = new URLSearchParams(hash);
  const m = params.get('m');
  if (m && m === S.current && S.replay) { S.replay.goto(parseInt(params.get('g') ?? '1', 10) || 1, parseInt(params.get('t') ?? '0', 10) || 0); return; }
  if (m) { showMatch(m); return; }
  S.replay?.destroy();
  S.replay = null;
  S.current = null;
  ui.viewMatch.hidden = true;
  ui.viewList.hidden = false;
  document.title = S.data.registry.name;
  ui.input.value = params.get('q') ?? '';
  S.page = Math.max(1, parseInt(params.get('p') ?? '1', 10) || 1);
  syncControls(parseQuery(ui.input.value));
  runSearch(false);
}

// ---------------------------------------------------------------- list view

function buildList(app) {
  const { data } = S;
  ui.viewList = h('section', { 'aria-label': 'Search' });
  app.append(ui.viewList);

  ui.input = h('input', {
    id: 'q', type: 'search', autocomplete: 'off', spellcheck: 'false', role: 'combobox',
    placeholder: 'player:smith year:2019..2024 len:7 has:video', 'aria-controls': 'suggest', 'aria-expanded': 'false', 'aria-autocomplete': 'list',
  });
  ui.suggest = h('ul', { id: 'suggest', class: 'suggest', role: 'listbox', hidden: true });
  const clear = h('button', { type: 'button', text: 'Clear', onclick: () => { ui.input.value = ''; closeSuggest(); onQueryChanged(); ui.input.focus(); } });
  const form = h('form', { class: 'search', role: 'search', onsubmit: (e) => { e.preventDefault(); closeSuggest(); } },
    h('div', { class: 'search-box' }, h('label', { for: 'q', class: 'visually-hidden', text: 'Search matches' }), ui.input, ui.suggest), clear);
  ui.viewList.append(form);

  // filter controls: they only rewrite the query text
  const [minY, maxY] = data.years;
  ui.yf = h('input', { id: 'yf', type: 'number', inputmode: 'numeric', placeholder: minY ?? '', min: minY ?? '', max: maxY ?? '', onchange: onControl });
  ui.yt = h('input', { id: 'yt', type: 'number', inputmode: 'numeric', placeholder: maxY ?? '', min: minY ?? '', max: maxY ?? '', onchange: onControl });
  ui.len = h('select', { id: 'len', onchange: onControl },
    h('option', { value: '', text: 'Any' }), h('option', { value: 'money', text: 'Money game' }),
    data.lengths.filter((l) => l > 0).map((l) => h('option', { value: String(l), text: `${l} points` })));
  ui.event = h('select', { id: 'ev', onchange: onControl }, h('option', { value: '', text: 'Any' }), data.events.map((e) => h('option', { value: e, text: e })));
  ui.flags = {};
  const flagBoxes = Object.keys(FLAG_BITS).map((k) => {
    ui.flags[k] = h('input', { type: 'checkbox', id: `f-${k}`, onchange: onControl });
    return h('label', { for: `f-${k}`, title: FLAG_HELP[k] }, ui.flags[k], FLAG_LABELS[k]);
  });
  ui.details = h('details', { class: 'filters' },
    h('summary', { text: 'Filters' }),
    h('div', { class: 'filter-grid' },
      minY !== null ? h('div', {}, h('label', { for: 'yf', text: 'Year' }), h('div', { class: 'year-pair' }, ui.yf, '–', ui.yt)) : null,
      h('div', {}, h('label', { for: 'len', text: 'Match length' }), ui.len),
      data.events.length ? h('div', {}, h('label', { for: 'ev', text: 'Event' }), ui.event) : null,
      h('fieldset', { class: 'flags' }, h('legend', { text: 'Only matches where' }), h('div', { class: 'flag-list' }, flagBoxes))));
  ui.viewList.append(ui.details);

  ui.errors = h('p', { class: 'notice', hidden: true, role: 'status' });
  ui.loadErrors = data.errors.length ? h('p', { class: 'notice', text: data.errors.join(' ') }) : null;
  ui.count = h('p', { role: 'status', 'aria-live': 'polite' });
  ui.status = h('div', { class: 'status' }, ui.count, h('span', { class: 'muted', text: `${data.rows.length} matches · ${data.players.length} players` }));
  ui.tbody = h('tbody');
  ui.table = h('div', { class: 'table-wrap' }, h('table', {},
    h('caption', { class: 'visually-hidden', text: 'Matches, newest first' }),
    h('thead', {}, h('tr', {},
      h('th', { scope: 'col', text: 'Date' }), h('th', { scope: 'col', text: 'Players' }), h('th', { scope: 'col', class: 'num hide-sm', text: 'Length' }),
      h('th', { scope: 'col', class: 'num hide-sm', text: 'Games' }), h('th', { scope: 'col', class: 'hide-sm', text: 'Event' }), h('th', { scope: 'col', class: 'hide-sm', text: 'Round' }), h('th', { scope: 'col', class: 'hide-sm', text: 'Tags' }))),
    ui.tbody));
  ui.empty = h('div', { class: 'empty', hidden: true });
  ui.pager = h('nav', { class: 'pager', 'aria-label': 'Pages' });
  ui.viewList.append(ui.errors, ...(ui.loadErrors ? [ui.loadErrors] : []), ui.status, ui.table, ui.empty, ui.pager);

  let timer = null;
  ui.input.addEventListener('input', () => {
    updateSuggest();
    clearTimeout(timer);
    timer = setTimeout(onQueryChanged, 120);
  });
  ui.input.addEventListener('keydown', onSuggestKey);
  ui.input.addEventListener('blur', () => setTimeout(closeSuggest, 150));
}

function onQueryChanged() {
  S.page = 1;
  syncControls(parseQuery(ui.input.value));
  runSearch(true);
  writeListHash(false);
}

function onControl() {
  const f = parseQuery(ui.input.value);
  const a = ui.yf.value ? parseInt(ui.yf.value, 10) : null;
  const b = ui.yt.value ? parseInt(ui.yt.value, 10) : null;
  f.year = a === null && b === null ? null : { min: a, max: b };
  f.len = ui.len.value === '' ? null : ui.len.value === 'money' ? { min: 0, max: 0 } : { min: +ui.len.value, max: +ui.len.value };
  f.event = ui.event.value ? [ui.event.value] : [];
  f.has = Object.keys(FLAG_BITS).filter((k) => ui.flags[k].checked);
  ui.input.value = formatQuery(f);
  onQueryChanged();
}

function syncControls(f) {
  ui.yf.value = f.year && f.year.min !== null ? f.year.min : '';
  ui.yt.value = f.year && f.year.max !== null ? f.year.max : '';
  ui.len.value = !f.len ? '' : (f.len.min === 0 && f.len.max === 0) ? 'money' : (f.len.min === f.len.max ? String(f.len.min) : '');
  if (![...ui.len.options].some((o) => o.value === ui.len.value)) ui.len.value = '';
  ui.event.value = f.event.length === 1 && S.data.events.includes(f.event[0]) ? f.event[0] : '';
  for (const k of Object.keys(FLAG_BITS)) ui.flags[k].checked = f.has.includes(k);
  if (f.year || f.len || f.event.length || f.has.length) ui.details.open = true;
}

function runSearch(resetPage) {
  const f = parseQuery(ui.input.value);
  S.results = S.data.rows.filter(makePredicate(f));
  if (resetPage) S.page = 1;
  const pages = Math.max(1, Math.ceil(S.results.length / PAGE_SIZE));
  if (S.page > pages) S.page = pages;
  ui.errors.hidden = f.errors.length === 0;
  ui.errors.textContent = f.errors.length ? `Some of the search was not understood: ${f.errors.join('; ')}.` : '';
  renderResults();
}

function badge(text, cls, title) { return h('span', { class: `badge${cls ? ` ${cls}` : ''}`, title, text }); }

function tagsFor(flags) {
  return Object.keys(FLAG_BITS).filter((k) => flags & FLAG_BITS[k]).map((k) => badge(FLAG_LABELS[k], k === 'analysis' ? 'ok' : '', FLAG_HELP[k]));
}

function renderResults() {
  const total = S.results.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = (S.page - 1) * PAGE_SIZE;
  const slice = S.results.slice(from, from + PAGE_SIZE);
  ui.count.textContent = total === 0 ? 'No match found' : `${total} match${total === 1 ? '' : 'es'}${total > PAGE_SIZE ? `, showing ${from + 1}–${from + slice.length}` : ''}`;

  ui.tbody.replaceChildren(...slice.map((r) => {
    const w0 = r.win === 0;
    const w1 = r.win === 1;
    const link = h('a', { href: `#m=${encodeURIComponent(r.id)}`, onclick: () => { S.fromList = true; } },
      h('span', { class: 'names' },
        h('span', { class: w0 ? 'winner' : '', text: r.p0 || '?' }),
        h('span', { class: 'score', text: `${r.s0}–${r.s1}` }),
        h('span', { class: w1 ? 'winner' : '', text: r.p1 || '?' })));
    return h('tr', {},
      h('td', { class: 'date', text: dateText(r.date) }), h('td', { class: 'players' }, link, r.event || r.round ? h('div', { class: 'muted show-sm event-line', text: [r.event, r.round].filter(Boolean).join(' · ') }) : null, h('div', { class: 'badges show-sm' }, badge(lengthText(r.len), 'ok'), tagsFor(r.flags))),
      h('td', { class: 'num hide-sm', text: lengthText(r.len) }), h('td', { class: 'num hide-sm', text: String(r.games) }),
      h('td', { class: 'hide-sm', text: r.event }), h('td', { class: 'hide-sm', text: r.round }), h('td', { class: 'hide-sm' }, h('div', { class: 'badges' }, tagsFor(r.flags))));
  }));

  const none = total === 0;
  ui.table.hidden = none;
  ui.empty.hidden = !none;
  if (none) {
    ui.empty.replaceChildren(h('p', { text: S.data.rows.length === 0 ? 'The database is empty. Add matches with the inbox, see CONTRIBUTING.md.' : 'Nothing matches this search. Try fewer filters.' }));
  }
  ui.pager.hidden = pages <= 1;
  const go = (p) => { S.page = p; writeListHash(true); renderResults(); ui.status.scrollIntoView({ block: 'start' }); };
  ui.pager.replaceChildren(
    h('button', { type: 'button', text: '← Previous', disabled: S.page <= 1, onclick: () => go(S.page - 1) }),
    h('span', { text: `Page ${S.page} of ${pages}` }),
    h('button', { type: 'button', text: 'Next →', disabled: S.page >= pages, onclick: () => go(S.page + 1) }));
}

// ---------------------------------------------------------------- suggestions

const sugg = { items: [], active: -1 };

function updateSuggest() {
  const tok = currentToken(ui.input.value);
  let items = [];
  if (tok && (tok.key === null || tok.key === 'player' || tok.key === 'vs')) {
    items = suggestPlayers(S.data.players, tok.value).map((p) => ({ label: p.name, extra: `${p.count}`, insert: `player:${quote(p.name)}` }));
  } else if (tok && tok.key === 'event') {
    items = suggestEvents(S.data.events, tok.value).map((e) => ({ label: e, extra: '', insert: `event:${quote(e)}` }));
  }
  sugg.items = items;
  sugg.active = -1;
  if (!items.length) { closeSuggest(); return; }
  ui.suggest.replaceChildren(...items.map((it, i) => h('li', {
    id: `sg-${i}`, role: 'option', 'aria-selected': 'false',
    onmousedown: (e) => { e.preventDefault(); chooseSuggestion(i); },
  }, h('span', { text: it.label }), h('span', { class: 'extra', text: it.extra }))));
  ui.suggest.hidden = false;
  ui.input.setAttribute('aria-expanded', 'true');
}

function closeSuggest() {
  sugg.items = [];
  sugg.active = -1;
  ui.suggest.hidden = true;
  ui.input.setAttribute('aria-expanded', 'false');
  ui.input.removeAttribute('aria-activedescendant');
}

function setActive(i) {
  sugg.active = i;
  [...ui.suggest.children].forEach((li, k) => li.setAttribute('aria-selected', k === i ? 'true' : 'false'));
  if (i >= 0) ui.input.setAttribute('aria-activedescendant', `sg-${i}`); else ui.input.removeAttribute('aria-activedescendant');
}

function chooseSuggestion(i) {
  const it = sugg.items[i];
  const tok = currentToken(ui.input.value);
  if (!it || !tok) return;
  ui.input.value = `${ui.input.value.slice(0, tok.start)}${it.insert} `;
  closeSuggest();
  ui.input.focus();
  onQueryChanged();
}

function onSuggestKey(e) {
  if (ui.suggest.hidden) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); setActive((sugg.active + 1) % sugg.items.length); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((sugg.active - 1 + sugg.items.length) % sugg.items.length); }
  else if (e.key === 'Enter' && sugg.active >= 0) { e.preventDefault(); chooseSuggestion(sugg.active); }
  else if (e.key === 'Escape') { e.preventDefault(); closeSuggest(); }
}

// ---------------------------------------------------------------- match view

function buildMatchView(app) {
  ui.viewMatch = h('section', { 'aria-label': 'Match', hidden: true });
  app.append(ui.viewMatch);
}

async function showMatch(id) {
  S.replay?.destroy();
  S.replay = null;
  S.current = id;
  ui.viewList.hidden = true;
  ui.viewMatch.hidden = false;
  const back = h('a', { class: 'back', href: './', text: '← All matches', onclick: (e) => { if (S.fromList) { e.preventDefault(); history.back(); } } });
  ui.viewMatch.replaceChildren(back, h('p', { role: 'status', text: 'Loading the match…' }));
  const pid = parseMatchId(id);
  const shard = pid && S.data.shards.find((s) => s.id === pid.shard);
  if (!shard) { ui.viewMatch.replaceChildren(back, h('p', { class: 'error', text: 'This match is not in the database (unknown identifier).' })); return; }
  const files = matchFiles(shard.base, pid.hash);
  try {
    const [meta, text] = await Promise.all([fetchJson(files.meta), fetchText(files.mat)]);
    if (S.current !== id) return;
    // the replay data is derived here, from the match file, with the same code as the tools (nothing else is published for it)
    const [{ readMatch }, { toBgdbJson }] = await Promise.all([import('../lib/core/read.js'), import('../lib/core/record.js')]);
    const parsed = readMatch(text);
    if (!parsed.ok) throw new Error(`the match file is damaged: ${parsed.errors[0].message}`);
    const extra = S.data.enrichments[id] ?? { links: [], tags: [], attachments: [] };
    for (const [k, v] of Object.entries(extra.meta ?? {})) parsed.match[k] = v;     // corrections of the event, round or date
    const merged = {
      ...meta,
      ...(extra.meta ?? {}),
      links: [...(meta.links ?? []), ...extra.links.filter((l) => !(meta.links ?? []).some((x) => x.url === l.url && (x.game ?? null) === (l.game ?? null)))],
      tags: [...new Set([...(meta.tags ?? []), ...extra.tags])],
      attachments: [
        ...(meta.attachments ?? []).map((a) => ({ ...a, href: attachmentUrl(shard.base, pid.hash, a.kind) })),
        ...extra.attachments.filter((a) => !(meta.attachments ?? []).some((x) => x.kind === a.kind)).map((a) => ({ ...a, href: a.href ?? new URL(a.url, S.data.registryUrl).href, added: true })),
      ],
    };
    const replay = toBgdbJson(parsed.match, merged);
    ui.viewMatch.replaceChildren(renderMatch(merged, replay, shard, pid.hash, files, id, back));
    const title = ui.viewMatch.querySelector('h2');
    document.title = `${title.textContent} – ${S.data.registry.name}`;
    title.setAttribute('tabindex', '-1');
    title.focus({ preventScroll: false });
  } catch (e) {
    if (S.current === id) ui.viewMatch.replaceChildren(back, h('p', { class: 'error', text: `This match could not be loaded (${e.message}).` }));
  }
}

function dlItem(dt, dd) { return [h('dt', { text: dt }), h('dd', {}, dd)]; }

/** the address of a position of a match: #m=<id>, plus &g=<game>&t=<step> when it is not the first position */
function matchHash(id, g, t) {
  return `#m=${encodeURIComponent(id)}${g > 1 || t > 0 ? `&g=${g}&t=${t}` : ''}`;
}

function renderMatch(meta, replay, shard, hash, files, id, back) {
  const [a, b] = meta.sides;
  const name = (s) => (s.rating ? `${s.name} (${Math.round(s.rating)})` : s.name ?? '?');
  const root = h('article', {});

  // the replay; the link back and the title sit above the move list, so that the board starts at the top of the page
  const p = new URLSearchParams(location.hash.slice(1));
  S.replay = createReplay({
    head: h('div', { class: 'replay-head' }, back, h('h2', { class: 'match-title', text: `${a.name ?? '?'} vs ${b.name ?? '?'}` })),
    replay, meta, initial: { g: parseInt(p.get('g') ?? '1', 10) || 1, t: parseInt(p.get('t') ?? '0', 10) || 0 },
    onChange: ({ g, t }) => { history.replaceState(null, '', matchHash(id, g, t)); S.lastHash = location.hash.slice(1); },
    link: ({ g, t }) => matchHash(id, g, t),
  });
  root.append(S.replay.el);

  const when = [meta.date, meta.time].filter(Boolean).join(' ');
  const lic = meta.provenance.license;
  root.append(h('section', { class: 'card', 'aria-label': 'Details' }, h('dl', { class: 'facts' },
    dlItem('Players', `${name(a)} and ${name(b)}`),
    dlItem('Result', resultText(meta.result, meta.sides, meta.matchLength)),
    dlItem('Length', meta.matchLength === 0 ? 'Money game' : `${meta.matchLength} points`),
    dlItem('Games', String(meta.games.length)),
    when ? dlItem('Date', when) : null,
    meta.event || meta.round ? dlItem('Event', [meta.event, meta.round].filter(Boolean).join(' · ')) : null,
    dlItem('Rules', rulesText(meta.rules)),
    dlItem('Source', [meta.provenance.site, meta.provenance.dialect].filter(Boolean).join(' · ') || '–'),
    meta.provenance.contributor ? dlItem('Added by', `${meta.provenance.contributor}${meta.provenance.submittedAt ? `, ${meta.provenance.submittedAt}` : ''}`) : null,
    lic ? dlItem('Licence', LICENSE_LINKS[lic] ? h('a', { href: LICENSE_LINKS[lic], rel: 'noopener noreferrer', text: lic }) : lic) : null,
    meta.tags?.length ? dlItem('Tags', h('span', { class: 'badges' }, meta.tags.map((t) => badge(t)))) : null)));

  // games
  const gameRows = replay.games.map((g) => {
    const r = g.result;
    const winner = r.winner === 0 ? a.name : b.name;
    return h('tr', {},
      h('td', { class: 'num', text: String(g.index) }), h('td', { class: 'num', text: `${g.startScore[0]}–${g.startScore[1]}` }),
      h('td', { class: 'winner', text: winner ?? '?' }), h('td', { class: 'num', text: String(r.points) }),
      h('td', { text: r.how === 'bearOff' ? `${KIND_TEXT[r.kind] ?? r.kind}, ${HOW_TEXT.bearOff}` : (HOW_TEXT[r.how] ?? r.how) }), h('td', { class: 'num', text: String(r.cube) }),
      h('td', {}, g.crawford ? badge('Crawford') : null));
  });
  root.append(h('section', { class: 'card', 'aria-label': 'Games' }, h('h3', { text: 'Games' }),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Game', 'Score before', 'Winner', 'Points', 'Ended', 'Cube', ''].map((t, i) => h('th', { scope: 'col', class: [0, 1, 3, 5].includes(i) ? 'num' : '', text: t })))),
      h('tbody', {}, gameRows))),
    h('p', { class: 'muted', text: 'Points of a resignation are the value recorded by the source; some sources record them imprecisely.' })));

  // the transcriber's remarks and the illegal plays that were made
  const illegal = meta.illegalPlays ?? [];
  const remarks = meta.remarks ?? [];
  if (illegal.length || remarks.length) {
    root.append(h('section', { class: 'card', 'aria-label': 'Notes' }, h('h3', { text: 'Notes on this transcription' }),
      illegal.length ? h('ul', { class: 'plain' }, illegal.map((p) => h('li', {},
        badge('illegal play', 'warn'),
        h('span', { text: `Game ${p.game}, move ${p.row}: ${p.player ?? 'a player'} played ${p.play}, which is not a legal play. It was made in the match, so it is kept as played and the game goes on from there.` })))) : null,
      remarks.length ? h('ul', { class: 'plain' }, remarks.map((r) => h('li', { class: 'muted', text: r }))) : null));
  }

  // video links
  const videos = (meta.links ?? []).map((l) => ({ l, url: safeVideoUrl(l) })).filter((x) => x.url);
  if (videos.length) {
    root.append(h('section', { class: 'card', 'aria-label': 'Videos' }, h('h3', { text: 'Video' }),
      h('ul', { class: 'plain' }, videos.map(({ l, url }) => h('li', {},
        h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', text: l.title || 'Watch on YouTube' }),
        h('span', { class: 'muted', text: [l.game ? `game ${l.game}` : '', l.time ? `from ${timeLabel(l.time)}` : '', 'opens YouTube'].filter(Boolean).join(' · ') }))))));
  }

  // files
  const atts = (meta.attachments ?? []).filter((x) => x.kind === 'sgf' || x.kind === 'xg');
  root.append(h('section', { class: 'card', 'aria-label': 'Files' }, h('h3', { text: 'Files' }),
    h('ul', { class: 'plain' },
      h('li', {}, h('a', { href: files.mat, download: `${hash}.mat`, text: 'Match file (.mat)' }), h('span', { class: 'muted', text: 'the whole match as text, readable by most backgammon programs' })),
      h('li', {}, h('button', { type: 'button', class: 'linklike', text: 'Replay data (.json)', onclick: () => download(new Blob([JSON.stringify(replay)], { type: 'application/json' }), `${hash}.json`) }), h('span', { class: 'muted', text: 'moves, dice and cube, for programs' })),
      atts.map((x) => h('li', {},
        h('a', { href: x.href, download: `${hash}.${x.kind}`, text: x.kind === 'sgf' ? 'GNU Backgammon file (.sgf)' : 'eXtreme Gammon file (.xg)' }),
        x.added ? badge('added later') : null,
        x.analysis === true ? badge('with analysis', 'ok') : x.analysis === false ? badge('no analysis') : badge('analysis unknown'),
        x.verified ? badge('checked against the match', 'ok') : badge('not checked', 'warn'),
        h('span', { class: 'muted', text: `${Math.max(1, Math.round(x.bytes / 1024))} KB` }))))));

  return root;
}

// ---------------------------------------------------------------- footer

function buildFooter() {
  const reg = S.data.registry;
  const version = reg.shards.map((s) => String(s.manifestHash ?? '').slice(0, 6)).filter(Boolean).join('·');
  const lic = reg.license && LICENSE_LINKS[reg.license]
    ? h('a', { href: LICENSE_LINKS[reg.license], rel: 'noopener noreferrer', text: reg.license }) : (reg.license ?? 'unspecified');
  document.getElementById('footer').replaceChildren(
    `${reg.name} · ${S.data.rows.length} matches in ${S.data.shards.length} shard${S.data.shards.length === 1 ? '' : 's'}${S.data.sources.length > 1 ? ` of ${S.data.sources.length} data repositories` : ''}`,
    version ? ` · data ${version}` : '', ' · data licence: ', lic);
}

main();
