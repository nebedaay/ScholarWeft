import {
  folderNameSnapshot,
  lastFolderName,
  libraryDisplayName,
  literatureNoteFolderFor,
  rememberFolderName,
  rememberLibraryName,
  seedFolderNames,
  sanitizeLibraryFolderName,
} from '../lit-folder';

describe('sanitizeLibraryFolderName()', () => {
  it('keeps ordinary names', () => {
    expect(sanitizeLibraryFolderName('Andrea Lickacz readings', 5)).toBe(
      'Andrea Lickacz readings'
    );
  });

  it('replaces filesystem-hostile characters', () => {
    expect(sanitizeLibraryFolderName('A/B:C*D?', 5)).toBe('A-B-C-D-');
    expect(sanitizeLibraryFolderName('[[x/y]]', 5)).toBe('--x-y--');
  });

  it('collapses whitespace and trims leading dots', () => {
    expect(sanitizeLibraryFolderName('  spaced   name  ', 5)).toBe('spaced name');
    expect(sanitizeLibraryFolderName('../etc', 5)).toBe('-etc');
  });

  it('falls back to Group N for an unusable name', () => {
    expect(sanitizeLibraryFolderName('', 42)).toBe('Group 42');
    expect(sanitizeLibraryFolderName('///', 42)).toBe('Group 42');
  });
});

describe('literatureNoteFolderFor()', () => {
  const base = 'Literature Notes';

  it('leaves My Library in the base folder', () => {
    expect(literatureNoteFolderFor({ base })).toBe(base);
    expect(literatureNoteFolderFor({ base, groupID: 1 })).toBe(base);
    expect(literatureNoteFolderFor({ base, groupID: null })).toBe(base);
  });

  it('gives each group library its own subfolder', () => {
    expect(
      literatureNoteFolderFor({ base, groupID: 6667607, groupName: 'Readings' })
    ).toBe('Literature Notes/Readings');
  });

  it('handles a blank base (vault root)', () => {
    expect(
      literatureNoteFolderFor({ base: '', groupID: 7, groupName: 'G' })
    ).toBe('G');
  });

  it('trims a trailing slash on the base', () => {
    expect(
      literatureNoteFolderFor({ base: 'Notes/', groupID: 7, groupName: 'G' })
    ).toBe('Notes/G');
  });

  it('falls back to Group N when no name is known', () => {
    expect(literatureNoteFolderFor({ base: 'Notes', groupID: 888888 })).toBe(
      'Notes/Group 888888'
    );
  });
});

describe('libraryDisplayName() / name cache', () => {
  it('prefers the settings name and remembers it', () => {
    rememberLibraryName(6667607, 'Andrea Lickacz readings');
    expect(libraryDisplayName(6667607, 'Andrea Lickacz readings')).toBe(
      'Andrea Lickacz readings'
    );
    // Available later even without a settings value.
    expect(libraryDisplayName(6667607)).toBe('Andrea Lickacz readings');
  });

  it('uses the cached name when settings has none', () => {
    rememberLibraryName(999, 'Shared Readings');
    expect(libraryDisplayName(999, null)).toBe('Shared Readings');
  });

  it('returns empty for an unknown group (folder falls back to Group N)', () => {
    expect(libraryDisplayName(123456, '')).toBe('');
  });
});

describe('literatureNoteFolderFor() with the name cache', () => {
  it('names the subfolder from the remembered library name', () => {
    rememberLibraryName(6667607, 'Andrea Lickacz readings');
    expect(literatureNoteFolderFor({ base: 'Notes', groupID: 6667607 })).toBe(
      'Notes/Andrea Lickacz readings'
    );
  });
});

describe('folder-name record (rename detection)', () => {
  it('remembers and returns the last folder name for a group', () => {
    rememberFolderName(6667607, 'AL Readings');
    expect(lastFolderName(6667607)).toBe('AL Readings');
  });

  it('seeds from persisted state', () => {
    seedFolderNames({ '4242': 'Old Name' });
    expect(lastFolderName(4242)).toBe('Old Name');
  });

  it('snapshots for persistence', () => {
    rememberFolderName(1234, 'X');
    expect(folderNameSnapshot()['1234']).toBe('X');
  });
});
