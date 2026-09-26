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
