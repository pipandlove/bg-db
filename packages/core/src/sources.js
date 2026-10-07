/**
 * sources.json: the data repositories a site reads (decision 0024). Shared by the tools (bgdb build checks it) and the site (which loads it).
 *
 *   { "schema": "1.0", "name": "BGDB", "license": "CC0-1.0",
 *     "sources": [ { "name": "bg-db-data-1", "url": "https://owner.github.io/bg-db-data-1/", "repository": "owner/bg-db-data-1", "defaultBranch": "master", "state": "archived" },
 *                  { "name": "bg-db-data-2", "url": "https://owner.github.io/bg-db-data-2/", "repository": "owner/bg-db-data-2", "state": "current" } ] }
 *
 * Sources are listed oldest first. `url` is where that repository publishes its registry.json: absolute, or relative to the page (ending with "/").
 * state: `current` takes the contributions (exactly one), `archived` is read-only but still read, `next` is created and not read yet.
 */

export const SOURCE_STATES = ['current', 'next', 'archived'];

const NAME = /^[A-Za-z0-9._-]{1,100}$/;
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const BRANCH = /^[\w./-]{1,100}$/;

/** an address a site may load data from: https, http on this computer (local tests), or a path relative to the page */
function urlProblem(u) {
  if (typeof u !== 'string' || !u.endsWith('/')) return 'must be a text that ends with "/"';
  if (/^https:\/\/[^/]+\//.test(u)) return null;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith('//')) return 'must start with https:// (or be a path relative to the site)';
  return null;
}

/**
 * Check a parsed sources.json.
 * @returns {{ok:boolean, errors:string[], sources:object[], current:object|null, name:string|null, license:string|null}}
 */
export function checkSources(j) {
  const errors = [];
  if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false, errors: ['sources.json must be a JSON object'], sources: [], current: null, name: null, license: null };
  if (j.schema !== '1.0') errors.push('"schema" must be "1.0"');
  const list = Array.isArray(j.sources) ? j.sources : [];
  if (list.length === 0) errors.push('"sources" must list at least one data repository');
  const names = new Set();
  const sources = [];
  list.forEach((s, i) => {
    const at = `source ${i + 1}${s && typeof s.name === 'string' ? ` (${s.name})` : ''}`;
    if (!s || typeof s !== 'object') { errors.push(`${at}: must be an object`); return; }
    if (!NAME.test(s.name ?? '')) errors.push(`${at}: "name" must be letters, digits, ".", "_" or "-"`);
    else if (names.has(s.name)) errors.push(`${at}: the name is used twice`);
    names.add(s.name);
    const u = urlProblem(s.url);
    if (u) errors.push(`${at}: "url" ${u}`);
    if (!SOURCE_STATES.includes(s.state)) errors.push(`${at}: "state" must be one of ${SOURCE_STATES.join(', ')}`);
    if (s.repository !== undefined && !REPO.test(s.repository)) errors.push(`${at}: "repository" must look like "owner/name"`);
    if (s.defaultBranch !== undefined && !BRANCH.test(s.defaultBranch)) errors.push(`${at}: "defaultBranch" is not a branch name`);
    sources.push({ name: s.name, url: s.url, state: s.state, repository: s.repository ?? null, defaultBranch: s.defaultBranch ?? 'master' });
  });
  const current = sources.filter((s) => s.state === 'current');
  if (list.length && current.length !== 1) errors.push(`exactly one source must be "current" (the one that takes the contributions); there are ${current.length}`);
  else if (current.length === 1 && !current[0].repository) errors.push(`the current source (${current[0].name}) needs its "repository": the Contribute page sends to it`);
  return {
    ok: errors.length === 0, errors, sources, current: current.length === 1 ? current[0] : null,
    name: typeof j.name === 'string' ? j.name : null, license: typeof j.license === 'string' ? j.license : null,
  };
}

/**
 * The enrichments of several sources for the same match, merged in the order of the sources (oldest first): links and tags are added up,
 * an attachment of a later source replaces one of the same kind, a correction of event, round or date of a later source wins.
 */
export function mergeEnrichment(a, b) {
  if (!a) return b;
  const links = [...(a.links ?? [])];
  for (const l of b.links ?? []) if (!links.some((x) => x.url === l.url)) links.push(l);
  const tags = [...new Set([...(a.tags ?? []), ...(b.tags ?? [])])];
  const attachments = [...(a.attachments ?? []).filter((x) => !(b.attachments ?? []).some((y) => y.kind === x.kind)), ...(b.attachments ?? [])];
  const meta = a.meta || b.meta ? { ...(a.meta ?? {}), ...(b.meta ?? {}) } : undefined;
  return { links, tags, attachments, ...(meta ? { meta } : {}) };
}
