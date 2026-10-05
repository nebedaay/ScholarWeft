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

  // Find the RIGHTMOST valid trigger, not the first `@` on the line. A line can
  // hold several `@`s (e.g. a citation followed by a new one: `[[@smith2005]] @`
  // or `@smith2005 @`), and a greedy, start-anchored regex would match the OLD
  // `@` and never trigger on the one just typed. Scan from the end so the `@`
  // under the cursor wins.
  for (let i = line.length - 1; i >= 0; i--) {
    if (line[i] !== '@') continue;

    // `@@` (the second `@` forms a pair with the previous char).
    if (i > 0 && line[i - 1] === '@') {
      const atPos = i - 1;
      if (!isWordStartBefore(line[atPos - 1])) {
        i = atPos; // skip the pair; nothing valid starts here
        continue;
      }
      const query = line.slice(i + 1);
      // `@@`: a period closes the trigger; spaces are always allowed.
      if (query.includes('.')) continue;
      if (query.trim().length < minChars) return null;
      return { atPos, query: DOUBLE_AT_PREFIX + query, isDoubleAt: true };
    }

    // Single `@`.
    if (!isWordStartBefore(line[i - 1])) continue;
    const query = line.slice(i + 1);
    // Sentence punctuation ends the citation. With spaces allowed, only
    // `.,;!?` stop it; without, a space also ends the token.
    const stop = allowSpaces ? /[.,;!?\n]/ : /[\s.,;!?\n]/;
    if (stop.test(query)) continue;
    if (query.trim().length < minChars) return null;
    return { atPos: i, query, isDoubleAt: false };
  }

  return null;
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
