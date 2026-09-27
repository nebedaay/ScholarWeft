/**
 * What could this query MEAN?
 *
 * One query produces an ordered list of **interpretations**. Every interpretation
 * is searched and the results are merged and ranked — there is no separate code
 * path for spaced and unspaced queries. The space only asserts the word
 * boundaries, so it promotes the explicit split to the top of the list; the same
 * candidate interpretations remain available either way.
 *
 * This replaces the earlier design where `@@bourdieu critique` and
 * `@@bourdieucritique` took different routes: the spaced form generated
 * per-term searches while the unspaced form generated none, so the two returned
 * systematically different result SETS (the joined form searched a strictly
 * smaller interpretation space).
 *
 * Priority, following the governing principle — always try the coherent option
 * first, then abbreviations, then chunks:
 *
 *   1. explicit words        — the query as typed when it is already spaced
 *   2. coherent split        — the run split into real words of this entry
 *   3. chunk alignment       — prefixes of successive words (soccri)
 *
 * Interpretation 2 and 3 depend on the entry (only the entry's own words can
 * tell us how a run splits), so `interpretationsFor(entry, query)` is per-entry
 * while `queryShape()` describes the query alone.
 */

import {
  MIN_CHUNK,
  hasCoherentSplit,
  prefixChunks,
  queryTerms,
} from './search-score';

/** How a query was written, independent of any entry. */
export interface QueryShape {
  /** The query split on whitespace. */
  words: string[];
  /** True when the user typed at least one space. */
  spaced: boolean;
  /** The query with whitespace removed (`bourdieu critique` → `bourdieucritique`). */
  run: string;
}

export function queryShape(query: string): QueryShape {
  const words = queryTerms(query);
  const spaced = /\s/.test(query.trim());
  return { words, spaced, run: words.join('') };
}

export type InterpretationKind =
  | 'words' // the spaced words, or a single word
  | 'split' // the run split into coherent words of this entry
  | 'chunks'; // the run aligned as prefixes of successive words

export interface Interpretation {
  /** Terms to match, in order. */
  terms: string[];
  kind: InterpretationKind;
  /**
   * A small penalty added to the score so a lower-priority interpretation
   * cannot outrank a higher one that matched equally well. Never large enough
   * to reorder genuinely different matches.
   */
  penalty: number;
}

/**
 * Every interpretation of `query` for a given entry, best first.
 *
 * Always includes the query's own words (so a spaced query and a joined query
 * both start from the words they contain), then adds the entry-dependent
 * readings. Returning a LIST rather than picking one is the point: the caller
 * searches all of them and ranks the union, so the two query forms see the same
 * interpretations.
 */
export function interpretationsFor(
  entry: { title?: string | null; authorText?: string | null },
  query: string
): Interpretation[] {
  const shape = queryShape(query);
  if (shape.words.length === 0) return [];

  const title = entry.title ?? '';
  const author = entry.authorText ?? '';
  const combined = `${author} ${title}`;

  const out: Interpretation[] = [];

  // 1. The words as typed. A spaced query's words ARE its interpretation; a
  //    single unbroken run is one opaque term here and is refined below.
  out.push({
    terms: shape.words,
    kind: 'words',
    // The spaced form is trusted slightly more: the space asserts boundaries.
    penalty: shape.spaced ? 0 : 0.02,
  });

  // The remaining readings apply to an UNBROKEN run — the case where the words
  // are not yet known. A spaced query already has them.
  if (!shape.spaced || shape.words.length === 1) {
    // 2. Coherent split: the run is real words this entry contains, possibly
    //    spanning fields (`bourdieucritique` = bourdieu + critique).
    const split = hasCoherentSplit(combined, shape.run);
    if (split && split.length > 1) {
      out.push({ terms: split, kind: 'split', penalty: 0.05 });
    }

    // 3. Chunk alignment: prefixes of successive words (`soccri`). Only when no
    //    coherent reading exists — a series of coherent words is unlikely to be
    //    a search for smaller chunks.
    if (!split) {
      const best = [
        prefixChunks(title, shape.run),
        prefixChunks(author, shape.run),
        prefixChunks(combined, shape.run),
      ].reduce((a, b) => (b.words > a.words ? b : a));
      if (best.full && best.words > 0) {
        out.push({ terms: best.chunks, kind: 'chunks', penalty: 0.9 });
      }
    }
  }

  // De-duplicate identical term lists, keeping the best (lowest) penalty.
  const seen = new Map<string, Interpretation>();
  for (const interp of out) {
    const key = interp.terms.join('\u0000');
    const prior = seen.get(key);
    if (!prior || interp.penalty < prior.penalty) seen.set(key, interp);
  }
  return [...seen.values()].sort((a, b) => a.penalty - b.penalty);
}

/**
 * Is this query worth searching at all?
 *
 * A bare run shorter than `MIN_CHUNK` cannot be interpreted as words, a split,
 * or chunks, so it has nothing to match.
 */
export function isSearchableQuery(query: string): boolean {
  const shape = queryShape(query);
  if (shape.words.length === 0) return false;
  if (shape.words.length > 1) return true;
  return shape.run.length >= MIN_CHUNK;
}
