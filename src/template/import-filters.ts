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
  /** The item's type group, for the type filter (see `typeGroupOf`). */
  typeGroup: ImportTypeGroup;
  /**
   * Collection tokens (`groupID:key`) the item belongs to. Empty means it is in
   * no collection. Tokens, not bare keys, because collection keys are only
   * unique within a library.
   */
  collections: string[];
}

/**
 * How the dialogue groups item types for filtering. The five "named" groups are
 * the common scholarly types; everything else falls into `other`, so a filter
 * can never silently hide an item with no checkbox to reach it.
 */
export type ImportTypeGroup =
  | 'book'
  | 'article'
  | 'chapter'
  | 'news'
  | 'webpage'
  | 'other';

/** The groups in display order (also the order of the checkboxes). */
export const IMPORT_TYPE_GROUPS: readonly ImportTypeGroup[] = [
  'book',
  'article',
  'chapter',
  'news',
  'webpage',
  'other',
];

/** CSL `type` → group. Anything not listed is `other`. */
const CSL_TYPE_TO_GROUP: Record<string, ImportTypeGroup> = {
  book: 'book',
  'article-journal': 'article',
  chapter: 'chapter',
  'article-newspaper': 'news',
  'article-magazine': 'news',
  webpage: 'webpage',
};

/** The type group of a CSL entry (or `other` for anything unrecognised). */
export function typeGroupOf(type: string | null | undefined): ImportTypeGroup {
  return CSL_TYPE_TO_GROUP[type ?? ''] ?? 'other';
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
  /**
   * Enabled item-type groups. EMPTY means "every type" — checking one or more
   * restricts to those groups, so an all-off default never hides anything.
   */
  types: ImportTypeGroup[];
  /**
   * Selected collection tokens (`groupID:key`). EMPTY means "any collection".
   * An item matches when it is in AT LEAST ONE of the selected collections
   * (union, not intersection).
   */
  collections: string[];
  /** Also show items that are in NO collection at all. */
  uncategorized: boolean;
}

export function defaultFilters(): ImportFilters {
  return {
    hasNotes: false,
    hasAttachment: false,
    hasAnnotations: false,
    withoutLitNote: true,
    types: [],
    collections: [],
    uncategorized: false,
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
  hasLitNote: boolean,
  type?: string | null,
  collections: string[] = []
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
    typeGroup: typeGroupOf(type),
    collections,
  };
}

/**
 * Does an item satisfy the filters?
 *
 * The "has*" filters are ANDed; `withoutLitNote` is a NEGATIVE filter (keep only
 * items that LACK a note); `types` restricts to the enabled type groups unless
 * it is empty (which means every type). The collection filter is a UNION: an
 * item matches if it is in ANY selected collection, or if `uncategorized` is on
 * and it is in none. A disabled filter never constrains anything, so the
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
  if (filters.types.length && !filters.types.includes(flags.typeGroup)) {
    return false;
  }
  if (filters.collections.length || filters.uncategorized) {
    const inSelected = flags.collections.some((c) =>
      filters.collections.includes(c)
    );
    const uncategorized = flags.collections.length === 0;
    if (!inSelected && !(filters.uncategorized && uncategorized)) return false;
  }
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
