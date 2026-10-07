/**
 * Anonymisation of site match identifiers (decision 0010): the "; [Match ID "..."]" tag of a text match file is
 * replaced by a constant. Player handles are kept on purpose. Binary .xg files cannot be rewritten.
 */
export const ANON_ID = 'anonymized';

const RE = /^(;\s*\[Match ID\s+")([^"\r\n]*)("\])/gm;

/** @returns {{text:string, ids:string[], changed:boolean}} ids = the identifiers that were replaced */
export function anonymizeMatchText(text) {
  const ids = [];
  const out = text.replace(RE, (m, a, id, b) => {
    if (id === ANON_ID) return m;
    ids.push(id);
    return `${a}${ANON_ID}${b}`;
  });
  return { text: out, ids, changed: ids.length > 0 };
}
