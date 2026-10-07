/**
 * The review of a contribution (spec 10.4 - 10.6): what a pull request that adds files to inbox/ would do, as a report, a verdict
 * (ready / needs-fix / needs-review / duplicate / empty / closed), labels, the decision whether it may be merged automatically, and the comment
 * a bot posts. It writes nothing to data/. The same code runs on a pull request (read-only) and on a contributor's machine.
 */
import fs from 'node:fs';
import path from 'node:path';
import { analyzeGroup, readMatch, writeMat } from '@bg-db/core';
import { collectGroups } from './ingest.js';
import { listShards, loadHashIndex } from './store.js';
import { diffEnrichment, readEnrichment, readLocalMeta, ID_RE } from './enrich.js';

export const MARKER = '<!-- bgdb-review -->';
export const LIMITS = { maxGroups: 500, bulkFrom: 20 };
/** the .mat of partial matches is shown in the comment within this budget, in order (a comment holds about 65 000 characters) */
const PREVIEW_MAX = 40000;
/** warnings that send a pull request to a human even though it is valid (spec MP-02); an illegal play that was made is exceptional */
export const REVIEW_CODES = new Set(['V-NAMES', 'V-ANALYSIS', 'V-RIGHTS', 'V-ILLEGAL']);
const RIGHTS_RE = /-\s*\[[xX]\]\s*I have the right/i;

export const rightsDeclared = (body) => RIGHTS_RE.test(body ?? '');

/** where the contributor writes {"accept": "partial"}: the group's own name.bgdb.json, next to its match file */
function sidecarPath(inbox, g) {
  const any = Object.values(g.files).flat()[0];
  const dir = any ? path.relative(inbox, path.dirname(any.path)).split(path.sep).join('/') : '';
  return `inbox/${dir ? `${dir}/` : ''}${g.base}.bgdb.json`;
}

/**
 * @returns {{groups:object[], summary:object, rights:boolean}} rights: a note of the contribution declares the rights (the CONTRIBUTION.md the
 *   Contribute page writes into its ZIP once the box is ticked there), which counts like the box of the pull request description
 */
export function reviewInbox({ inbox, data, config }) {
  const known = loadHashIndex(listShards(data), data).byFull;
  const groups = [];
  const found = {};
  const collected = collectGroups(inbox, found);
  for (const pr of found.problems) {
    groups.push({
      base: path.basename(pr.file), files: [path.relative(inbox, pr.file).split(path.sep).join('/')], status: 'error',
      errors: [{ severity: 'error', code: 'V-FORMAT', message: pr.message, hint: 'Upload the files of the archive instead (unzip it first), or the ZIP made by the Contribute page.' }],
      warnings: [], infos: [], id: null, summary: null, attachments: [], links: 0, duplicateOf: null, extrasIgnored: false, enrich: null, partial: null, normalised: null,
    });
  }
  for (const g of collected) {
    const files = Object.values(g.files).flat().map((e) => path.relative(inbox, e.path).split(path.sep).join('/'));
    const res = analyzeGroup(g, { config, known });
    if (res.status === 'new') known.set(res.full, '(earlier in this submission)');
    // a duplicate that brings something new (a link, tags, an SGF or XG file) will enrich the existing match
    let enrich = null;
    if (res.status === 'duplicate' && ID_RE.test(res.duplicateOf ?? '')) {
      const d = diffEnrichment({ meta: readLocalMeta(data, res.duplicateOf), record: readEnrichment(data, res.duplicateOf) }, { links: res.links, tags: res.tags, attachments: res.attachments, fix: res.sidecar?.meta });
      if (d.links.length || d.tags.length || d.attachments.length || Object.keys(d.meta).length) enrich = { links: d.links.length, tags: d.tags.length, attachments: d.attachments.map((a) => a.kind), ...(Object.keys(d.meta).length ? { meta: Object.keys(d.meta) } : {}) };
    }
    groups.push({
      base: g.base, files, status: res.status, errors: res.errors, warnings: res.warnings, infos: res.infos,
      id: res.hash16 ?? null, summary: res.summary ?? null, attachments: (res.attachments ?? []).map((a) => a.kind), links: res.links?.length ?? 0,
      duplicateOf: res.duplicateOf ?? null, extrasIgnored: !!res.extrasIgnored && !enrich, enrich,
      // a match that can only be added partially (decision 0021): what is kept, why, whether the contributor accepted it, and the .mat
      partial: res.partial ? { accepted: res.partial.accepted, notes: res.partial.notes, errors: res.partial.errors, sidecar: sidecarPath(inbox, g) } : null,
      normalised: res.status === 'partial' ? res.normalised : null,
    });
  }
  const count = (s) => groups.filter((x) => x.status === s).length;
  return { groups, rights: found.notes.some((n) => rightsDeclared(n.text)), summary: { groups: groups.length, new: count('new'), partial: count('partial'), duplicate: count('duplicate') - groups.filter((x) => x.enrich).length, enrich: groups.filter((x) => x.enrich).length, error: count('error'), warnings: groups.reduce((n, x) => n + x.warnings.filter((w) => w.severity === 'warning').length, 0) } };
}

/**
 * @param {{groups:object[], summary:object}} report
 * @param {{changed?:string[]|null, body?:string|null, closed?:boolean}} ctx  changed = paths changed by the pull request; body = its description;
 *   closed = this data repository takes no more contributions (decision 0024)
 */
export function classify(report, { changed = null, body = null, closed = false } = {}) {
  const reasons = [];
  const labels = [];
  const { summary, groups } = report;
  const outside = (changed ?? []).filter((p) => !p.startsWith('inbox/'));
  let verdict;
  if (closed) { verdict = 'closed'; reasons.push('this data repository is closed: it takes no more matches'); }
  else if (summary.groups === 0) { verdict = 'empty'; reasons.push('no match file was found under inbox/'); }
  else if (summary.error > 0) { verdict = 'needs-fix'; reasons.push(`${summary.error} file(s) have errors`); }
  else if (body !== null && !rightsDeclared(body) && !report.rights) { verdict = 'needs-fix'; reasons.push('the rights box of the pull request description is not ticked'); }
  else if (summary.groups > LIMITS.maxGroups) { verdict = 'needs-fix'; reasons.push(`${summary.groups} matches in one pull request (the limit is ${LIMITS.maxGroups}): please split it`); }
  else if (summary.partial > 0) { verdict = 'needs-confirmation'; reasons.push(`${summary.partial} match${summary.partial === 1 ? '' : 'es'} can only be added partially, and that needs your agreement`); }
  else if (summary.new === 0 && !summary.enrich) { verdict = 'duplicate'; reasons.push('everything is already in the database'); }
  else if (outside.length) { verdict = 'needs-review'; reasons.push(`it changes files outside inbox/: ${outside.slice(0, 5).join(', ')}${outside.length > 5 ? ', ...' : ''}`); }
  else if (groups.some((g) => g.warnings.some((w) => REVIEW_CODES.has(w.code)))) {
    verdict = 'needs-review';
    reasons.push(`a maintainer should look at: ${[...new Set(groups.flatMap((g) => g.warnings.filter((w) => REVIEW_CODES.has(w.code)).map((w) => w.code)))].join(', ')}`);
  } else verdict = 'ready';

  if (verdict === 'ready') labels.push('ready', 'auto-merge');
  else if (verdict === 'duplicate') labels.push('duplicate');
  else if (verdict === 'needs-confirmation') labels.push('needs-confirmation');
  else if (verdict === 'closed') labels.push('closed');
  else labels.push(verdict === 'needs-fix' || verdict === 'empty' ? 'needs-fix' : 'needs-review');
  if (groups.some((g) => g.partial)) labels.push('partial');
  if (groups.some((g) => g.enrich || (g.status === 'duplicate' && g.extrasIgnored))) labels.push('enrichment');
  if (summary.groups >= LIMITS.bulkFrom) labels.push('bulk');
  return { verdict, labels, autoMerge: verdict === 'ready', reasons };
}

// ------------------------------------------------------------------ the comment

/** text that comes from a file must not become markup, mentions or table breaks */
export const md = (s) => String(s ?? '').replace(/[\\`*_{}\[\]<>|#~]/g, '\\$&').replace(/@/g, '@\u200b').replace(/\s+/g, ' ').trim();

/** text inside a code span: only a backtick could end it (markdown escapes would show as they are) */
const code = (s) => String(s ?? '').replace(/`/g, "'").replace(/[\r\n]+/g, ' ');
const matchLabel = (s) => (s ? `${s.players.map((p) => md(p ?? '?')).join(' vs ')}, ${s.matchLength === 0 ? 'money game' : `${s.matchLength} pts`}${s.date ? `, ${md(s.date)}` : ''}${s.event ? `, ${md(s.event)}` : ''}${s.round ? ` (${md(s.round)})` : ''}, ${s.games} game${s.games === 1 ? '' : 's'}` : '');
const diagLine = (d) => `${d.severity === 'error' ? 'error' : 'warning'} \`${d.code}\`${d.line ? ` (line ${d.line})` : ''}: ${md(d.message)}${d.hint ? ` *How to fix:* ${md(d.hint)}` : ''}`;

const HEAD = {
  ready: 'Everything looks good. This pull request will be merged automatically in about ten minutes.',
  'needs-fix': 'A few things need fixing before this can be merged (details below). Push a new commit to the same branch and I will check again.',
  'needs-review': 'This looks valid, but a maintainer should have a look first. It will be merged after review.',
  'needs-confirmation': 'Some games cannot be read, but the rest of the match is clear: it can be added **partially**. Please look at what would be kept (below) and tell me if you agree.',
  duplicate: 'Everything in this pull request is already in the database, so there is nothing to add.',
  empty: 'I found no match file under `inbox/` in this pull request.',
  closed: 'This collection is closed: it takes no more matches, so this pull request cannot be merged here.',
};
const NEXT = {
  ready: 'After the merge the matches are filed into the database and the site is updated.',
  'needs-fix': 'Nothing is lost: your files stay as they are until they are fixed.',
  'needs-review': 'You do not need to do anything.',
  'needs-confirmation': 'To agree, add the line shown below to the match\'s `.bgdb.json` file (create it if it is not there) and push: I will check again and merge. To add the complete match instead, fix the file. If you do neither, nothing is added.',
  duplicate: 'You can close this pull request. If you meant to add a video link or an SGF/XG file to a match that already exists, say so in a comment.',
  empty: 'Put the match files (`.txt`, `.mat`, `.sgf`, optionally `.xg`) in the `inbox/` folder: see CONTRIBUTING.md.',
  closed: 'Please send the same files again from the Contribute page of the site: it sends them to the data repository that takes new matches now. Your files are not lost, and you can close this pull request.',
};

/** @returns {string} markdown, at most about 60 000 characters */
export function renderComment(report, decision, { author = null, welcome = false } = {}) {
  const L = [MARKER];
  if (welcome) L.push('Welcome, and thank you for your first contribution! A short guide is in CONTRIBUTING.md.', '');
  const n = report.summary.groups;
  L.push(`${author ? `Thanks, @${String(author).replace(/[^A-Za-z0-9-]/g, '')}! ` : ''}I checked ${n} match${n === 1 ? '' : 'es'}. ${HEAD[decision.verdict]}`, '');
  if (decision.reasons.length && decision.verdict !== 'ready') L.push(`*Why:* ${decision.reasons.map(md).join('; ')}.`, '');
  if (n > 0) {
    L.push('| | Match | What happens |', '|---|---|---|');
    for (const g of report.groups.slice(0, 100)) {
      if (g.status === 'new') L.push(`| OK | ${matchLabel(g.summary)} | will be added${g.partial ? ' **partially** (you agreed)' : ''}${g.attachments.length ? ` (with ${g.attachments.join(', ')})` : ''}${g.links ? `, ${g.links} video link${g.links === 1 ? '' : 's'}` : ''} |`);
      else if (g.status === 'partial') L.push(`| Partial | ${matchLabel(g.summary)} | can be added partially: ${g.partial.notes.length} game${g.partial.notes.length === 1 ? '' : 's'} cannot be read; waiting for your agreement |`);
      else if (g.status === 'duplicate' && g.enrich) L.push(`| OK | ${matchLabel(g.summary)} | already in the database as ${md(g.duplicateOf)}; will add ${[...g.enrich.attachments, g.enrich.links ? `${g.enrich.links} video link${g.enrich.links === 1 ? '' : 's'}` : '', g.enrich.tags ? `${g.enrich.tags} tag${g.enrich.tags === 1 ? '' : 's'}` : '', g.enrich.meta?.length ? `the corrected ${g.enrich.meta.join(', ')}` : ''].filter(Boolean).join(', ')} to it |`);
      else if (g.status === 'duplicate') L.push(`| Skipped | ${matchLabel(g.summary)} | already in the database${g.duplicateOf ? ` as ${md(g.duplicateOf)}` : ''}${g.extrasIgnored ? '; what you added to it is already there' : ''} |`);
      else L.push(`| Needs a fix | ${g.files.map(md).join(', ')} | ${md(g.errors[0]?.message ?? 'error')} |`);
    }
    if (n > 100) L.push(`| | and ${n - 100} more | |`);
    const partial = report.groups.filter((g) => g.status === 'partial');
    if (partial.length) {
      L.push('', '**Matches that can be added partially**', '');
      let budget = PREVIEW_MAX;
      for (const g of partial.slice(0, 20)) {
        L.push(`- **${g.files.map(md).join(', ')}** (${matchLabel(g.summary)})`);
        for (const n of g.partial.notes.slice(0, 10)) L.push(`  - ${md(n.message)}`);
        L.push(`  - Or fix the file, and the whole match will be added: ${g.partial.errors.slice(0, 3).map(diagLine).join('; ')}`);
        L.push(`  - To agree, \`${code(g.partial.sidecar)}\` must contain: \`{"accept": "partial"}\` (keep the other keys if the file exists).`);
        if (g.normalised && g.normalised.length <= budget) {
          budget -= g.normalised.length;
          L.push('', '  <details><summary>The match as it would be stored (.mat): you can open it in your own program or check it with <code>bgdb check</code></summary>', '', '  ```', ...g.normalised.replace(/```/g, "'''").trimEnd().split('\n').map((x) => `  ${x}`), '  ```', '  </details>', '');
        } else L.push(`  - The match as it would be stored is too long to show here: \`npm run bgdb -- check --salvage --out preview inbox/${code(g.files[0])}\` writes it to \`preview/\`.`);
      }
    }
    const details = report.groups.filter((g) => g.errors.length || g.warnings.some((w) => w.severity === 'warning'));
    if (details.length) {
      L.push('', '**Details**', '');
      for (const g of details.slice(0, 40)) {
        L.push(`- **${g.files.map(md).join(', ')}**`);
        for (const d of [...g.errors.map((e) => ({ ...e, severity: 'error' })), ...g.warnings.filter((w) => w.severity === 'warning')].slice(0, 8)) L.push(`  - ${diagLine(d)}`);
      }
    }
  }
  L.push('', `**Next:** ${NEXT[decision.verdict]}`);
  const out = L.join('\n');
  return out.length > 60000 ? `${out.slice(0, 59900)}\n\n(truncated)` : out;
}

// ------------------------------------------------------------------ issue form -> inbox file (spec C2, "paste a match")

/** the sections of an issue created from an issue form: "### Label" followed by the answer */
export function parseIssueBody(body) {
  const sections = {};
  const parts = String(body ?? '').replace(/\r\n/g, '\n').split(/^### +(.+?) *$/m);
  for (let i = 1; i < parts.length; i += 2) sections[parts[i].trim()] = (parts[i + 1] ?? '').trim();
  const find = (prefix) => Object.entries(sections).find(([k]) => k.toLowerCase().startsWith(prefix))?.[1] ?? '';
  let transcript = find('match transcript');
  const fence = transcript.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  if (fence) transcript = fence[1];
  const clean = (v) => (v === '_No response_' ? '' : v);
  return { transcript: clean(transcript), event: clean(find('event')), rights: rightsDeclared(find('rights') || body), acceptPartial: /-\s*\[[xX]\]\s*Add it partially/i.test(find('partial')) };
}

const tagValue = (s) => s.replace(/["\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);

/**
 * Turn an issue into the file of a pull request. Nothing is written when the match is not valid.
 * @returns {{ok:boolean, file?:string, errors:object[], comment:string}}
 */
export function issueToInbox({ body, number, inbox, config }) {
  if (config.closed) {
    return { ok: false, closed: true, errors: [{ code: 'V-CLOSED', message: 'This data repository is closed: it takes no more matches.' }],
      comment: `${MARKER}\nThanks for the submission. This collection is closed: it takes no more matches. Please send it again from the Contribute page of the site, which sends it to the data repository that takes new matches now. You can close this issue.` };
  }
  const p = parseIssueBody(body);
  const errors = [];
  if (!p.rights) errors.push({ code: 'V-RIGHTS', message: 'The rights box of the form is not ticked.', hint: 'Edit the issue and tick "I have the right to share this".' });
  if (!p.transcript) errors.push({ code: 'V-FORMAT', message: 'The match transcript is empty.', hint: 'Paste the text of the match into the first box.' });
  let text = p.transcript;
  let partial = null;
  if (errors.length === 0) {
    let first = readMatch(text, { videoHosts: config.videoHosts });
    if (!first.ok) {
      // some games cannot be read: the match may still be added partially, if the contributor agrees (decision 0021)
      const s = readMatch(text, { videoHosts: config.videoHosts, salvage: true });
      if (s.ok) {
        partial = { notes: s.warnings.filter((w) => /the moves cannot be read|the file stops in the middle of this game/.test(w.message)), errors: first.errors, normalised: writeMat(s.match) };
        first = s;
      }
    }
    if (!first.ok) errors.push(...first.errors);
    else if (p.event && !first.match.event) text = `; [Event "${tagValue(p.event)}"]\n${text}`;
  }
  if (errors.length) {
    const lines = errors.map((e) => `- \`${e.code}\`${e.line ? ` (line ${e.line})` : ''}: ${md(e.message)}${e.hint ? ` *How to fix:* ${md(e.hint)}` : ''}`);
    return { ok: false, errors, comment: `${MARKER}\nThanks for the submission. I could not use it yet:\n\n${lines.join('\n')}\n\nEdit the issue (the first box) and I will check it again.` };
  }
  if (partial && !p.acceptPartial) {
    const notes = partial.notes.map((n) => `- ${md(n.message)}`).join('\n');
    const fix = partial.errors.slice(0, 3).map((e) => `- \`${e.code}\`${e.line ? ` (line ${e.line})` : ''}: ${md(e.message)}${e.hint ? ` *How to fix:* ${md(e.hint)}` : ''}`).join('\n');
    const mat = partial.normalised.length <= PREVIEW_MAX ? `\n\n<details><summary>The match as it would be stored (.mat)</summary>\n\n\`\`\`\n${partial.normalised.replace(/```/g, "'''").trimEnd()}\n\`\`\`\n</details>` : '';
    return { ok: false, partial: true, errors: partial.errors, comment: `${MARKER}\nThanks for the submission. Some games cannot be read, but the rest of the match is clear: it can be added **partially**.\n\n${notes}${mat}\n\nTo agree, edit the issue and tick **"Add it partially"**. Or fix the transcript, and the whole match will be added:\n\n${fix}` };
  }
  const file = path.join(inbox, `issue-${number}.txt`);
  fs.mkdirSync(inbox, { recursive: true });
  fs.writeFileSync(file, `${text.replace(/\r\n/g, '\n').trimEnd()}\n`);
  if (partial) fs.writeFileSync(path.join(inbox, `issue-${number}.bgdb.json`), `${JSON.stringify({ accept: 'partial' }, null, 2)}\n`);
  return { ok: true, file, errors: [], ...(partial ? { partial: true } : {}), comment: `${MARKER}\nThanks! The match is valid${partial ? ' and you agreed to add it partially' : ''}. I am opening a pull request with it; it is checked again there and merged automatically if everything is fine.` };
}
