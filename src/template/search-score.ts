/**
 * Relevance scoring for the `@` and `@@` tiers.
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

import {
  matchTerm,
  interiorWeight,
  adjacentChain,
  containsLiteral,
  normalizeApostrophes,
  normTerm,
  queryAtoms,
} from './search-match';

export interface ScoreTarget {
  /**
   * The citekey. An exact match, or the query being a leading prefix of it,
   * ranks at the very top — someone typing `@smithTitleYear` wants that work,
   * not a fuzzy title match.
   */
  citekey?: string | null;
  title?: string | null;
  authorText?: string | null;
  abstract?: string | null;
  /**
   * Journal or book title, series, and publisher. Searched by the `@@` tier
   * only (see `ScoreOptions.includeVenue`), where it is a useful final reach
   * without making `@@` noisy.
   */
  venueText?: string | null;
}

export interface ScoreOptions {
  /** Search the abstract too (the `@@` tier). */
  includeAbstract?: boolean;
  /**
   * Search publication fields (journal/book title, series, publisher) too.
   * `@@` only — see `ScoreTarget.venueText`.
   */
  includeVenue?: boolean;
}

/** Terms shorter than this contribute nothing to word-boundary scoring. */
export const MIN_MEANINGFUL_TERM = 3;

/** Split text into words. The `u` flag is REQUIRED for `\p{...}` to work. */
function words(text: string): string[] {
  const cached = WORD_CACHE.get(text);
  if (cached) return cached;
  const out = norm(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  // Bounded so a long-lived vault cannot grow this without limit.
  if (WORD_CACHE.size > 4000) WORD_CACHE.clear();
  WORD_CACHE.set(text, out);
  return out;
}

/**
 * Split text into words. The `u` flag is REQUIRED for `\p{...}` to work.
 *
 * Cached because search calls this repeatedly for the same strings — every
 * entry has its words split once per interpretation otherwise, which was the
 * dominant cost of a multi-interpretation query (measured 131ms of 166ms for
 * 1000 entries before caching).
 */
const WORD_CACHE = new Map<string, string[]>();

/** Split a query into searchable terms.
 *
 * A HYPHEN is a within-word marker (`anti-colonial` is one compound), so a
 * hyphenated token is kept whole; any OTHER punctuation separates terms. The
 * matcher treats a hyphenated term either as the hyphenated spelling or as the
 * joined one, so it never splits into `anti` + `colonial`.
 */
export function queryTerms(query: string): string[] {
  return query
    .split(/[\s,;]+/)
    .flatMap((t) => {
      // Keep hamza/ʿayn/apostrophes inside the token so `ma'ani` / `rasa'il`
      // stay ONE term and the `'` barrier survives until `normTerm` collapses
      // repeated vowels (see `normalizeApostrophes`).
      const marked = normalizeApostrophes(t);
      return marked.includes('-') ? [marked] : marked.split(/[^\p{L}\p{N}']+/u);
    })
    .map((t) => t.replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, ''))
    .filter((t) => t.length > 0);
}

/** Case/diacritic-insensitive normalisation for comparison. Shares the fold
 *  with the pre-filter (`normTerm`), so scoring and membership cannot drift. */
function norm(s: string): string {
  return normTerm(s);
}

/**
 * Does `term` appear in `text` as a WHOLE WORD, a word PREFIX, or a
 * START-ALIGNED interior morpheme?
 *
 * A prefix is allowed so a partially typed word still matches ("bourdieuc" →
 * "Bourdieu"). A start-aligned interior match is allowed from
 * {@link MIN_INTERIOR_TERM} letters ("capi" → "anticapitalism", "capitalism" →
 * "anticapitalism") but never a mid-word fragment ("loni"). Orthographic
 * variants (`colour`/`color`) are accepted. All in `search-match.ts`, so scoring
 * and highlighting agree.
 */
export function matchesWord(text: string, term: string): boolean {
  return matchTerm(text, term) !== null;
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
  /** A term was found in the author/creator fields AND another in the title. */
  authorAndTitle: boolean;
  /**
   * How many WORDS the query was interpreted as. A spaced query reports its
   * term count; a joined run reports the words it aligned to. Coverage is judged
   * against THIS, so both forms of the same query demand the same thing.
   */
  interpretedWords: number;
  /**
   * The terms the entry was ACTUALLY matched against — `effective`, after any
   * coherent split or chunk alignment.
   *
   * This can differ from the query string that produced it: `womenauthoritysenegal`
   * is matched as `women` + `authority` + `senegal`. Callers that explain a
   * match (highlighting, excerpts) must use these, not the raw query, or they
   * look for text that appears nowhere.
   */
  matchedTerms: string[];
  /** Final ordering key — LOWER IS BETTER. */
  value: number;
}

/**
 * Weighting difference between the two equivalent forms of a query.
 *
 * `bourdieu social critique` and `bourdieusocialcritique` are interpreted as the
 * same words and return nearly the same results. The spaced form is a
 * deliberate statement of separate words, so it is trusted slightly more; the
 * run-together form is ambiguous (it could be a citekey), so it is nudged down.
 * The difference is small on purpose — it must never reorder genuinely different
 * matches, only break ties between equal ones.
 */

export function spacingConfidence(query: string): number {
  return /\s/.test(query.trim()) ? 0 : 0.02;
}

/**
 * Do the query terms appear IN ORDER in the citekey, each as a substring of the
 * key (no separators in a BBT key: `authorShortTitleYear`)?
 *
 * `bourdieu dist 1984` → bourdieu·dist·1984 of `bourdieuDistinctionSocial1984`.
 * Returns the covered span (for ranking: more of the key covered is better), or
 * null. Terms too short to be meaningful are ignored so `d 1984` cannot qualify
 * on a single letter.
 */
function citekeyOrderedMatch(
  key: string,
  terms: string[]
): { span: number } | null {
  const meaningful = terms.filter((t) => t.length >= 2);
  if (meaningful.length < 2) return null;
  let pos = 0;
  for (const t of meaningful) {
    const at = key.indexOf(t, pos);
    if (at < 0) return null;
    pos = at + t.length;
  }
  return { span: pos };
}

/**
 * A CITEKEY match — exact, where the query is a leading PREFIX of the key, or
 * where the query's terms appear IN ORDER in the key. Returns the ranking band
 * (value < 0, ahead of every content band) or null.
 *
 * Shared by `scoreEntry` and by the tier's candidate gate (`scoreForTier`),
 * which must consult it BEFORE its compound-word short-circuit: a long single
 * term that is just the start of a citekey (`@smithMemory202`) is a
 * compound-looking query, and without this the gate rejected it before the
 * citekey was ever considered — so a literal `@citekey…` prefix found nothing
 * unless a space split it into terms that happened to appear in the title.
 */
export function citekeyMatch(
  citekey: string,
  query: string
): { value: number; exact: boolean } | null {
  if (!citekey || !query.trim()) return null;
  const key = citekey.toLowerCase();
  const q = query.trim().toLowerCase().replace(/^@+/, '');
  const qJoined = q.replace(/\s+/g, '');
  if (!qJoined) return null;
  if (key === q || key === qJoined) return { value: -2, exact: true };
  // A contiguous join (`bourdieudist`) is the strongest prefix reading.
  if (key.startsWith(qJoined)) {
    // A SHORTER query (a looser prefix, matching more keys) ranks below a
    // longer, more specific one, so `bourdieu dist` beats `bourdieu d`.
    return {
      value: -1 + Math.min(citekey.length - qJoined.length, 99) / 1000,
      exact: false,
    };
  }
  // The terms appear IN ORDER in the key, each as a substring of a key
  // segment: `bourdieu dist 1984` → bourdieu···dist···1984 of
  // `bourdieuDistinctionSocial1984`.
  const inOrder = citekeyOrderedMatch(key, q.split(/\s+/).filter(Boolean));
  if (inOrder) {
    return {
      value: -0.9 + Math.min(citekey.length - inOrder.span, 99) / 1000,
      exact: false,
    };
  }
  return null;
}

/**
 * Score one entry against the query terms.
 *
 * `value` is a sort key, lower = better. Bands are separated widely, so a
 * higher-priority signal always beats any amount of a lower one. The order
 * follows the governing principle that searches are meaningful and usually made
 * of meaningful terms:
 *
 *   0. citekey exact / prefix / in-order → below 0 (see `citekeyMatch`)
 *   1. author + a title word      → 0.0–0.3   (the most meaningful search)
 *   2. exact phrase in the title  → 0.3–0.9
 *   3. full coverage              → 1.0–2.9
 *   4. partial coverage           → 3.0+
 *
 * There is NO chunk / run / compound interpretation: a query is exactly its
 * space-separated terms (plus the citekey check). Hyphenated vs joined
 * spellings of the SAME term are folded by `matchTerm`, not by a special path.
 */
export function scoreEntry(
  target: ScoreTarget,
  query: string,
  opts: ScoreOptions = {}
): RelevanceScore {
  const terms = queryTerms(query);
  if (terms.length === 0) {
    return {
      exactPhrase: false,
      covered: 0,
      total: 0,
      authorAndTitle: false,
      interpretedWords: 0,
      matchedTerms: [],
      value: 0,
    };
  }

  const title = target.title ?? '';
  const author = target.authorText ?? '';
  const haystacksAll = [title, author];
  if (opts.includeAbstract) haystacksAll.push(target.abstract ?? '');
  if (opts.includeVenue) haystacksAll.push(target.venueText ?? '');

  // QUOTED terms are LITERAL: match the substring in any searched field
  // (case/diacritic-insensitive). They do not go through word-boundary or
  // morpheme logic — `"anticolonial"` matches "anticolonial*" but not
  // "anti-witchcraft … colonialism". A quoted run may also be multi-word.
  const atoms = queryAtoms(query);
  const literalAtoms = atoms.filter((a) => a.literal);
  if (literalAtoms.length) {
    let coveredTotal = 0;
    let hits = 0;
    for (const a of atoms) {
      coveredTotal++;
      // `containsLiteral` lowercases the FIELD; normalize the atom too so an
      // unquoted mixed-case term ("Africa") still matches.
      if (haystacksAll.some((h) => containsLiteral(h, a.text))) hits++;
    }
    if (hits > 0) {
      const full = hits >= coveredTotal;
      return {
        exactPhrase: full,
        covered: hits,
        total: coveredTotal,
        authorAndTitle: false,
        interpretedWords: coveredTotal,
        matchedTerms: atoms.map((a) => a.text),
        // A full literal match ranks just above a plain phrase; a partial one
        // sits with normal term matches. Always beats a fragmented match.
        value: full ? 0.2 + spacingConfidence(query) : 1.5 + spacingConfidence(query),
      };
    }
    // No literal hit at all → not a match.
    return {
      exactPhrase: false,
      covered: 0,
      total: coveredTotal,
      authorAndTitle: false,
      interpretedWords: coveredTotal,
      matchedTerms: atoms.map((a) => a.text),
      value: Number.POSITIVE_INFINITY,
    };
  }

  // The query's own terms, verbatim. (Chunked/run reinterpretation was removed:
  // `soccrit` is no longer read as `soc` + `crit`; write `soc crit`.)
  const effective = terms;

  // 0. CITEKEY (see `citekeyMatch`). An exact match, or the query being a
  //    LEADING PREFIX of the key, ranks above everything. `@bourdieudist1984`,
  //    `bourdieudist`, `bourdieu dist`, `bourdieu dist 1984` all hit the same
  //    band.
  const ck = citekeyMatch(target.citekey ?? '', query);
  if (ck) {
    return {
      exactPhrase: ck.exact,
      covered: 1,
      total: 1,
      authorAndTitle: false,
      interpretedWords: 1,
      matchedTerms: effective,
      value: ck.value,
    };
  }

  // 1. Exact phrase (title only — the title is the claim being matched).
  const phrase = terms.join(' ');
  const exactPhrase = !!title && containsFragment(title, phrase);

  // 2. Coverage: a term counts if it appears as a WORD in title or creators.
  //    Short terms are ignored for coverage so "of"/"a" cannot qualify an item.
  const meaningful = effective.filter((t) => t.length >= MIN_MEANINGFUL_TERM);
  const forCoverage = meaningful.length > 0 ? meaningful : effective;
  let covered = 0;
  for (const term of forCoverage) {
    if (haystacksAll.some((h) => matchesWord(h, term))) covered++;
  }

  // How much of the query is a CONTIGUOUS PHRASE in the title: the word a term
  // matched immediately followed by the next term's word ("cultural critique"
  // for `cultural cri`). This is what a multi-term query usually means.
  const adjacent = Math.max(
    adjacentChain(title, forCoverage),
    adjacentChain(author, forCoverage)
  );
  // A term matched only as a start-aligned INTERIOR morpheme is weaker than a
  // whole word, scaled by its length (parity at ~6 letters).
  const interiorPenalty = (termsToCheck: string[], hay: string): number => {
    let penalty = 0;
    for (const t of termsToCheck) {
      const m = matchTerm(hay, t);
      if (m?.strength === 'interior') {
        penalty += 1 - interiorWeight(t.length);
      }
    }
    return penalty;
  };

  // 1. Author + title: a surname (or similar) AND another term in the title.
  //    This is the most meaningful search there is — see the governing
  //    principle — so it ranks ABOVE an exact title phrase.
  const inTitle = forCoverage.filter((t) => matchesWord(title, t));
  const inAuthor = forCoverage.filter((t) => matchesWord(author, t));
  const authorAndTitle =
    forCoverage.length >= 2 && inAuthor.length > 0 && inTitle.length > 0;

  // Same interpretation either way; the spaced form is trusted marginally more.
  const spacing = spacingConfidence(query);

  if (authorAndTitle) {
    // Fewer terms needed from other places is better; a title term at the very
    // start of the title is the strongest form.
    const startsTitle = inTitle.some((t) => firstWordOffset(title, t) === 0);
    return {
      exactPhrase,
      covered,
      total: forCoverage.length,
      authorAndTitle: true,
      interpretedWords: forCoverage.length,
    matchedTerms: forCoverage,
      value: (startsTitle ? 0.0 : 0.1) + inAuthor.length * 0.01 + spacing,
    };
  }

  // 3. Whole-word quality among title terms, and how early they sit.
  let wordHits = 0;
  let fragmentOnly = 0;
  let startBonus = 0;
  for (const term of meaningful) {
    const m = matchTerm(title, term);
    if (m) {
      if (m.strength === 'interior') {
        // Start-aligned interior morpheme (capitalism in anticapitalism): a
        // partial, length-scaled hit — not a whole word.
        fragmentOnly++;
      } else {
        wordHits++;
      }
      const at = firstWordOffset(title, term);
      if (at === 0) startBonus++;
    } else if (containsFragment(title, term)) {
      // Present in the title as a non-aligned fragment ("loni"): very weak.
      fragmentOnly++;
    }
  }

  // 2. Exact phrase in the title.
  if (exactPhrase) {
    const at = firstWordOffset(title, phrase);
    const pos = at < 0 ? 0.5 : Math.min(at / 100, 0.8);
    return {
      exactPhrase,
      covered,
      total: forCoverage.length,
      authorAndTitle: false,
      interpretedWords: forCoverage.length,
    matchedTerms: forCoverage,
      // A contiguous phrase beats a merely-adjacent chain.
      value: 0.3 + pos + spacing - (adjacent > 1 ? 0.06 : 0),
    };
  }

  // 2b. The terms are a contiguous PHRASE in the title but not a substring
  //     (one term is a prefix/interior: `cultural cri` → "cultural critique").
  if (adjacent >= forCoverage.length && forCoverage.length >= 2) {
    return {
      exactPhrase,
      covered,
      total: forCoverage.length,
      authorAndTitle: false,
      interpretedWords: forCoverage.length,
      matchedTerms: forCoverage,
      value: 0.75 + spacing,
    };
  }

  // 3. Concatenated prefixes (soccri → social critique) were REMOVED: a joined
  //    abbreviation is no longer interpreted. Write the terms separately
  //    (`soc crit`), which matches the same entries through coverage.

  const fullCoverage = covered >= forCoverage.length ? 1 : 3;
  const penalty = fragmentOnly * 0.15;
  const interiorPen = interiorPenalty(forCoverage, title);
  // An adjacent pair is a meaningfully better match than the same two terms
  // scattered across the title.
  const adjacencyBonus = adjacent >= forCoverage.length ? 0.3 : adjacent > 1 ? 0.12 : 0;
  const quality = 1.0 - Math.min(wordHits / Math.max(forCoverage.length, 1), 1) * 0.6;

  return {
    exactPhrase,
    covered,
    total: forCoverage.length,
    authorAndTitle: false,
    interpretedWords: forCoverage.length,
    matchedTerms: forCoverage,
    value:
      fullCoverage +
      Math.max(quality, 0) +
      penalty +
      interiorPen -
      adjacencyBonus -
      Math.min(startBonus, 2) * 0.1 +
      spacing,
  };
}

/**
 * Does the entry pass at all?
 *
 * Coverage stays an AND, as the user requires: `social critique` must be
 * NARROWER than either term alone, so an entry matching only one of two
 * meaningful terms is not offered. The difference from before is that this test
 * runs on the FULL candidate set rather than on per-term truncations.
 *
 * A concatenated-prefix query (`soccri` → "social critique") is ONE term to the
 * tokeniser but spans several words, so its `covered` count is legitimately
 * lower. The scorer already proved every chunk consumed, so such a match passes
 * on its own; only genuine multi-term queries require full coverage.
 */
export function passesCoverage(score: RelevanceScore): boolean {
  // An uninterpretable run (no word alignment at all) is not a match.
  if (!Number.isFinite(score.value)) return false;
  if (score.total === 0) return true; // no terms to satisfy (defensive)
  // EVERY interpretation must match something. A single term that matched
  // nowhere is not a match — that is what let entries matching nothing into
  // every result list.
  if (score.interpretedWords <= 1) return score.covered >= 1;
  // Two or more terms: ALL must be present, in ANY order. This is what makes a
  // multi-term query "this AND that" — and it must hold for chunk readings too,
  // so `soccrit` finds an entry containing "Social ... Critique" regardless of
  // which word comes first. (Chunk ALIGNMENT is order-sensitive, but that is a
  // way of DISCOVERING the terms; membership is decided here, by coverage.)
  return score.covered >= score.total;
}
