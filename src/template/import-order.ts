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

/**
 * The name to sort an entry under. The first creator's family name (or the whole
 * literal for a corporate name) — and, when there is no creator, the CSL
 * `authority`. A legal case has no author, so its COURT takes that place and
 * cases sort among authors by court, which is how they read in a bibliography.
 */
function authorKey(entry: SortableEntry): string {
  const first = entry.author?.[0];
  if (first) {
    const name = text(first.family) || text(first.literal) || text(first.given);
    if (name) return name;
  }
  return text(entry.authority);
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

/** An entry with neither an author nor a title — a bare Zotero stub. */
function isBlank(entry: SortableEntry): boolean {
  return !authorKey(entry) && !titleKey(entry);
}

/**
 * Order `entries` by `mode`.
 *
 * `relevance` keeps the input order UNCHANGED — the caller has already ranked it
 * (a search) or chosen an order (browsing). It exists as a mode so the dialogue
 * can offer "Ranked search" without a special case.
 *
 * Entries with NOTHING to sort on (no author/title, or no date added) always
 * come LAST, whichever direction — so a library's bare `zoteroitemN` stubs do
 * not lead the list.
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
  const blank = mode === 'author' ? isBlank : (x: T) => !dateAddedOf(x);
  out.sort((a, b) => {
    const ab = blank(a) ? 1 : 0;
    const bb = blank(b) ? 1 : 0;
    if (ab !== bb) return ab - bb; // blanks last, independent of direction
    return flip * cmp(a, b);
  });
  return out;
}
