/** Reading a match in any supported format (text .mat/.txt, GNU Backgammon .sgf, eXtreme Gammon .xg): detect the format, parse, validate. */
import { parseMat } from './mat.js';
import { parseSgf } from './sgf.js';
import { parseXg, isXg } from './xg.js';
import { validateMatch } from './validate.js';
import { BgdbError } from './errors.js';
import { decodeText } from './text.js';

/** Detect the input format from the text. */
export function detectFormat(text) {
  const t = text.replace(/^\uFEFF/, '').trimStart();
  if (t.startsWith('(;')) return 'sgf';
  if (t.startsWith('RGMH')) return 'xg';
  return 'mat';
}

const done = (parse, format, opts) => {
  try {
    return { ...validateMatch(parse(), opts), format };
  } catch (e) {
    if (e instanceof BgdbError) return { ok: false, format, errors: [{ severity: 'error', code: e.code, message: e.message, ...e.where }], warnings: [], infos: [] };
    throw e;
  }
};

/**
 * Parse and validate a match from text in any text format (.mat, .txt, .sgf). A binary eXtreme Gammon file must be given to readMatchBytes.
 * @returns {{ok:boolean, errors:object[], warnings:object[], infos:object[], match?:object, format:string}}
 */
export function readMatch(text, opts = {}) {
  const format = detectFormat(text);
  if (format === 'xg') {
    return { ok: false, format, errors: [{ severity: 'error', code: 'V-FORMAT', message: 'An eXtreme Gammon file is binary: it has to be read from its bytes, not from text.' }], warnings: [], infos: [] };
  }
  return done(() => (format === 'sgf' ? parseSgf(text) : parseMat(text)), format, opts);
}

/** The same from the bytes of a file: an eXtreme Gammon file (.xg) is read by the binary reader, anything else as text. */
export function readMatchBytes(bytes, opts = {}) {
  if (isXg(bytes)) return done(() => parseXg(bytes), 'xg', opts);
  const { text, encoding } = decodeText(bytes);
  const r = readMatch(text, opts);
  if (encoding !== 'utf-8') {
    r.infos = [{ severity: 'info', code: 'V-FORMAT', message: `The file is not UTF-8: it was read as ${encoding === 'windows-1252' ? 'Windows-1252 (Western European)' : encoding.toUpperCase()}` }, ...(r.infos ?? [])];
    r.encoding = encoding;
  }
  return r;
}

/**
 * Only the parse, without validation: the players, length, date and headers of a file, quickly (for the review of metadata, `bgdb meta`).
 * @returns {{ok:boolean, format:string, match?:object, error?:string}}
 */
export function parseMatchBytes(bytes) {
  try {
    if (isXg(bytes)) return { ok: true, format: 'xg', match: parseXg(bytes) };
    const { text } = decodeText(bytes);
    const format = detectFormat(text);
    return { ok: true, format, match: format === 'sgf' ? parseSgf(text) : parseMat(text) };
  } catch (e) {
    if (e instanceof BgdbError) return { ok: false, format: null, error: e.message };
    throw e;
  }
}
