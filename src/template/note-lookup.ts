// Pure note-location helpers for the own import path.
//
// A literature note is identified by its managed `zotero-key` frontmatter field
// (the stable Zotero id) rather than only by filename. A citekey rename changes
// the suggested filename, so locating by the stable key keeps re-imports
// updating the SAME note instead of creating a duplicate.

import { normalizePath } from 'obsidian';

export interface NoteCandidate {
  path: string;
  /** The note's `zotero-key` frontmatter value, if any. */
  zoteroKey: unknown;
}

/** First candidate under `folder` whose `zotero-key` matches. */
export function matchNoteByZoteroKey(
  candidates: NoteCandidate[],
  folder: string,
  zoteroKey: string
): string | null {
  if (!zoteroKey) return null;
  const prefix = folder ? `${normalizePath(folder)}/` : '';
  for (const c of candidates) {
    if (prefix && !c.path.startsWith(prefix)) continue;
    if (c.zoteroKey === zoteroKey) return c.path;
  }
  return null;
}
