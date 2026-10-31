/**
 * Recognising a literature note's format, so an update can warn before it
 * changes anything.
 *
 * The marker is the honest signal: a note carries whichever region the tool
 * that wrote it uses. ScholarWeft only writes `%%sw-managed%%` when the item
 * has annotations, so a note with a key and NO region at all is ambiguous —
 * and is treated as ScholarWeft's, since that is what our own template
 * produces for an item with nothing to annotate.
 */

/** Our region markers (see `merge.ts`). */
export const SW_MANAGED_OPEN = '%%sw-managed%%';
export const SW_MANAGED_CLOSE = '%%/sw-managed%%';
/** ZotLit's region markers — their on-disk format; do not rename. */
export const ZOTLIT_MANAGED_OPEN = '%%zt-managed%%';
export const ZOTLIT_MANAGED_CLOSE = '%%/zt-managed%%';

/**
 * ScholarWeft's stable-identity frontmatter property.
 *
 * Deliberately NOT `zotero-key`. ZotLit treats ANY note carrying `zotero-key`
 * as one of its own literature notes ("ZotLit identifies a literature note by a
 * single frontmatter field: `zotero-key`"), and reserves `zotero-key`,
 * `zotero-note-key` and `zotero-lastmod`. Sharing the name meant ZotLit would
 * adopt and rewrite ScholarWeft's notes. A `sw-` prefixed name cannot be claimed
 * by anyone else.
 */
export const SW_ZOTERO_ID = 'sw-zotero-id';

/**
 * The property ScholarWeft inherited from ZotLit, still READ (never written) so
 * that (a) existing ScholarWeft notes can be migrated and (b) notes ZotLit still
 * manages stay findable for citation links.
 */
export const LEGACY_ZOTERO_KEY = 'zotero-key';

/**
 * A note's stable item key, from frontmatter: our property first, then the
 * legacy `zotero-key` (a note not yet migrated, or one ZotLit still manages).
 */
export function readStableKey(
  fm: Record<string, unknown> | undefined | null
): string | undefined {
  if (!fm) return undefined;
  for (const key of [SW_ZOTERO_ID, LEGACY_ZOTERO_KEY, 'zoteroKey']) {
    const v = fm[key];
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

/** True when the note still carries the legacy property and needs migrating. */
export function hasLegacyKey(
  fm: Record<string, unknown> | undefined | null
): boolean {
  if (!fm) return false;
  const legacy = fm[LEGACY_ZOTERO_KEY];
  const current = fm[SW_ZOTERO_ID];
  return typeof legacy === 'string' && !!legacy && !(typeof current === 'string' && current);
}

/**
 * Should this note's `zotero-key` be renamed to `sw-zotero-id`, silently?
 *
 * Yes when the note carries the legacy property and is NOT a ZotLit note. The
 * discriminator is ZotLit's region marker, and it is reliable because the two
 * tools differ in an important way: ZotLit ALWAYS writes its `%%zt-managed%%`
 * region (even when empty), whereas ScholarWeft omits its region when the item
 * has no annotations. So a `zotero-key` note with no `%%zt-managed%%` region is
 * a ScholarWeft note (with or without annotations) — or a ZotLit note whose
 * region was removed by hand — and in both cases ScholarWeft should own it.
 *
 * A note that DOES carry `%%zt-managed%%` is left alone here: it is ZotLit's,
 * and the import path asks whether to convert or leave it.
 */
export function shouldMigrateKey(
  fm: Record<string, unknown> | undefined | null,
  source: string
): boolean {
  if (!hasLegacyKey(fm)) return false;
  return !(
    source.includes(ZOTLIT_MANAGED_OPEN) || source.includes(ZOTLIT_MANAGED_CLOSE)
  );
}

export type NoteFormat = 'sw' | 'zotlit' | 'unknown';

/**
 * Which tool's format a literature note is in.
 *
 * - an `%%sw-managed%%` region → `sw`
 * - a `%%zt-managed%%` region → `zotlit`
 * - neither, but a `zotero-key` → `sw` (our template omits the region when the
 *   item has no annotations, so absence is our own shape, not a blank note)
 * - neither and no key → `unknown` (not a note we manage)
 */
export function detectNoteFormat(source: string, hasZoteroKey: boolean): NoteFormat {
  if (source.includes(SW_MANAGED_OPEN) || source.includes(SW_MANAGED_CLOSE)) {
    return 'sw';
  }
  if (
    source.includes(ZOTLIT_MANAGED_OPEN) ||
    source.includes(ZOTLIT_MANAGED_CLOSE)
  ) {
    return 'zotlit';
  }
  return hasZoteroKey ? 'sw' : 'unknown';
}

/** Human-readable name for the confirmation prompt. */
export function noteFormatLabel(format: NoteFormat): string {
  switch (format) {
    case 'sw':
      return "ScholarWeft's format";
    case 'zotlit':
      return "ZotLit's format";
    default:
      return 'an unrecognised format';
  }
}

/**
 * Where a note's body starts: the line after the closing YAML fence, or 0 when
 * the note has no frontmatter. A re-render can change the number of YAML lines,
 * so cursor restoration must be relative to this line, not to the file start.
 */
export function bodyStartLine(content: string): number {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return i + 1;
  }
  return 0;
}

/** A cursor in the body, remembered in a form a rewrite cannot invalidate. */
export interface CursorAnchor {
  /** Up to 60 characters immediately before the cursor, within the body. */
  before: string;
  /** Up to 60 characters immediately after the cursor, within the body. */
  after: string;
  /** The cursor line's exact text, used as a fallback. */
  lineText: string;
  /** The column within that line. */
  column: number;
  /** The line's 0-based offset from the first body line. */
  bodyLine: number;
  /** The cursor's absolute line/column/offset before the rewrite (detects
   *  Obsidian's own cursor restoration, which keeps the old position). */
  absoluteLine: number;
  absoluteColumn: number;
  absoluteOffset: number;
}

const CURSOR_CONTEXT = 60;

function offsetOfLine(lines: string[], line: number): number {
  let offset = 0;
  const end = Math.min(Math.max(line, 0), lines.length);
  for (let i = 0; i < end; i++) offset += lines[i].length + 1;
  return offset;
}

function lineChAt(content: string, offset: number): { line: number; ch: number } {
  const lines = content.split('\n');
  let remaining = Math.max(0, Math.min(offset, content.length));
  for (let i = 0; i < lines.length; i++) {
    if (remaining <= lines[i].length) return { line: i, ch: remaining };
    remaining -= lines[i].length + 1;
  }
  const last = Math.max(0, lines.length - 1);
  return { line: last, ch: lines[last]?.length ?? 0 };
}

/** Remember a cursor that is in the body; null for one in the YAML block. */
export function captureCursorAnchor(
  content: string,
  line: number,
  column: number,
  lineText: string
): CursorAnchor | null {
  const lines = content.split('\n');
  const bodyStart = bodyStartLine(content);
  if (line < bodyStart) return null;
  const lineStart = offsetOfLine(lines, line);
  const offset = lineStart + Math.min(column, lines[line]?.length ?? 0);
  const bodyStartOffset = offsetOfLine(lines, bodyStart);
  return {
    before: content.slice(Math.max(bodyStartOffset, offset - CURSOR_CONTEXT), offset),
    after: content.slice(offset, Math.min(content.length, offset + CURSOR_CONTEXT)),
    lineText,
    column,
    bodyLine: line - bodyStart,
    absoluteLine: line,
    absoluteColumn: column,
    absoluteOffset: offset,
  };
}

/**
 * Map a captured cursor onto the rewritten note. The text AROUND the cursor is
 * the primary anchor: it survives YAML and managed-region changes and cannot be
 * fooled by a repeated line or an empty one. The line text and body-relative
 * line are fallbacks for when the surrounding text itself changed.
 */
export function resolveCursorAnchor(
  content: string,
  anchor: CursorAnchor
): { line: number; ch: number } {
  const lines = content.split('\n');
  const bodyStart = bodyStartLine(content);
  const bodyStartOffset = offsetOfLine(lines, bodyStart);
  const last = Math.max(0, lines.length - 1);
  const preferredLine = Math.min(Math.max(bodyStart + anchor.bodyLine, bodyStart), last);
  const preferredOffset =
    offsetOfLine(lines, preferredLine) +
    Math.min(anchor.column, lines[preferredLine]?.length ?? 0);

  const needle = anchor.before + anchor.after;
  if (needle) {
    let best = -1;
    let from = bodyStartOffset;
    while (true) {
      const index = content.indexOf(needle, from);
      if (index < 0) break;
      const candidate = index + anchor.before.length;
      if (
        best < 0 ||
        Math.abs(candidate - preferredOffset) < Math.abs(best - preferredOffset)
      ) {
        best = candidate;
      }
      from = index + 1;
    }
    if (best >= 0) return lineChAt(content, best);
  }

  let target = preferredLine;
  if (anchor.lineText) {
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = bodyStart; i < lines.length; i++) {
      if (lines[i] !== anchor.lineText) continue;
      const distance = Math.abs(i - preferredLine);
      if (distance < bestDistance) {
        target = i;
        bestDistance = distance;
      }
    }
  }
  const ch = Math.min(anchor.column, lines[target]?.length ?? 0);
  return { line: target, ch };
}
