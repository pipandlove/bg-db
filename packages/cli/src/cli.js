/**
 * bgdb command line. Run `bgdb help` or `bgdb <command> --help`; the full reference is docs/commands.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { readMatchBytes, matchHash16, anonymizeMatchText, writeMat, RANK_TEXT } from '@bgdb/core';
import { loadConfig } from './store.js';
import { ingest, ingestComment } from './ingest.js';
import { build } from './build.js';
import { createStaticServer } from './serve.js';
import { reviewInbox, classify, renderComment, issueToInbox, parseIssueBody, downloadAttachment } from './review.js';
import { enrichByRef } from './enrich.js';
import { verifyShards, splitShard } from './shards.js';
import { writeSheet, applySheet } from './meta.js';

const MATCH_EXT = new Set(['.mat', '.txt', '.sgf', '.xg']);

/** Command registry: used by `help` and checked against docs/commands.md by a test. */
export const COMMANDS = {
  check: {
    summary: 'validate match files (.mat, .txt, .sgf, .xg) and print their identifier',
    usage: 'bgdb check <file|dir>... [--recursive] [--json] [--salvage] [--out dir]',
  },
  ingest: {
    summary: 'move valid matches from inbox/ into the open shard of data/',
    usage: 'bgdb ingest [--inbox inbox] [--data data] [--contributor name] [--date YYYY-MM-DD] [--dry-run] [--max-matches n] [--max-mb n] [--salvage] [--report file] [--comment file] [--config file]',
  },
  meta: {
    summary: 'review event, round and date before an ingest: a sheet of what the file names propose and of the matches nothing tells apart; --apply writes it to the sidecars',
    usage: 'bgdb meta [--inbox inbox] [--data data] [--sheet meta-review.tsv] [--apply sheet] [--rejected dir] [--dry-run] [--config file]',
  },
  build: {
    summary: 'produce the deployable folder (registry, catalog, manifest, match files, overlays, site); matches checked by an earlier build are not read again',
    usage: 'bgdb build [--data data] [--out dist] [--site site] [--sources file] [--cache file] [--no-cache] [--config file]',
  },
  enrich: {
    summary: 'add a video link, tags, an SGF or an XG file to a match that is already in the database, or correct its event, round or date (sealed shards are not touched)',
    usage: 'bgdb enrich <id> [--link url] [--title text] [--game n] [--time seconds] [--tags a,b] [--sgf file] [--xg file] [--event text] [--round text] [--match-date YYYY-MM-DD] [--data data] [--contributor name] [--date YYYY-MM-DD] [--dry-run] [--config file]',
  },
  verify: {
    summary: 'read every match of the shards in full and check it; --record stores the digest of sealed shards (faster builds)',
    usage: 'bgdb verify [--data data] [--shard id] [--record]',
  },
  split: {
    summary: 'move a sealed shard to the data folder of another repository (keeps its hashes here, can list it as an external shard)',
    usage: 'bgdb split <id> --to <folder> --base <url> [--remove] [--data data] [--config file]',
  },
  review: {
    summary: 'check what a pull request adding files to inbox/ would do: report, verdict, labels, bot comment',
    usage: 'bgdb review [--inbox inbox] [--data data] [--changed file] [--body file] [--author name] [--welcome] [--report file] [--comment file] [--config file]',
  },
  'from-issue': {
    summary: 'turn a "Submit a match" issue (the ZIP of the Contribute page dropped into it, or a pasted match) into a file of inbox/ (used by the issue workflow)',
    usage: 'bgdb from-issue --body file --number n [--inbox inbox] [--data data] [--result file] [--config file]',
  },
  anonymize: {
    summary: 'replace site match identifiers in text match files (handles are kept)',
    usage: 'bgdb anonymize <file|dir>... [--recursive] [--write] [--check]',
  },
  serve: {
    summary: 'serve a folder as a static site for local development',
    usage: 'bgdb serve [dir] [--port 8080]',
  },
  help: {
    summary: 'show this list, or the usage of one command',
    usage: 'bgdb help [command]',
  },
};

function collect(target, recursive, out, exts = MATCH_EXT) {
  const st = fs.statSync(target);
  if (st.isDirectory()) {
    for (const e of fs.readdirSync(target, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(target, e.name);
      if (e.isDirectory()) { if (recursive && e.name !== 'invalid') collect(p, recursive, out, exts); } else if (exts.has(path.extname(e.name).toLowerCase())) out.push(p);
    }
  } else out.push(target);
  return out;
}

export function checkFile(file, opts = {}) {
  const r = readMatchBytes(new Uint8Array(fs.readFileSync(file)), opts.salvage ? { salvage: true } : {});
  // --out: the normalised .mat that would be stored (with --salvage, the partial match), to look at it or open it in another program
  if (opts.out && r.ok) {
    fs.mkdirSync(opts.out, { recursive: true });
    fs.writeFileSync(path.join(opts.out, `${path.basename(file).replace(/\.[^.]+$/, '')}.mat`), writeMat(r.match));
  }
  return {
    file,
    ok: r.ok,
    format: r.format,
    id: r.ok ? matchHash16(r.match) : null,
    players: r.match ? r.match.sides.map((s) => s.name) : null,
    matchLength: r.match?.matchLength ?? null,
    games: r.match?.games.length ?? null,
    score: r.match?.result?.score ?? null,
    errors: r.errors,
    warnings: r.warnings,
    infos: r.infos,
    ...(r.errors.some((d) => d.code === 'V-DAMAGED') ? { damaged: true } : {}),
  };
}

const VALUE_OPTS = new Set(['inbox', 'data', 'out', 'site', 'contributor', 'date', 'max-matches', 'max-mb', 'config', 'port', 'changed', 'body', 'author', 'report', 'comment', 'number', 'result', 'link', 'title', 'game', 'time', 'tags', 'sgf', 'xg', 'shard', 'to', 'base', 'sheet', 'apply', 'event', 'round', 'match-date', 'rejected', 'cache', 'sources']);
export function parseOpts(rest) {
  const opts = {};
  const pos = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (VALUE_OPTS.has(k)) opts[k] = rest[++i]; else opts[k] = true;
    } else pos.push(a);
  }
  return { opts, pos };
}

/** what an enrichment added: "sgf, 1 video link(s), event, round corrected" */
const addedText = (a) => [...a.attachments, a.links.length ? `${a.links.length} video link(s)` : '', a.tags.length ? `${a.tags.length} tag(s)` : '',
  Object.keys(a.meta ?? {}).length ? `${Object.keys(a.meta).join(', ')} corrected` : ''].filter(Boolean).join(', ');

export function helpText(cmd) {
  if (cmd && COMMANDS[cmd]) return `${COMMANDS[cmd].usage}\n  ${COMMANDS[cmd].summary}\n  Reference: docs/commands.md`;
  const w = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  return ['bgdb - backgammon game database tools', '', ...Object.entries(COMMANDS).map(([k, v]) => `  ${k.padEnd(w)}  ${v.summary}`), '', 'Run "bgdb help <command>" for the options. Reference: docs/commands.md'].join('\n');
}

/** an ASCII progress bar: `[##########..........]  50%  1500/3000` */
export function progressBar(done, total, width = 30) {
  const f = total ? done / total : 1;
  const n = Math.round(f * width);
  return `[${'#'.repeat(n)}${'.'.repeat(width - n)}] ${String(Math.floor(f * 100)).padStart(3)}%  ${done}/${total}`;
}

/** io.write (text without a line end) is given only for a terminal: progress bars are redrawn in place there, and printed as lines elsewhere */
export async function main(argv, io = { out: (s) => console.log(s), err: (s) => console.error(s), write: process.stdout.isTTY ? (s) => process.stdout.write(s) : undefined }) {
  const [cmd, ...rest] = argv;
  const { opts, pos } = parseOpts(rest);

  if (cmd === 'help' && opts.help) { io.out(helpText('help')); return 0; }
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    if (cmd === 'help' && pos[0] && !COMMANDS[pos[0]]) { io.err(`Unknown command "${pos[0]}".\n\n${helpText()}`); return 2; }
    io.out(helpText(cmd === 'help' ? pos[0] : undefined));
    return 0;
  }
  if (!COMMANDS[cmd]) { io.err(`Unknown command "${cmd}".\n\n${helpText()}`); return 2; }
  if (opts.help) { io.out(helpText(cmd)); return 0; }

  if (cmd === 'check') {
    if (pos.length === 0) { io.err(`Usage: ${COMMANDS.check.usage}`); return 2; }
    const files = pos.flatMap((a) => collect(a, !!opts.recursive, []));
    const reports = files.map((f) => checkFile(f, { salvage: !!opts.salvage, out: opts.out }));
    if (opts.json) io.out(JSON.stringify(reports, null, 2));
    else {
      for (const r of reports) {
        const head = r.ok
          ? `OK    ${r.id}  ${r.players.join(' vs ')}  ${r.matchLength}pt  ${r.games} games  ${r.score ? r.score.join('-') : ''}`
          : r.damaged ? 'DAMAGED' : 'ERROR';
        io.out(`${head}  (${path.basename(r.file)})`);
        for (const d of r.errors) io.out(`   error   ${d.code}${d.line ? ` line ${d.line}` : ''}: ${d.message}${d.hint ? `\n           how to fix: ${d.hint}` : ''}`);
        for (const d of r.warnings) io.out(`   warning ${d.code}: ${d.message}`);
        for (const d of r.infos) io.out(`   info    ${d.code}: ${d.message}`);
      }
      const bad = reports.filter((r) => !r.ok).length;
      io.out(`\n${reports.length} file(s) checked, ${reports.length - bad} valid, ${bad} with errors${reports.some((r) => r.damaged) ? ` (${reports.filter((r) => r.damaged).length} damaged: plays are missing)` : ''}.`);
    }
    return reports.every((r) => r.ok) ? 0 : 1;
  }

  if (cmd === 'ingest') {
    const config = loadConfig(opts.config ?? 'bgdb.config.json');
    const showDiag = (d) => io.out(`   ${d.severity === 'error' ? 'error  ' : d.severity === 'warning' ? 'warning' : 'info   '} ${d.code}${d.line ? ` line ${d.line}` : ''}: ${d.message}${d.hint ? `\n           how to fix: ${d.hint}` : ''}`);
    // each result is printed as soon as it is known: a long ingest shows what it does as it goes
    const showResult = (r) => {
      const name = path.basename(r.file);
      if (r.status === 'added') {
        const extra = [r.attachments?.length ? `+ ${r.attachments.join(', ')}` : '', r.links ? `${r.links} video link(s)` : ''].filter(Boolean).join('  ');
        io.out(`added      ${r.id}  (${name})${extra ? `  ${extra}` : ''}${r.partial ? '  PARTIAL (accepted)' : ''}`);
        for (const d of r.warnings.filter((x) => x.severity === 'warning')) showDiag(d);
      } else if (r.status === 'enriched') {
        io.out(`enriched   ${r.id}  (${name})  + ${addedText(r.added)}`);
        for (const w of r.skipped) io.out(`   note    ${w}`);
      } else if (r.status === 'duplicate') {
        io.out(`duplicate  already in the database as ${r.of}  (${name})`);
        for (const w of r.skipped ?? []) io.out(`   note    ${w}`);
      } else if (r.status === 'superseded') {
        io.out(`superseded ${name}: another transcription of ${r.by}${r.byStored ? ' (in the database)' : ''}, ${(r.ratio * 100).toFixed(1)}% of the rolls in common`);
        io.out(`   note    kept: ${RANK_TEXT[r.keeperRank]}; this one: ${RANK_TEXT[r.rank]}; first difference: ${r.diff}`);
        if (r.corrected?.length) io.out(`   note    ${r.corrected.join(', ')} of ${r.by} taken from this file`);
      } else if (r.status === 'waiting') {
        io.out(`waiting    ${name} stays in the inbox: ${r.reason}`);
      } else if (r.status === 'partial') {
        io.out(`PARTIAL    ${name} stays in the inbox: it can only be added partially. Fix it, or accept with {"accept": "partial"} in ${r.base}.bgdb.json (archives: --salvage)`);
        for (const d of r.errors) showDiag({ ...d, severity: 'error' });
        for (const d of r.notes) showDiag(d);
      } else {
        io.out(r.errors.some((d) => d.code === 'V-DAMAGED') ? `DAMAGED    ${name} stays in the inbox: plays are missing, it cannot be repaired` : `ERROR      ${name} stays in the inbox`);
        for (const d of r.errors) showDiag({ ...d, severity: 'error' });
      }
    };
    let rep;
    try {
      rep = ingest({
        inbox: opts.inbox ?? 'inbox', data: opts.data ?? 'data', config, contributor: opts.contributor, submittedAt: opts.date,
        dryRun: !!opts['dry-run'], salvage: !!opts.salvage, maxMatches: opts['max-matches'] ? parseInt(opts['max-matches'], 10) : undefined, maxMB: opts['max-mb'] ? parseFloat(opts['max-mb']) : undefined,
        onStart: (n) => io.out(`${n} match(es) to read in ${opts.inbox ?? 'inbox'}${opts['dry-run'] ? ' (dry run)' : ''}`), onStep: (t) => io.out(t), onResult: showResult,
      });
    } catch (e) { io.err(e.message); return 2; }
    for (const id of rep.sealed) io.out(`shard ${id} is full: sealed, a new shard was opened`);
    io.out(`\n${rep.added} added, ${rep.enriched} enriched, ${rep.duplicates} duplicate(s), ${rep.errors} with errors${rep.partial ? `, ${rep.partial} partial waiting for acceptance` : ''}${rep.superseded ? `, ${rep.superseded} superseded by a better transcription` : ''}${rep.waiting ? `, ${rep.waiting} waiting for the next data repository` : ''}${opts['dry-run'] ? ' (dry run: nothing written)' : ''}.`);
    const R = rep.repo;
    const sizeText = `repository: ${R.mb} MB (data ${R.dataMB} MB${R.gitMB === null ? '' : `, git ${R.gitMB} MB`})`;
    if (R.state === 'stop') io.out(`${sizeText}, above ${R.stopMB} MB: nothing more is added here. Open the next data repository (docs/growing.md).`);
    else if (R.state === 'warn') io.out(`${sizeText}, above ${R.warnMB} MB: time to prepare the next data repository (docs/growing.md).`);
    else io.out(`${sizeText}; warning at ${R.warnMB} MB, stop at ${R.stopMB} MB.`);
    if (R.closed) io.out('this data repository is closed: it takes no more contributions.');
    if (opts.report) fs.writeFileSync(opts.report, JSON.stringify({ schema: '1.0', added: rep.added, enriched: rep.enriched, duplicates: rep.duplicates, errors: rep.errors, partial: rep.partial, superseded: rep.superseded, waiting: rep.waiting, sealed: rep.sealed, repo: R }, null, 2) + '\n');
    if (opts.comment) fs.writeFileSync(opts.comment, `${ingestComment(rep, { siteUrl: config.siteUrl })}\n`);
    return rep.errors || rep.partial ? 1 : 0;                         // matches waiting for the next repository are not a failure: what was added is committed
  }

  if (cmd === 'meta') {
    const config = loadConfig(opts.config ?? 'bgdb.config.json');
    const inbox = opts.inbox ?? 'inbox';
    if (!fs.existsSync(inbox)) { io.err(`No inbox folder "${inbox}".`); return 2; }
    if (opts.apply) {
      if (!fs.existsSync(opts.apply)) { io.err(`No sheet "${opts.apply}".`); return 2; }
      const r = applySheet({ inbox, sheet: opts.apply, config, dryRun: !!opts['dry-run'], rejected: opts.rejected });
      for (const e of r.errors) io.out(`error: ${e}`);
      io.out(`${r.written} sidecar(s) ${opts['dry-run'] ? 'to write' : 'written'}, ${r.rejected} match(es) ${opts['dry-run'] ? 'to reject' : 'rejected (moved out of the inbox)'}, ${r.unchanged} unchanged${r.errors.length ? `, ${r.errors.length} row(s) refused` : ''}${opts['dry-run'] ? ' (dry run: nothing written)' : ''}.`);
      return r.errors.length ? 1 : 0;
    }
    const sheet = opts.sheet ?? 'meta-review.tsv';
    const r = writeSheet({ inbox, data: opts.data ?? 'data', sheet, config });
    for (const s of r.skipped) io.out(`skipped: ${s}`);
    io.out(`${r.files} match file(s) read; ${r.rows} row(s) to review in ${sheet}:`);
    io.out(`  ${r.same} that nothing tells apart from another match (give their round)`);
    io.out(`  ${r.nearDuplicate} transcriptions of one match that nothing ranks (put reject in the column action on the one to drop, or keep both)`);
    io.out(`  ${r.series} in a series that the file names or the times of play tell apart (check the round)`);
    io.out(`  ${r.name} with an event, round or date read from the file name only`);
    io.out(`  ${r.superseded} superseded by a better transcription of the same match: nothing to do, the ingest keeps the better one`);
    io.out(`  ${r.duplicate} copies of another file of the inbox (same moves): nothing to do, the ingest keeps one`);
    io.out(`Edit the columns date, event and round (an empty cell means none), then: bgdb meta --inbox ${inbox} --apply ${sheet}`);
    return 0;
  }

  if (cmd === 'build') {
    const config = loadConfig(opts.config ?? 'bgdb.config.json');
    let res;
    let shown = '';
    // a terminal redraws one bar per shard in place; a log or a pipe gets a line every 250 matches and at the end of each shard
    const onProgress = ({ shard, done, total }) => {
      const text = `shard ${shard} ${progressBar(done, total)} matches checked`;
      if (io.write) {
        const pct = `${shard} ${Math.floor((done / total) * 100)}`;
        if (pct !== shown || done === total) { shown = pct; io.write(`\r${text}${done === total ? '\n' : ''}`); }
      } else if (done % 250 === 0 || done === total) io.out(text);
    };
    try { res = build({ data: opts.data ?? 'data', out: opts.out ?? 'dist', site: opts.site ?? 'site', sources: opts.sources, config, onProgress, cache: opts['no-cache'] ? false : opts.cache }); } catch (e) { if (io.write && shown) io.write('\n'); io.err(e.message); return 2; }
    for (const e of res.errors) io.out(`error: ${e}`);
    for (const n of res.notes) io.out(`note: ${n}`);
    io.out(`built ${res.shards.length} shard(s), ${res.matches} match(es) into ${opts.out ?? 'dist'} (${res.parsed} read in full, ${res.cached} checked by an earlier build, ${res.trusted} trusted by their seal)${res.errors.length ? `, ${res.errors.length} error(s)` : ''}`);
    return res.errors.length ? 1 : 0;
  }

  if (cmd === 'enrich') {
    if (pos.length !== 1) { io.err(`Usage: ${COMMANDS.enrich.usage}`); return 2; }
    const config = loadConfig(opts.config ?? 'bgdb.config.json');
    const bytes = (f) => new Uint8Array(fs.readFileSync(f));
    let r;
    try {
      r = enrichByRef({
        data: opts.data ?? 'data', config, ref: pos[0], link: opts.link, title: opts.title, game: opts.game ? parseInt(opts.game, 10) : undefined, time: opts.time, tags: opts.tags,
        sgf: opts.sgf ? bytes(opts.sgf) : undefined, xg: opts.xg ? bytes(opts.xg) : undefined, contributor: opts.contributor, date: opts.date, dryRun: !!opts['dry-run'],
        event: opts.event, round: opts.round, matchDate: opts['match-date'],
      });
    } catch (e) { io.err(e.message); return 2; }
    for (const e of r.errors) io.out(`error: ${e}`);
    if (!r.ok) return 1;
    const a = r.result.added;
    for (const w of r.warnings) io.out(`note: ${w}`);
    io.out(r.result.nothing ? `${r.result.id}: nothing new to add` : `${r.result.id}: ${opts['dry-run'] ? 'would add' : 'added'} ${addedText(a)}`);
    return 0;
  }

  if (cmd === 'verify') {
    const res = verifyShards({ data: opts.data ?? 'data', shard: opts.shard ?? null, record: !!opts.record });
    let bad = 0;
    for (const r of res) {
      for (const e of r.errors.slice(0, 20)) io.out(`error: ${e}`);
      if (r.errors.length > 20) io.out(`... and ${r.errors.length - 20} more in shard ${r.id}`);
      bad += r.errors.length;
      io.out(`shard ${r.id} (${r.status}): ${r.matches} match(es), ${r.errors.length} error(s)${r.recorded ? ', digest recorded' : ''}`);
    }
    if (res.length === 0) io.out('no shard found');
    return bad ? 1 : 0;
  }

  if (cmd === 'split') {
    if (pos.length !== 1 || !opts.to || !opts.base) { io.err(`Usage: ${COMMANDS.split.usage}`); return 2; }
    const r = splitShard({ data: opts.data ?? 'data', id: pos[0], to: opts.to, base: opts.base, remove: !!opts.remove, configFile: opts.config ?? 'bgdb.config.json' });
    if (!r.ok) { io.err(r.error); return 1; }
    io.out(`copied shard ${pos[0]} to ${r.copiedTo}`);
    io.out(`hashes of its matches kept in ${r.hashFile} (commit it: duplicates stay recognised)`);
    if (r.removed) io.out(`removed here and listed in ${opts.config ?? 'bgdb.config.json'} as external:\n  ${JSON.stringify(r.entry)}`);
    else io.out(`still here. To finish: add this to "externalShards" in bgdb.config.json and delete data/${pos[0]}/ (or run again with --remove):\n  ${JSON.stringify(r.entry)}`);
    return 0;
  }

  if (cmd === 'review') {
    const config = loadConfig(opts.config ?? 'bgdb.config.json');
    const lines = (f) => fs.readFileSync(f, 'utf8').split(/\r?\n/).map((x) => x.trim().replace(/\\/g, '/')).filter(Boolean);
    let report;
    try { report = reviewInbox({ inbox: opts.inbox ?? 'inbox', data: opts.data ?? 'data', config }); } catch (e) { io.err(e.message); return 2; }
    const decision = classify(report, { changed: opts.changed ? lines(opts.changed) : null, body: opts.body ? fs.readFileSync(opts.body, 'utf8') : null, closed: config.closed });
    const comment = renderComment(report, decision, { author: opts.author, welcome: !!opts.welcome });
    if (opts.report) fs.writeFileSync(opts.report, JSON.stringify({ schema: '1.0', ...decision, summary: report.summary, groups: report.groups }, null, 2) + '\n');
    if (opts.comment) fs.writeFileSync(opts.comment, comment + '\n');
    for (const g of report.groups) {
      const s = g.summary;
      io.out(`${g.status === 'new' ? (g.partial ? 'new (partial, accepted)' : 'new       ') : g.status === 'duplicate' ? 'duplicate ' : g.status === 'partial' ? 'PARTIAL   ' : 'ERROR     '} ${g.files.join(', ')}${s ? `  (${s.players.join(' vs ')}, ${s.matchLength === 0 ? 'money' : `${s.matchLength}pt`})` : ''}`);
      for (const d of [...g.errors, ...g.warnings.filter((w) => w.severity === 'warning')]) io.out(`   ${d.severity === 'error' ? 'error  ' : 'warning'} ${d.code}${d.line ? ` line ${d.line}` : ''}: ${d.message}${d.hint ? `\n           how to fix: ${d.hint}` : ''}`);
    }
    io.out(`\nverdict: ${decision.verdict}${decision.reasons.length ? ` (${decision.reasons.join('; ')})` : ''}; ${report.summary.new} new, ${report.summary.duplicate} duplicate(s), ${report.summary.error} with errors; labels: ${decision.labels.join(', ')}${decision.autoMerge ? '; may be merged automatically' : ''}`);
    return ['needs-fix', 'empty', 'closed'].includes(decision.verdict) ? 1 : 0;
  }

  if (cmd === 'from-issue') {
    if (!opts.body || !opts.number) { io.err(`Usage: ${COMMANDS['from-issue'].usage}`); return 2; }
    const config = loadConfig(opts.config ?? 'bgdb.config.json');
    const body = fs.readFileSync(opts.body, 'utf8');
    // the ZIP of the Contribute page, dropped into the form: downloaded here, checked by issueToInbox
    const { zips } = parseIssueBody(body);
    const zip = zips.length === 1 && !config.closed ? await downloadAttachment(zips[0], { fetchFn: io.fetch ?? globalThis.fetch }) : null;
    const r = issueToInbox({ body, number: parseInt(opts.number, 10), inbox: opts.inbox ?? 'inbox', data: opts.data ?? 'data', config, zip });
    if (opts.result) fs.writeFileSync(opts.result, JSON.stringify(r, null, 2) + '\n');
    io.out(r.ok ? `written ${r.file}` : `not used: ${r.errors.map((e) => e.message).join(' ')}`);
    return r.ok ? 0 : 1;
  }

  if (cmd === 'anonymize') {
    if (pos.length === 0) { io.err(`Usage: ${COMMANDS.anonymize.usage}`); return 2; }
    const all = pos.flatMap((a) => collect(a, !!opts.recursive, [], new Set([...MATCH_EXT, '.xg'])));
    let changed = 0;
    let binary = 0;
    for (const file of all) {
      if (path.extname(file).toLowerCase() === '.xg') { binary++; io.out(`skipped    ${file}  (binary XG file: cannot be rewritten, and it may contain the identifier)`); continue; }
      const text = fs.readFileSync(file, 'latin1');            // byte for byte: the file keeps its encoding, only the identifier changes
      const r = anonymizeMatchText(text);
      if (!r.changed) continue;
      changed++;
      io.out(`${opts.write ? 'rewrote   ' : 'would change'} ${file}  (Match ID ${r.ids.map((i) => `"${i}"`).join(', ')})`);
      if (opts.write) fs.writeFileSync(file, r.text, 'latin1');
    }
    io.out(`\n${all.length - binary} text file(s) examined, ${changed} ${opts.write ? 'rewritten' : 'to change (nothing written: use --write)'}, ${binary} binary file(s) skipped.`);
    return opts.check && !opts.write && changed ? 1 : 0;
  }

  if (cmd === 'serve') {
    const root = path.resolve(pos[0] ?? 'site');
    const port = opts.port ? parseInt(opts.port, 10) : 8080;
    createStaticServer(root).listen(port, () => io.out(`Serving ${root} on http://localhost:${port}`));
    return new Promise(() => {}); // run until interrupted
  }
  return 2;
}
