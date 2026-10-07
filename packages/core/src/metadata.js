/**
 * Descriptive metadata of a match (event, round, date): what the headers say once cleaned, what the file name suggests, and whether the
 * matches of a set can be told apart (decision 0022, spec CTB-13).
 *
 *   cleanHeaderMetadata  applied automatically: placeholders dropped ("Online match", "Round 0"), the event taken from a Site tag that
 *                        names a server and an event ("Galaxy Backgammon River Cup Final 2025")
 *   nameMetadata         a proposal read from the file name ("... 3. Match ... River Cup Final", "#2", "1v5", "QF3-Match1"); never applied
 *                        without review: it goes to the review sheet of `bgdb meta`, and the reviewed values to the .bgdb.json sidecar
 *   planMetadata         the review: proposals for a set of files, and the groups of matches that nothing tells apart
 *
 * None of this enters the identity of a match (spec ID-02).
 */
import { normalizeName } from './names.js';

/** servers and programs that write their own name in the Site tag: that is the source of the file, not an event */
const SERVERS = [
  'backgammon studio', 'gamesgrid games server', 'gamesgrid', 'gridgammon', 'extreme gammon', 'xg mobile', 'backgammongalaxy',
  'backgammon galaxy', 'galaxy backgammon', 'play\\.backgammongalaxy\\.com', 'playok', 'opengammon', 'foxamon', 'choue\\.net', 'choue',
  'bgdb', 'fibs', 'dailygammon', 'gnu backgammon', 'gnubg', 'bgnj(?:-v[\\d.]+)?', 'bgblitz', 'heroes', 'safe harbor games',
];
const SERVER_RE = new RegExp(`^(?:${SERVERS.join('|')})$`, 'i');
const SERVER_PREFIX_RE = new RegExp(`^(?:${SERVERS.join('|')})(?=[\\s:,;/-])`, 'i');
const SERVER_SUFFIX_RE = new RegExp(`(?<=[\\s:,;/-])(?:${SERVERS.join('|')})$`, 'i');
const SERVER_ANY_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${SERVERS.join('|')})(?![\\p{L}\\p{N}])`, 'giu');

const EVENT_PLACEHOLDER = /^(?:online match|unknown|none|n\/?a|event|-+|\?+)$/i;
const ROUND_PLACEHOLDER = /^(?:(?:round\s*)?0|unknown|none|n\/?a|-+|\?+)$/i;

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const hasWord = (s) => /\p{L}{3,}/u.test(s);

/**
 * What a Site tag says: a server ("Backgammon Studio"), a server plus an event ("Galaxy Backgammon  River Cup Final 2025": the event is
 * "River Cup Final 2025"), or something else (often a place: "Monte Carlo", "Tokyo, Japan"), which may be the event but is not taken as such.
 * @returns {{kind:'none'|'server'|'event'|'place', value?:string}}
 */
export function siteEvent(site) {
  const s = clean(site);
  if (!s) return { kind: 'none' };
  if (SERVER_RE.test(s)) return { kind: 'server' };
  for (const re of [SERVER_PREFIX_RE, SERVER_SUFFIX_RE]) {
    if (re.test(s)) {
      const rest = clean(s.replace(re, '').replace(/^[\s:,;/-]+|[\s:,;/-]+$/g, ''));
      if (hasWord(rest)) return { kind: 'event', value: rest };
      return { kind: 'server' };
    }
  }
  return { kind: 'place', value: s };
}

/**
 * The event and round of a match as its headers give them, cleaned. Applied automatically by `analyzeGroup`.
 * @returns {{event:string|null, round:string|null, notes:string[]}}
 */
export function cleanHeaderMetadata(match) {
  const notes = [];
  let event = clean(match.event) || null;
  let round = clean(match.round) || null;
  if (event && EVENT_PLACEHOLDER.test(event)) { notes.push(`The event "${event}" says nothing about the match: it was left out`); event = null; }
  if (round && ROUND_PLACEHOLDER.test(round)) { notes.push(`The round "${round}" says nothing about the match: it was left out`); round = null; }
  if (!event) {
    const se = siteEvent(match.provenance?.site);
    if (se.kind === 'event') { event = se.value; notes.push(`The event "${event}" was taken from the Site tag`); }
  }
  return { event, round, notes };
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');
const validDate = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const B = '(?<!\\p{L})';             // word boundaries that know accents ("1990Smith" holds the name Smith)
const E = '(?!\\p{L})';

const STAGES = [
  [/(?<![\p{L}\p{N}])quarter[\s_-]?finals?(?:[\s_-]*(\d{1,2}))?(?![\p{L}])/iu, (m) => `Quarter-final${m[1] ? ` ${m[1]}` : ''}`],
  [/(?<![\p{L}\p{N}])QF(\d{1,2})?(?![\p{L}])/iu, (m) => `Quarter-final${m[1] ? ` ${m[1]}` : ''}`],
  [/(?<![\p{L}\p{N}])semi[\s_-]?finals?(?:[\s_-]*(\d{1,2}))?(?![\p{L}])/iu, (m) => `Semi-final${m[1] ? ` ${m[1]}` : ''}`],
  [/(?<![\p{L}\p{N}])SF(\d{1,2})?(?![\p{L}])/iu, (m) => `Semi-final${m[1] ? ` ${m[1]}` : ''}`],
  [/(?<![\p{L}\p{N}])final[es]?(?![\p{L}\p{N}])/iu, () => 'Final'],
  [/(?<![\p{L}\p{N}])round[\s_-]*of[\s_-]*(\d{1,3})(?![\p{N}])/iu, (m) => `Round of ${m[1]}`],
  [/(?<![\p{L}\p{N}])round[\s_-]*(\d{1,2})(?![\p{N}])/iu, (m) => `Round ${m[1]}`],
  [/(?<![\p{L}\p{N}])(\d{1,2})(?:st|nd|rd|th)?[\s_-]*round(?![\p{L}])/iu, (m) => `Round ${m[1]}`],
  [/(?<![\p{L}\p{N}])R(\d{1,2})(?![\p{L}\p{N}])/iu, (m) => `Round ${m[1]}`],
  [/(?<![\p{L}\p{N}])(\d{1,2})R(?![\p{L}\p{N}])/u, (m) => `Round ${m[1]}`],
];

/** words of a file name that are never an event */
const NOISE = /(?<![\p{L}\p{N}])(?:v|vs|versus|match(?:es)?|point|points|pnts?|pts?|ptr|game|games|xg\d?|xghuge|xgroller|fixed|merged|copy|file|bmab match file|doublingcube|money|unrated|rated)(?![\p{L}\p{N}])/giu;

/**
 * What a file name suggests about the match: event, round (with the number of the match in a series), date. A proposal only.
 * @param {string} base the file name without its extension
 * @param {{sides?:{name:string}[]}} [match] the players' names are removed from the name before it is read
 * @returns {{event:string|null, round:string|null, date:string|null, time:string|null, n:number|null, of:number|null, stage:string|null}}
 */
export function nameMetadata(base, match) {
  let s = ` ${String(base)} `;
  const take = (re, f) => { const m = s.match(re); if (m) { s = s.replace(m[0], ' '); f(m); } return !!m; };
  let n = null;
  let of = null;
  let date = null;
  let time = null;
  let year = null;
  let stage = null;

  // the players' names (whole, then word by word); done again once "ThomasSmithFinal" has been split into words
  const removePlayers = () => {
    s = s.normalize('NFD').replace(/\p{Diacritic}/gu, '').normalize('NFC');
    for (const side of match?.sides ?? []) {
      const words = normalizeName(side.name).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
      if (!words.length) continue;
      s = s.replace(new RegExp(`${B}${words.map(escapeRe).join('[\\s_.-]*')}${E}`, 'giu'), ' ');
      for (const w of words) if (w.length >= 3) s = s.replace(new RegExp(`${B}${escapeRe(w)}${E}`, 'giu'), ' ');
    }
  };

  s = s.replace(/_(?:1[2-9]\d{8})(?!\d)/g, ' ');                                   // the time stamp the archive added to each upload
  removePlayers();
  s = s.replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2').replace(/(\p{L})(\d{1,2}\s?(?:pts?|pnts?|points?)(?!\p{L}))/giu, '$1 $2');   // "BanseiSemiFinal", "Ghodsi17Pts"
  removePlayers();
  s = s.replace(/\(\d\)\s*$/, ' ');                                                 // "name (1)": a second download
  s = s.replace(/\(\s*\d+[.,]\d+\s*\)/g, ' ');                                      // ratings "(2.54)"
  take(/(?<!\d)(\d{1,2})\s*of\s*(\d{1,2})(?!\d)/i, (m) => { n = +m[1]; of = +m[2]; });
  take(/(?<![\p{L}\d])(\d{1,2})v(\d{1,2})(?!\d)/u, (m) => { n = +m[1]; of = +m[2]; });

  // dates (and a time next to them): the first full date found is kept
  const hm = (h, m) => (h !== undefined && +h < 24 && +m < 60 ? `${h}:${m}` : null);
  const dateRes = [
    [/(?<!\d)((?:19|20)\d{2})[-_.]\s?(\d{2})[-_.]\s?(\d{2})\.?(?:[\sT_-]+(\d{2})[-_.:](\d{2})(?:[-_.:]\d{2})?)?(?!\d)/, (m) => [validDate(m[1], +m[2], +m[3]), hm(m[4], m[5])]],
    [/(?<!\d)(\d{2})[._-](\d{2})[._-]((?:19|20)\d{2})(?!\d)/, (m) => [validDate(m[3], +m[2], +m[1]), null]],
    [/(?<!\d)((?:19|20)\d{2})(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(\d{2})(?:(\d{2})(\d{2}))?(?!\d)/i, (m) => [validDate(m[1], MONTHS[m[2].toLowerCase()], +m[3]), hm(m[4], m[5])]],
    [/(?<!\d)((?:19|20)\d{2})(\d{2})(\d{2})(?:-?(\d{2})(\d{2})(?:\d{2})?)?(?!\d)/, (m) => [validDate(m[1], +m[2], +m[3]), hm(m[4], m[5])]],
  ];
  for (const [re, f] of dateRes) {
    for (;;) {
      const m = s.match(re);
      if (!m) break;
      const [d, t] = f(m);
      if (!d) break;
      if (!date) { date = d; time = t; }
      s = s.replace(m[0], ' ');
    }
  }
  s = s.replace(/(?<![\p{L}\d])match\s?\d{5,}(?!\d)/giu, ' ');                     // a server's match number
  s = s.replace(/^\s*(?!(?:19|20)\d{2}(?!\d))\d{4,6}(?=[\s_-])/, ' ');               // an archive's own number in front (not a year)
  s = s.replace(/(?<![\p{L}\p{N}])\p{Lu}{1,3}\s+won(?![\p{L}])/gu, ' ');                 // "JL won": who won, by initials
  s = s.replace(/(?<![\p{L}\d])\d{1,2}\s*-?\s*(?:pt|pts|pnts?|points?|ptr|p)(?:\s*match(?![\s_-]*#?\d))?(?![\p{L}])/giu, ' ');   // the length
  s = s.replace(SERVER_ANY_RE, ' ');

  // the number of the match in a series
  take(/(?<!\d)(\d{1,2})\s*\.\s*match(?![\p{L}])/iu, (m) => { n ??= +m[1]; });
  take(/(?<![\p{L}])match[\s_-]*#?(\d{1,2})(?!\d)/iu, (m) => { n ??= +m[1]; });
  take(/#\s*(\d{1,2})(?!\d)/, (m) => { n ??= +m[1]; });
  take(/(?<![\p{L}\p{N}])(\d{1,2})(?:st|nd|rd|th)[\s_-]*match(?![\p{L}])/iu, (m) => { n ??= +m[1]; });
  take(/(?<![\p{L}\p{N}])M(\d{1,2})(?![\p{L}\p{N}])/iu, (m) => { n ??= +m[1]; });
  take(/(?<!\d)(\d{1,2})M(?![\p{L}\p{N}])/u, (m) => { n ??= +m[1]; });
  if (n === null) take(/^\s*(\d{1,2})(?:\s*[_.-]\s*|\s+)(?=\D)/, (m) => { n = +m[1]; });
  // a number (or "2nd") at the very end: the number of the match, unless it is the length
  if (n === null) {
    const m = s.match(/[\s_-](\d{1,2})(?:st|nd|rd|th)?\s*$/i);
    if (m && +m[1] !== match?.matchLength) { s = s.replace(m[0], ' '); n = +m[1]; }
  }

  for (const [re, f] of STAGES) if (!stage) take(re, (m) => { stage = f(m); });

  // what is left may be the event: separators become spaces, noise words and lone numbers go
  let rest = s.replace(/[_-]+/g, ' ').replace(NOISE, ' ').replace(/[()[\]{}]/g, ' ');
  const y = rest.match(/(?<!\d)((?:19|20)\d{2})(?!\d)/);
  if (y) year = y[1];
  rest = rest.replace(/(?<![\p{L}\p{N}])(?!(?:19|20)\d{2}(?!\d))\d{1,6}(?![\p{L}\p{N}])/gu, ' ');   // lone numbers (not a year)
  rest = clean(rest.replace(/^[\s,;:.&+-]+|[\s,;:.&+-]+$/g, ''));
  let event = hasWord(rest) ? rest : null;
  if (event && year) event = clean(`${event.replace(new RegExp(`(?<!\\d)${year}(?!\\d)`), ' ')} ${year}`);   // "1990 Boston" -> "Boston 1990"
  date ??= year;

  let round = null;
  if (n !== null) round = `${stage ? `${stage} - ` : ''}Match ${n}${of ? ` of ${of}` : ''}`;
  else if (stage) round = stage;
  return { event, round, date, time, n, of, stage };
}

/** what the list of matches shows to tell matches apart: the players, the date, the event, the round, the length */
export function displayKey(m) {
  const players = (m.players ?? m.sides?.map((s) => s.name) ?? []).map(normalizeName).sort().join(' / ');
  return [players, m.date ?? '', normalizeName(m.event ?? ''), normalizeName(m.round ?? ''), m.matchLength ?? m.len ?? ''].join(' | ');
}

/**
 * The review of a set of files: for each, the metadata after the automatic cleaning, what its name proposes, and whether it can be told
 * apart from the others (and from the matches already stored).
 * @param {{file:string, base:string, players:string[], matchLength:number, date:string|null, time?:string|null, event:string|null, round:string|null,
 *          name?:object, moves?:string}[]} items  the current metadata of each file (headers cleaned, sidecar applied); `name` = nameMetadata of its
 *          file name; `moves` = a fingerprint of its moves (the text without its header lines): two files with the same one are copies
 * @param {{id:string, players:string[], matchLength:number, date:string|null, event:string|null, round:string|null}[]} [stored]
 * @returns {{rows:object[], groups:number}} rows: {status, group, file, players, date, time, matchLength, event, round, current, from, note}
 *   status "same": nothing tells it apart from another match (the round must be given); "series": it is part of a group that looked the same,
 *   and the proposal tells them apart; "name": its name only fills in something the headers do not give; "duplicate": the same moves as
 *   another file (the ingest stores one of them and skips the others: nothing to do)
 */
export function planMetadata(items, stored = []) {
  // copies first: they are one match, not matches to tell apart
  const firstByMoves = new Map();
  const copies = [];
  const originals = [];
  for (const it of [...items].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))) {
    const first = it.moves ? firstByMoves.get(it.moves) : undefined;
    if (first) copies.push({ it, of: first.file });
    else { if (it.moves) firstByMoves.set(it.moves, it); originals.push(it); }
  }
  const plans = originals.map((it) => {
    const nm = it.name ?? { event: null, round: null, date: null, n: null };
    const from = [];
    const p = { event: it.event, round: it.round, date: it.date };
    if (!p.event && nm.event) { p.event = nm.event; from.push('event from the file name'); }
    if (!p.round && nm.round) { p.round = nm.round; from.push('round from the file name'); }
    if (!p.date && nm.date) { p.date = nm.date; from.push('date from the file name'); }
    return { it, nm, p, from, note: '' };
  });
  const storedByKey = new Map();
  for (const s of stored) { const k = displayKey(s); if (!storedByKey.has(k)) storedByKey.set(k, s.id); }

  // groups of files that look the same today (headers as they are)
  const byKey = new Map();
  for (const x of plans) { const k = displayKey(x.it); (byKey.get(k) ?? byKey.set(k, []).get(k)).push(x); }
  let groupNo = 0;
  for (const [k, list] of byKey) {
    const clash = storedByKey.get(k);
    if (list.length < 2 && !clash) continue;
    groupNo++;
    for (const x of list) {
      x.group = groupNo;
      // a number in the name tells the matches of a series apart, even when the headers give a round ("Final" -> "Final - Match 3")
      if (x.it.round && x.p.round === x.it.round) {
        if (x.nm.n !== null) { x.p.round = `${x.it.round} - Match ${x.nm.n}${x.nm.of ? ` of ${x.nm.of}` : ''}`; x.from.push('match number from the file name'); }
        else if (/\d/.test(x.nm.round ?? '')) { x.p.round = x.nm.round; x.from.push('round from the file name'); }          // "QF" and the name says "qf2"
      }
      if (clash) x.note = `looks the same as ${clash}, already stored`;
    }
    // still the same after the names were read: their times (in the file, else in its name) give the order, when they all have a different one
    const after = new Map();
    for (const x of list) { const k2 = displayKey({ ...x.it, ...x.p }); (after.get(k2) ?? after.set(k2, []).get(k2)).push(x); }
    const inFile = (x) => (x.it.time ? `${x.it.date ?? ''} ${x.it.time}` : null);
    const inName = (x) => (x.nm.time ? `${x.nm.date ?? ''} ${x.nm.time}` : null);
    for (const same of after.values()) {
      if (same.length < 2) continue;
      const when = [inFile, inName].find((f) => same.every((x) => f(x)) && new Set(same.map(f)).size === same.length);
      if (when) {
        same.sort((a, b) => (when(a) < when(b) ? -1 : 1));
        same.forEach((x, i) => { x.p.round = `${x.p.round ? `${x.p.round} - ` : ''}Match ${i + 1} of ${same.length}`; x.from.push('match number from the time of play'); });
      } else for (const x of same) { x.same = true; x.note = x.note || 'nothing in the file tells it apart from the others of its group: give the round'; }
    }
  }

  const rows = [];
  for (const x of plans) {
    const changed = x.p.event !== x.it.event || x.p.round !== x.it.round || x.p.date !== x.it.date;
    if (!changed && !x.group) continue;
    rows.push({
      status: x.same || (x.group && x.note.startsWith('looks the same') && !changed) ? 'same' : x.group ? 'series' : 'name',
      group: x.group ?? null, file: x.it.file, players: x.it.players, matchLength: x.it.matchLength, time: x.it.time ?? null,
      date: x.p.date ?? null, event: x.p.event ?? null, round: x.p.round ?? null,
      current: { date: x.it.date ?? null, event: x.it.event ?? null, round: x.it.round ?? null },
      from: x.from.join(', '), note: x.note,
    });
  }
  for (const { it, of } of copies) {
    rows.push({
      status: 'duplicate', group: null, file: it.file, players: it.players, matchLength: it.matchLength, time: it.time ?? null,
      date: it.date ?? null, event: it.event ?? null, round: it.round ?? null, current: { date: it.date ?? null, event: it.event ?? null, round: it.round ?? null },
      from: '', note: `same moves as ${of}: the ingest stores one of them and skips the other`,
    });
  }
  const order = { same: 0, series: 1, name: 2, duplicate: 3 };
  rows.sort((a, b) => order[a.status] - order[b.status] || (a.group ?? 0) - (b.group ?? 0) || a.file.localeCompare(b.file, 'en', { numeric: true }));
  return { rows, groups: groupNo };
}
