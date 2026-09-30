/**
 * Zotero → literature-note auto-update: the pure decision logic.
 *
 * A Zotero change is detected from two deltas: top-level item METADATA (the
 * refresh's `modified` map) and CHILD items (annotations/attachments), which do
 * NOT bump the parent item's version — hence the incremental child fetch
 * (`itemType=annotation&since=`). An annotation's `parentItem` is the ATTACHMENT
 * it hangs off, so the attachment→item map (`state.attachments`) resolves it to
 * the top-level item whose note must be re-rendered.
 *
 * I/O-free: the attachment→item lookup is injected, so the fold is testable.
 */

/** A changed zotero child item with its parent key. */
export interface ChildDeltaItem {
  key: string;
  /** Top-level item for an attachment; the attachment key for an annotation. */
  parentItem: string;
}

/** Persisted in `.scholar-weft/sync-state.json`. */
export interface SyncState {
  /** Per-library watermark: groupId → last observed Zotero version. */
  versions: Record<string, number>;
  /** attachmentKey → top-level item key. */
  attachments: Record<string, string>;
  /** groupId → the library folder name last used, so a Zotero rename of the
   *  library can be detected and offered as a folder rename. */
  libraryFolders?: Record<string, string>;
  /**
   * item key → a compact child-presence signature, so the import dialogue's
   * has-notes / has-attachment / has-annotations filters are accurate
   * LIBRARY-WIDE without fetching an item's children. One pass over the child
   * deltas fills it; a `_version` guards staleness.
   */
  presence?: Record<string, import('./child-presence').ChildPresence>;
  /**
   * oldCitekey → newCitekey pairs detected by diffing the persisted library
   * cache against a refresh (matched by `_zoteroKey`). Kept until the vault
   * rewrite succeeds, so a declined prompt, a crash, or a deferral cannot lose
   * a rename — the library cache is already overwritten by then. Cite-only keys
   * (no literature note) have no other record of their old key.
   */
  pendingCitekeyRenames?: Record<string, string>;
}

export function emptySyncState(): SyncState {
  return {
    versions: {},
    attachments: {},
    libraryFolders: {},
    presence: {},
    pendingCitekeyRenames: {},
  };
}

/**
 * Fold an attachments + annotations delta into the state and return the set of
 * TOP-LEVEL item keys whose note content changed.
 *
 * - an ATTACHMENT change (added/removed) changes the note's `attachments` list,
 *   and refreshes the attachment→item map;
 * - an ANNOTATION change means its attachment's note changed, resolved through
 *   the map (or `lookupParent` when the attachment is not yet known).
 */
export async function collectChangedItemKeys(
  state: SyncState,
  attachments: readonly ChildDeltaItem[],
  annotations: readonly ChildDeltaItem[],
  lookupParent: (attachmentKey: string) => Promise<string | null>
): Promise<{ state: SyncState; changedItemKeys: Set<string> }> {
  const map: Record<string, string> = { ...state.attachments };
  const changed = new Set<string>();

  for (const a of attachments) {
    if (!a.key) continue;
    if (a.parentItem) {
      map[a.key] = a.parentItem;
      changed.add(a.parentItem);
    } else {
      // Detached/removed attachment.
      delete map[a.key];
    }
  }

  for (const an of annotations) {
    if (!an.parentItem) continue;
    let parentItem = map[an.parentItem];
    if (!parentItem) {
      const resolved = await lookupParent(an.parentItem);
      if (resolved) {
        map[an.parentItem] = resolved;
        parentItem = resolved;
      }
    }
    if (parentItem) changed.add(parentItem);
  }

  return { state: { ...state, attachments: map }, changedItemKeys: changed };
}

/** The stable `zotero-key` frontmatter value for a top-level item. */
export function stableKeyFor(itemKey: string, groupId: number): string {
  return groupId === 1 ? itemKey : `${itemKey}g${groupId}`;
}
