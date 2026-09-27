/**
 * The `@` / `@@` / `@@@` autocomplete tiers.
 *
 * Three levels of reach, all served by our OWN index — no ZotLit needed:
 *
 *   `@`    citekey
 *   `@@`   + title and creators
 *   `@@@`  + abstract
 *
 * Abstract ranks BELOW title and author, so a book whose wording merely appears
 * in its abstract never outranks one whose title actually matches.
 *
 * These are pure rules (Fuse KEYS + a small re-rank), so they are testable
 * without a running Obsidian or a built index.
 *
 * TODO (roadmap, deliberately not done here): rank by relative contiguity,
 * term order, and closeness to the start of the title. That needs a real scorer
 * rather than Fuse weights; see HANDOFF.md "Direction update 2026-09-26b".
 */

import type { PartialCSLEntry } from '../bib/types';

export type SearchTier = 'citekey' | 'title' | 'abstract';

/** Everything the tier needs from the cached entry, injected for testability. */
export interface SearchWeights {
  title: number;
  creators: number;
  abstract: number;
  citekey: number;
}

/**
 * Per-field weights per tier. Title and creators dominate everywhere; abstract
 * is always the smallest weight so it can only ever act as a tiebreaker.
 */
export function tierWeights(tier: SearchTier): SearchWeights {
  switch (tier) {
    case 'citekey':
      return { citekey: 0.6, title: 0.25, creators: 0.1, abstract: 0 };
    case 'title':
      return { citekey: 0.1, title: 0.6, creators: 0.25, abstract: 0 };
    case 'abstract':
      // Abstract is the WEAKEST signal, strictly below creators, so an item
      // whose wording only appears in its abstract cannot outrank one matched
      // on its author — let alone its title.
      return { citekey: 0.05, title: 0.55, creators: 0.25, abstract: 0.15 };
  }
}

/**
 * Fuse's `threshold`: 0 is a perfect match, 1 matches anything.
 *
 * The ABSTRACT tier is deliberately far looser than the others. Fuse's score is
 * length-normalised, so a genuine term buried inside a long abstract scores
 * much worse than the same term in a short title — an exact abstract match can
 * score 0.65-0.9 depending only on where it sits and how long the abstract is.
 * A tight threshold silently discards real abstract hits (this is exactly how
 * "maghrebian" failed to find a work whose abstract contains it). The abstract
 * tier compensates with `ignoreLocation` plus a loose threshold, then relies on
 * the field WEIGHTS and `rerankKey` to keep ordering sensible.
 */
export const TIER_THRESHOLD: Record<SearchTier, number> = {
  citekey: 0.35,
  title: 0.3,
  abstract: 0.85,
};

/**
 * Whether Fuse should ignore where in the field the match sits.
 *
 * MUST be true for the abstract tier: with Fuse's default `location: 0`, a term
 * appearing late in a long field is penalised as though it were a poor match,
 * which is a length artefact rather than a relevance signal. Titles are short
 * enough not to need it.
 */
export const TIER_IGNORE_LOCATION: Record<SearchTier, boolean> = {
  citekey: true,
  title: true,
  abstract: true,
};

/** Nothing shorter than this is worth matching. */
export const MIN_MATCH_CHARS = 2;

/**
 * A light re-rank of Fuse's results, applied on top of its own ordering.
 *
 * Fuse's score is length-biased: a long title that matches only loosely can
 * outrank a short one that matches well, which is how "Slightly" surfaces
 * "The Social Life of Ghosttowns in Libya". This nudges such results DOWN
 * without attempting full relevance scoring (that is the roadmap item).
 *
 * Rules, in order:
 *  1. A match where the query appears in the title as a CONTIGUOUS run beats
 *     a scattered one ("French History" beats "History of ... France").
 *  2. A match in the title itself beats a match only in creators or abstract.
 *  3. Otherwise Fuse's own order stands.
 *
 * Pure, so the behaviour is testable; `fuseScore` is Fuse's own score (lower is
 * better) and the result is a comparable sort key (lower is better).
 */
export interface RankInput {
  title?: string | null;
  authorText?: string | null;
  abstract?: string | null;
  /** Fuse's own score for this result (lower is better). */
  fuseScore: number;
}

/** Case- and diacritic-insensitive containment, as a contiguous substring. */
function containsPhrase(haystack: string | null | undefined, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Lower is better. Offsets keep Fuse's ordering as the final tiebreaker, so
 * this can only ever refine its order, never invert it wholesale.
 */
export function rerankKey(
  input: RankInput,
  query: string,
  normalize: (s: string) => string = (s) => s
): number {
  const q = normalize(query.trim());
  const title = normalize(input.title ?? '');
  const author = normalize(input.authorText ?? '');
  const abstract = normalize(input.abstract ?? '');

  let adjustment = 0;
  if (q) {
    const inTitle = containsPhrase(title, q);
    const inAuthor = containsPhrase(author, q);
    const inAbstract = containsPhrase(abstract, q);
    if (inTitle) adjustment -= 1;
    // Contiguous in the title is the strongest signal we can extract cheaply.
    else if (inAuthor) adjustment -= 0.3;
    else if (inAbstract) adjustment += 0.5;
    // Matched nothing contiguously: it only got here on fuzziness, so demote it
    // irrespective of how long the title is.
    else adjustment += 1;
  }
  return input.fuseScore + adjustment;
}

/**
 * Split a query into search terms.
 *
 * Fuse matches ONE fuzzy string against each field, so a multi-word query like
 * `bourdieu critique` only matches an item where a single field resembles that
 * whole phrase. The normal scholarly case — surname in the author field, a word
 * from the title in the title field — scores poorly, while a citekey such as
 * `bourdieuCeQue1982` scores well merely for sharing the `bourdieu` prefix. So
 * terms are searched separately and combined instead.
 *
 * A period is already stripped by the trigger; punctuation is dropped here.
 */
export function queryTerms(query: string): string[] {
  return query
    .split(/[\s,;]+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((t) => t.length > 0);
}

export interface TermHit {
  id: string;
  /** Fuse's score for the BEST field hit, or Infinity when the term missed. */
  score: number;
}

/**
 * Combine per-term hit lists into one ranking, keeping only items that matched
 * EVERY term (an AND search). Scores are summed, so an item matching more
 * strongly across terms ranks higher.
 *
 * Requiring all terms is what removes the false positives: an item matching
 * only the author's surname no longer qualifies for a two-word query where the
 * second word appears nowhere in it.
 */
export function combineTermSearches(
  perTerm: ReadonlyArray<ReadonlyArray<TermHit>>
): Array<{ id: string; score: number }> {
  if (perTerm.length === 0) return [];
  if (perTerm.length === 1) {
    return perTerm[0]
      .map((h) => ({ id: h.id, score: h.score }))
      .sort((a, b) => a.score - b.score);
  }

  let acc = new Map<string, number>();
  for (const [i, hits] of perTerm.entries()) {
    if (i === 0) {
      for (const h of hits) acc.set(h.id, h.score);
      continue;
    }
    const next = new Map<string, number>();
    for (const h of hits) {
      if (!acc.has(h.id)) continue; // missed an earlier term → not a match
      next.set(h.id, acc.get(h.id)! + h.score);
    }
    acc = next;
    if (acc.size === 0) return [];
  }
  return [...acc]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => a.score - b.score);
}
