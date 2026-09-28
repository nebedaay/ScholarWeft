/**
 * Where literature notes belong. Pure rules with no plugin/Obsidian import, so
 * they are unit-testable and shared by every creation path.
 */

/**
 * Default literature-note folder. Deliberately generic: this ships to every
 * user, so it must not encode one person's vault layout.
 */
export const DEFAULT_LITERATURE_NOTE_FOLDER = 'Literature Notes';

/**
 * Which folder literature notes belong in, given the chosen import path.
 *
 * - **ZotLit path** — ZotLit's own configured folder wins (read live), so its
 *   notes and ours land in one place; our setting is only a fallback for when
 *   ZotLit has none.
 * - **ScholarWeft path** — our **Literature notes folder** setting is
 *   authoritative, and blank means the vault root. ZotLit's folder is NOT
 *   consulted, so the two settings cannot fight over where notes land.
 */
export function resolveLiteratureNoteFolder(opts: {
  useOwnNoteTemplate?: boolean;
  literatureNoteFolder?: string;
  zotlitFolder?: string;
}): string {
  const settingsFolder = (opts.literatureNoteFolder ?? '').trim();
  if (opts.useOwnNoteTemplate === true) return settingsFolder;
  const zotlitFolder = (opts.zotlitFolder ?? '').trim();
  return zotlitFolder || settingsFolder || DEFAULT_LITERATURE_NOTE_FOLDER;
}

/** Characters not allowed in a folder name, replaced with `-`. */
const UNSAFE_FOLDER_CHARS = /[\\/:*?"<>|#^[\]]/g;

/** Extra library names, remembered per group id so a folder name is stable even
 *  when the group is momentarily absent from settings (e.g. disabled then
 *  re-enabled). */
const LIBRARY_NAME_CACHE = new Map<number, string>();

/** Remember a group's display name for folder naming. */
export function rememberLibraryName(groupID: number, name: string | null | undefined): void {
  const n = (name ?? '').trim();
  if (groupID && groupID !== 1 && n) LIBRARY_NAME_CACHE.set(groupID, n);
}

/** The last name a group's FOLDER was created/renamed under, so a rename in
 *  Zotero can be detected and offered. Keyed by group id. */
const FOLDER_NAME_CACHE = new Map<number, string>();

/** Record the folder name currently in use for a group. */
export function rememberFolderName(groupID: number, folderName: string): void {
  if (groupID && groupID !== 1 && folderName) {
    FOLDER_NAME_CACHE.set(groupID, folderName);
  }
}

/** The folder name last used for a group, if any. */
export function lastFolderName(groupID: number): string | undefined {
  return FOLDER_NAME_CACHE.get(groupID);
}

/** Seed the folder-name cache (e.g. from persisted state at startup). */
export function seedFolderNames(map: Record<string, string> | undefined): void {
  for (const [gid, name] of Object.entries(map ?? {})) {
    const id = Number(gid);
    if (id && name) FOLDER_NAME_CACHE.set(id, name);
  }
}

/** The whole folder-name cache, for persistence. */
export function folderNameSnapshot(): Record<string, string> {
  return Object.fromEntries(FOLDER_NAME_CACHE);
}

/** A group's display name: settings first, then the cache, then `Group N`. */
export function libraryDisplayName(
  groupID: number,
  fromSettings?: string | null
): string {
  const fromSettingsTrimmed = (fromSettings ?? '').trim();
  if (fromSettingsTrimmed) {
    LIBRARY_NAME_CACHE.set(groupID, fromSettingsTrimmed);
    return fromSettingsTrimmed;
  }
  return LIBRARY_NAME_CACHE.get(groupID) ?? '';
}

/** A library name usable as a folder component. */
export function sanitizeLibraryFolderName(name: string, groupID: number): string {
  const cleaned = (name ?? '')
    .replace(UNSAFE_FOLDER_CHARS, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .slice(0, 80)
    .trim();
  // Nothing usable once punctuation is stripped (e.g. `///`) — name it by group.
  return cleaned && /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : `Group ${groupID}`;
}

/**
 * The literature-note folder for a specific Zotero library.
 *
 * **My Library (groupID 1 / null)** keeps the base folder — existing notes stay
 * put. A **group library** gets its own auto-named subfolder beneath it, so two
 * libraries' copies of the same work (which necessarily share a citekey) are
 * separate, uniquely-named notes and each can be refreshed from its OWN item.
 * Nothing is created until a note is actually imported.
 */
export function literatureNoteFolderFor(opts: {
  base: string;
  groupID?: number | null;
  groupName?: string | null;
}): string {
  const base = (opts.base ?? '').replace(/\/+$/, '');
  const gid = opts.groupID ?? 1;
  if (gid === 1) return base;
  const name = libraryDisplayName(gid, opts.groupName);
  const sub = sanitizeLibraryFolderName(name, gid);
  return base ? `${base}/${sub}` : sub;
}
