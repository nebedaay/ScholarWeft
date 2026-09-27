// Where a literature note's template comes from: the bundled file extracted
// into the plugin folder, or a user-editable copy in the vault.
//
// Pure (no Obsidian, no I/O), so the choice and the copy naming are unit-
// testable on their own; `noteImport.readTemplate` does the actual reads.

/** The settings the template choice depends on. */
export interface NoteTemplateSettings {
  /**
   * When false, render with the user's own template instead of the bundled one.
   * Absent/true keeps the default.
   */
  useDefaultNoteTemplate?: boolean;
  /** Vault-relative path to the user's template, used when the above is false. */
  noteTemplatePath?: string;
}

/** The vault path of the user's template, or null to use the bundled one. */
export function customNoteTemplatePath(
  settings: NoteTemplateSettings
): string | null {
  if (settings.useDefaultNoteTemplate !== false) return null;
  const path = (settings.noteTemplatePath ?? '').trim();
  return path || null;
}

/**
 * A vault path for a copied default template that does not collide with an
 * existing file: `<folder>/sw-note.eta.md`, then `sw-note-2.eta.md`, … A blank
 * or `/` folder means the vault root. `existing` holds vault-relative paths
 * already in use.
 */
export function templateCopyPath(
  folder: string,
  existing: Iterable<string>
): string {
  const dir = (folder ?? '').replace(/^\/+|\/+$/g, '');
  const taken = new Set(existing);
  const join = (name: string) => (dir ? `${dir}/${name}` : name);
  let path = join('sw-note.eta.md');
  let n = 2;
  while (taken.has(path)) {
    path = join(`sw-note-${n}.eta.md`);
    n++;
  }
  return path;
}
