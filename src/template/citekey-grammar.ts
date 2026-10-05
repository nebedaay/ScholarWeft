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
//
// Pandoc's EXPLICIT-key escape `@{…}` is also recognized: the content is the
// key VERBATIM (braces are not key characters and trailing punctuation is
// kept). That is how a key with a trailing period or a non-identifier
// character is written; `formatCitekey`/`needsKeyBraces` produce it.

/** Characters that may appear inside a citekey: letters, digits, `_`, and the
 *  punctuation Pandoc permits internally. */
export const CITEKEY_BODY = '[\\p{L}\\p{N}_.:#$%&+?<>~\\/-]';

/** The punctuation Pandoc strips from the END of a key (`_` excluded). */
const TRAILING_PUNCT = /[:.#$%&+?<>~/\-]+$/;

/** One compiled scanner. Draining it is synchronous, so its `lastIndex` cannot
 *  be clobbered by an interleaved call across an `await`.
 *
 *  Alternative 1 is Pandoc's EXPLICIT KEY form `@{…}` — the braces are not part
 *  of the key, and their content is taken VERBATIM (trailing punctuation kept),
 *  which is how a key that would otherwise be split (`@smith2005.`) or that
 *  contains non-identifier characters is written. Alternative 2 is the bare
 *  form, whose trailing punctuation is stripped. `@{}` (the empty forced-suffix
 *  marker) matches neither: the explicit alternative needs 1+ chars and the bare
 *  one cannot start with `{`. */
const CITEKEY_SCAN = new RegExp(
  `(?<![\\p{L}\\p{N}_])@(?:\\{([^{}\\n]+)\\}|(${CITEKEY_BODY}+))`,
  'gu'
);

/** An `@` preceded by one of these is not a citation: a word character (an
 *  email / a handle), `@` (a legacy `@@`), or the link/bracket syntax. */
const NOT_A_CITEKEY_BEFORE = /[\p{L}\p{N}_@[\]/|]/u;

/** One citekey occurrence in a run of text. */
export interface CitekeyHit {
  /** Index of the `@`. */
  start: number;
  /** Index just past the whole occurrence — past `}` for a braced key, past the
   *  key (trailing punctuation excluded) for a bare one. */
  end: number;
  /** The parsed citekey: verbatim inside `{…}`, trailing punctuation stripped
   *  for the bare form. */
  key: string;
  /** True when the source used Pandoc's explicit `@{…}` form. */
  braced?: boolean;
  /** True when the key is a `[[…]]` wikilink target (a filename, not Pandoc
   *  citation text), so replacement must not add braces. */
  inWikilink?: boolean;
}

/**
 * Find every citekey in `text` with Pandoc's rules. Offset-stable, so the same
 * scan drives detection, planning, and replacement — they can never disagree
 * about what a key is. Handles both the bare and the explicit `@{…}` form.
 */
export function scanCitekeys(text: string): CitekeyHit[] {
  const hits: CitekeyHit[] = [];
  CITEKEY_SCAN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITEKEY_SCAN.exec(text))) {
    const braced = m[1] !== undefined;
    const raw = braced ? m[1] : m[2];
    // A WIKILINK target (`[[@key]]`) is a filename and is authoritative, so it
    // is verbatim too — `[[@smith2005.]]` cites the note `@smith2005.`, unlike
    // Pandoc's bare `@smith2005.` (which drops the period). An explicit key is
    // verbatim by definition; only a bare key loses its trailing punctuation.
    const wikilinkTarget = text[m.index - 2] === '[' && text[m.index - 1] === '[';
    const verbatim = braced || wikilinkTarget;
    const key = verbatim ? raw : raw.replace(TRAILING_PUNCT, '');
    if (!key) continue;
    hits.push({
      start: m.index,
      end: verbatim ? m.index + m[0].length : m.index + 1 + key.length,
      key,
      braced,
      inWikilink: wikilinkTarget || undefined,
    });
  }
  return hits;
}

/**
 * Would a key survive a bare `@key` round-trip under Pandoc's grammar? A key
 * needs braces when `@key` parses to something else — e.g. a trailing `.` or a
 * character outside the key body. Used both to write a citation in the form
 * Pandoc will read and to decide whether an existing bare occurrence was even
 * the key it looks like.
 */
export function needsKeyBraces(key: string): boolean {
  if (!key) return true;
  const hits = scanCitekeys('@' + key);
  return hits.length !== 1 || hits[0].start !== 0 || hits[0].key !== key;
}

/** Render a citekey as it must appear in text: `@key`, or `@{key}` when the
 *  bare form would be misread (or `forceBraces`). */
export function formatCitekey(key: string, forceBraces = false): string {
  return forceBraces || needsKeyBraces(key) ? '@{' + key + '}' : '@' + key;
}

/**
 * Replace `@old` with the correctly-formed `@new` for every key in
 * `renameMap`, in one pass (no index invalidation). A key that needs braces
 * (e.g. a trailing `.`) is written as `@{new}` so the result stays parseable.
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
    // A wikilink target is a filename: rewrite it verbatim (braces would become
    // part of the target). Pandoc citation text uses `@{new}` when required.
    const replacement = h.inWikilink
      ? h.braced
        ? '@{' + to + '}'
        : '@' + to
      : formatCitekey(to);
    out += text.slice(cursor, h.start) + replacement;
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
