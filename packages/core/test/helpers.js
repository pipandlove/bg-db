import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
export const read = (rel) => fs.readFileSync(path.join(FIXTURES, rel), 'utf8');

/** every text fixture (.mat, .txt, .sgf) as [relativePath, text]; the folders named "invalid" hold files that must be refused, like for `bgdb check --recursive` */
export function allTextFixtures() {
  const out = [];
  const rec = (d) => {
    for (const e of fs.readdirSync(path.join(FIXTURES, d), { withFileTypes: true })) {
      const rel = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== 'invalid') rec(rel); }
      else if (/\.(mat|txt|sgf)$/i.test(e.name)) out.push([rel.split(path.sep).join('/'), read(rel)]);
    }
  };
  rec('.');
  return out.sort((a, b) => a[0].localeCompare(b[0]));
}
