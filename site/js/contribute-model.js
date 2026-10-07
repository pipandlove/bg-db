/**
 * The logic of the "Contribute" page, without the DOM: check files with the same code as the tools (analyzeGroup), name them, build the
 * files to hand over, and the links to GitHub. Tested in Node.
 */
import { groupFiles, analyzeGroup, normalizeVideoLink, toBgdbJson } from '../lib/core/index.js';
import { slug } from './dom.js';

/** the hand-over by an issue is only possible while the whole address stays short enough for GitHub */
export const MAX_ISSUE_URL = 7000;

/**
 * @param {{name:string, bytes:Uint8Array}[]} files
 * @param {{config:object, known?:{get(full:string):string|undefined}}} ctx  known = what is in the database (the catalog)
 * @returns {{group:object, res:object, base:string|null}[]} one item per contribution, in order; `base` = the name the files get (new matches only)
 */
export function prepare(files, { config, known }) {
  const seen = new Map();
  const both = { get: (full) => known?.get(full) ?? seen.get(full) };
  const taken = new Set();
  return groupFiles(files.map((f) => ({ name: f.name, bytes: f.bytes, dir: '' }))).map((group) => {
    const res = analyzeGroup(group, { config, known: both });
    let base = null;
    if (res.status === 'new' || res.status === 'partial') {             // a partial match gets a name too: it is sent if the contributor accepts it
      seen.set(res.full, '(earlier in this submission)');
      const s = res.summary;
      const stem = `${slug(s.players[0])}-vs-${slug(s.players[1])}-${s.date ?? 'undated'}`;
      base = stem;
      for (let n = 2; taken.has(base); n++) base = `${stem}-${n}`;
      taken.add(base);
    }
    return { group, res, base };
  });
}

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

/** a match that will be sent: new, or partial and accepted by the contributor (item.acceptPartial) */
export const sendable = (item) => item.res.status === 'new' || (item.res.status === 'partial' && item.acceptPartial === true);

/**
 * The files to hand over for the matches that will be sent: the originals under a good name, plus a .bgdb.json when there is something to
 * add (links, tags, declared illegal plays, the acceptance of a partial match).
 */
export function packageFiles(items, extrasOf) {
  const files = [];
  for (const item of items) {
    const { group, res, base } = item;
    if (!sendable(item)) continue;
    const accept = res.status === 'partial';
    for (const [kind, list] of Object.entries(group.files)) {
      for (const e of list) {
        if (kind === 'side') continue;
        const ext = e.name.slice(e.name.lastIndexOf('.'));
        files.push({ name: `${base}${ext.toLowerCase()}`, bytes: e.bytes });
      }
    }
    const x = extrasOf?.(base) ?? { links: [], tags: [] };
    const sc = res.sidecar ?? { links: [], tags: [], illegal: [] };
    const links = [...sc.links, ...x.links].filter((l, i, a) => a.findIndex((m) => m.url === l.url && m.game === l.game) === i);
    const tags = [...new Set([...sc.tags, ...x.tags])];
    if (links.length || tags.length || sc.illegal.length || accept || group.files.side?.length) {
      const json = {};
      if (accept) json.accept = 'partial';
      if (links.length) json.links = links.map(({ url, title, game, time }) => ({ url, ...(title ? { title } : {}), ...(game ? { game } : {}), ...(time ? { time } : {}) }));
      if (tags.length) json.tags = tags;
      if (sc.illegal.length) json.illegal = sc.illegal.map((d) => ({ game: d.game, row: d.row, ...(d.player ? { player: d.player } : {}) }));
      files.push({ name: `${base}.bgdb.json`, bytes: `${JSON.stringify(json, null, 2)}\n` });
    }
  }
  if (files.length) {
    files.push({ name: 'README.txt', bytes: 'Put these files in the "inbox" folder of your copy (fork) of the database repository on GitHub (Add file > Upload files), and open a pull request to the database repository.\nThe files of one match share the same name. Nothing else is needed: they are checked again, and merged automatically if all is well.\n' });
  }
  return files;
}

/** a GitHub account name: letters, digits and single hyphens, at most 39 characters */
export const isGithubLogin = (s) => typeof s === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(s);

/**
 * Links to GitHub for the hand-over; null when the repository is not known.
 * GitHub lets a person upload files only into a repository they can write to, so a contributor uploads into their own copy (fork) of the
 * repository, at github.com/<login>/<name>, and opens the pull request from there: `fork` makes the copy, `upload` (when the login is known)
 * opens the upload page of the copy. The owner cannot fork their own repository, and its master is protected: `uploadWhy` says so.
 * @returns {{fork:string, upload:string|null, uploadWhy:string|null, issue:string|null, issueWhy:string|null}|null}
 */
export function githubLinks(registry, items, issueText, login = null) {
  const repo = registry?.repository;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  const branch = /^[\w./-]+$/.test(registry.defaultBranch ?? '') ? registry.defaultBranch : 'master';
  const [owner, name] = repo.split('/');
  const out = { fork: `https://github.com/${repo}/fork`, upload: null, uploadWhy: null, issue: null, issueWhy: null };
  if (!isGithubLogin(login)) out.uploadWhy = 'Type your GitHub name to open the upload page of your copy.';
  else if (login.toLowerCase() === owner.toLowerCase()) out.uploadWhy = `${repo} is yours: GitHub does not let you fork it, and its ${branch} branch is protected. Add the files with git on a branch and open a pull request (docs/data-repositories.md, section 6).`;
  else out.upload = `https://github.com/${login}/${name}/upload/${branch}/inbox`;
  const fresh = items.filter(sendable);
  if (fresh.length !== 1) out.issueWhy = 'Sending as an issue works for one match at a time: use the ZIP for several.';
  else if (fresh[0].res.attachments.length) out.issueWhy = 'This match has an SGF or XG file, which cannot go through an issue: use the ZIP.';
  else {
    const s = fresh[0].res.summary;
    const title = `Match: ${s.players.join(' vs ')}${s.date ? ` ${s.date}` : ''}`;
    const url = `https://github.com/${repo}/issues/new?template=submit-match.yml&title=${encodeURIComponent(title)}&transcript=${encodeURIComponent(issueText)}`;
    if (url.length > MAX_ISSUE_URL) out.issueWhy = 'This match is too long to be sent through an address: use the ZIP.';
    else {
      out.issue = url;
      if (fresh[0].res.status === 'partial') out.issueWhy = 'In the issue form, tick "Add it partially": the form cannot tick it for you.';
    }
  }
  return out;
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
