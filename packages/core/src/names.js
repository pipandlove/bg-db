/** Name normalisation for matching and search: NFC, no accents, lower case, single spaces (spec NO-01, SE-05). */
export function normalizeName(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .normalize('NFC')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}
