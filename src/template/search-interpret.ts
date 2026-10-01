/**
 * What could this query MEAN?
 *
 * After the removal of chunked search, a query means exactly its own terms:
 * each is matched as a word, a word prefix, or a start-aligned morpheme (and
 * orthographic variants), and quoted runs are matched literally. There is no
 * longer any "this unbroken run might secretly be several words" reading —
 * `soccrit` is just a word nobody has, while `soc crit` is two terms.
 *
 * This module is kept as the single place that reports a query's terms and
 * shape, so the scorer and callers agree on what is being searched.
 */

import { queryTerms } from './search-score';

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

export type InterpretationKind = 'words'; // the query's own terms

export interface Interpretation {
  /** Terms to match, in order. */
  terms: string[];
  kind: InterpretationKind;
  /**
   * A small penalty added to the score so a lower-priority reading cannot
   * outrank a higher one. Only the unspaced form is nudged.
   */
  penalty: number;
}

/** The interpretation of a query for an entry — always the query's own terms. */
export function interpretationsFor(
  _entry: {
    title?: string | null;
    authorText?: string | null;
    abstract?: string | null;
    venueText?: string | null;
  },
  query: string,
  _opts: { includeAbstract?: boolean; includeVenue?: boolean } = {}
): Interpretation[] {
  const shape = queryShape(query);
  if (shape.words.length === 0) return [];
  return [
    {
      terms: shape.words,
      kind: 'words',
      // The spaced form is trusted slightly more: the space asserts boundaries.
      penalty: shape.spaced ? 0 : 0.02,
    },
  ];
}

/**
 * Is this query worth searching at all?
 *
 * Any query with at least one term is searchable now: a term matches as a word,
 * a prefix, or a morpheme, so even a single short word can match.
 */
export function isSearchableQuery(query: string): boolean {
  return queryShape(query).words.length > 0;
}
