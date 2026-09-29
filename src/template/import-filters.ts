/**
 * Pure filtering for the "Add literature notes" dialogue.
 *
 * The dialogue shows the whole library (ranked) and narrows it with checkboxes.
 * Every rule here is a plain predicate over an entry's CACHED flags, so the
 * dialogue itself stays a thin DOM shell and the membership logic is testable.
 *
 * Flags come from data the plugin already tracks — nothing is fetched to decide
 * a filter (see the "use what we have" principle):
 *   hasNotes        — the item has ≥1 Zotero child note
 *   hasAttachment   — the item has a PDF or a snapshot (html/other) attachment
 *   hasAnnotations  — the item has ≥1 annotation (on any attachment)
 *   hasLitNote      — an Obsidian literature note already exists for its citekey
 */

export interface ImportItemFlags {
  hasNotes: boolean;
  hasAttachment: boolean;
  hasAnnotations: boolean;
  hasLitNote: boolean;
}

export interface ImportFilters {
  /** Items that have at least one Zotero child note. */
  hasNotes: boolean;
  /** Items that have a PDF or snapshot attachment. */
  hasAttachment: boolean;
  /** Items that have at least one annotation. */
  hasAnnotations: boolean;
  /**
   * Items WITHOUT an existing literature note (checked by default — importing
   * is for filling gaps, not re-rendering what you already have). Unchecking it
   * implies you want everything.
   */
  withoutLitNote: boolean;
}

export function defaultFilters(): ImportFilters {
  return {
    hasNotes: false,
    hasAttachment: false,
    hasAnnotations: false,
    withoutLitNote: true,
  };
}

/** The raw children payload the cache stores, in the shape we inspect. */
interface RawChildrenShape {
  attachments?: Array<{ contentType?: string | null }>;
  annotations?: unknown[];
  notes?: unknown[];
}

/**
 * Derive an item's filter flags from a CACHED children snapshot (or null when
 * the item's children are not known yet). A PDF/snapshot is
 * `application/pdf` or `text/html`; anything else is not counted.
 */
export function flagsFromChildren(
  children: RawChildrenShape | null | undefined,
  hasLitNote: boolean
): ImportItemFlags {
  const attachments = children?.attachments ?? [];
  const isPdfOrSnapshot = (ct: string | null | undefined) => {
    const t = (ct ?? '').toLowerCase();
    return t === 'application/pdf' || t === 'text/html';
  };
  return {
    hasNotes: (children?.notes?.length ?? 0) > 0,
    hasAttachment: attachments.some((a) => isPdfOrSnapshot(a?.contentType)),
    hasAnnotations: (children?.annotations?.length ?? 0) > 0,
    hasLitNote,
  };
}

/**
 * Does an item satisfy the filters?
 *
 * The "has*" filters are ANDed; `withoutLitNote` is a NEGATIVE filter (keep only
 * items that LACK a note). A disabled filter never constrains anything, so the
 * all-OFF (except withoutLitNote) default means "everything missing a note".
 */
export function passesImportFilters(
  flags: ImportItemFlags,
  filters: ImportFilters
): boolean {
  if (filters.hasNotes && !flags.hasNotes) return false;
  if (filters.hasAttachment && !flags.hasAttachment) return false;
  if (filters.hasAnnotations && !flags.hasAnnotations) return false;
  if (filters.withoutLitNote && flags.hasLitNote) return false;
  return true;
}

/** How many of `items` pass, for the "N of M shown" line. */
export function countPassing<T>(
  items: readonly T[],
  flagsOf: (item: T) => ImportItemFlags,
  filters: ImportFilters
): number {
  let n = 0;
  for (const it of items) if (passesImportFilters(flagsOf(it), filters)) n++;
  return n;
}
