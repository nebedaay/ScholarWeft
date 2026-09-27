/**
 * Relevance scoring for the `@@` / `@@@` tiers.
 *
 * Fuse is used for RECALL only (which entries contain these terms at all); the
 * ORDER comes from here. Fuse's own score is length-normalised, so a whole-word
 * match in a long, accurate title can score worse than a fragment in a short
 * one — which is why 200 titles starting "Social ..." outranked a title
 * containing the exact phrase "A Social Critique of ...".
 *
 * The model, in descending priority:
 *
 *   1. EXACT PHRASE — the whole query appears in the title as a contiguous
 *      substring. This is what "look for this exact phrase" means: if it is
 *      there, it wins, ahead of any accumulation of fragments.
 *   2. COVERAGE — how many query terms appear in the title or creators. All
 *      terms is the normal case for a spaced query, which stays an AND.
 *   3. WHOLE WORDS — terms matching as complete words beat the same number of
 *      characters scattered across several words. "social" matching "social"
 *      is a match; "social" matching "s...o...c...i...a...l" is not. Short
 *      terms (1-2 chars) contribute nothing: nobody searches for one letter
 *      per word, and those fragments are almost never meaningful.
 *   4. POSITION — earlier in the title is better, and a term at the START
 *      outranks one buried in a subtitle.
 *
 * Pure, so the ordering for a reported case is an executable test.
 */

export interface ScoreTarget {
  title?: string | null;
  authorText?: string | null;
  abstract?: string | null;
}

export interface ScoreOptions {
  /** Search the abstract too (the `@@@` tier). */
  includeAbstract?: boolean;
}

/** Terms shorter than this contribute nothing to word-boundary scoring. */
export const MIN_MEANINGFUL_TERM = 3;

/** Split text into words. The `u` flag is REQUIRED for `\p{...}` to work. */
function words(text: string): string[] {
  return norm(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Split a query into searchable terms. */
export function queryTerms(query: string): string[] {
  return query
    .split(/[\s,;]+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((t) => t.length > 0);
}

/** Case/diacritic-insensitive normalisation for comparison. */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Does `term` appear in `text` as a WHOLE WORD (or word prefix)?
 *
 * A prefix is allowed so a partially typed word still matches ("bourdieuc" →
 * "Bourdieu"), but never an interior fragment: "ocial" does not match "social".
 * This is what stops scattered-letter matches counting as the same thing.
 */
export function matchesWord(text: string, term: string): boolean {
  if (!term) return false;
  const q = norm(term);
  if (!q) return false;
  return words(text).some((w) => w === q || w.startsWith(q));
}

/** Does `text` contain `term` anywhere, contiguously (fragment allowed)? */
function containsFragment(text: string, term: string): boolean {
  if (!term) return false;
  return norm(text).includes(norm(term));
}

/** Earliest character offset of any whole-word match, or -1. */
function firstWordOffset(text: string, term: string): number {
  const t = norm(text);
  const q = norm(term);
  if (!q) return -1;
  const re = new RegExp(
    `(^|[^\\p{L}\\p{N}])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    'u'
  );
  const m = re.exec(t);
  if (!m) return -1;
  return m.index + m[1].length;
}

export interface RelevanceScore {
  /** True when the whole query appears in the title contiguously. */
  exactPhrase: boolean;
  /** How many terms were found (as words) in title or creators. */
  covered: number;
  /** Total terms searched. */
  total: number;
  /** Final ordering key — LOWER IS BETTER. */
  value: number;
}

/**
 * Score one entry against the query terms.
 *
 * `value` is a sort key, lower = better. The bands are separated widely, so a
 * higher-priority signal always beats any amount of a lower one:
 *
 *   exact phrase in title   → 0.0–0.9
 *   full coverage           → 1.0–1.9
 *   partial coverage        → 2.0+
 */
export function scoreEntry(
  target: ScoreTarget,
  query: string,
  opts: ScoreOptions = {}
): RelevanceScore {
  const terms = queryTerms(query);
  if (terms.length === 0) {
    return { exactPhrase: false, covered: 0, total: 0, value: 0 };
  }

  const title = target.title ?? '';
  const author = target.authorText ?? '';
  const haystacks = [title, author];
  if (opts.includeAbstract) haystacks.push(target.abstract ?? '');

  // 1. Exact phrase (title only — the title is the claim being matched).
  const phrase = terms.join(' ');
  const exactPhrase = !!title && containsFragment(title, phrase);

  // 2. Coverage: a term counts if it appears as a WORD in title or creators.
  //    Short terms are ignored for coverage so "of"/"a" cannot qualify an item.
  const meaningful = terms.filter((t) => t.length >= MIN_MEANINGFUL_TERM);
  const forCoverage = meaningful.length > 0 ? meaningful : terms;
  let covered = 0;
  for (const term of forCoverage) {
    if (haystacks.some((h) => matchesWord(h, term))) covered++;
  }

  // 3. Whole-word quality among title terms, and how early they sit.
  let wordHits = 0;
  let fragmentOnly = 0;
  let earliest = Number.POSITIVE_INFINITY;
  let startBonus = 0;
  for (const term of meaningful) {
    if (matchesWord(title, term)) {
      wordHits++;
      const at = firstWordOffset(title, term);
      if (at >= 0) {
        earliest = Math.min(earliest, at);
        if (at === 0) startBonus++;
      }
    } else if (containsFragment(title, term)) {
      // Present in the title, but only as a fragment of a larger word: weak.
      fragmentOnly++;
    }
  }

  if (exactPhrase) {
    // Within the phrase band, prefer the phrase appearing earlier.
    const at = firstWordOffset(title, phrase);
    const pos = at < 0 ? 0.5 : Math.min(at / 100, 0.8);
    return { exactPhrase, covered, total: forCoverage.length, value: pos };
  }

  const fullCoverage = covered >= forCoverage.length ? 1 : 2;
  const penalty = fragmentOnly * 0.15;
  const quality = 1.0
    - Math.min(wordHits / Math.max(forCoverage.length, 1), 1) * 0.6
    - Math.min(startBonus, 2) * 0.1;
  return {
    exactPhrase,
    covered,
    total: forCoverage.length,
    value: fullCoverage + Math.max(quality, 0) + penalty,
  };
}

/**
 * Does the entry pass at all?
 *
 * Coverage stays an AND, as the user requires: `social critique` must be
 * NARROWER than either term alone, so an entry matching only one of two
 * meaningful terms is not offered. The difference from before is that this test
 * runs on the FULL candidate set rather than on per-term truncations.
 */
export function passesCoverage(
  score: RelevanceScore,
  totalTerms: number
): boolean {
  if (totalTerms <= 1) return true;
  // With two or more meaningful terms, require all of them.
  return score.total > 0 && score.covered >= score.total;
}
