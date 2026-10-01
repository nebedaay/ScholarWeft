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

import {
  canonicalForm,
  isVariantPair,
} from './search-variants';

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

/** Split text into words (cached — search re-splits the same fields often). */
export function words(text: string): string[] {
  const cached = WORD_CACHE.get(text);
  if (cached) return cached;
  const out = splitWords(text);
  if (WORD_CACHE.size > 4000) WORD_CACHE.clear();
  WORD_CACHE.set(text, out);
  return out;
}

/** Do two whole words match, allowing a known orthographic variant pair? */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  return isVariantPair(a, b) && canonicalForm(a) === canonicalForm(b);
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

/** Is `term` start-aligned inside `word` (word start, after a prefix, or the
 *  trailing part of a compound)? */
export function startAlignedIn(word: string, term: string): boolean {
  if (!term || term.length > word.length) return false;
  if (word.startsWith(term)) return true;
  if (term.length < MIN_INTERIOR_TERM) return false;
  if (trailingPartIs(word, term)) return true;
  return PREFIXES.some(
    (p) => word.startsWith(p) && word.slice(p.length).startsWith(term)
  );
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
  const joined = q.replace(/-/g, '');
  let best: WordMatch | null = null;
  for (const w of hyphenWords(text)) {
    const wJoined = w.replace(/-/g, '');
    const exactWord = w === q || wJoined === joined;
    const prefixHit =
      !exactWord && (w.startsWith(q) || wJoined.startsWith(joined));
    if (exactWord) return { strength: 'word' };
    if (prefixHit) {
      // A prefix is a prefix whether or not the word carries a hyphen.
      best = best ?? { strength: 'prefix' };
    }
  }
  for (const w of words(text)) {
    if (sameWord(w, q)) return { strength: 'word' };
    if (w.startsWith(q)) {
      if (!best) best = { strength: 'prefix' };
      continue;
    }
    if (!best && startAlignedIn(w, q)) best = { strength: 'interior' };
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
  if (HYPHEN_CACHE.size > 4000) HYPHEN_CACHE.clear();
  HYPHEN_CACHE.set(text, out);
  return out;
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
  let best = 0;
  for (let i = 0; i < ws.length - 1; i++) {
    if (!(sameWord(ws[i], first) || ws[i].startsWith(first))) continue;
    let chain = 1;
    for (let t = 1; t < terms.length; t++) {
      const next = ws[i + t];
      if (!next) break;
      const q = normTerm(terms[t]);
      if (next.startsWith(q) || sameWord(next, q) || trailingPartIs(next, q)) {
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
      let at = -1;
      if (sameWord(w, q) || w.startsWith(q)) at = 0;
      else if (startAlignedIn(w, q)) {
        if (w.startsWith(q)) at = 0;
        else if (trailingPartIs(w, q)) at = w.length - q.length;
        else {
          const p = PREFIXES.find(
            (pf) => w.startsWith(pf) && w.slice(pf.length).startsWith(q)
          );
          at = p ? p.length : -1;
        }
      }
      if (at >= 0) {
        spans.push({ start: m.index + at, end: m.index + at + q.length });
      }
    }
  }
  return spans;
}
