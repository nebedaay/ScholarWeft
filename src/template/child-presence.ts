/**
 * Library-wide CHILD PRESENCE index.
 *
 * The import dialogue's filters (has Zotero notes / has a PDF or snapshot / has
 * annotations) need to know, for EVERY item, whether it has those children —
 * without fetching each item's children one at a time. Zotero's `?itemType=`
 * endpoints give this in a single pass each: every attachment and every
 * annotation in the library, with its `parentItem`. Folded together they yield
 * a compact per-item signature.
 *
 * Pure: the fetch is injected, so the fold is testable.
 */

export interface ChildPresence {
  /** 1 when the item has at least one child note. */
  n?: 1;
  /** 1 when the item has a PDF or snapshot attachment. */
  a?: 1;
  /** 1 when the item has at least one annotation. */
  an?: 1;
}

/** An attachment row: `itemKey` is the attachment's own key, `parentItem` the
 *  top-level item it belongs to. */
export interface AttachmentRow {
  itemKey: string;
  parentItem: string;
  contentType?: string | null;
}

/** An annotation row: `parentItem` is the ATTACHMENT it hangs off. */
export interface AnnotationRow {
  parentItem: string;
}

/** A child-note row: `parentItem` is the top-level item. */
export interface NoteRow {
  parentItem: string;
}

function isPdfOrSnapshot(contentType: string | null | undefined): boolean {
  const t = (contentType ?? '').toLowerCase();
  return t === 'application/pdf' || t === 'text/html';
}

/**
 * Build the presence map. Annotations are resolved attachment → item through the
 * `attachmentToItem` map (which the sync index already maintains), so an
 * annotation on a PDF is attributed to the work itself.
 */
export function buildChildPresence(input: {
  attachments: readonly AttachmentRow[];
  annotations: readonly AnnotationRow[];
  notes: readonly NoteRow[];
  attachmentToItem: ReadonlyMap<string, string>;
}): Record<string, ChildPresence> {
  const out: Record<string, ChildPresence> = {};
  const ensure = (key: string): ChildPresence => (out[key] ??= {});

  for (const a of input.attachments) {
    if (a.parentItem && isPdfOrSnapshot(a.contentType)) ensure(a.parentItem).a = 1;
  }
  for (const n of input.notes) {
    if (n.parentItem) ensure(n.parentItem).n = 1;
  }
  for (const an of input.annotations) {
    const item = input.attachmentToItem.get(an.parentItem);
    if (item) ensure(item).an = 1;
  }
  return out;
}

/** Does a presence entry satisfy a filter combination? */
export function presenceHas(
  presence: ChildPresence | undefined,
  want: { notes?: boolean; attachment?: boolean; annotations?: boolean }
): boolean {
  if (want.notes && !presence?.n) return false;
  if (want.attachment && !presence?.a) return false;
  if (want.annotations && !presence?.an) return false;
  return true;
}
