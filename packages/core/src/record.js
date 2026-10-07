/**
 * Records derived from a validated match: the sidecar metadata stored next to each match file in a shard
 * (profile "mat+meta") and the lossless client format "bgdb-json" (profile "bgdb-json").
 * Field lists are documented in docs/formats/shard-and-index.md.
 */


export const CORE_VERSION = '0.3.0';

export function gameSummary(g) {
  return { points: g.result.points, kind: g.result.kind, how: g.result.how, cube: g.result.cube, ...(g.resultOnly ? { resultOnly: true } : {}) };
}

/** @returns {object} the content of "<hash>.meta.json" */
export function buildMeta(match, { id, contentHash, canonicalVersion, originalHash, contributor = null, submittedAt = null, license = 'CC0-1.0', warnings = [], attachments = [], links }) {
  const sides = match.sides.map((s) => {
    const o = { name: s.name };
    if (s.rating !== undefined) { o.rating = s.rating; o.experience = s.experience; }
    return o;
  });
  return {
    schema: '1.0',
    id,
    contentHash,
    canonicalVersion,
    sides,
    matchLength: match.matchLength,
    rules: match.rules,
    date: match.date ?? null,
    time: match.time ?? null,
    event: match.event ?? null,
    round: match.round ?? null,
    result: match.result ?? null,
    games: match.games.map(gameSummary),
    tags: [],
    remarks: match.remarks ?? [],
    illegalPlays: match.illegalPlays ?? [],
    links: links ?? match.links ?? [],
    attachments,
    provenance: {
      originalFormat: match.provenance.originalFormat,
      dialect: match.provenance.dialect,
      site: match.provenance.site ?? null,
      originalHash,
      importer: { name: 'bgdb', version: CORE_VERSION },
      contributor,
      submittedAt,
      license,
    },
    warnings,
  };
}

/**
 * "bgdb-json": everything needed to replay a match, compactly.
 * move = [from, to, hit(0|1)] in the mover's own numbering (bar = 25, off = 0).
 * action = { s: side, k: 'm'|'d'|'t'|'p', d?: [d1,d2], m?: moves, c?: cube, i?: 1 }   (m = move/roll, d = double, t = take, p = drop;
 *   i = 1: an illegal play that was made and accepted as played; ab = 1: the last roll of a game that stopped in the middle of the turn)
 */
export function toBgdbJson(match, meta) {
  return {
    schema: '1.0',
    id: meta.id,
    sides: meta.sides,
    matchLength: match.matchLength,
    rules: match.rules,
    date: match.date ?? null,
    event: match.event ?? null,
    round: match.round ?? null,
    result: match.result ?? null,
    links: meta.links ?? [],
    remarks: meta.remarks ?? [],
    illegalPlays: meta.illegalPlays ?? [],
    attachments: (meta.attachments ?? []).map((a) => ({ kind: a.kind, file: a.file, verified: a.verified, analysis: a.analysis })),
    games: match.games.map((g) => ({
      index: g.index,
      startScore: g.startScore,
      crawford: g.crawford,
      ...(g.resultOnly ? { ro: 1 } : {}),
      result: gameSummary(g) && { winner: g.result.winner, ...gameSummary(g) },
      actions: g.actions.filter((a) => !a.hidden).map((a) => {
        if (a.kind === 'move') return { s: a.side, k: 'm', d: a.dice, m: a.moves.map((m) => [m.from, m.to, m.hit ? 1 : 0]), ...(a.illegal ? { i: 1 } : {}), ...(a.abandoned ? { ab: 1 } : {}) };
        if (a.kind === 'double') return { s: a.side, k: 'd', c: a.cube };
        return { s: a.side, k: a.kind === 'take' ? 't' : 'p' };
      }),
    })),
  };
}


