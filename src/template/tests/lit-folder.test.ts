import {
  DEFAULT_LITERATURE_NOTE_FOLDER,
  resolveLiteratureNoteFolder,
} from '../lit-folder';

describe('DEFAULT_LITERATURE_NOTE_FOLDER', () => {
  it('is a generic name, not one user’s vault layout', () => {
    expect(DEFAULT_LITERATURE_NOTE_FOLDER).toBe('Literature Notes');
    expect(DEFAULT_LITERATURE_NOTE_FOLDER).not.toMatch(/^_/);
  });
});

describe('resolveLiteratureNoteFolder()', () => {
  describe('ScholarWeft path (the default)', () => {
    it('uses our own setting', () => {
      expect(
        resolveLiteratureNoteFolder({
          useOwnNoteTemplate: true,
          literatureNoteFolder: 'My Notes',
          zotlitFolder: 'ZotLit Notes',
        })
      ).toBe('My Notes');
    });

    it('ignores ZotLit’s folder, so the two settings cannot fight', () => {
      expect(
        resolveLiteratureNoteFolder({
          useOwnNoteTemplate: true,
          literatureNoteFolder: '',
          zotlitFolder: 'ZotLit Notes',
        })
      ).toBe('');
    });

    it('treats blank/whitespace as the vault root', () => {
      expect(
        resolveLiteratureNoteFolder({
          useOwnNoteTemplate: true,
          literatureNoteFolder: '   ',
        })
      ).toBe('');
      expect(
        resolveLiteratureNoteFolder({ useOwnNoteTemplate: true })
      ).toBe('');
    });

    it('does not fall back to the default folder name when the user clears it', () => {
      // Clearing the field is a real choice (vault root), not a missing value.
      expect(
        resolveLiteratureNoteFolder({
          useOwnNoteTemplate: true,
          literatureNoteFolder: '',
        })
      ).toBe('');
    });
  });

  describe('ZotLit path', () => {
    it('prefers ZotLit’s own folder, so all notes stay in one place', () => {
      expect(
        resolveLiteratureNoteFolder({
          useOwnNoteTemplate: false,
          literatureNoteFolder: 'My Notes',
          zotlitFolder: 'ZotLit Notes',
        })
      ).toBe('ZotLit Notes');
    });

    it('falls back to our setting when ZotLit has none', () => {
      expect(
        resolveLiteratureNoteFolder({
          useOwnNoteTemplate: false,
          literatureNoteFolder: 'My Notes',
          zotlitFolder: '',
        })
      ).toBe('My Notes');
    });

    it('falls back to the default when neither is set', () => {
      expect(
        resolveLiteratureNoteFolder({
          useOwnNoteTemplate: false,
          zotlitFolder: '  ',
        })
      ).toBe(DEFAULT_LITERATURE_NOTE_FOLDER);
    });
  });

  describe('upgraded installs', () => {
    it('no longer consults the retired useZotlitLiteratureFolder flag', () => {
      // A 0.2.x install that pointed notes at ZotLit's folder now follows the
      // path: on the own path the stored literatureNoteFolder wins, even
      // though the old flag would have sent it to ZotLit.
      expect(
        resolveLiteratureNoteFolder({
          useOwnNoteTemplate: true,
          literatureNoteFolder: 'Literature Notes',
          zotlitFolder: 'ZotLit Notes',
        })
      ).toBe('Literature Notes');
    });
  });
});
