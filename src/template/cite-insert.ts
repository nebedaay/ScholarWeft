/**
 * What to insert when a suggestion is accepted.
 *
 * The popup opens from several contexts, and the closing delimiter must match
 * the opening one. Getting this wrong is silent breakage: a Pandoc `[@key]` is
 * valid Markdown text, while a `[[@key]` is a broken wikilink that Obsidian
 * will not resolve.
 *
 * Model (Feature 1a, 2026-09-28):
 *
 *   bare `@`            → a COMPLETE citation: `[[@key]]` when linked citations
 *                         are in use, else `[@key]`  (⌘/Ctrl+Enter forces Pandoc)
 *   `[[@…`              → complete the wikilink: `@key]]`
 *   `[@…`               → complete the Pandoc citation: `@key]`
 *   inside a citation   → append the member: `@key`  (no closer; the surrounding
 *                         `]` — present or still to be typed — closes it)
 *
 * Plain Enter is the smart insertion; ⌘/Ctrl+Enter only differs for the bare
 * case, where it forces the Pandoc form. The kinds are decided by ONE function
 * (`insertionKind`) so the footer hint can never disagree with the insertion.
 *
 * A citekey that a bare `@key` cannot represent — e.g. one ending in `.` —
 * is written in Pandoc's explicit form `@{key}`. The WIKILINK context is the
 * exception: there the key is the note FILENAME, so braces would become part
 * of the target and break resolution (`[[@{key}]]` ≠ the note `@key`).
 *
 * Pure, so every context is a test rather than a hope.
 */
import { formatCitekey } from './citekey-grammar';

export interface InsertContext {
  /** Text on the line before the popup's start position. */
  beforeStart: string;
  /** Text on the line after the popup's end position. */
  afterCursor: string;
  /** The character immediately before the start position, if any. */
  charBefore: string | undefined;
  /**
   * True when the trigger's span began immediately after an unclosed single
   * `[` — i.e. the citation bracket is already open (`[@del`), so only the
   * closer is needed. Distinct from a wikilink, which needs `]]`.
   */
  afterOpenBracket?: boolean;
}

/** Everything `insertionKind` needs. `afterOpenBracket` is derived when absent. */
export type InsertShape = Pick<
  InsertContext,
  'beforeStart' | 'afterCursor' | 'afterOpenBracket'
>;

export interface InsertResult {
  /** The text to replace the popup's span with. */
  text: string;
}

/** Is the caret inside an unclosed `[[` wikilink? */
export function insideUnclosedWikilink(
  beforeStart: string,
  afterCursor = ''
): boolean {
  const open = beforeStart.lastIndexOf('[[');
  if (open === -1) return false;
  // Closed before the cursor?
  if (beforeStart.indexOf(']]', open) !== -1) return false;
  // Closed after the cursor (editing an existing `[[@key]]`)?
  if (afterCursor.includes(']]')) return false;
  return true;
}

/**
 * Is a single `[` open immediately before the trigger?
 *
 * `beforeStart` ends with the `@` (or `@@`), so the character before THAT is
 * what decides. A wikilink's `[[` is excluded — it needs `]]`, handled
 * separately.
 */
export function afterOpenBracketIn(beforeStart: string): boolean {
  const beforeAt = beforeStart.replace(/@+$/, '');
  return beforeAt.endsWith('[') && !beforeAt.endsWith('[[');
}

/** Is the caret already inside a bracket citation, e.g. `[@a; @b`? */
function insideExistingBlock(
  beforeStart: string,
  afterCursor: string
): boolean {
  return afterCursor.includes(']') && /\[@[^\]]*$/.test(beforeStart);
}

/**
 * Is there an unclosed `[` before the cursor — a citation being composed, e.g.
 * `[see @` or `[@a; @` with no `]` typed yet?
 *
 * Distinguishes a citation BRACKET from ordinary prose so a bare-looking `@`
 * inside one appends a member instead of starting a fresh linked citation.
 */
function isOpenBracket(beforeStart: string): boolean {
  return beforeStart.lastIndexOf('[') > beforeStart.lastIndexOf(']');
}

/**
 * Which insertion context this is. ONE source of truth: `computeInsertion` and
 * `insertionHint` both branch on it, so the footer cannot describe a different
 * action than the one performed.
 */
export type InsertionKind = 'bare' | 'wikilink' | 'bracket' | 'member';

export function insertionKind(ctx: InsertShape): InsertionKind {
  const afterCursor = ctx.afterCursor ?? '';
  const afterOpenBracket =
    ctx.afterOpenBracket ?? afterOpenBracketIn(ctx.beforeStart);

  if (insideUnclosedWikilink(ctx.beforeStart, afterCursor)) return 'wikilink';
  // Already inside a citation that has its closing `]` after the cursor:
  // appending a member must not add another closer.
  if (insideExistingBlock(ctx.beforeStart, afterCursor)) return 'member';
  if (afterOpenBracket) {
    // `[@del]` is complete — the existing `]` closes it; only `[@del` (nothing
    // after) needs a closer.
    return afterCursor.includes(']') ? 'member' : 'bracket';
  }
  if (isOpenBracket(ctx.beforeStart)) return 'member';
  return 'bare';
}

/**
 * The hint for the footer, naming what Enter will insert in this context.
 *
 * Derived from the SAME `insertionKind` as the insertion itself.
 */
export function insertionHint(
  ctx: InsertShape,
  opts: { linked?: boolean } = {}
): string {
  switch (insertionKind(ctx)) {
    case 'wikilink':
      return 'close with ]]';
    case 'bracket':
      return 'close with ]';
    case 'member':
      return 'add to citation';
    case 'bare':
      return opts.linked === false ? 'insert [@key]' : 'insert [[@key]]';
  }
}

export interface InsertOptions {
  /**
   * Linked citations are in use (the "Process linked citations" setting). A
   * bare `@` then inserts a complete `[[@citekey]]` link. When false, a bare `@`
   * inserts a Pandoc `[@citekey]` citation instead.
   */
  linked: boolean;
  /**
   * ⌘/Ctrl+Enter: force the Pandoc form. Only changes the result for a bare
   * `@`; inside an open bracket or wikilink the closer is already unambiguous.
   */
  forcePandoc?: boolean;
}

/**
 * Compute the insertion.
 *
 * The popup's replaced span ALWAYS starts at the `@` (see `onTrigger`), so every
 * result must re-include it. Returning only a closing suffix silently deleted
 * the `@` — `[[@del` became `[[smith1992]]`, a dead wikilink with no citekey.
 */
export function computeInsertion(
  citekey: string,
  ctx: InsertContext,
  opts: InsertOptions
): InsertResult {
  // Wikilink targets are filenames, so they never take braces; Pandoc citation
  // text uses the explicit form when a bare `@key` would be misread.
  const linkKey = `@${citekey}`;
  const pandocKey = formatCitekey(citekey);

  switch (insertionKind(ctx)) {
    case 'bare': {
      const linked = opts.linked && !opts.forcePandoc;
      return { text: linked ? `[[${linkKey}]]` : `[${pandocKey}]` };
    }
    case 'wikilink':
      // `[[@del` → `[[@key]]`: the '@' is part of the replaced span, so it must
      // be re-emitted alongside the closing `]]`.
      return { text: `${linkKey}]]` };
    case 'bracket':
      // `[@del` → `[@key]`
      return { text: `${pandocKey}]` };
    case 'member':
      // `[@a; @b` or `[see @b` — the surrounding closer is the user's.
      return { text: pandocKey };
  }
}
