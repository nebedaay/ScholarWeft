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
   * Journal or book title, series, and publisher. Searched by the `@@@` tier
   * only (see `ScoreOptions.includeVenue`), where it is a useful final reach
   * without making `@@` noisy.
   */
  venueText?: string | null;
}

export interface ScoreOptions {
  /** Search the abstract too (the `@@@` tier). */
  includeAbstract?: boolean;
  /**
   * Search publication fields (journal/book title, series, publisher) too.
   * `@@@` only — see `ScoreTarget.venueText`.
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
  /** A term was found in the author/creator fields AND another in the title. */
  authorAndTitle: boolean;
  /** The query matched as concatenated word prefixes (soccri → social critique). */
  prefixChunks: boolean;
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

/** Minimum characters for one chunk of a concatenated-prefix query. */
export const MIN_CHUNK = 3;

/**
 * Is this query a genuine ABBREVIATION worth matching as word-prefixes?
 *
 * A SINGLE unbroken run of letters (`soccri`, `socthe`) is how a person
 * abbreviates, so it is eligible for chunk matching. A SPACED query is an
 * explicit assertion of word boundaries — and it is still interpreted as those
 * words (by normal coverage), just with a small confidence bonus rather than
 * being rerouted into fragment matching.
 *
 * Both forms therefore land on the SAME interpretation and ranking; the space
 * only shifts weighting. See `scoreEntry`.
 */
export function looksLikeAbbreviation(query: string): boolean {
  const trimmed = query.trim();
  if (!trimmed) return false;
  // A spaced query is words, not a fragment run.
  if (/\s/.test(trimmed)) return false;
  return trimmed.length >= MIN_CHUNK;
}

/**
 * Does the run split into WHOLE words that the phrase actually contains?
 *
 * This is the guard that stops a coherent query being read as abbreviations.
 * `socialcritique` splits cleanly into `social` + `critique`, so it must not
 * align to "**Soc**cer **is** almost **cri**ing in **ti**me of **que**stioning"
 * — the user's rule: *"if there's a series of coherent words, they're very
 * unlikely made up of smaller chunks to look for."* Only when NO coherent split
 * exists (`soccri`) is an abbreviation reading plausible.
 *
 * Without a dictionary the practical test is the entry itself: try every split
 * of the run and, if the phrase contains each part as a real word, it is
 * coherent. Best-effort by design — a false negative just means we fall back to
 * chunk matching, which is scored below real word matches anyway.
 */
export function hasCoherentSplit(phrase: string, run: string): string[] | null {
  const ws = new Set(words(phrase));
  const q = norm(run);
  if (!q) return null;
  // Two-way split.
  for (let i = MIN_MEANINGFUL_TERM; i <= q.length - MIN_MEANINGFUL_TERM; i++) {
    const a = q.slice(0, i);
    const b = q.slice(i);
    if (ws.has(a) && ws.has(b)) return [a, b];
  }
  // Three-way split.
  for (let i = MIN_MEANINGFUL_TERM; i < q.length; i++) {
    for (let j = i + MIN_MEANINGFUL_TERM; j < q.length; j++) {
      const a = q.slice(0, i);
      const b = q.slice(i, j);
      const c = q.slice(j);
      if (ws.has(a) && ws.has(b) && ws.has(c)) return [a, b, c];
    }
  }
  return null;
}

/**
 * Would this entry be found for an UNBROKEN run (`bourdieucritique`, `soccri`)?
 *
 * Fuse cannot match such a run — it resembles no single field — so the entry
 * must be admitted as a candidate by interpretation instead. Mirrors exactly
 * what `scoreEntry` will do with it, so an admitted candidate always scores
 * rather than being admitted pointlessly:
 *
 *   1. a coherent SPLIT into real words, which may span author and title
 *      (`bourdieucritique` = bourdieu + critique);
 *   2. CHUNK alignment of word prefixes (`soccri`) when no coherent reading
 *      exists.
 */
export function explainsUnbrokenRun(
  target: ScoreTarget,
  run: string
): boolean {
  const author = target.authorText ?? '';
  const combined = `${author} ${target.title ?? ''}`;
  if (hasCoherentSplit(combined, run)) return true;
  return (
    prefixChunks(target.title ?? '', run).full ||
    prefixChunks(author, run).full ||
    prefixChunks(combined, run).full
  );
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
 * Match a CONCATENATED PREFIX query against a phrase, e.g. `soccri` against
 * "A Social Critique of ..." or `socthe` against "Social Theory".
 *
 * Consumes the query left to right, taking the longest run (>= MIN_CHUNK) that
 * begins a successive word. This is the ONLY legitimate fragment matching: a
 * person abbreviates words by their BEGINNINGS. An interior fragment
 * (`ocique` for "social critique") consumes nothing and is rejected — nobody
 * looks up a phrase by its third or fourth letters.
 *
 * MIN_CHUNK is 3, not 2: `socr` is more plausibly Socrates, so nobody types a
 * two-letter start.
 *
 * Returns whether the WHOLE query was consumed, and how many words it spanned.
 */
export function prefixChunks(
  phrase: string,
  query: string
): { full: boolean; words: number; chunks: string[] } {
  const q = norm(query);
  if (!q) return { full: false, words: 0, chunks: [] };
  const ws = words(phrase);
  let qi = 0;
  let wi = 0;
  let used = 0;
  const chunks: string[] = [];
  while (qi < q.length && wi < ws.length) {
    let matched = 0;
    for (let len = q.length - qi; len >= MIN_CHUNK; len--) {
      if (ws[wi].startsWith(q.slice(qi, qi + len))) {
        matched = len;
        break;
      }
    }
    if (matched) {
      chunks.push(q.slice(qi, qi + matched));
      qi += matched;
      used++;
    }
    wi++;
  }
  return { full: used > 0 && qi === q.length, words: used, chunks };
}

/**
 * Score one entry against the query terms.
 *
 * `value` is a sort key, lower = better. Bands are separated widely, so a
 * higher-priority signal always beats any amount of a lower one. The order
 * follows the governing principle that searches are meaningful and usually made
 * of meaningful terms:
 *
 *   1. author + a title word      → 0.0–0.3   (the most meaningful search)
 *   2. exact phrase in the title  → 0.3–0.9
 *   3. concatenated prefixes      → 0.9–0.99  (soccri → social critique)
 *   4. full coverage              → 1.0–2.9
 *   5. partial coverage           → 3.0+
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
      prefixChunks: false,
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

  // A JOINED run (`bourdieusocialcritique`) is interpreted as the words it was
  // built from, so it goes through the SAME ranking as the spaced form.
  //
  // Two ways to recover those words, in priority order:
  //   1. A COHERENT SPLIT — the run is made of real words this entry contains,
  //      so `bourdieusocialcritique` = `bourdieu + social + critique`. This is
  //      the user's rule: a series of coherent words is not an abbreviation.
  //   2. CHUNK ALIGNMENT — no coherent reading exists (`soccri`), so word
  //      prefixes are the only way to interpret it.
  let effective = terms;
  if (looksLikeAbbreviation(query) && terms.length === 1) {
    const coherent = hasCoherentSplit(`${author} ${title}`, terms[0]);
    if (coherent) {
      effective = coherent;
    } else {
      const candidates = [
        prefixChunks(title, terms[0]),
        prefixChunks(author, terms[0]),
        prefixChunks(`${author} ${title}`, terms[0]),
      ];
      const best = candidates.reduce((a, b) => (b.words > a.words ? b : a));
      if (best.full && best.words > 1) {
        // A MULTI-word alignment is a genuinely different reading (soccri →
        // soc + cri). A single-chunk "alignment" is just the term itself, so
        // there is nothing to reinterpret.
        effective = best.chunks;
      }
      // Otherwise KEEP the term as typed and search it normally. An
      // abbreviation reading is an ADDITIONAL interpretation, never a
      // replacement: failing to align says nothing about whether the term
      // itself matches. Rejecting here is what made `@@@maghrebian` return
      // nothing — a plain word was treated as an unexplained abbreviation.
    }
  }

  // 0. CITEKEY: an exact match, or the query being a LEADING PREFIX of it,
  //    ranks above everything. Someone typing a citekey wants that work — this
  //    is why the `@` level stays useful once it also searches titles.
  const citekey = target.citekey ?? '';
  if (citekey && query.trim()) {
    const key = citekey.toLowerCase();
    const q = query.trim().toLowerCase().replace(/^@+/, '');
    if (q && key === q) {
      return {
        exactPhrase: true,
        covered: 1,
        total: 1,
        authorAndTitle: false,
        prefixChunks: false,
        interpretedWords: 1,
        matchedTerms: [citekey],
        value: -2,
      };
    }
    if (q && key.startsWith(q)) {
      return {
        exactPhrase: false,
        covered: 1,
        total: 1,
        authorAndTitle: false,
        prefixChunks: false,
        interpretedWords: 1,
        matchedTerms: [citekey],
        // Still ahead of every other band (0.0+), behind an exact match.
        value: -1 + Math.min(citekey.length - q.length, 99) / 1000,
      };
    }
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
      prefixChunks: false,
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
    if (matchesWord(title, term)) {
      wordHits++;
      const at = firstWordOffset(title, term);
      if (at === 0) startBonus++;
    } else if (containsFragment(title, term)) {
      // Present in the title, but only as a fragment of a larger word: weak.
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
      prefixChunks: false,
      interpretedWords: forCoverage.length,
    matchedTerms: forCoverage,
      value: 0.3 + pos + spacing,
    };
  }

  // 3. Concatenated prefixes (soccri → social critique). Legitimate but weaker
  //    than whole words, and ONLY when the query is a genuine abbreviation —
  //    a spaced query of real words must not chunk-match (see
  //    looksLikeAbbreviation), and an interior fragment (ocique) consumes
  //    nothing at all.
  const chunked = looksLikeAbbreviation(query)
    ? prefixChunks(title, terms.join(''))
    : { full: false, words: 0 };
  if (chunked.full && chunked.words >= 1) {
    return {
      exactPhrase: false,
      covered,
      total: forCoverage.length,
      authorAndTitle: false,
      prefixChunks: true,
      interpretedWords: forCoverage.length,
    matchedTerms: forCoverage,
      value: 0.9 + (fragmentOnly > 0 ? 0.05 : 0) + spacing,
    };
  }

  const fullCoverage = covered >= forCoverage.length ? 1 : 3;
  const penalty = fragmentOnly * 0.15;
  const quality = 1.0 - Math.min(wordHits / Math.max(forCoverage.length, 1), 1) * 0.6;
  return {
    exactPhrase,
    covered,
    total: forCoverage.length,
    authorAndTitle: false,
    prefixChunks: false,
    interpretedWords: forCoverage.length,
    matchedTerms: forCoverage,
    value:
      fullCoverage +
      Math.max(quality, 0) +
      penalty -
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
