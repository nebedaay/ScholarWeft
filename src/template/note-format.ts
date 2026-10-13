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
