/**
 * A tiny SVG tree: build once, then turn it into a string (export, tests) or into DOM nodes (the page).
 * Text and attribute values are escaped / set with setAttribute and textContent only, never parsed as markup.
 */
export const el = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat().filter((c) => c !== null && c !== undefined && c !== false) });

const NS = 'http://www.w3.org/2000/svg';

export const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const num = (v) => (typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v));

/** @returns {string} markup */
export function serialize(node) {
  if (typeof node === 'string' || typeof node === 'number') return escapeXml(node);
  const attrs = Object.entries(node.attrs).filter(([, v]) => v !== null && v !== undefined && v !== false)
    .map(([k, v]) => ` ${k}="${escapeXml(num(v))}"`).join('');
  if (node.children.length === 0) return `<${node.tag}${attrs}/>`;
  return `<${node.tag}${attrs}>${node.children.map(serialize).join('')}</${node.tag}>`;
}

/** a standalone SVG file */
export const toSvgFile = (root) => `<?xml version="1.0" encoding="UTF-8"?>\n${serialize({ ...root, attrs: { xmlns: NS, ...root.attrs } })}\n`;

/** @returns {SVGElement} */
export function toDom(node, doc = document) {
  if (typeof node === 'string' || typeof node === 'number') return doc.createTextNode(String(node));
  const e = doc.createElementNS(NS, node.tag);
  for (const [k, v] of Object.entries(node.attrs)) if (v !== null && v !== undefined && v !== false) e.setAttribute(k, num(v));
  for (const c of node.children) e.append(toDom(c, doc));
  return e;
}
