/**
 * Collection-name index for the import dialogue's collection filter.
 *
 * Zotero stores a collection's NAME and its PARENT; an item carries only the
 * collection KEYS it belongs to. Turning those into readable, disambiguated
 * labels ("Parent > Child") is pure list work, so it lives here and is tested
 * on its own.
 */

import type { ZoteroCollectionRaw } from '../bib/helpers';

export interface CollectionNode {
  key: string;
  groupID: number;
  name: string;
  /** Parent collection key within the same library, or null for top level. */
  parentKey: string | null;
  /** Full "Parent > Child" path — disambiguates duplicate names. */
  path: string;
  /** Nesting depth (0 = top level), for indentation. */
  depth: number;
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/**
 * A filter token identifying a collection across libraries. Collection keys are
 * only unique WITHIN a library, so membership is matched on `groupID:key`.
 */
export function collectionToken(groupID: number, key: string): string {
  return `${groupID}:${key}`;
}

/** The token for the collection an entry belongs to, given its library. */
export function collectionTokens(
  groupID: number,
  keys: readonly string[] | null | undefined
): string[] {
  if (!Array.isArray(keys)) return [];
  return keys.filter((k) => typeof k === 'string' && !!k).map((k) => collectionToken(groupID, k));
}

/**
 * The token of a whole LIBRARY. A library is a top-level node like a collection
 * — every item in it is a member — so switching it off hides its uncategorised
 * items as well as (via propagation) everything in its collections.
 */
export function libraryToken(groupID: number): string {
  return `lib:${groupID}`;
}

/**
 * The tokens that govern whether an item is visible: the collections it is
 * DIRECTLY in, or — when it is in none — its library. Zotero's
 * `data.collections` lists direct membership only, so an item's home is its
 * deepest collection; the library node owns the items that have no collection.
 * An item shows when at least one of these tokens is ON.
 */
export function membershipTokens(
  groupID: number,
  keys: readonly string[] | null | undefined
): string[] {
  const cols = collectionTokens(groupID, keys);
  return cols.length ? cols : [libraryToken(groupID)];
}

/**
 * Build the display nodes from a library's raw collections: each gets its full
 * "Parent > Child" path and depth, sorted by path. A missing parent (or a
 * parent cycle) just truncates the path rather than looping.
 */
export function buildCollectionNodes(
  raw: readonly ZoteroCollectionRaw[],
  groupID: number
): CollectionNode[] {
  const byKey = new Map<string, ZoteroCollectionRaw>();
  for (const c of raw) if (c?.key) byKey.set(c.key, c);

  const ancestors = (key: string): string[] => {
    const names: string[] = [];
    const seen = new Set<string>();
    let cur: string | false | null | undefined = key;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const node = byKey.get(cur);
      if (!node) break;
      names.unshift(node.name || cur);
      cur = node.parentCollection;
    }
    return names;
  };

  return raw
    .filter((c) => !!c?.key)
    .map((c) => {
      const names = ancestors(c.key);
      const parent = c.parentCollection;
      return {
        key: c.key,
        groupID,
        name: c.name,
        parentKey:
          typeof parent === 'string' && byKey.has(parent) ? parent : null,
        path: names.join(' > '),
        depth: Math.max(0, names.length - 1),
      };
    })
    .sort(
      (a, b) =>
        collator.compare(a.path, b.path) || collator.compare(a.key, b.key)
    );
}

/**
 * The token of every collection under `rootKey` (itself included), within one
 * library. Turning a collection off turns its whole subtree off, so the UI
 * needs the full set at once.
 */
export function descendantTokens(
  nodes: readonly CollectionNode[],
  groupID: number,
  rootKey: string
): string[] {
  const byParent = new Map<string, CollectionNode[]>();
  for (const n of nodes) {
    if (n.groupID !== groupID || !n.parentKey) continue;
    const list = byParent.get(n.parentKey) ?? [];
    list.push(n);
    byParent.set(n.parentKey, list);
  }
  const out: string[] = [];
  const walk = (key: string) => {
    out.push(collectionToken(groupID, key));
    for (const child of byParent.get(key) ?? []) walk(child.key);
  };
  walk(rootKey);
  return out;
}
