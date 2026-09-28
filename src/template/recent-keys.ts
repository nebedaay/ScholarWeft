/**
 * Recency ordering for the short-query autocomplete list (0/1/2 characters).
 *
 * The ranked scorer (`search-score.ts`) needs at least `MIN_SEARCH_CHARS`
 * characters; below that there is nothing to score, so the popup shows either
 * your most recently used references (0 characters) or citekeys that START with
 * what you typed (1–2 characters). Both are ordered by:
 *
 *   1. MRU position  — keys you actually inserted, most recent first;
 *   2. Zotero `dateAdded` desc — nothing recent yet: newest items first;
 *   3. citekey A–Z   — stable final tiebreak.
 *
 * Pure, so the ordering is an executable test.
 */

/** Cap on the persisted MRU list; far more than the 20 the popup ever shows. */
export const RECENT_KEYS_LIMIT = 200;

/** Move `key` to the front of the MRU list, de-duplicated and bounded. */
export function touchRecentKey(
  list: readonly string[],
  key: string,
  limit = RECENT_KEYS_LIMIT
): string[] {
  if (!key) return [...list];
  return [key, ...list.filter((k) => k !== key)].slice(0, limit);
}

/** The shape the ordering needs from a cached entry. */
export interface RecentCandidate {
  id: string;
  _dateAdded?: unknown;
}

function dateAdded(entry: RecentCandidate): string {
  return typeof entry._dateAdded === 'string' ? entry._dateAdded : '';
}

/** A stable rank map from the MRU list (first occurrence wins). */
function mruRank(recent: readonly string[]): Map<string, number> {
  const rank = new Map<string, number>();
  recent.forEach((key, i) => {
    if (!rank.has(key)) rank.set(key, i);
  });
  return rank;
}

/**
 * Order entries by recency. Entries absent from `recent` sort after every
 * present one, newest `dateAdded` first.
 */
export function orderByRecency<T extends RecentCandidate>(
  entries: readonly T[],
  recent: readonly string[]
): T[] {
  const rank = mruRank(recent);
  return [...entries].sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id)! : Number.POSITIVE_INFINITY;
    const rb = rank.has(b.id) ? rank.get(b.id)! : Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    const da = dateAdded(a);
    const db = dateAdded(b);
    if (da !== db) return db.localeCompare(da); // newest first
    return a.id.localeCompare(b.id);
  });
}

/**
 * Citekeys whose id starts with `query`, case- and diacritic-insensitively.
 * An empty query matches everything (the caller then relies on recency).
 */
export function prefixMatches<T extends { id: string }>(
  entries: readonly T[],
  query: string
): T[] {
  const q = normalizeKey(query);
  if (!q) return [...entries];
  return entries.filter((e) => normalizeKey(e.id).startsWith(q));
}

/** Case/diacritic-insensitive form for prefix comparison. */
export function normalizeKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
