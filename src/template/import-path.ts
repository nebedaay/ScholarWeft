/**
 * Is the ZotLit-only "Insert Zotero notes" action in play?
 *
 * ZotLit imports a reference's Zotero child notes as separate files rather than
 * into the literature note, so folding them in is a ZotLit-path concern only.
 * ScholarWeft's own template renders child notes inline as part of create and
 * update, so neither the settings button nor the command is shown then.
 *
 * Shared by the settings page (whether to render the button) and the plugin
 * (whether to register the palette command) so the two can't disagree.
 */
export function zotlitIsNoteImportPath(settings: {
  useOwnNoteTemplate?: boolean;
  createNotesWithZotLit?: boolean;
}): boolean {
  return (
    settings.useOwnNoteTemplate !== true && settings.createNotesWithZotLit !== false
  );
}
