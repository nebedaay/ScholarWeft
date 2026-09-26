import { zotlitIsNoteImportPath } from '../import-path';

describe('zotlitIsNoteImportPath()', () => {
  it('is false when ScholarWeft imports notes itself (the default)', () => {
    expect(zotlitIsNoteImportPath({ useOwnNoteTemplate: true })).toBe(false);
    expect(
      zotlitIsNoteImportPath({
        useOwnNoteTemplate: true,
        createNotesWithZotLit: true,
      })
    ).toBe(false);
    // The new-install defaults: own template on, ZotLit off.
    expect(
      zotlitIsNoteImportPath({
        useOwnNoteTemplate: true,
        createNotesWithZotLit: false,
      })
    ).toBe(false);
  });

  it('is true only when ZotLit is both selected and enabled', () => {
    expect(
      zotlitIsNoteImportPath({
        useOwnNoteTemplate: false,
        createNotesWithZotLit: true,
      })
    ).toBe(true);
    // Legacy installs with no stored flag predate "createNotesWithZotLit":
    // ZotLit was on back then, so an unset value still counts as enabled.
    expect(zotlitIsNoteImportPath({ useOwnNoteTemplate: false })).toBe(true);
  });

  it('is false when the own template is off but ZotLit is disabled too', () => {
    expect(
      zotlitIsNoteImportPath({
        useOwnNoteTemplate: false,
        createNotesWithZotLit: false,
      })
    ).toBe(false);
  });

  it('treats empty settings as the ZotLit path (flags are opt-in)', () => {
    // Neither flag present means "use own template" was never turned on, so
    // this is the legacy/ZotLit shape. Real installs always carry the flags
    // from DEFAULT_SETTINGS, so this case is only about historic data.
    expect(zotlitIsNoteImportPath({})).toBe(true);
  });
});
