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

/**
 * Is this entry worth offering in the recency/prefix list? An entry with NO
 * title, author or editor (a bare `zoteroitemN` for an untitled, unattributed
 * item) is noise there. It stays in the library, so an explicit search can still
 * find it by citekey.
 */
export function isUsablePopupEntry(entry: {
  title?: unknown;
  author?: unknown;
  editor?: unknown;
}): boolean {
  const nonEmpty = (v: unknown): boolean =>
    typeof v === 'string'
      ? v.trim().length > 0
      : Array.isArray(v)
        ? v.length > 0
        : false;
  return nonEmpty(entry.title) || nonEmpty(entry.author) || nonEmpty(entry.editor);
}

/** How recently a query must have been used in the SAME note to lead the
 *  0-character popup. Older queries stay available for Tab cycling. */
export const LAST_SEARCH_WINDOW_MS = 5 * 60 * 1000;

/** Cap on remembered queries per note, and on remembered notes. */
export const QUERY_HISTORY_PER_NOTE = 20;
export const QUERY_HISTORY_MAX_NOTES = 50;
/** Cap on the global query history (the fallback for a note with no history). */
export const GLOBAL_QUERY_HISTORY_LIMIT = 50;

/** One remembered query. */
export interface QueryEntry {
  /** As typed (underscores included); normalise before searching. */
  query: string;
  /** True when it was an `@@` search (abstract/venue tier). */
  doubleAt: boolean;
  /** Epoch ms it was last used. */
  at: number;
}

/** Vault path → that note's query history, most recent first. */
export type QueryHistoryMap = Record<string, QueryEntry[]>;

/** Is this entry fresh enough to lead the 0-character list with? */
export function isQueryFresh(
  entry: QueryEntry | null | undefined,
  now: number
): boolean {
  if (!entry || !entry.query) return false;
  const age = now - entry.at;
  return age >= 0 && age < LAST_SEARCH_WINDOW_MS;
}

/** This note's query history (most recent first). */
export function getQueryHistory(
  map: QueryHistoryMap | null | undefined,
  notePath: string
): QueryEntry[] {
  return map?.[notePath] ?? [];
}

/** The note's most recent query, when it is fresh; else null. */
export function getLastQuery(
  map: QueryHistoryMap | null | undefined,
  notePath: string,
  now: number
): QueryEntry | null {
  const first = getQueryHistory(map, notePath)[0];
  return isQueryFresh(first, now) ? first : null;
}

/** Same query text AND mode? */
function sameQuery(
  a: { query: string; doubleAt: boolean },
  b: { query: string; doubleAt: boolean }
): boolean {
  return a.query === b.query && a.doubleAt === b.doubleAt;
}

/**
 * Record `entry` for `notePath`: pushed to the front, de-duplicated by
 * query+mode, capped per note; the number of remembered notes is capped by
 * least-recently-used. Pure, so the pruning is a test.
 */
export function recordQuery(
  map: QueryHistoryMap | null | undefined,
  notePath: string,
  entry: { query: string; doubleAt: boolean },
  now: number,
  perNote = QUERY_HISTORY_PER_NOTE,
  maxNotes = QUERY_HISTORY_MAX_NOTES
): QueryHistoryMap {
  if (!notePath || !entry.query) return { ...(map ?? {}) };
  const next: QueryHistoryMap = {};
  for (const [path, list] of Object.entries(map ?? {})) {
    if (path !== notePath) next[path] = list;
  }
  // Re-insert the touched note LAST so object order is least-recently-used.
  const prior = getQueryHistory(map, notePath).filter((e) => !sameQuery(e, entry));
  next[notePath] = [
    { query: entry.query, doubleAt: entry.doubleAt, at: now },
    ...prior,
  ].slice(0, perNote);
  const paths = Object.keys(next);
  if (paths.length > maxNotes) {
    for (const path of paths.slice(0, paths.length - maxNotes)) delete next[path];
  }
  return next;
}

/** Push `entry` to the front of the global query history. */
export function touchQueryHistory(
  list: readonly QueryEntry[],
  entry: { query: string; doubleAt: boolean },
  now: number,
  limit = GLOBAL_QUERY_HISTORY_LIMIT
): QueryEntry[] {
  if (!entry.query) return [...list];
  return [
    { query: entry.query, doubleAt: entry.doubleAt, at: now },
    ...list.filter((e) => !sameQuery(e, entry)),
  ].slice(0, limit);
}

/**
 * The order Tab cycles through: THIS note's queries (most recent first), then
 * the global history, de-duplicated by query+mode so a query in both is offered
 * once.
 */
export function cycleQueries(
  noteHistory: readonly QueryEntry[],
  globalHistory: readonly QueryEntry[]
): QueryEntry[] {
  const out: QueryEntry[] = [];
  const seen = new Set<string>();
  for (const entry of [...noteHistory, ...globalHistory]) {
    if (!entry.query) continue;
    const key = `${entry.doubleAt ? '@@' : '@'}\u0000${entry.query}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/** Resolve a citekey through a rename map (old → new), bounded against cycles. */
export function resolveRename(
  key: string,
  renames: ReadonlyMap<string, string>
): string {
  let cur = key;
  for (let hops = 0; renames.has(cur) && hops < 10; hops++) {
    cur = renames.get(cur)!;
  }
  return cur;
}

/**
 * Reconcile cached citekeys against the LIVE library, at refresh time so search
 * never has to vet: a renamed key is remapped (keeping its position), one that
 * no longer resolves is dropped, and duplicates collapse. Order is preserved.
 */
export function reconcileKeys(
  list: readonly string[],
  live: { has(key: string): boolean },
  renames: ReadonlyMap<string, string> = new Map()
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of list) {
    const mapped = resolveRename(key, renames);
    if (live.has(mapped) && !seen.has(mapped)) {
      seen.add(mapped);
      out.push(mapped);
    }
  }
  return out;
}
