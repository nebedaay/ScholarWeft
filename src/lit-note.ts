import { App, TFile } from 'obsidian';

/**
 * Find the literature note for a citekey.
 *
 * Filename-based: `@citekey` first, then a bare `citekey`. Vault filenames are
 * unique, so this is unambiguous.
 *
 * (This used to consult ZotLit's `NoteIndex.citekeyCache` first, which caught
 * notes under any filename. That lookup went with the ZotLit integration; a
 * note ScholarWeft manages is named `@citekey` by its template, and converted
 * ZotLit notes are renamed to that on conversion, so the filename is enough.)
 */
export function getLitNoteForCitekey(
  citekey: string,
  sourcePath: string,
  app: App
): { file: TFile; linkText: string } | null {
  for (const linkText of [`@${citekey}`, citekey]) {
    const file = app.metadataCache.getFirstLinkpathDest(linkText, sourcePath);
    if (file instanceof TFile) return { file, linkText };
  }
  return null;
}
