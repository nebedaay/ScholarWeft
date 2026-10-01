/**
 * Citation-trigger detection for the `@` / `@@` autocomplete.
 *
 * Kept pure so every boundary rule and minimum-length case is a test. The
 * suggester calls `detectCitationTrigger()` from both `onTrigger` and
 * `suggestWantsFront`, so the popup cannot be fronted for a context the trigger
 * itself would reject.
 *
 * Rules (2026-09-28):
 *  - A citation starts at a WORD START: start-of-line, whitespace, `[`, `(`,
 *    `;`, `,`, `-`, or `|`. `email@` and `%$#@` are therefore NOT triggers, but
 *    ` @`, `[@`, `[[@`, `[-@`, `(@` and `;@` are.
 *  - The query may be EMPTY: `@`, `@@`, `[@`, `[[@`, `[@@`, `[[@@` all trigger,
 *    so the popup can open immediately with the most recent references.
 *  - `minChars` gates how many characters must follow before the popup opens.
 *    0 (the default) opens immediately; 1 or 2 wait. Below the threshold the
 *    trigger returns null, which also lets Obsidian's native `[[` link search
 *    handle `[[@` again for users who find the popup intrusive.
 */

/**
 * Sentinel prepended to the query when `@@` mode is active. Encoding the mode
 * in the query string means it travels with the EditorSuggestContext and stays
 * correct when getSuggestions resolves asynchronously.
 */
export const DOUBLE_AT_PREFIX = '\x00';

/** Default for `settings.citeSearchMinChars`. */
export const DEFAULT_MIN_CHARS = 0;

/** Below this many characters the ranked scorer is bypassed for recency/prefix. */
export const MIN_SEARCH_CHARS = 3;

// Single-@ trigger: an optional citekey token, no spaces. The tail is `*`
// (allowing a bare `@`); the word-start boundary is enforced separately.
const singleAtRE = /(^|[^\p{L}\p{N}@])(@)([\p{L}\p{N}:.#$%&\-+?<>~_/]*)$/u;

// Single-@ trigger WITH SPACES allowed: the query runs to the end of the line
// but stops at sentence punctuation (`.`, `,`, `;`, `!`, `?`), which is how a
// reader signals "the citation ends here". The leading boundary stays.
const singleAtSpaceRE = /(^|[^\p{L}\p{N}@])(@)([^.,;!?\n]*)$/u;

// Double-@ trigger: `@@` followed by any text up to a period. A period ends the
// trigger so normal sentence punctuation closes the popup.
const doubleAtRE = /(^|[^\p{L}\p{N}@])(@@)([^.]*)$/u;

/**
 * Characters that may precede an `@` for it to begin a citation. Everything
 * else (a letter or number, or symbols such as `%$#`) means the `@` is part of
 * a word — an email address or stray symbol run — and must not trigger.
 */
export function isWordStartBefore(charBefore: string | undefined): boolean {
  if (!charBefore) return true;
  return /[\s\[(;,\-|]/.test(charBefore);
}

export interface CitationTrigger {
  /** Column of the `@` the popup replaces. */
  atPos: number;
  /** The query, with the `@@` sentinel prefix when in double mode. */
  query: string;
  isDoubleAt: boolean;
}

export interface TriggerOptions {
  /** Characters required after the marker before the popup opens. */
  minChars?: number;
  /**
   * Allow SPACES inside a bare `@` query (`@bourdieu dist`). Default true: the
   * popup then stays open while you type several words, closing at sentence
   * punctuation or on Esc / cursor movement. Turn it off to have a space end the
   * query (the older default), letting you keep writing prose after the citation.
   */
  allowSpaces?: boolean;
}

/**
 * Detect a citation trigger at the END of `line` (the text before the caret),
 * or null. `line` must already be truncated at the caret.
 */
export function detectCitationTrigger(
  line: string,
  opts: TriggerOptions = {}
): CitationTrigger | null {
  const minChars = Math.max(0, opts.minChars ?? DEFAULT_MIN_CHARS);
  const allowSpaces = opts.allowSpaces !== false;

  // `@@` is always space-tolerant, so check it first (its `@` also matches the
  // single-`@` patterns).
  const doubleMatch = line.match(doubleAtRE);
  if (doubleMatch) {
    const atPos = doubleMatch.index + doubleMatch[1].length;
    if (!isWordStartBefore(line[atPos - 1])) return null;
    if (doubleMatch[3].trim().length < minChars) return null;
    return { atPos, query: DOUBLE_AT_PREFIX + doubleMatch[3], isDoubleAt: true };
  }

  const match = allowSpaces
    ? line.match(singleAtSpaceRE) ?? line.match(singleAtRE)
    : line.match(singleAtRE);
  if (!match) return null;
  const atPos = match.index + match[1].length;
  if (!isWordStartBefore(line[atPos - 1])) return null;
  if (match[3].trim().length < minChars) return null;
  return { atPos, query: match[3], isDoubleAt: false };
}

/** The effective query text (strips the `@@` sentinel and trims). */
export function triggerQueryText(trigger: CitationTrigger): string {
  return (trigger.isDoubleAt ? trigger.query.slice(DOUBLE_AT_PREFIX.length) : trigger.query).trim();
}

/**
 * Normalise a query for SEARCHING. With spaces allowed in a bare `@` query the
 * underscore stand-in is no longer needed, but it is still honoured so
 * `@social_theory` keeps working for anyone used to it.
 */
export function normalizeQueryText(query: string): string {
  return query.replace(/_+/g, ' ').trim();
}
