// Pure shaping for the data explorer's entry list. Kept free of Obsidian so the
// filtering/sorting can be unit-tested; the view only turns these into DOM.

import { entryCreators, type CachedEntry } from './context';

export interface ExplorerEntry {
  /** The library citekey (the `bibCache` map key). */
  citekey: string;
  title: string;
  itemType: string;
  zoteroKey: string | null;
  /** Creator full names, joined — searched but not shown as a heading. */
  creatorNames: string;
}

export function toExplorerEntry(citekey: string, entry: CachedEntry): ExplorerEntry {
  const creators = entryCreators(entry)
    .map((c) => c.fullName)
    .filter(Boolean);
  return {
    citekey,
    title: typeof entry.title === 'string' && entry.title ? entry.title : citekey,
    itemType: typeof entry.type === 'string' ? entry.type : '',
    zoteroKey: typeof entry._zoteroKey === 'string' ? entry._zoteroKey : null,
    creatorNames: creators.join('; '),
  };
}

/** Build the sorted list from a `citekey → entry` collection. */
export function buildExplorerList(
  entries: Iterable<[string, CachedEntry]>
): ExplorerEntry[] {
  const out: ExplorerEntry[] = [];
  for (const [citekey, entry] of entries) {
    if (!entry || typeof entry !== 'object') continue;
    out.push(toExplorerEntry(citekey, entry));
  }
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

/** Case-insensitive match over title, citekey, Zotero key and creators. */
export function filterExplorerEntries(
  list: ExplorerEntry[],
  query: string
): ExplorerEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (e) =>
      e.title.toLowerCase().includes(q) ||
      e.citekey.toLowerCase().includes(q) ||
      (e.zoteroKey?.toLowerCase().includes(q) ?? false) ||
      e.creatorNames.toLowerCase().includes(q)
  );
}
