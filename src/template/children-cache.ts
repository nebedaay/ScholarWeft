/**
 * A small persistent cache of an item's fetched CHILDREN (attachments,
 * annotations, notes, related items, live tags), keyed by the item's stable key
 * and its Zotero `_version`.
 *
 * Why: re-rendering a note is "reformat the same data" — the expensive part is
 * FETCHING (three Zotero round trips per item), not rendering. When the item's
 * `_version` is unchanged, its children cannot have changed either* — so we must
 * not fetch them again. A template update, a bulk re-render, or re-opening the
 * same note can then be pure CPU.
 *
 * (*) Annotation EDITS do not bump the parent item's version (see the sync
 * index). So this cache is used when the caller KNOWS the item is unchanged
 * (e.g. a template-only update, where nothing Zotero-side prompted the render).
 * A Zotero-driven update passes `force` or a bumped version.
 *
 * Pure-ish: no Obsidian import; persistence is injected.
 */

export interface CachedChildren {
  /** The item `_version` this snapshot was taken at. 0 when unknown. */
  version: number;
  /** Epoch ms the snapshot was stored (for a bounded, LRU-ish file). */
  at: number;
  /** The raw children payload (opaque to this module). */
  children: unknown;
}

export type ChildrenCacheData = Record<string, CachedChildren>;

/** Cap so the file cannot grow without bound. */
export const CHILDREN_CACHE_LIMIT = 1500;

export function emptyChildrenCache(): ChildrenCacheData {
  return {};
}

/**
 * Is the cached snapshot usable for this item at `version`?
 *
 * Usable when a snapshot exists AND its version matches. A caller that does not
 * know the version passes 0; then only a snapshot ALSO recorded at 0 matches
 * (never a stale versioned one).
 */
export function childrenCacheHit(
  cache: ChildrenCacheData,
  stableKey: string,
  version: number
): boolean {
  const entry = cache?.[stableKey];
  return !!entry && entry.version === version;
}

export function readChildren<T>(
  cache: ChildrenCacheData,
  stableKey: string
): T | null {
  const entry = cache?.[stableKey];
  return entry ? (entry.children as T) : null;
}

/** Store a snapshot, evicting the oldest entries beyond the cap. */
export function writeChildren(
  cache: ChildrenCacheData,
  stableKey: string,
  version: number,
  children: unknown,
  at: number,
  limit = CHILDREN_CACHE_LIMIT
): ChildrenCacheData {
  const next: ChildrenCacheData = {
    ...(cache ?? {}),
    [stableKey]: { version, at, children },
  };
  const keys = Object.keys(next);
  if (keys.length > limit) {
    const oldest = keys
      .sort((a, b) => (next[a].at ?? 0) - (next[b].at ?? 0))
      .slice(0, keys.length - limit);
    for (const k of oldest) delete next[k];
  }
  return next;
}

/** Drop snapshots for items no longer in the library. */
export function pruneChildrenCache(
  cache: ChildrenCacheData,
  isLive: (stableKey: string) => boolean
): ChildrenCacheData {
  const next: ChildrenCacheData = {};
  for (const [k, v] of Object.entries(cache ?? {})) {
    if (isLive(k)) next[k] = v;
  }
  return next;
}
