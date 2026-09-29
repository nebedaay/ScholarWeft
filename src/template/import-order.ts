/**
 * Pure ordering for the "Add literature notes" dialogue.
 *
 * Kept separate from the filters so "which items" and "in what order" stay
 * independently testable, and so the modal is only a DOM shell around them.
 */

export type ImportSortMode = 'relevance' | 'author' | 'dateAdded';

export type SortDirection = 'asc' | 'desc';

/** The fields ordering needs. A CSL entry satisfies this structurally. */
export interface SortableEntry {
  id: string;
  title?: string | null;
  author?: Array<{ family?: string; literal?: string; given?: string }> | null;
  editor?: Array<{ family?: string; literal?: string; given?: string }> | null;
  issued?: { 'date-parts'?: Array<Array<number>> } | null;
  /** CSL `authority` (court / issuing body) — stands in for an author. */
  authority?: string | null;
  /** Zotero's ISO `dateAdded`, retained on the cache as `_dateAdded`. */
  _dateAdded?: unknown;
}

// `sensitivity: 'base'` folds case AND accents, so "École" and "ecole" sort
// together; `numeric` keeps "Item 2" before "Item 10".
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function firstCreatorName(
  list: SortableEntry['author'] | undefined
): string {
  const first = list?.[0];
  if (!first) return '';
  return text(first.family) || text(first.literal) || text(first.given);
}

/**
 * The name to sort an entry under: the first AUTHOR, else the first EDITOR
 * (an edited volume belongs under its editor in a bibliography), else the CSL
 * `authority` (a legal case's COURT — cases sort among authors by court).
 *
 * Empty when the work has no creator at all, which is what {@link authorRank}
 * pushes to the end rather than letting `''` lead the list.
 */
function authorKey(entry: SortableEntry): string {
  return (
    firstCreatorName(entry.author) ||
    firstCreatorName(entry.editor) ||
    text(entry.authority)
  );
}

function titleKey(entry: SortableEntry): string {
  return text(entry.title);
}

function yearOf(entry: SortableEntry): number {
  const y = entry.issued?.['date-parts']?.[0]?.[0];
  return typeof y === 'number' ? y : 0;
}

/** ISO 8601 strings sort chronologically as plain text. */
function dateAddedOf(entry: SortableEntry): string {
  return text(entry._dateAdded);
}

/** Author → title → year → date added, all ascending. */
function compareAuthor(a: SortableEntry, b: SortableEntry): number {
  return (
    collator.compare(authorKey(a), authorKey(b)) ||
    collator.compare(titleKey(a), titleKey(b)) ||
    yearOf(a) - yearOf(b) ||
    collator.compare(dateAddedOf(a), dateAddedOf(b))
  );
}

/** Date added, with author/title as a stable fallback for equal timestamps. */
function compareDateAdded(a: SortableEntry, b: SortableEntry): number {
  return (
    collator.compare(dateAddedOf(a), dateAddedOf(b)) ||
    collator.compare(authorKey(a), authorKey(b)) ||
    collator.compare(titleKey(a), titleKey(b))
  );
}

/**
 * Where an entry belongs relative to the primary key, independent of direction:
 *   0 — has an author key (author / editor / court)
 *   1 — no author key, but a title (sort within the group by title)
 *   2 — neither (a bare `zoteroitemN` stub — always last)
 * Author-less works would otherwise LEAD the list, because `''` sorts before
 * `A…`. A budget/title-only work belongs after the authored ones, not before.
 */
function authorRank(entry: SortableEntry): number {
  if (authorKey(entry)) return 0;
  return titleKey(entry) ? 1 : 2;
}

/**
 * Order `entries` by `mode`.
 *
 * `relevance` keeps the input order UNCHANGED — the caller has already ranked it
 * (a search) or chosen an order (browsing). It exists as a mode so the dialogue
 * can offer "Ranked search" without a special case.
 *
 * Works with no author key sort AFTER authored ones (in either direction), and
 * within that group by title; bare title-less stubs come last of all. Entries
 * with no date added likewise come last in date order.
 *
 * Returns a new array; the input is not mutated.
 */
export function sortImportEntries<T extends SortableEntry>(
  entries: readonly T[],
  mode: ImportSortMode,
  dir: SortDirection = 'asc'
): T[] {
  const out = entries.slice();
  if (mode === 'relevance') return out;
  const cmp = mode === 'author' ? compareAuthor : compareDateAdded;
  const flip = dir === 'desc' ? -1 : 1;
  const rank =
    mode === 'author' ? authorRank : (x: T) => (dateAddedOf(x) ? 0 : 1);
  out.sort((a, b) => {
    const ar = rank(a);
    const br = rank(b);
    if (ar !== br) return ar - br; // rank is direction-INDEPENDENT
    return flip * cmp(a, b);
  });
  return out;
}
