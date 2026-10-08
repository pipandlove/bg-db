/**
 * The logic of the "Contribute" page, without the DOM: check files with the same code as the tools (analyzeGroup), name them, build the
 * files to hand over, and the links to GitHub. Tested in Node.
 */
import { groupFiles, analyzeGroup, normalizeVideoLink, toBgdbJson, hideNames as coreHideNames, onlinePlatform } from '../lib/core/index.js';
import { slug } from './dom.js';

/**
 * @param {{name:string, bytes:Uint8Array}[]} files
 * @param {{config:object, known?:{get(full:string):string|undefined}, nameOf?:(name:string)=>string}} ctx  known = what is in the database (the
 *   catalog); nameOf = the pseudonyms of the contributor's key (decision 0025): the files are then named after them
 * @returns {{group:object, res:object, base:string|null, realBase:string|null}[]} one item per contribution, in order; `base` = the name the files
 *   get (new matches only), `realBase` = the name they get with the real names (a match played over the board)
 */
export function prepare(files, { config, known, nameOf }) {
  const seen = new Map();
  const both = { get: (full) => known?.get(full) ?? seen.get(full) };
  const taken = new Set();
  return groupFiles(files.map((f) => ({ name: f.name, bytes: f.bytes, dir: '' }))).map((group) => {
    const res = analyzeGroup(group, { config, known: both });
    let base = null;
    let realBase = null;
    const name = (players) => {
      const stem = `${slug(players[0])}-vs-${slug(players[1])}-${res.summary.date ?? 'undated'}`;
      let b = stem;
      for (let n = 2; taken.has(b); n++) b = `${stem}-${n}`;
      taken.add(b);
      return b;
    };
    if (res.status === 'new' || res.status === 'partial') {             // a partial match gets a name too: it is sent if the contributor accepts it
      seen.set(res.full, '(earlier in this submission)');
      base = name(nameOf ? res.summary.players.map(nameOf) : res.summary.players);
      realBase = nameOf ? name(res.summary.players) : base;
    }
    return { group, res, base, realBase };
  });
}

/** the match as it will be sent, with pseudonyms (decision 0025): see hideNames in packages/core/src/pseudonym.js */
export const hideNames = (item, nameOf) => coreHideNames(item.res, nameOf);

/**
 * Extras the contributor typed on the page: a YouTube link and tags (comma separated).
 * @returns {{links:object[], tags:string[], problems:string[]}}
 */
export function parseExtras({ video = '', tags = '' }, config) {
  const problems = [];
  const links = [];
  if (video.trim()) {
    const r = normalizeVideoLink(video, { hosts: config.videoHosts });
    if (r.ok) links.push(r.link); else problems.push(`The video link was not used: ${r.reason}.`);
  }
  const out = [];
  for (const t of tags.split(/[,\n]/).map((x) => x.trim().toLowerCase()).filter(Boolean)) {
    if (/^[a-z0-9][a-z0-9-]{0,30}$/.test(t)) { if (!out.includes(t)) out.push(t); } else problems.push(`The tag "${t}" was not used (lower-case letters, digits and "-", at most 31 characters).`);
  }
  return { links, tags: out, problems };
}

/** a match that will be sent: new, or partial and accepted by the contributor (item.acceptPartial), and its names could be replaced or it was played over the board */
export const sendable = (item) => (item.otb || !item.hideError) && (item.res.status === 'new' || (item.res.status === 'partial' && item.acceptPartial === true));

/**
 * The online platform the file names, which rules out "played over the board" (decision 0025: the review refuses it, V-ORIGIN), or null.
 * @returns {string|null}
 */
export const platformOf = (item) => onlinePlatform(item.res.match?.provenance?.site, item.res.match?.event);

/**
 * The files to hand over for the matches that will be sent: the files with their names replaced (item.hidden, decision 0025), else the
 * originals, under a good name; plus a .bgdb.json when there is something to add (links, tags, declared illegal plays, the acceptance of a
 * partial match).
 */
/** the rights statement the ZIP carries once the box is ticked on the page: the review accepts it like the box of a pull request description */
export const rightsLine = (license) => `- [x] I have the right to share these matches under ${license === 'CC0-1.0' || !license ? 'the CC0 public-domain dedication' : `the licence of the database (${license})`} (ticked on the Contribute page).`;

/** @param {(base:string)=>object} [extrasOf] @param {string} [license] the licence of the database, for the rights statement */
export function packageFiles(items, extrasOf, license = 'CC0-1.0') {
  const files = [];
  for (const item of items) {
    const { group, res } = item;
    if (!sendable(item)) continue;
    const accept = res.status === 'partial';
    // over the board (decision 0025): the files as they are, with their real names, and "origin": "otb"; otherwise the names replaced
    const otb = !!item.otb;
    const hidden = otb ? null : item.hidden;
    const base = otb ? item.realBase : item.base;
    if (hidden) {
      // names replaced (decision 0025): the normalised match and the rewritten attachments, never the original files
      files.push({ name: `${base}.mat`, bytes: hidden.normalised });
      for (const a of hidden.attachments) files.push({ name: `${base}${a.ext}`, bytes: a.bytes });
    } else {
      for (const [kind, list] of Object.entries(group.files)) {
        for (const e of list) {
          if (kind === 'side') continue;
          const ext = e.name.slice(e.name.lastIndexOf('.'));
          files.push({ name: `${base}${ext.toLowerCase()}`, bytes: e.bytes });
        }
      }
    }
    const x = extrasOf?.(item.base) ?? { links: [], tags: [] };
    const sc = res.sidecar ?? { links: [], tags: [], illegal: [] };
    // the normalised file declares its illegal plays itself, with its own row numbers and names
    const illegal = hidden ? [] : sc.illegal;
    const links = [...sc.links, ...x.links].filter((l, i, a) => a.findIndex((m) => m.url === l.url && m.game === l.game) === i);
    const tags = [...new Set([...sc.tags, ...x.tags])];
    if (links.length || tags.length || illegal.length || accept || otb || (!hidden && group.files.side?.length)) {
      const json = {};
      if (otb) json.origin = 'otb';
      if (accept) json.accept = 'partial';
      if (links.length) json.links = links.map(({ url, title, game, time }) => ({ url, ...(title ? { title } : {}), ...(game ? { game } : {}), ...(time ? { time } : {}) }));
      if (tags.length) json.tags = tags;
      if (illegal.length) json.illegal = illegal.map((d) => ({ game: d.game, row: d.row, ...(d.player ? { player: d.player } : {}) }));
      files.push({ name: `${base}.bgdb.json`, bytes: `${JSON.stringify(json, null, 2)}\n` });
    }
  }
  if (files.length) {
    // a note, never read as a match: the instructions, and the rights statement ticked on the page (the review accepts it, decision 0015)
    files.push({ name: 'CONTRIBUTION.md', bytes: `# Matches for the database\n\nDrop this ZIP, as it is, into the "Submit a match" form of the database on GitHub (the Contribute page opens it for you), tick the rights box and create the issue. A bot checks the matches again, adds them, and answers on the issue with their links. The files of one match share the same name.\n\n${rightsLine(license)}\n` });
  }
  return files;
}

/**
 * The "Submit a match" form of the data repository on GitHub, where the contributor drops the ZIP (decision 0015, tools v8): no fork, no
 * branch, no pull request to handle. The title names the matches, so that the issue is recognisable in the list. null when the repository is
 * not known.
 * @returns {string|null}
 */
export function issueFormLink(registry, items) {
  const repo = registry?.repository;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  const fresh = items.filter(sendable);
  const first = fresh[0]?.res.summary;
  const players = (!fresh[0]?.otb && fresh[0]?.hidden?.players) || first?.players;
  const title = !first ? 'Matches' : `Matches: ${players.join(' vs ')}${first.date ? ` ${first.date}` : ''}${fresh.length > 1 ? ` and ${fresh.length - 1} more` : ''}`;
  return `https://github.com/${repo}/issues/new?template=submit-match.yml&title=${encodeURIComponent(title.slice(0, 120))}`;
}

/** the data the replay needs to draw the last position of a match */
export function previewReplay(match) {
  return toBgdbJson(match, { id: 'preview', sides: match.sides, links: [], attachments: [] });
}

/** the "known" lookup built from the catalog rows: a catalog stores the first 16 characters of the content hash */
export function knownFromRows(rows) {
  const byHash = new Map(rows.map((r) => [r.hash, r.id]));
  return { get: (full) => byHash.get(full.slice(0, 16)) };
}
