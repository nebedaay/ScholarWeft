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

/**
 * Bijective base-26 suffix: 0 → `base`, 1 → `basea`, 2 → `baseb`, … 27 → `baseaa`.
 * Used to sidestep a taken filename instead of overwriting it.
 */
export function suffixCandidate(base: string, index: number): string {
  if (index <= 0) return base;
  let n = index;
  let suffix = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    suffix = String.fromCharCode(97 + rem) + suffix;
    n = Math.floor((n - 1) / 26);
  }
  return base + suffix;
}

/** First `base`, `basea`, `baseb`… path under `folder` not in `taken`. */
export function findAvailableNotePath(
  base: string,
  folder: string,
  taken: ReadonlySet<string>
): string {
  const dir = folder ? normalizePath(folder) : '';
  for (let i = 0; i < 1000; i++) {
    const name = suffixCandidate(base, i);
    const path = dir ? `${dir}/${name}.md` : `${name}.md`;
    if (!taken.has(path)) return path;
  }
  // Practically unreachable; a timestamp keeps the "never overwrite" promise.
  const fallback = `${base}-${Date.now()}`;
  return dir ? `${dir}/${fallback}.md` : `${fallback}.md`;
}

/**
 * A note carrying ZotLit's own managed region must not be rewritten with ours;
 * ZotLit owns it. A note with no region (or ours) is safe to update.
 */
export function shouldUpdateOwnNote(existing: string | null | undefined): boolean {
  return !(existing ?? '').includes('%%zt-managed%%');
}
