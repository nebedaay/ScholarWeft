/**
 * Term-matching for the citation search, in ONE place, so scoring and
 * highlighting agree on what counts as a match.
 *
 * Match strengths, in descending rank:
 *
 *   1. WHOLE / PREFIX — the term is the word or its beginning (`bourdieuc` →
 *      "Bourdieu"). The normal, strongest match.
 *   2. START-ALIGNED INTERIOR — the term is a meaningful part of a compound,
 *      starting at a word's beginning or right after a known prefix (`capi`
 *      in anti|capitalism), or the whole trailing part of a known compound
 *      (`capitalism` in anti|capitalism, `colonial` in anti|colonialism).
 *      `loni` and `ntic` are not start-aligned → no match.
 *
 * Adjacency is handled by {@link adjacentChain}: a short SECOND term
 * (`cultural cri`) prefers a word that immediately FOLLOWS the word the first
 * term matched, which is what a phrase query means.
 *
 * Orthographic variants are folded at comparison time (`colour` ≡ `color`,
 * `colonisation` ≡ `colonization`) — deterministic, not fuzzy.
 */

import { sameVariantWord, spellingNeedles } from './search-variants';

/** Terms shorter than this never match interiorly (too much noise). */
export const MIN_INTERIOR_TERM = 4;

/** A term's rank reaches parity with whole-word matches here. */
export const PARITY_LEN = 6;

/** Split text into words. `u` is required for `\p{...}`. */
const WORD_RE = /[\p{L}\p{N}]+/gu;

/**
 * The glyphs transliteration uses for hamza / ʿayn / ʻokina and the apostrophe
 * family: the spacing modifier-letter ranges U+02B0–U+02FF (which contains ʾ
 * U+02BE and ʿ U+02BF) and the phonetic-extension modifiers ᵓ U+1D53 (inside
 * U+1D2C–U+1D6A) and ᶜ U+1D9C (U+1D9B–U+1DBF), plus `'` `'` `’` `‘` `` ` `` `´`.
 */
const APOSTROPHE_GLYPHS =
  /[\u02B0-\u02FF\u1D2C-\u1D6A\u1D9B-\u1DBF\u2018-\u201B\u0027\u0060\u00B4]/g;

/** Decompose and drop every nonspacing mark (é→e, ā→a, ḥ→h, ẓ→z …). */
export function stripMarks(s: string): string {
  return s.normalize('NFD').replace(/\p{Mn}/gu, '');
}

/**
 * Map every hamza/ʿayn/apostrophe glyph to a bare `'`, WITHOUT removing it.
 *
 * The `'` is a BARRIER: the vowel-collapse step must not merge across it. In
 * `tasāʾala` the hamza separates two short `a`s, so removing it first would
 * leave `tasaala` (and then `aa`→`a` would wrongly give `tasala`). Keeping a
 * marker during the collapse and deleting it afterwards preserves the seam.
 */
export function normalizeApostrophes(s: string): string {
  return s.replace(APOSTROPHE_GLYPHS, "'");
}

/**
 * Fold text for search comparison: decompose, drop every nonspacing mark, and
 * remove the hamza/ʿayn/apostrophe glyphs. NFD alone is not enough for
 * scholarly Arabic transliteration: `ʾ` (U+02BE) and `ʿ` (U+02BF) are spacing
 * modifier letters with NO decomposition, so `rasāʾil` folded `rasaʾil` and a
 * typed `rasail` never matched it. Used for the Fuse `getFn` index; the search
 * scorer uses {@link normTerm}, which also collapses repeated vowels.
 *
 * Not lowercased here — `normTerm` adds that, and the Fuse wrapper leaves case
 * for Fuse's own case-insensitive matching.
 */
export function foldDiacritics(s: string): string {
  return stripMarks(s).replace(APOSTROPHE_GLYPHS, '');
}

/**
 * Collapse a run of the same vowel (`aa` → `a`, `ī` written `ii` → `i`). Long
 * vowels are transliterated with a macron (`ā`) by some conventions and by
 * doubling (`aa`) by others — and BBT citekey formulas may or may not expand
 * the macron — so `rasāʾil`, `rasaail` and `rasail` must all reach the same
 * search form. Only VOWELS are collapsed: doubled consonants are shadda
 * (`Muḥammad`), a different phenomenon that must stay doubled.
 *
 * Callers must run this WHILE the hamza/ʿayn barrier is still present (see
 * {@link normalizeApostrophes}), or a hamza-separated `a…a` would merge.
 */
export function collapseRepeatedVowels(s: string): string {
  return s.replace(/([aeiou])\1+/g, '$1');
}

/**
 * The fold steps, IN ORDER. This is the SINGLE definition of the fold's
 * composition, shared by its two consumers:
 *   - `normTerm` applies each step to the whole string (fast, for scoring).
 *   - `foldWithMap` applies each step to a character array that carries an
 *     offset map (for highlighting).
 *
 * Reorder or add a step here and BOTH change. The exhaustive switches in
 * `applyFoldStep` / `applyFoldStepToChars` make a MISSING handler a compile
 * error, and the drift test in `search-match.test.ts` is the runtime backstop.
 */
export type FoldStep =
  | 'stripMarks'
  | 'apostrophes'
  | 'lowercase'
  | 'collapseVowels'
  | 'removeBarrier';

export const FOLD_STEPS: readonly FoldStep[] = [
  'stripMarks',
  'apostrophes',
  'lowercase',
  'collapseVowels',
  'removeBarrier',
];

/** Compile-time exhaustiveness guard for the mapped step switch. */
function assertNever(step: never): never {
  throw new Error(`unhandled fold step: ${String(step)}`);
}

/**
 * Whole-string handler for each fold step (the fast path used by scoring).
 * A `Record` keyed by `FoldStep`, so adding a step to {@link FOLD_STEPS}
 * without a handler here is a COMPILE error.
 */
const STRING_STEP: Record<FoldStep, (s: string) => string> = {
  stripMarks,
  apostrophes: normalizeApostrophes,
  lowercase: (s) => s.toLowerCase(),
  collapseVowels: collapseRepeatedVowels,
  removeBarrier: (s) => s.replace(/'/g, ''),
};

/**
 * The whole-string fold, COMPOSED ONCE from {@link FOLD_STEPS} at module load:
 * `removeBarrier(collapseVowels(lowercase(apostrophes(stripMarks(s)))))`. This
 * keeps the single ordered definition without paying a per-call switch/loop —
 * it benchmarks within ~4% of the former hand-written inline chain.
 */
const foldString: (s: string) => string = FOLD_STEPS.reduce<
  (s: string) => string
>(
  (f, step) => {
    const g = STRING_STEP[step];
    return (s) => g(f(s));
  },
  (s) => s
);

/**
 * Lowercased, diacritic-free, long-vowel-folded search form.
 *
 * ORDER IS THE POINT (see {@link FOLD_STEPS}): strip marks → map hamza/ʿayn to
 * a barrier `'` → lowercase → collapse repeated vowels → THEN remove the
 * barrier. Removing the barrier first (or collapsing after removal) makes
 * `tasāʾala` collapse to `tasala`; keeping it through the collapse gives
 * `tasaala`, while a genuinely doubled long vowel (`rasaail`, `jawaahir`) still
 * collapses to `rasail` / `jawahir`.
 *
 * KNOWN LIMIT: a hamza-less, macron-less spelling of a hamza word is ambiguous
 * and is read as a doubled long vowel — `maani` → `mani`, so it does NOT match
 * `maʿānī` (`maani`); type `ma'ani` (or `maʿānī`) for that one.
 */
export function normTerm(s: string): string {
  return foldString(s);
}

/** A folded character plus the ORIGINAL-text range it came from. */
export interface FoldedChar {
  ch: string;
  /** Original index of the first source char folded into this one. */
  start: number;
  /** Original index of the LAST source char folded into this one (widened
   *  over a collapsed repeated vowel, so a highlight covers the whole
   *  spelling). */
  end: number;
}

/** Apply one fold step to the mapped character array (the mapped path). */
function applyFoldStepToChars(
  chars: FoldedChar[],
  step: FoldStep
): FoldedChar[] {
  switch (step) {
    case 'stripMarks': {
      const out: FoldedChar[] = [];
      for (const fc of chars) {
        for (const c of stripMarks(fc.ch)) out.push({ ...fc, ch: c });
      }
      return out;
    }
    case 'apostrophes':
      return chars.map((fc) => ({ ...fc, ch: normalizeApostrophes(fc.ch) }));
    case 'lowercase':
      return chars.map((fc) => ({ ...fc, ch: fc.ch.toLowerCase() }));
    case 'collapseVowels': {
      const out: FoldedChar[] = [];
      for (const fc of chars) {
        const prev = out[out.length - 1];
        // Mirrors `collapseRepeatedVowels`; the `'` barrier is not a vowel, so
        // a run never crosses it. The widened `end` keeps the whole doubled
        // spelling inside the highlighted span.
        if (/[aeiou]/.test(fc.ch) && prev && prev.ch === fc.ch) {
          prev.end = fc.end;
          continue;
        }
        out.push(fc);
      }
      return out;
    }
    case 'removeBarrier':
      return chars.filter((fc) => fc.ch !== "'");
    default:
      return assertNever(step);
  }
}

/**
 * The SAME fold as {@link normTerm}, but with an OFFSET MAP back to the
 * original text. Used by the highlighter (`search-excerpt.ts`), which has to
 * bold the original characters a folded match came from.
 *
 * It dispatches on the SAME {@link FOLD_STEPS} order, so the two forms cannot
 * drift in composition. `dropHyphens` is the only difference the highlighter
 * needs (its substring search wants `anticolonial` to find `anti-colonial`);
 * the scorer keeps hyphens because `matchTerm` handles the hyphen/joined
 * equivalence itself.
 */
export function foldWithMap(
  text: string,
  opts: { dropHyphens?: boolean } = {}
): { text: string; chars: FoldedChar[] } {
  let chars: FoldedChar[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (
      opts.dropHyphens &&
      (ch === '-' || ch === '\u2010' || ch === '\u2011')
    ) {
      continue;
    }
    chars.push({ ch, start: i, end: i });
  }
  for (const step of FOLD_STEPS) chars = applyFoldStepToChars(chars, step);
  return { text: chars.map((fc) => fc.ch).join(''), chars };
}

function splitWords(text: string): string[] {
  return normTerm(text).match(WORD_RE) ?? [];
}

const WORD_CACHE = new Map<string, string[]>();

/**
 * How many split-text entries the word caches hold before clearing. The
 * default suits tests; the bibliography raises it to the library size on load
 * so every field stays split between keystrokes instead of thrashing (a 4000
 * bound cleared constantly against a 7–9k-item library, re-normalising every
 * abstract on every search — the dominant `@@` keystroke cost).
 */
let wordCacheLimit = 4000;

/** Split text into words (cached — search re-splits the same fields often). */
export function words(text: string): string[] {
  const cached = WORD_CACHE.get(text);
  if (cached) return cached;
  const out = splitWords(text);
  if (WORD_CACHE.size > wordCacheLimit) WORD_CACHE.clear();
  WORD_CACHE.set(text, out);
  return out;
}

/** Do two whole words match, allowing a known orthographic variant pair? */
function sameWord(a: string, b: string): boolean {
  return sameVariantWord(a, b);
}

/**
 * E-dropped inflections. Before a vowel-initial suffix English drops a final
 * `e` (`synthesise` + `ing` → `synthesising`), so a needle ending in `e` also
 * matches its e-dropped form — but only before a real inflection suffix, not
 * any vowel, or `analyse` would match `analysis`/`analyst`.
 */
const E_DROP_SUFFIXES = /^(ing|ings|ed|es|er|ers|ation|ations|able|ably)$/;

/** Does `word` start with `needle`, allowing a drop of a final `-e`? */
function startsWithSpelling(word: string, needle: string): boolean {
  if (word.startsWith(needle)) return true;
  if (needle.endsWith('e')) {
    const stem = needle.slice(0, -1);
    if (word.startsWith(stem) && E_DROP_SUFFIXES.test(word.slice(stem.length))) {
      return true;
    }
  }
  return false;
}

/**
 * A quoted term in a query (`"anticolonial"`, `'anticolonial'`) is a LITERAL
 * substring match: case- and diacritic-insensitive, not word-boundary-bound,
 * and not morpheme-aware. `"anticolonial"` therefore matches "anticolonial*"
 * but NOT "anti-witchcraft … colonialism". Unquoted terms keep the smarter
 * whole-word/prefix/morpheme matching.
 */
export interface QueryAtom {
  text: string;
  /** True when the user quoted it — match literally against the field text. */
  literal: boolean;
  /**
   * True for an unquoted HYPHENATED compound (`anti-colonial`). Matched like a
   * word (either the hyphenated spelling or the joined one), never split into
   * separate terms.
   */
  hyphenated?: boolean;
}

/**
 * Split a query into atoms, honouring `"…"` and `'…'`. A quoted run may contain
 * spaces and is kept whole (one literal atom); unquoted text is split on
 * whitespace/punctuation as before. Mixing is fine: `"anticolon" Africa` yields
 * a literal atom plus a normal one.
 *
 * An UNCLOSED double quote runs to the END of the query: while typing
 * `@"postcolonial Afri` the intent is plainly a literal phrase, so everything
 * after the opening `"` is one literal atom. SINGLE quotes are NOT treated this
 * way — they double as transliteration apostrophes (`ma'ani`), so an unclosed
 * `'` stays an ordinary term.
 */
export function queryAtoms(query: string): QueryAtom[] {
  const atoms: QueryAtom[] = [];
  // `"([^"]*)(?:"|$)`: a double quote closes at the next `"` OR at the end.
  const re = /"([^"]*)(?:"|$)|'([^']*)'|([^\s,;]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query))) {
    if (m[1] !== undefined || m[2] !== undefined) {
      // Quoted: keep the literal text (including any hyphen or space).
      const text = normTerm(m[1] ?? m[2] ?? '').trim();
      if (text) atoms.push({ text, literal: true });
    } else {
      const raw = m[3].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (!raw) continue;
      // Keep hamza/ʿayn/apostrophes INSIDE the token: `ma'ani` and `rasa'il`
      // must stay one term (a straight apostrophe would otherwise split them
      // into `ma` + `ani` / `rasa` + `il`), and the `'` barrier must survive
      // until `normTerm` has finished collapsing repeated vowels.
      const marked = normalizeApostrophes(raw);
      // A HYPHEN is a within-word marker, not a separator: `anti-colonial` is
      // the compound, not `anti` + `colonial`. It is matched like a word (its
      // hyphen-less variant `anticolonial` counts too), NOT as two terms — so
      // it does not become "anti-aging … colonial". Any OTHER punctuation
      // separates terms, as before.
      if (marked.includes('-')) {
        atoms.push({ text: normTerm(marked), literal: false, hyphenated: true });
        continue;
      }
      for (const piece of marked.split(/[^\p{L}\p{N}']+/u)) {
        // Normalise case AND diacritics, like the field text does. Without this
        // a typed `café` stayed `café` while the haystack was folded to `cafe`,
        // so the pre-filter rejected the entry before the scorer ever saw it.
        const text = normTerm(piece);
        if (text) atoms.push({ text, literal: false });
      }
    }
  }
  return atoms;
}

/** Does the LITERAL (quoted) atom occur in `text`? Case/diacritic-insensitive. */
export function containsLiteral(text: string, atom: string): boolean {
  if (!atom) return false;
  return normTerm(text).includes(normTerm(atom));
}


/**
 * Prefix morphemes long enough to prove a boundary on their own. SHORT
 * prefixes (`co`, `de`, `di`, `in`, `re`, `bi`, …) are excluded: they are far
 * too common inside base words (`co|loni|alism`) to establish that what follows
 * is a morpheme. A compound is only recognised when its prefix is distinctive.
 */
const PREFIXES = [
  'anti', 'ante', 'auto', 'counter', 'dis', 'eco', 'extra', 'hyper',
  'inter', 'intra', 'macro', 'micro', 'mini', 'mis', 'mono', 'multi', 'neo',
  'non', 'omni', 'over', 'pan', 'para', 'poly', 'post', 'proto', 'pseudo',
  'semi', 'sub', 'super', 'supra', 'tele', 'trans', 'tri', 'ultra', 'under',
  'uni',
];

/** Is `word` a compound whose TRAILING part is `term` (anti|capitalism)? */
export function trailingPartIs(word: string, term: string): boolean {
  if (!term || term.length >= word.length) return false;
  if (!word.endsWith(term)) return false;
  return PREFIXES.some(
    (p) => word.startsWith(p) && word.length - p.length === term.length
  );
}

/** The offset at which `term` is start-aligned inside `word`, or -1.
 *  (Word start, after a known prefix, or the trailing part of a compound.) */
export function startAlignedAt(word: string, term: string): number {
  if (!term || term.length > word.length) return -1;
  if (startsWithSpelling(word, term)) return 0;
  if (term.length < MIN_INTERIOR_TERM) return -1;
  if (trailingPartIs(word, term)) return word.length - term.length;
  const p = PREFIXES.find(
    (pf) => word.startsWith(pf) && startsWithSpelling(word.slice(pf.length), term)
  );
  return p ? p.length : -1;
}

/** Is `term` start-aligned inside `word` (word start, after a prefix, or the
 *  trailing part of a compound)? */
export function startAlignedIn(word: string, term: string): boolean {
  return startAlignedAt(word, term) >= 0;
}

/** Start-alignment against ANY of a term's spelling needles (variant-aware). */
function startAlignedAny(word: string, needles: readonly string[]): boolean {
  for (const n of needles) if (startAlignedAt(word, n) >= 0) return true;
  return false;
}

export interface WordMatch {
  /** Whole word, word prefix, or a start-aligned interior morpheme. */
  strength: 'word' | 'prefix' | 'interior';
}

/**
 * Match `term` against the words of `text`.
 *
 * Returns null when nothing matches, else the STRONGEST match found. An interior
 * match must be start-aligned; a 3-letter interior match is allowed only when it
 * is a true start (`capi`, never `loni`).
 */
export function matchTerm(text: string, term: string): WordMatch | null {
  const q = normTerm(term);
  if (!q) return null;

  // HYPHEN-AWARE. A hyphen inside the TERM (`anti-colonial`) or inside the
  // FIELD word (`anti-colonial`) must be treated as a WITHIN-WORD marker: the
  // hyphenated and the joined spellings are the SAME compound. So
  //   `anticolonial`   matches "anticolonial" AND "anti-colonial"
  //   `anti-colonial`  matches "anti-colonial" AND "anticolonial"
  // and neither matches `anti` + `colonial` belonging to unrelated words.
  // The spellings `q` may match by PREFIX: itself plus its stem rotated to the
  // other spelling (`color` → also `colour`). Whole-word equality is separate
  // (sameWord); the needles close the prefix/interior asymmetry that made
  // `color` and `colour` return different sets of derived words.
  const needles = spellingNeedles(q);
  const joined = q.replace(/-/g, '');
  const joinedNeedles = needles.map((n) => n.replace(/-/g, ''));

  let best: WordMatch | null = null;
  for (const w of hyphenWords(text)) {
    const wJoined = w.replace(/-/g, '');
    const exactWord = w === q || wJoined === joined;
    const prefixHit =
      !exactWord &&
      (needles.some((n) => startsWithSpelling(w, n)) ||
        joinedNeedles.some((n) => startsWithSpelling(wJoined, n)));
    if (exactWord) return { strength: 'word' };
    if (prefixHit) {
      // A prefix is a prefix whether or not the word carries a hyphen.
      best = best ?? { strength: 'prefix' };
    }
  }
  for (const w of words(text)) {
    if (sameWord(w, q)) return { strength: 'word' };
    if (needles.some((n) => startsWithSpelling(w, n))) {
      if (!best) best = { strength: 'prefix' };
      continue;
    }
    if (!best && startAlignedAny(w, needles)) best = { strength: 'interior' };
  }
  return best;
}

/**
 * The field's words WITH HYPHENS PRESERVED (`anti-colonial`, `sub-saharan`).
 * Used for hyphenated query terms, where the hyphen is meaningful. Cached like
 * `words()`, since a hyphenated query re-reads the same fields.
 */
const HYPHEN_WORD_RE = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu;
const HYPHEN_CACHE = new Map<string, string[]>();

export function hyphenWords(text: string): string[] {
  const cached = HYPHEN_CACHE.get(text);
  if (cached) return cached;
  const out = normTerm(text).match(HYPHEN_WORD_RE) ?? [];
  if (HYPHEN_CACHE.size > wordCacheLimit) HYPHEN_CACHE.clear();
  HYPHEN_CACHE.set(text, out);
  return out;
}

/**
 * Size the word caches for a library of `fields` searchable strings and drop
 * anything already cached (the field contents may have changed). Called from
 * the bibliography whenever its index is rebuilt.
 */
export function setWordCacheLimit(fields: number): void {
  wordCacheLimit = Math.max(1000, Math.floor(fields));
  WORD_CACHE.clear();
  HYPHEN_CACHE.clear();
}

/**
 * Rank weight for an interior term of length `len`: 0.4 at
 * {@link MIN_INTERIOR_TERM}, 1 (parity with a word/prefix match) at
 * {@link PARITY_LEN}. A 3-letter start-aligned morpheme gets a small weight.
 */
export function interiorWeight(len: number): number {
  if (len >= PARITY_LEN) return 1;
  if (len < MIN_INTERIOR_TERM) return 0.15;
  // 4 → 0.4, 5 → 0.7, 6 → 1.
  return 0.4 + (len - MIN_INTERIOR_TERM) * 0.3;
}

/**
 * Does term 2 begin the word that IMMEDIATELY FOLLOWS the word term 1 matched?
 * (`cultural cri` → "cultural critique", never "cultural … acrimony".) Returns
 * how many terms were found adjacently (0, 1, 2, 3), used as a ranking bonus.
 */
export function adjacentChain(text: string, terms: string[]): number {
  if (terms.length < 2) return 0;
  const ws = words(text);
  const first = normTerm(terms[0]);
  const firstNeedles = spellingNeedles(first);
  let best = 0;
  for (let i = 0; i < ws.length - 1; i++) {
    if (
      !(
        sameWord(ws[i], first) ||
        firstNeedles.some((n) => startsWithSpelling(ws[i], n))
      )
    )
      continue;
    let chain = 1;
    for (let t = 1; t < terms.length; t++) {
      const next = ws[i + t];
      if (!next) break;
      const q = normTerm(terms[t]);
      const qNeedles = spellingNeedles(q);
      if (
        sameWord(next, q) ||
        qNeedles.some(
          (n) => startsWithSpelling(next, n) || trailingPartIs(next, n)
        )
      ) {
        chain++;
      } else {
        break;
      }
    }
    best = Math.max(best, chain);
  }
  return best;
}

/**
 * Characters at which a term appears in `text`, for highlighting. Whole/prefix
 * matches win; otherwise a start-aligned interior occurrence is returned so the
 * matched SUBSTRING is emphasised (`anticapitalism` bolds "capitalism inside").
 */
export function matchSpans(
  text: string,
  terms: string[]
): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const re = /[\p{L}\p{N}]+/gu;
  let m: RegExpExecArray | null;
  const qs = terms.map(normTerm).filter(Boolean);
  while ((m = re.exec(text))) {
    const w = normTerm(m[0]);
    for (const q of qs) {
      if (!q) continue;
      const needles = spellingNeedles(q);
      let at = -1;
      let len = q.length;
      if (sameWord(w, q)) {
        at = 0;
        // Emphasise the WHOLE original word. The normalised form can be
        // SHORTER than the source (folded diacritics, collapsed `aa` → `a`,
        // `colour` → `color`), so a length taken from the normalised form would
        // underline only part of the word.
        len = m[0].length;
      } else {
        for (const n of needles) {
          const off = startAlignedAt(w, n);
          if (off >= 0) {
            at = off;
            len = n.length;
            break;
          }
        }
      }
      if (at >= 0) {
        spans.push({ start: m.index + at, end: m.index + at + len });
      }
    }
  }
  return spans;
}
