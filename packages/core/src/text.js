/**
 * Decoding the bytes of a text match file. Most files are UTF-8; older ones (Windows exports, tournament archives) are Windows-1252
 * ("Sürmeyan", "Grandell – Rome"), which a UTF-8 decoder would turn into "S�rmeyan". UTF-16 files carry a byte order mark.
 *   1. a UTF-16 byte order mark: UTF-16 (little or big endian)
 *   2. valid UTF-8 (with or without a byte order mark): UTF-8
 *   3. anything else: Windows-1252 (a superset of Latin-1 that also has the curly quotes and dashes these files use)
 */
const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** @param {Uint8Array} bytes @returns {{text: string, encoding: 'utf-8'|'utf-16le'|'utf-16be'|'windows-1252'}} */
export function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'utf-16le' };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'utf-16be' };
  try {
    return { text: UTF8.decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}
