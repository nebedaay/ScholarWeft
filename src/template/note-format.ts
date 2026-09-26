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
