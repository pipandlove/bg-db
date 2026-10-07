/**
 * Structured errors and diagnostics (spec: VA-02).
 * Every problem has a stable code, a human sentence, an optional location and a "how to fix" hint.
 */
export class BgdbError extends Error {
  /**
   * @param {string} code   stable code, e.g. "V-FORMAT"
   * @param {string} message human sentence
   * @param {{line?:number, game?:number, action?:number, hint?:string}} [where]
   */
  constructor(code, message, where = {}) {
    super(message);
    this.name = 'BgdbError';
    this.code = code;
    this.where = where;
  }
}

/** Build a diagnostic record (not thrown). severity: 'error' | 'warning' | 'info' */
export function diag(severity, code, message, where = {}) {
  return { severity, code, message, ...where };
}
