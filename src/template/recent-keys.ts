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

/** Cap on remembered notes; the least-recently-used are dropped. */
export const RECENT_KEYS_MAX_NOTES = 50;

/** Vault path → that note's citekeys, most recently used first. Per-note, so
 *  unrelated notes do not share a history. */
export type RecentKeysMap = Record<string, string[]>;

/** Move `key` to the front of the MRU list, de-duplicated and bounded. */
export function touchRecentKey(
  list: readonly string[],
  key: string,
  limit = RECENT_KEYS_LIMIT
): string[] {
  if (!key) return [...list];
  return [key, ...list.filter((k) => k !== key)].slice(0, limit);
}

/** This note's MRU list (empty when it has none yet). */
export function getRecentKeys(
  map: RecentKeysMap | null | undefined,
  notePath: string
): string[] {
  return map?.[notePath] ?? [];
}

/**
 * Record `key` for `notePath`, keeping the note's list bounded and the number
 * of remembered notes capped (least-recently-used note dropped first). Pure, so
 * the per-note isolation and caps are tests.
 */
export function recordRecentKey(
  map: RecentKeysMap | null | undefined,
  notePath: string,
  key: string,
  limit = RECENT_KEYS_LIMIT,
  maxNotes = RECENT_KEYS_MAX_NOTES
): RecentKeysMap {
  if (!notePath || !key) return { ...(map ?? {}) };
  const next: RecentKeysMap = {};
  for (const [path, list] of Object.entries(map ?? {})) {
    if (path !== notePath) next[path] = list;
  }
  // Re-insert the touched note LAST so object order is least-recently-used.
  next[notePath] = touchRecentKey(getRecentKeys(map, notePath), key, limit);
  const paths = Object.keys(next);
  if (paths.length > maxNotes) {
    for (const path of paths.slice(0, paths.length - maxNotes)) delete next[path];
  }
  return next;
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

/** How recently a query must have been used in the SAME note to lead the
 *  0-character popup. */
export const LAST_SEARCH_WINDOW_MS = 5 * 60 * 1000;

/** Cap on remembered per-note queries; older notes are pruned first. */
export const LAST_SEARCH_MAX_NOTES = 20;

/** The query that last produced a selected citation, for ONE note. */
export interface LastSearch {
  /** As typed (underscores included); normalise before searching. */
  query: string;
  /** True when it was an `@@` search (abstract/venue tier). */
  doubleAt: boolean;
  /** Epoch ms of the selection. */
  at: number;
}

/** Vault path → that note's last query. Per-note, so tabbing away and querying
 *  in another note does NOT clobber this note's entry. */
export type LastSearchMap = Record<string, LastSearch>;

/** Is this entry still worth leading the 0-character list with? */
export function isLastSearchFresh(
  last: LastSearch | null | undefined,
  now: number
): boolean {
  if (!last || !last.query) return false;
  const age = now - last.at;
  return age >= 0 && age < LAST_SEARCH_WINDOW_MS;
}

/** The usable last query for `notePath`, or null. */
export function getLastSearch(
  map: LastSearchMap | null | undefined,
  notePath: string,
  now: number
): LastSearch | null {
  const last = map?.[notePath];
  return isLastSearchFresh(last, now) ? last : null;
}

/**
 * Record `search` for `notePath`, dropping expired entries, keeping the newest
 * `maxNotes`. Pure, so the pruning is a test.
 */
export function recordLastSearch(
  map: LastSearchMap | null | undefined,
  notePath: string,
  search: { query: string; doubleAt: boolean },
  now: number,
  maxNotes = LAST_SEARCH_MAX_NOTES
): LastSearchMap {
  const next: LastSearchMap = {};
  for (const [path, entry] of Object.entries(map ?? {})) {
    if (path !== notePath && isLastSearchFresh(entry, now)) next[path] = entry;
  }
  if (search.query) {
    next[notePath] = { query: search.query, doubleAt: search.doubleAt, at: now };
  }
  return Object.fromEntries(
    Object.entries(next)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, Math.max(1, maxNotes))
  );
}
