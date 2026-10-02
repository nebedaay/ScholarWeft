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

/** Lowercased, diacritic-free. */
export function normTerm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
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
 */
export function queryAtoms(query: string): QueryAtom[] {
  const atoms: QueryAtom[] = [];
  const re = /"([^"]*)"|'([^']*)'|([^\s,;]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query))) {
    if (m[1] !== undefined || m[2] !== undefined) {
      // Quoted: keep the literal text (including any hyphen or space).
      const text = normTerm(m[1] ?? m[2] ?? '').trim();
      if (text) atoms.push({ text, literal: true });
    } else {
      const raw = m[3].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (!raw) continue;
      // A HYPHEN is a within-word marker, not a separator: `anti-colonial` is
      // the compound, not `anti` + `colonial`. It is matched like a word (its
      // hyphen-less variant `anticolonial` counts too), NOT as two terms — so
      // it does not become "anti-aging … colonial". Any OTHER punctuation
      // separates terms, as before.
      if (raw.includes('-')) {
        atoms.push({ text: normTerm(raw), literal: false, hyphenated: true });
        continue;
      }
      for (const piece of raw.split(/[^\p{L}\p{N}]+/u)) {
        const text = piece.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
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
        // Bold the spelling the FIELD actually uses, so `color` emphasises all
        // of `colour` rather than its first five characters.
        len = needles.find((n) => n === w)?.length ?? q.length;
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
