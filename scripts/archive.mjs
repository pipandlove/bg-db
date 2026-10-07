#!/usr/bin/env node
/**
 * Import an archive in a working folder, one step at a time (docs/importing-an-archive.md).
 *
 *   node scripts/archive.mjs <dir> <step> [--contributor name] [--port 8080] [--yes]
 *
 * Steps, in order:
 *   init       create <dir>/source, inbox, data, rejected; copy source/ into an empty inbox/; remember --contributor
 *   dry-run    what the ingest would add, find as duplicates, refuse (nothing written)          -> dry-run.log
 *   review     the review sheet of event, round and date                                         -> meta-review.tsv
 *   apply      write the reviewed sheet into the .bgdb.json sidecars, then list what is left     -> meta-left.tsv
 *   ingest     the real ingest (--salvage); its counts are compared with the dry run             -> ingest.log
 *   build      the site                                                                           -> dist/
 *   serve      browse it (http://localhost:8080)
 *   status     what is in the folder, and the next step
 *   commands   print the plain commands of every step, with <dir> filled in
 *   reset      erase inbox/, data/, dist/, sheets and logs, and copy source/ into inbox/ again (asks for --yes)
 *
 * Every step shows its output and also writes it to its log; the exit code is the command's. No dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../packages/cli/src/cli.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STEPS = ['init', 'dry-run', 'review', 'apply', 'ingest', 'build', 'serve', 'status', 'commands', 'reset'];
const NEXT = { init: 'dry-run', 'dry-run': 'review', review: 'apply', apply: 'ingest', ingest: 'build', build: 'serve' };
const SUMMARY = /^\d+ added, \d+ enriched, \d+ duplicate\(s\), \d+ with errors.*$/m;

function usage() {
  return 'Usage: node scripts/archive.mjs <dir> <step> [--contributor name] [--port 8080] [--yes]\nSteps: ' + STEPS.join(', ') + '\nGuide: docs/importing-an-archive.md';
}

/** the paths of a working folder */
export function layout(dir) {
  const d = path.resolve(dir);
  const p = (x) => path.join(d, x);
  return {
    dir: d, source: p('source'), inbox: p('inbox'), data: p('data'), rejected: p('rejected'), dist: p('dist'),
    sheet: p('meta-review.tsv'), left: p('meta-left.tsv'), dryLog: p('dry-run.log'), ingestLog: p('ingest.log'), state: p('archive.json'),
  };
}

const readState = (L) => { try { return JSON.parse(fs.readFileSync(L.state, 'utf8')); } catch { return {}; } };
const writeState = (L, s) => fs.writeFileSync(L.state, `${JSON.stringify(s, null, 2)}\n`);
const countFiles = (d) => {
  if (!fs.existsSync(d)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? countFiles(path.join(d, e.name)) : 1;
  return n;
};

/** the plain commands of every step, for a person who prefers to type them */
export function commandLines(L, contributor = '<name>') {
  const c = `--contributor ${contributor}`;
  return [
    ['dry-run', `npm run bgdb -- ingest --inbox ${L.inbox} --data ${L.data} --salvage ${c} --dry-run 2>&1 | tee ${L.dryLog}`],
    ['review', `npm run bgdb -- meta --inbox ${L.inbox} --data ${L.data} --sheet ${L.sheet}`],
    ['apply', `npm run bgdb -- meta --inbox ${L.inbox} --apply ${L.sheet}`],
    ['apply', `npm run bgdb -- meta --inbox ${L.inbox} --data ${L.data} --sheet ${L.left}`],
    ['ingest', `npm run bgdb -- ingest --inbox ${L.inbox} --data ${L.data} --salvage ${c} 2>&1 | tee ${L.ingestLog}`],
    ['build', `npm run bgdb -- build --data ${L.data} --out ${L.dist}`],
    ['serve', `npm run bgdb -- serve ${L.dist}`],
  ];
}

/** run a bgdb command: each line goes to the terminal and, when a log is given, to the log too, as it comes (like tee) */
async function bgdb(args, { out, log, write }) {
  const lines = [];
  if (log) fs.writeFileSync(log, '');
  const line = (s) => { lines.push(s); out(s); if (log) fs.appendFileSync(log, `${s}\n`); };
  const code = await main([...args, '--config', path.join(REPO, 'bgdb.config.json')], { out: line, err: line, write });
  return { code, text: lines.join('\n') };
}

/**
 * Run one step.
 * @param {{dir:string, step:string, contributor?:string, port?:number, yes?:boolean, out?:(s:string)=>void}} o
 * @returns {Promise<number>} the exit code
 */
export async function runStep(o) {
  const out = o.out ?? ((s) => console.log(s));
  const L = layout(o.dir);
  const state = readState(L);
  if (o.contributor) state.contributor = o.contributor;
  const contributor = state.contributor;
  const needs = (...dirs) => {
    const missing = dirs.filter((d) => !fs.existsSync(d));
    if (missing.length) { out(`Missing ${missing.join(', ')}: run the step "init" first.`); return false; }
    return true;
  };
  const next = (code) => { if (code === 0 && NEXT[o.step]) out(`\nNext: node scripts/archive.mjs ${L.dir} ${NEXT[o.step]}`); return code; };

  switch (o.step) {
    case 'init': {
      for (const d of [L.source, L.inbox, L.data, L.rejected]) fs.mkdirSync(d, { recursive: true });
      if (fs.existsSync(L.state) || o.contributor) writeState(L, state);
      const src = countFiles(L.source);
      if (countFiles(L.inbox) === 0 && src > 0) { fs.cpSync(L.source, L.inbox, { recursive: true }); out(`copied ${src} file(s) from source/ to inbox/`); }
      out(`${L.dir}: source ${src}, inbox ${countFiles(L.inbox)}, data ${countFiles(L.data)} file(s); contributor: ${contributor ?? 'not set (give --contributor)'}`);
      if (src === 0) { out('Put the archive in source/, then run "init" again.'); return 0; }
      return next(0);
    }
    case 'dry-run':
    case 'ingest': {
      if (!needs(L.inbox, L.data)) return 2;
      if (!contributor) { out('Give the contributor: --contributor <name> (it is remembered).'); return 2; }
      writeState(L, state);
      const dry = o.step === 'dry-run';
      const r = await bgdb(['ingest', '--inbox', L.inbox, '--data', L.data, '--salvage', '--contributor', contributor, ...(dry ? ['--dry-run'] : [])], { out, log: dry ? L.dryLog : L.ingestLog });
      const summary = r.text.match(SUMMARY)?.[0] ?? null;
      const lookAlike = (r.text.match(/Nothing tells it apart/g) ?? []).length;
      out(`\nlog: ${dry ? L.dryLog : L.ingestLog}${lookAlike ? `; ${lookAlike} match(es) that the list cannot tell apart (see step "review")` : ''}`);
      if (dry) { state.dryRun = summary?.replace(/ \(dry run.*$/, '').replace(/\.$/, '') ?? null; writeState(L, state); }
      else if (state.dryRun && summary) {
        const now = summary.replace(/\.$/, '');
        const [a, b] = [state.dryRun, now].map((s) => s.match(/^(\d+) added, \d+ enriched, (\d+) duplicate/)?.slice(1).join('/'));
        out(a === b ? 'Same counts as the dry run.' : `DIFFERENT from the dry run (${state.dryRun}): find out why before going on.`);
      }
      // refused files stay in the inbox and make the ingest exit with 1: that is expected, not a failure of the step
      const refused = (r.text.match(/^(ERROR|DAMAGED|PARTIAL) /gm) ?? []).length;
      if (refused) out(`${refused} file(s) refused: they stay in the inbox (move them to rejected/ if you want a clean run).`);
      return next(r.code === 1 && refused ? 0 : r.code);
    }
    case 'review': {
      if (!needs(L.inbox)) return 2;
      const r = await bgdb(['meta', '--inbox', L.inbox, '--data', L.data, '--sheet', L.sheet], { out });
      if (r.code === 0) out(`\nOpen ${L.sheet}, edit the columns date, event and round, save it as tab-separated text.`);
      return next(r.code);
    }
    case 'apply': {
      if (!fs.existsSync(L.sheet)) { out(`No ${L.sheet}: run the step "review" first.`); return 2; }
      const r = await bgdb(['meta', '--inbox', L.inbox, '--apply', L.sheet], { out });
      if (r.code === 2) return 2;
      out('\nWhat is left:');
      const left = await bgdb(['meta', '--inbox', L.inbox, '--data', L.data, '--sheet', L.left], { out });
      return next(r.code || left.code);
    }
    case 'build': {
      if (!needs(L.data)) return 2;
      // the progress bar is drawn in place only on a terminal of our own (not when a caller collects the output)
      const write = !o.out && process.stdout.isTTY ? (s) => process.stdout.write(s) : undefined;
      return next((await bgdb(['build', '--data', L.data, '--out', L.dist, '--site', path.join(REPO, 'site')], { out, write })).code);
    }
    case 'serve': {
      if (!fs.existsSync(L.dist)) { out('No dist/: run the step "build" first.'); return 2; }
      return bgdb(['serve', L.dist, '--port', String(o.port ?? 8080)], { out }).then((r) => r.code);
    }
    case 'status': {
      const exists = (f) => fs.existsSync(f);
      out(`${L.dir}`);
      out(`  source ${countFiles(L.source)}, inbox ${countFiles(L.inbox)}, rejected ${countFiles(L.rejected)}, data ${countFiles(L.data)} file(s)${exists(L.dist) ? ', dist/ built' : ''}`);
      out(`  contributor: ${contributor ?? 'not set'}; dry run: ${state.dryRun ?? 'not run'}`);
      for (const f of [L.sheet, L.left, L.dryLog, L.ingestLog]) if (exists(f)) out(`  ${path.basename(f)}`);
      const step = !exists(L.inbox) ? 'init' : !state.dryRun ? 'dry-run' : !exists(L.sheet) ? 'review' : !exists(L.left) ? 'apply' : countFiles(L.data) === 0 ? 'ingest' : !exists(L.dist) ? 'build' : 'serve';
      out(`Next: node scripts/archive.mjs ${L.dir} ${step}`);
      return 0;
    }
    case 'commands': {
      out(`W=${L.dir}   # the commands of every step, from the root of the repository (${REPO})\n`);
      for (const [step, line] of commandLines(L, contributor)) out(`# ${step}\n${line}\n`);
      return 0;
    }
    case 'reset': {
      const targets = [L.inbox, L.data, L.dist, L.sheet, L.left, L.dryLog, L.ingestLog].filter((f) => fs.existsSync(f));
      if (!o.yes) {
        out(`This erases:\n${targets.map((t) => `  ${t}`).join('\n') || '  (nothing)'}\nand copies source/ (${countFiles(L.source)} file(s)) into inbox/ again. Run it again with --yes.`);
        return 1;
      }
      if (countFiles(L.source) === 0) { out('source/ is empty: nothing to start again from. Nothing was erased.'); return 2; }
      for (const t of targets) fs.rmSync(t, { recursive: true, force: true });
      delete state.dryRun;
      writeState(L, state);
      fs.mkdirSync(L.data, { recursive: true });
      fs.cpSync(L.source, L.inbox, { recursive: true });
      out(`erased ${targets.length} item(s); inbox/ holds ${countFiles(L.inbox)} file(s) again.`);
      out(`\nNext: node scripts/archive.mjs ${L.dir} dry-run`);
      return 0;
    }
    default:
      out(usage());
      return 2;
  }
}

/** command-line options: <dir> <step> [--contributor name] [--port n] [--yes] */
export function parseArgs(argv) {
  const pos = [];
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--contributor') o.contributor = argv[++i];
    else if (a === '--port') o.port = parseInt(argv[++i], 10);
    else if (a === '--yes') o.yes = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else pos.push(a);
  }
  return { ...o, dir: pos[0], step: pos[1] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const o = parseArgs(process.argv.slice(2));
  if (o.help || !o.dir || !STEPS.includes(o.step)) { console.log(usage()); process.exitCode = o.help ? 0 : 2; }
  else process.exitCode = await runStep(o);
}
