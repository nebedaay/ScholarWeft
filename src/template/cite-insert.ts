/**
 * What to insert when a suggestion is accepted.
 *
 * The popup opens from several contexts, and the closing delimiter must match
 * the opening one. Getting this wrong is silent breakage: a Pandoc `[@key]` is
 * valid Markdown text, while a `[[@key]` is a broken wikilink that Obsidian
 * will not resolve.
 *
 * Pure, so every context is a test rather than a hope.
 */
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

export interface InsertResult {
  /** The text to replace the popup's span with. */
  text: string;
}

/** Is the caret inside an unclosed `[[` wikilink? */
export function insideUnclosedWikilink(beforeStart: string): boolean {
  const open = beforeStart.lastIndexOf('[[');
  if (open === -1) return false;
  // An unclosed `[[` means no `]]` after it.
  return beforeStart.indexOf(']]', open) === -1;
}

/**
 * The hint for the footer, naming the mark ⌘/Ctrl+Enter will insert.
 *
 * Derived from the SAME context as the insertion itself, so the hint cannot
 * disagree with what actually happens.
 */
export function insertionHint(ctx: Pick<InsertContext, 'beforeStart' | 'afterOpenBracket'>): string {
  if (insideUnclosedWikilink(ctx.beforeStart)) return 'close with ]]';
  if (ctx.afterOpenBracket) return 'close with ]';
  return 'wrap with brackets';
}

/**
 * Is a single `[` open immediately before the trigger?
 *
 * `beforeStart` ends with the `@` (or `@@`), so the character before THAT
 * decides. A wikilink's `[[` is excluded — it needs `]]`, handled separately.
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
 * Compute the insertion.
 *
 * The popup's replaced span ALWAYS starts at the `@` (see `onTrigger`), so every
 * result must re-include it. Returning only a closing suffix silently deleted
 * the `@` — `[[@del` became `[[smith1992]]`, a dead wikilink with no citekey.
 *
 * `wrap` is the ⌘/Ctrl+Enter behaviour; plain Enter inserts the bare `@citekey`.
 */
export function computeInsertion(
  citekey: string,
  ctx: InsertContext,
  opts: { wrap: boolean }
): InsertResult {
  if (!opts.wrap) return { text: `@${citekey}` };

  if (insideExistingBlock(ctx.beforeStart, ctx.afterCursor)) {
    return { text: `@${citekey}` };
  }
  if (insideUnclosedWikilink(ctx.beforeStart)) {
    // `[[@del` → `[[@key]]`: the '@' is part of the replaced span, so it must
    // be re-emitted alongside the closing ']]'.
    return { text: `@${citekey}]]` };
  }
  if (ctx.afterOpenBracket) {
    // `[@del` → `[@key]`
    return { text: `@${citekey}]` };
  }
  return { text: `[@${citekey}]` };
}
