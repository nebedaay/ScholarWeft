// The ONE citekey parser. Every place that needs to identify a citekey in text
// calls `scanCitekeys` (or a helper built on it), so detection is identical
// everywhere: rename/reconcile, the pandoc→linked converter, and the migration
// tools. Generation is deliberately stricter — the recommended BBT formula is
// alphanumeric — but PARSING accepts the full Pandoc key grammar, so an
// existing key with internal punctuation is never missed.
//
// Dependency-free ON PURPOSE: `note-lookup.ts` (which imports Obsidian)
// re-exports this, and the Node tools under `tools/` import it directly.
//
// Pandoc's grammar: a citekey is the maximal run of key characters after `@`,
// with a TRAILING run of punctuation stripped — `@smith2005.` → `smith2005`,
// `@smith-2005` → `smith-2005`, `@smith.important.2005` → itself. `_` is a word
// character (kept even trailing); every other punctuation character may appear
// internally but is trailing-only. A negative lookbehind excludes an `@` glued
// to a word (an email or a handle) — Pandoc's own `notAfterString` guard.

/** Characters that may appear inside a citekey: letters, digits, `_`, and the
 *  punctuation Pandoc permits internally. */
export const CITEKEY_BODY = '[\\p{L}\\p{N}_.:#$%&+?<>~\\/-]';

/** The punctuation Pandoc strips from the END of a key (`_` excluded). */
const TRAILING_PUNCT = /[:.#$%&+?<>~/\-]+$/;

/** One compiled scanner. Draining it is synchronous, so its `lastIndex` cannot
 *  be clobbered by an interleaved call across an `await`. */
const CITEKEY_SCAN = new RegExp(
  `(?<![\\p{L}\\p{N}_])@(${CITEKEY_BODY}+)`,
  'gu'
);

/** An `@` preceded by one of these is not a citation: a word character (an
 *  email / a handle), `@` (a legacy `@@`), or the link/bracket syntax. */
const NOT_A_CITEKEY_BEFORE = /[\p{L}\p{N}_@[\]/|]/u;

/** One citekey occurrence in a run of text. */
export interface CitekeyHit {
  /** Index of the `@`. */
  start: number;
  /** Index just past `@` + the key (any trailing punctuation excluded). */
  end: number;
  /** The parsed citekey, trailing punctuation stripped. */
  key: string;
}

/**
 * Find every citekey in `text` with Pandoc's rules. Offset-stable, so the same
 * scan drives detection, planning, and replacement — they can never disagree
 * about what a key is.
 */
export function scanCitekeys(text: string): CitekeyHit[] {
  const hits: CitekeyHit[] = [];
  CITEKEY_SCAN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITEKEY_SCAN.exec(text))) {
    const key = m[1].replace(TRAILING_PUNCT, '');
    if (!key) continue;
    hits.push({ start: m.index, end: m.index + 1 + key.length, key });
  }
  return hits;
}

/**
 * Replace `@old` with `@new` for every key in `renameMap`, leaving the trailing
 * punctuation of each occurrence untouched. One pass (no index invalidation).
 */
export function replaceCitekeys(
  text: string,
  renameMap: Record<string, string>
): string {
  let out = '';
  let cursor = 0;
  for (const h of scanCitekeys(text)) {
    const to = renameMap[h.key];
    if (!to || to === h.key) continue;
    out += text.slice(cursor, h.start) + '@' + to;
    cursor = h.end;
  }
  if (!cursor) return text;
  return out + text.slice(cursor);
}

/**
 * Rewrite BARE prose citekeys — skipping an `@` that is part of an email or
 * handle, a wikilink alias (`|@…`), or existing `[[…]]` / `[@…]` syntax. This
 * is the shared detection the converters use. `fn` receives the key and returns
 * the replacement for the `@key` span, or `null` to leave it untouched.
 */
export function transformBareCitekeys(
  text: string,
  fn: (key: string) => string | null
): string {
  let out = '';
  let cursor = 0;
  for (const h of scanCitekeys(text)) {
    const prev = text[h.start - 1];
    if (prev && NOT_A_CITEKEY_BEFORE.test(prev)) continue;
    const replacement = fn(h.key);
    if (replacement == null) continue;
    out += text.slice(cursor, h.start) + replacement;
    cursor = h.end;
  }
  if (!cursor) return text;
  return out + text.slice(cursor);
}
